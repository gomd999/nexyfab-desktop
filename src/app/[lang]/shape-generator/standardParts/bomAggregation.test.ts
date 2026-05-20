import { describe, it, expect } from 'vitest';
import { aggregateBom, summarizeBom, applyPartnerCosts, type StandardPart } from './bomAggregation';
import { buildFastener } from './fastenerSchema';
import { findByDesignation } from './bearingCatalog';

const bolt6x25 = (finish?: string): StandardPart => ({
  kind: 'fastener',
  spec: buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25, finish }),
});

const bearing6002: StandardPart = {
  kind: 'bearing',
  spec: findByDesignation('6002')!,
};

describe('aggregateBom', () => {
  it('collapses identical fasteners into a single row with qty', () => {
    const r = aggregateBom([bolt6x25(), bolt6x25(), bolt6x25()]);
    expect(r).toHaveLength(1);
    expect(r[0]!.qty).toBe(3);
  });

  it('separates rows by finish by default', () => {
    const r = aggregateBom([bolt6x25('zinc'), bolt6x25('blackoxide')]);
    expect(r).toHaveLength(2);
  });

  it('collapses finishes when option set', () => {
    const r = aggregateBom([bolt6x25('zinc'), bolt6x25('blackoxide')], { collapseFinishes: true });
    expect(r).toHaveLength(1);
    expect(r[0]!.qty).toBe(2);
  });

  it('mixes fasteners and bearings in the output', () => {
    const r = aggregateBom([bolt6x25(), bearing6002, bearing6002]);
    expect(r).toHaveLength(2);
    const bearingRow = r.find(x => x.category === 'bearing');
    expect(bearingRow?.qty).toBe(2);
  });

  it('sorts bearings before fasteners (alphabetical category)', () => {
    const r = aggregateBom([bolt6x25(), bearing6002]);
    expect(r[0]!.category).toBe('bearing');
  });
});

describe('summarizeBom', () => {
  it('totals quantities across rows', () => {
    const rows = aggregateBom([bolt6x25(), bolt6x25(), bearing6002]);
    const s = summarizeBom(rows);
    expect(s.totalParts).toBe(3);
    expect(s.rowCount).toBe(2);
  });

  it('returns null totalCost when any row missing cost', () => {
    const rows = aggregateBom([bolt6x25()]);
    expect(summarizeBom(rows).totalCostKrw).toBeNull();
  });

  it('returns total when all rows have cost', () => {
    const rows = aggregateBom([bolt6x25(), bolt6x25()]);
    rows[0]!.unitCostKrw = 100;
    expect(summarizeBom(rows).totalCostKrw).toBe(200);
  });
});

describe('applyPartnerCosts', () => {
  it('attaches cost to matching designation', () => {
    const rows = aggregateBom([bolt6x25()]);
    const out = applyPartnerCosts(rows, new Map([[rows[0]!.designation, 250]]));
    expect(out[0]!.unitCostKrw).toBe(250);
  });

  it('does not mutate input', () => {
    const rows = aggregateBom([bolt6x25()]);
    applyPartnerCosts(rows, new Map([[rows[0]!.designation, 250]]));
    expect(rows[0]!.unitCostKrw).toBeUndefined();
  });
});
