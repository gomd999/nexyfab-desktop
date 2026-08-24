import 'server-only';

import {
  clientCommandToRuntimeAction,
  type AiDesignWorkspaceClientCommandV2,
  type PublicModelSelectionV2,
} from './aiDesignWorkspaceCommandV2';
import {
  dispatchAiDesignWorkspaceAction,
  type AiDesignWorkspaceRuntimeAction,
  type AiDesignWorkspaceRuntimeV1,
} from './aiDesignWorkspaceRuntime';
import {
  loadServerAiDesignWorkspaceRuntime,
  saveServerAiDesignWorkspaceRuntime,
} from './aiDesignWorkspaceRuntimeStore';
import {
  executeCurrentAiDesignGenerationStage,
  type AiDesignGenerationWorker,
} from './aiDesignGenerationOrchestrator';
import {
  issueAiDesignServerEvidenceReceipt,
  type AiDesignServerEvidenceReceiptV1,
} from './aiDesignServerEvidenceReceipt';
import type { AiDesignServerEvidenceReceiptSink } from './aiDesignServerRuntimeArtifacts';
import type { ModelSelectionRequest } from './modelSelectionPolicy';
import { serverEvidenceSha256 } from './serverEvidence';
import { createAiDesignCandidateArtifact, type AiDesignCandidateArtifactV1 } from './aiDesignCandidateArtifact';
import type { AiDesignGeneratedStageArtifactV1 } from './aiDesignServerGenerationWorker';
import type { DesignCandidate } from './designCandidateComparison';
import { assessAiDesignCandidateQuality } from './aiDesignCandidateQuality';

const MAX_COMMAND_AGE_MS = 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;

export interface AiDesignWorkspaceActionServiceDependencies {
  load?: typeof loadServerAiDesignWorkspaceRuntime;
  save?: typeof saveServerAiDesignWorkspaceRuntime;
  receiptSink: AiDesignServerEvidenceReceiptSink;
  signingSecret: string;
  now?: () => Date;
}

export type AiDesignWorkspaceActionServiceResult =
  | { ok: true; state: AiDesignWorkspaceRuntimeV1; replayed: boolean; receipts: readonly AiDesignServerEvidenceReceiptV1[]; generationRequested: boolean }
  | { ok: false; code: string; issues?: readonly string[]; state?: AiDesignWorkspaceRuntimeV1 };

function publicSelection(value: PublicModelSelectionV2, plan: string): ModelSelectionRequest {
  return { ...value, plan } as ModelSelectionRequest;
}

function reject(code: string, state?: AiDesignWorkspaceRuntimeV1, issues?: readonly string[]): AiDesignWorkspaceActionServiceResult {
  return { ok: false, code, ...(issues ? { issues } : {}), ...(state ? { state } : {}) };
}

function commandFresh(command: AiDesignWorkspaceClientCommandV2, now: Date): boolean {
  const issued = Date.parse(command.issuedAt);
  return Number.isFinite(issued) && issued <= now.getTime() + MAX_FUTURE_SKEW_MS && now.getTime() - issued <= MAX_COMMAND_AGE_MS;
}

function directAction(command: AiDesignWorkspaceClientCommandV2, timestamp: string): AiDesignWorkspaceRuntimeAction | null {
  const action = clientCommandToRuntimeAction(command);
  return action ? { ...action, timestamp } : null;
}

function dispatch(state: AiDesignWorkspaceRuntimeV1, action: AiDesignWorkspaceRuntimeAction): AiDesignWorkspaceActionServiceResult | AiDesignWorkspaceRuntimeV1 {
  const result = dispatchAiDesignWorkspaceAction(state, action);
  return result.ok ? result.state : reject('AI_DESIGN_ACTION_REJECTED', result.state, [result.error, ...(result.issues ?? [])]);
}

function alreadyApplied(state: AiDesignWorkspaceRuntimeV1, commandId: string): boolean {
  return state.session.eventIds.includes(commandId) || state.session.eventIds.includes(`${commandId}:retry`);
}

/** Load authoritative state, apply one bounded client command, then CAS-save it. */
export async function executeAiDesignWorkspaceClientCommand(
  ownerKey: string,
  authenticatedPlan: string,
  command: AiDesignWorkspaceClientCommandV2,
  dependencies: AiDesignWorkspaceActionServiceDependencies,
): Promise<AiDesignWorkspaceActionServiceResult> {
  const load = dependencies.load ?? loadServerAiDesignWorkspaceRuntime;
  const save = dependencies.save ?? saveServerAiDesignWorkspaceRuntime;
  const now = dependencies.now?.() ?? new Date();
  if (!commandFresh(command, now)) return reject('AI_DESIGN_COMMAND_EXPIRED');
  const state = await load(ownerKey, command.projectId, command.sessionId);
  if (state.projectId !== command.projectId || state.session.sessionId !== command.sessionId) return reject('AI_DESIGN_COMMAND_SCOPE_MISMATCH');
  if (alreadyApplied(state, command.commandId)) return { ok: true, state, replayed: true, receipts: [], generationRequested: false };
  if (state.runtimeRevision !== command.expectedRuntimeRevision) return reject('AI_DESIGN_WORKSPACE_REVISION_CONFLICT', state);
  const timestamp = now.toISOString();
  let next = state;
  const receipts: AiDesignServerEvidenceReceiptV1[] = [];
  let generationRequested = false;

  if (command.type === 'REQUEST_UNDERSTANDING_CONFIRMATION') {
    if (!command.payload.acknowledged) return reject('AI_DESIGN_UNDERSTANDING_ACK_REQUIRED', state);
    const outputDigest = state.checkpoint.projectContentHash;
    const receipt = issueAiDesignServerEvidenceReceipt({
      projectId: state.projectId, sessionId: state.session.sessionId, commandId: command.commandId,
      checkpointId: state.checkpoint.checkpointId, checkpointDigest: state.checkpoint.projectContentHash,
      runtimeRevision: state.runtimeRevision, generationRevision: null, stage: 'understanding', outcome: 'PASS',
      inputDigest: state.checkpoint.projectContentHash, outputDigest, source: 'ai-design-intent-verifier-v2',
      codes: state.checkpoint.readiness.ready ? ['checkpoint_ready', 'rights_allowed'] : ['checkpoint_needs_input'],
    }, dependencies.signingSecret, now);
    const applied = dispatch(next, {
      type: 'UNDERSTANDING_CONFIRMED', actionId: command.commandId, expectedRevision: next.runtimeRevision,
      missingInput: !state.checkpoint.readiness.ready,
      evidence: { id: receipt.receiptId, kind: 'understanding', checkpointId: state.checkpoint.checkpointId, revision: state.documentRevision, status: 'PASS', digest: outputDigest, source: receipt.receiptId },
      timestamp,
    });
    if ('ok' in applied) return applied;
    next = applied;
    await dependencies.receiptSink.putImmutable(receipt);
    receipts.push(receipt);
  } else if (command.type === 'INGEST_INPUTS') {
    const applied = dispatch(next, { type: 'INGEST_INPUTS', actionId: command.commandId, expectedRevision: next.runtimeRevision, inputs: command.payload.inputs, timestamp });
    if ('ok' in applied) return applied;
    next = applied;
  } else if (command.type === 'START_GENERATION_REQUEST') {
    const applied = dispatch(next, { type: 'START_GENERATION', actionId: command.commandId, expectedRevision: next.runtimeRevision, runId: command.payload.runId, modelSelection: publicSelection(command.payload.modelSelection, authenticatedPlan), timestamp });
    if ('ok' in applied) return applied;
    next = applied;
    generationRequested = true;
  } else if (command.type === 'RETRY_GENERATION_REQUEST') {
    if (command.payload.allowModelFallback) {
      const fallback = dispatch(next, { type: 'FALLBACK_MODEL', actionId: `${command.commandId}:fallback`, expectedRevision: next.runtimeRevision, reason: 'user_requested_governed_fallback', timestamp });
      if ('ok' in fallback) return fallback;
      next = fallback;
    }
    const retried = dispatch(next, { type: 'RETRY_GENERATION', actionId: command.commandId, expectedRevision: next.runtimeRevision, timestamp });
    if ('ok' in retried) return retried;
    next = retried;
    generationRequested = true;
  } else {
    const action = directAction(command, timestamp);
    if (!action) return reject('AI_DESIGN_CLIENT_COMMAND_REQUIRES_SERVER_WORKER', state);
    const applied = dispatch(next, action);
    if ('ok' in applied) return applied;
    next = applied;
  }

  try {
    const saved = await save(ownerKey, next, state.runtimeRevision);
    return { ok: true, state: saved, replayed: false, receipts, generationRequested };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_DESIGN_WORKSPACE_SAVE_FAILED';
    if (code === 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT') return reject(code, state);
    throw error;
  }
}

export interface AdvanceAiDesignGenerationDependencies extends AiDesignWorkspaceActionServiceDependencies {
  worker: AiDesignGenerationWorker;
  timeoutMs?: number;
  loadStageArtifactByOutputDigest?(outputDigest: string): AiDesignGeneratedStageArtifactV1 | null | Promise<AiDesignGeneratedStageArtifactV1 | null>;
  putCandidateArtifactImmutable?(artifact: AiDesignCandidateArtifactV1): Promise<void>;
  evaluatePublishedConcepts?(input: {
    state: AiDesignWorkspaceRuntimeV1;
    candidates: readonly DesignCandidate[];
    artifacts: readonly AiDesignCandidateArtifactV1[];
  }): Promise<readonly { candidateId: string; conceptReviewReady: boolean; status: 'PASS' | 'FAIL' | 'INCOMPLETE' }[]>;
}

function candidatesFromStageArtifact(
  state: AiDesignWorkspaceRuntimeV1,
  artifact: AiDesignGeneratedStageArtifactV1,
  stageReceipt: AiDesignServerEvidenceReceiptV1,
): { candidates: DesignCandidate[]; artifacts: AiDesignCandidateArtifactV1[]; digest: string } {
  const selectedModelId = state.generation?.modelReceipt.selectedModelId;
  if (!selectedModelId || artifact.projectId !== state.projectId || artifact.runId !== state.generation?.runId
    || artifact.checkpointId !== state.checkpoint.checkpointId || artifact.stage !== 'candidate_validation') {
    throw new Error('AI_DESIGN_CANDIDATE_ARTIFACT_BINDING_FAILED');
  }
  const quality = assessAiDesignCandidateQuality(artifact.output.candidateBlueprints);
  if (!quality.conceptPublishable) throw new Error(`AI_DESIGN_CANDIDATE_QUALITY_BLOCKED:${quality.issues.join(',')}`);
  const candidates: DesignCandidate[] = [];
  const artifacts: AiDesignCandidateArtifactV1[] = [];
  for (const blueprint of artifact.output.candidateBlueprints.slice(0, 3)) {
    const designDigest = serverEvidenceSha256(blueprint);
    const artifactId = `candidate-artifact:${serverEvidenceSha256({ runId: artifact.runId, candidateId: blueprint.id, designDigest }).slice(0, 48)}`;
    const manifest = createAiDesignCandidateArtifact({
      trustedServer: true, artifactId, candidateId: blueprint.id, projectId: state.projectId, sessionId: state.session.sessionId,
      baseRevision: state.revisionToken, artifactRevision: 1, status: 'published', createdAt: artifact.createdAt,
      contentDigest: artifact.outputDigest, designDigest,
      dependencies: {
        intentNodeIds: [...new Set(artifact.output.decisions.flatMap(item => item.intentKeys))],
        parameterIds: blueprint.parameterKeys, gaugeIds: [], featureIds: blueprint.featureKeys,
      },
      evidence: [{ evidenceId: stageReceipt.receiptId, kind: 'ai-concept-validation', status: 'unknown', receiptDigest: serverEvidenceSha256(stageReceipt) }],
      server: {
        generatorId: 'ai-design-worker-v2', modelId: selectedModelId, runtimeId: artifact.execution.runtimeModel,
        workerBuildDigest: serverEvidenceSha256({ worker: 'ai-design-worker-v2', outputSchema: artifact.output.schema }), generationRunId: artifact.runId,
      },
      supersedes: null,
    });
    artifacts.push(manifest);
    candidates.push({
      candidateId: blueprint.id, revision: manifest.manifestDigest, baseRevision: state.revisionToken,
      title: blueprint.title, summary: blueprint.summary, modelId: selectedModelId,
      featureIds: blueprint.featureKeys, metrics: [],
      evidence: [{ evidenceId: stageReceipt.receiptId, label: 'AI concept structure check', status: 'unknown', source: stageReceipt.receiptId }],
      provenance: [manifest.artifactId, ...artifact.output.decisions.flatMap(item => item.intentKeys)],
    });
  }
  if (!candidates.length) throw new Error('AI_DESIGN_CANDIDATE_ARTIFACT_EMPTY');
  return { candidates, artifacts, digest: serverEvidenceSha256({ stageArtifactId: artifact.artifactId, manifests: artifacts.map(item => item.manifestDigest) }) };
}

/** Worker/job entrypoint; it is deliberately not callable with browser-supplied PASS data. */
export async function advanceServerAiDesignGeneration(
  ownerKey: string,
  projectId: string,
  sessionId: string,
  dependencies: AdvanceAiDesignGenerationDependencies,
  expectedRuntimeRevision?: number,
): Promise<AiDesignWorkspaceActionServiceResult> {
  const load = dependencies.load ?? loadServerAiDesignWorkspaceRuntime;
  const save = dependencies.save ?? saveServerAiDesignWorkspaceRuntime;
  const state = await load(ownerKey, projectId, sessionId);
  if (expectedRuntimeRevision !== undefined && state.runtimeRevision !== expectedRuntimeRevision) return reject('AI_DESIGN_WORKSPACE_REVISION_CONFLICT', state);
  const generation = state.generation;
  if (!generation || generation.status !== 'RUNNING' || !generation.currentStage) return reject('AI_DESIGN_GENERATION_STAGE_NOT_RUNNING', state);
  const stage = generation.currentStage;
  const stageRecord = generation.stages[stage];
  const now = dependencies.now?.() ?? new Date();
  const workerTransition = await executeCurrentAiDesignGenerationStage(generation, dependencies.worker, { timeoutMs: dependencies.timeoutMs, now: () => now.toISOString() });
  if (!workerTransition.ok) return reject('AI_DESIGN_GENERATION_WORKER_TRANSITION_REJECTED', state, [workerTransition.error]);
  const transitionedRecord = workerTransition.state.stages[stage];
  const passed = transitionedRecord.status === 'PASS' && !!transitionedRecord.outputDigest;
  const workerCommandId = `worker:${generation.runId}:${stage}:${stageRecord.attempt}`;
  const outputDigest = transitionedRecord.outputDigest ?? serverEvidenceSha256({ stage, attempt: stageRecord.attempt, failure: workerTransition.state.failure ?? 'worker_failed' });
  const receipt = issueAiDesignServerEvidenceReceipt({
    projectId, sessionId, commandId: workerCommandId, checkpointId: generation.checkpointId, checkpointDigest: generation.checkpointDigest,
    runtimeRevision: state.runtimeRevision, generationRevision: generation.revision, stage, outcome: passed ? 'PASS' : 'FAIL',
    inputDigest: stageRecord.inputDigest ?? generation.checkpointDigest, outputDigest,
    source: passed ? 'ai-design-worker-v2' : 'ai-design-worker-failure-v2', codes: transitionedRecord.codes,
  }, dependencies.signingSecret, now);
  const action: AiDesignWorkspaceRuntimeAction = passed
    ? { type: 'COMPLETE_GENERATION_STAGE', actionId: workerCommandId, expectedRevision: state.runtimeRevision, stage, outputDigest, source: receipt.receiptId, codes: transitionedRecord.codes, timestamp: now.toISOString() }
    : { type: 'FAIL_GENERATION_STAGE', actionId: workerCommandId, expectedRevision: state.runtimeRevision, stage, reason: workerTransition.state.failure ?? 'generation_worker_failed', retryable: workerTransition.state.status === 'RETRY_WAIT', codes: transitionedRecord.codes, timestamp: now.toISOString() };
  const applied = dispatch(state, action);
  if ('ok' in applied) return applied;
  await dependencies.receiptSink.putImmutable(receipt);
  let next = applied;
  const receipts = [receipt];
  if (passed && next.generation?.status === 'CANDIDATE_READY') {
    if (!dependencies.loadStageArtifactByOutputDigest || !dependencies.putCandidateArtifactImmutable) return reject('AI_DESIGN_CANDIDATE_ARTIFACT_REPOSITORY_REQUIRED', state);
    const stageArtifact = await dependencies.loadStageArtifactByOutputDigest(outputDigest);
    if (!stageArtifact || stageArtifact.outputDigest !== outputDigest) return reject('AI_DESIGN_CANDIDATE_ARTIFACT_NOT_FOUND', state);
    const publication = candidatesFromStageArtifact(next, stageArtifact, receipt);
    for (const candidateArtifact of publication.artifacts) await dependencies.putCandidateArtifactImmutable(candidateArtifact);
    if (dependencies.evaluatePublishedConcepts) {
      const evaluations = await dependencies.evaluatePublishedConcepts({ state: next, candidates: publication.candidates, artifacts: publication.artifacts });
      const byCandidate = new Map(evaluations.map(item => [item.candidateId, item]));
      const blocked = publication.candidates.filter(candidate => byCandidate.get(candidate.candidateId)?.conceptReviewReady !== true);
      if (blocked.length) return reject('AI_DESIGN_CANDIDATE_CRITIC_BLOCKED', state, blocked.map(candidate => `concept_review_not_ready:${candidate.candidateId}`));
    }
    const publicationCommandId = `${workerCommandId}:publish`;
    const publicationReceipt = issueAiDesignServerEvidenceReceipt({
      projectId, sessionId, commandId: publicationCommandId, checkpointId: generation.checkpointId, checkpointDigest: generation.checkpointDigest,
      runtimeRevision: next.runtimeRevision, generationRevision: next.generation.revision, stage: 'candidate_publication', outcome: 'PASS',
      inputDigest: publication.digest, outputDigest: generation.checkpointDigest, source: 'ai-design-candidate-publisher-v2',
      codes: ['candidate_manifest_stored', 'verification_not_run'],
    }, dependencies.signingSecret, now);
    await dependencies.receiptSink.putImmutable(publicationReceipt);
    const published = dispatch(next, {
      type: 'PUBLISH_CANDIDATES', actionId: publicationCommandId, expectedRevision: next.runtimeRevision,
      candidates: publication.candidates,
      evidence: { id: publicationReceipt.receiptId, kind: 'candidate', checkpointId: generation.checkpointId, revision: next.documentRevision, status: 'PASS', digest: generation.checkpointDigest, source: publicationReceipt.receiptId },
      timestamp: now.toISOString(),
    });
    if ('ok' in published) return published;
    next = published;
    receipts.push(publicationReceipt);
  }
  try {
    const saved = await save(ownerKey, next, state.runtimeRevision);
    return { ok: true, state: saved, replayed: false, receipts, generationRequested: passed && next.generation?.status === 'RUNNING' };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_DESIGN_WORKSPACE_SAVE_FAILED';
    if (code === 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT') return reject(code, state);
    throw error;
  }
}
