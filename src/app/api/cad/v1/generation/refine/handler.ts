import { compileProductDecomposition, type ProductDecompositionPlan } from '@/lib/ai/productDecomposition';
import { evaluateRefinementDraft, refinementPromptContract, type RefinementContext, type RefinementDraft } from '@/lib/ai/multiStageRefinement';
import { recordGenerationStage, type GenerationRunState } from '@/lib/ai/generationRunState';

export type RefinementAi = (prompt: string, signal: AbortSignal) => Promise<unknown>;
export interface RefineBody { state?: GenerationRunState; context?: RefinementContext; maxAttempts?: number }

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

export async function handleGenerationRefine(body: RefineBody, ai: RefinementAi): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.state || body.state.schema !== 'nexyfab.generation-run.v1' || !body.context || !body.context.request.trim()) return { status: 400, payload: { ok: false, code: 'BAD_REQUEST', message: 'state and complete refinement context are required' } };
  if (body.context.request.length > 8_000) return { status: 413, payload: { ok: false, code: 'PAYLOAD_TOO_LARGE' } };
  let raw: unknown;
  try {
    const stageInstruction = body.context.stage === 'part_programs'
      ? '\nThe output field must be a complete ProductDecompositionPlan v1 in mm with requirements, definitions, instances, mates, subassemblies, observations, assumptions, and unresolved.'
      : '\nThe output field must contain only the structured result for this stage; include stable ids and trace links to prior outputs.';
    raw = await ai(`${refinementPromptContract(body.context)}${stageInstruction}\nReturn JSON only with keys stage, output, completeness, confidence, unresolved, conflicts, affectedPartIds, evidenceRefs.`, AbortSignal.timeout(45_000));
  } catch (error) { return { status: 502, payload: { ok: false, code: 'AI_FAILED', message: error instanceof Error ? error.message : 'AI refinement failed' } }; }
  const parsed = objectFrom(raw), draft = parsed ? draftFrom(parsed, body.context.stage) : null;
  if (!draft) return { status: 422, payload: { ok: false, code: 'INVALID_REFINEMENT_DRAFT', message: 'AI returned an invalid stage draft' } };

  const maxAttempts = Math.max(1, Math.min(5, body.maxAttempts ?? 3));
  let decision = evaluateRefinementDraft(draft, body.context.attempt, maxAttempts);
  let program: unknown;
  if (decision.disposition === 'advance' && draft.stage === 'part_programs') {
    const compiled = compileProductDecomposition(draft.output as ProductDecompositionPlan);
    if (!compiled.ok) decision = { disposition: body.context.attempt >= maxAttempts ? 'stop' : 'refine_same_stage', stage: draft.stage, reasons: compiled.issues.map(issue => `${issue.path}: ${issue.message}`) };
    else program = compiled.program;
  }
  const status = decision.disposition === 'advance' ? 'passed' : decision.disposition === 'request_input' || decision.disposition === 'manual_review' ? 'blocked' : 'failed';
  try {
    const state = recordGenerationStage(body.state, {
      stage: draft.stage, input: { request: body.context.request, priorCheckpointHashes: body.context.priorCheckpointHashes, attempt: body.context.attempt }, output: draft.output, status,
      errorCodes: decision.disposition === 'advance' ? [] : [decision.disposition === 'request_input' ? 'AUTHORITATIVE_INPUT_REQUIRED' : decision.disposition === 'manual_review' ? 'DESIGN_CONFLICT' : 'REFINEMENT_INCOMPLETE'],
      unresolved: decision.reasons, affectedPartIds: draft.affectedPartIds,
      metrics: { completeness: draft.completeness, confidence: draft.confidence, evidenceRefs: draft.evidenceRefs.length },
    });
    return { status: 200, payload: { ok: true, state, draft, decision, ...(program ? { program } : {}), quoteOrRfqSideEffects: false } };
  } catch (error) { return { status: 409, payload: { ok: false, code: 'INVALID_TRANSITION', message: error instanceof Error ? error.message : 'Invalid stage transition' } }; }
}
