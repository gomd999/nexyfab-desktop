import { describe, it, expect } from 'vitest';
import {
  buildTrails,
  summarize,
  type ExplodedPart,
} from './explodeLineConnector';

function part(id: string, ax: number, ay: number, az: number, ex: number, ey: number, ez: number): ExplodedPart {
  return {
    id,
    assembledCentroid: { x: ax, y: ay, z: az },
    explodedCentroid: { x: ex, y: ey, z: ez },
  };
}

describe('buildTrails', () => {
  it('empty input → empty output', () => {
    const r = buildTrails([]);
    expect(r.trails).toEqual([]);
    expect(r.spines).toEqual([]);
  });

  it('one trail per part', () => {
    const parts = [
      part('a', 0, 0, 0, 10, 0, 0),
      part('b', 0, 0, 0, 0, 10, 0),
    ];
    const r = buildTrails(parts);
    expect(r.trails).toHaveLength(2);
  });

  it('trail length = euclidean distance', () => {
    const parts = [part('a', 0, 0, 0, 3, 4, 0)];
    const r = buildTrails(parts);
    expect(r.trails[0]!.lengthMm).toBeCloseTo(5, 5);
  });

  it('trail polyline has 2 points by default', () => {
    const r = buildTrails([part('a', 0, 0, 0, 10, 0, 0)]);
    expect(r.trails[0]!.points).toHaveLength(2);
  });

  it('groupBySpine clusters parallel parts', () => {
    const parts = [
      part('a', 0, 0, 0, 10, 0, 0),
      part('b', 0, 5, 0, 10, 5, 0),
      part('c', 0, 0, 0, 0, 0, 10), // different axis
    ];
    const r = buildTrails(parts, { groupBySpine: true });
    expect(r.spines.length).toBeGreaterThan(0);
  });

  it('without groupBySpine → no spines', () => {
    const parts = [part('a', 0, 0, 0, 10, 0, 0)];
    const r = buildTrails(parts, { groupBySpine: false });
    expect(r.spines).toEqual([]);
  });

  it('spine axis label X+ for positive X direction', () => {
    const parts = [
      part('a', 0, 0, 0, 10, 0, 0),
      part('b', 0, 5, 0, 10, 5, 0),
    ];
    const r = buildTrails(parts, { groupBySpine: true });
    expect(r.spines[0]!.axisLabel).toBe('X+');
  });

  it('zero-distance parts trail length = 0', () => {
    const parts = [part('a', 5, 5, 5, 5, 5, 5)];
    const r = buildTrails(parts);
    expect(r.trails[0]!.lengthMm).toBe(0);
  });

  it('style respected', () => {
    const r = buildTrails([part('a', 0, 0, 0, 10, 0, 0)], { style: 'dash-dot' });
    expect(r.trails[0]!.style).toBe('dash-dot');
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize({ trails: [], spines: [] });
    expect(s.trailCount).toBe(0);
    expect(s.averageTrailLengthMm).toBe(0);
  });

  it('reports trail count and longest', () => {
    const parts = [
      part('a', 0, 0, 0, 10, 0, 0),
      part('b', 0, 0, 0, 5, 0, 0),
    ];
    const s = summarize(buildTrails(parts));
    expect(s.trailCount).toBe(2);
    expect(s.longestTrailMm).toBe(10);
  });
});
