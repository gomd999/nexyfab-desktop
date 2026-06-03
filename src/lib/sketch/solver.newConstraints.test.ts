/**
 * SketchSolver — Phase 1.3 added constraints: equal length, equal radius,
 * symmetric, concentric. Boots the real planegcs WASM and solves, which also
 * proves the planegcs constraint-type strings are accepted.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createSketchSolver, SketchSolver } from './solver';

let solver: SketchSolver | null = null;
afterEach(() => {
  solver?.destroy();
  solver = null;
});

function len(s: SketchSolver, l: ReturnType<SketchSolver['addLine']>): number {
  const { p1, p2 } = s.line(l);
  const a = s.point(p1);
  const b = s.point(p2);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('SketchSolver — equal / symmetric / concentric', () => {
  it('equalLength: a free line takes the fixed line length', async () => {
    solver = await createSketchSolver();
    const a = solver.addPoint(0, 0, { fixed: true });
    const b = solver.addPoint(10, 0, { fixed: true }); // l1 length = 10 (fixed)
    const c = solver.addPoint(0, 5, { fixed: true });
    const d = solver.addPoint(3, 5); // l2 short, free
    const l1 = solver.addLine(a, b);
    const l2 = solver.addLine(c, d);
    solver.addEqualLength(l1, l2);
    expect(solver.solve().success).toBe(true);
    expect(len(solver, l2)).toBeCloseTo(10, 2);
  });

  it('equalRadius: a free circle takes the dimensioned circle radius', async () => {
    solver = await createSketchSolver();
    const ca = solver.addPoint(0, 0, { fixed: true });
    const cb = solver.addPoint(30, 0, { fixed: true });
    const c1 = solver.addCircle(ca, 5);
    const c2 = solver.addCircle(cb, 2);
    solver.addRadius(c1, 5);
    solver.addEqualRadius(c1, c2);
    expect(solver.solve().success).toBe(true);
    expect(solver.circle(c2).radius).toBeCloseTo(5, 2);
  });

  it('symmetric: a free point mirrors across the line', async () => {
    solver = await createSketchSolver();
    // Mirror line = the y-axis (x = 0).
    const a = solver.addPoint(0, 0, { fixed: true });
    const b = solver.addPoint(0, 10, { fixed: true });
    const l = solver.addLine(a, b);
    const p1 = solver.addPoint(3, 5, { fixed: true });
    const p2 = solver.addPoint(-1, 1); // free, should snap to (-3, 5)
    solver.addSymmetric(p1, p2, l);
    expect(solver.solve().success).toBe(true);
    const m = solver.point(p2);
    expect(m.x).toBeCloseTo(-3, 2);
    expect(m.y).toBeCloseTo(5, 2);
  });

  it('concentric: a free circle centers on the fixed circle', async () => {
    solver = await createSketchSolver();
    const ca = solver.addPoint(0, 0, { fixed: true });
    const cb = solver.addPoint(8, 6); // free center
    const c1 = solver.addCircle(ca, 5);
    const c2 = solver.addCircle(cb, 3);
    solver.addConcentric(c1, c2);
    expect(solver.solve().success).toBe(true);
    const center = solver.point(solver.circle(c2).center);
    expect(center.x).toBeCloseTo(0, 2);
    expect(center.y).toBeCloseTo(0, 2);
  });

  it('getConstraints reports the new serialized kinds', async () => {
    solver = await createSketchSolver();
    const a = solver.addPoint(0, 0, { fixed: true });
    const b = solver.addPoint(10, 0, { fixed: true });
    const c = solver.addPoint(0, 5, { fixed: true });
    const d = solver.addPoint(3, 5);
    const l1 = solver.addLine(a, b);
    const l2 = solver.addLine(c, d);
    solver.addEqualLength(l1, l2);
    const c1 = solver.addCircle(a, 5);
    const c2 = solver.addCircle(c, 3);
    solver.addConcentric(c1, c2);
    solver.addSymmetric(a, d, l1);
    const kinds = solver.getConstraints().map((k) => k.kind);
    expect(kinds).toContain('equal');
    expect(kinds).toContain('concentric');
    expect(kinds).toContain('symmetric');
  });
});
