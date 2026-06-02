/**
 * chamferFromSketch — end-to-end Phase 2.2 pipeline tests for chamfer.
 *
 * Mirror of filletFromSketch.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { chamferFromSketch } from './chamferFromSketch';
import type { SolverViewState } from './solverToProfile';

function rectSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 5 },
      { id: 'p4', x: 0, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

function triangleSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 5, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p1' },
    ],
  };
}

describe('chamferFromSketch', () => {
  it('rect profile + all edges → SCAD with minkowski + polyhedron', () => {
    const r = chamferFromSketch(rectSketch(), {
      depth: 20,
      distance: 1,
      edgeSelection: 'all',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('minkowski()');
      expect(r.scad).toContain('NEXYFAB:CHAMFER');
      expect(r.scad).toContain('polyhedron(');
      expect(r.chamfer.distance).toBe(1);
      expect(r.chamfer.edgeSelection).toBe('all');
    }
  });

  it('vertical edges → SCAD with rotated $fn=4 cylinder seed', () => {
    const r = chamferFromSketch(rectSketch(), {
      depth: 20,
      distance: 1,
      edgeSelection: 'vertical',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('rotate([0, 0, 45])');
      expect(r.scad).toMatch(/cylinder\(.*\$fn=4\)/);
      expect(r.chamfer.edgeSelection).toBe('vertical');
    }
  });

  it('top edges → SCAD with union + crown', () => {
    const r = chamferFromSketch(rectSketch(), {
      depth: 20,
      distance: 1,
      edgeSelection: 'top',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('minkowski()');
    }
  });

  it('produces a stable feature envelope comment for downstream parsers', () => {
    const r = chamferFromSketch(rectSketch(), {
      depth: 20,
      distance: 1,
      edgeSelection: 'all',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/^\/\/ === chamfer_1 \(Chamfer\) ===/);
    }
  });

  it('respects custom featureName in envelope', () => {
    const r = chamferFromSketch(rectSketch(), {
      depth: 20,
      distance: 1,
      edgeSelection: 'all',
      featureName: 'MyChamfer',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/^\/\/ === chamfer_1 \(MyChamfer\) ===/);
    }
  });

  it('returns error for non-positive depth', () => {
    const r = chamferFromSketch(rectSketch(), { depth: 0, distance: 1, edgeSelection: 'all' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/depth/);
  });

  it('returns error for non-positive distance', () => {
    const r = chamferFromSketch(rectSketch(), { depth: 20, distance: 0, edgeSelection: 'all' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/distance/);
  });

  it('returns error for empty sketch', () => {
    const r = chamferFromSketch(
      { points: [], lines: [] },
      { depth: 20, distance: 1, edgeSelection: 'all' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed loop/i);
  });

  it('Phase 2: accepts triangle (3-vertex) profile and emits polygon SCAD', () => {
    const r = chamferFromSketch(triangleSketch(), {
      depth: 20,
      distance: 0.3,
      edgeSelection: 'vertical',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('minkowski()');
      expect(r.scad).toContain('polygon(');
      expect(r.scad).not.toContain('cube(');
    }
  });

  it('Phase 2: rejects concave profile with convex-required error', () => {
    const concaveSketch = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 5, y: 3 },
        { id: 'p4', x: 10, y: 10 },
        { id: 'p5', x: 0, y: 10 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p5' },
        { id: 'l5', p1: 'p5', p2: 'p1' },
      ],
    };
    const r = chamferFromSketch(concaveSketch, {
      depth: 20,
      distance: 1,
      edgeSelection: 'vertical',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/convex/i);
  });

  it('returns error when distance exceeds geometric bounds', () => {
    const r = chamferFromSketch(rectSketch(), {
      depth: 20,
      distance: 3,
      edgeSelection: 'vertical',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bbox|2\.5/);
  });
});
