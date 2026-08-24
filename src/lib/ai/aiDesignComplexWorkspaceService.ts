import 'server-only';

import {
  advanceAiDesignComplexWorkspaceAggregate,
  findAppliedAiDesignComplexCommand,
  type AiDesignComplexArtifactRefV1,
  type AiDesignComplexWorkspaceAggregateV1,
} from './aiDesignComplexWorkspaceAggregate';
import {
  aiDesignComplexWorkspaceStore,
  type AiDesignComplexWorkspaceStore,
} from './aiDesignComplexWorkspaceStore';
import {
  aiDesignWorkspaceCommandV3Digest,
  isAiDesignWorkspaceServerCommandV3,
  resolutionCommandFromWorkspaceCommandV3,
  type AiDesignWorkspaceClientCommandV3,
  type AiDesignWorkspaceServerCommandV3,
} from './aiDesignWorkspaceCommandV3';
import {
  createAiDesignCrossDomainSidecarArtifact,
  createAiDesignProductStructureSidecarArtifact,
} from './aiDesignComplexSidecarArtifact';
import {
  aiDesignGraphPartitionStorageId,
  aiDesignServerRuntimeArtifacts,
  type AiDesignComplexArtifactRepository,
} from './aiDesignServerRuntimeArtifacts';
import { loadServerAiDesignWorkspaceRuntime } from './aiDesignWorkspaceRuntimeStore';
import { createAiDesignIntentResolutionArtifact } from './aiDesignIntentResolution';
import { evaluateAiDesignComplexCandidateSet } from './aiDesignComplexEvaluationService';
import {
  createAiDesignPrecisionVerificationRequest,
  verifyAiDesignPrecisionVerificationReceipt,
  type AiDesignPrecisionScopeV1,
  type AiDesignPrecisionVerificationReceiptV1,
} from './aiDesignPrecisionVerification';
import { createAiDesignComplexWorkspaceViewModel, type AiDesignComplexWorkspaceViewModelV1 } from './aiDesignComplexWorkspaceViewModel';
import type { AiDesignWorkspaceRuntimeV1 } from './aiDesignWorkspaceRuntime';
import type { DesignIntentInputKind } from './designIntentCheckpoint';
import { serverEvidenceSha256 } from './serverEvidence';
import { createAiDesignGraphPartitions } from './aiDesignHierarchicalCandidatePartition';
import {
  createAiDesignConstraintBindingsArtifact,
  createAiDesignGaugeBindingsArtifact,
} from './aiDesignComplexProjectionBindings';

const MAX_COMMAND_AGE_MS = 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;

export interface AiDesignComplexWorkspaceServiceDependencies {
  loadRuntime?: typeof loadServerAiDesignWorkspaceRuntime;
  store?: AiDesignComplexWorkspaceStore;
  artifacts?: AiDesignComplexArtifactRepository;
  signingSecret: string;
  now?: () => Date;
}

export type AiDesignComplexWorkspaceServiceResult =
  | { ok: true; aggregate: AiDesignComplexWorkspaceAggregateV1; replayed: boolean; createdArtifactIds: readonly string[] }
  | { ok: false; code: string; issues?: readonly string[]; aggregate?: AiDesignComplexWorkspaceAggregateV1 };

export interface AiDesignComplexWorkspaceReadModelV4 {
  schema: 'nexyfab.ai-design-complex-workspace-read-model.v4';
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  aggregateDigest: string;
  staleAgainstRuntime: boolean;
  inputKinds: readonly DesignIntentInputKind[];
  workspace: AiDesignComplexWorkspaceViewModelV1;
  precision: {
    status: 'NOT_RUN' | 'PASS' | 'FAIL' | 'STALE';
    requestIds: readonly string[];
    receiptIds: readonly string[];
    manufacturingReleaseReady: false;
  };
  availableActions: readonly AiDesignWorkspaceClientCommandV3['type'][];
}

function reject(code: string, aggregate?: AiDesignComplexWorkspaceAggregateV1, issues?: readonly string[]): AiDesignComplexWorkspaceServiceResult {
  return { ok: false, code, ...(issues ? { issues } : {}), ...(aggregate ? { aggregate } : {}) };
}

function fresh(issuedAt: string, now: Date): boolean {
  const issued = Date.parse(issuedAt);
  return Number.isFinite(issued) && issued <= now.getTime() + MAX_FUTURE_SKEW_MS && now.getTime() - issued <= MAX_COMMAND_AGE_MS;
}

function ref(artifactId: string, artifactDigest: string, contentDigest: string): AiDesignComplexArtifactRefV1 {
  return { artifactId, artifactDigest, contentDigest };
}

function artifactId(prefix: string, commandDigest: string): string {
  return `${prefix}:${commandDigest.slice(0, 48)}`;
}

function assertScope(command: AiDesignWorkspaceClientCommandV3, runtime: AiDesignWorkspaceRuntimeV1): boolean {
  return command.projectId === runtime.projectId && command.sessionId === runtime.session.sessionId;
}

function scopesFromCommand(command: Extract<AiDesignWorkspaceClientCommandV3, { type: 'REQUEST_PRECISION_VERIFICATION' }>): AiDesignPrecisionScopeV1[] {
  return [
    ...command.payload.structureNodeIds.map(id => ({ kind: 'structure_node' as const, id })),
    ...command.payload.interfaceIds.map(id => ({ kind: 'interface' as const, id })),
    ...command.payload.partitionIds.map(id => ({ kind: 'partition' as const, id })),
    ...command.payload.gaugeIds.map(id => ({ kind: 'gauge' as const, id })),
  ];
}

async function resolveSidecars(aggregate: AiDesignComplexWorkspaceAggregateV1, artifacts: AiDesignComplexArtifactRepository) {
  const productArtifact = aggregate.productStructure ? artifacts.getProductStructureSidecar(aggregate.productStructure.artifactId) : null;
  const crossDomainArtifact = aggregate.crossDomainGraph ? artifacts.getCrossDomainSidecar(aggregate.crossDomainGraph.artifactId) : null;
  if (aggregate.productStructure && (!productArtifact || productArtifact.artifactDigest !== aggregate.productStructure.artifactDigest)) throw new Error('AI_DESIGN_COMPLEX_STRUCTURE_ARTIFACT_MISSING');
  if (aggregate.crossDomainGraph && (!crossDomainArtifact || crossDomainArtifact.artifactDigest !== aggregate.crossDomainGraph.artifactDigest)) throw new Error('AI_DESIGN_COMPLEX_CONSTRAINT_ARTIFACT_MISSING');
  const resolutions = aggregate.resolutions.map(item => artifacts.getIntentResolution(item.artifactId));
  if (resolutions.some(item => !item)) throw new Error('AI_DESIGN_COMPLEX_RESOLUTION_ARTIFACT_MISSING');
  const criticBundles = aggregate.criticBundles.map(item => artifacts.getCriticBundle(item.artifactId));
  if (criticBundles.some(item => !item)) throw new Error('AI_DESIGN_COMPLEX_CRITIC_ARTIFACT_MISSING');
  const partitions = aggregate.partitions.map(item => artifacts.getGraphPartition(item.artifactId));
  if (partitions.some((item, index) => !item || item.partitionDigest !== aggregate.partitions[index]!.artifactDigest)) throw new Error('AI_DESIGN_COMPLEX_PARTITION_ARTIFACT_MISSING');
  const gaugeBindingsArtifact = aggregate.gaugeBindings ? artifacts.getGaugeBindings(aggregate.gaugeBindings.artifactId) : null;
  if (aggregate.gaugeBindings && (!gaugeBindingsArtifact || gaugeBindingsArtifact.artifactDigest !== aggregate.gaugeBindings.artifactDigest)) throw new Error('AI_DESIGN_COMPLEX_GAUGE_BINDINGS_MISSING');
  const constraintBindingsArtifact = aggregate.constraintBindings ? artifacts.getConstraintBindings(aggregate.constraintBindings.artifactId) : null;
  if (aggregate.constraintBindings && (!constraintBindingsArtifact || constraintBindingsArtifact.artifactDigest !== aggregate.constraintBindings.artifactDigest)) throw new Error('AI_DESIGN_COMPLEX_CONSTRAINT_BINDINGS_MISSING');
  return {
    productStructure: productArtifact?.graph ?? null,
    crossDomainGraph: crossDomainArtifact?.graph ?? null,
    resolutions: resolutions.filter((item): item is NonNullable<typeof item> => !!item),
    criticBundles: criticBundles.filter((item): item is NonNullable<typeof item> => !!item),
    partitions: partitions.filter((item): item is NonNullable<typeof item> => !!item),
    gaugeBindings: gaugeBindingsArtifact?.bindings ?? [],
    constraintBindings: constraintBindingsArtifact?.bindings ?? [],
  };
}

/** Executes one V3 complex command without allowing the browser to author verification evidence. */
export async function executeAiDesignComplexWorkspaceCommand(
  ownerKey: string,
  command: AiDesignWorkspaceClientCommandV3,
  dependencies: AiDesignComplexWorkspaceServiceDependencies,
): Promise<AiDesignComplexWorkspaceServiceResult> {
  const now = dependencies.now?.() ?? new Date();
  if (!fresh(command.issuedAt, now)) return reject('AI_DESIGN_COMPLEX_COMMAND_EXPIRED');
  const loadRuntime = dependencies.loadRuntime ?? loadServerAiDesignWorkspaceRuntime;
  const store = dependencies.store ?? aiDesignComplexWorkspaceStore;
  const artifacts = dependencies.artifacts ?? aiDesignServerRuntimeArtifacts;
  const runtime = await loadRuntime(ownerKey, command.projectId, command.sessionId);
  if (!assertScope(command, runtime)) return reject('AI_DESIGN_COMPLEX_COMMAND_SCOPE_MISMATCH');
  const aggregate = await store.loadOrCreate({ ownerKey, projectId: command.projectId, sessionId: command.sessionId, runtimeRevision: runtime.runtimeRevision, now: now.toISOString() });
  const commandDigest = aiDesignWorkspaceCommandV3Digest(command);
  const applied = findAppliedAiDesignComplexCommand(aggregate, command.commandId);
  if (applied) return applied.commandDigest === commandDigest
    ? { ok: true, aggregate, replayed: true, createdArtifactIds: [] }
    : reject('AI_DESIGN_COMPLEX_COMMAND_REPLAY_CONFLICT', aggregate);
  if (runtime.runtimeRevision !== command.expectedRuntimeRevision) return reject('AI_DESIGN_WORKSPACE_REVISION_CONFLICT', aggregate);
  if (aggregate.complexRevision !== command.expectedComplexRevision) return reject('AI_DESIGN_COMPLEX_REVISION_CONFLICT', aggregate);

  const createdArtifactIds: string[] = [];
  let patch: Parameters<typeof advanceAiDesignComplexWorkspaceAggregate>[1]['patch'] = {};

  if (command.type === 'ATTACH_PRODUCT_STRUCTURE') {
    if (command.payload.productStructure.projectId !== command.projectId || command.payload.productStructure.sessionId !== command.sessionId) return reject('AI_DESIGN_COMPLEX_STRUCTURE_SCOPE_MISMATCH', aggregate);
    const id = artifactId('complex-structure', commandDigest);
    const artifact = createAiDesignProductStructureSidecarArtifact(command.payload.productStructure, { artifactId: id, source: 'user_confirmed_concept', createdAt: now.toISOString() });
    const partitionDefinitions = command.payload.partitionDefinitions ?? Array.from({ length: Math.ceil(artifact.graph.nodes.length / 2_000) }, (_, index) => ({
      partitionId: `${id}:partition:${index}`,
      artifactId: id,
      nodeIds: artifact.graph.nodes.slice(index * 2_000, (index + 1) * 2_000).map(node => node.nodeId),
    }));
    const partitionResult = createAiDesignGraphPartitions(artifact.graph, partitionDefinitions);
    if (partitionResult.issues.length || partitionResult.coverage !== 'complete') return reject(`AI_DESIGN_COMPLEX_PARTITIONS_INVALID:${partitionResult.issues.join(',') || 'coverage_incomplete'}`, aggregate);
    let gaugeBindingsArtifact = null;
    if (command.payload.gaugeBindings?.length) {
      gaugeBindingsArtifact = createAiDesignGaugeBindingsArtifact({
        artifactId: artifactId('complex-gauge-bindings', commandDigest), graph: artifact.graph, bindings: command.payload.gaugeBindings,
        allowedGaugeIds: new Set(runtime.gauges.map(gauge => gauge.gaugeId)), createdAt: now.toISOString(),
      });
    }
    await artifacts.putProductStructureSidecarImmutable(artifact);
    for (const partition of partitionResult.partitions) await artifacts.putGraphPartitionImmutable(partition);
    if (gaugeBindingsArtifact) await artifacts.putGaugeBindingsImmutable(gaugeBindingsArtifact);
    createdArtifactIds.push(id, ...partitionResult.partitions.map(aiDesignGraphPartitionStorageId), ...(gaugeBindingsArtifact ? [gaugeBindingsArtifact.artifactId] : []));
    patch = {
      productStructure: ref(id, artifact.artifactDigest, artifact.graphDigest),
      partitions: partitionResult.partitions.map(partition => ref(aiDesignGraphPartitionStorageId(partition), partition.partitionDigest, partition.partitionDigest)),
      gaugeBindings: gaugeBindingsArtifact ? ref(gaugeBindingsArtifact.artifactId, gaugeBindingsArtifact.artifactDigest, gaugeBindingsArtifact.productStructureDigest) : null,
      constraintBindings: null,
      criticBundles: [], precisionReceipts: [], exactCadStatus: aggregate.precisionReceipts.length ? 'STALE' : 'NOT_RUN',
    };
  } else if (command.type === 'ATTACH_CROSS_DOMAIN_GRAPH') {
    if (command.payload.crossDomainGraph.projectId !== command.projectId || command.payload.crossDomainGraph.sessionId !== command.sessionId) return reject('AI_DESIGN_COMPLEX_CONSTRAINT_SCOPE_MISMATCH', aggregate);
    const id = artifactId('complex-constraints', commandDigest);
    const artifact = createAiDesignCrossDomainSidecarArtifact(command.payload.crossDomainGraph, { artifactId: id, source: 'user_confirmed_concept', createdAt: now.toISOString() });
    let constraintBindingsArtifact = null;
    if (command.payload.constraintBindings?.length) {
      const currentStructure = aggregate.productStructure ? artifacts.getProductStructureSidecar(aggregate.productStructure.artifactId) : null;
      if (!currentStructure) return reject('AI_DESIGN_COMPLEX_STRUCTURE_REQUIRED', aggregate);
      constraintBindingsArtifact = createAiDesignConstraintBindingsArtifact({ artifactId: artifactId('complex-constraint-bindings', commandDigest), productStructure: currentStructure.graph, crossDomainGraph: artifact.graph, bindings: command.payload.constraintBindings, createdAt: now.toISOString() });
    }
    await artifacts.putCrossDomainSidecarImmutable(artifact);
    if (constraintBindingsArtifact) await artifacts.putConstraintBindingsImmutable(constraintBindingsArtifact);
    createdArtifactIds.push(id, ...(constraintBindingsArtifact ? [constraintBindingsArtifact.artifactId] : []));
    patch = {
      crossDomainGraph: ref(id, artifact.artifactDigest, artifact.graphContentHash),
      constraintBindings: constraintBindingsArtifact ? ref(constraintBindingsArtifact.artifactId, constraintBindingsArtifact.artifactDigest, constraintBindingsArtifact.crossDomainContentHash) : null,
      resolutions: [], criticBundles: [], precisionReceipts: [],
      exactCadStatus: aggregate.precisionReceipts.length ? 'STALE' : 'NOT_RUN',
    };
  } else if (command.type === 'RESOLVE_INTENT_CONFLICT') {
    if (!aggregate.crossDomainGraph) return reject('AI_DESIGN_COMPLEX_CONSTRAINT_GRAPH_REQUIRED', aggregate);
    const sidecars = await resolveSidecars(aggregate, artifacts);
    if (!sidecars.crossDomainGraph) return reject('AI_DESIGN_COMPLEX_CONSTRAINT_GRAPH_REQUIRED', aggregate);
    const id = artifactId('intent-resolution', commandDigest);
    let resolution;
    try {
      resolution = createAiDesignIntentResolutionArtifact(resolutionCommandFromWorkspaceCommandV3(command), sidecars.crossDomainGraph, {
        artifactId: id,
        trustedServer: true,
        createdAt: now.toISOString(),
      });
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'AI_DESIGN_INTENT_RESOLUTION_REJECTED', aggregate);
    }
    await artifacts.putIntentResolutionImmutable(resolution);
    createdArtifactIds.push(id);
    patch = {
      resolutions: [...aggregate.resolutions, ref(id, resolution.artifactDigest, resolution.resultingContentHash)],
      criticBundles: [], precisionReceipts: [], exactCadStatus: aggregate.precisionReceipts.length ? 'STALE' : 'NOT_RUN',
    };
  } else if (command.type === 'RUN_COMPLEX_CRITICS') {
    if (!aggregate.productStructure || !aggregate.crossDomainGraph) return reject('AI_DESIGN_COMPLEX_SIDECARS_REQUIRED', aggregate);
    const sidecars = await resolveSidecars(aggregate, artifacts);
    const stateCandidates = runtime.candidates?.candidates ?? [];
    const requestedIds = command.payload.candidateIds ?? stateCandidates.map(item => item.candidateId);
    const requested = new Set(requestedIds);
    const manifests = artifacts.listCandidateArtifacts({ projectId: command.projectId, sessionId: command.sessionId })
      .filter(item => requested.has(item.candidateId) && stateCandidates.some(candidate => candidate.candidateId === item.candidateId));
    if (manifests.length < 2 || manifests.length > 3 || manifests.length !== requested.size) return reject('AI_DESIGN_COMPLEX_CANDIDATE_SET_INVALID', aggregate);
    const bundles = await evaluateAiDesignComplexCandidateSet({
      projectId: command.projectId,
      sessionId: command.sessionId,
      runId: runtime.generation?.runId ?? manifests[0]!.server.generationRunId,
      checkpointDigest: runtime.checkpoint.projectContentHash,
      candidates: manifests.map(manifest => {
        const candidate = stateCandidates.find(item => item.candidateId === manifest.candidateId)!;
        return { artifact: manifest, title: candidate.title, summary: candidate.summary };
      }),
      productStructure: sidecars.productStructure,
      crossDomainGraph: sidecars.crossDomainGraph,
      resolutions: sidecars.resolutions,
      changeImpact: null,
    }, { sink: artifacts, signingSecret: dependencies.signingSecret });
    patch = { criticBundles: bundles.map(bundle => ref(bundle.bundleId, serverEvidenceSha256(bundle), bundle.bundleDigest)) };
    createdArtifactIds.push(...bundles.map(item => item.bundleId));
  } else if (command.type === 'REQUEST_PRECISION_VERIFICATION') {
    const sidecars = await resolveSidecars(aggregate, artifacts);
    if (!sidecars.productStructure) return reject('AI_DESIGN_COMPLEX_STRUCTURE_REQUIRED', aggregate);
    const nodeIds = new Set(sidecars.productStructure.nodes.map(item => item.nodeId));
    const interfaceIds = new Set(sidecars.productStructure.interfaces.map(item => item.interfaceId));
    const partitionIds = new Set(sidecars.partitions.map(item => item.partitionId));
    const gaugeIds = new Set(runtime.gauges.map(item => item.gaugeId));
    if (command.payload.structureNodeIds.some(id => !nodeIds.has(id)) || command.payload.interfaceIds.some(id => !interfaceIds.has(id))
      || command.payload.partitionIds.some(id => !partitionIds.has(id)) || command.payload.gaugeIds.some(id => !gaugeIds.has(id))) return reject('AI_DESIGN_PRECISION_SCOPE_MISMATCH', aggregate);
    const id = artifactId('precision-request', commandDigest);
    const request = createAiDesignPrecisionVerificationRequest({
      requestId: id,
      projectId: command.projectId,
      sessionId: command.sessionId,
      runtimeRevision: runtime.runtimeRevision,
      complexRevision: aggregate.complexRevision + 1,
      productStructureDigest: sidecars.productStructure.graphDigest,
      crossDomainContentHash: sidecars.crossDomainGraph?.contentHash ?? null,
      scopes: scopesFromCommand(command),
      requestedAt: now.toISOString(),
    });
    await artifacts.putPrecisionRequestImmutable(request);
    createdArtifactIds.push(id);
    patch = {
      precisionRequests: [...aggregate.precisionRequests, ref(id, request.requestDigest, request.requestDigest)],
      exactCadStatus: aggregate.precisionReceipts.length ? 'STALE' : 'NOT_RUN',
    };
  }

  const next = advanceAiDesignComplexWorkspaceAggregate(aggregate, {
    commandId: command.commandId,
    commandDigest,
    expectedComplexRevision: command.expectedComplexRevision,
    runtimeRevision: runtime.runtimeRevision,
    now: now.toISOString(),
    patch,
  });
  try {
    return { ok: true, aggregate: await store.save(ownerKey, next, aggregate.complexRevision), replayed: false, createdArtifactIds };
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'AI_DESIGN_COMPLEX_SAVE_FAILED', aggregate);
  }
}

/** Records only a server-supplied, cryptographically verified Precision receipt. */
export async function recordAiDesignPrecisionReceipt(
  ownerKey: string,
  command: AiDesignWorkspaceServerCommandV3,
  receipt: AiDesignPrecisionVerificationReceiptV1,
  dependencies: AiDesignComplexWorkspaceServiceDependencies,
): Promise<AiDesignComplexWorkspaceServiceResult> {
  if (!isAiDesignWorkspaceServerCommandV3(command)) return reject('AI_DESIGN_PRECISION_SERVER_COMMAND_INVALID');
  const now = dependencies.now?.() ?? new Date();
  if (!fresh(command.issuedAt, now)) return reject('AI_DESIGN_COMPLEX_COMMAND_EXPIRED');
  const loadRuntime = dependencies.loadRuntime ?? loadServerAiDesignWorkspaceRuntime;
  const store = dependencies.store ?? aiDesignComplexWorkspaceStore;
  const artifacts = dependencies.artifacts ?? aiDesignServerRuntimeArtifacts;
  const runtime = await loadRuntime(ownerKey, command.projectId, command.sessionId);
  const aggregate = await store.loadOrCreate({ ownerKey, projectId: command.projectId, sessionId: command.sessionId, runtimeRevision: runtime.runtimeRevision, now: now.toISOString() });
  const commandDigest = serverEvidenceSha256(command);
  const applied = findAppliedAiDesignComplexCommand(aggregate, command.commandId);
  if (applied) return applied.commandDigest === commandDigest ? { ok: true, aggregate, replayed: true, createdArtifactIds: [] } : reject('AI_DESIGN_COMPLEX_COMMAND_REPLAY_CONFLICT', aggregate);
  if (runtime.runtimeRevision !== command.expectedRuntimeRevision) return reject('AI_DESIGN_WORKSPACE_REVISION_CONFLICT', aggregate);
  if (aggregate.complexRevision !== command.expectedComplexRevision) return reject('AI_DESIGN_COMPLEX_REVISION_CONFLICT', aggregate);
  if (receipt.receiptId !== command.payload.receiptId || receipt.receiptDigest !== command.payload.receiptDigest) return reject('AI_DESIGN_PRECISION_RECEIPT_COMMAND_MISMATCH', aggregate);
  const request = artifacts.getPrecisionRequest(receipt.requestId);
  if (!request) return reject('AI_DESIGN_PRECISION_REQUEST_NOT_FOUND', aggregate);
  const verification = verifyAiDesignPrecisionVerificationReceipt(receipt, request, {
    signingSecret: dependencies.signingSecret,
    now,
    expectedRuntimeRevision: runtime.runtimeRevision,
    expectedComplexRevision: aggregate.complexRevision,
  });
  if (!verification.ok) return reject('AI_DESIGN_PRECISION_RECEIPT_REJECTED', aggregate, verification.issues);
  await artifacts.putPrecisionReceiptImmutable(receipt);
  const next = advanceAiDesignComplexWorkspaceAggregate(aggregate, {
    commandId: command.commandId,
    commandDigest,
    expectedComplexRevision: aggregate.complexRevision,
    runtimeRevision: runtime.runtimeRevision,
    now: now.toISOString(),
    patch: {
      precisionReceipts: [...aggregate.precisionReceipts, ref(receipt.receiptId, receipt.receiptDigest, receipt.requestDigest)],
      exactCadStatus: verification.status,
    },
  });
  try {
    return { ok: true, aggregate: await store.save(ownerKey, next, aggregate.complexRevision), replayed: false, createdArtifactIds: [receipt.receiptId] };
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'AI_DESIGN_COMPLEX_SAVE_FAILED', aggregate);
  }
}

export async function loadAiDesignComplexWorkspaceReadModel(
  ownerKey: string,
  projectId: string,
  sessionId: string,
  dependencies: Omit<AiDesignComplexWorkspaceServiceDependencies, 'signingSecret'> & { viewportWidth?: number; selectedNodeId?: string | null } = {},
): Promise<AiDesignComplexWorkspaceReadModelV4> {
  const loadRuntime = dependencies.loadRuntime ?? loadServerAiDesignWorkspaceRuntime;
  const store = dependencies.store ?? aiDesignComplexWorkspaceStore;
  const artifacts = dependencies.artifacts ?? aiDesignServerRuntimeArtifacts;
  const runtime = await loadRuntime(ownerKey, projectId, sessionId);
  const aggregate = await store.loadOrCreate({ ownerKey, projectId, sessionId, runtimeRevision: runtime.runtimeRevision });
  const sidecars = await resolveSidecars(aggregate, artifacts);
  const staleAgainstRuntime = aggregate.boundRuntimeRevision !== runtime.runtimeRevision;
  const workspace = createAiDesignComplexWorkspaceViewModel(runtime, {
    productStructure: sidecars.productStructure,
    crossDomainGraph: sidecars.crossDomainGraph,
    resolutions: sidecars.resolutions,
    criticBundles: sidecars.criticBundles,
    partitions: sidecars.partitions,
    gaugeBindings: sidecars.gaugeBindings,
    constraintBindings: sidecars.constraintBindings,
  }, { viewportWidth: dependencies.viewportWidth, selectedNodeId: dependencies.selectedNodeId });
  return {
    schema: 'nexyfab.ai-design-complex-workspace-read-model.v4',
    projectId,
    sessionId,
    runtimeRevision: runtime.runtimeRevision,
    complexRevision: aggregate.complexRevision,
    aggregateDigest: aggregate.aggregateDigest,
    staleAgainstRuntime,
    inputKinds: [...new Set(runtime.checkpoint.sources.map(source => source.kind))],
    workspace,
    precision: {
      status: staleAgainstRuntime && aggregate.exactCadStatus === 'PASS' ? 'STALE' : aggregate.exactCadStatus,
      requestIds: aggregate.precisionRequests.map(item => item.artifactId),
      receiptIds: aggregate.precisionReceipts.map(item => item.artifactId),
      manufacturingReleaseReady: false,
    },
    availableActions: ['ATTACH_PRODUCT_STRUCTURE', 'ATTACH_CROSS_DOMAIN_GRAPH', 'RESOLVE_INTENT_CONFLICT', 'RUN_COMPLEX_CRITICS', 'REQUEST_PRECISION_VERIFICATION'],
  };
}
