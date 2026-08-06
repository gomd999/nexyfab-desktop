import { createHash } from 'node:crypto';

export const GENERATION_STAGES = ['intent', 'decomposition', 'interfaces', 'part_programs', 'kernel', 'topology', 'assembly_solve', 'motion', 'manufacturing', 'roundtrip', 'release'] as const;
export type GenerationRunStage = typeof GENERATION_STAGES[number];
export type GenerationRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'not_run' | 'blocked';
export interface GenerationStageRecord {
  stage: GenerationRunStage; status: GenerationRunStatus; inputHash?: string; outputHash?: string; checkpointHash?: string;
  attempt: number; failureFingerprint?: string; errorCodes: string[]; warnings: string[]; unresolved: string[]; metrics: Record<string, number>;
  affectedPartIds: string[]; startedAt?: string; completedAt?: string;
}
export interface GenerationRunState {
  schema: 'nexyfab.generation-run.v1'; runId: string; revision: number; stages: Record<GenerationRunStage, GenerationStageRecord>;
  verifiedPartArtifacts: Record<string, { artifactHash: string; verifiedAtStage: GenerationRunStage }>;
}
export interface StageCompletion {
  stage: GenerationRunStage; input: unknown; output?: unknown; status: 'passed' | 'failed' | 'not_run' | 'blocked'; errorCodes?: string[];
  warnings?: string[]; unresolved?: string[]; metrics?: Record<string, number>; affectedPartIds?: string[]; timestamp?: string;
}
export interface StageRecoveryPlan {
  action: 'retry_stage' | 'request_input' | 'manual_review' | 'stop'; stage: GenerationRunStage; retryPartIds: string[]; preservePartIds: string[]; reason: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export const generationArtifactHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const blankStage = (stage: GenerationRunStage): GenerationStageRecord => ({ stage, status: 'pending', attempt: 0, errorCodes: [], warnings: [], unresolved: [], metrics: {}, affectedPartIds: [] });
export function createGenerationRun(runId: string): GenerationRunState {
  if (!runId.trim()) throw new Error('runId is required.');
  return { schema: 'nexyfab.generation-run.v1', runId, revision: 0, stages: Object.fromEntries(GENERATION_STAGES.map(stage => [stage, blankStage(stage)])) as Record<GenerationRunStage, GenerationStageRecord>, verifiedPartArtifacts: {} };
}
const indexOf = (stage: GenerationRunStage) => GENERATION_STAGES.indexOf(stage);
function priorPassed(state: GenerationRunState, stage: GenerationRunStage): boolean { const index = indexOf(stage); return index === 0 || state.stages[GENERATION_STAGES[index - 1]!]!.status === 'passed'; }

/** Records one immutable stage result and invalidates only its downstream evidence when input changes. */
export function recordGenerationStage(state: GenerationRunState, completion: StageCompletion): GenerationRunState {
  const next = structuredClone(state), current = next.stages[completion.stage], inputHash = generationArtifactHash(completion.input), outputHash = completion.output === undefined ? undefined : generationArtifactHash(completion.output);
  if (!priorPassed(next, completion.stage)) throw new Error(`Previous stage has not passed for ${completion.stage}.`);
  const inputChanged = current.inputHash !== undefined && current.inputHash !== inputHash;
  if (inputChanged) for (const downstream of GENERATION_STAGES.slice(indexOf(completion.stage) + 1)) next.stages[downstream] = { ...blankStage(downstream), status: 'not_run' };
  const errorCodes = [...new Set(completion.errorCodes ?? [])], unresolved = completion.unresolved ?? [], timestamp = completion.timestamp ?? new Date().toISOString();
  const failureFingerprint = completion.status === 'passed' ? undefined : generationArtifactHash({ stage: completion.stage, inputHash, errorCodes, unresolved, affectedPartIds: completion.affectedPartIds ?? [] });
  next.stages[completion.stage] = { stage: completion.stage, status: completion.status, inputHash, outputHash, checkpointHash: completion.status === 'passed' && outputHash ? generationArtifactHash({ stage: completion.stage, inputHash, outputHash }) : undefined, attempt: current.attempt + 1, failureFingerprint, errorCodes, warnings: completion.warnings ?? [], unresolved, metrics: completion.metrics ?? {}, affectedPartIds: [...new Set(completion.affectedPartIds ?? [])], startedAt: current.startedAt ?? timestamp, completedAt: timestamp };
  next.revision++;
  return next;
}

export function cacheVerifiedPartArtifact(state: GenerationRunState, partId: string, artifact: unknown, stage: GenerationRunStage = 'manufacturing'): GenerationRunState {
  if (!partId.trim() || state.stages[stage].status !== 'passed') throw new Error('Part artifacts can only be cached after the governing stage passes.');
  const next = structuredClone(state); next.verifiedPartArtifacts[partId] = { artifactHash: generationArtifactHash(artifact), verifiedAtStage: stage }; next.revision++; return next;
}

export function invalidateGenerationFrom(state: GenerationRunState, stage: GenerationRunStage, affectedPartIds: readonly string[] = []): GenerationRunState {
  const next = structuredClone(state);
  for (const invalidated of GENERATION_STAGES.slice(indexOf(stage))) next.stages[invalidated] = { ...blankStage(invalidated), status: 'not_run', affectedPartIds: [...new Set(affectedPartIds)] };
  affectedPartIds.forEach(id => { delete next.verifiedPartArtifacts[id]; }); next.revision++; return next;
}

type EditTransactionLike = { operations: Array<{ kind: string }>; affected: { parts: string[] } };
/** Selection/chat edits invalidate the minimum downstream pipeline slice and only evict edited-part caches. */
export function invalidateGenerationForEdit(state: GenerationRunState, transaction: EditTransactionLike): GenerationRunState {
  const kinds = new Set(transaction.operations.map(operation => operation.kind));
  const stage: GenerationRunStage = kinds.has('set_part_suppressed') ? 'decomposition'
    : [...kinds].some(kind => ['transform_part', 'set_mate_parameter', 'add_mate', 'remove_mate'].includes(kind)) ? 'assembly_solve' : 'kernel';
  return invalidateGenerationFrom(state, stage, transaction.affected.parts);
}

/** Identical failures never repeat indefinitely; verified unrelated parts remain reusable. */
export function planGenerationStageRecovery(state: GenerationRunState, stage: GenerationRunStage, previousFingerprints: readonly string[], maxAttempts = 3): StageRecoveryPlan {
  const record = state.stages[stage], fingerprint = record.failureFingerprint, repeats = fingerprint ? previousFingerprints.filter(item => item === fingerprint).length : 0;
  const retryPartIds = record.affectedPartIds, preservePartIds = Object.keys(state.verifiedPartArtifacts).filter(id => !retryPartIds.includes(id));
  if (record.status === 'passed') return { action: 'stop', stage, retryPartIds: [], preservePartIds, reason: 'Stage already passed.' };
  if (record.attempt >= maxAttempts || repeats >= maxAttempts - 1) return { action: 'stop', stage, retryPartIds: [], preservePartIds, reason: 'Repeated identical failure; restore the last verified checkpoint.' };
  if (record.unresolved.length || stage === 'intent') return { action: 'request_input', stage, retryPartIds: [], preservePartIds, reason: 'Authoritative design input is required.' };
  if (stage === 'interfaces' || stage === 'assembly_solve') return { action: 'manual_review', stage, retryPartIds, preservePartIds, reason: 'Automatic repair could change interface or assembly intent.' };
  return { action: 'retry_stage', stage, retryPartIds, preservePartIds, reason: retryPartIds.length ? 'Retry only affected parts and reuse verified artifacts.' : 'Retry only this failed stage from its upstream checkpoint.' };
}

export function lastVerifiedCheckpoint(state: GenerationRunState): { stage: GenerationRunStage; checkpointHash: string } | undefined {
  for (let i = GENERATION_STAGES.length - 1; i >= 0; i--) { const record = state.stages[GENERATION_STAGES[i]!]; if (record.status === 'passed' && record.checkpointHash) return { stage: record.stage, checkpointHash: record.checkpointHash }; }
  return undefined;
}
