import { describe, it, expect } from 'vitest';
import {
  estimateConsumption,
  aggregateFleet,
  recommendTank,
  suggestModeOverride,
  summarize,
  TYPICAL_RATES,
  type OperationDuration,
} from './coolantVolumeEstimator';

function op(id: string, mode: OperationDuration['mode'], cut: number = 10, idle: number = 0): OperationDuration {
  return { operationId: id, cuttingMinutes: cut, idleMinutes: idle, mode };
}

describe('estimateConsumption', () => {
  it('empty list → empty', () => {
    expect(estimateConsumption([])).toEqual([]);
  });

  it('dry mode → zero volume', () => {
    const r = estimateConsumption([op('o1', 'dry')]);
    expect(r[0]!.volumeLitres).toBe(0);
  });

  it('flood: cut + half idle', () => {
    const r = estimateConsumption([op('o1', 'flood', 10, 10)]);
    // 10×20 + 10×20×0.5 = 200 + 100 = 300 L
    expect(r[0]!.volumeLitres).toBeCloseTo(300, 3);
  });

  it('mist much lower than flood', () => {
    const flood = estimateConsumption([op('a', 'flood', 60)])[0]!;
    const mist = estimateConsumption([op('b', 'mist', 60)])[0]!;
    expect(mist.volumeLitres).toBeLessThan(flood.volumeLitres);
  });

  it('mql < mist', () => {
    const mist = estimateConsumption([op('a', 'mist', 60)])[0]!;
    const mql = estimateConsumption([op('b', 'mql', 60)])[0]!;
    expect(mql.volumeLitres).toBeLessThan(mist.volumeLitres);
  });

  it('through-spindle does not consume during idle', () => {
    const r = estimateConsumption([op('o1', 'through-spindle', 10, 100)])[0]!;
    expect(r.idleCoolantOn).toBe(false);
  });

  it('flood marks idle coolant on', () => {
    const r = estimateConsumption([op('o1', 'flood', 10, 0)])[0]!;
    expect(r.idleCoolantOn).toBe(true);
  });

  it('cost positive with default unit cost', () => {
    const r = estimateConsumption([op('o1', 'flood', 10)])[0]!;
    expect(r.estimatedCost).toBeGreaterThan(0);
  });

  it('cost override respected', () => {
    const r = estimateConsumption([op('o1', 'flood', 10)], TYPICAL_RATES, { flood: 100 })[0]!;
    expect(r.estimatedCost).toBeCloseTo(r.volumeLitres * 100, 3);
  });

  it('cryogenic mass treated as litres-equivalent', () => {
    const r = estimateConsumption([op('o1', 'cryogenic', 10)])[0]!;
    expect(r.volumeLitres).toBeGreaterThan(0);
  });
});

describe('aggregateFleet', () => {
  it('byMode sums per category', () => {
    const r = estimateConsumption([op('a', 'flood', 10), op('b', 'mist', 60), op('c', 'dry', 5)]);
    const agg = aggregateFleet(r);
    expect(agg.byMode.flood).toBeGreaterThan(0);
    expect(agg.byMode.dry).toBe(0);
  });

  it('worst operation tracks max volume', () => {
    const r = estimateConsumption([op('big', 'flood', 100), op('small', 'mist', 1)]);
    expect(aggregateFleet(r).worstOperationId).toBe('big');
  });

  it('empty → null worst', () => {
    expect(aggregateFleet([]).worstOperationId).toBeNull();
  });
});

describe('recommendTank', () => {
  it('positive recommended size', () => {
    expect(recommendTank(50, 14).recommendedTankLitres).toBeGreaterThan(50 * 14);
  });

  it('frequency echoed', () => {
    expect(recommendTank(50, 7).daysBetweenRefills).toBe(7);
  });
});

describe('suggestModeOverride', () => {
  it('flood → mist saves volume', () => {
    const sug = suggestModeOverride(op('o1', 'flood', 60), 'mist');
    expect(sug.estimatedSavingsLitres).toBeGreaterThan(0);
  });

  it('dry → flood produces negative savings', () => {
    const sug = suggestModeOverride(op('o1', 'dry', 60), 'flood');
    expect(sug.estimatedSavingsLitres).toBeLessThan(0);
  });
});

describe('summarize', () => {
  it('dominant mode is flood when biggest', () => {
    const r = estimateConsumption([op('a', 'flood', 100), op('b', 'mist', 1)]);
    expect(summarize(r).dominantMode).toBe('flood');
  });

  it('empty → dry dominant', () => {
    expect(summarize([]).dominantMode).toBe('dry');
  });
});
