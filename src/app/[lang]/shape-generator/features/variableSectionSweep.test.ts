import { describe, it, expect } from 'vitest';
import {
  sweepVariableSection,
  circleProfile,
  polygonProfile,
  ellipseProfile,
  type SpinePathSample,
} from './variableSectionSweep';

function straightSpine(): SpinePathSample[] {
  return [
    { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
    { t: 1, position: { x: 0, y: 0, z: 100 }, tangent: { x: 0, y: 0, z: 1 } },
  ];
}

describe('sweepVariableSection — basic', () => {
  it('produces mesh with expected vertex count', () => {
    const spine = straightSpine();
    const r = sweepVariableSection(spine, circleProfile(5, 8), { stationCount: 4, profileResolution: 8 });
    expect(r.positions.length).toBe(4 * 8 * 3);
  });

  it('returns 0-vert mesh for short spine', () => {
    const r = sweepVariableSection([], circleProfile(5));
    expect(r.positions.length).toBe(0);
  });

  it('station + profile counts reported', () => {
    const r = sweepVariableSection(straightSpine(), circleProfile(5, 6), { stationCount: 5, profileResolution: 6 });
    expect(r.stationCount).toBe(5);
    expect(r.profileCount).toBe(6);
  });

  it('end caps add triangles', () => {
    const spine = straightSpine();
    const withCaps = sweepVariableSection(spine, circleProfile(5), { capEnds: true, profileResolution: 8 });
    const noCaps = sweepVariableSection(spine, circleProfile(5), { capEnds: false, profileResolution: 8 });
    expect(withCaps.indices.length).toBeGreaterThan(noCaps.indices.length);
  });
});

describe('sweepVariableSection — variable radius', () => {
  it('radius driver evaluated at each station', () => {
    const spine = straightSpine();
    // Linear growth from r=1 to r=10.
    const radiusFn = (s: number) => 1 + 9 * s;
    const r = sweepVariableSection(spine, circleProfile(radiusFn, 8), { stationCount: 4, profileResolution: 8 });
    expect(r.positions.length).toBe(96);
    // First station radius ≈ 1; last ≈ 10.
    const firstRing = r.positions.slice(0, 24);
    let firstMaxR = 0;
    for (let i = 0; i < 24; i += 3) firstMaxR = Math.max(firstMaxR, Math.hypot(firstRing[i]!, firstRing[i + 1]!));
    const lastRing = r.positions.slice(72, 96);
    let lastMaxR = 0;
    for (let i = 0; i < 24; i += 3) lastMaxR = Math.max(lastMaxR, Math.hypot(lastRing[i]!, lastRing[i + 1]!));
    expect(firstMaxR).toBeCloseTo(1, 5);
    expect(lastMaxR).toBeCloseTo(10, 5);
  });
});

describe('profile builders', () => {
  it('circleProfile produces unit-radius circle', () => {
    const fn = circleProfile(1, 12);
    const pts = fn(0.5);
    expect(pts).toHaveLength(12);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 5);
    }
  });

  it('polygonProfile honors side count', () => {
    const fn = polygonProfile(6, 1);
    const pts = fn(0.5);
    expect(pts).toHaveLength(6);
  });

  it('polygonProfile clamps to 3 sides minimum', () => {
    const fn = polygonProfile(1, 1);
    const pts = fn(0.5);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });

  it('ellipseProfile axes', () => {
    const fn = ellipseProfile(2, 1, 16);
    const pts = fn(0.5);
    expect(Math.abs(pts[0]!.x)).toBeCloseTo(2, 5);
    expect(Math.abs(pts[0]!.y)).toBeCloseTo(0, 5);
  });

  it('polygonProfile sides driven by s', () => {
    const fn = polygonProfile((s) => 3 + Math.floor(s * 6), 1);
    expect(fn(0).length).toBe(3);
    expect(fn(1).length).toBeGreaterThanOrEqual(3);
  });
});
