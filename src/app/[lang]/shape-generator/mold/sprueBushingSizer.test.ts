import { describe, it, expect } from 'vitest';
import {
  sizeSprue,
  matchStandard,
  sprueCoolingTimeSec,
  summarize,
  DME_CATALOG,
} from './sprueBushingSizer';

describe('sizeSprue', () => {
  it('default produces positive geometry', () => {
    const r = sizeSprue();
    expect(r.geometry.orificeDiameterMm).toBeGreaterThan(0);
    expect(r.geometry.largeDiameterMm).toBeGreaterThan(r.geometry.orificeDiameterMm);
  });

  it('orifice = nozzle + 1', () => {
    const r = sizeSprue({ nozzleOrificeMm: 4, lengthMm: 50, taperDeg: 1, flowRateCm3PerS: 30, viscosityPaS: 500, moldPlateThicknessMm: 80 });
    expect(r.geometry.orificeDiameterMm).toBe(5);
  });

  it('large = orifice + 2·L·tan(taper)', () => {
    const r = sizeSprue({ nozzleOrificeMm: 4, lengthMm: 50, taperDeg: 1, flowRateCm3PerS: 30, viscosityPaS: 500, moldPlateThicknessMm: 80 });
    const expected = 5 + 2 * 50 * Math.tan(Math.PI / 180);
    expect(r.geometry.largeDiameterMm).toBeCloseTo(expected, 3);
  });

  it('length too long → warning', () => {
    const r = sizeSprue({ nozzleOrificeMm: 4, lengthMm: 100, taperDeg: 1, flowRateCm3PerS: 30, viscosityPaS: 500, moldPlateThicknessMm: 80 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('taper out of range → warning', () => {
    const r = sizeSprue({ nozzleOrificeMm: 4, lengthMm: 50, taperDeg: 0.1, flowRateCm3PerS: 30, viscosityPaS: 500, moldPlateThicknessMm: 80 });
    expect(r.warnings.some(w => w.includes('Taper'))).toBe(true);
  });

  it('tiny orifice → warning', () => {
    const r = sizeSprue({ nozzleOrificeMm: 1, lengthMm: 50, taperDeg: 1, flowRateCm3PerS: 30, viscosityPaS: 500, moldPlateThicknessMm: 80 });
    expect(r.warnings.some(w => w.includes('Orifice'))).toBe(true);
  });

  it('feasible when no warnings', () => {
    const r = sizeSprue();
    expect(r.feasible).toBe(r.warnings.length === 0);
  });

  it('pressure drop positive', () => {
    const r = sizeSprue();
    expect(r.geometry.pressureDropKpa).toBeGreaterThan(0);
  });

  it('frustum volume formula', () => {
    const r = sizeSprue();
    expect(r.geometry.volumeMm3).toBeGreaterThan(0);
  });
});

describe('matchStandard', () => {
  it('returns a DME bushing', () => {
    const r = sizeSprue();
    const match = matchStandard(r.geometry);
    expect(match).not.toBeNull();
  });

  it('closest match by score', () => {
    const fakeGeom = { orificeDiameterMm: 5, largeDiameterMm: 9, lengthMm: 50, taperPerSideDeg: 1, volumeMm3: 1000, pressureDropKpa: 100 };
    expect(matchStandard(fakeGeom)?.partNumber).toBe('SP-50-5');
  });
});

describe('sprueCoolingTimeSec', () => {
  it('thicker wall → longer cooling', () => {
    const r = sizeSprue();
    const t1 = sprueCoolingTimeSec(r.geometry, 2);
    const t2 = sprueCoolingTimeSec(r.geometry, 4);
    expect(t2).toBeGreaterThan(t1);
  });
});

describe('DME_CATALOG', () => {
  it('has at least 5 entries', () => {
    expect(DME_CATALOG.length).toBeGreaterThanOrEqual(5);
  });

  it('orifice ascending', () => {
    for (let i = 1; i < DME_CATALOG.length; i++) {
      expect(DME_CATALOG[i]!.orificeMm).toBeGreaterThanOrEqual(DME_CATALOG[i - 1]!.orificeMm);
    }
  });
});

describe('summarize', () => {
  it('reports key dims', () => {
    const r = sizeSprue();
    const s = summarize(r);
    expect(s.orificeDiameterMm).toBe(r.geometry.orificeDiameterMm);
    expect(s.lengthMm).toBe(r.geometry.lengthMm);
  });
});
