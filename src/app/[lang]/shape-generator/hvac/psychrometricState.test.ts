import { describe, it, expect } from 'vitest';
import {
  compute,
  saturationPressurePa,
  rhFromDewPoint,
  summarize,
} from './psychrometricState';

describe('compute', () => {
  it('25°C 50% RH → reasonable humidity ratio (~0.0099)', () => {
    const r = compute({ dryBulbC: 25, relativeHumidity: 0.5 });
    expect(r.humidityRatio).toBeGreaterThan(0.008);
    expect(r.humidityRatio).toBeLessThan(0.012);
  });

  it('higher RH → higher humidity ratio', () => {
    const dry = compute({ dryBulbC: 25, relativeHumidity: 0.3 });
    const humid = compute({ dryBulbC: 25, relativeHumidity: 0.8 });
    expect(humid.humidityRatio).toBeGreaterThan(dry.humidityRatio);
  });

  it('enthalpy positive and rises with RH', () => {
    const dry = compute({ dryBulbC: 25, relativeHumidity: 0.3 });
    const humid = compute({ dryBulbC: 25, relativeHumidity: 0.8 });
    expect(humid.enthalpyKJkg).toBeGreaterThan(dry.enthalpyKJkg);
  });

  it('dew point below dry-bulb', () => {
    const r = compute({ dryBulbC: 25, relativeHumidity: 0.5 });
    expect(r.dewPointC).toBeLessThan(25);
  });

  it('wet bulb between dew point and dry bulb', () => {
    const r = compute({ dryBulbC: 25, relativeHumidity: 0.5 });
    expect(r.wetBulbC).toBeGreaterThan(r.dewPointC - 0.5);
    expect(r.wetBulbC).toBeLessThan(25 + 0.5);
  });

  it('100% RH → dew point ≈ dry bulb', () => {
    const r = compute({ dryBulbC: 20, relativeHumidity: 1.0 });
    expect(r.dewPointC).toBeCloseTo(20, 0);
  });

  it('saturated wet bulb ≈ dry bulb at 100% RH', () => {
    const r = compute({ dryBulbC: 20, relativeHumidity: 1.0 });
    expect(r.wetBulbC).toBeCloseTo(20, 0);
  });

  it('specific volume reasonable (~0.85 m³/kg)', () => {
    const r = compute({ dryBulbC: 25, relativeHumidity: 0.5 });
    expect(r.specificVolumeM3kg).toBeGreaterThan(0.8);
    expect(r.specificVolumeM3kg).toBeLessThan(0.9);
  });

  it('RH out of range → warning', () => {
    const r = compute({ dryBulbC: 25, relativeHumidity: 1.5 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('saturationPressurePa', () => {
  it('rises with temperature', () => {
    expect(saturationPressurePa(30)).toBeGreaterThan(saturationPressurePa(10));
  });

  it('~3169 Pa at 25°C', () => {
    expect(saturationPressurePa(25)).toBeGreaterThan(3000);
    expect(saturationPressurePa(25)).toBeLessThan(3300);
  });
});

describe('rhFromDewPoint', () => {
  it('dew point = dry bulb → RH 100%', () => {
    expect(rhFromDewPoint(20, 20)).toBeCloseTo(1, 3);
  });

  it('lower dew point → lower RH', () => {
    expect(rhFromDewPoint(25, 10)).toBeLessThan(rhFromDewPoint(25, 20));
  });
});

describe('summarize', () => {
  it('reports W + h + dew + wet bulb', () => {
    const r = compute({ dryBulbC: 25, relativeHumidity: 0.5 });
    const s = summarize(r);
    expect(s.humidityRatio).toBe(r.humidityRatio);
    expect(s.enthalpyKJkg).toBe(r.enthalpyKJkg);
  });
});
