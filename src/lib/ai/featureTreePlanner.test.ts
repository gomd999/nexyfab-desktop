/**
 * featureTreePlanner — Phase 3.AI tests for the multi-step plan generator.
 *
 * Covers all 6 PlanIntent kinds + dependency wiring + warnings + rationale.
 */
import { describe, it, expect } from 'vitest';
import {
  planFromIntent,
  FeatureTreePlannerError,
  type PlanIntent,
  type PlanResult,
} from './featureTreePlanner';
import type {
  FeatureTree,
  FeatureNode,
} from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { FilletFeature } from '@/lib/cad/filletProfile';
import type { ChamferFeature } from '@/lib/cad/chamferProfile';
import type { HoleFeature } from '@/lib/cad/holeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type {
  LinearPatternFeature,
  CircularPatternFeature,
} from '@/lib/cad/pattern';

// ─── fixtures ─────────────────────────────────────────────────────────────

const EMPTY: FeatureTree = { nodes: [] };

function boxNode(id: string, w = 50, h = 50, d = 30): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    depth: d,
    direction: 'one_sided',
    mode: 'add',
  };
  return { id, name: 'Box', dependencies: [], payload };
}

function holeNode(id: string, parentId: string): FeatureNode {
  const payload: HoleFeature = {
    kind: 'hole',
    center: { x: 10, y: 10 },
    holeType: 'drilled',
    diameter: 5,
    depth: 20,
  };
  return { id, name: 'Hole', dependencies: [parentId], payload };
}

// ─── create_box_with_holes ───────────────────────────────────────────────

describe('planFromIntent — create_box_with_holes', () => {
  it('emits box + N holes with dependencies wired to box', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_holes',
      size: { x: 100, y: 50, z: 20 },
      holes: [
        { x: 25, y: 25, diameter: 6 },
        { x: 75, y: 25, diameter: 6 },
      ],
    };
    const r: PlanResult = planFromIntent(intent, EMPTY);
    expect(r.steps).toHaveLength(3);
    expect(r.steps[0]!.type).toBe('add_node');
    expect(r.steps[0]!.node!.payload.kind).toBe('extrude');
    const boxId = r.steps[0]!.node!.id;
    expect(r.steps[1]!.node!.payload.kind).toBe('hole');
    expect(r.steps[1]!.node!.dependencies).toEqual([boxId]);
    expect(r.steps[2]!.node!.dependencies).toEqual([boxId]);
    expect(r.rationale).toMatch(/box/i);
  });

  it('warns when holes[] is empty', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_holes',
      size: { x: 50, y: 50, z: 10 },
      holes: [],
    };
    const r = planFromIntent(intent, EMPTY);
    expect(r.steps).toHaveLength(1); // box only
    expect(r.warnings.join(' ')).toMatch(/empty holes/);
  });

  it('skips holes with non-positive diameter and emits warning', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_holes',
      size: { x: 50, y: 50, z: 10 },
      holes: [
        { x: 10, y: 10, diameter: 5 },
        { x: 20, y: 20, diameter: 0 },
        { x: 30, y: 30, diameter: -1 },
      ],
    };
    const r = planFromIntent(intent, EMPTY);
    expect(r.steps).toHaveLength(2); // box + 1 valid hole
    expect(r.warnings.filter((w) => w.includes('non-positive')).length).toBe(2);
  });

  it('hole depth uses size.z', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_holes',
      size: { x: 40, y: 40, z: 15 },
      holes: [{ x: 10, y: 10, diameter: 4 }],
    };
    const r = planFromIntent(intent, EMPTY);
    const hole = r.steps[1]!.node!.payload as HoleFeature;
    expect(hole.depth).toBe(15);
  });

  it('uses unique ids when tree already has nodes', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    const intent: PlanIntent = {
      kind: 'create_box_with_holes',
      size: { x: 30, y: 30, z: 10 },
      holes: [{ x: 10, y: 10, diameter: 4 }],
    };
    const r = planFromIntent(intent, tree);
    expect(r.steps[0]!.node!.id).not.toBe('box_1');
  });
});

// ─── create_box_with_fillet ──────────────────────────────────────────────

describe('planFromIntent — create_box_with_fillet', () => {
  it('emits box + fillet, fillet depends on box', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_fillet',
      size: { x: 50, y: 50, z: 30 },
      filletRadius: 5,
    };
    const r = planFromIntent(intent, EMPTY);
    expect(r.steps).toHaveLength(2);
    const boxId = r.steps[0]!.node!.id;
    const fillet = r.steps[1]!.node!;
    expect(fillet.payload.kind).toBe('fillet');
    expect(fillet.dependencies).toEqual([boxId]);
    const payload = fillet.payload as FilletFeature;
    expect(payload.radius).toBe(5);
    expect(payload.edgeSelection).toBe('all');
  });

  it('throws when filletRadius is non-positive', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_fillet',
      size: { x: 50, y: 50, z: 30 },
      filletRadius: 0,
    };
    expect(() => planFromIntent(intent, EMPTY)).toThrow(FeatureTreePlannerError);
  });

  it('warns when filletRadius >= min(size)/2 (would fail at build)', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_fillet',
      size: { x: 10, y: 10, z: 10 },
      filletRadius: 8,
    };
    const r = planFromIntent(intent, EMPTY);
    expect(r.warnings.some((w) => w.includes('build time'))).toBe(true);
  });

  it('fillet wraps the box ExtrudeFeature as childExtrude', () => {
    const intent: PlanIntent = {
      kind: 'create_box_with_fillet',
      size: { x: 40, y: 40, z: 20 },
      filletRadius: 3,
    };
    const r = planFromIntent(intent, EMPTY);
    const boxPayload = r.steps[0]!.node!.payload as ExtrudeFeature;
    const filletPayload = r.steps[1]!.node!.payload as FilletFeature;
    expect(filletPayload.childExtrude).toBe(boxPayload);
  });
});

// ─── create_cylinder ─────────────────────────────────────────────────────

describe('planFromIntent — create_cylinder', () => {
  it('emits a single revolve node with 360° sweep', () => {
    const intent: PlanIntent = { kind: 'create_cylinder', radius: 25, height: 60 };
    const r = planFromIntent(intent, EMPTY);
    expect(r.steps).toHaveLength(1);
    const payload = r.steps[0]!.node!.payload as RevolveFeature;
    expect(payload.kind).toBe('revolve');
    expect(payload.angleDegrees).toBe(360);
  });

  it('throws on non-positive radius', () => {
    expect(() =>
      planFromIntent({ kind: 'create_cylinder', radius: 0, height: 10 }, EMPTY),
    ).toThrow(FeatureTreePlannerError);
  });

  it('throws on non-positive height', () => {
    expect(() =>
      planFromIntent({ kind: 'create_cylinder', radius: 10, height: -1 }, EMPTY),
    ).toThrow(FeatureTreePlannerError);
  });
});

// ─── add_fillet_to_last ──────────────────────────────────────────────────

describe('planFromIntent — add_fillet_to_last', () => {
  it('appends fillet to existing extrude', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    const r = planFromIntent({ kind: 'add_fillet_to_last', radius: 3 }, tree);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.node!.payload.kind).toBe('fillet');
    expect(r.steps[0]!.node!.dependencies).toEqual(['box_1']);
  });

  it('emits warning + empty steps when tree has no extrude', () => {
    const r = planFromIntent({ kind: 'add_fillet_to_last', radius: 3 }, EMPTY);
    expect(r.steps).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('no extrude'))).toBe(true);
  });

  it('picks the *last* extrude when multiple exist', () => {
    const tree: FeatureTree = {
      nodes: [boxNode('box_1'), boxNode('box_2')],
    };
    const r = planFromIntent({ kind: 'add_fillet_to_last', radius: 3 }, tree);
    expect(r.steps[0]!.node!.dependencies).toEqual(['box_2']);
  });

  it('throws on non-positive radius', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    expect(() =>
      planFromIntent({ kind: 'add_fillet_to_last', radius: 0 }, tree),
    ).toThrow(FeatureTreePlannerError);
  });

  it('skips non-extrude nodes when looking for parent', () => {
    const tree: FeatureTree = {
      nodes: [boxNode('box_1'), holeNode('hole_1', 'box_1')],
    };
    const r = planFromIntent({ kind: 'add_fillet_to_last', radius: 2 }, tree);
    expect(r.steps[0]!.node!.dependencies).toEqual(['box_1']);
  });
});

// ─── add_chamfer_to_last ─────────────────────────────────────────────────

describe('planFromIntent — add_chamfer_to_last', () => {
  it('appends chamfer to last extrude', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    const r = planFromIntent({ kind: 'add_chamfer_to_last', distance: 2 }, tree);
    expect(r.steps).toHaveLength(1);
    const payload = r.steps[0]!.node!.payload as ChamferFeature;
    expect(payload.kind).toBe('chamfer');
    expect(payload.distance).toBe(2);
  });

  it('warns when no extrude exists', () => {
    const r = planFromIntent({ kind: 'add_chamfer_to_last', distance: 2 }, EMPTY);
    expect(r.steps).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('no extrude'))).toBe(true);
  });

  it('throws on non-positive distance', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    expect(() =>
      planFromIntent({ kind: 'add_chamfer_to_last', distance: -1 }, tree),
    ).toThrow(FeatureTreePlannerError);
  });
});

// ─── create_assembly_stack ───────────────────────────────────────────────

describe('planFromIntent — create_assembly_stack', () => {
  it('emits N box nodes', () => {
    const r = planFromIntent(
      { kind: 'create_assembly_stack', partCount: 3, spacing: 5 },
      EMPTY,
    );
    expect(r.steps).toHaveLength(3);
    for (const s of r.steps) {
      expect(s.node!.payload.kind).toBe('extrude');
    }
  });

  it('throws on non-integer partCount', () => {
    expect(() =>
      planFromIntent(
        { kind: 'create_assembly_stack', partCount: 2.5, spacing: 1 },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('warns on very large partCount', () => {
    const r = planFromIntent(
      { kind: 'create_assembly_stack', partCount: 50, spacing: 1 },
      EMPTY,
    );
    expect(r.warnings.some((w) => w.includes('large partCount'))).toBe(true);
  });
});

// ─── rationale + warnings sanity ─────────────────────────────────────────

describe('planFromIntent — rationale + warnings', () => {
  it('rationale contains key parameters for box-with-fillet', () => {
    const r = planFromIntent(
      { kind: 'create_box_with_fillet', size: { x: 50, y: 50, z: 30 }, filletRadius: 5 },
      EMPTY,
    );
    expect(r.rationale).toContain('50');
    expect(r.rationale).toContain('30');
    expect(r.rationale).toContain('5');
  });

  it('warns about extreme box sizes (likely unit mismatch)', () => {
    const r = planFromIntent(
      {
        kind: 'create_box_with_holes',
        size: { x: 50_000, y: 50, z: 30 },
        holes: [{ x: 100, y: 25, diameter: 5 }],
      },
      EMPTY,
    );
    expect(r.warnings.some((w) => w.includes('unit-mismatch'))).toBe(true);
  });
});

// ─── Phase 3.AI.2 — create_box_with_chamfer ──────────────────────────────

describe('planFromIntent — create_box_with_chamfer', () => {
  it('emits box + chamfer node depending on the box', () => {
    const r = planFromIntent(
      {
        kind: 'create_box_with_chamfer',
        size: { x: 50, y: 50, z: 30 },
        chamferDistance: 2,
      },
      EMPTY,
    );
    expect(r.steps).toHaveLength(2);
    const boxId = r.steps[0]!.node!.id;
    const chamfer = r.steps[1]!.node!;
    expect(chamfer.payload.kind).toBe('chamfer');
    expect(chamfer.dependencies).toEqual([boxId]);
    expect((chamfer.payload as ChamferFeature).distance).toBe(2);
  });

  it('throws when chamferDistance is non-positive', () => {
    expect(() =>
      planFromIntent(
        { kind: 'create_box_with_chamfer', size: { x: 10, y: 10, z: 10 }, chamferDistance: 0 },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('warns when chamferDistance ≥ min(size)/2', () => {
    const r = planFromIntent(
      {
        kind: 'create_box_with_chamfer',
        size: { x: 10, y: 10, z: 10 },
        chamferDistance: 6,
      },
      EMPTY,
    );
    expect(r.warnings.some((w) => w.includes('build time'))).toBe(true);
  });
});

// ─── Phase 3.AI.2 — create_box_with_pocket ───────────────────────────────

describe('planFromIntent — create_box_with_pocket', () => {
  it('emits box + centred pocket (modelled as a hole)', () => {
    const r = planFromIntent(
      {
        kind: 'create_box_with_pocket',
        size: { x: 50, y: 50, z: 30 },
        pocketDepth: 10,
        pocketRadius: 5,
      },
      EMPTY,
    );
    expect(r.steps).toHaveLength(2);
    const boxId = r.steps[0]!.node!.id;
    const pocket = r.steps[1]!.node!.payload as HoleFeature;
    expect(pocket.kind).toBe('hole');
    expect(pocket.diameter).toBe(10); // 2 * pocketRadius
    expect(pocket.depth).toBe(10);
    expect(pocket.center).toEqual({ x: 25, y: 25 });
    expect(r.steps[1]!.node!.dependencies).toEqual([boxId]);
  });

  it('throws on non-positive pocketDepth / pocketRadius', () => {
    expect(() =>
      planFromIntent(
        {
          kind: 'create_box_with_pocket',
          size: { x: 50, y: 50, z: 30 },
          pocketDepth: 0,
          pocketRadius: 5,
        },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
    expect(() =>
      planFromIntent(
        {
          kind: 'create_box_with_pocket',
          size: { x: 50, y: 50, z: 30 },
          pocketDepth: 10,
          pocketRadius: -1,
        },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('warns when pocket would breach (depth ≥ size.z or radius ≥ min/2)', () => {
    const r = planFromIntent(
      {
        kind: 'create_box_with_pocket',
        size: { x: 20, y: 20, z: 10 },
        pocketDepth: 20,
        pocketRadius: 15,
      },
      EMPTY,
    );
    expect(r.warnings.some((w) => w.includes('punch through'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('side walls'))).toBe(true);
  });
});

// ─── Phase 3.AI.2 — create_cylinder_with_hole ────────────────────────────

describe('planFromIntent — create_cylinder_with_hole', () => {
  it('emits cylinder (revolve) + concentric hole', () => {
    const r = planFromIntent(
      { kind: 'create_cylinder_with_hole', radius: 25, height: 60, holeRadius: 10 },
      EMPTY,
    );
    expect(r.steps).toHaveLength(2);
    const cyl = r.steps[0]!.node!.payload as RevolveFeature;
    expect(cyl.kind).toBe('revolve');
    expect(cyl.angleDegrees).toBe(360);
    const hole = r.steps[1]!.node!.payload as HoleFeature;
    expect(hole.kind).toBe('hole');
    expect(hole.diameter).toBe(20); // 2 * holeRadius
    expect(hole.depth).toBe(60);
    expect(hole.center).toEqual({ x: 0, y: 0 });
  });

  it('throws on non-positive inputs', () => {
    expect(() =>
      planFromIntent(
        { kind: 'create_cylinder_with_hole', radius: 0, height: 10, holeRadius: 1 },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('warns when holeRadius ≥ radius', () => {
    const r = planFromIntent(
      { kind: 'create_cylinder_with_hole', radius: 10, height: 20, holeRadius: 12 },
      EMPTY,
    );
    expect(r.warnings.some((w) => w.includes('cylinder wall'))).toBe(true);
  });
});

// ─── Phase 3.AI.2 — create_pattern_grid ──────────────────────────────────

describe('planFromIntent — create_pattern_grid', () => {
  it('emits base + 2 nested linear patterns for box base', () => {
    const r = planFromIntent(
      {
        kind: 'create_pattern_grid',
        baseFeature: 'extrude_box',
        count: { x: 3, y: 3 },
        spacing: 100,
      },
      EMPTY,
    );
    expect(r.steps).toHaveLength(3);
    expect(r.steps[0]!.node!.payload.kind).toBe('extrude');
    expect(r.steps[1]!.node!.payload.kind).toBe('linear_pattern');
    expect(r.steps[2]!.node!.payload.kind).toBe('linear_pattern');
    const xPat = r.steps[1]!.node!.payload as LinearPatternFeature;
    expect(xPat.count).toBe(3);
    expect(xPat.spacing).toBe(100);
    expect(xPat.direction).toEqual({ x: 1, y: 0, z: 0 });
    const yPat = r.steps[2]!.node!.payload as LinearPatternFeature;
    expect(yPat.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(r.steps[2]!.node!.dependencies).toEqual([r.steps[1]!.node!.id]);
  });

  it('emits cylinder base when baseFeature is "cylinder"', () => {
    const r = planFromIntent(
      {
        kind: 'create_pattern_grid',
        baseFeature: 'cylinder',
        count: { x: 2, y: 2 },
        spacing: 30,
      },
      EMPTY,
    );
    expect(r.steps[0]!.node!.payload.kind).toBe('revolve');
  });

  it('throws on non-integer/non-positive counts', () => {
    expect(() =>
      planFromIntent(
        {
          kind: 'create_pattern_grid',
          baseFeature: 'extrude_box',
          count: { x: 0, y: 3 },
          spacing: 10,
        },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('warns on very large grids', () => {
    const r = planFromIntent(
      {
        kind: 'create_pattern_grid',
        baseFeature: 'extrude_box',
        count: { x: 20, y: 20 },
        spacing: 10,
      },
      EMPTY,
    );
    expect(r.warnings.some((w) => w.includes('large grid'))).toBe(true);
  });
});

// ─── Phase 3.AI.2 — create_revolve_axis ──────────────────────────────────

describe('planFromIntent — create_revolve_axis', () => {
  it('emits a rectangle-profile revolve with 4 loop points', () => {
    const r = planFromIntent(
      { kind: 'create_revolve_axis', profile: 'rectangle', radius: 10, height: 20 },
      EMPTY,
    );
    expect(r.steps).toHaveLength(1);
    const payload = r.steps[0]!.node!.payload as RevolveFeature;
    expect(payload.kind).toBe('revolve');
    expect(payload.loop).toHaveLength(4);
  });

  it('emits a triangle-profile revolve with 3 loop points', () => {
    const r = planFromIntent(
      { kind: 'create_revolve_axis', profile: 'triangle', radius: 25, height: 60 },
      EMPTY,
    );
    const payload = r.steps[0]!.node!.payload as RevolveFeature;
    expect(payload.loop).toHaveLength(3);
  });

  it('throws on non-positive radius/height', () => {
    expect(() =>
      planFromIntent(
        { kind: 'create_revolve_axis', profile: 'triangle', radius: -1, height: 10 },
        EMPTY,
      ),
    ).toThrow(FeatureTreePlannerError);
  });
});

// ─── Phase 3.AI.2 — add_pattern_to_last ──────────────────────────────────

describe('planFromIntent — add_pattern_to_last', () => {
  it('appends a linear pattern depending on the last solid', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    const r = planFromIntent(
      { kind: 'add_pattern_to_last', patternKind: 'linear', count: 5, spacing: 50 },
      tree,
    );
    expect(r.steps).toHaveLength(1);
    const payload = r.steps[0]!.node!.payload as LinearPatternFeature;
    expect(payload.kind).toBe('linear_pattern');
    expect(payload.count).toBe(5);
    expect(payload.spacing).toBe(50);
    expect(r.steps[0]!.node!.dependencies).toEqual(['box_1']);
  });

  it('appends a circular pattern (default 360°)', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    const r = planFromIntent(
      { kind: 'add_pattern_to_last', patternKind: 'circular', count: 8 },
      tree,
    );
    const payload = r.steps[0]!.node!.payload as CircularPatternFeature;
    expect(payload.kind).toBe('circular_pattern');
    expect(payload.count).toBe(8);
    expect(payload.totalAngleDegrees).toBe(360);
  });

  it('honours explicit angle for circular pattern', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    const r = planFromIntent(
      { kind: 'add_pattern_to_last', patternKind: 'circular', count: 6, angle: 180 },
      tree,
    );
    const payload = r.steps[0]!.node!.payload as CircularPatternFeature;
    expect(payload.totalAngleDegrees).toBe(180);
  });

  it('warns + empty steps when no solid feature exists', () => {
    const r = planFromIntent(
      { kind: 'add_pattern_to_last', patternKind: 'linear', count: 3, spacing: 10 },
      EMPTY,
    );
    expect(r.steps).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('no solid'))).toBe(true);
  });

  it('throws on count < 2', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    expect(() =>
      planFromIntent(
        { kind: 'add_pattern_to_last', patternKind: 'linear', count: 1, spacing: 10 },
        tree,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('throws when linear pattern omits spacing', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    expect(() =>
      planFromIntent(
        { kind: 'add_pattern_to_last', patternKind: 'linear', count: 3 },
        tree,
      ),
    ).toThrow(FeatureTreePlannerError);
  });

  it('throws when circular angle is out of (0, 360]', () => {
    const tree: FeatureTree = { nodes: [boxNode('box_1')] };
    expect(() =>
      planFromIntent(
        { kind: 'add_pattern_to_last', patternKind: 'circular', count: 4, angle: 400 },
        tree,
      ),
    ).toThrow(FeatureTreePlannerError);
  });
});
