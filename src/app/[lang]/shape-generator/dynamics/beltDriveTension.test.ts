import { describe, it, expect } from 'vitest';
import {
  compute,
  tightTensionForPowerN,
  summarize,
  type BeltDriveInput,
} from './beltDriveTension';

const base: BeltDriveInput = {
  driverDiameterMm: 100,
  drivenDiameterMm: 200,
  centreDistanceMm: 500,
  driverRpm: 1450,
  frictionCoefficient: 0.3,
};

describe('compute', () => {
  it('belt length positive and > 2C', () => {
    const r = compute(base);
    expect(r.beltLengthMm).toBeGreaterThan(2 * 500);
  });

  it('wrap angle on small pulley < π', () => {
    const r = compute(base);
    expect(r.wrapAngleSmallRad).toBeLessThan(Math.PI);
    expect(r.wrapAngleSmallRad).toBeGreaterThan(0);
  });

  it('equal pulleys → wrap = π', () => {
    const r = compute({ ...base, driverDiameterMm: 150, drivenDiameterMm: 150 });
    expect(r.wrapAngleSmallRad).toBeCloseTo(Math.PI, 5);
  });

  it('driven rpm = driver × D1/D2', () => {
    const r = compute(base);
    expect(r.drivenRpm).toBeCloseTo(1450 * (100 / 200), 4);
  });

  it('belt speed = π·D1·N/60', () => {
    const r = compute(base);
    expect(r.beltSpeedMS).toBeCloseTo((Math.PI * 0.1 * 1450) / 60, 5);
  });

  it('V-belt effective friction raises tension ratio', () => {
    const flat = compute({ ...base });
    const vbelt = compute({ ...base, grooveAngleDeg: 38 });
    expect(vbelt.tensionRatio).toBeGreaterThan(flat.tensionRatio);
  });

  it('centrifugal tension grows with belt mass', () => {
    const light = compute({ ...base, beltMassPerMeterKg: 0.1 });
    const heavy = compute({ ...base, beltMassPerMeterKg: 0.5 });
    expect(heavy.centrifugalTensionN).toBeGreaterThan(light.centrifugalTensionN);
  });

  it('max power computed with rated tension', () => {
    const r = compute({ ...base, maxTightTensionN: 800, beltMassPerMeterKg: 0.2 });
    expect(r.maxPowerW).not.toBeNull();
    expect(r.maxPowerW!).toBeGreaterThan(0);
  });

  it('no rated tension → null power', () => {
    expect(compute(base).maxPowerW).toBeNull();
  });

  it('zero diameter → warning', () => {
    const r = compute({ ...base, driverDiameterMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('tightTensionForPowerN', () => {
  it('higher power → higher tension', () => {
    const r = compute({ ...base, beltMassPerMeterKg: 0.2 });
    expect(tightTensionForPowerN(r, 5000)).toBeGreaterThan(tightTensionForPowerN(r, 1000));
  });
});

describe('summarize', () => {
  it('reports length + ratio + driven rpm', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.beltLengthMm).toBe(r.beltLengthMm);
    expect(s.drivenRpm).toBe(r.drivenRpm);
  });
});
