import { describe, it, expect } from 'vitest';
import {
  HOLDER_LIBRARY,
  getByDesignation,
  listByFamily,
  checkCompatibility,
  recommendHolder,
  summarize,
  type CompatibilityCheck,
} from './toolHolderLibrary';

describe('HOLDER_LIBRARY', () => {
  it('contains expected families', () => {
    const families = new Set(HOLDER_LIBRARY.map(h => h.family));
    expect(families.has('BT')).toBe(true);
    expect(families.has('CAT')).toBe(true);
    expect(families.has('HSK')).toBe(true);
    expect(families.has('ER')).toBe(true);
  });

  it('every holder has positive RPM', () => {
    for (const h of HOLDER_LIBRARY) {
      expect(h.maxRpm).toBeGreaterThan(0);
    }
  });

  it('every holder has positive gauge diameter', () => {
    for (const h of HOLDER_LIBRARY) {
      expect(h.gaugeDiameterMm).toBeGreaterThan(0);
    }
  });
});

describe('getByDesignation', () => {
  it('finds BT40', () => {
    const h = getByDesignation('BT40');
    expect(h).not.toBeNull();
    expect(h!.family).toBe('BT');
  });

  it('returns null for unknown', () => {
    expect(getByDesignation('UNKNOWN')).toBeNull();
  });
});

describe('listByFamily', () => {
  it('returns all BT holders', () => {
    const list = listByFamily('BT');
    expect(list.length).toBeGreaterThan(0);
    for (const h of list) expect(h.family).toBe('BT');
  });

  it('returns all ER collets', () => {
    const list = listByFamily('ER');
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('checkCompatibility', () => {
  it('matching family + RPM → compatible', () => {
    const h = getByDesignation('BT40')!;
    const check: CompatibilityCheck = {
      spindleFamily: 'BT',
      spindleMaxRpm: 12000,
      coolantThroughRequired: false,
    };
    const r = checkCompatibility(h, check);
    expect(r.compatible).toBe(true);
  });

  it('wrong family → incompatible', () => {
    const h = getByDesignation('BT40')!;
    const check: CompatibilityCheck = {
      spindleFamily: 'HSK',
      spindleMaxRpm: 12000,
      coolantThroughRequired: false,
    };
    const r = checkCompatibility(h, check);
    expect(r.compatible).toBe(false);
    expect(r.reasons.some(x => x.includes('family'))).toBe(true);
  });

  it('coolant requirement fails when not supported', () => {
    const h = getByDesignation('ER16')!; // no coolant-through
    const check: CompatibilityCheck = {
      spindleFamily: 'ER',
      spindleMaxRpm: 18000,
      coolantThroughRequired: true,
    };
    const r = checkCompatibility(h, check);
    expect(r.compatible).toBe(false);
  });

  it('cutter shank too large for ER collet → incompatible', () => {
    const h = getByDesignation('ER16')!;
    const check: CompatibilityCheck = {
      spindleFamily: 'ER',
      spindleMaxRpm: 18000,
      coolantThroughRequired: false,
      cutterShankMm: 20,
    };
    const r = checkCompatibility(h, check);
    expect(r.compatible).toBe(false);
  });
});

describe('recommendHolder', () => {
  it('returns smallest compatible holder', () => {
    const check: CompatibilityCheck = {
      spindleFamily: 'ER',
      spindleMaxRpm: 18000,
      coolantThroughRequired: true,
      cutterShankMm: 10,
    };
    const h = recommendHolder(check);
    expect(h).not.toBeNull();
    expect(h!.family).toBe('ER');
  });

  it('returns null when nothing compatible', () => {
    const check: CompatibilityCheck = {
      spindleFamily: 'BT',
      spindleMaxRpm: 12000,
      coolantThroughRequired: false,
      cutterShankMm: 100,
    };
    expect(recommendHolder({ ...check, spindleFamily: 'ER', cutterShankMm: 1000 })).toBeNull();
  });
});

describe('summarize', () => {
  it('total > 0', () => {
    expect(summarize().totalHolders).toBeGreaterThan(0);
  });

  it('counts per family', () => {
    const s = summarize();
    expect(s.familyCounts.BT + s.familyCounts.CAT + s.familyCounts.HSK + s.familyCounts.ER).toBe(s.totalHolders);
  });

  it('best balance is the minimum grade in catalog', () => {
    const s = summarize();
    const minGrade = Math.min(...HOLDER_LIBRARY.map(h => h.balanceGrade));
    expect(s.bestBalanceGrade).toBe(minGrade);
  });
});
