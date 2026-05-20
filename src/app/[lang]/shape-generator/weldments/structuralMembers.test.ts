import { describe, it, expect } from 'vitest';
import {
  findProfile,
  listProfilesByFamily,
  listProfilesByStandard,
  generateCutList,
  packStockLengths,
  PROFILE_CATALOG,
  type StructuralMember,
} from './structuralMembers';

describe('findProfile', () => {
  it('returns the AISC W8x31', () => {
    const p = findProfile('W8x31');
    expect(p).not.toBeNull();
    expect(p!.massPerMeterKgM).toBe(46.1);
  });

  it('returns null for unknown id', () => {
    expect(findProfile('NOT-A-PROFILE')).toBeNull();
  });
});

describe('listProfilesByFamily', () => {
  it('returns only W-beams when filtered', () => {
    const r = listProfilesByFamily('w-beam');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(p => p.family === 'w-beam')).toBe(true);
  });

  it('hss-round family exists', () => {
    expect(listProfilesByFamily('hss-round').length).toBeGreaterThan(0);
  });
});

describe('listProfilesByStandard', () => {
  it('KS standard returns Korean profiles', () => {
    const r = listProfilesByStandard('KS');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(p => p.standard === 'KS')).toBe(true);
  });
});

describe('generateCutList', () => {
  it('empty input → empty cut list', () => {
    const r = generateCutList([]);
    expect(r.rows).toHaveLength(0);
    expect(r.totalMassKg).toBe(0);
  });

  it('groups identical (profile, material, length) into one row with qty', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
      { id: 'm3', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
    ];
    const r = generateCutList(members);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.quantity).toBe(3);
  });

  it('different lengths stay in separate rows', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 3000, materialId: 'SS400' },
    ];
    const r = generateCutList(members);
    expect(r.rows).toHaveLength(2);
  });

  it('mass per piece = length × massPerMeterKgM', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 1000, materialId: 'SS400' },
    ];
    const r = generateCutList(members);
    expect(r.rows[0]!.massPerPieceKg).toBeCloseTo(46.1, 1);
  });

  it('totalMassKg = sum of row totalMassKg', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 1000, materialId: 'SS400' },
      { id: 'm2', profileId: 'L50x50x5', lengthMm: 500, materialId: 'SS400' },
    ];
    const r = generateCutList(members);
    const summed = r.rows.reduce((s, row) => s + row.totalMassKg, 0);
    expect(r.totalMassKg).toBeCloseTo(summed, 5);
  });

  it('unknown profileId is skipped', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'NOT-REAL', lengthMm: 2000, materialId: 'SS400' },
    ];
    const r = generateCutList(members);
    expect(r.rows).toHaveLength(0);
  });

  it('stockLengthPerProfile sums lengths', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 1000, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
    ];
    const r = generateCutList(members);
    expect(r.stockLengthPerProfile['W8x31']).toBe(3000);
  });
});

describe('packStockLengths', () => {
  it('packs 3 short pieces in one 6m stock', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 1500, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 1500, materialId: 'SS400' },
      { id: 'm3', profileId: 'W8x31', lengthMm: 1500, materialId: 'SS400' },
    ];
    const r = packStockLengths(members, 6000, 0);
    expect(r.perProfile['W8x31']!.sticksUsed).toBe(1);
  });

  it('opens a new stick when piece exceeds remaining', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 4000, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 4000, materialId: 'SS400' },
    ];
    const r = packStockLengths(members, 6000, 0);
    expect(r.perProfile['W8x31']!.sticksUsed).toBe(2);
  });

  it('counts kerf in remaining', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 2997, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 2997, materialId: 'SS400' },
    ];
    const r = packStockLengths(members, 6000, 3);
    // 2997 + 3 + 2997 + 3 = 6000 → fits exactly.
    expect(r.perProfile['W8x31']!.sticksUsed).toBe(1);
  });

  it('different profiles packed independently', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
      { id: 'm2', profileId: 'L50x50x5', lengthMm: 2000, materialId: 'SS400' },
    ];
    const r = packStockLengths(members);
    expect(r.totalStocksUsed).toBe(2);
  });

  it('emits per-stick assignments', () => {
    const members: StructuralMember[] = [
      { id: 'm1', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
      { id: 'm2', profileId: 'W8x31', lengthMm: 2000, materialId: 'SS400' },
    ];
    const r = packStockLengths(members);
    const assigns = r.perProfile['W8x31']!.stickAssignments;
    expect(assigns.length).toBe(2);
  });
});

describe('PROFILE_CATALOG', () => {
  it('contains at least 10 entries', () => {
    expect(PROFILE_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry has positive area + mass', () => {
    for (const p of PROFILE_CATALOG) {
      expect(p.areaMm2).toBeGreaterThan(0);
      expect(p.massPerMeterKgM).toBeGreaterThan(0);
    }
  });
});
