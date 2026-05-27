import { describe, it, expect } from 'vitest';
import {
  generatePath,
  chipLoadPerInsert,
  cuttingSpeedMPerMin,
  summarize,
  type ThreadWhirlingInput,
} from './threadWhirlingPath';

const base: ThreadWhirlingInput = {
  threadMajorDiameterMm: 20,
  pitchMm: 2,
  threadLengthMm: 100,
  ringInsertCount: 4,
  ringRadiusMm: 30,
  workpieceRpm: 10,
  ringRpm: 2000,
};

describe('generatePath', () => {
  it('produces a head helix descending the part', () => {
    const r = generatePath(base);
    expect(r.headHelix.length).toBeGreaterThan(10);
    expect(r.headHelix[r.headHelix.length - 1]!.z).toBeCloseTo(-100, 4);
  });

  it('eccentricity = ringRadius − threadRadius', () => {
    const r = generatePath(base);
    expect(r.eccentricityMm).toBeCloseTo(30 - 10, 6);
  });

  it('revolutions = length / pitch', () => {
    const r = generatePath(base);
    expect(r.revolutions).toBeCloseTo(50, 6);
  });

  it('feed = workpieceRpm × pitch', () => {
    const r = generatePath(base);
    expect(r.feedMmPerMin).toBeCloseTo(10 * 2, 6);
  });

  it('chips/min = ringRpm × inserts', () => {
    const r = generatePath(base);
    expect(r.chipsPerMin).toBe(2000 * 4);
  });

  it('ring radius ≤ thread radius → warning', () => {
    const r = generatePath({ ...base, ringRadiusMm: 5 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('engagement arc positive when inserts penetrate the part', () => {
    // ecc > ringRadius − threadRadius → orbit cuts a real arc into the part.
    const r = generatePath({ ...base, eccentricityMm: 24 });
    expect(r.engagementArcDeg).toBeGreaterThan(0);
  });

  it('tangent setup (default ecc) → near-zero engagement arc', () => {
    const r = generatePath(base);
    expect(r.engagementArcDeg).toBeCloseTo(0, 4);
  });

  it('left hand reverses helix direction', () => {
    const right = generatePath({ ...base, hand: 'right' });
    const left = generatePath({ ...base, hand: 'left' });
    // mid-helix x/y differ in sign of rotation
    const idx = Math.floor(right.headHelix.length / 4);
    expect(Math.sign(right.headHelix[idx]!.y)).not.toBe(Math.sign(left.headHelix[idx]!.y));
  });

  it('zero pitch → warning', () => {
    const r = generatePath({ ...base, pitchMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('chipLoadPerInsert', () => {
  it('positive chip load', () => {
    expect(chipLoadPerInsert(base)).toBeGreaterThan(0);
  });

  it('more inserts → smaller chip load', () => {
    const few = chipLoadPerInsert({ ...base, ringInsertCount: 2 });
    const many = chipLoadPerInsert({ ...base, ringInsertCount: 8 });
    expect(many).toBeLessThan(few);
  });

  it('zero ring rpm → 0', () => {
    expect(chipLoadPerInsert({ ...base, ringRpm: 0 })).toBe(0);
  });
});

describe('cuttingSpeedMPerMin', () => {
  it('proportional to ring rpm + radius', () => {
    const slow = cuttingSpeedMPerMin({ ...base, ringRpm: 1000 });
    const fast = cuttingSpeedMPerMin({ ...base, ringRpm: 2000 });
    expect(fast).toBeCloseTo(2 * slow, 4);
  });
});

describe('summarize', () => {
  it('reports revolutions + eccentricity', () => {
    const r = generatePath(base);
    const s = summarize(r);
    expect(s.revolutions).toBe(r.revolutions);
    expect(s.eccentricityMm).toBe(r.eccentricityMm);
  });
});
