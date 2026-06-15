/**
 * SketchSolver — Phase 1.2 acceptance tests.
 *
 * Covers all 9 facade constraint types + DoF approximation + drag mutation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createSketchSolver, SketchSolver } from './solver';

let solver: SketchSolver | null = null;

afterEach(() => {
  solver?.destroy();
  solver = null;
});

describe('SketchSolver — geometric constraints', () => {
  it('coincident: pulls two points together', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 5);
    solver.addCoincident(p1, p2);
    const r = solver.solve();
    expect(r.success).toBe(true);
    const a = solver.point(p1);
    const b = solver.point(p2);
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
  });

  it('parallel: two lines become parallel', async () => {
    solver = await createSketchSolver();
    const a = solver.addPoint(0, 0, { fixed: true });
    const b = solver.addPoint(10, 0, { fixed: true });
    const c = solver.addPoint(0, 5);
    const d = solver.addPoint(10, 8);
    const l1 = solver.addLine(a, b);
    const l2 = solver.addLine(c, d);
    solver.addParallel(l1, l2);
    const r = solver.solve();
    expect(r.success).toBe(true);
    // l1 is horizontal (b.y - a.y = 0); l2 must also be horizontal after solve.
    const cP = solver.point(c);
    const dP = solver.point(d);
    expect(dP.y - cP.y).toBeCloseTo(0, 5);
  });

  it('perpendicular: forces 90° between lines', async () => {
    solver = await createSketchSolver();
    const a = solver.addPoint(0, 0, { fixed: true });
    const b = solver.addPoint(10, 0, { fixed: true });
    const c = solver.addPoint(5, 0, { fixed: true });
    const d = solver.addPoint(8, 5);
    const l1 = solver.addLine(a, b);
    const l2 = solver.addLine(c, d);
    solver.addPerpendicular(l1, l2);
    const r = solver.solve();
    expect(r.success).toBe(true);
    // l2 must be vertical (x coord same as c).
    const dP = solver.point(d);
    expect(dP.x).toBeCloseTo(5, 5);
  });

  it('horizontal: line becomes parallel to x-axis', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 3);
    const l = solver.addLine(p1, p2);
    solver.addHorizontal(l);
    const r = solver.solve();
    expect(r.success).toBe(true);
    expect(solver.point(p2).y).toBeCloseTo(0, 5);
  });

  it('vertical: line becomes parallel to y-axis', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(3, 10);
    const l = solver.addLine(p1, p2);
    solver.addVertical(l);
    const r = solver.solve();
    expect(r.success).toBe(true);
    expect(solver.point(p2).x).toBeCloseTo(0, 5);
  });

  it('tangent (line/circle): line touches circle at exactly one point', async () => {
    solver = await createSketchSolver();
    const center = solver.addPoint(0, 0, { fixed: true });
    const c = solver.addCircle(center, 5);
    solver.addRadius(c, 5);
    // Line that initially passes through circle interior.
    const p1 = solver.addPoint(-10, 3);
    const p2 = solver.addPoint(10, 3);
    const l = solver.addLine(p1, p2);
    solver.addHorizontal(l);
    solver.addTangent(l, c);
    const r = solver.solve();
    expect(r.success).toBe(true);
    // After solve, line should be horizontal at y = ±5 (tangent to circle radius 5).
    const a = solver.point(p1);
    const b = solver.point(p2);
    expect(Math.abs(Math.abs(a.y) - 5)).toBeLessThan(1e-4);
    expect(b.y).toBeCloseTo(a.y, 5);
  });
});

describe('SketchSolver — dimensional constraints', () => {
  it('distance: pins point-to-point separation', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(3, 4);
    solver.addDistance(p1, p2, 10);
    const r = solver.solve();
    expect(r.success).toBe(true);
    const b = solver.point(p2);
    const dist = Math.hypot(b.x, b.y);
    expect(dist).toBeCloseTo(10, 4);
  });

  it('angle: pins angle between two lines', async () => {
    solver = await createSketchSolver();
    // l1 is horizontal axis (fixed).
    const o = solver.addPoint(0, 0, { fixed: true });
    const xEnd = solver.addPoint(10, 0, { fixed: true });
    const l1 = solver.addLine(o, xEnd);
    // l2 shares origin, free end.
    const free = solver.addPoint(5, 2);
    const l2 = solver.addLine(o, free);
    solver.addAngle(l1, l2, Math.PI / 4); // 45°
    const r = solver.solve();
    expect(r.success).toBe(true);
    const f = solver.point(free);
    // angle of l2 from x-axis should be ±45°.
    const angle = Math.atan2(f.y, f.x);
    expect(Math.abs(Math.abs(angle) - Math.PI / 4)).toBeLessThan(1e-3);
  });

  it('radius: pins a circle radius', async () => {
    solver = await createSketchSolver();
    const center = solver.addPoint(0, 0, { fixed: true });
    const c = solver.addCircle(center, 1);
    solver.addRadius(c, 7);
    const r = solver.solve();
    expect(r.success).toBe(true);
    // No way to read radius directly via .point — but we can verify via tangent.
    const p1 = solver.addPoint(-10, 0);
    const p2 = solver.addPoint(10, 0);
    const l = solver.addLine(p1, p2);
    solver.addHorizontal(l);
    solver.addTangent(l, c);
    const r2 = solver.solve();
    expect(r2.success).toBe(true);
    const a = solver.point(p1);
    expect(Math.abs(Math.abs(a.y) - 7)).toBeLessThan(1e-3);
  });
});

describe('SketchSolver — DoF approximation', () => {
  it('reports positive DoF for under-constrained sketch', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 0);
    solver.addLine(p1, p2);
    // p2 is unfixed (2 DoF), no constraints on it.
    const r = solver.solve();
    expect(r.dof).toBe(2);
  });

  it('reports zero DoF for a fully horizontal-then-distance sketch', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(5, 3);
    const l = solver.addLine(p1, p2);
    solver.addHorizontal(l); // removes 1 DoF
    solver.addDistance(p1, p2, 10); // removes 1 DoF
    const r = solver.solve();
    expect(r.success).toBe(true);
    expect(r.dof).toBe(0);
  });
});

describe('SketchSolver — mutation', () => {
  it('movePoint then solve respects constraints', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 0);
    const l = solver.addLine(p1, p2);
    solver.addHorizontal(l);
    solver.solve();
    // Drag p2 up — solve should snap it back to y=0.
    solver.movePoint(p2, 8, 4);
    const r = solver.solve();
    expect(r.success).toBe(true);
    expect(solver.point(p2).y).toBeCloseTo(0, 4);
    expect(solver.point(p2).x).toBeCloseTo(8, 1);
  });

  it('movePoint throws on fixed point', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    expect(() => solver!.movePoint(p1, 5, 5)).toThrow(/fixed/);
  });
});

describe('SketchSolver — setConstraintValue (Phase 1.B inline edit)', () => {
  it('updates a distance constraint and the next solve respects the new value', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 0);
    const k = solver.addDistance(p1, p2, 10);
    solver.solve();
    expect(solver.point(p2).x).toBeCloseTo(10, 4);

    const ok = solver.setConstraintValue(k, 25);
    expect(ok).toBe(true);
    const r = solver.solve();
    expect(r.success).toBe(true);
    const b = solver.point(p2);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(25, 3);
  });

  it('updates an angle constraint and the next solve respects the new angle', async () => {
    solver = await createSketchSolver();
    const o = solver.addPoint(0, 0, { fixed: true });
    const xEnd = solver.addPoint(10, 0, { fixed: true });
    const l1 = solver.addLine(o, xEnd);
    const free = solver.addPoint(5, 2);
    const l2 = solver.addLine(o, free);
    const k = solver.addAngle(l1, l2, Math.PI / 4);
    solver.solve();

    const ok = solver.setConstraintValue(k, Math.PI / 6); // 30°
    expect(ok).toBe(true);
    const r = solver.solve();
    expect(r.success).toBe(true);
    const f = solver.point(free);
    expect(Math.abs(Math.abs(Math.atan2(f.y, f.x)) - Math.PI / 6)).toBeLessThan(1e-3);
  });

  it('rejects non-finite values with a thrown error', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 0);
    const k = solver.addDistance(p1, p2, 10);
    expect(() => solver!.setConstraintValue(k, NaN)).toThrow(/finite/);
    expect(() => solver!.setConstraintValue(k, Infinity)).toThrow(/finite/);
  });

  it('rejects non-positive distance values', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 0);
    const k = solver.addDistance(p1, p2, 10);
    expect(() => solver!.setConstraintValue(k, -5)).toThrow(/> 0/);
    expect(() => solver!.setConstraintValue(k, 0)).toThrow(/> 0/);
  });

  it('is a silent no-op for unknown constraint ids', async () => {
    solver = await createSketchSolver();
    // No constraints added; arbitrary id is unknown.
    const ok = solver.setConstraintValue(
      'k-nope' as unknown as Parameters<SketchSolver['setConstraintValue']>[0],
      42,
    );
    expect(ok).toBe(false);
  });

  it('is a silent no-op for non-dimensional constraints (horizontal/parallel)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 3);
    const l = solver.addLine(p1, p2);
    const kH = solver.addHorizontal(l);

    const ok = solver.setConstraintValue(kH, 999);
    expect(ok).toBe(false);
    // Constraint snapshot still reflects horizontal kind, untouched.
    const snap = solver.getConstraints();
    expect(snap.find((c) => c.id === kH)?.kind).toBe('horizontal');
    expect(snap.find((c) => c.id === kH)?.value).toBeUndefined();
  });

  it('reflects new value in getConstraints() snapshot immediately (pre-solve)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0, { fixed: true });
    const p2 = solver.addPoint(10, 0);
    const k = solver.addDistance(p1, p2, 10);
    solver.solve();
    solver.setConstraintValue(k, 33);
    const snap = solver.getConstraints();
    const rec = snap.find((c) => c.id === k);
    expect(rec?.value).toBe(33);
  });
});

describe('SketchSolver — lifecycle', () => {
  it('throws after destroy', async () => {
    solver = await createSketchSolver();
    solver.destroy();
    expect(() => solver!.addPoint(0, 0)).toThrow(/destroyed/);
  });
});
