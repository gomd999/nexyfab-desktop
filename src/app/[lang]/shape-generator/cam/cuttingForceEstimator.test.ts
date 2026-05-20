import { describe, it, expect } from 'vitest';
import {
  estimateForce,
  checkBudget,
  summarize,
  DEFAULT_MATERIALS,
  type ToolParams,
  type MillingCut,
} from './cuttingForceEstimator';

const tool: ToolParams = { diameterMm: 10, flutes: 4, helixDeg: 30 };
const cut: MillingCut = { axialDocMm: 2, radialDocMm: 1, feedPerToothMm: 0.05, rpm: 5000 };

describe('estimateForce', () => {
  it('aluminum produces lower force than inconel', () => {
    const al = estimateForce(tool, DEFAULT_MATERIALS['aluminum-6061']!, cut);
    const inc = estimateForce(tool, DEFAULT_MATERIALS['inconel-718']!, cut);
    expect(inc.peakTangentialN).toBeGreaterThan(al.peakTangentialN);
  });

  it('peak tangential positive', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    expect(r.peakTangentialN).toBeGreaterThan(0);
  });

  it('normal force = kr × tangential', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    const ratio = r.peakNormalN / r.peakTangentialN;
    expect(ratio).toBeCloseTo(DEFAULT_MATERIALS['steel-1018']!.kr, 1);
  });

  it('larger radial DOC → higher force', () => {
    const small = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, { ...cut, radialDocMm: 0.5 });
    const big = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, { ...cut, radialDocMm: 5 });
    expect(big.peakTangentialN).toBeGreaterThanOrEqual(small.peakTangentialN);
  });

  it('larger axial DOC → linear scale', () => {
    const small = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, { ...cut, axialDocMm: 1 });
    const big = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, { ...cut, axialDocMm: 4 });
    expect(big.peakTangentialN).toBeGreaterThan(small.peakTangentialN);
  });

  it('spindle torque positive', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    expect(r.spindleTorqueNm).toBeGreaterThan(0);
  });

  it('spindle power positive', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    expect(r.spindlePowerW).toBeGreaterThan(0);
  });

  it('invalid radius → warning', () => {
    const badTool: ToolParams = { diameterMm: 0, flutes: 4, helixDeg: 30 };
    const r = estimateForce(badTool, DEFAULT_MATERIALS['steel-1018']!, cut);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero radial DOC → no force', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, { ...cut, radialDocMm: 0 });
    expect(r.peakTangentialN).toBe(0);
  });

  it('rms <= peak', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    expect(r.rmsForceN).toBeLessThanOrEqual(r.peakTangentialN);
  });
});

describe('checkBudget', () => {
  it('within limit when peak < max', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    const budget = checkBudget(r, 10000);
    expect(budget.withinLimit).toBe(true);
  });

  it('over limit when peak > max', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    const budget = checkBudget(r, 1);
    expect(budget.withinLimit).toBe(false);
  });

  it('utilisation reported', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    expect(checkBudget(r, 1000).utilisationPct).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports key metrics', () => {
    const r = estimateForce(tool, DEFAULT_MATERIALS['steel-1018']!, cut);
    const s = summarize(r);
    expect(s.peakTangentialN).toBe(r.peakTangentialN);
    expect(s.spindlePowerW).toBe(r.spindlePowerW);
  });
});
