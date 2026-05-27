import { describe, it, expect } from 'vitest';
import {
  generateKit,
  estimateDrillingStock,
  summarize,
} from './matePinningKit';

const flangeMin = { x: 0, y: 0 };
const flangeMax = { x: 100, y: 100 };

describe('generateKit', () => {
  it('default kit has 2 dowels + N bolts', () => {
    const kit = generateKit(flangeMin, flangeMax);
    const dowels = kit.features.filter(f => f.kind === 'dowel');
    const bolts = kit.features.filter(f => f.kind === 'bolt');
    expect(dowels).toHaveLength(2);
    expect(bolts.length).toBeGreaterThan(0);
  });

  it('respects boltCount', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 6, boltSizeMm: 6, boltCount: 6, positionalAccuracyMm: 0.05, dowelFit: 'press' });
    const bolts = kit.features.filter(f => f.kind === 'bolt');
    expect(bolts).toHaveLength(6);
  });

  it('warning when boltCount < 2', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 6, boltSizeMm: 6, boltCount: 1, positionalAccuracyMm: 0.05, dowelFit: 'press' });
    expect(kit.warnings.length).toBeGreaterThan(0);
  });

  it('press fit assigns H7-press', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 6, boltSizeMm: 6, boltCount: 4, positionalAccuracyMm: 0.05, dowelFit: 'press' });
    const dowel = kit.features.find(f => f.kind === 'dowel')!;
    expect(dowel.holeFit).toBe('H7-press');
  });

  it('slip fit assigns H7', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 6, boltSizeMm: 6, boltCount: 4, positionalAccuracyMm: 0.05, dowelFit: 'slip' });
    const dowel = kit.features.find(f => f.kind === 'dowel')!;
    expect(dowel.holeFit).toBe('H7');
  });

  it('tight fit assigns H6', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 6, boltSizeMm: 6, boltCount: 4, positionalAccuracyMm: 0.05, dowelFit: 'tight' });
    const dowel = kit.features.find(f => f.kind === 'dowel')!;
    expect(dowel.holeFit).toBe('H6');
  });

  it('warns when dowel diameter too small for accuracy', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 3, boltSizeMm: 6, boltCount: 4, positionalAccuracyMm: 0.1, dowelFit: 'press' });
    expect(kit.warnings.some(w => w.includes('accuracy'))).toBe(true);
  });

  it('minSpacing > max(dowel, bolt) × 3', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 8, boltSizeMm: 6, boltCount: 4, positionalAccuracyMm: 0.05, dowelFit: 'press' });
    expect(kit.minSpacingMm).toBeGreaterThanOrEqual(24);
  });

  it('dowels at diagonal corners', () => {
    const kit = generateKit(flangeMin, flangeMax);
    const dowels = kit.features.filter(f => f.kind === 'dowel');
    expect(dowels[0]!.position.x).toBeLessThan(dowels[1]!.position.x);
    expect(dowels[0]!.position.y).toBeLessThan(dowels[1]!.position.y);
  });

  it('bolts around centre', () => {
    const kit = generateKit(flangeMin, flangeMax);
    const bolts = kit.features.filter(f => f.kind === 'bolt');
    for (const b of bolts) {
      const d = Math.hypot(b.position.x - 50, b.position.y - 50);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(50);
    }
  });
});

describe('estimateDrillingStock', () => {
  it('positive volume', () => {
    const kit = generateKit(flangeMin, flangeMax);
    const s = estimateDrillingStock(kit, 15);
    expect(s.totalVolumeMm3).toBeGreaterThan(0);
  });

  it('hole count matches features', () => {
    const kit = generateKit(flangeMin, flangeMax);
    const s = estimateDrillingStock(kit, 15);
    expect(s.totalHoleCount).toBe(kit.features.length);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const kit = generateKit(flangeMin, flangeMax, { dowelDiameterMm: 6, boltSizeMm: 6, boltCount: 4, positionalAccuracyMm: 0.05, dowelFit: 'press' });
    const s = summarize(kit);
    expect(s.dowelCount).toBe(2);
    expect(s.boltCount).toBe(4);
  });
});
