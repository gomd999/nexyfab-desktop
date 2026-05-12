/**
 * Z4 — Standards library catalog tests.
 *
 * Pin selection helpers so future catalog edits don't silently change the
 * picked size — bearing/key selection is load-bearing for downstream
 * geometry sizing and BOM generation.
 */

import { describe, it, expect } from 'vitest';
import {
  lookupImperial,
  lookupBearing,
  selectBearing,
  selectKey,
  selectRetainingRing,
  selectDrillForHole,
  lookupSocketHeadCap,
  lookupCountersunk,
  lookupDowelPin,
  lookupTaperedBearing,
  selectTaperedBearing,
  ASME_FASTENERS,
  DIN_BALL_BEARINGS,
  ISO_4762_SCREWS,
  DIN_720_TAPERED_BEARINGS,
} from '../standardsLibrary';

describe('imperial fastener lookup', () => {
  it('finds canonical UNC sizes', () => {
    expect(lookupImperial('1/4-20')?.tpi).toBe(20);
    expect(lookupImperial('3/8-16')?.series).toBe('UNC');
  });

  it('finds UNF (fine thread) variants', () => {
    expect(lookupImperial('1/4-28')?.series).toBe('UNF');
  });

  it('returns null for unknown designation', () => {
    expect(lookupImperial('NOT_REAL-99')).toBeNull();
  });

  it('catalog covers #4 through 1"', () => {
    const sizes = Object.keys(ASME_FASTENERS);
    expect(sizes).toContain('#4-40');
    expect(sizes).toContain('1-8');
  });
});

describe('bearing selection', () => {
  it('lookupBearing returns full record', () => {
    const b = lookupBearing('6204');
    expect(b?.boreMm).toBe(20);
    expect(b?.odMm).toBe(47);
  });

  it('selectBearing picks smallest that meets load + rpm', () => {
    // 6000 series: 4550N @ 30000rpm should fit
    const b = selectBearing(4000, 25000);
    expect(b?.designation).toBe('6000');
  });

  it('respects minBoreMm', () => {
    const b = selectBearing(3000, 15000, { minBoreMm: 20 });
    expect(b?.boreMm).toBeGreaterThanOrEqual(20);
  });

  it('returns null when load exceeds catalog', () => {
    const b = selectBearing(50000, 100);
    expect(b).toBeNull();
  });

  it('catalog has DIN 6004-6006 + 6204-6206 series', () => {
    const sizes = Object.keys(DIN_BALL_BEARINGS);
    expect(sizes).toContain('6204');
    expect(sizes).toContain('6206');
  });
});

describe('parallel key selection', () => {
  it('Ø20 shaft → 6×6 key', () => {
    const k = selectKey(20);
    expect(k?.bMm).toBe(6);
    expect(k?.hMm).toBe(6);
  });

  it('Ø25 shaft → 8×7 key', () => {
    const k = selectKey(25);
    expect(k?.bMm).toBe(8);
  });

  it('returns null for shaft below catalog', () => {
    expect(selectKey(2)).toBeNull();
  });
});

describe('retaining ring selection', () => {
  it('external Ø20 → DIN 471 record', () => {
    const r = selectRetainingRing('external', 20);
    expect(r?.thicknessMm).toBe(1.2);
    expect(r?.grooveDiameterMm).toBe(19);
  });

  it('internal Ø25 → DIN 472 record', () => {
    const r = selectRetainingRing('internal', 25);
    expect(r?.grooveDiameterMm).toBe(26.2);
  });

  it('non-standard size returns null', () => {
    expect(selectRetainingRing('external', 13.5)).toBeNull();
  });
});

describe('drill selection', () => {
  it('picks the smallest drill ≥ requested mm', () => {
    const d = selectDrillForHole(6);
    expect(d?.diameterMm).toBeGreaterThanOrEqual(6);
    expect(d?.diameterMm).toBeLessThan(7);
  });

  it('tap drill for M3 (~2.5mm) → close to #41/2.4mm or 1/8"=3.175mm depending on catalog', () => {
    const d = selectDrillForHole(2.5);
    expect(d).not.toBeNull();
    expect(d!.diameterMm).toBeGreaterThanOrEqual(2.5);
  });

  it('returns null when nothing in catalog is large enough', () => {
    expect(selectDrillForHole(100)).toBeNull();
  });
});

// ─── A3 — round 2 catalog tests ──────────────────────────────────────────

describe('socket head cap screw (ISO 4762)', () => {
  it('M5 has correct head + hex socket sizing', () => {
    const s = lookupSocketHeadCap('M5');
    expect(s?.headDiameterMm).toBe(8.5);
    expect(s?.headHeightMm).toBe(5.0);
    expect(s?.hexSocketAfMm).toBe(4.0);
  });

  it('catalog covers M3 through M16', () => {
    expect(Object.keys(ISO_4762_SCREWS)).toContain('M3');
    expect(Object.keys(ISO_4762_SCREWS)).toContain('M16');
  });

  it('null for unknown size', () => {
    expect(lookupSocketHeadCap('M99')).toBeNull();
  });
});

describe('countersunk screw (ISO 10642)', () => {
  it('M6 has 90° head', () => {
    const s = lookupCountersunk('M6');
    expect(s?.headAngleDeg).toBe(90);
    expect(s?.headDiameterMm).toBeCloseTo(13.44, 1);
  });

  it('M3 has tighter hex socket than M5 (smaller socket size)', () => {
    expect(lookupCountersunk('M3')!.hexSocketAfMm).toBeLessThan(lookupCountersunk('M5')!.hexSocketAfMm);
  });
});

describe('dowel pin (DIN 7)', () => {
  it('Ø6 has m6 fit + standard length list', () => {
    const p = lookupDowelPin(6);
    expect(p?.toleranceClass).toBe('m6');
    expect(p?.lengthsMm).toContain(20);
  });

  it('non-standard diameter returns null', () => {
    expect(lookupDowelPin(7)).toBeNull();
  });
});

describe('tapered roller bearing (DIN 720)', () => {
  it('30205 has correct geometry', () => {
    const b = lookupTaperedBearing('30205');
    expect(b?.boreMm).toBe(25);
    expect(b?.odMm).toBe(52);
    expect(b?.contactAngleDeg).toBe(12.5);
  });

  it('selectTaperedBearing picks smallest meeting load', () => {
    // 30202 = 19500N — too small for 30000N
    // 30203 = 26500N — too small for 30000N
    // 30204 = 34500N — first to meet
    const b = selectTaperedBearing(30000);
    expect(b?.designation).toBe('30204');
  });

  it('respects minBoreMm', () => {
    const b = selectTaperedBearing(20000, { minBoreMm: 30 });
    expect(b?.boreMm).toBeGreaterThanOrEqual(30);
  });

  it('returns null when load exceeds catalog', () => {
    expect(selectTaperedBearing(1e9)).toBeNull();
  });

  it('catalog includes 302/303 + 322/323 series', () => {
    const designations = Object.keys(DIN_720_TAPERED_BEARINGS);
    expect(designations).toContain('30205');
    expect(designations).toContain('32205');
  });
});
