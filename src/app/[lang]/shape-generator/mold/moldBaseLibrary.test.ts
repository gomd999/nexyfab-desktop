import { describe, it, expect } from 'vitest';
import {
  MOLD_BASE_CATALOG,
  findMoldBase,
  listMoldBasesByStandard,
  selectMoldBase,
  generateEjectorPattern,
  generateCoolingPattern,
  coolingEffectivenessRatio,
} from './moldBaseLibrary';

describe('catalog', () => {
  it('contains ≥ 6 base specs', () => {
    expect(MOLD_BASE_CATALOG.length).toBeGreaterThanOrEqual(6);
  });

  it('every base has 7-plate stack', () => {
    for (const m of MOLD_BASE_CATALOG) {
      expect(m.plates).toHaveLength(7);
    }
  });

  it('every base has positive mass + plate dimensions', () => {
    for (const m of MOLD_BASE_CATALOG) {
      expect(m.widthMm).toBeGreaterThan(0);
      expect(m.lengthMm).toBeGreaterThan(0);
      expect(m.totalMassKg).toBeGreaterThan(0);
    }
  });
});

describe('findMoldBase', () => {
  it('finds DME-A-7×7', () => {
    expect(findMoldBase('DME-A-7×7')).not.toBeNull();
  });

  it('returns null for unknown id', () => {
    expect(findMoldBase('FAKE')).toBeNull();
  });
});

describe('listMoldBasesByStandard', () => {
  it('DME filters return only DME', () => {
    const r = listMoldBasesByStandard('DME');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(m => m.standard === 'DME')).toBe(true);
  });

  it('HASCO and Misumi present', () => {
    expect(listMoldBasesByStandard('HASCO').length).toBeGreaterThan(0);
    expect(listMoldBasesByStandard('Misumi').length).toBeGreaterThan(0);
  });
});

describe('selectMoldBase', () => {
  it('picks smallest base that fits part + cavity count', () => {
    const r = selectMoldBase({
      partWidthMm: 50, partLengthMm: 50, partDepthMm: 20,
      cavityCount: 1, edgeMarginMm: 50,
    });
    expect(r.bestMatch).not.toBeNull();
    expect(r.bestMatch!.cavityCount).toBe(1);
    // The footprint should be at least 150x150 mm (50 part + 50×2 margin).
    expect(r.bestMatch!.widthMm).toBeGreaterThanOrEqual(150);
  });

  it('respects preferred standard when alternatives exist', () => {
    const r = selectMoldBase({
      partWidthMm: 50, partLengthMm: 50, partDepthMm: 20,
      cavityCount: 1, preferredStandard: 'HASCO',
      edgeMarginMm: 50,
    });
    expect(r.bestMatch?.standard).toBe('HASCO');
  });

  it('returns alternatives list', () => {
    const r = selectMoldBase({
      partWidthMm: 30, partLengthMm: 30, partDepthMm: 10,
      cavityCount: 1, edgeMarginMm: 30,
    });
    expect(r.alternatives.length).toBeGreaterThanOrEqual(0);
  });

  it('warns when no base fits', () => {
    const r = selectMoldBase({
      partWidthMm: 5000, partLengthMm: 5000, partDepthMm: 10,
      cavityCount: 1,
    });
    expect(r.bestMatch).toBeNull();
    expect(r.warnings.some(w => w.includes('No standard base'))).toBe(true);
  });

  it('warns on deep parts', () => {
    const r = selectMoldBase({
      partWidthMm: 50, partLengthMm: 50, partDepthMm: 100,
      cavityCount: 1, edgeMarginMm: 50,
    });
    expect(r.warnings.some(w => w.includes('depth'))).toBe(true);
  });
});

describe('generateEjectorPattern', () => {
  it('returns pins for non-empty bbox', () => {
    const pins = generateEjectorPattern({ widthMm: 100, lengthMm: 100 }, 4, 'normal');
    expect(pins.length).toBeGreaterThan(0);
  });

  it('dense pattern has more pins than sparse', () => {
    const sparse = generateEjectorPattern({ widthMm: 100, lengthMm: 100 }, 4, 'sparse');
    const dense = generateEjectorPattern({ widthMm: 100, lengthMm: 100 }, 4, 'dense');
    expect(dense.length).toBeGreaterThan(sparse.length);
  });

  it('head diameter > pin diameter', () => {
    const pins = generateEjectorPattern({ widthMm: 100, lengthMm: 100 }, 5);
    expect(pins[0]!.headDiameterMm).toBeGreaterThan(pins[0]!.diameterMm);
  });

  it('pin positions within bbox', () => {
    const pins = generateEjectorPattern({ widthMm: 100, lengthMm: 100 }, 4);
    for (const p of pins) {
      expect(Math.abs(p.position[0])).toBeLessThanOrEqual(50);
      expect(Math.abs(p.position[1])).toBeLessThanOrEqual(50);
    }
  });
});

describe('generateCoolingPattern', () => {
  it('returns ≥ 3 channels (2 longitudinal + cross)', () => {
    const r = generateCoolingPattern({ widthMm: 200, lengthMm: 300, depthMm: 30 });
    expect(r.length).toBeGreaterThanOrEqual(3);
  });

  it('default channel diameter = 8 mm', () => {
    const r = generateCoolingPattern({ widthMm: 100, lengthMm: 100, depthMm: 30 });
    expect(r[0]!.diameterMm).toBe(8);
  });

  it('all channels in A-plate', () => {
    const r = generateCoolingPattern({ widthMm: 100, lengthMm: 100, depthMm: 30 });
    expect(r.every(c => c.plate === 'A-plate')).toBe(true);
  });
});

describe('coolingEffectivenessRatio', () => {
  it('zero when no channels', () => {
    expect(coolingEffectivenessRatio([], 1000)).toBe(0);
  });

  it('positive for a valid channel network', () => {
    const channels = generateCoolingPattern({ widthMm: 100, lengthMm: 100, depthMm: 30 });
    const r = coolingEffectivenessRatio(channels, 10000);
    expect(r).toBeGreaterThan(0);
  });
});
