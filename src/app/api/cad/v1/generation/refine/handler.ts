import { compileProductDecomposition, type ProductDecompositionPlan } from '@/lib/ai/productDecomposition';
import { assessProductDecompositionAccuracy, isProductDecompositionPlan, productPlanAccuracyReasons, type ProductDecompositionAccuracyAssessment } from '@/lib/ai/productDecompositionAccuracy';
import { evaluateRefinementDraft, refinementPromptContract, type RefinementContext, type RefinementDraft } from '@/lib/ai/multiStageRefinement';
import { bindGenerationIntentSnapshot, bindGenerationProgram, recordGenerationStage, type GenerationRunState } from '@/lib/ai/generationRunState';
import { buildDesignIntentSnapshot, verifyProgramPreservesIntent, type DesignIntentSnapshot, type SemanticPreservationResult } from '@/lib/ai/designIntentSnapshot';
import { serverEvidenceSha256 } from '@/lib/ai/serverEvidence';
import { refinementStageOutputInstruction, validateRefinementStageOutput, type RefinementStageValidation } from '@/lib/ai/refinementStageSchema';

export type RefinementAi = (prompt: string, signal: AbortSignal) => Promise<unknown>;
export interface RefineBody {
  state?: GenerationRunState;
  context?: RefinementContext;
  /** @deprecated Retry policy is server-owned. This value is intentionally ignored. */
  maxAttempts?: number;
}

export const SERVER_REFINEMENT_MAX_ATTEMPTS = 3;

const objectFrom = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { const value = JSON.parse(clean.slice(start, end + 1)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
};

function draftFrom(value: Record<string, unknown>, stage: RefinementContext['stage']): RefinementDraft | null {
  const strings = (item: unknown) => Array.isArray(item) && item.every(value => typeof value === 'string') ? item as string[] : null;
  const unresolved = strings(value.unresolved), conflicts = strings(value.conflicts), affectedPartIds = strings(value.affectedPartIds), evidenceRefs = strings(value.evidenceRefs);
  if (value.stage !== stage || value.output === undefined || typeof value.completeness !== 'number' || typeof value.confidence !== 'number' || !unresolved || !conflicts || !affectedPartIds || !evidenceRefs) return null;
  return { stage, output: value.output, completeness: value.completeness, confidence: value.confidence, unresolved, conflicts, affectedPartIds, evidenceRefs };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function authoritativeContext(state: GenerationRunState, supplied: RefinementContext): { context?: RefinementContext; error?: string } {
  const expectedAttempt = state.stages[supplied.stage].attempt + 1;
  if (supplied.attempt !== expectedAttempt) return { error: `Attempt ${supplied.attempt} does not match server attempt ${expectedAttempt}.` };
  const priorOutputs: RefinementContext['priorOutputs'] = {};
  const priorCheckpointHashes: RefinementContext['priorCheckpointHashes'] = {};
  for (const stage of ['intent', 'decomposition', 'interfaces', 'part_programs'] as const) {
    if (stage === supplied.stage) break;
    const checkpoint = state.stages[stage];
    if (checkpoint.status === 'passed') {
      const acceptedOutput = state.checkpointOutputs?.[stage];
      if (acceptedOutput === undefined) return { error: `Server checkpoint payload is missing for ${stage}.` };
      priorOutputs[stage] = structuredClone(acceptedOutput);
      if (checkpoint.checkpointHash) priorCheckpointHashes[stage] = checkpoint.checkpointHash;
    }
  }
  const intentInput = recordValue(state.checkpointInputs?.intent);
  const boundRequest = typeof intentInput?.request === 'string' ? intentInput.request : null;
  if (boundRequest && boundRequest !== supplied.request) return { error: 'The request differs from the request bound to the server intent checkpoint.' };
  return {
    context: {
      request: supplied.request,
      stage: supplied.stage,
      attempt: expectedAttempt,
      priorOutputs,
      priorCheckpointHashes,
      feedback: [...state.stages[supplied.stage].unresolved],
      // Client-provided immutable refs are not authoritative. Manual references are derived
      // deterministically by evaluateRefinementDraft and checkpoint refs come from server hashes.
      immutableEvidenceRefs: [],
    },
  };
}

export async function handleGenerationRefine(body: RefineBody, ai: RefinementAi): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.state || body.state.schema !== 'nexyfab.generation-run.v1' || !body.context || !body.context.request.trim()) return { status: 400, payload: { ok: false, code: 'BAD_REQUEST', message: 'state and complete refinement context are required' } };
  if (body.context.request.length > 8_000) return { status: 413, payload: { ok: false, code: 'PAYLOAD_TOO_LARGE' } };
  const bound = authoritativeContext(body.state, body.context);
  if (!bound.context) return { status: 409, payload: { ok: false, code: 'INVALID_REFINEMENT_CONTEXT', message: bound.error ?? 'Refinement context does not match server state.' } };
  const context = bound.context;
  let raw: unknown;
  try {
    const stageInstruction = `\n${refinementStageOutputInstruction(context.stage)}`;
    raw = await ai(`${refinementPromptContract(context)}${stageInstruction}\nModel completeness and confidence are diagnostic only; server validators decide whether the stage advances.\nReturn JSON only with keys stage, output, completeness, confidence, unresolved, conflicts, affectedPartIds, evidenceRefs.`, AbortSignal.timeout(45_000));
  } catch (error) { return { status: 502, payload: { ok: false, code: 'AI_FAILED', message: error instanceof Error ? error.message : 'AI refinement failed' } }; }
  const parsed = objectFrom(raw), draft = parsed ? draftFrom(parsed, context.stage) : null;
  if (!draft) return { status: 422, payload: { ok: false, code: 'INVALID_REFINEMENT_DRAFT', message: 'AI returned an invalid stage draft' } };

  const maxAttempts = SERVER_REFINEMENT_MAX_ATTEMPTS;
  let decision = evaluateRefinementDraft(draft, context.attempt, maxAttempts, context);
  let stageValidation: RefinementStageValidation | undefined;
  if (decision.disposition === 'advance') {
    stageValidation = validateRefinementStageOutput(draft.stage, draft.output, context.priorOutputs);
    if (!stageValidation.passed) decision = {
      disposition: context.attempt >= maxAttempts ? 'stop' : 'refine_same_stage',
      stage: draft.stage,
      reasons: stageValidation.errors,
    };
  }
  let program: unknown;
  let accuracyAssessment: ProductDecompositionAccuracyAssessment | undefined;
  let intentSnapshot: DesignIntentSnapshot | undefined;
  let semanticPreservation: SemanticPreservationResult | undefined;
  if (decision.disposition === 'advance' && draft.stage === 'part_programs') {
    if (!isProductDecompositionPlan(draft.output)) {
      decision = { disposition: context.attempt >= maxAttempts ? 'stop' : 'refine_same_stage', stage: draft.stage, reasons: ['ProductDecompositionPlan envelope is incomplete or invalid.'] };
    } else {
      accuracyAssessment = assessProductDecompositionAccuracy(draft.output, new Set(draft.evidenceRefs), { request: context.request });
      if (!accuracyAssessment.readyForGeometry) {
        decision = {
          disposition: accuracyAssessment.requiresAuthoritativeInput ? 'request_input' : context.attempt >= maxAttempts ? 'stop' : 'refine_same_stage',
          stage: draft.stage,
          reasons: productPlanAccuracyReasons(accuracyAssessment),
        };
      } else {
        const compiled = compileProductDecomposition(draft.output as ProductDecompositionPlan);
        if (!compiled.ok) decision = { disposition: context.attempt >= maxAttempts ? 'stop' : 'refine_same_stage', stage: draft.stage, reasons: compiled.issues.map(issue => `${issue.path}: ${issue.message}`) };
        else {
          intentSnapshot = buildDesignIntentSnapshot(draft.output as ProductDecompositionPlan);
          semanticPreservation = verifyProgramPreservesIntent(intentSnapshot, compiled.program);
          if (!semanticPreservation.passed) decision = { disposition: context.attempt >= maxAttempts ? 'stop' : 'refine_same_stage', stage: draft.stage, reasons: semanticPreservation.errors };
          else program = compiled.program;
        }
      }
    }
  }
  const status = decision.disposition === 'advance' ? 'passed' : decision.disposition === 'request_input' || decision.disposition === 'manual_review' ? 'blocked' : 'failed';
  const missingRequiredPhysicalNetwork = Boolean(
    accuracyAssessment?.gates.some(gate => gate.id === 'physical-networks' && gate.status !== 'pass')
    && isProductDecompositionPlan(draft.output)
    && !(draft.output.physicalNetworks?.length),
  );
  try {
    let state = recordGenerationStage(body.state, {
      stage: draft.stage, input: { request: context.request, priorCheckpointHashes: context.priorCheckpointHashes, attempt: context.attempt }, output: draft.output, status,
      errorCodes: decision.disposition === 'advance' ? [] : [stageValidation && !stageValidation.passed ? 'STAGE_SCHEMA_INVALID' : missingRequiredPhysicalNetwork ? 'PHYSICAL_NETWORK_EMPTY' : decision.disposition === 'request_input' ? 'AUTHORITATIVE_INPUT_REQUIRED' : decision.disposition === 'manual_review' ? 'DESIGN_CONFLICT' : 'REFINEMENT_INCOMPLETE'],
      unresolved: decision.reasons, affectedPartIds: draft.affectedPartIds,
      metrics: {
        completeness: draft.completeness, confidence: draft.confidence, evidenceRefs: draft.evidenceRefs.length,
        ...(accuracyAssessment ? { accuracyGatesPassed: accuracyAssessment.gates.filter(gate => gate.status === 'pass').length, accuracyGatesTotal: accuracyAssessment.gates.length } : {}),
      },
    });
    if (decision.disposition === 'advance' && program && intentSnapshot) {
      state = bindGenerationIntentSnapshot(state, serverEvidenceSha256(intentSnapshot));
      state = bindGenerationProgram(state, serverEvidenceSha256(program));
    }
    return { status: 200, payload: { ok: true, state, draft, decision, ...(stageValidation ? { stageValidation } : {}), ...(accuracyAssessment ? { accuracyAssessment } : {}), ...(semanticPreservation ? { semanticPreservation } : {}), ...(intentSnapshot ? { intentSnapshotSha256: serverEvidenceSha256(intentSnapshot) } : {}), ...(program ? { program } : {}), quoteOrRfqSideEffects: false } };
  } catch (error) { return { status: 409, payload: { ok: false, code: 'INVALID_TRANSITION', message: error instanceof Error ? error.message : 'Invalid stage transition' } }; }
}
