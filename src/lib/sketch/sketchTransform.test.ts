/**
 * sketchTransform — acceptance tests.
 *
 * Covers:
 *   - translate: all / selection / fixed-skip / dedup / validation
 *   - rotate: 90°/180°/2π / arbitrary center / fixed-skip / validation
 *   - scale: anchor / custom center / radius propagation (circle + arc) /
 *            negative factor / fixed-skip / validation
 *   - mirror: x-axis / y-axis / diagonal / axis through arbitrary point /
 *             fixed-skip / zero-length-axis rejection
 *   - reset: restores points + radii after combined ops
 *   - selection-only ops do not move out-of-selection points
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createSketchSolver, SketchSolver } from './solver';
import { createSketchTransform } from './sketchTransform';

let solver: SketchSolver | null = null;

afterEach(() => {
  solver?.destroy();
  solver = null;
});

// flush pending primitives so movePoint can address them via p_param_index.
function flush(s: SketchSolver): void {
  s.solve();
}

describe('sketchTransform — translate', () => {
  it('translate all → every point shifts by (dx, dy)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(5, 0);
    const p3 = solver.addPoint(0, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(10, -2);
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(10, 5);
    expect(solver.point(p1).y).toBeCloseTo(-2, 5);
    expect(solver.point(p2).x).toBeCloseTo(15, 5);
    expect(solver.point(p2).y).toBeCloseTo(-2, 5);
    expect(solver.point(p3).x).toBeCloseTo(10, 5);
    expect(solver.point(p3).y).toBeCloseTo(3, 5);
  });

  it('translate selection (3 of 4 points) → only selected move', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(5, 0);
    const p3 = solver.addPoint(0, 5);
    const pOut = solver.addPoint(100, 100);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(7, 0, [p1, p2, p3]);
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(7, 5);
    expect(solver.point(p2).x).toBeCloseTo(12, 5);
    expect(solver.point(p3).x).toBeCloseTo(7, 5);
    expect(solver.point(pOut).x).toBeCloseTo(100, 5);
    expect(solver.point(pOut).y).toBeCloseTo(100, 5);
  });

  it('translate scope expands lines/circles/arcs to underlying points', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(10, 0);
    const line = solver.addLine(p1, p2);
    const pOut = solver.addPoint(50, 50);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(1, 1, [line]);
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(1, 5);
    expect(solver.point(p1).y).toBeCloseTo(1, 5);
    expect(solver.point(p2).x).toBeCloseTo(11, 5);
    expect(solver.point(p2).y).toBeCloseTo(1, 5);
    expect(solver.point(pOut).x).toBeCloseTo(50, 5);
  });

  it('translate dedupes shared points across selection entities', async () => {
    solver = await createSketchSolver();
    const shared = solver.addPoint(0, 0);
    const p2 = solver.addPoint(10, 0);
    const line = solver.addLine(shared, p2);
    const circle = solver.addCircle(shared, 3);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(4, 0, [line, circle]);
    flush(solver);

    // If shared were double-translated, x would be 8, not 4.
    expect(solver.point(shared).x).toBeCloseTo(4, 5);
  });

  it('translate skips fixed points (no throw, fixed stay put)', async () => {
    solver = await createSketchSolver();
    const pf = solver.addPoint(0, 0, { fixed: true });
    const pm = solver.addPoint(5, 0);
    flush(solver);

    const tx = createSketchTransform(solver);
    expect(() => tx.translate(3, 4)).not.toThrow();
    flush(solver);

    expect(solver.point(pf).x).toBeCloseTo(0, 5);
    expect(solver.point(pf).y).toBeCloseTo(0, 5);
    expect(solver.point(pm).x).toBeCloseTo(8, 5);
    expect(solver.point(pm).y).toBeCloseTo(4, 5);
  });

  it('translate rejects non-finite dx/dy', async () => {
    solver = await createSketchSolver();
    solver.addPoint(0, 0);
    flush(solver);
    const tx = createSketchTransform(solver);
    expect(() => tx.translate(Number.NaN, 0)).toThrow(/finite/);
    expect(() => tx.translate(0, Infinity)).toThrow(/finite/);
  });
});

describe('sketchTransform — rotate', () => {
  it('rotate 90° around origin: (1,0) → (0,1)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(1, 0);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.rotate(Math.PI / 2, { x: 0, y: 0 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(0, 5);
    expect(solver.point(p1).y).toBeCloseTo(1, 5);
  });

  it('rotate 180° around (5,5): (10,5) → (0,5)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(10, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.rotate(Math.PI, { x: 5, y: 5 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(0, 4);
    expect(solver.point(p1).y).toBeCloseTo(5, 4);
  });

  it('rotate 2π ≈ identity', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(3, 4);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.rotate(2 * Math.PI, { x: 0, y: 0 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(3, 4);
    expect(solver.point(p1).y).toBeCloseTo(4, 4);
  });

  it('rotate selection only moves selected', async () => {
    solver = await createSketchSolver();
    const pIn = solver.addPoint(1, 0);
    const pOut = solver.addPoint(0, 1);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.rotate(Math.PI / 2, { x: 0, y: 0 }, [pIn]);
    flush(solver);

    expect(solver.point(pIn).x).toBeCloseTo(0, 5);
    expect(solver.point(pIn).y).toBeCloseTo(1, 5);
    expect(solver.point(pOut).x).toBeCloseTo(0, 5);
    expect(solver.point(pOut).y).toBeCloseTo(1, 5);
  });

  it('rotate respects fixed points', async () => {
    solver = await createSketchSolver();
    const pf = solver.addPoint(1, 0, { fixed: true });
    const pm = solver.addPoint(0, 1);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.rotate(Math.PI / 2, { x: 0, y: 0 });
    flush(solver);

    expect(solver.point(pf).x).toBeCloseTo(1, 5);
    expect(solver.point(pf).y).toBeCloseTo(0, 5);
    expect(solver.point(pm).x).toBeCloseTo(-1, 5);
    expect(solver.point(pm).y).toBeCloseTo(0, 5);
  });

  it('rotate rejects non-finite angle and bad center', async () => {
    solver = await createSketchSolver();
    solver.addPoint(0, 0);
    flush(solver);
    const tx = createSketchTransform(solver);
    expect(() => tx.rotate(Number.NaN, { x: 0, y: 0 })).toThrow(/finite/);
    expect(() => tx.rotate(0, { x: Number.NaN, y: 0 })).toThrow(/center/);
  });
});

describe('sketchTransform — scale', () => {
  it('scale 2x around origin doubles every coord', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(2, 3);
    const p2 = solver.addPoint(-1, 4);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(2, { x: 0, y: 0 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(4, 5);
    expect(solver.point(p1).y).toBeCloseTo(6, 5);
    expect(solver.point(p2).x).toBeCloseTo(-2, 5);
    expect(solver.point(p2).y).toBeCloseTo(8, 5);
  });

  it('scale 0.5x around custom center', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(10, 0);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(0.5, { x: 0, y: 0 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(5, 5);
    expect(solver.point(p1).y).toBeCloseTo(0, 5);
  });

  it('scale updates circle radius (all scope)', async () => {
    solver = await createSketchSolver();
    const cc = solver.addPoint(0, 0);
    const circle = solver.addCircle(cc, 4);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(3, { x: 0, y: 0 });

    expect(solver.circle(circle).radius).toBeCloseTo(12, 5);
  });

  it('scale updates arc radius (selection scope)', async () => {
    solver = await createSketchSolver();
    const ac = solver.addPoint(0, 0);
    const as = solver.addPoint(2, 0);
    const ae = solver.addPoint(0, 2);
    const arc = solver.addArc(ac, as, ae, 2, 0, Math.PI / 2);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(2, { x: 0, y: 0 }, [arc]);

    expect(solver.arc(arc).radius).toBeCloseTo(4, 5);
  });

  it('negative scale factor reflects but radii stay positive (|factor|)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(3, 0);
    const cc = solver.addPoint(0, 0);
    const circle = solver.addCircle(cc, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(-2, { x: 0, y: 0 });
    // Read radius BEFORE next solve — setCircleRadius is a JS-side primitive
    // mutation (per solver.ts Phase 1.B note) which apply_solution() would
    // overwrite back to the originally-pushed param value if not pinned via
    // addRadius. Same convention used by sketchGroup tests.
    expect(solver.circle(circle).radius).toBeCloseTo(10, 5);
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(-6, 5);
    expect(solver.point(p1).y).toBeCloseTo(0, 5);
  });

  it('scale skips fixed points', async () => {
    solver = await createSketchSolver();
    const pf = solver.addPoint(3, 0, { fixed: true });
    const pm = solver.addPoint(4, 0);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(2, { x: 0, y: 0 });
    flush(solver);

    expect(solver.point(pf).x).toBeCloseTo(3, 5);
    expect(solver.point(pm).x).toBeCloseTo(8, 5);
  });

  it('scale rejects factor=0 and non-finite factor / center', async () => {
    solver = await createSketchSolver();
    solver.addPoint(0, 0);
    flush(solver);
    const tx = createSketchTransform(solver);
    expect(() => tx.scale(0, { x: 0, y: 0 })).toThrow(/non-zero/);
    expect(() => tx.scale(Infinity, { x: 0, y: 0 })).toThrow(/finite/);
    expect(() => tx.scale(2, { x: Number.NaN, y: 0 })).toThrow(/center/);
  });
});

describe('sketchTransform — mirror', () => {
  it('mirror across x-axis: (3,5) → (3,-5)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(3, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 1, y: 0 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(3, 5);
    expect(solver.point(p1).y).toBeCloseTo(-5, 5);
  });

  it('mirror across y-axis: (3,5) → (-3,5)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(3, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 0, y: 1 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(-3, 5);
    expect(solver.point(p1).y).toBeCloseTo(5, 5);
  });

  it('mirror across diagonal y=x: (2,5) → (5,2)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(2, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 1, y: 1 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(5, 5);
    expect(solver.point(p1).y).toBeCloseTo(2, 5);
  });

  it('mirror across axis through arbitrary point (line y=3)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 10);
    flush(solver);

    const tx = createSketchTransform(solver);
    // line through (0,3)-(1,3) → horizontal at y=3
    tx.mirror({ x: 0, y: 3 }, { x: 1, y: 3 });
    flush(solver);

    // reflection of y=10 about y=3 is y=-4
    expect(solver.point(p1).x).toBeCloseTo(0, 5);
    expect(solver.point(p1).y).toBeCloseTo(-4, 5);
  });

  it('mirror skips fixed points', async () => {
    solver = await createSketchSolver();
    const pf = solver.addPoint(3, 5, { fixed: true });
    const pm = solver.addPoint(3, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 1, y: 0 });
    flush(solver);

    expect(solver.point(pf).y).toBeCloseTo(5, 5);
    expect(solver.point(pm).y).toBeCloseTo(-5, 5);
  });

  it('mirror selection only', async () => {
    solver = await createSketchSolver();
    const pIn = solver.addPoint(0, 7);
    const pOut = solver.addPoint(0, 7);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 1, y: 0 }, [pIn]);
    flush(solver);

    expect(solver.point(pIn).y).toBeCloseTo(-7, 5);
    expect(solver.point(pOut).y).toBeCloseTo(7, 5);
  });

  it('mirror rejects zero-length axis (p1 === p2)', async () => {
    solver = await createSketchSolver();
    solver.addPoint(0, 0);
    flush(solver);
    const tx = createSketchTransform(solver);
    expect(() => tx.mirror({ x: 1, y: 1 }, { x: 1, y: 1 })).toThrow(/distinct/);
  });

  it('mirror is involutive: applying twice restores original position', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(7, -3);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 2, y: 1 });
    flush(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 2, y: 1 });
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(7, 4);
    expect(solver.point(p1).y).toBeCloseTo(-3, 4);
  });
});

describe('sketchTransform — reset', () => {
  it('reset restores points after translate', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(2, 3);
    const p2 = solver.addPoint(-4, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(100, 200);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(102, 5);

    tx.reset();
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(2, 5);
    expect(solver.point(p1).y).toBeCloseTo(3, 5);
    expect(solver.point(p2).x).toBeCloseTo(-4, 5);
    expect(solver.point(p2).y).toBeCloseTo(5, 5);
  });

  it('reset restores radius after scale', async () => {
    solver = await createSketchSolver();
    const cc = solver.addPoint(0, 0);
    const circle = solver.addCircle(cc, 4);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.scale(3, { x: 0, y: 0 });
    expect(solver.circle(circle).radius).toBeCloseTo(12, 5);

    tx.reset();
    expect(solver.circle(circle).radius).toBeCloseTo(4, 5);
  });

  it('reset works after combined translate + rotate + scale + mirror', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(1, 0);
    const p2 = solver.addPoint(0, 1);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(5, 5);
    flush(solver);
    tx.rotate(Math.PI / 2, { x: 5, y: 5 });
    flush(solver);
    tx.scale(2, { x: 0, y: 0 });
    flush(solver);
    tx.mirror({ x: 0, y: 0 }, { x: 1, y: 0 });
    flush(solver);

    tx.reset();
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(1, 4);
    expect(solver.point(p1).y).toBeCloseTo(0, 4);
    expect(solver.point(p2).x).toBeCloseTo(0, 4);
    expect(solver.point(p2).y).toBeCloseTo(1, 4);
  });

  it('reset is idempotent (calling twice is a no-op the second time)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(3, 7);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(10, 10);
    flush(solver);
    tx.reset();
    flush(solver);
    tx.reset();
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(3, 5);
    expect(solver.point(p1).y).toBeCloseTo(7, 5);
  });

  it('reset does not throw on fixed points (silently skips)', async () => {
    solver = await createSketchSolver();
    const pf = solver.addPoint(2, 2, { fixed: true });
    const pm = solver.addPoint(5, 5);
    flush(solver);

    const tx = createSketchTransform(solver);
    tx.translate(100, 100);
    flush(solver);
    expect(() => tx.reset()).not.toThrow();
    flush(solver);
    expect(solver.point(pf).x).toBeCloseTo(2, 5);
    expect(solver.point(pm).x).toBeCloseTo(5, 5);
  });
});
