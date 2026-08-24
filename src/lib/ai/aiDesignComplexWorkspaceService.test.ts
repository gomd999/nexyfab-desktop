import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createAiDesignWorkspaceRuntime, type AiDesignWorkspaceRuntimeV1 } from './aiDesignWorkspaceRuntime';
import { createDesignCandidateComparison } from './designCandidateComparison';
import { createAiDesignCandidateArtifact } from './aiDesignCandidateArtifact';
import { createAssemblyInterfaceContract, createProductStructureGraph } from './aiDesignProductStructureGraph';
import { createAiDesignCrossDomainConstraintGraph } from './aiDesignCrossDomainConstraintGraph';
import { InMemoryAiDesignComplexWorkspaceStore } from './aiDesignComplexWorkspaceStore';
import { InMemoryAiDesignServerRuntimeArtifacts } from './aiDesignServerRuntimeArtifacts';
import {
  executeAiDesignComplexWorkspaceCommand,
  loadAiDesignComplexWorkspaceReadModel,
  recordAiDesignPrecisionReceipt,
} from './aiDesignComplexWorkspaceService';
import { issueAiDesignPrecisionVerificationReceipt } from './aiDesignPrecisionVerification';
import { serverEvidenceSha256 } from './serverEvidence';

const secret = 'complex-workspace-test-signing-secret-at-least-32-bytes';
const fixedNow = new Date('2026-08-24T10:00:00.000Z');
const hash = (character: string) => character.repeat(64);

function runtime(): AiDesignWorkspaceRuntimeV1 {
  const created = createAiDesignWorkspaceRuntime({
    projectId: 'project-1', sessionId: 'session-1', revisionToken: 'revision-1', now: fixedNow.toISOString(),
    inputs: [{ projectId: 'project-1', revision: 0, sourceId: 'source-1', sourceHash: hash('a'), projectContentHash: hash('b'), kind: 'text', mimeType: 'text/plain', sizeBytes: 100, authority: 'user_confirmed', provenance: { rights: 'user_owned', origin: 'synthetic test' }, fields: [{ key: 'purpose', value: 'test assembly', category: 'requirement' }] }],
  });
  if (!created.ok) throw new Error(created.issues.join(','));
  const candidates = createDesignCandidateComparison('revision-1', [
    { candidateId: 'candidate-a', revision: hash('c'), baseRevision: 'revision-1', title: 'Compact', summary: 'Compact independent concept', featureIds: ['frame', 'guard'], metrics: [], evidence: [] },
    { candidateId: 'candidate-b', revision: hash('d'), baseRevision: 'revision-1', title: 'Serviceable', summary: 'Service-oriented independent concept', featureIds: ['frame', 'door'], metrics: [], evidence: [] },
  ]);
  return { ...created.state, workflow: { ...created.state.workflow, status: 'CANDIDATE_REVIEW' }, candidates };
}

function structure() {
  const nodes = [
    { nodeId: 'root', kind: 'assembly' as const, label: 'Assembly', parentId: null, sourceIntentNodeIds: ['intent-purpose'] },
    { nodeId: 'part-a', kind: 'component' as const, label: 'Part A', parentId: 'root', sourceIntentNodeIds: ['intent-purpose'] },
    { nodeId: 'part-b', kind: 'component' as const, label: 'Part B', parentId: 'root', sourceIntentNodeIds: ['intent-purpose'] },
  ];
  return createProductStructureGraph({
    projectId: 'project-1', sessionId: 'session-1', revision: 'revision-1', rootNodeId: 'root', nodes,
    edges: [{ edgeId: 'contains-a', kind: 'contains', from: 'root', to: 'part-a' }, { edgeId: 'contains-b', kind: 'contains', from: 'root', to: 'part-b' }],
    interfaces: [createAssemblyInterfaceContract({
      interfaceId: 'interface-a-b', graphRevision: 'revision-1', kind: 'mechanical',
      from: { nodeId: 'part-a', portId: 'port-a', role: 'provider' }, to: { nodeId: 'part-b', portId: 'port-b', role: 'consumer' },
      exactGeometryStatus: 'not_run', manufacturingStatus: 'not_run',
    })],
  });
}

function constraints() {
  return createAiDesignCrossDomainConstraintGraph({
    projectId: 'project-1', sessionId: 'session-1', graphRevision: 1, sourceContentHash: hash('e'),
    nodes: [
      { id: 'clearance-mechanical', kind: 'constraint', domain: 'mechanical', key: 'clearance', value: 10, sourceIds: ['source-1'], sourceHashes: [hash('a')], confidence: 1 },
      { id: 'clearance-safety', kind: 'constraint', domain: 'safety', key: 'clearance', value: 20, sourceIds: ['source-2'], sourceHashes: [hash('b')], confidence: 1 },
    ],
  });
}

function clientCommand(type: string, commandId: string, expectedComplexRevision: number, payload: unknown) {
  return {
    schema: 'nexyfab.ai-design-workspace-command.v3' as const,
    commandId, projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 0, expectedComplexRevision,
    issuedAt: fixedNow.toISOString(), type, payload,
  };
}

async function fixture() {
  const state = runtime();
  const store = new InMemoryAiDesignComplexWorkspaceStore();
  const artifacts = new InMemoryAiDesignServerRuntimeArtifacts();
  for (const [index, candidate] of state.candidates!.candidates.entries()) {
    await artifacts.putCandidateArtifactImmutable(createAiDesignCandidateArtifact({
      trustedServer: true, artifactId: `artifact-${candidate.candidateId}`, candidateId: candidate.candidateId,
      projectId: 'project-1', sessionId: 'session-1', baseRevision: 'revision-1', artifactRevision: 1, status: 'published', createdAt: fixedNow.toISOString(),
      contentDigest: hash(index ? 'f' : 'e'), designDigest: serverEvidenceSha256(candidate),
      dependencies: { intentNodeIds: ['intent-purpose'], parameterIds: index ? ['service-space'] : ['footprint'], gaugeIds: [], featureIds: candidate.featureIds },
      evidence: [{ evidenceId: `concept-${index}`, kind: 'ai-concept', status: 'not_run' }],
      server: { generatorId: 'test-generator', modelId: 'test-model', runtimeId: 'test-runtime', workerBuildDigest: hash('f'), generationRunId: 'run-1' },
      supersedes: null,
    }));
  }
  const dependencies = { loadRuntime: async () => structuredClone(state), store, artifacts, signingSecret: secret, now: () => fixedNow };
  return { state, store, artifacts, dependencies };
}

describe('server-authoritative complex workspace V4', () => {
  it('runs structure, constraints, explicit resolution, critics, Precision request and signed receipt sequentially', async () => {
    const { store, artifacts, dependencies } = await fixture();
    const structureCommand = clientCommand('ATTACH_PRODUCT_STRUCTURE', 'command-structure', 0, { productStructure: structure() });
    const attachedStructure = await executeAiDesignComplexWorkspaceCommand('owner-1', structureCommand as never, dependencies);
    expect(attachedStructure).toMatchObject({ ok: true, aggregate: { complexRevision: 1, exactCadStatus: 'NOT_RUN' } });

    const graph = constraints();
    const conflictId = graph.nodes.find(item => item.kind === 'conflict')!.id;
    const attachedGraph = await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('ATTACH_CROSS_DOMAIN_GRAPH', 'command-constraints', 1, { crossDomainGraph: graph, constraintBindings: [{ crossDomainNodeId: conflictId, structureNodeIds: ['part-a'] }] }) as never, dependencies);
    expect(attachedGraph).toMatchObject({ ok: true, aggregate: { complexRevision: 2, constraintBindings: { artifactId: expect.stringContaining('complex-constraint-bindings:') } } });

    const preResolutionEvaluation = await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('RUN_COMPLEX_CRITICS', 'command-critics-before-resolution', 2, { candidateIds: ['candidate-a', 'candidate-b'] }) as never, dependencies);
    expect(preResolutionEvaluation).toMatchObject({ ok: true, aggregate: { complexRevision: 3, criticBundles: [{}, {}] } });

    const resolved = await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('RESOLVE_INTENT_CONFLICT', 'command-resolution', 3, {
      expectedGraphRevision: graph.graphRevision, graphContentHash: graph.contentHash, targetNodeId: conflictId,
      selection: { type: 'select_alternative', alternativeIndex: 1 }, rationale: 'Engineer selected the safety clearance.',
      provenance: { sourceIds: ['source-2'], sourceHashes: [hash('b')] },
    }) as never, dependencies);
    expect(resolved).toMatchObject({ ok: true, aggregate: { complexRevision: 4, resolutions: [{ artifactId: expect.stringContaining('intent-resolution:') }], criticBundles: [] } });

    const evaluated = await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('RUN_COMPLEX_CRITICS', 'command-critics', 4, { candidateIds: ['candidate-a', 'candidate-b'] }) as never, dependencies);
    expect(evaluated).toMatchObject({ ok: true, aggregate: { complexRevision: 5 } });
    if (!evaluated.ok) throw new Error(evaluated.code);
    expect(evaluated.aggregate.criticBundles).toHaveLength(2);
    expect(evaluated.aggregate.criticBundles.map(item => artifacts.getCriticBundle(item.artifactId)?.conceptReviewReady)).toEqual([true, true]);

    const partitionId = artifacts.getGraphPartition(evaluated.aggregate.partitions[0]!.artifactId)!.partitionId;
    const requested = await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('REQUEST_PRECISION_VERIFICATION', 'command-precision-request', 5, { structureNodeIds: ['part-a'], interfaceIds: ['interface-a-b'], partitionIds: [partitionId], gaugeIds: [] }) as never, dependencies);
    expect(requested).toMatchObject({ ok: true, aggregate: { complexRevision: 6, exactCadStatus: 'NOT_RUN' } });
    if (!requested.ok) throw new Error(requested.code);
    const requestId = requested.aggregate.precisionRequests[0]!.artifactId;
    const precisionRequest = artifacts.getPrecisionRequest(requestId)!;
    const receipt = issueAiDesignPrecisionVerificationReceipt({
      receiptId: 'precision-receipt-1', request: precisionRequest, status: 'PASS', keyId: 'precision-key-1',
      issuedAt: '2026-08-24T10:01:00.000Z', expiresAt: '2026-08-24T10:30:00.000Z',
      scopeResults: precisionRequest.scopes.map(scope => ({ ...scope, status: 'PASS' as const, exactArtifactDigest: serverEvidenceSha256(scope), codes: ['exact-pass'] })),
    }, secret);
    const recorded = await recordAiDesignPrecisionReceipt('owner-1', {
      schema: 'nexyfab.ai-design-workspace-server-command.v3', source: 'server', type: 'RECORD_PRECISION_RECEIPT',
      commandId: 'command-record-precision', projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 0, expectedComplexRevision: 6,
      issuedAt: fixedNow.toISOString(), payload: { receiptId: receipt.receiptId, receiptDigest: receipt.receiptDigest },
    }, receipt, dependencies);
    expect(recorded).toMatchObject({ ok: true, aggregate: { complexRevision: 7, exactCadStatus: 'PASS' } });

    const model = await loadAiDesignComplexWorkspaceReadModel('owner-1', 'project-1', 'session-1', { loadRuntime: dependencies.loadRuntime, store, artifacts, viewportWidth: 390, selectedNodeId: 'part-a' });
    expect(model).toMatchObject({ staleAgainstRuntime: false, precision: { status: 'PASS', manufacturingReleaseReady: false }, workspace: { scale: { graphPartitionCount: 1 }, constraints: { unresolvedCount: 0 }, trust: { manufacturingReleaseReady: false } } });
  });

  it('is replay-safe and rejects stale CAS and forged Precision receipts', async () => {
    const { artifacts, dependencies } = await fixture();
    const command = clientCommand('ATTACH_PRODUCT_STRUCTURE', 'command-structure', 0, { productStructure: structure() });
    const first = await executeAiDesignComplexWorkspaceCommand('owner-1', command as never, dependencies);
    const replay = await executeAiDesignComplexWorkspaceCommand('owner-1', command as never, dependencies);
    expect(first.ok && replay.ok && replay.replayed).toBe(true);
    expect(await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('ATTACH_CROSS_DOMAIN_GRAPH', 'new-command', 0, { crossDomainGraph: constraints() }) as never, dependencies)).toMatchObject({ ok: false, code: 'AI_DESIGN_COMPLEX_REVISION_CONFLICT' });

    const requested = await executeAiDesignComplexWorkspaceCommand('owner-1', clientCommand('REQUEST_PRECISION_VERIFICATION', 'request-command', 1, { structureNodeIds: ['part-a'], interfaceIds: [], partitionIds: [], gaugeIds: [] }) as never, dependencies);
    if (!requested.ok) throw new Error(requested.code);
    const request = artifacts.getPrecisionRequest(requested.aggregate.precisionRequests[0]!.artifactId)!;
    const receipt = issueAiDesignPrecisionVerificationReceipt({ receiptId: 'receipt-forged', request, status: 'PASS', keyId: 'precision-key-1', issuedAt: '2026-08-24T10:01:00.000Z', expiresAt: '2026-08-24T10:30:00.000Z', scopeResults: [{ ...request.scopes[0]!, status: 'PASS', exactArtifactDigest: hash('f'), codes: [] }] }, secret);
    const rejected = await recordAiDesignPrecisionReceipt('owner-1', {
      schema: 'nexyfab.ai-design-workspace-server-command.v3', source: 'server', type: 'RECORD_PRECISION_RECEIPT', commandId: 'record-forged', projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 0, expectedComplexRevision: 2, issuedAt: fixedNow.toISOString(), payload: { receiptId: receipt.receiptId, receiptDigest: receipt.receiptDigest },
    }, { ...receipt, signature: hash('0') }, dependencies);
    expect(rejected).toMatchObject({ ok: false, code: 'AI_DESIGN_PRECISION_RECEIPT_REJECTED', issues: expect.arrayContaining(['precision_receipt_signature_invalid']) });
  });
});
