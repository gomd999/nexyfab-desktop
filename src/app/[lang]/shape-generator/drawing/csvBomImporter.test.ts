import { describe, it, expect } from 'vitest';
import { importCSV, rollupTotals, summarize } from './csvBomImporter';

describe('importCSV', () => {
  it('empty input → empty lines', () => {
    const r = importCSV('');
    expect(r.lines).toEqual([]);
  });

  it('parses simple BOM', () => {
    const csv = 'part_number,quantity,description\nPN-1,5,Bolt\nPN-2,3,Nut';
    const r = importCSV(csv);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]!.partNumber).toBe('PN-1');
    expect(r.lines[0]!.quantity).toBe(5);
  });

  it('handles quoted fields with commas', () => {
    const csv = 'part_number,description,quantity\n"PN-1","Bolt, M6, 20mm",5';
    const r = importCSV(csv);
    expect(r.lines[0]!.description).toBe('Bolt, M6, 20mm');
  });

  it('extras column preserved', () => {
    const csv = 'part_number,quantity,note\nPN-1,5,"see drawing 42"';
    const r = importCSV(csv);
    expect(r.lines[0]!.extras.note).toBe('see drawing 42');
  });

  it('parses unit cost', () => {
    const csv = 'part_number,quantity,unit_cost\nPN-1,5,12.50';
    const r = importCSV(csv);
    expect(r.lines[0]!.unitCostUsd).toBe(12.5);
  });

  it('parses comma-decimal numbers', () => {
    const csv = 'part_number,quantity,unit_cost\nPN-1,5,"12,50"';
    const r = importCSV(csv);
    expect(r.lines[0]!.unitCostUsd).toBe(12.5);
  });

  it('flags missing part numbers', () => {
    const csv = 'part_number,quantity\n,5\nPN-2,3';
    const r = importCSV(csv);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.lines).toHaveLength(1);
  });

  it('flags duplicate part numbers', () => {
    const csv = 'part_number,quantity\nPN-1,5\nPN-1,3';
    const r = importCSV(csv);
    expect(r.duplicateParts).toContain('PN-1');
  });

  it('flags zero quantity by default', () => {
    const csv = 'part_number,quantity\nPN-1,0';
    const r = importCSV(csv);
    expect(r.errors.length).toBe(1);
  });

  it('allowNegativeQuantity bypass error', () => {
    const csv = 'part_number,quantity\nPN-1,-1';
    const r = importCSV(csv, { allowNegativeQuantity: true });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.quantity).toBe(-1);
  });

  it('respects custom delimiter', () => {
    const csv = 'part_number;quantity\nPN-1;5';
    const r = importCSV(csv, { delimiter: ';' });
    expect(r.lines[0]!.partNumber).toBe('PN-1');
  });

  it('strips comment lines', () => {
    const csv = '# this is a comment\npart_number,quantity\nPN-1,5';
    const r = importCSV(csv, { commentPrefix: '#' });
    expect(r.lines).toHaveLength(1);
  });

  it('header aliases recognized', () => {
    const csv = 'pn,qty,desc\nPN-1,5,Hex';
    const r = importCSV(csv);
    expect(r.lines[0]!.partNumber).toBe('PN-1');
    expect(r.lines[0]!.quantity).toBe(5);
    expect(r.lines[0]!.description).toBe('Hex');
  });
});

describe('rollupTotals', () => {
  it('empty input → zeros', () => {
    const t = rollupTotals([]);
    expect(t.totalLines).toBe(0);
    expect(t.totalCostUsd).toBe(0);
  });

  it('total cost = sum(quantity × unit cost)', () => {
    const lines = [
      { partNumber: 'A', quantity: 5, unitCostUsd: 10, extras: {} },
      { partNumber: 'B', quantity: 2, unitCostUsd: 7, extras: {} },
    ];
    const t = rollupTotals(lines);
    expect(t.totalCostUsd).toBe(64);
  });

  it('counts unique suppliers', () => {
    const lines = [
      { partNumber: 'A', quantity: 1, supplier: 'X', extras: {} },
      { partNumber: 'B', quantity: 1, supplier: 'Y', extras: {} },
      { partNumber: 'C', quantity: 1, supplier: 'X', extras: {} },
    ];
    expect(rollupTotals(lines).uniqueSuppliers).toBe(2);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const csv = 'part_number,quantity\nPN-1,5\nPN-2,3';
    const s = summarize(importCSV(csv));
    expect(s.lineCount).toBe(2);
  });

  it('mapped vs extra count', () => {
    const csv = 'part_number,quantity,note\nPN-1,5,foo';
    const s = summarize(importCSV(csv));
    expect(s.mappedFieldCount).toBe(2);
    expect(s.extraFieldCount).toBe(1);
  });
});
