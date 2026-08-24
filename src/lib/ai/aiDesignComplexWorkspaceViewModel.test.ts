import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createAiDesignWorkspaceRuntime } from './aiDesignWorkspaceRuntime';
import { createAssemblyInterfaceContract, createProductStructureGraph } from './aiDesignProductStructureGraph';
import { createAiDesignCrossDomainConstraintGraph } from './aiDesignCrossDomainConstraintGraph';
import { createAiDesignComplexWorkspaceViewModel } from './aiDesignComplexWorkspaceViewModel';
import { createGaugeUxViewModel } from './aiDesignComparisonGaugeUx';

const hash = (character: string) => character.repeat(64);
const input = {
  projectId: 'project-1', revision: 0, sourceId: 'source-1', sourceHash: hash('a'), projectContentHash: hash('b'),
  kind: 'text' as const, mimeType: 'text/plain', sizeBytes: 50, authority: 'user_confirmed' as const,
  provenance: { rights: 'user_owned' as const, origin: 'user' },
  fields: [{ key: 'purpose', value: 'robot cell', category: 'requirement' as const }],
};

function runtime() {
  const created = createAiDesignWorkspaceRuntime({ projectId: 'project-1', revisionToken: 'revision-1', sessionId: 'session-1', inputs: [input], now: '2026-08-24T09:00:00.000Z' });
  if (!created.ok) throw new Error(created.issues.join(','));
  const gauge = createGaugeUxViewModel({
    schema: 'nexyfab.gauge-view-model.v1', gaugeId: 'gauge-clearance', type: 'length',
    selection: { version: 1, projectRevision: 'revision-1', assemblyPath: ['root', 'guard'], partInstanceId: 'guard', topology: [], sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm' },
    binding: { kind: 'feature_parameter', partId: 'guard', featureId: 'guard', parameter: 'clearance', unit: 'mm' },
    currentValue: 100, targetValue: 120, delta: 20, unit: 'mm', snapIncrement: 1, range: { min: 20, max: 300 },
    axisFrame: { axis: [1, 0, 0], coordinateFrame: 'world' }, visible: true, primary: true,
    requiresConfirmation: false, confirmationReasons: [], invalidatedVerification: { geometry: 'invalidated', topology: 'invalidated', manufacturing: 'invalidated' },
    baseRevision: 'revision-1', intentId: 'intent-clearance',
  }, { fineStep: 1, coarseStep: 10, mobile: true });
  return { ...created.state, gauges: [gauge] };
}

function structure() {
  const nodes = [
    { nodeId: 'root', kind: 'assembly' as const, label: 'Robot cell', parentId: null, sourceIntentNodeIds: ['intent-purpose'] },
    { nodeId: 'robot', kind: 'subassembly' as const, label: 'Robot', parentId: 'root', sourceIntentNodeIds: ['intent-purpose'] },
    { nodeId: 'guard', kind: 'component' as const, label: 'Guard', parentId: 'root', sourceIntentNodeIds: ['intent-safety'] },
  ];
  const connection = createAssemblyInterfaceContract({
    interfaceId: 'interface-robot-guard', graphRevision: 'revision-1', kind: 'spatial',
    from: { nodeId: 'robot', portId: 'work-envelope', role: 'provider' },
    to: { nodeId: 'guard', portId: 'keep-out', role: 'consumer' },
    exactGeometryStatus: 'not_run', manufacturingStatus: 'not_run',
  });
  return createProductStructureGraph({
    projectId: 'project-1', sessionId: 'session-1', revision: 'revision-1', rootNodeId: 'root', nodes,
    edges: [
      { edgeId: 'edge-root-robot', kind: 'contains', from: 'root', to: 'robot' },
      { edgeId: 'edge-root-guard', kind: 'contains', from: 'root', to: 'guard' },
      { edgeId: 'edge-robot-guard', kind: 'connects', from: 'robot', to: 'guard', boundary: true },
    ],
    interfaces: [connection],
  });
}

describe('complex AI Design workspace view-model', () => {
  it('projects hierarchy, explicit conflict resolution, assembly gauges, heat, and mobile UX', () => {
    const graph = createAiDesignCrossDomainConstraintGraph({
      projectId: 'project-1', sessionId: 'session-1', graphRevision: 1, sourceContentHash: hash('c'),
      nodes: [
        { id: 'clearance-mechanical', kind: 'constraint', domain: 'mechanical', key: 'guard-clearance', value: 100, sourceIds: ['source-1'], sourceHashes: [hash('a')], confidence: 1 },
        { id: 'clearance-safety', kind: 'constraint', domain: 'safety', key: 'guard-clearance', value: 120, sourceIds: ['source-1'], sourceHashes: [hash('a')], confidence: 1 },
      ],
    });
    const conflictId = graph.nodes.find(node => node.kind === 'conflict')!.id;
    const vm = createAiDesignComplexWorkspaceViewModel(runtime(), {
      productStructure: structure(), crossDomainGraph: graph,
      gaugeBindings: [{ bindingId: 'bind-clearance', gaugeId: 'gauge-clearance', structureNodeId: 'guard', parameterId: 'clearance', scope: 'interface', interfaceId: 'interface-robot-guard', affectedNodeIds: ['robot', 'guard'] }],
      constraintBindings: [{ crossDomainNodeId: conflictId, structureNodeIds: ['guard', 'robot'] }],
    }, { viewportWidth: 390, selectedNodeId: 'guard' });
    expect(vm).toMatchObject({
      scale: { structureNodes: 3, assemblyInterfaces: 1, domains: 2 },
      constraints: { unresolvedCount: 1, affectedStructureNodeIds: ['guard', 'robot'], resolutionAction: { enabled: true, requiresExplicitChoice: true, automaticResolution: false } },
      inspector: { selectedNodeId: 'guard', stickyActionBar: true, touchTargetMinPx: 44 },
      trust: { conceptOnly: true, structuralPlanningStatus: 'PASS', crossDomainPlanningStatus: 'INCOMPLETE', engineeringVerificationStatus: 'NOT_RUN', manufacturingReleaseReady: false },
    });
    expect(vm.assemblyTree.find(node => node.nodeId === 'guard')).toMatchObject({ selected: true, heat: 'critical' });
    expect(vm.assemblyGauges[0]).toMatchObject({ fineStep: 1, coarseStep: 10, affectedNodeCount: 2, requiresConfirmation: true, touchTargetMinPx: 44 });
    expect(vm.interfaces[0]?.trustLabel).toContain('Precision CAD verification pending');
    expect(vm.inspector.mobileSheets).toContain('impact');
  });

  it('rejects sidecars from another project', () => {
    const original = structure();
    const foreign = createProductStructureGraph({
      projectId: 'other-project', sessionId: original.sessionId, revision: original.revision, rootNodeId: original.rootNodeId,
      nodes: original.nodes, edges: original.edges, interfaces: original.interfaces,
    });
    expect(() => createAiDesignComplexWorkspaceViewModel(runtime(), { productStructure: foreign, crossDomainGraph: null })).toThrow('AI_DESIGN_COMPLEX_STRUCTURE_SCOPE_MISMATCH');
  });
});
