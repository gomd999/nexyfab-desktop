import { describe, expect, it } from 'vitest';
import { createAssemblyInterfaceContract, createProductStructureGraph } from './aiDesignProductStructureGraph';
import { createAiDesignCrossDomainConstraintGraph } from './aiDesignCrossDomainConstraintGraph';
import { parseAiDesignWorkspaceClientCommandV3 } from './aiDesignWorkspaceCommandV3';

const hash = (character: string) => character.repeat(64);
const base = {
  schema: 'nexyfab.ai-design-workspace-command.v3',
  commandId: 'command-1', projectId: 'project-1', sessionId: 'session-1',
  expectedRuntimeRevision: 0, expectedComplexRevision: 0,
  issuedAt: '2026-08-24T00:00:00.000Z',
} as const;

function structure() {
  const nodes = [
    { nodeId: 'root', kind: 'assembly' as const, label: 'Assembly', parentId: null, sourceIntentNodeIds: ['intent-1'] },
    { nodeId: 'part-a', kind: 'component' as const, label: 'Part A', parentId: 'root', sourceIntentNodeIds: ['intent-1'] },
    { nodeId: 'part-b', kind: 'component' as const, label: 'Part B', parentId: 'root', sourceIntentNodeIds: ['intent-1'] },
  ];
  return createProductStructureGraph({
    projectId: 'project-1', sessionId: 'session-1', revision: 'revision-1', rootNodeId: 'root', nodes,
    edges: [
      { edgeId: 'contains-a', kind: 'contains', from: 'root', to: 'part-a' },
      { edgeId: 'contains-b', kind: 'contains', from: 'root', to: 'part-b' },
    ],
    interfaces: [createAssemblyInterfaceContract({
      interfaceId: 'interface-a-b', graphRevision: 'revision-1', kind: 'mechanical',
      from: { nodeId: 'part-a', portId: 'port-a', role: 'provider' },
      to: { nodeId: 'part-b', portId: 'port-b', role: 'consumer' },
      exactGeometryStatus: 'not_run', manufacturingStatus: 'not_run',
    })],
  });
}

describe('AI Design Workspace Command V3', () => {
  it('accepts concept-only structure and bounded complex actions', () => {
    expect(parseAiDesignWorkspaceClientCommandV3({ ...base, type: 'ATTACH_PRODUCT_STRUCTURE', payload: {
      productStructure: structure(),
      partitionDefinitions: [{ partitionId: 'partition-1', artifactId: 'artifact-1', nodeIds: ['root', 'part-a', 'part-b'] }],
      gaugeBindings: [{ bindingId: 'binding-1', gaugeId: 'gauge-1', structureNodeId: 'part-a', parameterId: 'width', scope: 'component', interfaceId: null, affectedNodeIds: ['part-a'] }],
    } }).ok).toBe(true);
    expect(parseAiDesignWorkspaceClientCommandV3({ ...base, type: 'REQUEST_PRECISION_VERIFICATION', payload: { structureNodeIds: ['part-a'], interfaceIds: [], partitionIds: [], gaugeIds: [] } }).ok).toBe(true);
  });

  it('rejects client-authored exact authority and server-only receipt recording', () => {
    const forged = structuredClone(structure());
    forged.interfaces[0]!.exactGeometryStatus = 'verified';
    expect(parseAiDesignWorkspaceClientCommandV3({ ...base, type: 'ATTACH_PRODUCT_STRUCTURE', payload: { productStructure: forged } })).toEqual({ ok: false, issues: ['payload_schema_invalid'] });
    expect(parseAiDesignWorkspaceClientCommandV3({ ...base, type: 'RECORD_PRECISION_RECEIPT', payload: { receiptId: 'receipt-1', receiptDigest: hash('a') } }).ok).toBe(false);
  });

  it('validates explicit conflict resolution against the V1 resolution contract', () => {
    const graph = createAiDesignCrossDomainConstraintGraph({
      projectId: 'project-1', sessionId: 'session-1', graphRevision: 2, sourceContentHash: hash('a'),
      nodes: [
        { id: 'mechanical', kind: 'constraint', domain: 'mechanical', key: 'clearance', value: 10, sourceIds: ['source-a'], sourceHashes: [hash('a')], confidence: 1 },
        { id: 'safety', kind: 'constraint', domain: 'safety', key: 'clearance', value: 20, sourceIds: ['source-b'], sourceHashes: [hash('b')], confidence: 1 },
      ],
    });
    const targetNodeId = graph.nodes.find(item => item.kind === 'conflict')!.id;
    const command = { ...base, type: 'RESOLVE_INTENT_CONFLICT', payload: { expectedGraphRevision: 2, graphContentHash: graph.contentHash, targetNodeId, selection: { type: 'select_alternative', alternativeIndex: 1 }, rationale: 'The engineer selected the safety constraint.', provenance: { sourceIds: ['source-b'], sourceHashes: [hash('b')] } } };
    expect(parseAiDesignWorkspaceClientCommandV3(command).ok).toBe(true);
    expect(parseAiDesignWorkspaceClientCommandV3({ ...command, payload: { ...command.payload, selection: { type: 'provide_value', value: { verificationPass: true } } } }).ok).toBe(false);
  });
});
