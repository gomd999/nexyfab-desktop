import {
  createGenerationRun,
  recordGenerationStage,
  type GenerationRunStage,
  type GenerationRunState,
} from './generationRunState';
import { referenceGuidanceForRequest } from './referenceGuidedRefinement';
import { assessProductDecompositionAccuracy, isProductDecompositionPlan, productPlanAccuracyReasons } from './productDecompositionAccuracy';

export const REFINEMENT_STAGES = ['intent', 'decomposition', 'interfaces', 'part_programs'] as const;
export type RefinementStage = typeof REFINEMENT_STAGES[number];

export interface RefinementDraft<T = unknown> {
  stage: RefinementStage;
  output: T;
  completeness: number;
  confidence: number;
  unresolved: string[];
  conflicts: string[];
  affectedPartIds: string[];
  evidenceRefs: string[];
}

export interface RefinementContext {
  request: string;
  stage: RefinementStage;
  attempt: number;
  priorOutputs: Partial<Record<RefinementStage, unknown>>;
  priorCheckpointHashes: Partial<Record<RefinementStage, string>>;
  feedback: string[];
  immutableEvidenceRefs: string[];
}

export type RefinementGenerator = (context: RefinementContext) => Promise<RefinementDraft>;
export type RefinementDisposition = 'advance' | 'refine_same_stage' | 'request_input' | 'manual_review' | 'stop';

export interface RefinementDecision {
  disposition: RefinementDisposition;
  stage: RefinementStage;
  reasons: string[];
}

export interface MultiStageRefinementResult {
  status: 'ready_for_geometry' | 'needs_input' | 'manual_review' | 'stopped';
  state: GenerationRunState;
  outputs: Partial<Record<RefinementStage, unknown>>;
  stoppedAt: RefinementStage;
  reasons: string[];
}

const MIN_CONFIDENCE: Record<RefinementStage, number> = {
  intent: 0.8,
  decomposition: 0.9,
  interfaces: 0.95,
  part_programs: 0.95,
};

const finiteRatio = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

export function evaluateRefinementDraft(draft: RefinementDraft, attempt: number, maxAttempts: number, context?: RefinementContext): RefinementDecision {
  if (!REFINEMENT_STAGES.includes(draft.stage)) throw new TypeError(`Unsupported refinement stage: ${String(draft.stage)}`);
  if (!finiteRatio(draft.completeness) || !finiteRatio(draft.confidence)) throw new TypeError('Completeness and confidence must be finite ratios from 0 through 1.');
  if (draft.conflicts.length) return { disposition: 'manual_review', stage: draft.stage, reasons: draft.conflicts };
  if (draft.unresolved.length) return { disposition: 'request_input', stage: draft.stage, reasons: draft.unresolved };
  const reasons: string[] = [];
  if (draft.completeness < 1) reasons.push(`Completeness ${(draft.completeness * 100).toFixed(1)}% is below 100%.`);
  if (draft.confidence < MIN_CONFIDENCE[draft.stage]) reasons.push(`Confidence ${(draft.confidence * 100).toFixed(1)}% is below the ${MIN_CONFIDENCE[draft.stage] * 100}% stage threshold.`);
  if (draft.evidenceRefs.length === 0) reasons.push('No traceable evidence reference was supplied.');
  if (new Set(draft.evidenceRefs).size !== draft.evidenceRefs.length || draft.evidenceRefs.some(ref => !ref.trim())) reasons.push('Evidence references must be unique non-empty identifiers.');
  if (context) {
    const guidance = referenceGuidanceForRequest(context.request);
    const trusted = new Set([
      'user:prompt',
      ...context.immutableEvidenceRefs,
      ...guidance.requirementIds.map(id => `manual:${id}`),
      ...Object.values(context.priorCheckpointHashes).filter((hash): hash is string => typeof hash === 'string').map(hash => `checkpoint:${hash}`),
    ]);
    const invented = draft.evidenceRefs.filter(ref => !trusted.has(ref));
    if (invented.length) reasons.push(`Untrusted evidence references: ${invented.join(', ')}.`);
  }
  if (!reasons.length) return { disposition: 'advance', stage: draft.stage, reasons: [] };
  return attempt >= maxAttempts
    ? { disposition: 'stop', stage: draft.stage, reasons: [...reasons, `Stage exhausted ${maxAttempts} bounded attempts.`] }
    : { disposition: 'refine_same_stage', stage: draft.stage, reasons };
}

export function refinementPromptContract(context: RefinementContext): string {
  const guidance = referenceGuidanceForRequest(context.request);
  return [
    `Stage: ${context.stage}; bounded attempt ${context.attempt}.`,
    'Return one structured RefinementDraft. Do not skip directly to a later stage.',
    `User request: ${context.request}`,
    `Feedback: ${context.feedback.join(' | ') || 'Produce the first evidence-backed draft.'}`,
    `Immutable evidence refs: ${context.immutableEvidenceRefs.join(', ') || '(none yet)'}.`,
    `Reference requirement ids: ${guidance.requirementIds.join(', ')}.`,
    ...guidance.rules.map(rule => `Reference-derived gate: ${rule}`),
    'Preserve all accepted upstream outputs. Change only fields required by the feedback.',
    'evidenceRefs may contain only user:prompt, immutable evidence refs supplied above, checkpoint:<supplied hash>, or manual:<listed requirement id>.',
    'List every unresolved value and conflict explicitly; never invent a manufacturing dimension.',
    'For repeated parts, create one reusable definition plus independent occurrences, not one merged body.',
  ].join('\n');
}

/** Execute bounded multi-pass refinement before any kernel geometry is built. */
export async function runMultiStageRefinement(input: {
  runId: string;
  request: string;
  generate: RefinementGenerator;
  maxAttemptsPerStage?: number;
  initialState?: GenerationRunState;
}): Promise<MultiStageRefinementResult> {
  const maxAttempts = Math.max(1, input.maxAttemptsPerStage ?? 3);
  let state = input.initialState ? structuredClone(input.initialState) : createGenerationRun(input.runId);
  const outputs: Partial<Record<RefinementStage, unknown>> = {};
  const immutableEvidence = new Set<string>();
  for (const stage of REFINEMENT_STAGES) {
    let feedback: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const checkpoints = Object.fromEntries(REFINEMENT_STAGES.flatMap(item => {
        const hash = state.stages[item].checkpointHash;
        return hash ? [[item, hash]] : [];
      })) as Partial<Record<RefinementStage, string>>;
      const draft = await input.generate({
        request: input.request, stage, attempt, priorOutputs: structuredClone(outputs),
        priorCheckpointHashes: checkpoints, feedback, immutableEvidenceRefs: [...immutableEvidence].sort(),
      });
      if (draft.stage !== stage) throw new Error(`Generator returned ${draft.stage} while ${stage} was requested.`);
      let decision = evaluateRefinementDraft(draft, attempt, maxAttempts, {
        request: input.request, stage, attempt, priorOutputs: structuredClone(outputs), priorCheckpointHashes: checkpoints,
        feedback, immutableEvidenceRefs: [...immutableEvidence].sort(),
      });
      if (decision.disposition === 'advance' && stage === 'part_programs') {
        if (!isProductDecompositionPlan(draft.output)) {
          decision = { disposition: attempt >= maxAttempts ? 'stop' : 'refine_same_stage', stage, reasons: ['ProductDecompositionPlan envelope is incomplete or invalid.'] };
        } else {
          const assessment = assessProductDecompositionAccuracy(draft.output, new Set(draft.evidenceRefs), { request: input.request });
          if (!assessment.readyForGeometry) decision = {
            disposition: assessment.requiresAuthoritativeInput ? 'request_input' : attempt >= maxAttempts ? 'stop' : 'refine_same_stage',
            stage,
            reasons: productPlanAccuracyReasons(assessment),
          };
        }
      }
      if (decision.disposition === 'advance') {
        state = recordGenerationStage(state, {
          stage, input: { request: input.request, priorCheckpointHashes: checkpoints }, output: draft.output, status: 'passed',
          metrics: { completeness: draft.completeness, confidence: draft.confidence, evidenceRefs: draft.evidenceRefs.length },
          affectedPartIds: draft.affectedPartIds,
        });
        outputs[stage] = draft.output;
        draft.evidenceRefs.forEach(ref => immutableEvidence.add(ref));
        break;
      }
      if (decision.disposition === 'refine_same_stage') {
        state = recordGenerationStage(state, {
          stage, input: { request: input.request, priorCheckpointHashes: checkpoints, attempt }, output: draft.output,
          status: 'failed', errorCodes: ['REFINEMENT_INCOMPLETE'], unresolved: decision.reasons,
          affectedPartIds: draft.affectedPartIds,
          metrics: { completeness: draft.completeness, confidence: draft.confidence, evidenceRefs: draft.evidenceRefs.length },
        });
        feedback = decision.reasons;
        continue;
      }
      state = recordGenerationStage(state, {
        stage, input: { request: input.request, priorCheckpointHashes: checkpoints }, output: draft.output,
        status: decision.disposition === 'stop' ? 'failed' : 'blocked',
        errorCodes: [decision.disposition === 'request_input' ? 'AUTHORITATIVE_INPUT_REQUIRED' : decision.disposition === 'manual_review' ? 'DESIGN_CONFLICT' : 'REFINEMENT_EXHAUSTED'],
        unresolved: decision.reasons, affectedPartIds: draft.affectedPartIds,
        metrics: { completeness: draft.completeness, confidence: draft.confidence, evidenceRefs: draft.evidenceRefs.length },
      });
      return { status: decision.disposition === 'request_input' ? 'needs_input' : decision.disposition === 'manual_review' ? 'manual_review' : 'stopped', state, outputs, stoppedAt: stage, reasons: decision.reasons };
    }
    if (state.stages[stage].status !== 'passed') return { status: 'stopped', state, outputs, stoppedAt: stage, reasons: ['Stage did not reach an accepted checkpoint.'] };
  }
  return { status: 'ready_for_geometry', state, outputs, stoppedAt: 'part_programs', reasons: [] };
}
