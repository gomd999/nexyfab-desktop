import { describe, it, expect } from 'vitest';
import {
  listBearings,
  findByDesignation,
  findByBore,
  pickBearing,
} from './bearingCatalog';

describe('listBearings', () => {
  it('returns all bearings when no filter', () => {
    expect(listBearings().length).toBeGreaterThan(15);
  });

  it('filters by family', () => {
    const dg = listBearings('deep-groove');
    expect(dg.every(b => b.family === 'deep-groove')).toBe(true);
  });
});

describe('findByDesignation', () => {
  it('finds 6002', () => {
    const b = findByDesignation('6002');
    expect(b?.boreMm).toBe(15);
    expect(b?.odMm).toBe(32);
  });

  it('returns null for unknown', () => {
    expect(findByDesignation('99999')).toBeNull();
  });
});

describe('findByBore', () => {
  it('returns multiple bearings for shared bore', () => {
    const r = findByBore(10);
    expect(r.length).toBeGreaterThanOrEqual(2); // 6000 + 7000B + 51100
  });

  it('filters by family when requested', () => {
    const r = findByBore(10, 'deep-groove');
    expect(r.every(b => b.family === 'deep-groove')).toBe(true);
  });

  it('sorts by OD ascending', () => {
    const r = findByBore(10);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.odMm).toBeGreaterThanOrEqual(r[i - 1]!.odMm);
    }
  });
});

describe('pickBearing', () => {
  it('picks smallest matching minBore', () => {
    const b = pickBearing({ minBoreMm: 12 });
    expect(b?.boreMm).toBeGreaterThanOrEqual(12);
  });

  it('respects maxOd constraint', () => {
    const b = pickBearing({ maxOdMm: 30 });
    expect(b!.odMm).toBeLessThanOrEqual(30);
  });

  it('filters by load rating', () => {
    const b = pickBearing({ family: 'deep-groove', loadKn: 10 });
    expect(b!.dynamicLoadRatingKn!).toBeGreaterThanOrEqual(10);
  });

  it('filters by limiting RPM', () => {
    const b = pickBearing({ family: 'deep-groove', rpm: 25000 });
    expect(b!.limitingRpm!).toBeGreaterThanOrEqual(25000);
  });

  it('returns null if no candidate matches', () => {
    const b = pickBearing({ loadKn: 9999 });
    expect(b).toBeNull();
  });
});
