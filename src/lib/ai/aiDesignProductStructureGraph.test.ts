import { describe, expect, it } from 'vitest';
import { createAssemblyInterfaceContract, createProductStructureGraph, validateProductStructureGraph } from './aiDesignProductStructureGraph';

const graph = (overrides: Record<string, unknown> = {}) => createProductStructureGraph({ projectId: 'project-1', sessionId: 'session-1', revision: 'r1', rootNodeId: 'assembly-1', nodes: [
  { nodeId: 'assembly-1', kind: 'assembly', label: 'Root', parentId: null, sourceIntentNodeIds: [] },
  { nodeId: 'part-1', kind: 'component', label: 'Part', parentId: 'assembly-1', sourceIntentNodeIds: [] },
  { nodeId: 'part-2', kind: 'component', label: 'Part 2', parentId: 'assembly-1', sourceIntentNodeIds: [] },
], edges: [{ edgeId: 'contains-1', kind: 'contains', from: 'assembly-1', to: 'part-1' }, { edgeId: 'contains-2', kind: 'contains', from: 'assembly-1', to: 'part-2' }], interfaces: [createAssemblyInterfaceContract({ interfaceId: 'iface-1', graphRevision: 'r1', kind: 'mechanical', from: { nodeId: 'part-1', portId: 'mount', role: 'provider' }, to: { nodeId: 'part-2', portId: 'mount', role: 'consumer' }, exactGeometryStatus: 'not_run', manufacturingStatus: 'not_run' })], ...overrides });

describe('product structure graph', () => {
  it('creates a deterministic validated graph and keeps exact authority NOT_RUN', () => { const value = graph(); expect(validateProductStructureGraph(value)).toEqual([]); expect(value.interfaces[0]?.exactGeometryStatus).toBe('not_run'); expect(value.interfaces[0]?.manufacturingStatus).toBe('not_run'); });
  it('rejects orphans and parent cycles', () => { expect(validateProductStructureGraph(graph({ nodes: [{ nodeId: 'assembly-1', kind: 'assembly', label: 'Root', parentId: 'part-1', sourceIntentNodeIds: [] }, { nodeId: 'part-1', kind: 'component', label: 'Part', parentId: 'assembly-1', sourceIntentNodeIds: [] }] }))).toContain('parent_cycle'); expect(validateProductStructureGraph(graph({ nodes: [{ nodeId: 'assembly-1', kind: 'assembly', label: 'Root', parentId: null, sourceIntentNodeIds: [] }, { nodeId: 'part-1', kind: 'component', label: 'Part', parentId: 'missing', sourceIntentNodeIds: [] }] }))).toContain('orphan_node:part-1'); });
  it('requires hierarchy edges to agree with parent links and rejects client-authored precision PASS', () => {
    expect(validateProductStructureGraph(graph({ edges: [] }))).toContain('containment_parent_mismatch:part-1');
    expect(() => createAssemblyInterfaceContract({ interfaceId: 'iface-unsafe', graphRevision: 'r1', kind: 'mechanical', from: { nodeId: 'part-1', portId: 'a', role: 'provider' }, to: { nodeId: 'part-2', portId: 'b', role: 'consumer' }, exactGeometryStatus: 'verified', manufacturingStatus: 'not_run' })).toThrow('interface_precision_authority_forbidden');
  });
});
