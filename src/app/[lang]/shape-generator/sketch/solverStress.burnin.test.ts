/**
 * Sketch constraint-solver stress burn-in (Q3 gap probe).
 *
 * The solver (Levenberg-Marquardt + rank/DOF analysis) already passes its
 * unit suites. This burn-in hammers the *robustness* failure modes that a
 * pro CAD solver must get right and a toy one silently botches:
 *
 *   1. Contradictory constraints must NOT be reported as satisfied.
 *   2. Redundant constraints solve geometry yet flag 'over-defined'.
 *   3. Determinism: identical input → identical output.
 *   4. Convergence from a far / badly-scaled initial guess.
 *
 * Pure numerics — runs headless, no WASM, not gated.
 */

import { describe, it, expect } from 'vitest';
import { solveConstraints } from './constraintSolver';
import type { SketchConstraint, SketchDimension, SketchSegment } from './types';

function horizLine(x2 = 50, y2 = 3): SketchSegment[] {
  return [{ type: 'line', id: 'segL', points: [{ id: 'pa', x: 0, y: 0 }, { id: 'pb', x: x2, y: y2 }] }];
}
const fixA: SketchConstraint = { id: 'fix_a', type: 'fixed', entityIds: ['pa'], satisfied: false };
const horiz: SketchConstraint = { id: 'hor', type: 'horizontal', entityIds: ['segL'], satisfied: false };
function linearDim(id: string, value: number): SketchDimension {
  return { id, type: 'linear', entityIds: ['segL'], value, position: { x: 20, y: -10 }, locked: true };
}

describe('solver stress — contradictory constraints are never silently satisfied', () => {
  it('two conflicting linear dims on the same line → not satisfied, status not ok', () => {
    const r = solveConstraints(horizLine(), [fixA, horiz], [linearDim('d1', 40), linearDim('d2', 60)], 200, 1e-7);
    // The single x-length cannot be both 40 and 60.
    expect(r.satisfied).toBe(false);
    expect(r.solveResult?.status).not.toBe('ok');
    expect(['over-defined', 'inconsistent']).toContain(r.solveResult?.status);
    expect(r.unsatisfiedConstraints.length).toBeGreaterThan(0);
  });

  it('both endpoints fixed + oversized length dim → unsatisfiable, not ok', () => {
    // pa & pb both pinned 10mm apart, but a locked dim demands 40mm. No DOF
    // can absorb the 30mm conflict — the solver must refuse to call it ok.
    const r = solveConstraints(horizLine(10, 0), [
      fixA,
      { id: 'fix_b', type: 'fixed', entityIds: ['pb'], satisfied: false },
    ], [linearDim('d1', 40)], 200, 1e-7);
    expect(r.satisfied).toBe(false);
    expect(r.solveResult?.status).not.toBe('ok');
    expect(r.unsatisfiedConstraints.length).toBeGreaterThan(0);
  });
});

describe('solver stress — redundant constraints', () => {
  it('duplicate linear dim solves geometry yet flags over-defined + redundant', () => {
    const r = solveConstraints(horizLine(), [fixA, horiz], [linearDim('d1', 40), linearDim('d2', 40)], 200, 1e-7);
    const pb = r.points.get('pb')!;
    expect(pb.x).toBeCloseTo(40, 2);
    expect(pb.y).toBeCloseTo(0, 3);
    expect(r.solveResult?.status).toBe('over-defined');
    expect(r.solveResult?.redundant?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('solver stress — determinism', () => {
  it('same system solved twice → identical coordinates', () => {
    const build = () => solveConstraints(horizLine(), [fixA, horiz], [linearDim('d1', 40)], 200, 1e-8);
    const a = build().points.get('pb')!;
    const b = build().points.get('pb')!;
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });
});

describe('solver stress — convergence from hard initial guesses', () => {
  it('converges from a far-off initial position', () => {
    const r = solveConstraints(horizLine(1000, 800), [fixA, horiz], [linearDim('d1', 40)], 400, 1e-7);
    const pb = r.points.get('pb')!;
    expect(pb.x).toBeCloseTo(40, 1);
    expect(pb.y).toBeCloseTo(0, 2);
    expect(r.satisfied).toBe(true);
  });

  it('converges at a tiny scale (sub-mm)', () => {
    const r = solveConstraints(horizLine(0.4, 0.03), [fixA, horiz], [linearDim('d1', 0.05)], 400, 1e-9);
    const pb = r.points.get('pb')!;
    expect(pb.x).toBeCloseTo(0.05, 4);
    expect(r.satisfied).toBe(true);
  });

  it('converges at a large scale (metres of mm)', () => {
    const r = solveConstraints(horizLine(1, 1), [fixA, horiz], [linearDim('d1', 50000)], 600, 1e-4);
    const pb = r.points.get('pb')!;
    expect(pb.x).toBeCloseTo(50000, 0);
    expect(r.satisfied).toBe(true);
  });
});
