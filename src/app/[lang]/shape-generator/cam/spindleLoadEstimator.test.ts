import { describe, it, expect } from 'vitest';
import {
  estimateLoad,
  findMaxThroughput,
  compareMaterials,
  summarize,
  DEFAULT_KC_TABLE,
  type CuttingConditions,
  type MachineLimits,
} from './spindleLoadEstimator';

const machine: MachineLimits = { maxPowerW: 7500, maxTorqueNm: 50, efficiency: 0.85 };
const baseConds: CuttingConditions = { aeMm: 0.5, apMm: 1, feedMmMin: 300, spindleRpm: 5000, kcN_mm2: 2000 };

describe('estimateLoad', () => {
  it('positive power for valid input', () => {
    const r = estimateLoad(baseConds, machine);
    expect(r.powerW).toBeGreaterThan(0);
  });

  it('MRR = ae × ap × feed', () => {
    const r = estimateLoad(baseConds, machine);
    expect(r.mrrMm3PerMin).toBe(0.5 * 1 * 300);
  });

  it('torque computed from power + RPM', () => {
    const r = estimateLoad(baseConds, machine);
    expect(r.torqueNm).toBeGreaterThan(0);
  });

  it('high MRR → overloaded', () => {
    const heavy: CuttingConditions = { ...baseConds, aeMm: 20, apMm: 20, feedMmMin: 2000 };
    const r = estimateLoad(heavy, machine);
    expect(r.overloaded).toBe(true);
  });

  it('zero RPM → warning', () => {
    const r = estimateLoad({ ...baseConds, spindleRpm: 0 }, machine);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('power utilisation positive', () => {
    const r = estimateLoad(baseConds, machine);
    expect(r.powerUtilisation).toBeGreaterThan(0);
  });

  it('harder material increases power', () => {
    const al = estimateLoad({ ...baseConds, kcN_mm2: 800 }, machine);
    const inco = estimateLoad({ ...baseConds, kcN_mm2: 3000 }, machine);
    expect(inco.powerW).toBeGreaterThan(al.powerW);
  });
});

describe('findMaxThroughput', () => {
  it('returns a candidate that fits machine', () => {
    const cand = findMaxThroughput(baseConds, machine);
    expect(cand.result.mrrMm3PerMin).toBeGreaterThan(0);
  });

  it('throughput candidate not overloaded', () => {
    const cand = findMaxThroughput(baseConds, machine);
    expect(cand.result.overloaded).toBe(false);
  });
});

describe('compareMaterials', () => {
  it('returns entry per material', () => {
    const r = compareMaterials({ aeMm: 0.5, apMm: 1, feedMmMin: 300, spindleRpm: 5000 }, machine);
    expect(r).toHaveLength(DEFAULT_KC_TABLE.length);
  });

  it('aluminum power < inconel power', () => {
    const r = compareMaterials({ aeMm: 0.5, apMm: 1, feedMmMin: 300, spindleRpm: 5000 }, machine);
    const al = r.find(x => x.material === 'aluminum-6061')!;
    const inc = r.find(x => x.material === 'inconel-718')!;
    expect(inc.result.powerW).toBeGreaterThan(al.result.powerW);
  });
});

describe('summarize', () => {
  it('reports power + overloaded', () => {
    const r = estimateLoad(baseConds, machine);
    const s = summarize(r);
    expect(s.powerW).toBe(r.powerW);
    expect(s.overloaded).toBe(r.overloaded);
  });
});
