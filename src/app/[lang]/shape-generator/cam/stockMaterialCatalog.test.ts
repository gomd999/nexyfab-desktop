import { describe, it, expect } from 'vitest';
import {
  lookup,
  filterByCriteria,
  spindleRpm,
  feedMmMin,
  blockWeightKg,
  compare,
  summarize,
  STOCK_CATALOG,
} from './stockMaterialCatalog';

describe('STOCK_CATALOG', () => {
  it('AL-6061 entry exists', () => {
    expect(STOCK_CATALOG['AL-6061'].name).toContain('Aluminum');
  });

  it('Inconel hardest', () => {
    expect(STOCK_CATALOG['INCONEL-718'].brinellHB).toBeGreaterThan(STOCK_CATALOG['AL-6061'].brinellHB);
  });
});

describe('lookup', () => {
  it('returns material', () => {
    expect(lookup('SS-304').code).toBe('SS-304');
  });
});

describe('filterByCriteria', () => {
  it('minMachinability filter', () => {
    const r = filterByCriteria({ minMachinability: 200 });
    expect(r.every(m => m.machinabilityIndex >= 200)).toBe(true);
  });

  it('maxBrinell filter', () => {
    const r = filterByCriteria({ maxBrinell: 100 });
    expect(r.every(m => m.brinellHB <= 100)).toBe(true);
  });

  it('combine filters', () => {
    const r = filterByCriteria({ minMachinability: 200, maxBrinell: 100 });
    expect(r.length).toBeGreaterThan(0);
  });

  it('empty result when impossible', () => {
    const r = filterByCriteria({ minMachinability: 9999 });
    expect(r).toEqual([]);
  });
});

describe('spindleRpm', () => {
  it('positive for valid input', () => {
    const rpm = spindleRpm(lookup('AL-6061'), 10);
    expect(rpm).toBeGreaterThan(0);
  });

  it('zero for zero diameter', () => {
    expect(spindleRpm(lookup('AL-6061'), 0)).toBe(0);
  });

  it('aluminum faster than inconel', () => {
    expect(spindleRpm(lookup('AL-6061'), 10)).toBeGreaterThan(spindleRpm(lookup('INCONEL-718'), 10));
  });
});

describe('feedMmMin', () => {
  it('feed = fz × flutes × rpm', () => {
    const m = lookup('AL-6061');
    const rpm = 5000;
    expect(feedMmMin(m, 4, rpm)).toBeCloseTo(m.recFzMm * 4 * rpm, 5);
  });
});

describe('blockWeightKg', () => {
  it('aluminum 1 cm³ ≈ 2.7g', () => {
    expect(blockWeightKg(lookup('AL-6061'), 1)).toBeCloseTo(0.0027, 4);
  });
});

describe('compare', () => {
  it('aluminum more machinable than steel', () => {
    const cmp = compare('STEEL-1018', 'AL-6061');
    expect(cmp.machinabilityRatio).toBeGreaterThan(1);
  });

  it('cost factor > 1 for harder material', () => {
    const cmp = compare('AL-6061', 'INCONEL-718');
    expect(cmp.costFactorEstimate).toBeGreaterThan(1);
  });
});

describe('summarize', () => {
  it('reports counts + highest machinability', () => {
    const s = summarize();
    expect(s.totalMaterials).toBe(Object.keys(STOCK_CATALOG).length);
    expect(s.highestMachinability).toBeDefined();
  });

  it('hardest material is Inconel', () => {
    expect(summarize().hardestBrinell).toBe(STOCK_CATALOG['INCONEL-718'].brinellHB);
  });
});
