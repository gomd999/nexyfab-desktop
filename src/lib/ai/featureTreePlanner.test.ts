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
