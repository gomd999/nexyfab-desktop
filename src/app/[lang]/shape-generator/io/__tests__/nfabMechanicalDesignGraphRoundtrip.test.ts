import { describe, expect, it } from 'vitest';
import type { NfabProjectV1 } from '../nfabFormat';
import { parseProject, serializeProject, toJsonString } from '../nfabFormat';
import type { FeatureHistory } from '../../useFeatureStack';
import {
  MECHANICAL_DESIGN_PATCH_SCHEMA,
  applyMechanicalDesignPatch,
  buildMechanicalDesignGraph,
  canonicalizeMechanicalDesign,
  type MechanicalDesignGraphV1,
  type MechanicalDesignPatchOperationV1,
} from '@/lib/ai/mechanicalDesignGraph';

const HISTORY: FeatureHistory = {
  rootId: 'base-root',
  activeNodeId: 'loft-protected',
  editingNodeId: null,
  nodes: [
    {
      id: 'base-root', type: 'baseShape', label: 'Base', icon: '', params: {},
      enabled: true, expanded: true, parentId: null, children: ['hole-stable'],
      editingActive: false, timestamp: 1,
    },
    {
      id: 'hole-stable', type: 'feature', featureType: 'hole', label: 'Hole', icon: '',
      params: { diameter: 8, posX: 20, posZ: -5, depth: 999, holeType: 0 },
      enabled: true, expanded: true, parentId: 'base-root', children: ['loft-protected'],
      editingActive: false, timestamp: 2,
      edgeSelections: [{
        type: 'edge',
        persistentId: 'edge:stable:7',
        position: [1, 2, 3],
        normal: [0, 1, 0],
        direction: [1, 0, 0],
        length: 30,
      }],
    },
    {
      id: 'loft-protected', type: 'feature', featureType: 'loft', label: 'Loft', icon: '',
      params: { sectionCount: 3 }, enabled: true, expanded: true,
      parentId: 'hole-stable', children: [], editingActive: false, timestamp: 3,
      dependsOn: ['hole-stable'],
    },
  ],
};

const SCENE: NfabProjectV1['scene'] = {
  selectedId: 'box',
  params: { width: 100, height: 40, depth: 60 },
  paramExpressions: {},
  materialId: 'aluminum',
  color: '#888888',
  isSketchMode: false,
  sketchPlane: 'xy',
  sketchProfile: { closed: false, segments: [] },
  sketchConfig: { mode: 'extrude', depth: 10, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
};

async function reopen(graph: MechanicalDesignGraphV1): Promise<MechanicalDesignGraphV1> {
  const parsed = parseProject(toJsonString(graph.sourceProject as unknown as NfabProjectV1));
  const reopened = await buildMechanicalDesignGraph(parsed);
  expect(reopened.revisionSha256).toBe(graph.revisionSha256);
  expect(reopened.parentRevisionSha256).toBe(graph.parentRevisionSha256);
  return reopened;
}

async function patchAndReopen(
  graph: MechanicalDesignGraphV1,
  operation: MechanicalDesignPatchOperationV1,
): Promise<MechanicalDesignGraphV1> {
  const result = await applyMechanicalDesignPatch(graph, {
    schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
    baseRevisionSha256: graph.revisionSha256,
    operations: [operation],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join(','));
  return reopen(result.graph);
}

describe('NFAB + MechanicalDesignGraph three-cycle persistence', () => {
  it('keeps exact feature identity, opaque nodes, selection bindings and lineage', async () => {
    const project = serializeProject({
      name: 'three-cycle-gear-housing',
      history: HISTORY,
      scene: SCENE,
      referenceGeometry: [{
        id: 'axis-main', kind: 'axis', method: 'standard', label: 'Main axis', hidden: false,
        dependsOn: [], evaluatedAt: 1, params: { method: 'standard', id: 'y' },
      }],
    });
    const initial = await buildMechanicalDesignGraph(parseProject(toJsonString(project)));
    const opaqueBefore = canonicalizeMechanicalDesign(initial.nodes.find(node => node.id === 'loft-protected')?.source);
    const selectionBefore = canonicalizeMechanicalDesign(initial.nodes.find(node => node.id === 'hole-stable')?.source.edgeSelections);
    const refsBefore = canonicalizeMechanicalDesign(initial.sourceProject.referenceGeometry);

    const first = await patchAndReopen(initial, {
      op: 'set_parameter', targetId: 'hole-stable', parameter: 'diameter', expectedValue: 8, value: 9,
    });
    const second = await patchAndReopen(first, {
      op: 'set_parameter', targetId: 'base-root', parameter: 'width', expectedValue: 100, value: 120,
    });
    const third = await patchAndReopen(second, {
      op: 'set_enabled', targetId: 'hole-stable', expectedEnabled: true, enabled: false,
    });

    expect(third.nodes.map(node => node.id)).toEqual(['base-root', 'hole-stable', 'loft-protected']);
    expect(third.nodes.find(node => node.id === 'hole-stable')).toMatchObject({
      enabled: false,
      params: { diameter: 9, posX: 20, posZ: -5 },
    });
    expect(third.base.params.width).toBe(120);
    expect(canonicalizeMechanicalDesign(third.nodes.find(node => node.id === 'loft-protected')?.source)).toBe(opaqueBefore);
    expect(canonicalizeMechanicalDesign(third.nodes.find(node => node.id === 'hole-stable')?.source.edgeSelections)).toBe(selectionBefore);
    expect(canonicalizeMechanicalDesign(third.sourceProject.referenceGeometry)).toBe(refsBefore);
    expect(first.parentRevisionSha256).toBe(initial.revisionSha256);
    expect(second.parentRevisionSha256).toBe(first.revisionSha256);
    expect(third.parentRevisionSha256).toBe(second.revisionSha256);
  });
});
