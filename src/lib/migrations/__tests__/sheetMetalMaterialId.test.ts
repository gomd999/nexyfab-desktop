import { describe, it, expect } from 'vitest';
import {
  aliasSheetMetalMaterialId,
  isKnownSheetMetalMaterialId,
  LEGACY_SHEET_METAL_MATERIAL_IDS,
} from '../sheetMetalMaterialId';
import {
  DEFAULT_MATERIAL,
  SHEET_METAL_MATERIALS,
  getKFactor,
  type SheetMetalMaterial,
} from '@/app/[lang]/shape-generator/features/sheetMetalTables';

describe('aliasSheetMetalMaterialId — Schema A passthrough', () => {
  it.each(Object.keys(SHEET_METAL_MATERIALS) as SheetMetalMaterial[])(
    'returns canonical id %s unchanged',
    (canonical) => {
      expect(aliasSheetMetalMaterialId(canonical)).toBe(canonical);
    },
  );
});

describe('aliasSheetMetalMaterialId — Schema B (kFactorTable dashed grade-spec)', () => {
  it('aluminum-5052 → aluminum5052', () => {
    expect(aliasSheetMetalMaterialId('aluminum-5052')).toBe('aluminum5052');
  });
  it('aluminum-6061 → aluminum6061', () => {
    expect(aliasSheetMetalMaterialId('aluminum-6061')).toBe('aluminum6061');
  });
  it('steel-cold-rolled → mildSteel', () => {
    expect(aliasSheetMetalMaterialId('steel-cold-rolled')).toBe('mildSteel');
  });
  it('steel-hot-rolled → mildSteel', () => {
    expect(aliasSheetMetalMaterialId('steel-hot-rolled')).toBe('mildSteel');
  });
  it('steel-stainless-304 → stainless304', () => {
    expect(aliasSheetMetalMaterialId('steel-stainless-304')).toBe('stainless304');
  });
  it('copper-c110 → copper', () => {
    expect(aliasSheetMetalMaterialId('copper-c110')).toBe('copper');
  });
  it('brass-260 → brass', () => {
    expect(aliasSheetMetalMaterialId('brass-260')).toBe('brass');
  });
});

describe('aliasSheetMetalMaterialId — Schema C (bendDeductionCalculator dashed common-name)', () => {
  it('mild-steel → mildSteel', () => {
    expect(aliasSheetMetalMaterialId('mild-steel')).toBe('mildSteel');
  });
  it('stainless-304 → stainless304', () => {
    expect(aliasSheetMetalMaterialId('stainless-304')).toBe('stainless304');
  });
  it('copper → copper', () => {
    expect(aliasSheetMetalMaterialId('copper')).toBe('copper');
  });
  it('brass → brass', () => {
    expect(aliasSheetMetalMaterialId('brass')).toBe('brass');
  });
});

describe('aliasSheetMetalMaterialId — common alternate spellings', () => {
  it.each([
    ['sgcc', 'galvanized'],
    ['SGCC', 'galvanized'],
    ['spcc', 'mildSteel'],
    ['SPCC', 'mildSteel'],
    ['sus304', 'stainless304'],
    ['SUS304', 'stainless304'],
    ['al5052', 'aluminum5052'],
    ['AL5052', 'aluminum5052'],
    ['Aluminum-6061', 'aluminum6061'],
  ])('%s → %s', (input, expected) => {
    expect(aliasSheetMetalMaterialId(input)).toBe(expected);
  });
});

describe('aliasSheetMetalMaterialId — unknown / empty input', () => {
  it('returns DEFAULT_MATERIAL on unknown id', () => {
    expect(aliasSheetMetalMaterialId('titanium-grade-5')).toBe(DEFAULT_MATERIAL);
  });
  it('returns DEFAULT_MATERIAL on empty string', () => {
    expect(aliasSheetMetalMaterialId('')).toBe(DEFAULT_MATERIAL);
  });
  it('returns DEFAULT_MATERIAL on null', () => {
    expect(aliasSheetMetalMaterialId(null)).toBe(DEFAULT_MATERIAL);
  });
  it('returns DEFAULT_MATERIAL on undefined', () => {
    expect(aliasSheetMetalMaterialId(undefined)).toBe(DEFAULT_MATERIAL);
  });
  it('strict mode throws on unknown id', () => {
    expect(() => aliasSheetMetalMaterialId('titanium', { strict: true })).toThrow(/unknown/);
  });
  it('strict mode throws on empty', () => {
    expect(() => aliasSheetMetalMaterialId('', { strict: true })).toThrow(/empty/);
  });
});

describe('aliasSheetMetalMaterialId — idempotency', () => {
  it('calling twice produces the same result as once', () => {
    for (const legacy of LEGACY_SHEET_METAL_MATERIAL_IDS) {
      const once = aliasSheetMetalMaterialId(legacy);
      const twice = aliasSheetMetalMaterialId(once);
      expect(twice).toBe(once);
    }
  });
  it('applying to all canonical ids returns the same id', () => {
    for (const canonical of Object.keys(SHEET_METAL_MATERIALS) as SheetMetalMaterial[]) {
      expect(aliasSheetMetalMaterialId(canonical)).toBe(canonical);
    }
  });
  it('chain of three calls equals one call', () => {
    const seed = 'steel-cold-rolled';
    const a = aliasSheetMetalMaterialId(seed);
    const b = aliasSheetMetalMaterialId(a);
    const c = aliasSheetMetalMaterialId(b);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('isKnownSheetMetalMaterialId', () => {
  it('recognises canonical ids', () => {
    expect(isKnownSheetMetalMaterialId('mildSteel')).toBe(true);
    expect(isKnownSheetMetalMaterialId('stainless304')).toBe(true);
  });
  it('recognises Schema B ids', () => {
    expect(isKnownSheetMetalMaterialId('steel-cold-rolled')).toBe(true);
  });
  it('recognises Schema C ids', () => {
    expect(isKnownSheetMetalMaterialId('mild-steel')).toBe(true);
  });
  it('rejects unknown ids', () => {
    expect(isKnownSheetMetalMaterialId('titanium')).toBe(false);
    expect(isKnownSheetMetalMaterialId('')).toBe(false);
    expect(isKnownSheetMetalMaterialId(null)).toBe(false);
  });
});

describe('K-drift verification — Schema A canonical is the single source of truth', () => {
  // Verify that aliased ids resolve to the same Schema A canonical id, so that
  // any downstream `getKFactor` call returns BIT-EXACT the same value as a
  // direct Schema A lookup. The pre-migration drift between Schema A and the
  // legacy in-line K-tables was up to 0.07 at R/T=1.0 — this guards against
  // regression to that drift.
  const rtSamples = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 10.0, 15.0];
  const aliasEquivalents: Array<[string, SheetMetalMaterial]> = [
    ['mild-steel', 'mildSteel'],
    ['steel-cold-rolled', 'mildSteel'],
    ['steel-hot-rolled', 'mildSteel'],
    ['stainless-304', 'stainless304'],
    ['steel-stainless-304', 'stainless304'],
    ['aluminum-5052', 'aluminum5052'],
    ['aluminum-6061', 'aluminum6061'],
    ['copper-c110', 'copper'],
    ['brass-260', 'brass'],
  ];
  for (const [legacy, canonical] of aliasEquivalents) {
    it(`${legacy} resolves to ${canonical} with zero K drift across R/T grid`, () => {
      const aliased = aliasSheetMetalMaterialId(legacy);
      expect(aliased).toBe(canonical);
      for (const rt of rtSamples) {
        const thickness = 1.0;
        const innerRadius = rt * thickness;
        const kViaAlias = getKFactor(aliased, innerRadius, thickness);
        const kDirect = getKFactor(canonical, innerRadius, thickness);
        // Same canonical id ⇒ same K, drift is exactly 0 (not just 1e-9).
        expect(Math.abs(kViaAlias - kDirect)).toBeLessThan(1e-9);
      }
    });
  }
});
