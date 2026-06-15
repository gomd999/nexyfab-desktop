/**
 * sketchGroup — acceptance tests.
 *
 * Covers: create / verify-entity / anchor (explicit + computed),
 * translate / rotate / scale (anchor-centered + custom-center),
 * lock policy (translate/rotate/scale blocked, toggle allowed),
 * remove (entities preserved), isInGroup, dedup of shared points,
 * mixed-entity groups (point/line/circle/arc), fixed-point skip,
 * initialGroups seeding.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createSketchSolver, SketchSolver } from './solver';
import { createSketchGroupManager, type SketchGroup } from './sketchGroup';

let solver: SketchSolver | null = null;

afterEach(() => {
  solver?.destroy();
  solver = null;
});

// Helper: read a point's current (x,y) — pushes pending primitives via solve()
// so movePoint can address them via p_param_index.
function flush(s: SketchSolver): void {
  s.solve();
}

describe('sketchGroup — create', () => {
  it('creates a group with 3 points and computes default anchor as average', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(6, 0);
    const p3 = solver.addPoint(0, 6);
    flush(solver);

    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('triangle', [p1, p2, p3]);

    expect(g.id).toMatch(/^g\d+$/);
    expect(g.name).toBe('triangle');
    expect(g.entityIds).toEqual([p1, p2, p3]);
    expect(g.anchor.x).toBeCloseTo(2, 6);
    expect(g.anchor.y).toBeCloseTo(2, 6);
    expect(g.locked).toBe(false);
    expect(mgr.groups).toHaveLength(1);
  });

  it('uses explicit anchor when provided', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(10, 0);
    flush(solver);

    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pair', [p1, p2], { x: 100, y: 200 });
    expect(g.anchor).toEqual({ x: 100, y: 200 });
  });

  it('throws on unknown entity id', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    expect(() => mgr.create('bad', [p1, 'bogus-id'])).toThrow(/not found/);
  });

  it('throws on empty entity list', async () => {
    solver = await createSketchSolver();
    const mgr = createSketchGroupManager(solver);
    expect(() => mgr.create('empty', [])).toThrow(/empty/);
  });

  it('assigns sequential group ids', async () => {
    solver = await createSketchSolver();
    const p = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g1 = mgr.create('a', [p]);
    const g2 = mgr.create('b', [p]);
    expect(g1.id).not.toBe(g2.id);
    expect(mgr.groups.map((g) => g.id)).toEqual([g1.id, g2.id]);
  });

  it('mixed entity types — line + circle + arc — anchor averages all underlying points', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(10, 0);
    const line = solver.addLine(p1, p2);

    const cc = solver.addPoint(20, 0);
    const circle = solver.addCircle(cc, 5);

    const ac = solver.addPoint(30, 0);
    const as = solver.addPoint(35, 0);
    const ae = solver.addPoint(30, 5);
    const arc = solver.addArc(ac, as, ae, 5, 0, Math.PI / 2);
    flush(solver);

    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('mixed', [line, circle, arc]);
    // Underlying distinct points: p1,p2,cc,ac,as,ae → 6 points
    // avg x: (0+10+20+30+35+30)/6 = 125/6
    expect(g.anchor.x).toBeCloseTo(125 / 6, 4);
    // avg y: (0+0+0+0+0+5)/6
    expect(g.anchor.y).toBeCloseTo(5 / 6, 4);
  });
});

describe('sketchGroup — translate', () => {
  it('translate(10, 0) shifts each point.x by 10', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(5, 0);
    const p3 = solver.addPoint(0, 5);
    flush(solver);

    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('tri', [p1, p2, p3]);
    mgr.translate(g.id, 10, 0);
    flush(solver);

    expect(solver.point(p1).x).toBeCloseTo(10, 5);
    expect(solver.point(p2).x).toBeCloseTo(15, 5);
    expect(solver.point(p3).x).toBeCloseTo(10, 5);
    expect(solver.point(p1).y).toBeCloseTo(0, 5);
    expect(solver.point(p2).y).toBeCloseTo(0, 5);
    expect(solver.point(p3).y).toBeCloseTo(5, 5);
  });

  it('translate(0, -3) shifts y only', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(2, 7);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('one', [p1]);
    mgr.translate(g.id, 0, -3);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(2, 5);
    expect(solver.point(p1).y).toBeCloseTo(4, 5);
  });

  it('translate updates anchor so subsequent rotate works around new center', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(1, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pt', [p1], { x: 0, y: 0 });
    mgr.translate(g.id, 10, 0);
    flush(solver);
    // After translate: anchor=(10,0), p1=(11,0). Rotate 180°: p1=(9,0).
    mgr.rotate(g.id, Math.PI);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(9, 4);
    expect(solver.point(p1).y).toBeCloseTo(0, 4);
  });

  it('translate dedupes shared points (line endpoint == circle center)', async () => {
    solver = await createSketchSolver();
    const shared = solver.addPoint(0, 0);
    const p2 = solver.addPoint(10, 0);
    const line = solver.addLine(shared, p2);
    const circle = solver.addCircle(shared, 3);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('joined', [line, circle]);
    mgr.translate(g.id, 5, 0);
    flush(solver);
    // shared moves to (5,0) — NOT (10,0) which would happen if double-applied.
    expect(solver.point(shared).x).toBeCloseTo(5, 5);
  });

  it('skips fixed points (no throw)', async () => {
    solver = await createSketchSolver();
    const pf = solver.addPoint(0, 0, { fixed: true });
    const pm = solver.addPoint(5, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('mixed', [pf, pm]);
    expect(() => mgr.translate(g.id, 3, 4)).not.toThrow();
    flush(solver);
    expect(solver.point(pf).x).toBeCloseTo(0, 5);
    expect(solver.point(pf).y).toBeCloseTo(0, 5);
    expect(solver.point(pm).x).toBeCloseTo(8, 5);
    expect(solver.point(pm).y).toBeCloseTo(4, 5);
  });

  it('rejects non-finite dx/dy', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    expect(() => mgr.translate(g.id, Number.NaN, 0)).toThrow(/finite/);
    expect(() => mgr.translate(g.id, 0, Infinity)).toThrow(/finite/);
  });
});

describe('sketchGroup — rotate', () => {
  it('rotate(90°) around anchor (0,0): (1,0) -> (0,1)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(1, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pt', [p1], { x: 0, y: 0 });
    mgr.rotate(g.id, Math.PI / 2);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(0, 5);
    expect(solver.point(p1).y).toBeCloseTo(1, 5);
  });

  it('rotate(180°) around anchor (5,5): (10,5) -> (0,5)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(10, 5);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pt', [p1], { x: 5, y: 5 });
    mgr.rotate(g.id, Math.PI);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(0, 4);
    expect(solver.point(p1).y).toBeCloseTo(5, 4);
  });

  it('rotate(90°) keeps anchor invariant', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(2, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pt', [p1], { x: 1, y: 1 });
    const before = mgr.groups[0].anchor;
    mgr.rotate(g.id, Math.PI / 2);
    const after = mgr.groups[0].anchor;
    expect(after).toEqual(before);
  });

  it('rotate(2π) is approximately identity', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(3, 4);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pt', [p1], { x: 0, y: 0 });
    mgr.rotate(g.id, 2 * Math.PI);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(3, 4);
    expect(solver.point(p1).y).toBeCloseTo(4, 4);
  });

  it('rotate rejects non-finite angle', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    expect(() => mgr.rotate(g.id, Number.NaN)).toThrow(/finite/);
  });
});

describe('sketchGroup — scale', () => {
  it('scale(2x) around anchor doubles distances', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(4, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pair', [p1, p2], { x: 0, y: 0 });
    mgr.scale(g.id, 2);
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(0, 5);
    expect(solver.point(p2).x).toBeCloseTo(8, 5);
  });

  it('scale(0.5x) around custom center', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(10, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('pt', [p1], { x: 999, y: 999 });
    mgr.scale(g.id, 0.5, { x: 0, y: 0 });
    flush(solver);
    expect(solver.point(p1).x).toBeCloseTo(5, 5);
    expect(solver.point(p1).y).toBeCloseTo(0, 5);
  });

  it('scale also updates circle radius proportionally', async () => {
    solver = await createSketchSolver();
    const c = solver.addPoint(0, 0);
    const circle = solver.addCircle(c, 4);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('c', [circle], { x: 0, y: 0 });
    mgr.scale(g.id, 3);
    // Read radius BEFORE next solve — setCircleRadius is a JS-side primitive
    // mutation (per solver.ts Phase 1.B note) which apply_solution() would
    // overwrite back to the originally-pushed param value if not pinned via
    // addRadius. For visual/render purposes the immediate read is what
    // matters.
    expect(solver.circle(circle).radius).toBeCloseTo(12, 5);
  });

  it('scale updates arc radius too', async () => {
    solver = await createSketchSolver();
    const ac = solver.addPoint(0, 0);
    const as = solver.addPoint(2, 0);
    const ae = solver.addPoint(0, 2);
    const arc = solver.addArc(ac, as, ae, 2, 0, Math.PI / 2);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('a', [arc], { x: 0, y: 0 });
    mgr.scale(g.id, 2);
    // Same caveat as circle radius: setArc(radius) is JS-side primitive
    // mutation; check before solve() to observe the post-scale value.
    expect(solver.arc(arc).radius).toBeCloseTo(4, 5);
  });

  it('scale rejects factor=0', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    expect(() => mgr.scale(g.id, 0)).toThrow(/non-zero/);
  });

  it('scale rejects non-finite factor', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    expect(() => mgr.scale(g.id, Infinity)).toThrow(/finite/);
  });
});

describe('sketchGroup — lock policy', () => {
  it('locked group blocks translate', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    mgr.toggleLock(g.id);
    expect(mgr.groups[0].locked).toBe(true);
    expect(() => mgr.translate(g.id, 1, 1)).toThrow(/locked/);
  });

  it('locked group blocks rotate + scale', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(1, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    mgr.toggleLock(g.id);
    expect(() => mgr.rotate(g.id, Math.PI)).toThrow(/locked/);
    expect(() => mgr.scale(g.id, 2)).toThrow(/locked/);
  });

  it('toggleLock flips state both ways', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    expect(mgr.groups[0].locked).toBe(false);
    mgr.toggleLock(g.id);
    expect(mgr.groups[0].locked).toBe(true);
    mgr.toggleLock(g.id);
    expect(mgr.groups[0].locked).toBe(false);
    // and after unlocking we can translate again
    expect(() => mgr.translate(g.id, 1, 0)).not.toThrow();
  });
});

describe('sketchGroup — remove + isInGroup', () => {
  it('remove drops the group but leaves entities alive in solver', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(7, 8);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    mgr.remove(g.id);
    expect(mgr.groups).toHaveLength(0);
    // entity is still readable from solver
    expect(solver.point(p1)).toEqual({ x: 7, y: 8, fixed: false });
  });

  it('remove on unknown id is a no-op (no throw)', async () => {
    solver = await createSketchSolver();
    const mgr = createSketchGroupManager(solver);
    expect(() => mgr.remove('nope')).not.toThrow();
  });

  it('isInGroup returns groupId for member entity', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(1, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('m', [p1, p2]);
    expect(mgr.isInGroup(p1)).toBe(g.id);
    expect(mgr.isInGroup(p2)).toBe(g.id);
  });

  it('isInGroup returns null for non-member', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    const p2 = solver.addPoint(1, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    mgr.create('m', [p1]);
    expect(mgr.isInGroup(p2)).toBeNull();
    expect(mgr.isInGroup('anything-else')).toBeNull();
  });
});

describe('sketchGroup — initialGroups + snapshot safety', () => {
  it('seeds with initialGroups', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const seed: SketchGroup = {
      id: 'preset-1',
      name: 'preset',
      entityIds: [p1],
      anchor: { x: 0, y: 0 },
      locked: true,
    };
    const mgr = createSketchGroupManager(solver, [seed]);
    expect(mgr.groups).toHaveLength(1);
    expect(mgr.groups[0].id).toBe('preset-1');
    expect(mgr.groups[0].locked).toBe(true);
  });

  it('groups snapshot is defensive (external mutation does not corrupt state)', async () => {
    solver = await createSketchSolver();
    const p1 = solver.addPoint(0, 0);
    flush(solver);
    const mgr = createSketchGroupManager(solver);
    const g = mgr.create('p', [p1]);
    const snap = mgr.groups;
    // attempt external mutation
    (snap as SketchGroup[])[0].anchor.x = 9999;
    // internal anchor unchanged
    expect(mgr.groups[0].anchor.x).toBe(g.anchor.x);
    expect(mgr.groups[0].anchor.x).not.toBe(9999);
  });
});
