export const GENERATION_STAGES = ['intent', 'decomposition', 'interfaces', 'part_programs', 'kernel', 'topology', 'assembly_solve', 'motion', 'manufacturing', 'roundtrip', 'release'] as const;
export type GenerationRunStage = typeof GENERATION_STAGES[number];
export type GenerationRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'not_run' | 'blocked';
export interface GenerationStageRecord {
  stage: GenerationRunStage; status: GenerationRunStatus; inputHash?: string; outputHash?: string; checkpointHash?: string;
  attempt: number; failureFingerprint?: string; errorCodes: string[]; warnings: string[]; unresolved: string[]; metrics: Record<string, number>;
  affectedPartIds: string[]; startedAt?: string; completedAt?: string;
}
export interface GenerationRunState {
  schema: 'nexyfab.generation-run.v1'; runId: string; revision: number; projectId?: string; stages: Record<GenerationRunStage, GenerationStageRecord>;
  verifiedPartArtifacts: Record<string, { artifactHash: string; verifiedAtStage: GenerationRunStage }>;
  /** Server-owned accepted payloads used to reconstruct later AI context; client copies are ignored. */
  checkpointInputs?: Partial<Record<GenerationRunStage, unknown>>;
  checkpointOutputs?: Partial<Record<GenerationRunStage, unknown>>;
  /** Server-only OCCT topology baseline used to build the next rebind lineage.
   * Browser copies are never accepted as an evidence source; route handlers
   * load and CAS the authoritative state before reading this field. */
  serverTopologyHistory?: unknown;
  /** Server-computed SHA-256 bindings. Browser fingerprints are never release evidence. */
  evidenceBindings?: { intentSnapshotSha256?: string; intentBoundAtRevision?: number; programSha256?: string; programBoundAtRevision?: number };
  /** Server-persisted commercial success bindings. These are never accepted
   * from a browser and are written only after final receipt verification. */
  commercialHashes?: { generationProgramSha256: string; targetSha256: string; receiptSha256: string; artifactManifestSha256: string; parserReceiptSha256: string; executionJournalSha256: string; persistenceReceiptSha256: string; verificationReceiptSha256: string; finalEnvelopeSha256?: string };
  /**
   * Server-owned advance requests.  The request body is never trusted to
   * populate this ledger; the advance route appends an entry only after the
   * state CAS succeeds.  Keeping a bounded ledger in the current state lets
   * the Redis/memory store and the commercial revision store share the same
   * replay semantics without inventing a second persistence authority.
   */
  advanceReplays?: GenerationAdvanceReplay[];
}

export interface GenerationAdvanceReplay {
  idempotencyKey: string;
  requestSha256: string;
  baseRevision: number;
  resultRevision: number;
  stoppedAt: GenerationRunStage | 'complete';
  commercialReleaseReady: boolean;
  /** Preview-local topology is never commercial evidence. */
  topologyEvidenceSource?: 'server-checkpoint' | 'preview-local';
  /** Response details are server-derived; they make a replay byte-for-byte
   * equivalent even when a failed assembly stage intentionally has no
   * checkpoint output. */
  assemblyVerification?: unknown;
  commercialReceiptVerification?: unknown;
}

export const MAX_GENERATION_ADVANCE_REPLAYS = 32;
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
/**
 * Synchronous browser-safe fingerprint for generation state.
 * This is intentionally not a security primitive; it only detects state
 * changes in the client pipeline. Four independent FNV-1a lanes preserve the
 * existing 64-hex-character artifact-hash contract without node:crypto.
 */
export const generationArtifactHash = (value: unknown): string => {
  const input = canonical(value);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x165667b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0xdeadbeef, 0x31415926];
  const primes = seeds.map(() => 0x01000193);
  const lanes = seeds.map((seed, lane) => {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      hash = Math.imul(hash ^ ((code + lane + (code >>> 8)) & 0xff), primes[lane]!) >>> 0;
      hash = Math.imul(hash ^ ((code >>> 8) + lane), primes[lane]!) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  return lanes.join('');
};
const blankStage = (stage: GenerationRunStage): GenerationStageRecord => ({ stage, status: 'pending', attempt: 0, errorCodes: [], warnings: [], unresolved: [], metrics: {}, affectedPartIds: [] });
export function createGenerationRun(runId: string, projectId?: string): GenerationRunState {
  if (!runId.trim()) throw new Error('runId is required.');
  return { schema: 'nexyfab.generation-run.v1', runId, revision: 0, ...(projectId?.trim() ? { projectId: projectId.trim() } : {}), stages: Object.fromEntries(GENERATION_STAGES.map(stage => [stage, blankStage(stage)])) as Record<GenerationRunStage, GenerationStageRecord>, verifiedPartArtifacts: {}, checkpointInputs: {}, checkpointOutputs: {}, evidenceBindings: {}, advanceReplays: [] };
}
const indexOf = (stage: GenerationRunStage) => GENERATION_STAGES.indexOf(stage);
function priorPassed(state: GenerationRunState, stage: GenerationRunStage): boolean { const index = indexOf(stage); return index === 0 || state.stages[GENERATION_STAGES[index - 1]!]!.status === 'passed'; }

/** Records one immutable stage result and invalidates only its downstream evidence when input changes. */
export function recordGenerationStage(state: GenerationRunState, completion: StageCompletion): GenerationRunState {
  const next = structuredClone(state), current = next.stages[completion.stage], inputHash = generationArtifactHash(completion.input), outputHash = completion.output === undefined ? undefined : generationArtifactHash(completion.output);
  if (!priorPassed(next, completion.stage)) throw new Error(`Previous stage has not passed for ${completion.stage}.`);
  const inputChanged = current.inputHash !== undefined && current.inputHash !== inputHash;
  if (inputChanged) for (const downstream of GENERATION_STAGES.slice(indexOf(completion.stage) + 1)) {
    next.stages[downstream] = { ...blankStage(downstream), status: 'not_run' };
    if (next.checkpointInputs) delete next.checkpointInputs[downstream];
    if (next.checkpointOutputs) delete next.checkpointOutputs[downstream];
  }
  if (inputChanged && indexOf(completion.stage) <= indexOf('part_programs')) next.evidenceBindings = {};
  if (inputChanged && indexOf(completion.stage) <= indexOf('topology')) next.serverTopologyHistory = undefined;
  if (inputChanged) next.advanceReplays = [];
  const errorCodes = [...new Set(completion.errorCodes ?? [])], unresolved = completion.unresolved ?? [], timestamp = completion.timestamp ?? new Date().toISOString();
  const failureFingerprint = completion.status === 'passed' ? undefined : generationArtifactHash({ stage: completion.stage, inputHash, errorCodes, unresolved, affectedPartIds: completion.affectedPartIds ?? [] });
  next.stages[completion.stage] = { stage: completion.stage, status: completion.status, inputHash, outputHash, checkpointHash: completion.status === 'passed' && outputHash ? generationArtifactHash({ stage: completion.stage, inputHash, outputHash }) : undefined, attempt: current.attempt + 1, failureFingerprint, errorCodes, warnings: completion.warnings ?? [], unresolved, metrics: completion.metrics ?? {}, affectedPartIds: [...new Set(completion.affectedPartIds ?? [])], startedAt: current.startedAt ?? timestamp, completedAt: timestamp };
  if (completion.status === 'passed') {
    next.checkpointInputs = { ...next.checkpointInputs, [completion.stage]: structuredClone(completion.input) };
    if (completion.output !== undefined) next.checkpointOutputs = { ...next.checkpointOutputs, [completion.stage]: structuredClone(completion.output) };
  }
  next.revision++;
  return next;
}

export function cacheVerifiedPartArtifact(state: GenerationRunState, partId: string, artifact: unknown, stage: GenerationRunStage = 'manufacturing'): GenerationRunState {
  if (!partId.trim() || state.stages[stage].status !== 'passed') throw new Error('Part artifacts can only be cached after the governing stage passes.');
  const next = structuredClone(state); next.verifiedPartArtifacts[partId] = { artifactHash: generationArtifactHash(artifact), verifiedAtStage: stage }; next.revision++; return next;
}

export function invalidateGenerationFrom(state: GenerationRunState, stage: GenerationRunStage, affectedPartIds: readonly string[] = []): GenerationRunState {
  const next = structuredClone(state);
  for (const invalidated of GENERATION_STAGES.slice(indexOf(stage))) {
    next.stages[invalidated] = { ...blankStage(invalidated), status: 'not_run', affectedPartIds: [...new Set(affectedPartIds)] };
    if (next.checkpointInputs) delete next.checkpointInputs[invalidated];
    if (next.checkpointOutputs) delete next.checkpointOutputs[invalidated];
  }
  if (indexOf(stage) <= indexOf('topology')) next.serverTopologyHistory = undefined;
  affectedPartIds.forEach(id => { delete next.verifiedPartArtifacts[id]; });
  next.advanceReplays = [];
  next.revision++;
  return next;
}

type EditTransactionLike = { operations: Array<{ kind: string }>; affected: { parts: string[] } };
/** Selection/chat edits invalidate the minimum downstream pipeline slice and only evict edited-part caches. */
export function invalidateGenerationForEdit(state: GenerationRunState, transaction: EditTransactionLike): GenerationRunState {
  const kinds = new Set(transaction.operations.map(operation => operation.kind));
  const stage: GenerationRunStage = kinds.has('set_part_suppressed') ? 'decomposition'
    : [...kinds].some(kind => ['transform_part', 'set_mate_parameter', 'add_mate', 'remove_mate'].includes(kind)) ? 'assembly_solve' : 'kernel';
  const next = invalidateGenerationFrom(state, stage, transaction.affected.parts);
  next.evidenceBindings = {};
  return next;
}

/** Bind the exact AI assembly program used by the first kernel run. */
export function bindGenerationProgram(state: GenerationRunState, programSha256: string): GenerationRunState {
  if (!/^[a-f0-9]{64}$/.test(programSha256)) throw new Error('GENERATION_PROGRAM_HASH_INVALID');
  const existing = state.evidenceBindings?.programSha256;
  if (existing && existing !== programSha256) throw new Error('GENERATION_PROGRAM_BINDING_MISMATCH');
  if (existing === programSha256) return state;
  const next = structuredClone(state);
  next.evidenceBindings = { ...next.evidenceBindings, programSha256, programBoundAtRevision: state.revision };
  next.revision++;
  return next;
}

export function bindGenerationIntentSnapshot(state: GenerationRunState, intentSnapshotSha256: string): GenerationRunState {
  if (!/^[a-f0-9]{64}$/.test(intentSnapshotSha256)) throw new Error('GENERATION_INTENT_HASH_INVALID');
  const existing = state.evidenceBindings?.intentSnapshotSha256;
  if (existing && existing !== intentSnapshotSha256) throw new Error('GENERATION_INTENT_BINDING_MISMATCH');
  if (existing === intentSnapshotSha256) return state;
  const next = structuredClone(state);
  next.evidenceBindings = { ...next.evidenceBindings, intentSnapshotSha256, intentBoundAtRevision: state.revision };
  next.revision++;
  return next;
}

/** Find a server-recorded advance by its scoped idempotency key. */
export function findGenerationAdvanceReplay(state: GenerationRunState, idempotencyKey: string): GenerationAdvanceReplay | undefined {
  return state.advanceReplays?.find(item => item.idempotencyKey === idempotencyKey);
}

/**
 * Append the result of a successfully committed advance.  This is deliberately
 * a state transition so it is covered by the same compare-and-swap as the
 * generation stages; a replay therefore cannot create another revision.
 */
export function recordGenerationAdvanceReplay(state: GenerationRunState, replay: GenerationAdvanceReplay): GenerationRunState {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(replay.idempotencyKey)) throw new Error('GENERATION_IDEMPOTENCY_KEY_INVALID');
  if (!/^[a-f0-9]{64}$/.test(replay.requestSha256) || !Number.isSafeInteger(replay.baseRevision) || replay.baseRevision < 0 || !Number.isSafeInteger(replay.resultRevision) || replay.resultRevision <= replay.baseRevision || replay.resultRevision !== state.revision + 1 || typeof replay.commercialReleaseReady !== 'boolean' || (replay.topologyEvidenceSource !== undefined && replay.topologyEvidenceSource !== 'server-checkpoint' && replay.topologyEvidenceSource !== 'preview-local')) throw new Error('GENERATION_ADVANCE_REPLAY_INVALID');
  if (!GENERATION_STAGES.includes(replay.stoppedAt as GenerationRunStage) && replay.stoppedAt !== 'complete') throw new Error('GENERATION_ADVANCE_REPLAY_STAGE_INVALID');
  const existing = findGenerationAdvanceReplay(state, replay.idempotencyKey);
  if (existing) {
    if (existing.requestSha256 !== replay.requestSha256 || existing.baseRevision !== replay.baseRevision || existing.resultRevision !== replay.resultRevision || existing.stoppedAt !== replay.stoppedAt || existing.commercialReleaseReady !== replay.commercialReleaseReady || existing.topologyEvidenceSource !== replay.topologyEvidenceSource || serverReplayValueHash(existing.assemblyVerification) !== serverReplayValueHash(replay.assemblyVerification) || serverReplayValueHash(existing.commercialReceiptVerification) !== serverReplayValueHash(replay.commercialReceiptVerification)) throw new Error('GENERATION_ADVANCE_IDEMPOTENCY_CONFLICT');
    return state;
  }
  const next = structuredClone(state);
  next.advanceReplays = [...(next.advanceReplays ?? []), structuredClone(replay)].slice(-MAX_GENERATION_ADVANCE_REPLAYS);
  next.revision++;
  return next;
}

function serverReplayValueHash(value: unknown): string {
  if (value === undefined) return 'undefined';
  try { return generationArtifactHash(value); } catch { return 'invalid'; }
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
