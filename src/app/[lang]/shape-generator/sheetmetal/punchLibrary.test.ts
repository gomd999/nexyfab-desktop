import { describe, it, expect } from 'vitest';
import {
  PUNCH_LIBRARY,
  DIE_LIBRARY,
  recommendToolPair,
  findPunchByDesignation,
  findDieByDesignation,
  summarize,
  type BendRequirement,
} from './punchLibrary';

describe('LIBRARY constants', () => {
  it('has punches and dies', () => {
    expect(PUNCH_LIBRARY.length).toBeGreaterThan(0);
    expect(DIE_LIBRARY.length).toBeGreaterThan(0);
  });

  it('all punches have positive tip radius', () => {
    for (const p of PUNCH_LIBRARY) expect(p.tipRadiusMm).toBeGreaterThan(0);
  });

  it('all dies have positive V-width except hemming', () => {
    for (const d of DIE_LIBRARY) {
      if (d.profile !== 'hemming-die') expect(d.vWidthMm).toBeGreaterThan(0);
    }
  });
});

describe('findPunchByDesignation', () => {
  it('finds existing punch', () => {
    expect(findPunchByDesignation('STD 88°/R0.6')).not.toBeNull();
  });

  it('returns null for unknown', () => {
    expect(findPunchByDesignation('zzz')).toBeNull();
  });
});

describe('findDieByDesignation', () => {
  it('finds V8 die', () => {
    expect(findDieByDesignation('V8/90')).not.toBeNull();
  });

  it('returns null for unknown', () => {
    expect(findDieByDesignation('zzz')).toBeNull();
  });
});

describe('recommendToolPair', () => {
  it('recommends a pair for typical thin sheet', () => {
    const req: BendRequirement = {
      thicknessMm: 1.5,
      bendAngleDeg: 90,
      insideBendRadiusMm: 0.8,
      flangeHeightMm: 20,
    };
    const r = recommendToolPair(req);
    expect(r).not.toBeNull();
    expect(r!.punch).toBeDefined();
    expect(r!.die).toBeDefined();
  });

  it('returns null when no punch fits flange height', () => {
    const req: BendRequirement = {
      thicknessMm: 1.0,
      bendAngleDeg: 90,
      insideBendRadiusMm: 0.5,
      flangeHeightMm: 500,
    };
    expect(recommendToolPair(req)).toBeNull();
  });

  it('thicker sheet → wider V-die', () => {
    const thin = recommendToolPair({ thicknessMm: 1, bendAngleDeg: 90, insideBendRadiusMm: 0.5, flangeHeightMm: 20 });
    const thick = recommendToolPair({ thicknessMm: 5, bendAngleDeg: 90, insideBendRadiusMm: 1, flangeHeightMm: 20 });
    expect(thick!.die.vWidthMm).toBeGreaterThanOrEqual(thin!.die.vWidthMm);
  });

  it('larger desired radius selects larger-tip punch', () => {
    const small = recommendToolPair({ thicknessMm: 2, bendAngleDeg: 90, insideBendRadiusMm: 0.6, flangeHeightMm: 20 });
    const big = recommendToolPair({ thicknessMm: 2, bendAngleDeg: 90, insideBendRadiusMm: 5, flangeHeightMm: 20 });
    expect(big!.punch.tipRadiusMm).toBeGreaterThan(small!.punch.tipRadiusMm);
  });

  it('bending force scales with thickness²', () => {
    const thin = recommendToolPair({ thicknessMm: 1, bendAngleDeg: 90, insideBendRadiusMm: 0.5, flangeHeightMm: 20 });
    const thick = recommendToolPair({ thicknessMm: 5, bendAngleDeg: 90, insideBendRadiusMm: 1, flangeHeightMm: 20 });
    expect(thick!.forceKnPerM).toBeGreaterThan(thin!.forceKnPerM);
  });

  it('spring-back > 0', () => {
    const r = recommendToolPair({ thicknessMm: 2, bendAngleDeg: 90, insideBendRadiusMm: 1, flangeHeightMm: 20 });
    expect(r!.springBackDeg).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const s = summarize();
    expect(s.punchCount).toBe(PUNCH_LIBRARY.length);
    expect(s.dieCount).toBe(DIE_LIBRARY.length);
  });

  it('reports profile lists', () => {
    const s = summarize();
    expect(s.punchProfiles.length).toBeGreaterThan(0);
    expect(s.dieProfiles.length).toBeGreaterThan(0);
  });

  it('min/max tip radius', () => {
    const s = summarize();
    expect(s.minTipRadius).toBeLessThanOrEqual(s.maxTipRadius);
  });
});
