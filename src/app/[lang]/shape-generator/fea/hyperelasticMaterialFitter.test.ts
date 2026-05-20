import { describe, it, expect } from 'vitest';
import {
  fitMaterial,
  predictStress,
  compareModels,
  summarize,
  type StressStrainPoint,
} from './hyperelasticMaterialFitter';

// Synthetic data: Mooney-Rivlin with C10=0.5, C01=0.2.
function syntheticMR(): StressStrainPoint[] {
  const data: StressStrainPoint[] = [];
  const C10 = 0.5, C01 = 0.2;
  for (let strain = 0.05; strain <= 0.5; strain += 0.05) {
    const lambda = 1 + strain;
    const dW = 2 * (lambda - 1 / (lambda * lambda));
    const stress = dW * (C10 + C01 / lambda);
    data.push({ strain, stressMpa: stress });
  }
  return data;
}

function syntheticNeoHookean(): StressStrainPoint[] {
  const data: StressStrainPoint[] = [];
  const C10 = 0.5;
  for (let strain = 0.05; strain <= 0.5; strain += 0.05) {
    const lambda = 1 + strain;
    const dW = 2 * (lambda - 1 / (lambda * lambda));
    data.push({ strain, stressMpa: dW * C10 });
  }
  return data;
}

describe('fitMaterial', () => {
  it('insufficient data → warning', () => {
    const r = fitMaterial([{ strain: 0.1, stressMpa: 1 }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('Mooney-Rivlin recovers true coefficients', () => {
    const data = syntheticMR();
    const r = fitMaterial(data, { model: 'mooney-rivlin' });
    expect(r.coefficients[0]!).toBeCloseTo(0.5, 2);
    expect(r.coefficients[1]!).toBeCloseTo(0.2, 2);
  });

  it('Neo-Hookean fit on Neo-Hookean data', () => {
    const data = syntheticNeoHookean();
    const r = fitMaterial(data, { model: 'neo-hookean' });
    expect(r.coefficients[0]!).toBeCloseTo(0.5, 2);
  });

  it('R² > 0.99 for clean data', () => {
    const r = fitMaterial(syntheticMR(), { model: 'mooney-rivlin' });
    expect(r.rSquared).toBeGreaterThan(0.99);
  });

  it('rmsError small for clean data', () => {
    const r = fitMaterial(syntheticMR(), { model: 'mooney-rivlin' });
    expect(r.rmsErrorMpa).toBeLessThan(0.01);
  });

  it('Yeoh-N3 fits Mooney data with extra params', () => {
    const r = fitMaterial(syntheticMR(), { model: 'yeoh-N3' });
    expect(r.coefficients.length).toBe(3);
  });
});

describe('predictStress', () => {
  it('Neo-Hookean prediction matches data', () => {
    const lambda = 1.3;
    const dW = 2 * (lambda - 1 / (lambda * lambda));
    expect(predictStress('neo-hookean', [0.5], lambda)).toBeCloseTo(dW * 0.5, 5);
  });

  it('Mooney-Rivlin prediction', () => {
    const r = predictStress('mooney-rivlin', [0.5, 0.2], 1.3);
    expect(r).toBeGreaterThan(0);
  });
});

describe('compareModels', () => {
  it('returns entry per model', () => {
    const r = compareModels(syntheticMR());
    expect(r).toHaveLength(3);
  });

  it('Mooney-Rivlin matches better than Neo-Hookean on MR data', () => {
    const r = compareModels(syntheticMR());
    const mr = r.find(x => x.model === 'mooney-rivlin')!;
    const nh = r.find(x => x.model === 'neo-hookean')!;
    expect(mr.rms).toBeLessThanOrEqual(nh.rms);
  });
});

describe('summarize', () => {
  it('reports coefficients + r²', () => {
    const r = fitMaterial(syntheticMR(), { model: 'mooney-rivlin' });
    const s = summarize(r);
    expect(s.coefficientCount).toBe(2);
    expect(s.rSquared).toBe(r.rSquared);
  });
});
