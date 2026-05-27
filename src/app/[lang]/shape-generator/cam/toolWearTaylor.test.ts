import { describe, it, expect } from 'vitest';
import {
  predictLifeFromSpeed,
  predictSpeedFromLife,
  accumulateWear,
  statusOf,
  findExpiryInJob,
  sampleTaylorCurve,
  summarize,
  PARAMS_HSS_STEEL,
  PARAMS_CARBIDE_STEEL,
} from './toolWearTaylor';

describe('predictLifeFromSpeed', () => {
  it('V = C gives T = 1 min', () => {
    const t = predictLifeFromSpeed(PARAMS_HSS_STEEL.C, PARAMS_HSS_STEEL);
    expect(t).toBeCloseTo(1, 5);
  });

  it('higher V → shorter life', () => {
    const tLow = predictLifeFromSpeed(20, PARAMS_HSS_STEEL);
    const tHigh = predictLifeFromSpeed(40, PARAMS_HSS_STEEL);
    expect(tHigh).toBeLessThan(tLow);
  });

  it('zero speed → infinite life', () => {
    expect(predictLifeFromSpeed(0, PARAMS_HSS_STEEL)).toBe(Infinity);
  });

  it('extended equation: higher feed shortens life', () => {
    const params = { ...PARAMS_CARBIDE_STEEL, feedExponent: 0.5, referenceFeed: 0.1 };
    const tBase = predictLifeFromSpeed(100, params, 0.1);
    const tHigh = predictLifeFromSpeed(100, params, 0.3);
    expect(tHigh).toBeLessThan(tBase);
  });
});

describe('predictSpeedFromLife', () => {
  it('T = 1 min gives V = C', () => {
    const v = predictSpeedFromLife(1, PARAMS_HSS_STEEL);
    expect(v).toBeCloseTo(PARAMS_HSS_STEEL.C, 5);
  });

  it('longer life → lower speed', () => {
    const vShort = predictSpeedFromLife(10, PARAMS_CARBIDE_STEEL);
    const vLong = predictSpeedFromLife(100, PARAMS_CARBIDE_STEEL);
    expect(vLong).toBeLessThan(vShort);
  });

  it('zero life → infinite speed', () => {
    expect(predictSpeedFromLife(0, PARAMS_HSS_STEEL)).toBe(Infinity);
  });
});

describe('accumulateWear', () => {
  it('empty cuts → 0 fraction', () => {
    const s = accumulateWear([], PARAMS_HSS_STEEL);
    expect(s.cumulativeFraction).toBe(0);
    expect(s.history).toEqual([]);
  });

  it('cuts accumulate fractions', () => {
    const cuts = [
      { id: 'c1', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.5 }, // uses 50% of 1-min life
      { id: 'c2', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.3 }, // uses 30%
    ];
    const s = accumulateWear(cuts, PARAMS_HSS_STEEL);
    expect(s.cumulativeFraction).toBeCloseTo(0.8, 3);
    expect(s.history).toHaveLength(2);
  });

  it('initial fraction is added', () => {
    const cuts = [{ id: 'c1', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.5 }];
    const s = accumulateWear(cuts, PARAMS_HSS_STEEL, 0.4);
    expect(s.cumulativeFraction).toBeCloseTo(0.9, 3);
  });

  it('history records cut ids', () => {
    const cuts = [
      { id: 'op1', speedMpm: 20, durationMin: 1 },
      { id: 'op2', speedMpm: 25, durationMin: 1 },
    ];
    const s = accumulateWear(cuts, PARAMS_HSS_STEEL);
    expect(s.history.map(h => h.cutId)).toEqual(['op1', 'op2']);
  });
});

describe('statusOf', () => {
  it('< 0.2 → fresh', () => expect(statusOf(0.1)).toBe('fresh'));
  it('0.2-0.8 → normal', () => expect(statusOf(0.5)).toBe('normal'));
  it('0.8-1.0 → worn', () => expect(statusOf(0.9)).toBe('worn'));
  it('≥ 1.0 → expired', () => expect(statusOf(1.5)).toBe('expired'));
});

describe('findExpiryInJob', () => {
  it('no expiry returns null', () => {
    const s = accumulateWear([{ id: 'c1', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.5 }], PARAMS_HSS_STEEL);
    expect(findExpiryInJob(s)).toBeNull();
  });

  it('detects expiry mid-job', () => {
    const cuts = [
      { id: 'c1', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.5 },
      { id: 'c2', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.8 },
    ];
    const s = accumulateWear(cuts, PARAMS_HSS_STEEL);
    const expiry = findExpiryInJob(s);
    expect(expiry).not.toBeNull();
    expect(expiry!.cutId).toBe('c2');
  });
});

describe('sampleTaylorCurve', () => {
  it('returns requested number of samples', () => {
    const curve = sampleTaylorCurve(PARAMS_HSS_STEEL, { min: 10, max: 50 }, 10);
    expect(curve).toHaveLength(10);
  });

  it('samples cover speed range', () => {
    const curve = sampleTaylorCurve(PARAMS_HSS_STEEL, { min: 10, max: 50 }, 10);
    expect(curve[0]!.speedMpm).toBeCloseTo(10, 5);
    expect(curve[curve.length - 1]!.speedMpm).toBeCloseTo(50, 5);
  });

  it('higher speed → lower life in samples', () => {
    const curve = sampleTaylorCurve(PARAMS_HSS_STEEL, { min: 10, max: 50 }, 10);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.lifeMin).toBeLessThanOrEqual(curve[i - 1]!.lifeMin);
    }
  });
});

describe('summarize', () => {
  it('empty state', () => {
    const s = summarize({ cumulativeFraction: 0, history: [] }, PARAMS_HSS_STEEL);
    expect(s.cutCount).toBe(0);
    expect(s.status).toBe('fresh');
  });

  it('reports cut count', () => {
    const cuts = [{ id: 'c1', speedMpm: 20, durationMin: 1 }];
    const state = accumulateWear(cuts, PARAMS_HSS_STEEL);
    const s = summarize(state, PARAMS_HSS_STEEL);
    expect(s.cutCount).toBe(1);
  });

  it('reports expiresInCutId when expired', () => {
    const cuts = [
      { id: 'c1', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.5 },
      { id: 'c2', speedMpm: PARAMS_HSS_STEEL.C, durationMin: 0.8 },
    ];
    const state = accumulateWear(cuts, PARAMS_HSS_STEEL);
    const s = summarize(state, PARAMS_HSS_STEEL);
    expect(s.expiresInCutId).toBe('c2');
  });

  it('remaining time depends on planned speed', () => {
    const state = accumulateWear([{ id: 'c1', speedMpm: 20, durationMin: 0.1 }], PARAMS_HSS_STEEL);
    const s = summarize(state, PARAMS_HSS_STEEL, 20);
    expect(s.remainingTimeMin).toBeGreaterThan(0);
    expect(s.remainingTimeMin).toBeLessThan(Infinity);
  });
});
