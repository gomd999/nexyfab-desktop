import { describe, it, expect } from 'vitest';
import {
  classify,
  lockhartMartinelliX,
  isProblematic,
  summarize,
  type TwoPhaseInput,
} from './twoPhaseFlowRegime';

const D = 100; // mm

function withVelocities(jg: number, jl: number): TwoPhaseInput {
  const A = (Math.PI / 4) * Math.pow(D / 1000, 2);
  return { pipeInnerDiameterMm: D, gasFlowM3PerS: jg * A, liquidFlowM3PerS: jl * A };
}

describe('classify', () => {
  it('low both → stratified', () => {
    expect(classify(withVelocities(0.3, 0.1)).regime).toBe('stratified');
  });

  it('high gas → annular', () => {
    expect(classify(withVelocities(20, 0.5)).regime).toBe('annular');
  });

  it('moderate both → slug', () => {
    expect(classify(withVelocities(2, 1)).regime).toBe('slug');
  });

  it('high liquid → dispersed bubble', () => {
    expect(classify(withVelocities(1, 5)).regime).toBe('dispersed-bubble');
  });

  it('moderate gas low liquid → wavy', () => {
    expect(classify(withVelocities(3, 0.1)).regime).toBe('wavy');
  });

  it('superficial velocities computed', () => {
    const r = classify(withVelocities(2, 1));
    expect(r.superficialGasVelocityMS).toBeCloseTo(2, 4);
    expect(r.superficialLiquidVelocityMS).toBeCloseTo(1, 4);
  });

  it('void fraction = jg/(jg+jl)', () => {
    const r = classify(withVelocities(3, 1));
    expect(r.homogeneousVoidFraction).toBeCloseTo(3 / 4, 4);
  });

  it('mixture velocity = jg+jl', () => {
    const r = classify(withVelocities(2, 1));
    expect(r.mixtureVelocityMS).toBeCloseTo(3, 4);
  });

  it('zero diameter → warning', () => {
    const r = classify({ pipeInnerDiameterMm: 0, gasFlowM3PerS: 1, liquidFlowM3PerS: 1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('lockhartMartinelliX', () => {
  it('X = sqrt(dPl/dPg)', () => {
    expect(lockhartMartinelliX(400, 100)).toBeCloseTo(2, 5);
  });

  it('zero gas gradient → Infinity', () => {
    expect(lockhartMartinelliX(100, 0)).toBe(Infinity);
  });
});

describe('isProblematic', () => {
  it('slug is problematic', () => {
    expect(isProblematic('slug')).toBe(true);
  });

  it('annular not flagged', () => {
    expect(isProblematic('annular')).toBe(false);
  });
});

describe('summarize', () => {
  it('reports regime + void + velocity', () => {
    const r = classify(withVelocities(2, 1));
    const s = summarize(r);
    expect(s.regime).toBe(r.regime);
    expect(s.mixtureVelocityMS).toBe(r.mixtureVelocityMS);
  });
});
