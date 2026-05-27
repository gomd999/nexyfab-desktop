import { describe, it, expect } from 'vitest';
import {
  size,
  standardKeyFor,
  governingMode,
  summarize,
  type KeywayInput,
} from './keywaySizer';

const base: KeywayInput = {
  shaftDiameterMm: 40,
  torqueNm: 200,
  allowableShearMpa: 60,
  allowableBearingMpa: 100,
};

describe('standardKeyFor', () => {
  it('40mm shaft → 12×8 key', () => {
    const k = standardKeyFor(40);
    expect(k.b).toBe(12);
    expect(k.h).toBe(8);
  });

  it('small shaft → small key', () => {
    const k = standardKeyFor(8);
    expect(k.b).toBe(2);
  });

  it('huge shaft → largest key (clamped)', () => {
    const k = standardKeyFor(500);
    expect(k.b).toBe(28);
  });
});

describe('size', () => {
  it('picks standard key for shaft', () => {
    const r = size(base);
    expect(r.keyWidthMm).toBe(12);
    expect(r.keyHeightMm).toBe(8);
  });

  it('tangential force = 2T/d', () => {
    const r = size(base);
    expect(r.tangentialForceN).toBeCloseTo((200 * 1000) / (40 / 2), 3);
  });

  it('recommended length covers both shear + bearing', () => {
    const r = size(base);
    expect(r.recommendedLengthMm).toBeGreaterThanOrEqual(r.minLengthForShearMm);
    expect(r.recommendedLengthMm).toBeGreaterThanOrEqual(r.minLengthForBearingMm);
  });

  it('given length computes stresses + ok flags', () => {
    const r = size({ ...base, keyLengthMm: 50 });
    expect(r.shearStressMpa).not.toBeNull();
    expect(r.bearingStressMpa).not.toBeNull();
    expect(r.shearOk).toBe(true);
    expect(r.bearingOk).toBe(true);
  });

  it('too-short key fails stress check', () => {
    const r = size({ ...base, keyLengthMm: 2 });
    expect(r.shearOk).toBe(false);
  });

  it('no length → null stresses', () => {
    const r = size(base);
    expect(r.shearStressMpa).toBeNull();
  });

  it('higher torque → longer required length', () => {
    const low = size({ ...base, torqueNm: 100 });
    const high = size({ ...base, torqueNm: 400 });
    expect(high.recommendedLengthMm).toBeGreaterThan(low.recommendedLengthMm);
  });

  it('override key dimensions respected', () => {
    const r = size({ ...base, keyWidthMm: 20, keyHeightMm: 12 });
    expect(r.keyWidthMm).toBe(20);
    expect(r.keyHeightMm).toBe(12);
  });

  it('zero torque → warning', () => {
    const r = size({ ...base, torqueNm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('governingMode', () => {
  it('returns shear or bearing', () => {
    const r = size(base);
    expect(['shear', 'bearing']).toContain(governingMode(r));
  });

  it('bearing governs when bearing length larger', () => {
    // h/2 small relative to b → bearing needs more length
    const r = size({ ...base, keyHeightMm: 2, keyWidthMm: 20, allowableBearingMpa: 50, allowableShearMpa: 200 });
    expect(governingMode(r)).toBe('bearing');
  });
});

describe('summarize', () => {
  it('reports key dims + length', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.keyWidthMm).toBe(r.keyWidthMm);
    expect(s.recommendedLengthMm).toBe(r.recommendedLengthMm);
  });
});
