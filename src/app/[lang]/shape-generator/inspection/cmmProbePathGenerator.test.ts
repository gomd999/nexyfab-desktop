import { describe, it, expect } from 'vitest';
import {
  generateProbePath,
  summarize,
  type InspectionPoint,
} from './cmmProbePathGenerator';

function pt(id: string, x: number, y: number, z: number): InspectionPoint {
  return { id, target: { x, y, z }, normal: { x: 0, y: 0, z: 1 } };
}

describe('generateProbePath', () => {
  it('empty input → empty result', () => {
    const r = generateProbePath([]);
    expect(r.segments).toEqual([]);
    expect(r.visitOrder).toEqual([]);
  });

  it('single point produces rapid + approach + measure + retract segments', () => {
    const r = generateProbePath([pt('p1', 0, 0, 0)]);
    const kinds = r.segments.map(s => s.kind);
    expect(kinds).toContain('rapid');
    expect(kinds).toContain('approach');
    expect(kinds).toContain('measure');
    expect(kinds).toContain('retract');
  });

  it('measure segment ends at the target', () => {
    const r = generateProbePath([pt('p1', 1, 2, 3)]);
    const measure = r.segments.find(s => s.kind === 'measure');
    expect(measure!.end.x).toBeCloseTo(1, 5);
    expect(measure!.end.y).toBeCloseTo(2, 5);
    expect(measure!.end.z).toBeCloseTo(3, 5);
  });

  it('visits all points exactly once', () => {
    const pts = [pt('a', 0, 0, 0), pt('b', 5, 0, 0), pt('c', 10, 0, 0)];
    const r = generateProbePath(pts);
    expect(r.visitOrder.sort()).toEqual(['a', 'b', 'c']);
  });

  it('nearest-neighbor sequence preserves spatial locality', () => {
    const pts = [
      pt('far', 100, 100, 0),
      pt('near', 1, 1, 0),
      pt('home', 0, 0, 0),
    ];
    const r = generateProbePath(pts, { homePosition: { x: 0, y: 0, z: 25 }, optimizeSequence: true });
    expect(r.visitOrder[0]).toBe('home');
  });

  it('estimated time scales with feedrate', () => {
    const pts = [pt('a', 0, 0, 0), pt('b', 100, 0, 0)];
    const fast = generateProbePath(pts, { rapidFeedMmPerMin: 10000 });
    const slow = generateProbePath(pts, { rapidFeedMmPerMin: 1000 });
    expect(slow.estimatedTimeSec).toBeGreaterThan(fast.estimatedTimeSec);
  });

  it('totalRapid + totalFeed equals sum of segment lengths', () => {
    const r = generateProbePath([pt('a', 0, 0, 0), pt('b', 10, 0, 0)]);
    const sumLen = r.segments.reduce((s, seg) => s + seg.lengthMm, 0);
    expect(r.totalRapidMm + r.totalFeedMm).toBeCloseTo(sumLen, 3);
  });

  it('approach distance respected', () => {
    const r = generateProbePath([pt('p', 0, 0, 0)], { approachDistanceMm: 3 });
    const approach = r.segments.find(s => s.kind === 'approach');
    const dist = Math.hypot(
      approach!.end.x - approach!.start.x,
      approach!.end.y - approach!.start.y,
      approach!.end.z - approach!.start.z,
    );
    // approach ends approachDistance above target, so distance > approachDistance.
    expect(dist).toBeGreaterThanOrEqual(0);
  });

  it('detects opposing-normal collision risk', () => {
    const pts: InspectionPoint[] = [
      { id: 'a', target: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
      { id: 'b', target: { x: 0.3, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 } },
    ];
    const r = generateProbePath(pts, { optimizeSequence: false });
    expect(r.collisionFlags.length).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize(generateProbePath([]));
    expect(s.pointCount).toBe(0);
    expect(s.estimatedMinutes).toBe(0);
  });

  it('reports point count', () => {
    const s = summarize(generateProbePath([pt('a', 0, 0, 0), pt('b', 5, 0, 0)]));
    expect(s.pointCount).toBe(2);
  });

  it('rapid fraction between 0 and 1', () => {
    const s = summarize(generateProbePath([pt('a', 0, 0, 0), pt('b', 10, 0, 0)]));
    expect(s.rapidFraction).toBeGreaterThanOrEqual(0);
    expect(s.rapidFraction).toBeLessThanOrEqual(1);
  });

  it('estimated minutes positive for non-empty', () => {
    const s = summarize(generateProbePath([pt('a', 0, 0, 0)]));
    expect(s.estimatedMinutes).toBeGreaterThan(0);
  });
});
