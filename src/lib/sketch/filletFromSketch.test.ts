/**
 * filletFromSketch — end-to-end Phase 2.2 pipeline tests for fillet.
 *
 * Mirror of shellFromSketch.test.ts. Pure unit tests, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { filletFromSketch } from './filletFromSketch';
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

describe('filletFromSketch', () => {
  it('rect profile + all edges → SCAD with minkowski + sphere', () => {
    const r = filletFromSketch(rectSketch(), { depth: 20, radius: 1, edgeSelection: 'all' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('minkowski()');
      expect(r.scad).toContain('NEXYFAB:FILLET');
      expect(r.scad).toContain('sphere');
      expect(r.fillet.radius).toBe(1);
      expect(r.fillet.edgeSelection).toBe('all');
    }
  });

  it('vertical edges → SCAD with $fn=32 cylinder seed', () => {
    const r = filletFromSketch(rectSketch(), {
      depth: 20,
      radius: 1,
      edgeSelection: 'vertical',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/cylinder\(r=1.*\$fn=32\)/);
      expect(r.fillet.edgeSelection).toBe('vertical');
    }
  });

  it('top edges → SCAD with union + crown', () => {
    const r = filletFromSketch(rectSketch(), { depth: 20, radius: 1, edgeSelection: 'top' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('minkowski()');
    }
  });

  it('produces a stable feature envelope comment for downstream parsers', () => {
    const r = filletFromSketch(rectSketch(), { depth: 20, radius: 1, edgeSelection: 'all' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/^\/\/ === fillet_1 \(Fillet\) ===/);
    }
  });

  it('respects custom featureName in envelope', () => {
    const r = filletFromSketch(rectSketch(), {
      depth: 20,
      radius: 1,
      edgeSelection: 'all',
      featureName: 'MyFillet',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/^\/\/ === fillet_1 \(MyFillet\) ===/);
    }
  });

  it('returns error for non-positive depth', () => {
    const r = filletFromSketch(rectSketch(), { depth: 0, radius: 1, edgeSelection: 'all' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/depth/);
  });

  it('returns error for non-positive radius', () => {
    const r = filletFromSketch(rectSketch(), { depth: 20, radius: 0, edgeSelection: 'all' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/radius/);
  });

  it('returns error for empty sketch', () => {
    const r = filletFromSketch(
      { points: [], lines: [] },
      { depth: 20, radius: 1, edgeSelection: 'all' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed loop/i);
  });

  it('Phase 2: accepts triangle (3-vertex) profile and emits polygon SCAD', () => {
    const r = filletFromSketch(triangleSketch(), {
      depth: 20,
      radius: 0.3,
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
    const r = filletFromSketch(concaveSketch, {
      depth: 20,
      radius: 1,
      edgeSelection: 'vertical',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/convex/i);
  });

  it('returns error when radius exceeds geometric bounds', () => {
    // rect 10×5 → min/2 = 2.5; radius 3 must fail at the IR builder.
    const r = filletFromSketch(rectSketch(), { depth: 20, radius: 3, edgeSelection: 'vertical' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bbox|2\.5/);
  });
});
