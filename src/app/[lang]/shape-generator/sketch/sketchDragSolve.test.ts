import { describe, it, expect } from 'vitest';
import { dragSolve, dragSolveSegment } from './sketchDragSolve';
import { solveConstraints } from './constraintSolver';
import type { SketchConstraint, SketchDimension, SketchSegment } from './types';

// ─── fixtures ────────────────────────────────────────────────────────────────

/** 40×30 rectangle out of 4 line segments, corners glued with coincident,
 *  sides held horizontal/vertical, bottom-left corner fixed. Under-defined
 *  (width/height free) — the classic drag-resize test body. */
function makeRect(): { segments: SketchSegment[]; constraints: SketchConstraint[] } {
  const segments: SketchSegment[] = [
    { type: 'line', id: 'sB', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }] },
    { type: 'line', id: 'sR', points: [{ id: 'c', x: 40, y: 0 }, { id: 'd', x: 40, y: 30 }] },
    { type: 'line', id: 'sT', points: [{ id: 'e', x: 40, y: 30 }, { id: 'f', x: 0, y: 30 }] },
    { type: 'line', id: 'sL', points: [{ id: 'g', x: 0, y: 30 }, { id: 'h', x: 0, y: 0 }] },
  ];
  const constraints: SketchConstraint[] = [
    { id: 'k_ba', type: 'coincident', entityIds: ['b', 'c'], satisfied: false },
    { id: 'k_de', type: 'coincident', entityIds: ['d', 'e'], satisfied: false },
    { id: 'k_fg', type: 'coincident', entityIds: ['f', 'g'], satisfied: false },
    { id: 'k_ha', type: 'coincident', entityIds: ['h', 'a'], satisfied: false },
    { id: 'k_hB', type: 'horizontal', entityIds: ['sB'], satisfied: false },
    { id: 'k_hT', type: 'horizontal', entityIds: ['sT'], satisfied: false },
    { id: 'k_vR', type: 'vertical', entityIds: ['sR'], satisfied: false },
    { id: 'k_vL', type: 'vertical', entityIds: ['sL'], satisfied: false },
    { id: 'k_fix', type: 'fixed', entityIds: ['a'], satisfied: false },
  ];
  return { segments, constraints };
}

function pt(segments: SketchSegment[], id: string): { x: number; y: number } {
  for (const s of segments) for (const p of s.points) if (p.id === id) return { x: p.x, y: p.y };
  throw new Error(`point ${id} not found`);
}

/** Assert the rectangle invariants hold to drag tolerance. */
function expectRectConstraintsHold(segments: SketchSegment[], tol = 1e-3): void {
  // coincident corners
  for (const [p, q] of [['b', 'c'], ['d', 'e'], ['f', 'g'], ['h', 'a']] as const) {
    expect(Math.hypot(pt(segments, p).x - pt(segments, q).x, pt(segments, p).y - pt(segments, q).y)).toBeLessThan(tol);
  }
  // horizontal bottom/top
  expect(Math.abs(pt(segments, 'a').y - pt(segments, 'b').y)).toBeLessThan(tol);
  expect(Math.abs(pt(segments, 'e').y - pt(segments, 'f').y)).toBeLessThan(tol);
  // vertical left/right
  expect(Math.abs(pt(segments, 'c').x - pt(segments, 'd').x)).toBeLessThan(tol);
  expect(Math.abs(pt(segments, 'g').x - pt(segments, 'h').x)).toBeLessThan(tol);
  // fixed corner stays put
  expect(pt(segments, 'a').x).toBeCloseTo(0, 3);
  expect(pt(segments, 'a').y).toBeCloseTo(0, 3);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('dragSolve', () => {
  it('plain (free) move when there are no constraints and no locked dimensions', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 's0', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }] },
    ];
    const r = dragSolve(segments, [], [], 'b', { x: 25, y: -5 });
    expect(r.outcome).toBe('free');
    expect(pt(r.segments, 'b')).toEqual({ x: 25, y: -5 });
    // input untouched (pure function)
    expect(pt(segments, 'b')).toEqual({ x: 10, y: 0 });
  });

  it('free move relocates EVERY point sharing the dragged id (shared endpoints)', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 's0', points: [{ id: 'a', x: 0, y: 0 }, { id: 'j', x: 10, y: 0 }] },
      { type: 'line', id: 's1', points: [{ id: 'j', x: 10, y: 0 }, { id: 'c', x: 20, y: 5 }] },
    ];
    const r = dragSolve(segments, [], [], 'j', { x: 12, y: 7 });
    expect(r.outcome).toBe('free');
    expect(r.segments[0].points[1]).toMatchObject({ x: 12, y: 7 });
    expect(r.segments[1].points[0]).toMatchObject({ x: 12, y: 7 });
  });

  it('dragging a constrained rectangle corner keeps all constraints satisfied and reaches the cursor', () => {
    const { segments, constraints } = makeRect();
    const r = dragSolve(segments, constraints, [], 'd', { x: 60, y: 45 });
    expect(r.outcome).toBe('moved');
    expectRectConstraintsHold(r.segments);
    // Rectangle is under-defined in width/height → the corner reaches the cursor.
    expect(pt(r.segments, 'd').x).toBeCloseTo(60, 2);
    expect(pt(r.segments, 'd').y).toBeCloseTo(45, 2);
    // ...and drags the coupled corners with it (resize, not shear).
    expect(pt(r.segments, 'b').x).toBeCloseTo(60, 2);
    expect(pt(r.segments, 'f').y).toBeCloseTo(45, 2);
  });

  it('simulated multi-frame drag of the rectangle corner holds constraints every frame', () => {
    const { segments, constraints } = makeRect();
    let current = segments;
    // sweep the corner from (40,30) to (70,10) in 10 pointermove frames
    for (let i = 1; i <= 10; i++) {
      const target = { x: 40 + 3 * i, y: 30 - 2 * i };
      const r = dragSolve(current, constraints, [], 'd', target);
      expect(r.outcome).toBe('moved');
      expectRectConstraintsHold(r.segments);
      current = r.segments;
    }
    expect(pt(current, 'd').x).toBeCloseTo(70, 2);
    expect(pt(current, 'd').y).toBeCloseTo(10, 2);
    // Final state also passes the full diagnostic solver (status not broken).
    const diag = solveConstraints(current, constraints, []);
    expect(diag.satisfied).toBe(true);
  });

  it('preserves a locked linear dimension: endpoint slides along the constraint manifold', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 'sL', points: [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 50, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fix', type: 'fixed', entityIds: ['p'], satisfied: false },
    ];
    const dimensions: SketchDimension[] = [
      { id: 'd1', type: 'linear', entityIds: ['sL'], value: 50, position: { x: 25, y: 5 }, locked: true },
    ];
    // Incremental pointermove frames (real drag UX), cursor sweeping to (80,30).
    let current = segments;
    for (let i = 1; i <= 10; i++) {
      const target = { x: 50 + 3 * i, y: 3 * i };
      const r = dragSolve(current, constraints, dimensions, 'q', target);
      expect(r.outcome).toBe('moved');
      // length pinned at 50 EVERY frame (SolidWorks "rotate the dimensioned line" feel)
      const qi = pt(r.segments, 'q');
      expect(Math.hypot(qi.x, qi.y)).toBeCloseTo(50, 3);
      current = r.segments;
    }
    const q = pt(current, 'q');
    // ...with the point tracking the projection of the cursor onto the circle
    const want = { x: (80 / Math.hypot(80, 30)) * 50, y: (30 / Math.hypot(80, 30)) * 50 };
    expect(q.x).toBeCloseTo(want.x, 0);
    expect(q.y).toBeCloseTo(want.y, 0);
  });

  it('refuses to drag a fixed point (no-move, original segments returned)', () => {
    const { segments, constraints } = makeRect();
    const r = dragSolve(segments, constraints, [], 'a', { x: 10, y: 10 });
    expect(r.outcome).toBe('blocked-fixed');
    expect(r.segments).toBe(segments); // identical reference — nothing moved
  });

  it('falls back to no-move when constraints are unsatisfiable (over-constrained)', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 'sL', points: [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 50, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fix', type: 'fixed', entityIds: ['p'], satisfied: false },
    ];
    // Two conflicting driving dimensions on the same line: 50mm AND 80mm.
    const dimensions: SketchDimension[] = [
      { id: 'd1', type: 'linear', entityIds: ['sL'], value: 50, position: { x: 0, y: 0 }, locked: true },
      { id: 'd2', type: 'linear', entityIds: ['sL'], value: 80, position: { x: 0, y: 0 }, locked: true },
    ];
    const r = dragSolve(segments, constraints, dimensions, 'q', { x: 60, y: 10 });
    expect(r.outcome).toBe('blocked-unsolvable');
    expect(r.segments).toBe(segments); // no-move
    expect(r.residual).toBeGreaterThan(1e-3);
  });

  it('moves the edge point of a radius-locked circle around its center', () => {
    const segments: SketchSegment[] = [
      { type: 'circle', id: 'sC', points: [{ id: 'ctr', x: 0, y: 0 }, { id: 'edge', x: 20, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fix', type: 'fixed', entityIds: ['ctr'], satisfied: false },
    ];
    const dimensions: SketchDimension[] = [
      { id: 'dR', type: 'radial', entityIds: ['sC'], value: 20, position: { x: 0, y: 0 }, locked: true },
    ];
    const r = dragSolve(segments, constraints, dimensions, 'edge', { x: 0, y: 35 });
    expect(r.outcome).toBe('moved');
    const e = pt(r.segments, 'edge');
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(20, 3); // radius held
    expect(e.y).toBeGreaterThan(15); // rotated toward the cursor
  });

  it('is fast enough for per-pointermove use on small sketches', () => {
    const { segments, constraints } = makeRect();
    let current = segments;
    const t0 = performance.now();
    const frames = 20;
    for (let i = 1; i <= frames; i++) {
      const r = dragSolve(current, constraints, [], 'd', { x: 40 + i, y: 30 + i });
      current = r.segments;
    }
    const perFrame = (performance.now() - t0) / frames;
    // 60fps budget is 16ms; small-sketch drag must be well under it.
    // Generous CI bound to avoid flake, real-world is sub-millisecond.
    expect(perFrame).toBeLessThan(15);
  });
});

// ─── whole-segment (edge/body) drag ──────────────────────────────────────────

/** 40×30 rectangle held by parallel/perpendicular instead of H/V on every
 *  side — the body-drag regression target: dragging a side must keep the
 *  frame square each frame. Bottom-left corner fixed, bottom horizontal
 *  (anchors the orientation so parallel/perpendicular have a datum). */
function makeRectPP(): { segments: SketchSegment[]; constraints: SketchConstraint[] } {
  const segments: SketchSegment[] = [
    { type: 'line', id: 'sB', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }] },
    { type: 'line', id: 'sR', points: [{ id: 'c', x: 40, y: 0 }, { id: 'd', x: 40, y: 30 }] },
    { type: 'line', id: 'sT', points: [{ id: 'e', x: 40, y: 30 }, { id: 'f', x: 0, y: 30 }] },
    { type: 'line', id: 'sL', points: [{ id: 'g', x: 0, y: 30 }, { id: 'h', x: 0, y: 0 }] },
  ];
  const constraints: SketchConstraint[] = [
    { id: 'k_ba', type: 'coincident', entityIds: ['b', 'c'], satisfied: false },
    { id: 'k_de', type: 'coincident', entityIds: ['d', 'e'], satisfied: false },
    { id: 'k_fg', type: 'coincident', entityIds: ['f', 'g'], satisfied: false },
    { id: 'k_ha', type: 'coincident', entityIds: ['h', 'a'], satisfied: false },
    { id: 'k_hB', type: 'horizontal', entityIds: ['sB'], satisfied: false },
    { id: 'k_par', type: 'parallel', entityIds: ['sT', 'sB'], satisfied: false },
    { id: 'k_pR', type: 'perpendicular', entityIds: ['sR', 'sB'], satisfied: false },
    { id: 'k_pL', type: 'perpendicular', entityIds: ['sL', 'sB'], satisfied: false },
    { id: 'k_fix', type: 'fixed', entityIds: ['a'], satisfied: false },
  ];
  return { segments, constraints };
}

/** Normalized direction of a line segment by id. */
function dir(segments: SketchSegment[], segId: string): { x: number; y: number } {
  const s = segments.find(sg => sg.id === segId)!;
  const dx = s.points[1].x - s.points[0].x;
  const dy = s.points[1].y - s.points[0].y;
  const l = Math.hypot(dx, dy);
  return { x: dx / l, y: dy / l };
}

/** Assert the parallel/perpendicular rectangle invariants hold. */
function expectRectPPHolds(segments: SketchSegment[], tol = 1e-3): void {
  for (const [p, q] of [['b', 'c'], ['d', 'e'], ['f', 'g'], ['h', 'a']] as const) {
    expect(Math.hypot(pt(segments, p).x - pt(segments, q).x, pt(segments, p).y - pt(segments, q).y)).toBeLessThan(tol);
  }
  const dB = dir(segments, 'sB');
  const dT = dir(segments, 'sT');
  const dR = dir(segments, 'sR');
  const dL = dir(segments, 'sL');
  expect(Math.abs(dB.y)).toBeLessThan(tol);                       // bottom horizontal
  expect(Math.abs(dB.x * dT.y - dB.y * dT.x)).toBeLessThan(tol);  // sT ∥ sB (cross ≈ 0)
  expect(Math.abs(dB.x * dR.x + dB.y * dR.y)).toBeLessThan(tol);  // sR ⊥ sB (dot ≈ 0)
  expect(Math.abs(dB.x * dL.x + dB.y * dL.y)).toBeLessThan(tol);  // sL ⊥ sB
  expect(pt(segments, 'a').x).toBeCloseTo(0, 3);                  // fixed corner
  expect(pt(segments, 'a').y).toBeCloseTo(0, 3);
}

describe('dragSolveSegment', () => {
  it('free body translate when there are no constraints (whole segment, other segments untouched)', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 's0', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }] },
      { type: 'line', id: 's1', points: [{ id: 'c', x: 30, y: 30 }, { id: 'd', x: 40, y: 30 }] },
    ];
    const r = dragSolveSegment(segments, [], [], 's0', { x: 5, y: -3 });
    expect(r.outcome).toBe('free');
    expect(pt(r.segments, 'a')).toEqual({ x: 5, y: -3 });
    expect(pt(r.segments, 'b')).toEqual({ x: 15, y: -3 });
    expect(pt(r.segments, 'c')).toEqual({ x: 30, y: 30 }); // untouched
    // purity — inputs unchanged
    expect(pt(segments, 'a')).toEqual({ x: 0, y: 0 });
  });

  it('free body translate drags shared-id joints on neighbour segments (no tearing)', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 's0', points: [{ id: 'a', x: 0, y: 0 }, { id: 'j', x: 10, y: 0 }] },
      { type: 'line', id: 's1', points: [{ id: 'j', x: 10, y: 0 }, { id: 'c', x: 20, y: 5 }] },
    ];
    const r = dragSolveSegment(segments, [], [], 's0', { x: 2, y: 4 });
    expect(r.outcome).toBe('free');
    expect(r.segments[1].points[0]).toMatchObject({ x: 12, y: 4 }); // shared joint followed
    expect(pt(r.segments, 'c')).toEqual({ x: 20, y: 5 });           // far end untouched
  });

  it('free body translate of a typed rect segment moves both corners', () => {
    const segments: SketchSegment[] = [
      { type: 'rect', id: 'sRect', points: [{ id: 'c1', x: 0, y: 0 }, { id: 'c2', x: 20, y: 10 }] },
    ];
    const r = dragSolveSegment(segments, [], [], 'sRect', { x: -4, y: 6 });
    expect(r.outcome).toBe('free');
    expect(pt(r.segments, 'c1')).toEqual({ x: -4, y: 6 });
    expect(pt(r.segments, 'c2')).toEqual({ x: 16, y: 16 });
  });

  it('simulated edge drag of a constrained rectangle side holds parallel/perpendicular every frame', () => {
    const { segments, constraints } = makeRectPP();
    // Canvas gesture: solve from GESTURE-START geometry with the cumulative
    // cursor delta each pointermove frame (absolute targets, no drift).
    let last: SketchSegment[] = segments;
    for (let i = 1; i <= 8; i++) {
      const delta = { x: 2.5 * i, y: 0.625 * i }; // sweep to (+20, +5)
      const r = dragSolveSegment(segments, constraints, [], 'sR', delta);
      expect(r.outcome).toBe('moved');
      expectRectPPHolds(r.segments);
      last = r.segments;
    }
    // Width followed the cursor fully (free DOF); the right side ends at x=60.
    expect(pt(last, 'c').x).toBeCloseTo(60, 1);
    expect(pt(last, 'd').x).toBeCloseTo(60, 1);
    // Bottom stays welded to the fixed corner.
    expect(pt(last, 'c').y).toBeCloseTo(0, 2);
    // Final state passes the full diagnostic solver.
    const diag = solveConstraints(last, constraints, []);
    expect(diag.satisfied).toBe(true);
    // purity — gesture-start segments never mutated across the 8 frames
    expect(pt(segments, 'c')).toEqual({ x: 40, y: 0 });
    expect(pt(segments, 'd')).toEqual({ x: 40, y: 30 });
  });

  it('circle body drag with locked radius: center translates, radius held every frame', () => {
    const segments: SketchSegment[] = [
      { type: 'circle', id: 'sC', points: [{ id: 'ctr', x: 0, y: 0 }, { id: 'edge', x: 20, y: 0 }] },
    ];
    const dimensions: SketchDimension[] = [
      { id: 'dR', type: 'radial', entityIds: ['sC'], value: 20, position: { x: 0, y: 0 }, locked: true },
    ];
    for (let i = 1; i <= 6; i++) {
      const delta = { x: 2.5 * i, y: -1.5 * i }; // sweep to (+15, −9)
      const r = dragSolveSegment(segments, [], dimensions, 'sC', delta);
      expect(r.outcome).toBe('moved');
      const c = pt(r.segments, 'ctr');
      const e = pt(r.segments, 'edge');
      expect(c.x).toBeCloseTo(delta.x, 2);                       // center chased the cursor
      expect(c.y).toBeCloseTo(delta.y, 2);
      expect(Math.hypot(e.x - c.x, e.y - c.y)).toBeCloseTo(20, 3); // locked radius held
    }
    expect(pt(segments, 'ctr')).toEqual({ x: 0, y: 0 }); // purity
  });

  it('circle body drag with a FIXED center is blocked (no-move, same reference)', () => {
    const segments: SketchSegment[] = [
      { type: 'circle', id: 'sC', points: [{ id: 'ctr', x: 0, y: 0 }, { id: 'edge', x: 20, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fix', type: 'fixed', entityIds: ['ctr'], satisfied: false },
    ];
    const r = dragSolveSegment(segments, constraints, [], 'sC', { x: 10, y: 10 });
    expect(r.outcome).toBe('blocked-fixed');
    expect(r.segments).toBe(segments);
  });

  it('a `fixed` constraint on the segment id itself blocks the body drag', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 'sL', points: [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 50, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fixSeg', type: 'fixed', entityIds: ['sL'], satisfied: false },
    ];
    const r = dragSolveSegment(segments, constraints, [], 'sL', { x: 5, y: 5 });
    expect(r.outcome).toBe('blocked-fixed');
    expect(r.segments).toBe(segments);
  });

  it('falls back to no-move when constraints are unsatisfiable (over-constrained)', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 'sL', points: [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 50, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fix', type: 'fixed', entityIds: ['p'], satisfied: false },
    ];
    // Conflicting driving dimensions: 50mm AND 80mm on the same line.
    const dimensions: SketchDimension[] = [
      { id: 'd1', type: 'linear', entityIds: ['sL'], value: 50, position: { x: 0, y: 0 }, locked: true },
      { id: 'd2', type: 'linear', entityIds: ['sL'], value: 80, position: { x: 0, y: 0 }, locked: true },
    ];
    const r = dragSolveSegment(segments, constraints, dimensions, 'sL', { x: 10, y: 10 });
    expect(r.outcome).toBe('blocked-unsolvable');
    expect(r.segments).toBe(segments);
    expect(r.residual).toBeGreaterThan(1e-3);
  });

  it('line with ONE fixed endpoint: body drag moves the free endpoint only (anchor feel)', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 'sL', points: [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 50, y: 0 }] },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'k_fix', type: 'fixed', entityIds: ['p'], satisfied: false },
    ];
    const r = dragSolveSegment(segments, constraints, [], 'sL', { x: 10, y: 8 });
    expect(r.outcome).toBe('moved');
    expect(pt(r.segments, 'p')).toEqual({ x: 0, y: 0 });  // anchor stays
    expect(pt(r.segments, 'q').x).toBeCloseTo(60, 2);     // free end chased its pin
    expect(pt(r.segments, 'q').y).toBeCloseTo(8, 2);
  });

  it('unknown segment id reports blocked-unsolvable without touching geometry', () => {
    const segments: SketchSegment[] = [
      { type: 'line', id: 's0', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }] },
    ];
    const r = dragSolveSegment(segments, [], [], 'nope', { x: 1, y: 1 });
    expect(r.outcome).toBe('blocked-unsolvable');
    expect(r.segments).toBe(segments);
  });

  it('is fast enough for per-pointermove use on small sketches (edge drag)', () => {
    const { segments, constraints } = makeRectPP();
    const t0 = performance.now();
    const frames = 20;
    for (let i = 1; i <= frames; i++) {
      dragSolveSegment(segments, constraints, [], 'sR', { x: i, y: i / 2 });
    }
    const perFrame = (performance.now() - t0) / frames;
    expect(perFrame).toBeLessThan(15);
  });
});
