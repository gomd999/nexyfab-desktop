export const COMPLEX_GENERATION_STAGES = ['S0_INPUT', 'S1_REQUIREMENTS', 'S2_ARCHITECTURE', 'S3_PART_DESIGN', 'S4_KERNEL', 'S5_ASSEMBLY', 'S6_MOTION_COLLISION', 'S7_MANUFACTURING_ROUNDTRIP', 'S8_REPAIR'] as const;
export type ComplexGenerationStage = typeof COMPLEX_GENERATION_STAGES[number];
export type ComplexCheckpointStatus = 'pending' | 'in_progress' | 'pass' | 'fail' | 'not_run';
export interface ComplexCheckpointAttempt { attempt: number; status: Exclude<ComplexCheckpointStatus, 'pending' | 'in_progress'>; inputArtifactHashes: string[]; outputArtifactHashes: string[]; reasons: string[]; }
export interface ComplexStageCheckpoint { stage: ComplexGenerationStage; status: ComplexCheckpointStatus; attempts: ComplexCheckpointAttempt[]; activeInputArtifactHashes: string[]; }
export interface ComplexGenerationCheckpointState { schema: 'nexyfab.complex-generation-checkpoint.v1'; runId: string; caseId: string; promptVersion: string; modelRevision: string; kernelRevision: string; lockedIntent: Record<string, string>; stages: ComplexStageCheckpoint[]; currentStage: ComplexGenerationStage | null; releaseReady: boolean; }
const SHA = /^[a-f0-9]{64}$/;
const validHashes = (values: readonly string[]) => values.length > 0 && values.every(value => SHA.test(value));
const indexOf = (stage: ComplexGenerationStage) => COMPLEX_GENERATION_STAGES.indexOf(stage);

export function createComplexGenerationCheckpoint(input: { runId: string; caseId: string; promptVersion: string; modelRevision: string; kernelRevision: string; lockedIntent?: Record<string, string> }): ComplexGenerationCheckpointState {
  if (![input.runId, input.caseId, input.promptVersion, input.modelRevision, input.kernelRevision].every(value => value.trim())) throw new Error('checkpoint_identity_missing');
  if (Object.values(input.lockedIntent ?? {}).some(hash => !SHA.test(hash))) throw new Error('checkpoint_locked_intent_hash_invalid');
  return { schema: 'nexyfab.complex-generation-checkpoint.v1', ...input, lockedIntent: { ...(input.lockedIntent ?? {}) }, stages: COMPLEX_GENERATION_STAGES.map(stage => ({ stage, status: 'pending', attempts: [], activeInputArtifactHashes: [] })), currentStage: null, releaseReady: false };
}
export function startComplexGenerationStage(state: ComplexGenerationCheckpointState, stage: ComplexGenerationStage, inputArtifactHashes: string[]): ComplexGenerationCheckpointState {
  if (!validHashes(inputArtifactHashes)) throw new Error('checkpoint_input_artifacts_invalid');
  const index = indexOf(stage), checkpoint = state.stages[index]!; if (state.currentStage) throw new Error(`checkpoint_stage_already_active:${state.currentStage}`);
  if (index > 0 && state.stages[index - 1]!.status !== 'pass') throw new Error(`checkpoint_previous_stage_not_passed:${state.stages[index - 1]!.stage}`);
  if (checkpoint.status === 'pass') throw new Error(`checkpoint_stage_already_passed:${stage}`);
  const stages = state.stages.map(item => item.stage === stage ? { ...item, status: 'in_progress' as const, activeInputArtifactHashes: [...inputArtifactHashes] } : item);
  return { ...state, stages, currentStage: stage, releaseReady: false };
}
export function finishComplexGenerationStage(state: ComplexGenerationCheckpointState, stage: ComplexGenerationStage, result: { status: 'pass' | 'fail' | 'not_run'; outputArtifactHashes?: string[]; reasons?: string[] }): ComplexGenerationCheckpointState {
  if (state.currentStage !== stage) throw new Error(`checkpoint_stage_not_active:${stage}`); const checkpoint = state.stages[indexOf(stage)]!;
  const outputs = result.outputArtifactHashes ?? [], reasons = result.reasons ?? [];
  if (result.status === 'pass' && !validHashes(outputs)) throw new Error('checkpoint_pass_artifact_required');
  if (result.status !== 'pass' && !reasons.length) throw new Error('checkpoint_block_reason_required');
  const attempt: ComplexCheckpointAttempt = { attempt: checkpoint.attempts.length + 1, status: result.status, inputArtifactHashes: checkpoint.activeInputArtifactHashes, outputArtifactHashes: outputs, reasons };
  const stages = state.stages.map(item => item.stage === stage ? { ...item, status: result.status, attempts: [...item.attempts, attempt], activeInputArtifactHashes: [] } : item);
  const releaseReady = stage === 'S8_REPAIR' && result.status === 'pass' && stages.every(item => item.status === 'pass');
  return { ...state, stages, currentStage: null, releaseReady };
}
export function rollbackComplexGenerationTo(state: ComplexGenerationCheckpointState, stage: ComplexGenerationStage): ComplexGenerationCheckpointState {
  if (state.currentStage) throw new Error(`checkpoint_cannot_rollback_active:${state.currentStage}`); const index = indexOf(stage);
  const stages = state.stages.map((item, itemIndex) => itemIndex < index ? item : { ...item, status: 'pending' as const, activeInputArtifactHashes: [] });
  return { ...state, stages, currentStage: null, releaseReady: false };
}
export function assertLockedIntentUnchanged(state: ComplexGenerationCheckpointState, proposed: Record<string, string>): void {
  for (const [path, hash] of Object.entries(state.lockedIntent)) if (proposed[path] !== hash) throw new Error(`checkpoint_locked_intent_modified:${path}`);
}
