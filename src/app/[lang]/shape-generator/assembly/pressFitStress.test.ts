import { describe, it, expect } from 'vitest';
import {
  evaluate,
  interferenceForPressure,
  checkYield,
  summarize,
  type PressFitInput,
} from './pressFitStress';

// Steel shaft into steel hub.
const base: PressFitInput = {
  shaftBoreRadiusMm: 0,
  contactRadiusMm: 20,
  hubOuterRadiusMm: 40,
  diametralInterferenceMm: 0.04,
  shaftYoungMpa: 200000,
  hubYoungMpa: 200000,
  shaftPoisson: 0.3,
  hubPoisson: 0.3,
};

describe('evaluate', () => {
  it('positive contact pressure for interference', () => {
    const r = evaluate(base);
    expect(r.contactPressureMpa).toBeGreaterThan(0);
  });

  it('hub hoop stress tensile (positive)', () => {
    const r = evaluate(base);
    expect(r.hubHoopStressMpa).toBeGreaterThan(0);
  });

  it('shaft hoop stress compressive (negative)', () => {
    const r = evaluate(base);
    expect(r.shaftHoopStressMpa).toBeLessThan(0);
  });

  it('larger interference → larger pressure (linear)', () => {
    const r1 = evaluate({ ...base, diametralInterferenceMm: 0.04 });
    const r2 = evaluate({ ...base, diametralInterferenceMm: 0.08 });
    expect(r2.contactPressureMpa).toBeCloseTo(2 * r1.contactPressureMpa, 4);
  });

  it('hub hoop > contact pressure (stress concentration at bore)', () => {
    const r = evaluate(base);
    expect(r.hubHoopStressMpa).toBeGreaterThan(r.contactPressureMpa);
  });

  it('holding torque computed when friction + length given', () => {
    const r = evaluate({ ...base, frictionCoefficient: 0.15, engagementLengthMm: 30 });
    expect(r.holdingTorqueNm).not.toBeNull();
    expect(r.holdingTorqueNm!).toBeGreaterThan(0);
  });

  it('no friction → null torque', () => {
    const r = evaluate(base);
    expect(r.holdingTorqueNm).toBeNull();
  });

  it('hub outer ≤ contact → warning', () => {
    const r = evaluate({ ...base, hubOuterRadiusMm: 15 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('hollow shaft has higher stress than solid (same interference)', () => {
    const solid = evaluate({ ...base, shaftBoreRadiusMm: 0 });
    const hollow = evaluate({ ...base, shaftBoreRadiusMm: 15 });
    expect(Math.abs(hollow.shaftHoopStressMpa)).toBeGreaterThan(Math.abs(solid.shaftHoopStressMpa));
  });
});

describe('interferenceForPressure', () => {
  it('round-trips with evaluate', () => {
    const target = 50;
    const delta = interferenceForPressure(base, target);
    const r = evaluate({ ...base, diametralInterferenceMm: delta });
    expect(r.contactPressureMpa).toBeCloseTo(target, 3);
  });

  it('invalid geometry → 0', () => {
    expect(interferenceForPressure({ ...base, hubOuterRadiusMm: 10 }, 50)).toBe(0);
  });
});

describe('checkYield', () => {
  it('flags hub yield when stress exceeds', () => {
    const r = evaluate({ ...base, diametralInterferenceMm: 0.2 });
    const y = checkYield(r, 100, 100);
    expect(y.hubOk).toBe(false);
  });

  it('passes when below yield', () => {
    const r = evaluate({ ...base, diametralInterferenceMm: 0.01 });
    const y = checkYield(r, 500, 500);
    expect(y.hubOk).toBe(true);
    expect(y.shaftOk).toBe(true);
  });
});

describe('summarize', () => {
  it('reports pressure + hoop', () => {
    const r = evaluate(base);
    const s = summarize(r);
    expect(s.contactPressureMpa).toBe(r.contactPressureMpa);
    expect(s.hubHoopStressMpa).toBe(r.hubHoopStressMpa);
  });
});
