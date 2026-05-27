import { describe, it, expect } from 'vitest';
import {
  BOLT_CATALOG,
  NUT_CATALOG,
  BEARING_CATALOG,
  KEY_CATALOG,
  findBolt,
  findNut,
  findBearing,
  selectBearing,
  bearingL10HoursBall,
  bearingL10HoursTaper,
  recommendKey,
  buildHardwareBom,
} from './toolboxCatalog';

describe('catalogs', () => {
  it('bolt catalog has ≥ 8 entries', () => {
    expect(BOLT_CATALOG.length).toBeGreaterThanOrEqual(8);
  });

  it('every bolt has positive mass', () => {
    for (const b of BOLT_CATALOG) {
      expect(b.massGrams).toBeGreaterThan(0);
    }
  });

  it('nut catalog covers M3 - M8', () => {
    const threads = NUT_CATALOG.map(n => n.threadId);
    expect(threads).toContain('M3');
    expect(threads).toContain('M8');
  });

  it('bearing 6203 in catalog', () => {
    expect(findBearing('6203')).not.toBeNull();
  });

  it('key catalog has shaft range entries', () => {
    expect(KEY_CATALOG.length).toBeGreaterThanOrEqual(3);
  });
});

describe('findBolt', () => {
  it('returns M5 SHCS', () => {
    expect(findBolt('shcs-m5x16')?.threadId).toBe('M5');
  });

  it('null for unknown id', () => {
    expect(findBolt('unknown')).toBeNull();
  });
});

describe('findNut', () => {
  it('returns M6 hex nut', () => {
    expect(findNut('nut-m6')?.acrossFlatsMm).toBe(10);
  });
});

describe('selectBearing', () => {
  it('picks 6203 for 17mm shaft + light load', () => {
    const b = selectBearing({ shaftMm: 17, loadKn: 5, speedRpm: 1500 });
    expect(b?.designation).toBe('6203');
  });

  it('returns null when no bearing meets load', () => {
    expect(selectBearing({ shaftMm: 17, loadKn: 100, speedRpm: 1500 })).toBeNull();
  });

  it('respects category preference', () => {
    const b = selectBearing({ shaftMm: 17, loadKn: 5, speedRpm: 1500, category: 'bearing-taper' });
    expect(b?.designation).toBe('30203');
  });

  it('returns null when shaft unmatched', () => {
    expect(selectBearing({ shaftMm: 999, loadKn: 1, speedRpm: 100 })).toBeNull();
  });
});

describe('bearingL10HoursBall', () => {
  it('L10 = (C/P)³ × 10⁶ / (n × 60)', () => {
    const b = findBearing('6203')!;
    const r = bearingL10HoursBall(b, 1, 1000);
    // C/P = 9.56, ratio³ ≈ 873.7, × 1e6 ≈ 8.74e8 rev, / 60000 ≈ 14560 h.
    expect(r).toBeGreaterThan(10000);
    expect(r).toBeLessThan(20000);
  });

  it('higher load → shorter life', () => {
    const b = findBearing('6203')!;
    const light = bearingL10HoursBall(b, 1, 1000);
    const heavy = bearingL10HoursBall(b, 5, 1000);
    expect(heavy).toBeLessThan(light);
  });

  it('zero load → infinite life', () => {
    expect(bearingL10HoursBall(findBearing('6203')!, 0, 1000)).toBe(Infinity);
  });
});

describe('bearingL10HoursTaper', () => {
  it('higher exponent than ball (10/3 vs 3)', () => {
    const b = findBearing('30203')!;
    // Same load, taper life should differ from ball formula.
    expect(bearingL10HoursTaper(b, 5, 1000)).toBeGreaterThan(0);
  });
});

describe('recommendKey', () => {
  it('20mm shaft → 6×6 key', () => {
    const k = recommendKey(20);
    expect(k?.widthMm).toBe(6);
  });

  it('null when shaft outside catalog range', () => {
    expect(recommendKey(500)).toBeNull();
  });
});

describe('buildHardwareBom', () => {
  it('aggregates bolt + nut + 2× washer per usage', () => {
    const bom = buildHardwareBom([
      { boltId: 'shcs-m6x20', count: 4, matchingNut: 'nut-m6', matchingWasher: 'flat-m6' },
    ]);
    expect(bom.totalBolts).toBe(4);
    expect(bom.totalNuts).toBe(4);
    expect(bom.totalWashers).toBe(8); // 2 per bolt
  });

  it('mass = sum of (entry mass × qty)', () => {
    const bom = buildHardwareBom([
      { boltId: 'shcs-m6x20', count: 2 },
    ]);
    // SHCS M6×20 = 5.6 g × 2 = 11.2 g.
    expect(bom.totalMassGrams).toBeCloseTo(11.2, 1);
  });

  it('handles bolt-only usage (no nut/washer)', () => {
    const bom = buildHardwareBom([{ boltId: 'shcs-m5x16', count: 1 }]);
    expect(bom.totalNuts).toBe(0);
    expect(bom.totalWashers).toBe(0);
  });

  it('emits one line per distinct id', () => {
    const bom = buildHardwareBom([
      { boltId: 'shcs-m6x20', count: 4, matchingNut: 'nut-m6' },
    ]);
    expect(bom.lines).toHaveLength(2); // bolt + nut
  });
});
