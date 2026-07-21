import { describe, it, expect } from 'vitest';
import {
  checkEgressTravelDistance,
  checkEgressWidth,
  checkOccupancyLoad,
  checkCorridorClearWidth,
  checkPlumbingFixtureCount,
  checkCeilingHeight,
  INTERIOR_CHECKS,
  OCCUPANT_LOAD_FACTOR_M2,
} from '../checks';

describe('interior gate-material — every result carries a basis', () => {
  it('all registry entries produce a non-empty basis', () => {
    const results = [
      checkEgressTravelDistance({ measuredTravelM: 50, useGroup: 'business', sprinklered: true }),
      checkEgressWidth({ occupantLoad: 100, providedWidthMm: 1000 }),
      checkOccupancyLoad({ floorAreaM2: 100, useGroup: 'business' }),
      checkCorridorClearWidth({ measuredClearWidthMm: 1200 }),
      checkPlumbingFixtureCount({ occupantLoad: 50, providedFixtures: 3, useGroup: 'business' }),
      checkCeilingHeight({ measuredHeightMm: 2400 }),
    ];
    for (const r of results) {
      expect(r.basis).toBeTruthy();
      expect(typeof r.basis).toBe('string');
      // failing results MUST carry a reason; passing ones MUST NOT
      if (r.pass) expect(r.reason).toBeUndefined();
      else expect(r.reason).toBeTruthy();
    }
    expect(Object.keys(INTERIOR_CHECKS)).toHaveLength(6);
  });
});

describe('1) egress travel distance (IBC 2018 Table 1017.2)', () => {
  it('PASS: business sprinklered, 80 m ≤ 91.44 m limit', () => {
    const r = checkEgressTravelDistance({ measuredTravelM: 80, useGroup: 'business', sprinklered: true });
    expect(r.pass).toBe(true);
    expect(r.metrics.limitM).toBe(91.44);
    expect(r.metrics.measuredTravelM).toBeLessThanOrEqual(r.metrics.limitM);
  });
  it('FAIL: business non-sprinklered, 70 m > 60.96 m limit (metric crosses limit)', () => {
    const r = checkEgressTravelDistance({ measuredTravelM: 70, useGroup: 'business', sprinklered: false });
    expect(r.pass).toBe(false);
    expect(r.metrics.limitM).toBe(60.96);
    expect(r.metrics.measuredTravelM).toBeGreaterThan(r.metrics.limitM);
    expect(r.reason).toBeTruthy();
  });
});

describe('2) egress width (IBC 2018 §1005.3 capacity factor)', () => {
  // hand-calc: 200 occ × 5.08 mm/occ = 1016 mm required
  it('PASS: 1200 mm provided ≥ 1016 mm required (200 occ × 5.08)', () => {
    const r = checkEgressWidth({ occupantLoad: 200, providedWidthMm: 1200 });
    expect(r.metrics.requiredWidthMm).toBe(1016);
    expect(r.pass).toBe(true);
    expect(r.metrics.providedWidthMm).toBeGreaterThanOrEqual(r.metrics.requiredWidthMm);
  });
  it('FAIL: 900 mm provided < 1016 mm required (metric crosses limit)', () => {
    const r = checkEgressWidth({ occupantLoad: 200, providedWidthMm: 900 });
    expect(r.metrics.requiredWidthMm).toBe(1016);
    expect(r.pass).toBe(false);
    expect(r.metrics.providedWidthMm).toBeLessThan(r.metrics.requiredWidthMm);
    expect(r.reason).toBeTruthy();
  });
});

describe('3) occupancy load (IBC 2018 Table 1004.5)', () => {
  // HAND-CALC cross-check: business factor = 150 ft² × 0.092903 = 13.93545 m²/person
  //   occupants = ceil(500 / 13.93545) = ceil(35.878) = 36
  it('cross-check: business factor and occupant count computed by hand', () => {
    expect(OCCUPANT_LOAD_FACTOR_M2.business).toBeCloseTo(13.93545, 4);
    const byHand = Math.ceil(500 / (150 * 0.092903));
    expect(byHand).toBe(36);
    const r = checkOccupancyLoad({ floorAreaM2: 500, useGroup: 'business' });
    expect(r.metrics.occupantLoad).toBe(36);
  });
  it('PASS: computed 36 ≤ posted limit 40', () => {
    const r = checkOccupancyLoad({ floorAreaM2: 500, useGroup: 'business', postedOccupantLimit: 40 });
    expect(r.pass).toBe(true);
    expect(r.metrics.occupantLoad).toBeLessThanOrEqual(r.metrics.postedOccupantLimit);
  });
  it('FAIL: computed 36 > posted limit 30 (metric crosses limit)', () => {
    const r = checkOccupancyLoad({ floorAreaM2: 500, useGroup: 'business', postedOccupantLimit: 30 });
    expect(r.pass).toBe(false);
    expect(r.metrics.occupantLoad).toBeGreaterThan(r.metrics.postedOccupantLimit);
    expect(r.reason).toBeTruthy();
  });
});

describe('4) corridor / clearance width (IBC 2018 §1020.2)', () => {
  // 44 in × 25.4 = 1117.6 mm minimum when occupant load ≥ 50
  it('PASS: 1200 mm ≥ 1117.6 mm min (60 occ served)', () => {
    const r = checkCorridorClearWidth({ measuredClearWidthMm: 1200, occupantLoadServed: 60 });
    expect(r.metrics.minWidthMm).toBe(1117.6);
    expect(r.pass).toBe(true);
    expect(r.metrics.measuredClearWidthMm).toBeGreaterThanOrEqual(r.metrics.minWidthMm);
  });
  it('FAIL: 1000 mm < 1117.6 mm min (metric crosses limit)', () => {
    const r = checkCorridorClearWidth({ measuredClearWidthMm: 1000, occupantLoadServed: 60 });
    expect(r.metrics.minWidthMm).toBe(1117.6);
    expect(r.pass).toBe(false);
    expect(r.metrics.measuredClearWidthMm).toBeLessThan(r.metrics.minWidthMm);
    expect(r.reason).toBeTruthy();
  });
  it('low occupant load (<50) relaxes minimum to 914.4 mm (36 in)', () => {
    const r = checkCorridorClearWidth({ measuredClearWidthMm: 1000, occupantLoadServed: 30 });
    expect(r.metrics.minWidthMm).toBe(914.4);
    expect(r.pass).toBe(true);
  });
});

describe('5) plumbing fixture count (IBC 2018 Table 2902.1)', () => {
  // hand-calc: business 100 occ ÷ 25 = 4 required water closets
  it('PASS: 5 provided ≥ 4 required (100 occ ÷ 1:25)', () => {
    const r = checkPlumbingFixtureCount({ occupantLoad: 100, providedFixtures: 5, useGroup: 'business' });
    expect(r.metrics.requiredFixtures).toBe(4);
    expect(r.pass).toBe(true);
    expect(r.metrics.providedFixtures).toBeGreaterThanOrEqual(r.metrics.requiredFixtures);
  });
  it('FAIL: 3 provided < 4 required (metric crosses limit)', () => {
    const r = checkPlumbingFixtureCount({ occupantLoad: 100, providedFixtures: 3, useGroup: 'business' });
    expect(r.metrics.requiredFixtures).toBe(4);
    expect(r.pass).toBe(false);
    expect(r.metrics.providedFixtures).toBeLessThan(r.metrics.requiredFixtures);
    expect(r.reason).toBeTruthy();
  });
});

describe('6) ceiling / 반자 height (KBC §16 / IBC §1208.2)', () => {
  it('PASS: 2400 mm ≥ 2100 mm min', () => {
    const r = checkCeilingHeight({ measuredHeightMm: 2400 });
    expect(r.metrics.minHeightMm).toBe(2100);
    expect(r.pass).toBe(true);
    expect(r.metrics.measuredHeightMm).toBeGreaterThanOrEqual(r.metrics.minHeightMm);
  });
  it('FAIL: 2000 mm < 2100 mm min (metric crosses limit)', () => {
    const r = checkCeilingHeight({ measuredHeightMm: 2000 });
    expect(r.metrics.minHeightMm).toBe(2100);
    expect(r.pass).toBe(false);
    expect(r.metrics.measuredHeightMm).toBeLessThan(r.metrics.minHeightMm);
    expect(r.reason).toBeTruthy();
  });
});
