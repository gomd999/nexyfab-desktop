import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_DESIGN_PATCH_SCHEMA,
  applyMechanicalDesignPatch,
  buildMechanicalDesignGraph,
  canonicalizeMechanicalDesign,
} from './mechanicalDesignGraph';

function project() {
  return {
    magic: 'nfab',
    version: 3,
    createdAt: 1,
    updatedAt: 2,
    name: 'gear housing',
    tree: {
      rootId: 'root-stable',
      activeNodeId: 'opaque-loft',
      nodes: [
        {
          id: 'root-stable', type: 'baseShape', label: 'Base', icon: '', params: {},
          enabled: true, expanded: true, parentId: null, children: ['hole-1'],
          editingActive: false, timestamp: 1,
        },
        {
          id: 'hole-1', type: 'feature', featureType: 'hole', label: 'Hole', icon: '',
          params: { diameter: 8, posX: 12, posZ: -4, depth: 999, holeType: 0 },
          enabled: true, expanded: true, parentId: 'root-stable', children: ['shell-1'],
          editingActive: false, timestamp: 2,
          edgeSelections: [{ persistentId: 'edge:7', position: [1, 2, 3], length: 20 }],
        },
        {
          id: 'shell-1', type: 'feature', featureType: 'shell', label: 'Shell', icon: '',
          params: { wallThickness: 2, openFace: 1 },
          paramExpressions: { wallThickness: '=WALL' },
          enabled: true, expanded: true, parentId: 'hole-1', children: ['opaque-loft'],
          editingActive: false, timestamp: 3,
        },
        {
          id: 'opaque-loft', type: 'feature', featureType: 'boundarySurface', label: 'Boundary surface', icon: '',
          params: { sections: 3 }, enabled: true, expanded: true, parentId: 'shell-1',
          children: [], editingActive: false, timestamp: 4,
          sketchData: { profile: { closed: true, segments: [] }, customFutureField: { keep: 'exactly' } },
        },
      ],
    },
    scene: {
      selectedId: 'box', params: { width: 100, height: 40, depth: 60 },
      paramExpressions: {}, materialId: 'steel', color: '#777', isSketchMode: false,
      sketchPlane: 'xy', sketchProfile: { segments: [], closed: false },
      sketchConfig: { mode: 'extrude', depth: 10 },
    },
    referenceGeometry: [{ id: 'axis-a', kind: 'axis', exactFuturePayload: [1, 2, 3] }],
  };
}

describe('mechanicalDesignGraph', () => {
  it('builds a deterministic revision while retaining the exact source payload', async () => {
    const graph = await buildMechanicalDesignGraph(project());
    expect(graph.revisionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(graph.base).toMatchObject({ id: 'root-stable', shapeId: 'box' });
    expect(graph.nodes.map(node => node.id)).toEqual(['root-stable', 'hole-1', 'shell-1', 'opaque-loft']);
    expect(graph.nodes[1]).toMatchObject({ kind: 'hole', hasSelectionBinding: true });
    expect(graph.nodes[2]?.expressionKeys).toEqual(['wallThickness']);
    expect(graph.nodes[3]?.source).toMatchObject({
      sketchData: { customFutureField: { keep: 'exactly' } },
    });

    const reordered = {
      ...project(),
      name: 'a display-only name',
      updatedAt: 999,
      meta: { displayOnly: true },
      scene: { ...project().scene, cameraPosition: [9, 8, 7], activeTab: 'optimize' },
    };
    expect((await buildMechanicalDesignGraph(reordered)).revisionSha256).toBe(graph.revisionSha256);
  });

  it('keeps ids and opaque payload byte-canonical through three revision-bound patch cycles', async () => {
    const initial = await buildMechanicalDesignGraph(project());
    const opaqueBefore = canonicalizeMechanicalDesign(initial.nodes.find(node => node.id === 'opaque-loft')?.source);
    const refsBefore = canonicalizeMechanicalDesign(initial.sourceProject.referenceGeometry);

    const first = await applyMechanicalDesignPatch(initial, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: initial.revisionSha256,
      operations: [{ op: 'set_parameter', targetId: 'hole-1', parameter: 'diameter', expectedValue: 8, value: 9 }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await applyMechanicalDesignPatch(first.graph, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: first.graph.revisionSha256,
      operations: [{ op: 'set_parameter', targetId: 'root-stable', parameter: 'width', expectedValue: 100, value: 110 }],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const third = await applyMechanicalDesignPatch(second.graph, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: second.graph.revisionSha256,
      operations: [{ op: 'set_enabled', targetId: 'hole-1', expectedEnabled: true, enabled: false }],
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    expect(new Set(third.graph.nodes.map(node => node.id)).size).toBe(4);
    expect(third.graph.nodes.find(node => node.id === 'hole-1')).toMatchObject({
      enabled: false,
      params: { diameter: 9, posX: 12, posZ: -4 },
      hasSelectionBinding: true,
    });
    expect(third.graph.base.params.width).toBe(110);
    expect(canonicalizeMechanicalDesign(third.graph.nodes.find(node => node.id === 'opaque-loft')?.source)).toBe(opaqueBefore);
    expect(canonicalizeMechanicalDesign(third.graph.sourceProject.referenceGeometry)).toBe(refsBefore);
    expect(first.graph.parentRevisionSha256).toBe(initial.revisionSha256);
    expect(second.graph.parentRevisionSha256).toBe(first.graph.revisionSha256);
    expect(third.graph.parentRevisionSha256).toBe(second.graph.revisionSha256);
    expect(new Set([initial, first.graph, second.graph, third.graph].map(graph => graph.revisionSha256)).size).toBe(4);
  });

  it('rejects stale, opaque, expression-driven, and locked edits atomically', async () => {
    const graph = await buildMechanicalDesignGraph(project());
    const stale = await applyMechanicalDesignPatch(graph, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: '0'.repeat(64),
      operations: [{ op: 'set_parameter', targetId: 'hole-1', parameter: 'diameter', expectedValue: 8, value: 12 }],
    });
    expect(stale).toMatchObject({ ok: false, errors: ['PATCH_BASE_REVISION_STALE'] });

    const rejected = await applyMechanicalDesignPatch(graph, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: graph.revisionSha256,
      operations: [
        { op: 'set_parameter', targetId: 'hole-1', parameter: 'diameter', expectedValue: 8, value: 12 },
        { op: 'set_parameter', targetId: 'opaque-loft', parameter: 'sections', expectedValue: 3, value: 4 },
        { op: 'set_parameter', targetId: 'shell-1', parameter: 'wallThickness', expectedValue: 2, value: 3 },
      ],
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.errors).toContain('PATCH_OPERATION_1_TARGET_OPAQUE:boundarySurface');
    expect(rejected.errors).toContain('PATCH_OPERATION_2_EXPRESSION_DRIVEN');
    expect(rejected.graph.nodes.find(node => node.id === 'hole-1')?.params.diameter).toBe(8);

    const locked = await applyMechanicalDesignPatch(graph, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: graph.revisionSha256,
      operations: [{ op: 'set_parameter', targetId: 'hole-1', parameter: 'diameter', expectedValue: 8, value: 10 }],
    }, { lockedParameters: [{ targetId: 'hole-1', parameter: 'diameter' }] });
    expect(locked).toMatchObject({ ok: false, errors: ['PATCH_OPERATION_0_PARAMETER_LOCKED'] });

    const noChange = await applyMechanicalDesignPatch(graph, {
      schema: MECHANICAL_DESIGN_PATCH_SCHEMA,
      baseRevisionSha256: graph.revisionSha256,
      operations: [{ op: 'set_parameter', targetId: 'hole-1', parameter: 'diameter', expectedValue: 8, value: 8 }],
    });
    expect(noChange).toMatchObject({ ok: false, errors: ['PATCH_OPERATION_0_NO_CHANGE'] });
  });
});
