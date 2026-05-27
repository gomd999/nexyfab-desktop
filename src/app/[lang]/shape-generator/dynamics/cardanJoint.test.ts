import { describe, it, expect } from 'vitest';
import {
  compute, doubleJointCancels, maxAngleForFluctuationDeg, summarize,
  type CardanInput,
} from './cardanJoint';

const base: CardanInput = { jointAngleDeg: 20, inputSpeedRpm: 1000, inputTorqueNm: 50 };

describe('compute', () => {
  it('ratioMax = 1/cosβ, ratioMin = cosβ', () => {
    const r = compute(base);
    const cosB = Math.cos(20 * Math.PI / 180);
    expect(r.ratioMax).toBeCloseTo(1 / cosB, 5);
    expect(r.ratioMin).toBeCloseTo(cosB, 5);
  });

  it('zero angle → no fluctuation', () => {
    const r = compute({ ...base, jointAngleDeg: 0 });
    expect(r.speedFluctuationPercent).toBeCloseTo(0, 5);
  });

  it('larger angle → more fluctuation', () => {
    const small = compute({ ...base, jointAngleDeg: 10 });
    const large = compute({ ...base, jointAngleDeg: 35 });
    expect(large.speedFluctuationPercent).toBeGreaterThan(small.speedFluctuationPercent);
  });

  it('curve spans one revolution', () => {
    const r = compute(base);
    expect(r.curve[0]!.inputAngleDeg).toBe(0);
    expect(r.curve[r.curve.length - 1]!.inputAngleDeg).toBeCloseTo(360, 5);
  });

  it('output speed oscillates around input', () => {
    const r = compute(base);
    const speeds = r.curve.map(p => p.outputSpeedRpm);
    expect(Math.max(...speeds)).toBeGreaterThan(1000);
    expect(Math.min(...speeds)).toBeLessThan(1000);
  });

  it('torque inverse of speed ratio', () => {
    const r = compute(base);
    const p = r.curve[5]!;
    expect(p.outputTorqueNm).toBeCloseTo(50 / p.speedRatio, 4);
  });

  it('no torque when input torque omitted', () => {
    const r = compute({ jointAngleDeg: 20, inputSpeedRpm: 1000 });
    expect(r.curve[0]!.outputTorqueNm).toBeNull();
  });

  it('angle ≥ 90 → warning', () => {
    expect(compute({ ...base, jointAngleDeg: 95 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('doubleJointCancels', () => {
  it('equal angles + in phase → cancels', () => {
    expect(doubleJointCancels(20, 20, true)).toBe(true);
  });

  it('unequal angles → does not cancel', () => {
    expect(doubleJointCancels(20, 30, true)).toBe(false);
  });

  it('out of phase → does not cancel', () => {
    expect(doubleJointCancels(20, 20, false)).toBe(false);
  });
});

describe('maxAngleForFluctuationDeg', () => {
  it('larger allowed fluctuation → larger angle', () => {
    expect(maxAngleForFluctuationDeg(20)).toBeGreaterThan(maxAngleForFluctuationDeg(5));
  });

  it('resulting angle yields ~target fluctuation', () => {
    const a = maxAngleForFluctuationDeg(10);
    const c = Math.cos(a * Math.PI / 180);
    expect((1 / c - c) * 100).toBeCloseTo(10, 0);
  });
});

describe('summarize', () => {
  it('reports ratios + fluctuation', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.ratioMax).toBe(r.ratioMax);
    expect(s.speedFluctuationPercent).toBe(r.speedFluctuationPercent);
  });
});
