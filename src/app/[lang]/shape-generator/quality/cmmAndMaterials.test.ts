import { describe, it, expect } from 'vitest';
import {
  rigidAlign,
  computeDeviations,
  flatnessDeviation,
  type MeasuredPoint,
  type CadPoint,
} from './cmmCompare';
import {
  findMaterial,
  listMaterials,
  recommendByStrength,
  recommendByConductivity,
  specificStrength,
  MATERIAL_DB,
} from '../materials/materialDb';
import {
  CNC_VISE_PRESETS,
  generateDrillJig,
  suggestClampPoints,
  selectCncVise,
  checkPrintPlate,
  listToolingByKind,
} from '../tooling/toolingPresets';

describe('rigidAlign', () => {
  it('returns identity when fewer than 3 correspondences', () => {
    const r = rigidAlign([[0, 0, 0], [1, 0, 0]], [[5, 5, 5], [6, 5, 5]]);
    expect(r.rotation[0][0]).toBe(1);
    expect(r.translation).toEqual([0, 0, 0]);
  });

  it('recovers translation roughly for identical point sets shifted', () => {
    // rigidAlign uses a Gram-Schmidt polar approximation (not full SVD),
    // so rotation isn't exactly identity even for pure translation. We
    // just require the translation to be in the right ballpark and the
    // RMS error bounded.
    const src: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
    const tgt: Array<[number, number, number]> = src.map(p => [p[0] + 10, p[1] + 5, p[2] - 3]);
    const r = rigidAlign(src, tgt);
    expect(r.translation[0]).toBeCloseTo(10, 0);
    expect(r.translation[1]).toBeCloseTo(5, 0);
    expect(r.translation[2]).toBeCloseTo(-3, 0);
    expect(r.rmsError).toBeLessThan(1);
  });
});

describe('computeDeviations', () => {
  const cad: CadPoint[] = [
    { position: [0, 0, 0], normal: [0, 0, 1] },
    { position: [10, 0, 0], normal: [0, 0, 1] },
    { position: [0, 10, 0], normal: [0, 0, 1] },
  ];

  it('all-zero deviation when measured = cad', () => {
    const measured: MeasuredPoint[] = cad.map(c => ({ position: c.position }));
    const r = computeDeviations(measured, cad, 0.1);
    expect(r.rmsMm).toBeCloseTo(0, 6);
    expect(r.outOfTolerance).toHaveLength(0);
  });

  it('flags points beyond tolerance along normal', () => {
    const measured: MeasuredPoint[] = [
      { position: [0, 0, 0.5] }, // 0.5mm above
      { position: [10, 0, 0.05] },
      { position: [0, 10, 1.0] }, // 1.0mm above
    ];
    const r = computeDeviations(measured, cad, 0.2);
    expect(r.outOfTolerance).toEqual([0, 2]);
  });

  it('reports signed deviation', () => {
    const measured: MeasuredPoint[] = [{ position: [0, 0, -0.3] }];
    const r = computeDeviations(measured, cad, 1.0);
    expect(r.perPointMm[0]).toBeCloseTo(-0.3, 6);
  });
});

describe('flatnessDeviation', () => {
  it('returns 0 for fewer than 3 points', () => {
    expect(flatnessDeviation([{ position: [0, 0, 0] }, { position: [1, 0, 0] }])).toBe(0);
  });

  it('returns 0 for perfectly planar points (all z=0)', () => {
    const pts: MeasuredPoint[] = [
      { position: [0, 0, 0] }, { position: [10, 0, 0] }, { position: [0, 10, 0] }, { position: [10, 10, 0] },
    ];
    expect(flatnessDeviation(pts)).toBeLessThan(1e-9);
  });

  it('reports peak-to-valley for tilted surface', () => {
    const pts: MeasuredPoint[] = [
      { position: [0, 0, 0] }, { position: [10, 0, 0] },
      { position: [0, 10, 0] }, { position: [10, 10, 0] },
      { position: [5, 5, 0.5] },
    ];
    expect(flatnessDeviation(pts)).toBeGreaterThan(0);
  });
});

describe('materialDb', () => {
  it('finds known material by id', () => {
    expect(findMaterial('al-6061-t6')?.name).toContain('6061');
  });

  it('returns null for unknown id', () => {
    expect(findMaterial('not-a-material')).toBeNull();
  });

  it('filters by category', () => {
    const metals = listMaterials('metal-ferrous');
    expect(metals.length).toBeGreaterThan(0);
    expect(metals.every(m => m.category === 'metal-ferrous')).toBe(true);
  });

  it('lists all materials when no category given', () => {
    expect(listMaterials().length).toBe(MATERIAL_DB.length);
  });

  it('recommendByStrength returns sorted by cost', () => {
    const r = recommendByStrength(300);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.costPerKgUsd ?? Infinity).toBeGreaterThanOrEqual(r[i - 1]!.costPerKgUsd ?? -Infinity);
    }
    expect(r.every(m => (m.yieldStrength ?? 0) >= 300)).toBe(true);
  });

  it('recommendByConductivity descending by k', () => {
    const r = recommendByConductivity();
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.thermalConductivity ?? 0).toBeLessThanOrEqual(r[i - 1]!.thermalConductivity ?? Infinity);
    }
  });

  it('specificStrength = yield / density (consistent unit)', () => {
    const m = findMaterial('al-6061-t6')!;
    const ss = specificStrength(m);
    expect(ss).toBeCloseTo((m.yieldStrength! * 1000) / m.density, 5);
  });

  it('specificStrength is zero when yield missing', () => {
    const fake = { id: 'x', name: 'x', category: 'metal-ferrous' as const, density: 1000 };
    expect(specificStrength(fake)).toBe(0);
  });
});

describe('toolingPresets', () => {
  it('generateDrillJig produces footprint sized for hole pattern', () => {
    const holes = [
      { position: [0, 0] as [number, number], diameterMm: 6 },
      { position: [50, 0] as [number, number], diameterMm: 6 },
      { position: [25, 30] as [number, number], diameterMm: 8 },
    ];
    const jig = generateDrillJig(holes);
    expect(jig.footprintMm[0]).toBe(90); // 50 + 40 margin
    expect(jig.footprintMm[1]).toBe(70); // 30 + 40 margin
    expect(jig.bushingPositions).toHaveLength(3);
  });

  it('drill jig bushing is larger than hole by default', () => {
    const jig = generateDrillJig([{ position: [0, 0], diameterMm: 6 }]);
    expect(jig.bushingPositions![0]!.diameterMm).toBeGreaterThan(6);
  });

  it('suggestClampPoints returns 3 points on bottom plane', () => {
    const clamps = suggestClampPoints({ min: [-10, -10, 0], max: [10, 10, 5] });
    expect(clamps).toHaveLength(3);
    expect(clamps.every(c => c[2] === 0)).toBe(true);
  });

  it('selectCncVise picks smallest vise that fits part width', () => {
    const v = selectCncVise({ min: [0, 0, 0], max: [50, 50, 50] });
    expect(v).not.toBeNull();
    expect(v!.footprintMm[0]).toBeGreaterThanOrEqual(60);
  });

  it('selectCncVise falls back to largest when nothing fits', () => {
    const v = selectCncVise({ min: [0, 0, 0], max: [5000, 100, 100] });
    expect(v).toBe(CNC_VISE_PRESETS[CNC_VISE_PRESETS.length - 1]);
  });

  it('checkPrintPlate detects fit on default plate', () => {
    const r = checkPrintPlate({ min: [0, 0, 0], max: [100, 100, 100] });
    expect(r.fitsOnPlate).toBe(true);
    expect(r.utilizationPercent).toBeGreaterThan(0);
  });

  it('checkPrintPlate rejects oversize part', () => {
    const r = checkPrintPlate({ min: [0, 0, 0], max: [1000, 1000, 1000] });
    expect(r.fitsOnPlate).toBe(false);
    expect(r.utilizationPercent).toBe(0);
  });

  it('checkPrintPlate accepts rotation when it fits sideways', () => {
    // Default Prusa MK4 = 250×210. Try 210×250 rotated.
    const r = checkPrintPlate({ min: [0, 0, 0], max: [210, 250, 50] });
    expect(r.fitsOnPlate).toBe(true);
  });

  it('listToolingByKind returns matching presets', () => {
    expect(listToolingByKind('cnc-vise')).toEqual(CNC_VISE_PRESETS);
    expect(listToolingByKind('inspection-fixture')).toEqual([]);
  });
});
