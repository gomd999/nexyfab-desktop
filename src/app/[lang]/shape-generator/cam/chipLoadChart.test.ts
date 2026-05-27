import { describe, it, expect } from 'vitest';
import {
  CHIP_LOAD_LIBRARY,
  findChipLoad,
  listForMaterial,
  recommendCutting,
  validateRecommendation,
  summarize,
} from './chipLoadChart';

describe('CHIP_LOAD_LIBRARY', () => {
  it('has rows', () => {
    expect(CHIP_LOAD_LIBRARY.length).toBeGreaterThan(0);
  });

  it('all rows have positive SFM and chip load', () => {
    for (const r of CHIP_LOAD_LIBRARY) {
      expect(r.sfm).toBeGreaterThan(0);
      expect(r.chipLoadMm).toBeGreaterThan(0);
    }
  });
});

describe('findChipLoad', () => {
  it('finds aluminum + carbide endmill', () => {
    const r = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat');
    expect(r).not.toBeNull();
    expect(r!.sfm).toBeGreaterThan(0);
  });

  it('returns null for unknown combo', () => {
    expect(findChipLoad('wood', 'ceramic', 'drill')).toBeNull();
  });
});

describe('listForMaterial', () => {
  it('returns all aluminum rows', () => {
    const list = listForMaterial('aluminum-6061');
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) expect(r.workMaterial).toBe('aluminum-6061');
  });

  it('empty for material with no rows', () => {
    expect(listForMaterial('plastic-acetal')).toEqual([]);
  });
});

describe('recommendCutting', () => {
  it('produces positive RPM and feedrate', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const r = recommendCutting(row, { diameterMm: 10, flutes: 4 });
    expect(r.rpm).toBeGreaterThan(0);
    expect(r.feedrateMmPerMin).toBeGreaterThan(0);
  });

  it('smaller diameter gives smaller feed', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const big = recommendCutting(row, { diameterMm: 10, flutes: 4 });
    const small = recommendCutting(row, { diameterMm: 3, flutes: 4 });
    expect(small.chipLoadMm).toBeLessThan(big.chipLoadMm);
  });

  it('more flutes → higher feed at same RPM', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const f2 = recommendCutting(row, { diameterMm: 10, flutes: 2, rpmOverride: 5000 });
    const f4 = recommendCutting(row, { diameterMm: 10, flutes: 4, rpmOverride: 5000 });
    expect(f4.feedrateMmPerMin).toBeGreaterThan(f2.feedrateMmPerMin);
  });

  it('rpmOverride respected', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const r = recommendCutting(row, { diameterMm: 10, flutes: 2, rpmOverride: 9999 });
    expect(r.rpm).toBe(9999);
  });

  it('surface speed = SFM × 0.3048', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const r = recommendCutting(row, { diameterMm: 10, flutes: 2 });
    expect(r.surfaceSpeedMpm).toBeCloseTo(row.sfm * 0.3048, 3);
  });
});

describe('validateRecommendation', () => {
  it('valid recommendation → no warnings', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const rec = recommendCutting(row, { diameterMm: 10, flutes: 4 });
    const warnings = validateRecommendation(rec, 30000, 10000);
    expect(warnings).toEqual([]);
  });

  it('RPM exceeds machine → warning', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const rec = recommendCutting(row, { diameterMm: 1, flutes: 4 });
    const warnings = validateRecommendation(rec, 1000, 10000);
    expect(warnings.some(w => w.field === 'rpm')).toBe(true);
  });

  it('low chip load → warning', () => {
    const row = findChipLoad('aluminum-6061', 'carbide-uncoated', 'endmill-flat')!;
    const rec = { ...recommendCutting(row, { diameterMm: 10, flutes: 4 }), chipLoadMm: 0.001 };
    const warnings = validateRecommendation(rec, 30000, 10000);
    expect(warnings.some(w => w.field === 'chip-load')).toBe(true);
  });
});

describe('summarize', () => {
  it('counts rows and materials', () => {
    const s = summarize();
    expect(s.rowCount).toBe(CHIP_LOAD_LIBRARY.length);
    expect(s.uniqueMaterials).toBeGreaterThan(3);
  });

  it('fastest SFM = max', () => {
    const s = summarize();
    const max = Math.max(...CHIP_LOAD_LIBRARY.map(r => r.sfm));
    expect(s.fastestSfm).toBe(max);
  });
});
