/**
 * W1-D — true `type:'circle'` sketch entities and the four circle constraints.
 *
 * The point of this suite is NOT "the constraint was registered". Every test
 * below feeds a DELIBERATELY VIOLATING configuration to the solver and asserts
 * that the returned geometry MOVED to satisfy the constraint — i.e. that the
 * residual path actually fires. A test that only checked `constraints.length`
 * would have passed against the pre-W1-D code, where the circle tool emitted
 * 32 `type:'line'` segments and no circle constraint could ever bind.
 */
import { describe, it, expect } from 'vitest';
import type { SketchSegment, SketchConstraint, SketchDimension, SketchPoint } from './types';
import { solveConstraints } from './constraintSolver';
import {
  makeCircleSegment,
  circleSegmentGeometry,
  circleSvgPath,
  findNearestSegment,
  detectCircleApproximations,
  promoteCircleApproximations,
  generateCircleSegments,
  CIRCLE_APPROX_MIN_SIDES,
} from './sketchGeometryOps';

const P = (x: number, y: number): SketchPoint => ({ x, y });

/** Apply a solver result back onto the segments so we can measure geometry. */
function applySolved(
  segments: SketchSegment[],
  points: Map<string, SketchPoint>,
): SketchSegment[] {
  return segments.map(s => ({
    ...s,
    points: s.points.map(p => {
      const np = p.id ? points.get(p.id) : undefined;
      return np ? { ...p, x: np.x, y: np.y } : p;
    }),
  }));
}

/** Centre/radius of segment `idx`, post-solve. */
function geomOf(segs: SketchSegment[], idx: number) {
  const g = circleSegmentGeometry(segs[idx]);
  if (!g) throw new Error(`segment ${idx} is not a circle`);
  return g;
}

/** `solveResult` is optional on the public type; every path we exercise
 *  populates it, so fail loudly rather than optional-chaining past a bug. */
function solveResultOf(res: ReturnType<typeof solveConstraints>) {
  if (!res.solveResult) throw new Error('solver returned no solveResult');
  return res.solveResult;
}

const con = (
  id: string,
  type: SketchConstraint['type'],
  entityIds: string[],
): SketchConstraint => ({ id, type, entityIds, satisfied: false });

const dim = (
  id: string,
  type: SketchDimension['type'],
  entityIds: string[],
  value: number,
): SketchDimension => ({ id, type, entityIds, value, position: P(0, 0), locked: true });

// ─── Entity emission ────────────────────────────────────────────────────────

describe('W1-D — makeCircleSegment emits a real circle entity', () => {
  it("produces ONE segment of type 'circle' with [centre, rim] and ids on both", () => {
    const seg = makeCircleSegment(P(10, 20), 5);
    expect(seg.type).toBe('circle');
    expect(seg.points).toHaveLength(2);
    expect(seg.points[0]).toMatchObject({ x: 10, y: 20 });
    expect(seg.points[1]).toMatchObject({ x: 15, y: 20 });
    // Both handles need ids or the solver cannot see them (readPt keys on id).
    expect(seg.points[0].id).toBeTruthy();
    expect(seg.points[1].id).toBeTruthy();
    expect(seg.id).toBeTruthy();
  });

  it('rimAngle places the rim handle without changing the circle', () => {
    const seg = makeCircleSegment(P(0, 0), 4, { rimAngle: Math.PI / 2 });
    expect(seg.points[1].x).toBeCloseTo(0);
    expect(seg.points[1].y).toBeCloseTo(4);
    expect(circleSegmentGeometry(seg)!.r).toBeCloseTo(4);
  });

  it('circleSegmentGeometry reads centre/radius; rejects non-circles and degenerates', () => {
    const g = circleSegmentGeometry(makeCircleSegment(P(-3, 7), 12))!;
    expect(g.cx).toBeCloseTo(-3);
    expect(g.cy).toBeCloseTo(7);
    expect(g.r).toBeCloseTo(12);
    expect(circleSegmentGeometry({ type: 'line', points: [P(0, 0), P(1, 1)] })).toBeNull();
    expect(circleSegmentGeometry(makeCircleSegment(P(0, 0), 0))).toBeNull();
  });

  it('circleSvgPath emits two half-arcs and closes (a single arc cannot)', () => {
    const d = circleSvgPath(makeCircleSegment(P(0, 0), 5))!;
    expect(d.match(/A /g)).toHaveLength(2);
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  it('findNearestSegment can pick a circle by its rim — the gate the dimension and constraint tools go through', () => {
    const segs = [makeCircleSegment(P(0, 0), 10)];
    // On the rim → hit.
    expect(findNearestSegment(segs, P(0, 10.2), 1)).toMatchObject({ index: 0 });
    // At the centre → 10mm from the rim, outside the pick threshold.
    expect(findNearestSegment(segs, P(0, 0), 1)).toBeNull();
  });
});

// ─── The four circle constraints actually SOLVE ─────────────────────────────

describe('W1-D — concentric actually moves the circles together', () => {
  it('drives two separated centres onto each other', () => {
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(40, 25), 4);
    const segs = [a, b];

    const before = Math.hypot(40 - 0, 25 - 0);
    expect(before).toBeGreaterThan(40); // starts violated

    const res = solveConstraints(segs, [con('c1', 'concentric', [a.id!, b.id!])], []);
    const out = applySolved(segs, res.points);
    const ga = geomOf(out, 0);
    const gb = geomOf(out, 1);

    expect(res.satisfied).toBe(true);
    expect(Math.hypot(gb.cx - ga.cx, gb.cy - ga.cy)).toBeLessThan(1e-6);
    // Geometry really moved — not merely "registered".
    expect(Math.hypot(gb.cx - 40, gb.cy - 25)).toBeGreaterThan(1);
    // Both centres are free and the residual is symmetric, so they meet at
    // the midpoint of the two starting centres.
    expect(ga.cx).toBeCloseTo(20, 6);
    expect(ga.cy).toBeCloseTo(12.5, 6);
  });

  it('MEASURED LIMITATION: concentric alone is NOT radius-preserving', () => {
    // Documented, not endorsed. Under the [centre, rim] parameterisation the
    // radius is the DERIVED quantity |rim - centre|. The concentric residual
    // touches centre coordinates only, so the rim columns of the Jacobian are
    // identically zero and the rim handles never move — dragging the centre
    // therefore changes the radius as a side effect.
    //
    // SolidWorks/Fusion keep the radius invariant here. Making this match
    // requires a solver-model change (reparameterise the circle as (cx,cy,r),
    // or couple the rim to the centre), which is out of W1-D's file scope —
    // reported to the orchestrator instead of changed unilaterally.
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(40, 25), 4);
    const segs = [a, b];
    const res = solveConstraints(segs, [con('c1', 'concentric', [a.id!, b.id!])], []);
    const out = applySolved(segs, res.points);

    // Rim handles are untouched...
    expect(res.points.get(a.points[1].id!)).toMatchObject({ x: 10, y: 0 });
    expect(res.points.get(b.points[1].id!)).toMatchObject({ x: 44, y: 25 });
    // ...so the radii drift to |rim - newCentre|.
    expect(geomOf(out, 0).r).toBeCloseTo(Math.hypot(10 - 20, 0 - 12.5), 6);
    expect(geomOf(out, 1).r).toBeCloseTo(Math.hypot(44 - 20, 25 - 12.5), 6);
  });

  it('WORKAROUND: pairing concentric with radial dimensions holds both radii', () => {
    // The supported way to get SolidWorks-like behaviour today.
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(40, 25), 4);
    const segs = [a, b];
    const res = solveConstraints(
      segs,
      [con('c1', 'concentric', [a.id!, b.id!])],
      [dim('d1', 'radial', [a.id!], 10), dim('d2', 'radial', [b.id!], 4)],
    );
    const out = applySolved(segs, res.points);

    expect(res.satisfied).toBe(true);
    expect(geomOf(out, 0).r).toBeCloseTo(10, 5);
    expect(geomOf(out, 1).r).toBeCloseTo(4, 5);
    expect(Math.hypot(geomOf(out, 1).cx - geomOf(out, 0).cx,
                      geomOf(out, 1).cy - geomOf(out, 0).cy)).toBeLessThan(1e-5);
  });
});

describe('W1-D — radius/diameter dimensions actually resize the circle', () => {
  it('a locked radial dimension drives the radius to the target', () => {
    const c = makeCircleSegment(P(5, 5), 10);
    const segs = [c];
    const res = solveConstraints(segs, [], [dim('d1', 'radial', [c.id!], 3)]);
    const out = applySolved(segs, res.points);
    const g = geomOf(out, 0);

    expect(res.satisfied).toBe(true);
    expect(g.r).toBeCloseTo(3, 6);
    expect(g.r).not.toBeCloseTo(10, 1); // it moved
  });

  it('a locked diameter dimension drives the radius to value/2', () => {
    const c = makeCircleSegment(P(0, 0), 2);
    const segs = [c];
    const res = solveConstraints(segs, [], [dim('d1', 'diameter', [c.id!], 25)]);
    const out = applySolved(segs, res.points);

    expect(res.satisfied).toBe(true);
    expect(geomOf(out, 0).r).toBeCloseTo(12.5, 6);
  });

  it('radius + concentric solve together (coupled system, not one-at-a-time)', () => {
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(30, 30), 4);
    const segs = [a, b];
    const res = solveConstraints(
      segs,
      [con('c1', 'concentric', [a.id!, b.id!])],
      [dim('d1', 'radial', [a.id!], 20), dim('d2', 'diameter', [b.id!], 14)],
    );
    const out = applySolved(segs, res.points);
    const ga = geomOf(out, 0);
    const gb = geomOf(out, 1);

    expect(res.satisfied).toBe(true);
    expect(ga.r).toBeCloseTo(20, 5);
    expect(gb.r).toBeCloseTo(7, 5);
    expect(Math.hypot(gb.cx - ga.cx, gb.cy - ga.cy)).toBeLessThan(1e-5);
  });
});

describe('W1-D — tangent actually solves', () => {
  it('two circles: separation converges to r1 + r2', () => {
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(50, 0), 5);
    const segs = [a, b];
    // Starts at 50 apart; tangency wants 15.
    const res = solveConstraints(segs, [con('c1', 'tangent', [a.id!, b.id!])], []);
    const out = applySolved(segs, res.points);
    const ga = geomOf(out, 0);
    const gb = geomOf(out, 1);

    expect(res.satisfied).toBe(true);
    const d = Math.hypot(gb.cx - ga.cx, gb.cy - ga.cy);
    expect(d).toBeCloseTo(ga.r + gb.r, 5);
    expect(Math.abs(d - 50)).toBeGreaterThan(1); // it moved
  });

  it('two circles with both radii pinned: centres move to exactly 15 apart', () => {
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(50, 0), 5);
    const segs = [a, b];
    const res = solveConstraints(
      segs,
      [con('c1', 'tangent', [a.id!, b.id!])],
      [dim('d1', 'radial', [a.id!], 10), dim('d2', 'radial', [b.id!], 5)],
    );
    const out = applySolved(segs, res.points);
    const ga = geomOf(out, 0);
    const gb = geomOf(out, 1);

    expect(res.satisfied).toBe(true);
    expect(ga.r).toBeCloseTo(10, 5);
    expect(gb.r).toBeCloseTo(5, 5);
    expect(Math.hypot(gb.cx - ga.cx, gb.cy - ga.cy)).toBeCloseTo(15, 5);
  });

  it('line + circle: perpendicular distance from centre to the line converges to r', () => {
    const c = makeCircleSegment(P(0, 20), 5);
    // Horizontal line along y = 0; centre is 20 above it, radius 5 → violated.
    const lineSeg: SketchSegment = {
      type: 'line',
      points: [{ x: -50, y: 0, id: 'L0' }, { x: 50, y: 0, id: 'L1' }],
      id: 'LINE',
    };
    const segs = [c, lineSeg];
    const res = solveConstraints(
      segs,
      [
        con('c1', 'tangent', [c.id!, lineSeg.id!]),
        // Pin the line so the circle is what moves.
        con('f0', 'fixed', ['L0']),
        con('f1', 'fixed', ['L1']),
      ],
      [dim('d1', 'radial', [c.id!], 5)],
    );
    const out = applySolved(segs, res.points);
    const g = geomOf(out, 0);

    expect(res.satisfied).toBe(true);
    expect(g.r).toBeCloseTo(5, 5);
    // Line is y = 0, so the perpendicular distance is |cy|.
    expect(Math.abs(g.cy)).toBeCloseTo(5, 5);
    // The line itself did not budge.
    const solvedL0 = res.points.get('L0')!;
    expect(solvedL0.x).toBeCloseTo(-50);
    expect(solvedL0.y).toBeCloseTo(0);
  });
});

// ─── DOF accounting ─────────────────────────────────────────────────────────

describe('W1-D — DOF accounting for circles', () => {
  it('a free circle reports 4 DOF under the [centre, rim] parameterisation', () => {
    // A circle is geometrically 3-DOF (cx, cy, r). The data model stores it as
    // two points = 4 free coordinates, and the extra one is the rim handle's
    // ANGLE about the centre — a gauge freedom that changes no geometry.
    // The solver counts variables, so it reports 4. This is asserted (not
    // silently accepted) so a future gauge-fixing change trips this test.
    const c = makeCircleSegment(P(0, 0), 10);
    const res = solveConstraints([c], [], []);
    expect(solveResultOf(res).dof).toBe(4);
  });

  it('pinning the centre and the radius leaves exactly the 1 gauge DOF', () => {
    const c = makeCircleSegment(P(0, 0), 10);
    const res = solveConstraints(
      [c],
      [con('f', 'fixed', [c.points[0].id!])],
      [dim('d1', 'radial', [c.id!], 12)],
    );
    // `fixed` eliminates the centre's 2 vars in buildVars; the rim keeps 2;
    // the radial dimension removes 1 → 1 left = the rim ANGLE (pure gauge).
    // So the circle's 3 real DOF (cx, cy, r) are fully accounted for.
    expect(solveResultOf(res).dof).toBe(1);
    expect(solveResultOf(res).status).toBe('under-defined');
  });

  it('MEASURED SOLVER-REPORTING BUG: DOF is not computed when the sketch starts already satisfied', () => {
    // Pre-existing in constraintSolver.ts and NOT circle-specific: `dof` is
    // derived from the rank of the LAST Jacobian, but the LM loop is
    // `while (err > tolerance ...)`. A sketch that starts converged never
    // iterates, so `lastJ` stays null and the code falls back to `dof = n`
    // (the raw variable count) — over-reporting the DOF.
    //
    // Same sketch, same constraints; only the dimension TARGET differs.
    const c = makeCircleSegment(P(0, 0), 10);
    const build = (target: number) => solveConstraints(
      [c],
      [con('f', 'fixed', [c.points[0].id!])],
      [dim('d1', 'radial', [c.id!], target)],
    );
    // Target != current radius → solver iterates → correct rank-based DOF.
    expect(solveResultOf(build(12)).dof).toBe(1);
    // Target == current radius → zero iterations → DOF falls back to n = 2.
    expect(solveResultOf(build(10)).dof).toBe(2);
    // Reported to the orchestrator; the fix belongs in the solver's DOF
    // reporting (seed the Jacobian before the loop), not in W1-D's scope,
    // because it shifts DOF numbers for every geometry type at once.
  });

  it('two circles + concentric removes exactly 2 DOF', () => {
    const a = makeCircleSegment(P(0, 0), 10);
    const b = makeCircleSegment(P(40, 25), 4);
    const free = solveResultOf(solveConstraints([a, b], [], [])).dof;
    const bound = solveResultOf(solveConstraints([a, b], [con('c1', 'concentric', [a.id!, b.id!])], [])).dof;
    expect(free).toBe(8);
    expect(bound).toBe(6);
  });
});

// ─── Back-compat with the legacy 32-gon ─────────────────────────────────────

describe('W1-D — legacy 32-line circle approximations', () => {
  it('load path is untouched: a stored 32-gon still reads back as 32 line segments', () => {
    const legacy = generateCircleSegments(P(0, 0), 10, 32);
    expect(legacy).toHaveLength(32);
    expect(legacy.every(s => s.type === 'line')).toBe(true);
    // No detector runs on load — nothing here mutates the stored geometry.
  });

  it('detectCircleApproximations recognises a legacy 32-gon without changing it', () => {
    const legacy = generateCircleSegments(P(3, -4), 7, 32);
    const found = detectCircleApproximations(legacy);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(32);
    expect(found[0].center.x).toBeCloseTo(3, 6);
    expect(found[0].center.y).toBeCloseTo(-4, 6);
    expect(found[0].radius).toBeCloseTo(7, 6);
    expect(legacy).toHaveLength(32); // detector is non-mutating
  });

  it('does NOT flag a hand-drawn square or a polygon-tool hexagon', () => {
    const square: SketchSegment[] = [
      { type: 'line', points: [P(0, 0), P(10, 0)] },
      { type: 'line', points: [P(10, 0), P(10, 10)] },
      { type: 'line', points: [P(10, 10), P(0, 10)] },
      { type: 'line', points: [P(0, 10), P(0, 0)] },
    ];
    expect(detectCircleApproximations(square)).toHaveLength(0);
    // A hexagon IS a perfect equal-radius closed run, so the guard is the
    // side-count floor, not the radius test.
    const hex = generateCircleSegments(P(0, 0), 5, 6);
    expect(hex.length).toBeLessThan(CIRCLE_APPROX_MIN_SIDES);
    expect(detectCircleApproximations(hex)).toHaveLength(0);
  });

  it('promoteCircleApproximations is explicit opt-in and yields a constrainable circle', () => {
    const legacy = generateCircleSegments(P(0, 0), 10, 32);
    const mixed = [...legacy, { type: 'line', points: [P(100, 0), P(120, 0)] } as SketchSegment];

    const { segments, promoted } = promoteCircleApproximations(mixed);
    expect(promoted).toBe(1);
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe('circle');
    expect(segments[1].type).toBe('line'); // unrelated geometry preserved
    expect(circleSegmentGeometry(segments[0])!.r).toBeCloseTo(10, 6);

    // The promoted entity is now solvable — the whole point of promoting.
    const other = makeCircleSegment(P(60, 60), 3);
    const segs = [segments[0], other];
    const res = solveConstraints(segs, [con('c1', 'concentric', [segments[0].id!, other.id!])], []);
    const out = applySolved(segs, res.points);
    expect(res.satisfied).toBe(true);
    expect(Math.hypot(geomOf(out, 1).cx - geomOf(out, 0).cx,
                      geomOf(out, 1).cy - geomOf(out, 0).cy)).toBeLessThan(1e-6);
  });

  it('a legacy 32-gon cannot bind a circle constraint — the bug W1-D fixes', () => {
    // Regression witness: this is what the circle tool used to produce.
    const legacy = generateCircleSegments(P(0, 0), 10, 32);
    const other = makeCircleSegment(P(60, 60), 3);
    const segs = [...legacy, other];
    const res = solveConstraints(
      segs,
      [con('c1', 'concentric', [legacy[0].id!, other.id!])],
      [],
    );
    const out = applySolved(segs, res.points);
    const g = circleSegmentGeometry(out[out.length - 1])!;
    // Nothing moved: `circleIds()` rejects a 'line' segment, so no residual
    // was ever emitted for the constraint.
    expect(g.cx).toBeCloseTo(60, 6);
    expect(g.cy).toBeCloseTo(60, 6);
  });
});
