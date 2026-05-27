import { describe, it, expect } from 'vitest';
import {
  emitPartsList,
  renderCsv,
  inferColumnWidths,
  filterByVendor,
  summarize,
  type BomLineItem,
} from './partsListEmitter';

function item(num: number, pn: string, desc: string, qty: number, mat?: string, vendor?: string): BomLineItem {
  const i: BomLineItem = { itemNumber: num, partNumber: pn, description: desc, quantity: qty };
  if (mat !== undefined) i.material = mat;
  if (vendor !== undefined) i.vendor = vendor;
  return i;
}

describe('emitPartsList', () => {
  it('empty → empty', () => {
    const t = emitPartsList([]);
    expect(t.totalRows).toBe(0);
  });

  it('merges duplicate part numbers', () => {
    const items = [item(1, 'PN-1', 'A', 2), item(2, 'PN-1', 'A', 3)];
    const t = emitPartsList(items);
    expect(t.totalRows).toBe(1);
    expect(t.totalQuantity).toBe(5);
  });

  it('mergeDuplicates=false keeps original rows', () => {
    const items = [item(1, 'PN-1', 'A', 2), item(2, 'PN-1', 'A', 3)];
    const t = emitPartsList(items, { mergeDuplicates: false });
    expect(t.totalRows).toBe(2);
  });

  it('groupBy material splits into groups', () => {
    const items = [item(1, 'PN-1', 'A', 1, 'steel'), item(2, 'PN-2', 'B', 1, 'aluminum')];
    const t = emitPartsList(items, { groupBy: 'material' });
    expect(t.groups).toHaveLength(2);
  });

  it('groupBy vendor splits into groups', () => {
    const items = [item(1, 'PN-1', 'A', 1, '', 'V1'), item(2, 'PN-2', 'B', 1, '', 'V2')];
    const t = emitPartsList(items, { groupBy: 'vendor' });
    expect(t.groups).toHaveLength(2);
  });

  it('groupBy none → single group', () => {
    const t = emitPartsList([item(1, 'A', 'x', 1)]);
    expect(t.groups).toHaveLength(1);
  });

  it('sort by quantity descending', () => {
    const items = [item(1, 'A', 'x', 1), item(2, 'B', 'y', 5), item(3, 'C', 'z', 3)];
    const t = emitPartsList(items, { sortBy: 'quantity', ascending: false });
    expect(t.groups[0]!.items[0]!.partNumber).toBe('B');
  });

  it('sort by description', () => {
    const items = [item(1, 'A', 'z', 1), item(2, 'B', 'a', 1)];
    const t = emitPartsList(items, { sortBy: 'description', ascending: true });
    expect(t.groups[0]!.items[0]!.description).toBe('a');
  });

  it('totalQuantity correct', () => {
    const items = [item(1, 'A', 'x', 2), item(2, 'B', 'y', 5)];
    expect(emitPartsList(items).totalQuantity).toBe(7);
  });
});

describe('renderCsv', () => {
  it('emits header line', () => {
    const t = emitPartsList([item(1, 'A', 'x', 1)]);
    const csv = renderCsv(t, ['itemNumber', 'partNumber']);
    expect(csv.split('\n')[0]).toBe('itemNumber,partNumber');
  });

  it('escapes commas in description', () => {
    const t = emitPartsList([item(1, 'A', 'Bracket, left', 1)]);
    const csv = renderCsv(t, ['description']);
    expect(csv).toContain('"Bracket, left"');
  });

  it('includes group separators', () => {
    const items = [item(1, 'A', 'x', 1, 'steel'), item(2, 'B', 'y', 1, 'aluminum')];
    const t = emitPartsList(items, { groupBy: 'material' });
    const csv = renderCsv(t, ['partNumber']);
    expect(csv).toContain('# ');
  });
});

describe('inferColumnWidths', () => {
  it('widths cap at maxWidth', () => {
    const t = emitPartsList([item(1, 'PN-LONG-PART-NUMBER-EXTENDED', 'desc', 1)]);
    const widths = inferColumnWidths(t, ['partNumber'], 10);
    expect(widths[0]!.charWidth).toBeLessThanOrEqual(10);
  });

  it('header width when no items', () => {
    const t = emitPartsList([]);
    const widths = inferColumnWidths(t, ['quantity']);
    expect(widths[0]!.charWidth).toBeGreaterThanOrEqual('quantity'.length);
  });
});

describe('filterByVendor', () => {
  it('returns vendor matches', () => {
    const items = [item(1, 'A', 'x', 1, '', 'V1'), item(2, 'B', 'y', 1, '', 'V2')];
    const t = emitPartsList(items);
    expect(filterByVendor(t, 'V1')).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const t = emitPartsList([item(1, 'A', 'x', 1), item(2, 'B', 'y', 2)]);
    const s = summarize(t);
    expect(s.totalRows).toBe(2);
    expect(s.totalQuantity).toBe(3);
  });

  it('largest group size', () => {
    const items = [item(1, 'A', 'x', 1, 'steel'), item(2, 'B', 'y', 1, 'steel'), item(3, 'C', 'z', 1, 'aluminum')];
    const t = emitPartsList(items, { groupBy: 'material' });
    expect(summarize(t).largestGroupSize).toBe(2);
  });
});
