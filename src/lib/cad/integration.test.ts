/**
 * Phase 2.A partial — end-to-end integration test.
 *
 * Wires all Phase 1 + Phase 2 modules into a single pipeline:
 *
 *   SketchSolver (planegcs)
 *      ↓ build rect, pin with H/V constraints
 *      ↓ derive ProfileInput from solver state
 *   extractClosedLoops
 *      ↓ ClosedLoop
 *   buildExtrudeFromLoop
 *      ↓ ExtrudeFeature
 *   wrap as FeatureNode → FeatureTree
 *   replayTree → SCAD source
 *
 * This is the "stack works" gate before continuing Phase 2 in depth. It
 * also serves as a recipe for the SolverSketchEditor → 3D viewport
 * pipeline (Phase 2.A full deliverable).
 */
import { describe, it, expect } from 'vitest';
import { createSketchSolver } from '@/lib/sketch/solver';
import { extractClosedLoops, type ProfileInput, type ProfilePoint } from '@/lib/sketch/sketchProfile';
import { buildExtrudeFromLoop, type ExtrudeFeature } from './extrudeProfile';
import { replayTree, type FeatureTree } from './featureTree';
import { buildLinearPattern } from './pattern';
import { applyEdit } from './featureTreeEdit';

describe('Phase 2.A integration — sketch → extrude → tree → SCAD', () => {
  it('rect sketch + extrude → tree → SCAD source contains linear_extrude polygon', async () => {
    const solver = await createSketchSolver();
    try {
      // Build a 20×10 rect at origin, fully constrained by H/V + fixed corner.
      const p1 = solver.addPoint(0, 0, { fixed: true });
      const p2 = solver.addPoint(20, 0);
      const p3 = solver.addPoint(20, 10);
      const p4 = solver.addPoint(0, 10);
      const top = solver.addLine(p1, p2);
      const right = solver.addLine(p2, p3);
      const bottom = solver.addLine(p4, p3);
      const left = solver.addLine(p1, p4);
      solver.addHorizontal(top);
      solver.addHorizontal(bottom);
      solver.addVertical(left);
      solver.addVertical(right);
      solver.addDistance(p1, p2, 20);
      solver.addDistance(p1, p4, 10);
      const r = solver.solve();
      expect(r.success).toBe(true);
      expect(r.dof).toBe(0);

      // Extract ProfileInput from solver state.
      const points: ProfilePoint[] = [
        { id: p1, x: solver.point(p1).x, y: solver.point(p1).y },
        { id: p2, x: solver.point(p2).x, y: solver.point(p2).y },
        { id: p3, x: solver.point(p3).x, y: solver.point(p3).y },
        { id: p4, x: solver.point(p4).x, y: solver.point(p4).y },
      ];
      const profileInput: ProfileInput = {
        points,
        lines: [
          { id: top, p1: p1, p2: p2 },
          { id: right, p1: p2, p2: p3 },
          { id: bottom, p1: p4, p2: p3 },
          { id: left, p1: p1, p2: p4 },
        ],
      };

      const extraction = extractClosedLoops(profileInput);
      expect(extraction.loops.length).toBe(1);
      expect(extraction.danglingLines).toEqual([]);

      // Build extrude IR.
      const pointById = new Map(points.map((p) => [p.id, p]));
      const extrude: ExtrudeFeature = buildExtrudeFromLoop(extraction.loops[0]!, pointById, {
        depth: 8,
      });

      // Wrap in FeatureTree.
      const tree: FeatureTree = {
        nodes: [
          {
            id: 'base',
            name: 'Base Plate',
            dependencies: [],
            payload: extrude,
          },
        ],
      };

      // Replay → SCAD source.
      const result = replayTree(tree);
      expect(result.scad).toContain('// === base (Base Plate) ===');
      expect(result.scad).toContain('linear_extrude(height=8');
      expect(result.scad).toContain('polygon(');
      // All 4 corners of the rect should appear.
      expect(result.scad).toMatch(/\[0,\s*0\]/);
      expect(result.scad).toMatch(/\[20,\s*0\]/);
      expect(result.scad).toMatch(/\[20,\s*10\]/);
      expect(result.scad).toMatch(/\[0,\s*10\]/);
    } finally {
      solver.destroy();
    }
  });

  it('multi-node tree: extrude + linear pattern of cube → ordered SCAD', async () => {
    const solver = await createSketchSolver();
    try {
      // Tiny rect → extrude → 4-copy linear pattern of a child cube.
      const p1 = solver.addPoint(0, 0, { fixed: true });
      const p2 = solver.addPoint(5, 0);
      const p3 = solver.addPoint(5, 5);
      const p4 = solver.addPoint(0, 5);
      solver.addLine(p1, p2);
      solver.addLine(p2, p3);
      solver.addLine(p4, p3);
      solver.addLine(p1, p4);
      solver.addDistance(p1, p2, 5);
      solver.addDistance(p1, p4, 5);
      solver.solve();

      const points: ProfilePoint[] = [
        { id: p1, x: 0, y: 0 },
        { id: p2, x: 5, y: 0 },
        { id: p3, x: 5, y: 5 },
        { id: p4, x: 0, y: 5 },
      ];
      const profileInput: ProfileInput = {
        points,
        lines: [
          { id: 'top', p1: p1, p2: p2 },
          { id: 'right', p1: p2, p2: p3 },
          { id: 'bottom', p1: p4, p2: p3 },
          { id: 'left', p1: p1, p2: p4 },
        ],
      };
      const loop = extractClosedLoops(profileInput).loops[0]!;
      const extrude = buildExtrudeFromLoop(loop, new Map(points.map((p) => [p.id, p])), {
        depth: 2,
      });
      const pattern = buildLinearPattern({
        childScad: 'cube([1, 1, 1]);',
        count: 4,
        direction: { x: 1, y: 0, z: 0 },
        spacing: 3,
      });

      const tree: FeatureTree = {
        nodes: [
          { id: 'base', name: 'Base', dependencies: [], payload: extrude },
          { id: 'arr', name: 'Cube Array', dependencies: ['base'], payload: pattern },
        ],
      };
      const result = replayTree(tree);
      // base comes before arr in the SCAD output.
      const baseIdx = result.scad.indexOf('// === base');
      const arrIdx = result.scad.indexOf('// === arr');
      expect(baseIdx).toBeGreaterThanOrEqual(0);
      expect(arrIdx).toBeGreaterThan(baseIdx);
      expect(result.emittedOrder).toEqual(['base', 'arr']);
    } finally {
      solver.destroy();
    }
  });

  it('edit op on tree: change extrude depth → replay reflects new value', async () => {
    const solver = await createSketchSolver();
    try {
      const p1 = solver.addPoint(0, 0, { fixed: true });
      const p2 = solver.addPoint(5, 0);
      const p3 = solver.addPoint(5, 5);
      const p4 = solver.addPoint(0, 5);
      solver.addLine(p1, p2);
      solver.addLine(p2, p3);
      solver.addLine(p4, p3);
      solver.addLine(p1, p4);
      solver.addDistance(p1, p2, 5);
      solver.addDistance(p1, p4, 5);
      solver.solve();
      const points: ProfilePoint[] = [
        { id: p1, x: 0, y: 0 },
        { id: p2, x: 5, y: 0 },
        { id: p3, x: 5, y: 5 },
        { id: p4, x: 0, y: 5 },
      ];
      const loop = extractClosedLoops({
        points,
        lines: [
          { id: 'l1', p1: p1, p2: p2 },
          { id: 'l2', p1: p2, p2: p3 },
          { id: 'l3', p1: p4, p2: p3 },
          { id: 'l4', p1: p1, p2: p4 },
        ],
      }).loops[0]!;
      const extrude5 = buildExtrudeFromLoop(loop, new Map(points.map((p) => [p.id, p])), {
        depth: 5,
      });
      const tree1: FeatureTree = {
        nodes: [{ id: 'base', name: 'Base', dependencies: [], payload: extrude5 }],
      };
      const r1 = replayTree(tree1);
      expect(r1.scad).toContain('height=5');

      const extrude20 = buildExtrudeFromLoop(loop, new Map(points.map((p) => [p.id, p])), {
        depth: 20,
      });
      const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'base', payload: extrude20 });
      const r2 = replayTree(tree2);
      expect(r2.scad).toContain('height=20');
      expect(r2.scad).not.toContain('height=5');
    } finally {
      solver.destroy();
    }
  });
});
