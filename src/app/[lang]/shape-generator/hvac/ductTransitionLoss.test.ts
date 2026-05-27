import { describe, it, expect } from 'vitest';
import {
  compute,
  optimumExpansionAngleDeg,
  equivalentLengthM,
  summarize,
  type DuctTransitionInput,
} from './ductTransitionLoss';

const expansion: DuctTransitionInput = {
  upstreamAreaMm2: 40000,   // 200×200
  downstreamAreaMm2: 90000, // 300×300
  flowRateM3PerS: 0.5,
  includedAngleDeg: 30,
};

const contraction: DuctTransitionInput = {
  upstreamAreaMm2: 90000,
  downstreamAreaMm2: 40000,
  flowRateM3PerS: 0.5,
  includedAngleDeg: 30,
};

describe('compute', () => {
  it('classifies expansion', () => {
    expect(compute(expansion).kind).toBe('expansion');
  });

  it('classifies contraction', () => {
    expect(compute(contraction).kind).toBe('contraction');
  });

  it('expansion reference velocity = upstream', () => {
    const r = compute(expansion);
    expect(r.referenceVelocityMS).toBeCloseTo(0.5 / 0.04, 3);
  });

  it('contraction reference velocity = downstream', () => {
    const r = compute(contraction);
    expect(r.referenceVelocityMS).toBeCloseTo(0.5 / 0.04, 3);
  });

  it('larger taper angle → higher loss coefficient (expansion)', () => {
    const gentle = compute({ ...expansion, includedAngleDeg: 10 });
    const steep = compute({ ...expansion, includedAngleDeg: 60 });
    expect(steep.lossCoefficient).toBeGreaterThan(gentle.lossCoefficient);
  });

  it('pressure loss = C × dynamic pressure', () => {
    const r = compute(expansion);
    expect(r.pressureLossPa).toBeCloseTo(r.lossCoefficient * r.dynamicPressurePa, 6);
  });

  it('expansion loss higher than contraction (same areas/flow)', () => {
    const e = compute({ ...expansion });
    const c = compute({ ...contraction });
    expect(e.lossCoefficient).toBeGreaterThan(c.lossCoefficient);
  });

  it('dynamic pressure scales with ρ', () => {
    const light = compute({ ...expansion, airDensityKgM3: 1.0 });
    const heavy = compute({ ...expansion, airDensityKgM3: 1.4 });
    expect(heavy.dynamicPressurePa).toBeGreaterThan(light.dynamicPressurePa);
  });

  it('zero area → warning', () => {
    const r = compute({ ...expansion, upstreamAreaMm2: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('optimumExpansionAngleDeg', () => {
  it('is 7°', () => {
    expect(optimumExpansionAngleDeg()).toBe(7);
  });
});

describe('equivalentLengthM', () => {
  it('loss / friction-per-m', () => {
    const r = compute(expansion);
    expect(equivalentLengthM(r, 1)).toBeCloseTo(r.pressureLossPa, 6);
  });

  it('zero friction → 0', () => {
    expect(equivalentLengthM(compute(expansion), 0)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports kind + loss', () => {
    const r = compute(expansion);
    const s = summarize(r);
    expect(s.kind).toBe('expansion');
    expect(s.pressureLossPa).toBe(r.pressureLossPa);
  });
});
