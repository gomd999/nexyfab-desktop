import { describe, it, expect } from 'vitest';
import {
  compute,
  distributeRatio,
  trainType,
  summarize,
  type GearTrainInput,
} from './gearTrainRatio';

const base: GearTrainInput = {
  stages: [
    { driverTeeth: 20, drivenTeeth: 60 }, // 3:1
    { driverTeeth: 15, drivenTeeth: 45 }, // 3:1
  ],
  inputSpeedRpm: 1800,
  inputTorqueNm: 10,
};

describe('compute', () => {
  it('total ratio = product of stage ratios', () => {
    const r = compute(base);
    expect(r.totalRatio).toBeCloseTo(9, 6);
  });

  it('output speed = input / ratio', () => {
    const r = compute(base);
    expect(r.outputSpeedRpm).toBeCloseTo(1800 / 9, 4);
  });

  it('output torque rises with ratio (× efficiency)', () => {
    const r = compute(base);
    expect(r.outputTorqueNm).toBeGreaterThan(10);
    expect(r.outputTorqueNm).toBeLessThan(90); // < ideal 90 due to efficiency
  });

  it('two external meshes → same direction', () => {
    const r = compute(base);
    expect(r.direction).toBe(1);
  });

  it('one mesh → reversed', () => {
    const r = compute({ ...base, stages: [{ driverTeeth: 20, drivenTeeth: 60 }] });
    expect(r.direction).toBe(-1);
  });

  it('overall efficiency = product of mesh efficiencies', () => {
    const r = compute(base);
    expect(r.overallEfficiency).toBeCloseTo(0.97 * 0.97, 6);
  });

  it('cumulative ratio increases per stage', () => {
    const r = compute(base);
    expect(r.stages[1]!.cumulativeRatio).toBeGreaterThan(r.stages[0]!.cumulativeRatio);
  });

  it('intermediate shaft speed between input and output', () => {
    const r = compute(base);
    expect(r.stages[0]!.shaftSpeedRpm).toBeLessThan(1800);
    expect(r.stages[0]!.shaftSpeedRpm).toBeGreaterThan(r.outputSpeedRpm);
  });

  it('non-positive teeth → warning', () => {
    const r = compute({ ...base, stages: [{ driverTeeth: 0, drivenTeeth: 60 }] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('no stages → warning', () => {
    const r = compute({ ...base, stages: [] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('distributeRatio', () => {
  it('product of stages ≈ target', () => {
    const stages = distributeRatio(36, 6);
    const product = stages.reduce((a, b) => a * b, 1);
    expect(product).toBeCloseTo(36, 4);
  });

  it('each stage ≤ max stage ratio', () => {
    const stages = distributeRatio(100, 6);
    expect(stages.every(s => s <= 6 + 1e-9)).toBe(true);
  });

  it('ratio ≤ 1 → single stage', () => {
    expect(distributeRatio(0.5)).toHaveLength(1);
  });
});

describe('trainType', () => {
  it('ratio > 1 → reducer', () => {
    expect(trainType(compute(base))).toBe('reducer');
  });

  it('ratio < 1 → overdrive', () => {
    const r = compute({ ...base, stages: [{ driverTeeth: 60, drivenTeeth: 20 }] });
    expect(trainType(r)).toBe('overdrive');
  });
});

describe('summarize', () => {
  it('reports ratio + output', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.totalRatio).toBe(r.totalRatio);
    expect(s.outputTorqueNm).toBe(r.outputTorqueNm);
  });
});
