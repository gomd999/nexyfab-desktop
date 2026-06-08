import { describe, it, expect } from 'vitest';
import { detectCirclesAndArcs, type Seg } from './dxfArcDetect';

/** Build a faceted polyline approximating a circular arc as `n` chords. */
function facetedArc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    segs.push({
      x1: cx + r * Math.cos(t0), y1: cy + r * Math.sin(t0),
      x2: cx + r * Math.cos(t1), y2: cy + r * Math.sin(t1),
    });
  }
  return segs;
}

describe('detectCirclesAndArcs', () => {
  it('collapses a faceted full circle into one CIRCLE', () => {
    const segs = facetedArc(5, 5, 10, 0, 2 * Math.PI, 32);
    const r = detectCirclesAndArcs(segs);
    expect(r.circles).toHaveLength(1);
    expect(r.arcs).toHaveLength(0);
    expect(r.remaining).toHaveLength(0);
    expect(r.circles[0]!.cx).toBeCloseTo(5, 2);
    expect(r.circles[0]!.cy).toBeCloseTo(5, 2);
    expect(r.circles[0]!.r).toBeCloseTo(10, 1);
  });

  it('collapses a faceted half-circle into one ARC (0°→180°)', () => {
    const segs = facetedArc(0, 0, 8, 0, Math.PI, 16);
    const r = detectCirclesAndArcs(segs);
    expect(r.circles).toHaveLength(0);
    expect(r.arcs).toHaveLength(1);
    const a = r.arcs[0]!;
    expect(a.r).toBeCloseTo(8, 1);
    expect(a.startDeg).toBeCloseTo(0, 0);
    expect(a.endDeg).toBeCloseTo(180, 0);
  });

  it('leaves a square as 4 LINEs (no false circle)', () => {
    const segs: Seg[] = [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 10, y2: 10 },
      { x1: 10, y1: 10, x2: 0, y2: 10 },
      { x1: 0, y1: 10, x2: 0, y2: 0 },
    ];
    const r = detectCirclesAndArcs(segs);
    expect(r.circles).toHaveLength(0);
    expect(r.arcs).toHaveLength(0);
    expect(r.remaining).toHaveLength(4);
  });

  it('does NOT mistake a straight faceted polyline for a huge arc (curvature guard)', () => {
    const segs: Seg[] = [];
    for (let i = 0; i < 15; i++) segs.push({ x1: i, y1: 3, x2: i + 1, y2: 3 }); // 15 ≥ minSegments
    const r = detectCirclesAndArcs(segs);
    expect(r.circles).toHaveLength(0);
    expect(r.arcs).toHaveLength(0);
    expect(r.remaining).toHaveLength(15);
  });

  it('separates a circle from unrelated lines in the same set', () => {
    const circle = facetedArc(20, 20, 5, 0, 2 * Math.PI, 24);
    const lines: Seg[] = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 0, y1: 0, x2: 0, y2: 100 },
    ];
    const r = detectCirclesAndArcs([...circle, ...lines]);
    expect(r.circles).toHaveLength(1);
    expect(r.circles[0]!.r).toBeCloseTo(5, 1);
    expect(r.remaining).toHaveLength(2); // the two stray lines survive
  });

  it('respects minSegments (a coarse triangle-fan is not a circle)', () => {
    const segs = facetedArc(0, 0, 10, 0, 2 * Math.PI, 3); // 3 chords only
    const r = detectCirclesAndArcs(segs, { minSegments: 4 });
    expect(r.circles).toHaveLength(0);
  });
});
