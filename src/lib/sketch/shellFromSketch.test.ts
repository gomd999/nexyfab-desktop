/**
 * shellFromSketch — end-to-end Phase 2.4 pipeline tests for shell.
 *
 * Mirror of sweepFromSketch.test.ts. Pure unit tests, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { shellFromSketch } from './shellFromSketch';
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

describe('shellFromSketch', () => {
  it('rect profile + closed shell → SCAD with difference()', () => {
    const r = shellFromSketch(rectSketch(), { depth: 20, thickness: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('NEXYFAB:SHELL');
      expect(r.shell.thickness).toBe(1);
      expect(r.shell.openTopFace).toBe(false);
      expect(r.shell.openBottomFace).toBe(false);
    }
  });

  it('rect profile + openTop → inner extrude pokes through top', () => {
    const r = shellFromSketch(rectSketch(), {
      depth: 20,
      thickness: 1,
      openTopFace: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // height=20 (zStart=1, zEnd=depth+t=21)
      expect(r.scad).toMatch(/linear_extrude\(height=20\)/);
      expect(r.shell.openTopFace).toBe(true);
    }
  });

  it('produces a stable feature envelope comment for downstream parsers', () => {
    const r = shellFromSketch(rectSketch(), { depth: 20, thickness: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/^\/\/ === shell_1 \(Shell\) ===/);
    }
  });

  it('respects custom featureName in envelope', () => {
    const r = shellFromSketch(rectSketch(), {
      depth: 20,
      thickness: 1,
      featureName: 'MyShell',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/^\/\/ === shell_1 \(MyShell\) ===/);
    }
  });

  it('returns error for non-positive depth', () => {
    const r = shellFromSketch(rectSketch(), { depth: 0, thickness: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/depth/);
  });

  it('returns error for non-positive thickness', () => {
    const r = shellFromSketch(rectSketch(), { depth: 20, thickness: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/thickness/);
  });

  it('returns error for empty sketch', () => {
    const r = shellFromSketch({ points: [], lines: [] }, { depth: 20, thickness: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed loop/i);
  });

  it('returns Phase 1 error for non-rect (triangle) profile', () => {
    const r = shellFromSketch(triangleSketch(), { depth: 20, thickness: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/(Phase 1|rectangle|4 corners)/i);
  });

  it('returns Phase 1 error for axis-misaligned rotated quad', () => {
    // 4 points, all distinct, but not axis-aligned
    const skew: SolverViewState = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 1 },
        { id: 'p3', x: 9, y: 6 },
        { id: 'p4', x: -1, y: 5 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p1' },
      ],
    };
    const r = shellFromSketch(skew, { depth: 20, thickness: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/(Phase 1|axis-aligned)/i);
  });

  it('returns error when thickness exceeds geometric bounds', () => {
    // rect 10×5 → min/2 = 2.5; thickness 3 must fail at the IR builder.
    const r = shellFromSketch(rectSketch(), { depth: 20, thickness: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bbox|2\.5/);
  });
});
