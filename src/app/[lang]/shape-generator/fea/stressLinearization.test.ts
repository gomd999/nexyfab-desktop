import { describe, it, expect } from 'vitest';
import {
  linearizeStress,
  checkASMELimits,
  summarize,
  type StressTensor,
} from './stressLinearization';

function uniformStress(positions: number[], sigma: number): StressTensor[] {
  return positions.map(p => ({
    positionMm: p,
    sigmaXX: sigma, sigmaYY: 0, sigmaZZ: 0,
    sigmaXY: 0, sigmaYZ: 0, sigmaZX: 0,
  }));
}

function linearStress(positions: number[], thickness: number): StressTensor[] {
  // σxx varies linearly from -100 at t=0 to +100 at t=T → pure bending.
  return positions.map(p => ({
    positionMm: p,
    sigmaXX: -100 + (200 * p / thickness),
    sigmaYY: 0, sigmaZZ: 0,
    sigmaXY: 0, sigmaYZ: 0, sigmaZX: 0,
  }));
}

describe('linearizeStress', () => {
  it('empty samples → empty result', () => {
    const r = linearizeStress([]);
    expect(r.components).toEqual([]);
  });

  it('uniform stress → membrane = value, bending ≈ 0', () => {
    const positions = [0, 5, 10];
    const samples = uniformStress(positions, 50);
    const r = linearizeStress(samples);
    const xx = r.components.find(c => c.name === 'xx')!;
    expect(xx.membrane).toBeCloseTo(50, 5);
    expect(Math.abs(xx.bendingOuter)).toBeLessThan(0.1);
  });

  it('pure bending → membrane ≈ 0, bending = peak', () => {
    const positions = [0, 2.5, 5, 7.5, 10];
    const samples = linearStress(positions, 10);
    const r = linearizeStress(samples);
    const xx = r.components.find(c => c.name === 'xx')!;
    expect(Math.abs(xx.membrane)).toBeLessThan(1);
    expect(Math.abs(xx.bendingOuter)).toBeGreaterThan(50);
  });

  it('produces 6 components', () => {
    const r = linearizeStress(uniformStress([0, 10], 1));
    expect(r.components).toHaveLength(6);
  });

  it('vonMisesMembrane non-negative', () => {
    const r = linearizeStress(uniformStress([0, 10], 50));
    expect(r.vonMisesMembrane).toBeGreaterThanOrEqual(0);
  });

  it('outer von Mises higher than membrane for bending case', () => {
    const positions = [0, 2.5, 5, 7.5, 10];
    const samples = linearStress(positions, 10);
    const r = linearizeStress(samples);
    expect(r.vonMisesOuter).toBeGreaterThan(r.vonMisesMembrane);
  });

  it('peak components: residual after membrane + bending', () => {
    const samples = uniformStress([0, 5, 10], 50);
    const r = linearizeStress(samples);
    const xx = r.components.find(c => c.name === 'xx')!;
    expect(Math.abs(xx.peakOuter)).toBeLessThan(0.01);
  });

  it('shear components also linearized', () => {
    const positions = [0, 5, 10];
    const samples: StressTensor[] = positions.map(p => ({
      positionMm: p,
      sigmaXX: 0, sigmaYY: 0, sigmaZZ: 0,
      sigmaXY: 20, sigmaYZ: 0, sigmaZX: 0,
    }));
    const r = linearizeStress(samples);
    const xy = r.components.find(c => c.name === 'xy')!;
    expect(xy.membrane).toBeCloseTo(20, 3);
  });
});

describe('checkASMELimits', () => {
  it('within limits → all pass', () => {
    const r = linearizeStress(uniformStress([0, 10], 50));
    const c = checkASMELimits(r, { pmAllowable: 100, pmPlusPbAllowable: 150, totalAllowable: 200 });
    expect(c.pmPass).toBe(true);
  });

  it('over membrane limit → fails', () => {
    const r = linearizeStress(uniformStress([0, 10], 200));
    const c = checkASMELimits(r, { pmAllowable: 100, pmPlusPbAllowable: 150, totalAllowable: 200 });
    expect(c.pmPass).toBe(false);
  });

  it('ratios reported', () => {
    const r = linearizeStress(uniformStress([0, 10], 50));
    const c = checkASMELimits(r, { pmAllowable: 100, pmPlusPbAllowable: 150, totalAllowable: 200 });
    expect(c.pmRatio).toBeCloseTo(0.5, 3);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const r = linearizeStress([]);
    const s = summarize([], r);
    expect(s.thicknessMm).toBe(0);
  });

  it('detects bending', () => {
    const positions = [0, 2.5, 5, 7.5, 10];
    const r = linearizeStress(linearStress(positions, 10));
    const s = summarize(linearStress(positions, 10), r);
    expect(s.hasBending).toBe(true);
  });

  it('no bending for uniform stress', () => {
    const r = linearizeStress(uniformStress([0, 10], 50));
    const s = summarize(uniformStress([0, 10], 50), r);
    expect(s.hasBending).toBe(false);
  });
});
