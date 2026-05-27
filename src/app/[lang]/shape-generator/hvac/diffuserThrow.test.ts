import { describe, it, expect } from 'vitest';
import {
  compute,
  faceVelocityForThrow,
  summarize,
  type DiffuserThrowInput,
} from './diffuserThrow';

const base: DiffuserThrowInput = {
  faceVelocityMS: 3,
  effectiveAreaMm2: 40000, // 0.04 m²
};

describe('compute', () => {
  it('throw positive', () => {
    expect(compute(base).throwM).toBeGreaterThan(0);
  });

  it('throw = K√A0·V0/Vt', () => {
    const r = compute(base);
    const expected = (1.3 * Math.sqrt(0.04) * 3) / 0.25;
    expect(r.throwM).toBeCloseTo(expected, 5);
  });

  it('higher face velocity → longer throw', () => {
    const slow = compute({ ...base, faceVelocityMS: 2 });
    const fast = compute({ ...base, faceVelocityMS: 5 });
    expect(fast.throwM).toBeGreaterThan(slow.throwM);
  });

  it('lower terminal velocity → longer throw', () => {
    const r25 = compute({ ...base, terminalVelocityMS: 0.25 });
    const r50 = compute({ ...base, terminalVelocityMS: 0.5 });
    expect(r25.throwM).toBeGreaterThan(r50.throwM);
  });

  it('cold supply → positive Archimedes + drop', () => {
    const r = compute({ ...base, supplyTempC: 13, roomTempC: 24 });
    expect(r.archimedesNumber!).toBeGreaterThan(0);
    expect(r.estimatedDropM!).toBeGreaterThanOrEqual(0);
  });

  it('warm supply → negative Archimedes', () => {
    const r = compute({ ...base, supplyTempC: 35, roomTempC: 24 });
    expect(r.archimedesNumber!).toBeLessThan(0);
  });

  it('no temps → null Archimedes', () => {
    expect(compute(base).archimedesNumber).toBeNull();
  });

  it('reachesOccupiedZone evaluated with mounting height', () => {
    const r = compute({ ...base, supplyTempC: 13, roomTempC: 24, mountingHeightMm: 3000 });
    expect(typeof r.reachesOccupiedZone).toBe('boolean');
  });

  it('zero face velocity → warning', () => {
    const r = compute({ ...base, faceVelocityMS: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('faceVelocityForThrow', () => {
  it('round-trips with compute', () => {
    const r = compute(base);
    const v = faceVelocityForThrow(r.throwM, base.effectiveAreaMm2);
    expect(v).toBeCloseTo(base.faceVelocityMS, 4);
  });

  it('longer target throw → higher face velocity', () => {
    const short = faceVelocityForThrow(3, 40000);
    const long = faceVelocityForThrow(8, 40000);
    expect(long).toBeGreaterThan(short);
  });
});

describe('summarize', () => {
  it('reports throw', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.throwM).toBe(r.throwM);
  });
});
