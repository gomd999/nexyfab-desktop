import { describe, it, expect } from 'vitest';
import {
  layoutBalloons,
  detectCollisions,
  summarize,
  type BalloonAnchor,
  type ViewBounds,
} from './balloonCalloutLayout';

const view: ViewBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe('layoutBalloons', () => {
  it('empty anchors → warning + no placements', () => {
    const r = layoutBalloons([], view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    expect(r.placed).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('single anchor placed outside view bounds', () => {
    const anchors: BalloonAnchor[] = [{ id: 'a1', itemNumber: 1, point: { x: 50, y: 80 } }];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    const p = r.placed[0]!;
    // balloon should be above the view bbox (since anchor near top)
    expect(p.balloonCentre.y).toBeGreaterThan(view.maxY);
  });

  it('leader connects anchor to balloon', () => {
    const anchors: BalloonAnchor[] = [{ id: 'a1', itemNumber: 1, point: { x: 30, y: 30 } }];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    const p = r.placed[0]!;
    expect(p.leaderPolyline[0]).toEqual(p.anchor);
    expect(p.leaderPolyline[p.leaderPolyline.length - 1]).toEqual(p.balloonCentre);
  });

  it('multiple anchors all get placements', () => {
    const anchors: BalloonAnchor[] = [
      { id: 'a1', itemNumber: 1, point: { x: 20, y: 20 } },
      { id: 'a2', itemNumber: 2, point: { x: 80, y: 20 } },
      { id: 'a3', itemNumber: 3, point: { x: 80, y: 80 } },
      { id: 'a4', itemNumber: 4, point: { x: 20, y: 80 } },
    ];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    expect(r.placed).toHaveLength(4);
  });

  it('relaxation resolves clustered anchors', () => {
    // Two anchors near the same point should still get distinct balloon centres.
    const anchors: BalloonAnchor[] = [
      { id: 'a1', itemNumber: 1, point: { x: 49, y: 90 } },
      { id: 'a2', itemNumber: 2, point: { x: 51, y: 90 } },
    ];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    const d = Math.hypot(
      r.placed[0]!.balloonCentre.x - r.placed[1]!.balloonCentre.x,
      r.placed[0]!.balloonCentre.y - r.placed[1]!.balloonCentre.y,
    );
    expect(d).toBeGreaterThanOrEqual(2 * 5 + 2 - 0.01);
  });

  it('placed balloons not inside view (radial projection)', () => {
    const anchors: BalloonAnchor[] = [{ id: 'a1', itemNumber: 1, point: { x: 50, y: 50 } }];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    const p = r.placed[0]!;
    expect(
      p.balloonCentre.x < view.minX
      || p.balloonCentre.x > view.maxX
      || p.balloonCentre.y < view.minY
      || p.balloonCentre.y > view.maxY,
    ).toBe(true);
  });

  it('itemNumber preserved', () => {
    const anchors: BalloonAnchor[] = [{ id: 'a1', itemNumber: 42, point: { x: 50, y: 80 } }];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    expect(r.placed[0]!.itemNumber).toBe(42);
  });
});

describe('detectCollisions', () => {
  it('reports zero collisions for spread layout', () => {
    const anchors: BalloonAnchor[] = [
      { id: 'a1', itemNumber: 1, point: { x: 10, y: 50 } },
      { id: 'a2', itemNumber: 2, point: { x: 90, y: 50 } },
    ];
    const r = layoutBalloons(anchors, view, { marginMm: 15, balloonRadiusMm: 5, minSeparationMm: 2 });
    expect(detectCollisions(r, view).viewCollisions).toBe(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const anchors: BalloonAnchor[] = [
      { id: 'a1', itemNumber: 1, point: { x: 50, y: 80 } },
      { id: 'a2', itemNumber: 2, point: { x: 50, y: 20 } },
    ];
    const r = layoutBalloons(anchors, view, { marginMm: 10, balloonRadiusMm: 5, minSeparationMm: 2 });
    const s = summarize(r);
    expect(s.placedCount).toBe(2);
  });
});
