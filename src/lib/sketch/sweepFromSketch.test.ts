/**
 * sweepFromSketch — end-to-end Phase 2.2 pipeline tests for sweep.
 *
 * Mirror of revolveFromSketch.test.ts. Pure unit tests, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { sweepFromSketch } from './sweepFromSketch';
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

/** Straight Z-axis path, matches the modal default. */
const STRAIGHT_Z = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 50 },
];

describe('sweepFromSketch', () => {
  it('rect profile + straight Z path → SCAD with BOSL2 path_sweep', () => {
    const r = sweepFromSketch(rectSketch(), { path: STRAIGHT_Z });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('path_sweep');
      expect(r.loop.points.length).toBe(4);
    }
  });

  it('multi-segment polyline path is preserved in the SCAD output', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 20 },
      { x: 10, y: 0, z: 20 },
    ];
    const r = sweepFromSketch(rectSketch(), { path });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // BOSL2 path_sweep takes the 3D path as the second arg — all three
      // path points should appear in the emitted SCAD.
      expect(r.scad).toMatch(/\[0,\s*0,\s*0\]/);
      expect(r.scad).toMatch(/\[0,\s*0,\s*20\]/);
      expect(r.scad).toMatch(/\[10,\s*0,\s*20\]/);
    }
  });

  it('mode=cut wraps the sweep with the NEXYFAB:SWEEP_CUT marker', () => {
    const r = sweepFromSketch(rectSketch(), { path: STRAIGHT_Z, mode: 'cut' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('NEXYFAB:SWEEP_CUT');
    }
  });

  it('mode=add (default) does not emit the cut marker', () => {
    const r = sweepFromSketch(rectSketch(), { path: STRAIGHT_Z });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).not.toContain('NEXYFAB:SWEEP_CUT');
    }
  });

  it('path with <2 points → ok=false', () => {
    const r = sweepFromSketch(rectSketch(), { path: [{ x: 0, y: 0, z: 0 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least 2/i);
  });

  it('path with zero-length segment → ok=false', () => {
    const r = sweepFromSketch(rectSketch(), {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zero-length/i);
  });

  it('path with non-finite coordinates → ok=false', () => {
    const r = sweepFromSketch(rectSketch(), {
      path: [
        { x: 0, y: 0, z: 0 },
        { x: NaN, y: 0, z: 10 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/finite/i);
  });

  it('missing path → ok=false', () => {
    // @ts-expect-error — intentional misuse for the validation path.
    const r = sweepFromSketch(rectSketch(), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/path/i);
  });

  it('no closed loop → ok=false', () => {
    const open: SolverViewState = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = sweepFromSketch(open, { path: STRAIGHT_Z });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dangling|closed/i);
  });

  it('empty sketch → ok=false', () => {
    const empty: SolverViewState = { points: [], lines: [] };
    const r = sweepFromSketch(empty, { path: STRAIGHT_Z });
    expect(r.ok).toBe(false);
  });

  it('multiple loops: picks the largest-area one as the outer profile', () => {
    const state: SolverViewState = {
      points: [
        // small (area 25)
        { id: 'sa', x: 0, y: 0 },
        { id: 'sb', x: 5, y: 0 },
        { id: 'sc', x: 5, y: 5 },
        { id: 'sd', x: 0, y: 5 },
        // large (area 200)
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
    const r = sweepFromSketch(state, { path: STRAIGHT_Z });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.loop.signedArea)).toBeCloseTo(200, 5);
    }
  });

  it('passes through mode + featureName options', () => {
    const r = sweepFromSketch(rectSketch(), {
      path: STRAIGHT_Z,
      mode: 'cut',
      featureName: 'Channel',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('NEXYFAB:SWEEP_CUT');
      expect(r.scad).toContain('(Channel)');
    }
  });
});
