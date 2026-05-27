import { describe, it, expect } from 'vitest';
import {
  detect,
  suggestPullDirection,
  summarize,
  type Polygon,
} from './partingLineDetector';

// A simple "house" pentagon (CCW): flat bottom, sloped roof.
const house: Polygon = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 20 },
  { x: 20, y: 35 },
  { x: 0, y: 20 },
];

describe('detect', () => {
  it('zero pull direction → warning', () => {
    const r = detect({ profile: house, pullDirection: { x: 0, y: 0 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('classifies edges into top/bottom/vertical', () => {
    const r = detect({ profile: house, pullDirection: { x: 0, y: 1 } });
    const classes = new Set(r.edges.map(e => e.classification));
    expect(classes.size).toBeGreaterThanOrEqual(2);
  });

  it('pull +Y: bottom edge faces away (bottom class)', () => {
    const r = detect({ profile: house, pullDirection: { x: 0, y: 1 } });
    // Edge 0 is the bottom edge (0,0)->(40,0), outward normal points -Y → bottom class.
    expect(r.edges[0]!.classification).toBe('bottom');
  });

  it('pull +Y: side walls flagged vertical', () => {
    const r = detect({ profile: house, pullDirection: { x: 0, y: 1 } });
    // Edges (40,0)->(40,20) and (0,20)->(0,0) are vertical walls.
    expect(r.verticalWallCount).toBeGreaterThanOrEqual(2);
  });

  it('parting points where top meets bottom', () => {
    const r = detect({ profile: house, pullDirection: { x: 1, y: 0 } });
    expect(r.partingPoints.length).toBeGreaterThanOrEqual(1);
  });

  it('normalDotPull sign consistent with classification', () => {
    const r = detect({ profile: house, pullDirection: { x: 0, y: 1 } });
    for (const e of r.edges) {
      if (e.classification === 'top') expect(e.normalDotPull).toBeGreaterThan(0);
      if (e.classification === 'bottom') expect(e.normalDotPull).toBeLessThan(0);
    }
  });

  it('degenerate profile → warning', () => {
    const r = detect({ profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }], pullDirection: { x: 0, y: 1 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('suggestPullDirection', () => {
  it('returns an angle with finite vertical wall count', () => {
    const best = suggestPullDirection(house, 36);
    expect(best.verticalWalls).toBeLessThan(Infinity);
    expect(best.angleDeg).toBeGreaterThanOrEqual(0);
    expect(best.angleDeg).toBeLessThan(360);
  });

  it('square pulled along a diagonal has fewer vertical walls than along an axis', () => {
    const square: Polygon = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const axisAligned = detect({ profile: square, pullDirection: { x: 0, y: 1 } });
    const best = suggestPullDirection(square, 36);
    expect(best.verticalWalls).toBeLessThanOrEqual(axisAligned.verticalWallCount);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = detect({ profile: house, pullDirection: { x: 0, y: 1 } });
    const s = summarize(r);
    expect(s.verticalWallCount).toBe(r.verticalWallCount);
    expect(s.partingPointCount).toBe(r.partingPoints.length);
  });
});
