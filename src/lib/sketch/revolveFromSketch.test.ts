/**
 * revolveFromSketch — end-to-end Phase 2.A pipeline tests for revolve.
 *
 * Mirror of extrudeFromSketch.test.ts. Pure unit tests, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { revolveFromSketch } from './revolveFromSketch';
import type { SolverViewState } from './solverToProfile';

/**
 * Rect entirely on the right of x=0 (axis = Y). Suitable for revolve
 * because all points have x ≥ 0 (profile does not straddle the axis).
 */
function rectRightOfY(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 5, y: 0 },
      { id: 'p2', x: 20, y: 0 },
      { id: 'p3', x: 20, y: 10 },
      { id: 'p4', x: 5, y: 10 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

/** Axis = Y axis (line through origin pointing up). */
const Y_AXIS = { a: { x: 0, y: 0 }, b: { x: 0, y: 10 } };

describe('revolveFromSketch', () => {
  it('rect on +X side + Y axis + 360° → SCAD with rotate_extrude polygon', () => {
    const r = revolveFromSketch(rectRightOfY(), { axis: Y_AXIS });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('rotate_extrude(');
      expect(r.scad).toContain('polygon([');
      // Full revolve → no `angle=` clause.
      expect(r.scad).not.toMatch(/angle=/);
      expect(r.loop.points.length).toBe(4);
    }
  });

  it('partial sweep emits angle= clause', () => {
    const r = revolveFromSketch(rectRightOfY(), { axis: Y_AXIS, angleDegrees: 180 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('angle=180');
    }
  });

  it('mode=cut wraps the rotate_extrude with the CUT marker', () => {
    const r = revolveFromSketch(rectRightOfY(), { axis: Y_AXIS, mode: 'cut' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('NEXYFAB:REVOLVE_CUT');
    }
  });

  it('profile straddling the axis → ok=false (would self-intersect)', () => {
    const straddles: SolverViewState = {
      points: [
        { id: 'p1', x: -5, y: 0 },
        { id: 'p2', x: 5, y: 0 },
        { id: 'p3', x: 5, y: 10 },
        { id: 'p4', x: -5, y: 10 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p1' },
      ],
    };
    const r = revolveFromSketch(straddles, { axis: Y_AXIS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/straddles/i);
    }
  });

  it('no closed loop → ok=false', () => {
    const open: SolverViewState = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = revolveFromSketch(open, { axis: Y_AXIS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/dangling|closed/i);
    }
  });

  it('empty sketch → ok=false', () => {
    const empty: SolverViewState = { points: [], lines: [] };
    const r = revolveFromSketch(empty, { axis: Y_AXIS });
    expect(r.ok).toBe(false);
  });

  it('axis with coincident points → ok=false', () => {
    const r = revolveFromSketch(rectRightOfY(), {
      axis: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/coincident/i);
  });

  it('axis with non-finite coordinates → ok=false', () => {
    const r = revolveFromSketch(rectRightOfY(), {
      axis: { a: { x: 0, y: 0 }, b: { x: NaN, y: 1 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/finite/i);
  });

  it('angle out of range (0, 360] → ok=false', () => {
    const tooLarge = revolveFromSketch(rectRightOfY(), { axis: Y_AXIS, angleDegrees: 400 });
    expect(tooLarge.ok).toBe(false);
    const zero = revolveFromSketch(rectRightOfY(), { axis: Y_AXIS, angleDegrees: 0 });
    expect(zero.ok).toBe(false);
  });

  it('multiple loops: picks the largest-area one as the outer profile', () => {
    // Two separate rects on the +X side: small (5×5) + large (20×10).
    const state: SolverViewState = {
      points: [
        // small (area 25)
        { id: 'sa', x: 1, y: 0 },
        { id: 'sb', x: 6, y: 0 },
        { id: 'sc', x: 6, y: 5 },
        { id: 'sd', x: 1, y: 5 },
        // large (area 200), well to the right
        { id: 'la', x: 100, y: 0 },
        { id: 'lb', x: 120, y: 0 },
        { id: 'lc', x: 120, y: 10 },
        { id: 'ld', x: 100, y: 10 },
      ],
      lines: [
        { id: 'sl1', p1: 'sa', p2: 'sb' },
        { id: 'sl2', p1: 'sb', p2: 'sc' },
        { id: 'sl3', p1: 'sc', p2: 'sd' },
        { id: 'sl4', p1: 'sd', p2: 'sa' },
        { id: 'll1', p1: 'la', p2: 'lb' },
        { id: 'll2', p1: 'lb', p2: 'lc' },
        { id: 'll3', p1: 'lc', p2: 'ld' },
        { id: 'll4', p1: 'ld', p2: 'la' },
      ],
    };
    const r = revolveFromSketch(state, { axis: Y_AXIS });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.loop.signedArea)).toBeCloseTo(200, 5);
    }
  });

  it('passes through mode + featureName options', () => {
    const r = revolveFromSketch(rectRightOfY(), {
      axis: Y_AXIS,
      mode: 'cut',
      featureName: 'Groove',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('NEXYFAB:REVOLVE_CUT');
      expect(r.scad).toContain('(Groove)');
    }
  });
});
