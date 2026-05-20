import { describe, it, expect } from 'vitest';
import {
  buildBomTable,
  renderCell,
  tableMetrics,
  renderBomTableSvg,
  DEFAULT_LAYOUT,
} from './bomTable';
import type { BomRow } from '../standardParts/bomAggregation';

const sampleRows: BomRow[] = [
  { designation: 'ISO 4014 M6 × 25', category: 'fastener', qty: 4, notes: 'steel-8.8' },
  { designation: '6002', category: 'bearing', qty: 2, notes: '15×32×9' },
];

describe('buildBomTable', () => {
  it('assigns balloon numbers in order', () => {
    const t = buildBomTable(sampleRows);
    expect(t.rows[0]!.balloonNumber).toBe(1);
    expect(t.rows[1]!.balloonNumber).toBe(2);
  });

  it('uses default layout when none provided', () => {
    const t = buildBomTable(sampleRows);
    expect(t.layout).toBe(DEFAULT_LAYOUT);
  });

  it('preserves row data', () => {
    const t = buildBomTable(sampleRows);
    expect(t.rows[0]!.designation).toBe('ISO 4014 M6 × 25');
    expect(t.rows[0]!.qty).toBe(4);
  });
});

describe('renderCell', () => {
  const balloned = buildBomTable(sampleRows).rows[0]!;
  it('balloon column shows the number', () => {
    expect(renderCell(balloned, { key: 'balloon', label: '#', widthMm: 8 })).toBe('1');
  });
  it('qty column shows quantity', () => {
    expect(renderCell(balloned, { key: 'qty', label: 'Qty', widthMm: 12 })).toBe('4');
  });
  it('notes column shows notes', () => {
    expect(renderCell(balloned, { key: 'notes', label: 'Notes', widthMm: 30 })).toBe('steel-8.8');
  });
  it('unitCost — em-dash when missing', () => {
    expect(renderCell(balloned, { key: 'unitCost', label: 'KRW', widthMm: 20 })).toBe('—');
  });
  it('unitCost — Korean locale when set', () => {
    const withCost = { ...balloned, unitCostKrw: 1500 };
    expect(renderCell(withCost, { key: 'unitCost', label: 'KRW', widthMm: 20 })).toBe('1,500');
  });
  it('totalCost — multiplies unit by qty', () => {
    const withCost = { ...balloned, unitCostKrw: 1500 };
    expect(renderCell(withCost, { key: 'totalCost', label: 'KRW', widthMm: 20 })).toBe('6,000');
  });
});

describe('tableMetrics', () => {
  it('height = header + rows × rowHeight', () => {
    const t = buildBomTable(sampleRows);
    const m = tableMetrics(t);
    expect(m.totalHeightMm).toBe(DEFAULT_LAYOUT.headerHeightMm + 2 * DEFAULT_LAYOUT.rowHeightMm);
    expect(m.rowCount).toBe(2);
  });
});

describe('renderBomTableSvg', () => {
  it('emits frame + headers + data', () => {
    const t = buildBomTable(sampleRows);
    const prims = renderBomTableSvg(t, 0, 0);
    expect(prims.some(p => p.kind === 'rect')).toBe(true);
    const texts = prims.filter(p => p.kind === 'text');
    // 4 headers + 4 cells × 2 rows = 12 text nodes.
    expect(texts.length).toBe(4 + 4 * 2);
  });

  it('places primitives at origin offsets', () => {
    const t = buildBomTable(sampleRows);
    const prims = renderBomTableSvg(t, 10, 20);
    const frame = prims.find(p => p.kind === 'rect')!;
    expect(frame.attrs.x).toBe(10);
    expect(frame.attrs.y).toBe(20);
  });
});
