import { describe, it, expect } from 'vitest';
import { dragSolve } from './sketchDragSolve';
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
