import { describe, it, expect } from 'vitest';
import {
  findBendTableMatch,
  bendAllowanceWithTable,
  validateBendTable,
  type BendTable,
} from './bendTable';

const tbl: BendTable = {
  id: 'test',
  name: 'Test Shop Table',
  entries: [
    { material: 'mildSteel', thickness: 1.0, innerRadius: 1.0, angle: 90, bendAllowance: 2.20 },
    { material: 'mildSteel', thickness: 2.0, innerRadius: 2.0, angle: 90, bendAllowance: 4.45 },
    { material: 'mildSteel', thickness: 2.0, innerRadius: 2.0, angle: 45, bendAllowance: 2.20 },
    { material: 'stainless304', thickness: 1.5, innerRadius: 1.5, angle: 90, bendAllowance: 3.25 },
  ],
};

describe('findBendTableMatch', () => {
  it('returns exact match when parameters match within tolerance', () => {
    const m = findBendTableMatch(tbl, 'mildSteel', 1.0, 1.0, 90);
    expect(m?.exact).toBe(true);
    expect(m?.entry.bendAllowance).toBe(2.20);
    expect(m?.distance).toBe(0);
  });

  it('returns nearest match within distance threshold', () => {
    // T=1.95 vs entry T=2.0 → tiny diff, well within 1.0 distance.
    const m = findBendTableMatch(tbl, 'mildSteel', 1.95, 2.0, 90);
    expect(m?.exact).toBe(false);
    expect(m?.entry.bendAllowance).toBe(4.45);
    expect(m!.distance).toBeLessThan(1.0);
  });

  it('returns null when no entry shares the material', () => {
    const m = findBendTableMatch(tbl, 'copper', 1.0, 1.0, 90);
    expect(m).toBeNull();
  });

  it('returns null when nearest match exceeds maxDistance', () => {
    // T=20 vs nearest entry T=2 → distance huge, beyond default 1.0.
    const m = findBendTableMatch(tbl, 'mildSteel', 20, 5, 30);
    expect(m).toBeNull();
  });

  it('disambiguates by angle (mildSteel 2mm 90° vs 45°)', () => {
    const m90 = findBendTableMatch(tbl, 'mildSteel', 2.0, 2.0, 90);
    const m45 = findBendTableMatch(tbl, 'mildSteel', 2.0, 2.0, 45);
    expect(m90?.entry.bendAllowance).toBe(4.45);
    expect(m45?.entry.bendAllowance).toBe(2.20);
  });
});

describe('bendAllowanceWithTable', () => {
  it('returns table-exact when an exact match exists', () => {
    const r = bendAllowanceWithTable('mildSteel', 1.0, 1.0, 90, tbl);
    expect(r.source).toBe('table-exact');
    expect(r.value).toBe(2.20);
  });

  it('returns table-nearest within threshold', () => {
    const r = bendAllowanceWithTable('mildSteel', 1.95, 2.0, 90, tbl);
    expect(r.source).toBe('table-nearest');
    expect(r.value).toBe(4.45);
  });

  it('falls back to k-factor when no table provided', () => {
    const r = bendAllowanceWithTable('mildSteel', 1.0, 1.0, 90, null);
    expect(r.source).toBe('k-factor');
    expect(r.kFactor).toBeGreaterThan(0);
    // Formula: π × (1 + K×1) × 0.5 — should land near the table's 2.20.
    expect(r.value).toBeGreaterThan(2.0);
    expect(r.value).toBeLessThan(2.5);
  });

  it('falls back to k-factor when table has no usable match', () => {
    const r = bendAllowanceWithTable('mildSteel', 20, 5, 30, tbl);
    expect(r.source).toBe('k-factor');
  });

  it('table values override the k-factor estimate', () => {
    // Pin the table entry to a noticeably different number, verify the
    // override actually wins (key test — this is the whole point).
    const overriden: BendTable = {
      id: 'o', name: 'Override',
      entries: [{ material: 'mildSteel', thickness: 1.0, innerRadius: 1.0, angle: 90, bendAllowance: 999 }],
    };
    const r = bendAllowanceWithTable('mildSteel', 1.0, 1.0, 90, overriden);
    expect(r.value).toBe(999);
    expect(r.source).toBe('table-exact');
  });
});

describe('validateBendTable', () => {
  it('flags out-of-range thickness', () => {
    const bad: BendTable = {
      id: 'b', name: 'Bad',
      entries: [{ material: 'mildSteel', thickness: 50, innerRadius: 2, angle: 90, bendAllowance: 4 }],
    };
    const issues = validateBendTable(bad);
    expect(issues.some(i => i.severity === 'error' && i.messageEn.includes('thickness'))).toBe(true);
  });

  it('flags out-of-range angle', () => {
    const bad: BendTable = {
      id: 'b', name: 'Bad',
      entries: [{ material: 'mildSteel', thickness: 2, innerRadius: 2, angle: 250, bendAllowance: 4 }],
    };
    const issues = validateBendTable(bad);
    expect(issues.some(i => i.messageEn.includes('angle'))).toBe(true);
  });

  it('warns when BA exceeds the outside arc length (likely measurement error)', () => {
    // For T=1, R=1, A=90°: outside arc = π × 2 × 0.5 ≈ 3.14 mm
    // BA of 10mm is physically impossible.
    const bad: BendTable = {
      id: 'b', name: 'Bad',
      entries: [{ material: 'mildSteel', thickness: 1, innerRadius: 1, angle: 90, bendAllowance: 10 }],
    };
    const issues = validateBendTable(bad);
    expect(issues.some(i => i.severity === 'warning' && i.messageEn.includes('outside arc'))).toBe(true);
  });

  it('returns no issues for a clean table', () => {
    expect(validateBendTable(tbl)).toEqual([]);
  });
});
