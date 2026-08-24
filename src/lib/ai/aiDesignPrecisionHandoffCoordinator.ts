import 'server-only';

import type { DbAdapter } from '@/lib/db-adapter';
import { resolveMechanicalStableReferences } from '@/lib/cad/mechanicalStableReferenceBinding';
import type { AiDesignPrecisionCadHandoffV1 } from './aiDesignChatActionCommandAdapterV1';
import { aiDesignComplexWorkspaceStore, type AiDesignComplexWorkspaceStore } from './aiDesignComplexWorkspaceStore';
import {
  executeAiDesignComplexWorkspaceCommand,
  type AiDesignComplexWorkspaceServiceResult,
} from './aiDesignComplexWorkspaceService';
import {
  createAiPrecisionBridgeJob,
  PostgresAiPrecisionBridgeJobStore,
  type AiPrecisionBridgeOutboxRecord,
} from './aiDesignPrecisionBridgeJobStore';
import { aiDesignOwnerKeySha256 } from './aiDesignPostgresAuthority';
import {
  aiDesignServerRuntimeArtifacts,
  type AiDesignComplexArtifactRepository,
  type AiDesignServerEvidenceReceiptSink,
} from './aiDesignServerRuntimeArtifacts';
import { executeAiDesignWorkspaceClientCommand } from './aiDesignWorkspaceActionService';
import { parseAiDesignWorkspaceClientCommandV2 } from './aiDesignWorkspaceCommandV2';
import {
  aiDesignWorkspaceCommandV3Digest,
  parseAiDesignWorkspaceClientCommandV3,
} from './aiDesignWorkspaceCommandV3';
import { loadServerAiDesignWorkspaceRuntime } from './aiDesignWorkspaceRuntimeStore';
import { serverEvidenceSha256 } from './serverEvidence';

export type AiDesignPrecisionHandoffCoordinatorResult =
  | {
      ok: true;
      replayed: boolean;
      record: AiPrecisionBridgeOutboxRecord;
      precisionRequestId: string;
      runtimeRevision: number;
      complexRevision: number;
    }
  | { ok: false; code: string; issues?: readonly string[] };

interface EnqueueStore {
  enqueue: PostgresAiPrecisionBridgeJobStore['enqueue'];
  readByHandoff: PostgresAiPrecisionBridgeJobStore['readByHandoff'];
}

export interface AiDesignPrecisionHandoffCoordinatorDependencies {
  db: DbAdapter;
  store?: AiDesignComplexWorkspaceStore;
  artifacts?: AiDesignComplexArtifactRepository & AiDesignServerEvidenceReceiptSink;
  jobs?: EnqueueStore;
  now?: () => Date;
}

function reject(code: string, issues?: readonly string[]): AiDesignPrecisionHandoffCoordinatorResult {
  return { ok: false, code, ...(issues?.length ? { issues } : {}) };
}

function complexFailure(result: AiDesignComplexWorkspaceServiceResult): AiDesignPrecisionHandoffCoordinatorResult {
  return result.ok ? reject('AI_PRECISION_COMPLEX_RESULT_INVALID') : reject(result.code, result.issues);
}

/**
 * Server-only coordinator for the unchanged browser handoff V1. It resolves
 * every authority-owned field, creates the signed-bound AI verification
 * request, then transactionally appends a durable execution job.
 */
export async function enqueueAiDesignPrecisionHandoff(input: {
  ownerKey: string;
  authenticatedPlan: string;
  handoff: AiDesignPrecisionCadHandoffV1;
  signingSecret: string;
}, dependencies: AiDesignPrecisionHandoffCoordinatorDependencies): Promise<AiDesignPrecisionHandoffCoordinatorResult> {
  const now = dependencies.now?.() ?? new Date();
  const store = dependencies.store ?? aiDesignComplexWorkspaceStore;
  const artifacts = dependencies.artifacts ?? aiDesignServerRuntimeArtifacts;
  const jobs = dependencies.jobs ?? new PostgresAiPrecisionBridgeJobStore(dependencies.db);
  const ownerKeySha256 = aiDesignOwnerKeySha256(input.ownerKey);
  const existing = await jobs.readByHandoff({
    ownerKeySha256,
    projectId: input.handoff.projectId,
    sessionId: input.handoff.sessionId,
    handoffRequestId: input.handoff.requestId,
  });
  if (existing) {
    return existing.job.handoffSha256 === serverEvidenceSha256(input.handoff)
      ? {
          ok: true, replayed: true, record: existing,
          precisionRequestId: existing.job.precisionRequestId,
          runtimeRevision: existing.job.runtimeRevision,
          complexRevision: existing.job.complexRevision,
        }
      : reject('AI_PRECISION_HANDOFF_REPLAY_CONFLICT');
  }

  const runtime = await loadServerAiDesignWorkspaceRuntime(
    input.ownerKey, input.handoff.projectId, input.handoff.sessionId,
  );
  if (runtime.projectId !== input.handoff.projectId
    || runtime.session.sessionId !== input.handoff.sessionId
    || runtime.selectedCandidateId !== input.handoff.candidateId
    || runtime.revisionToken !== runtime.candidates?.baseRevision) {
    return reject('AI_DESIGN_PRECISION_HANDOFF_MISMATCH');
  }
  const runtimeCommandAlreadyApplied = runtime.session.eventIds.includes(input.handoff.requestId)
    || runtime.session.eventIds.includes(`${input.handoff.requestId}:retry`);
  if (!runtimeCommandAlreadyApplied && runtime.runtimeRevision !== input.handoff.expectedRuntimeRevision) {
    return reject('AI_DESIGN_WORKSPACE_REVISION_CONFLICT');
  }

  let aggregate = await store.loadOrCreate({
    ownerKey: input.ownerKey,
    projectId: input.handoff.projectId,
    sessionId: input.handoff.sessionId,
    runtimeRevision: runtime.runtimeRevision,
    now: now.toISOString(),
  });
  const handoffSha256 = serverEvidenceSha256(input.handoff);
  const verificationCommandId = `precision-command:${handoffSha256.slice(0, 48)}`;
  const complexCommandAlreadyApplied = aggregate.appliedCommands.some(
    command => command.commandId === verificationCommandId,
  );
  if (!complexCommandAlreadyApplied && aggregate.complexRevision !== input.handoff.expectedComplexRevision) {
    return reject('AI_DESIGN_COMPLEX_REVISION_CONFLICT');
  }

  const candidates = await artifacts.listCandidateArtifacts({
    projectId: input.handoff.projectId,
    sessionId: input.handoff.sessionId,
  });
  const candidate = candidates.find(item => item.candidateId === input.handoff.candidateId && item.status === 'published');
  if (!candidate || candidate.baseRevision !== runtime.revisionToken
    || candidate.dependencies.featureIds.length === 0) return reject('AI_PRECISION_CANDIDATE_ARTIFACT_REQUIRED');

  const structureArtifact = aggregate.productStructure
    ? await artifacts.getProductStructureSidecar(aggregate.productStructure.artifactId)
    : null;
  if (!structureArtifact || structureArtifact.artifactDigest !== aggregate.productStructure?.artifactDigest) {
    return reject('AI_DESIGN_COMPLEX_STRUCTURE_REQUIRED');
  }
  const candidateSourceDigests = new Set([
    candidate.manifestDigest, candidate.designDigest, candidate.contentDigest,
  ]);
  const structureNodeIds = structureArtifact.graph.nodes
    .filter(node => node.kind === 'component' && node.sourceDigest
      && candidateSourceDigests.has(node.sourceDigest))
    .map(node => node.nodeId)
    .sort();
  if (structureNodeIds.length === 0) return reject('AI_PRECISION_STRUCTURE_REBIND_REQUIRED');

  const stable = await resolveMechanicalStableReferences(dependencies.db, {
    projectId: input.handoff.projectId,
    baseRevisionId: candidate.baseRevision,
    baseContentSha256: runtime.checkpoint.projectContentHash,
    stableFeatureIds: candidate.dependencies.featureIds,
  });
  if (!stable.ok) return reject(`AI_PRECISION_${stable.code}`, stable.blockers);

  const runtimeCommand = parseAiDesignWorkspaceClientCommandV2({
    schema: 'nexyfab.ai-design-workspace-command.v2',
    commandId: input.handoff.requestId,
    projectId: input.handoff.projectId,
    sessionId: input.handoff.sessionId,
    expectedRuntimeRevision: input.handoff.expectedRuntimeRevision,
    issuedAt: now.toISOString(),
    type: 'REQUEST_PRECISION',
    payload: {},
  });
  if (!runtimeCommand.ok) return reject('AI_DESIGN_PRECISION_COMMAND_INVALID', runtimeCommand.issues);
  const runtimeResult = await executeAiDesignWorkspaceClientCommand(
    input.ownerKey,
    input.authenticatedPlan,
    runtimeCommand.command,
    { receiptSink: artifacts, signingSecret: input.signingSecret, now: () => now },
  );
  if (!runtimeResult.ok) return reject(runtimeResult.code, runtimeResult.issues);

  const complexCommand = parseAiDesignWorkspaceClientCommandV3({
    schema: 'nexyfab.ai-design-workspace-command.v3',
    commandId: verificationCommandId,
    projectId: input.handoff.projectId,
    sessionId: input.handoff.sessionId,
    expectedRuntimeRevision: runtimeResult.state.runtimeRevision,
    expectedComplexRevision: input.handoff.expectedComplexRevision,
    issuedAt: now.toISOString(),
    type: 'REQUEST_PRECISION_VERIFICATION',
    payload: { structureNodeIds, interfaceIds: [], partitionIds: [], gaugeIds: [] },
  });
  if (!complexCommand.ok) return reject('AI_DESIGN_PRECISION_VERIFICATION_COMMAND_INVALID', complexCommand.issues);
  const complexResult = await executeAiDesignComplexWorkspaceCommand(
    input.ownerKey,
    complexCommand.command,
    { store, artifacts, signingSecret: input.signingSecret, now: () => now },
  );
  if (!complexResult.ok) return complexFailure(complexResult);
  aggregate = complexResult.aggregate;
  const precisionRequestId = `precision-request:${aiDesignWorkspaceCommandV3Digest(complexCommand.command).slice(0, 48)}`;
  const precisionRequest = await artifacts.getPrecisionRequest(precisionRequestId);
  if (!precisionRequest || precisionRequest.runtimeRevision !== runtimeResult.state.runtimeRevision
    || precisionRequest.complexRevision !== aggregate.complexRevision) {
    return reject('AI_DESIGN_PRECISION_REQUEST_NOT_FOUND');
  }

  const job = createAiPrecisionBridgeJob({
    ownerKeySha256,
    projectId: input.handoff.projectId,
    sessionId: input.handoff.sessionId,
    candidateId: input.handoff.candidateId,
    handoffRequestId: input.handoff.requestId,
    handoffSha256,
    binding: stable.binding,
    precisionRequestId: precisionRequest.requestId,
    precisionRequestSha256: precisionRequest.requestDigest,
    runtimeRevision: precisionRequest.runtimeRevision,
    complexRevision: precisionRequest.complexRevision,
    queuedAt: now.toISOString(),
  });
  const queued = await jobs.enqueue(job, now.getTime());
  if (!queued.ok) return reject(`AI_PRECISION_BRIDGE_${queued.code}`);
  return {
    ok: true,
    replayed: Boolean(runtimeResult.replayed && complexResult.replayed && queued.replayed),
    record: queued.record,
    precisionRequestId,
    runtimeRevision: precisionRequest.runtimeRevision,
    complexRevision: precisionRequest.complexRevision,
  };
}
