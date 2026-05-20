import { describe, it, expect } from 'vitest';
import {
  predictLifeMin,
  accumulatedFraction,
  estimateRemaining,
  isoLifeSpeed,
  findSweetSpot,
  summarize,
  type ToolMaterial,
  type CuttingPass,
  type CandidatePass,
} from './toolLifeRemaining';

const carbide: ToolMaterial = {
  n: 0.25,
  c: 200,
  feedExponent: 0.5,
  docExponent: 0.3,
  refFeedMmRev: 0.1,
  refDocMm: 1.0,
};

function pass(speed: number, feed: number, doc: number, dur: number): CuttingPass {
  return { speedMpm: speed, feedMmRev: feed, docMm: doc, durationMin: dur };
}

describe('predictLifeMin', () => {
  it('zero speed → infinite life', () => {
    expect(predictLifeMin(carbide, 0, 0.1, 1)).toBe(Infinity);
  });

  it('higher speed → shorter life (V·T^n=C)', () => {
    const lowV = predictLifeMin(carbide, 100, 0.1, 1);
    const highV = predictLifeMin(carbide, 200, 0.1, 1);
    expect(highV).toBeLessThan(lowV);
  });

  it('at reference conditions, V=C → T=1', () => {
    // V·T^n = C → if V = C (= 200), T = 1.
    const life = predictLifeMin(carbide, 200, 0.1, 1);
    expect(life).toBeCloseTo(1, 1);
  });

  it('heavier feed reduces life', () => {
    const lightFeed = predictLifeMin(carbide, 150, 0.05, 1);
    const heavyFeed = predictLifeMin(carbide, 150, 0.2, 1);
    expect(heavyFeed).toBeLessThan(lightFeed);
  });

  it('deeper cut reduces life', () => {
    const shallow = predictLifeMin(carbide, 150, 0.1, 0.5);
    const deep = predictLifeMin(carbide, 150, 0.1, 2);
    expect(deep).toBeLessThan(shallow);
  });
});

describe('accumulatedFraction', () => {
  it('empty history → 0', () => {
    expect(accumulatedFraction([], carbide)).toBe(0);
  });

  it('one pass of duration = life → fraction ≈ 1', () => {
    const life = predictLifeMin(carbide, 200, 0.1, 1);
    const used = accumulatedFraction([pass(200, 0.1, 1, life)], carbide);
    expect(used).toBeCloseTo(1, 2);
  });

  it('multiple passes accumulate', () => {
    const half = predictLifeMin(carbide, 200, 0.1, 1) / 2;
    const passes = [pass(200, 0.1, 1, half), pass(200, 0.1, 1, half)];
    const used = accumulatedFraction(passes, carbide);
    expect(used).toBeCloseTo(1, 2);
  });

  it('zero speed pass skipped', () => {
    expect(accumulatedFraction([pass(0, 0.1, 1, 10)], carbide)).toBe(0);
  });
});

describe('estimateRemaining', () => {
  const candidate: CandidatePass = { speedMpm: 150, feedMmRev: 0.1, docMm: 1, jobDurationMin: 1 };

  it('fresh tool → high remaining', () => {
    const r = estimateRemaining([], carbide, candidate);
    expect(r.usedFraction).toBe(0);
    expect(r.remainingMinAtCandidate).toBeGreaterThan(0);
  });

  it('worn tool → small remaining', () => {
    const fullLife = predictLifeMin(carbide, 200, 0.1, 1);
    const r = estimateRemaining([pass(200, 0.1, 1, fullLife * 0.9)], carbide, candidate);
    expect(r.usedFraction).toBeGreaterThan(0.8);
  });

  it('feasible reflects job duration vs remaining', () => {
    const longJob: CandidatePass = { ...candidate, jobDurationMin: 1e6 };
    expect(estimateRemaining([], carbide, longJob).feasible).toBe(false);
    expect(estimateRemaining([], carbide, candidate).feasible).toBe(true);
  });

  it('confidence band is positive', () => {
    expect(estimateRemaining([], carbide, candidate).confidenceMin).toBeGreaterThan(0);
  });
});

describe('isoLifeSpeed', () => {
  it('target life → speed (inverse of predictLife)', () => {
    const T = 10;
    const v = isoLifeSpeed(carbide, T, 0.1, 1);
    expect(predictLifeMin(carbide, v, 0.1, 1)).toBeCloseTo(T, 1);
  });

  it('zero target → infinite speed', () => {
    expect(isoLifeSpeed(carbide, 0, 0.1, 1)).toBe(Infinity);
  });
});

describe('findSweetSpot', () => {
  it('returns best speed/life/MRR', () => {
    const sweet = findSweetSpot(carbide, 0.1, 1, { minSpeed: 50, maxSpeed: 300, steps: 30, targetLifeMin: 10 });
    expect(sweet.speedMpm).toBeGreaterThan(0);
    expect(sweet.lifeMin).toBeGreaterThan(0);
    expect(sweet.metalRemovalRate).toBeGreaterThan(0);
  });

  it('higher MRR is preferred when life is OK', () => {
    const sweet = findSweetSpot(carbide, 0.1, 1, { minSpeed: 50, maxSpeed: 300, steps: 30, targetLifeMin: 1 });
    // With low target life, the higher speeds become viable.
    expect(sweet.speedMpm).toBeGreaterThan(50);
  });
});

describe('summarize', () => {
  it('reports usedFraction + feasible', () => {
    const r = estimateRemaining([], carbide, { speedMpm: 150, feedMmRev: 0.1, docMm: 1, jobDurationMin: 1 });
    const s = summarize(r, { speedMpm: 150, feedMmRev: 0.1, docMm: 1, jobDurationMin: 1 });
    expect(s.usedFraction).toBe(0);
    expect(s.feasible).toBe(true);
  });

  it('marginMin is remaining - job', () => {
    const r = estimateRemaining([], carbide, { speedMpm: 150, feedMmRev: 0.1, docMm: 1, jobDurationMin: 1 });
    const s = summarize(r, { speedMpm: 150, feedMmRev: 0.1, docMm: 1, jobDurationMin: 1 });
    expect(s.marginMin).toBeCloseTo(r.remainingMinAtCandidate - 1, 5);
  });
});
