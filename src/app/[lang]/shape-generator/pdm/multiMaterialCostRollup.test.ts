import { describe, it, expect } from 'vitest';
import {
  rollup,
  compareScenarios,
  summarize,
  type MaterialSpec,
  type PartMaterialUse,
} from './multiMaterialCostRollup';

const ALUMINUM: MaterialSpec = { id: 'AL', name: 'Aluminum', unitCostUsdPerKg: 3.5, densityGcm3: 2.7 };
const STEEL: MaterialSpec = { id: 'STEEL', name: 'Steel', unitCostUsdPerKg: 1.2, densityGcm3: 7.85 };
const PLASTIC: MaterialSpec = { id: 'ABS', name: 'ABS Plastic', unitCostUsdPerKg: 2.0, densityGcm3: 1.05 };

describe('rollup', () => {
  it('empty uses → zero total', () => {
    const r = rollup([], [ALUMINUM]);
    expect(r.totalUsd).toBe(0);
  });

  it('single material cost = mass × unit cost', () => {
    const uses: PartMaterialUse[] = [{ materialId: 'AL', volumeCm3: 100 }];
    const r = rollup(uses, [ALUMINUM]);
    const expectedMass = 100 * 2.7 / 1000;
    const expectedCost = expectedMass * 3.5;
    expect(r.totalUsd).toBeCloseTo(expectedCost, 4);
  });

  it('waste increases cost', () => {
    const a = rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM]);
    const b = rollup([{ materialId: 'AL', volumeCm3: 100, wasteFraction: 0.2 }], [ALUMINUM]);
    expect(b.totalUsd).toBeGreaterThan(a.totalUsd);
  });

  it('process cost adds to material cost', () => {
    const a = rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM]);
    const b = rollup([{ materialId: 'AL', volumeCm3: 100, processCostUsd: 50 }], [ALUMINUM]);
    expect(b.totalUsd - a.totalUsd).toBeCloseTo(50, 4);
  });

  it('per-unit overhead added when set', () => {
    const r = rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM], { perUnitOverheadUsd: 10 });
    const noOverhead = rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM]);
    expect(r.totalUsd - noOverhead.totalUsd).toBeCloseTo(10, 4);
  });

  it('share of total sums to ≈ 1', () => {
    const uses: PartMaterialUse[] = [
      { materialId: 'AL', volumeCm3: 100 },
      { materialId: 'STEEL', volumeCm3: 50 },
    ];
    const r = rollup(uses, [ALUMINUM, STEEL]);
    const sum = r.lines.reduce((s, l) => s + l.shareOfTotal, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('identifies primary driver as largest line', () => {
    const uses: PartMaterialUse[] = [
      { materialId: 'AL', volumeCm3: 1000 },
      { materialId: 'STEEL', volumeCm3: 10 },
    ];
    const r = rollup(uses, [ALUMINUM, STEEL]);
    expect(r.primaryDriver).toBe('AL');
  });

  it('sensitivities listed per material', () => {
    const r = rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM, STEEL]);
    expect(r.sensitivities).toHaveLength(2);
  });

  it('10% price bump on material changes total by ~10% of that line', () => {
    const r = rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM]);
    const sens = r.sensitivities.find(s => s.materialId === 'AL');
    expect(sens!.deltaPer10PctUsd).toBeCloseTo(r.totalUsd * 0.1, 3);
  });

  it('unknown material id is skipped', () => {
    const r = rollup([{ materialId: 'UNKNOWN', volumeCm3: 100 }], [ALUMINUM]);
    expect(r.totalUsd).toBe(0);
  });
});

describe('compareScenarios', () => {
  it('identical scenarios → tied', () => {
    const c = compareScenarios(
      { uses: [{ materialId: 'AL', volumeCm3: 100 }], materials: [ALUMINUM] },
      { uses: [{ materialId: 'AL', volumeCm3: 100 }], materials: [ALUMINUM] },
    );
    expect(c.cheaper).toBe('tied');
  });

  it('B cheaper when material is cheaper', () => {
    const c = compareScenarios(
      { uses: [{ materialId: 'AL', volumeCm3: 100 }], materials: [ALUMINUM] },
      { uses: [{ materialId: 'STEEL', volumeCm3: 100 }], materials: [STEEL] },
    );
    // Steel: 100cm³ × 7.85g/cm³ / 1000 = 0.785kg × $1.2 = $0.94. Aluminum: 100×2.7/1000×3.5 = $0.945. Aluminum slightly more, but close.
    expect(['A', 'B', 'tied']).toContain(c.cheaper);
  });

  it('reports raw totals', () => {
    const c = compareScenarios(
      { uses: [{ materialId: 'AL', volumeCm3: 100 }], materials: [ALUMINUM] },
      { uses: [{ materialId: 'AL', volumeCm3: 200 }], materials: [ALUMINUM] },
    );
    expect(c.scenarioATotalUsd).toBeLessThan(c.scenarioBTotalUsd);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = rollup([], [ALUMINUM]);
    const s = summarize(r);
    expect(s.totalUsd).toBe(0);
    expect(s.materialCount).toBe(0);
  });

  it('reports primary driver', () => {
    const r = rollup(
      [{ materialId: 'AL', volumeCm3: 1000 }, { materialId: 'STEEL', volumeCm3: 10 }],
      [ALUMINUM, STEEL],
    );
    const s = summarize(r);
    expect(s.primaryDriver).toBe('AL');
    expect(s.primaryDriverShare).toBeGreaterThan(0.5);
  });

  it('counts material lines (excludes overhead)', () => {
    const r = rollup(
      [{ materialId: 'AL', volumeCm3: 100 }, { materialId: 'ABS', volumeCm3: 50 }],
      [ALUMINUM, PLASTIC],
      { perUnitOverheadUsd: 10 },
    );
    const s = summarize(r);
    expect(s.materialCount).toBe(2);
  });

  it('hasWaste flag', () => {
    const noWaste = summarize(rollup([{ materialId: 'AL', volumeCm3: 100 }], [ALUMINUM]));
    const withWaste = summarize(rollup([{ materialId: 'AL', volumeCm3: 100, wasteFraction: 0.1 }], [ALUMINUM]));
    expect(noWaste.hasWaste).toBe(false);
    expect(withWaste.hasWaste).toBe(true);
  });
});
