import { describe, it, expect } from 'vitest';
import {
  generateStockProbe,
  compareStock,
  diagnose,
  summarize,
  type StockEnvelope,
  type MeasuredStock,
} from './stockProbeMacro';

const stock: StockEnvelope = { approxLengthMm: 100, approxWidthMm: 50, approxHeightMm: 25 };

describe('generateStockProbe', () => {
  it('invalid stock → warning + empty', () => {
    const r = generateStockProbe({ approxLengthMm: 0, approxWidthMm: 0, approxHeightMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.gcode).toEqual([]);
  });

  it('emits probe macros', () => {
    const r = generateStockProbe(stock);
    expect(r.gcode.some(l => l.includes('G65 P9811'))).toBe(true);
  });

  it('WCS update emitted', () => {
    const r = generateStockProbe(stock, { wcsOffset: 'G55', approachFeed: 1000, touchFeed: 100, measureSquareness: false });
    expect(r.gcode.some(l => l.includes('G10 L20 P2'))).toBe(true);
  });

  it('squareness probe added when requested', () => {
    const r = generateStockProbe(stock, { wcsOffset: 'G54', approachFeed: 1000, touchFeed: 100, measureSquareness: true });
    expect(r.gcode.some(l => l.includes('G65 P9815'))).toBe(true);
  });

  it('result vars populated', () => {
    const r = generateStockProbe(stock);
    expect(r.resultVars.length).toBeGreaterThan(0);
  });

  it('estimated time positive', () => {
    const r = generateStockProbe(stock);
    expect(r.estimatedTimeSec).toBeGreaterThan(0);
  });

  it('measureSquareness adds time', () => {
    const without = generateStockProbe(stock, { wcsOffset: 'G54', approachFeed: 1000, touchFeed: 100, measureSquareness: false });
    const withSquare = generateStockProbe(stock, { wcsOffset: 'G54', approachFeed: 1000, touchFeed: 100, measureSquareness: true });
    expect(withSquare.estimatedTimeSec).toBeGreaterThan(without.estimatedTimeSec);
  });
});

describe('compareStock', () => {
  it('within tolerance → ok', () => {
    const measured: MeasuredStock = { measuredLengthMm: 100.5, measuredWidthMm: 50, measuredHeightMm: 25 };
    const r = compareStock(stock, measured, 2);
    expect(r.withinExpected).toBe(true);
  });

  it('out of tolerance → not ok', () => {
    const measured: MeasuredStock = { measuredLengthMm: 110, measuredWidthMm: 50, measuredHeightMm: 25 };
    expect(compareStock(stock, measured, 2).withinExpected).toBe(false);
  });

  it('deltas signed', () => {
    const measured: MeasuredStock = { measuredLengthMm: 95, measuredWidthMm: 50, measuredHeightMm: 25 };
    expect(compareStock(stock, measured).lengthDeltaMm).toBe(-5);
  });
});

describe('diagnose', () => {
  it('reports line count', () => {
    const r = generateStockProbe(stock);
    expect(diagnose(r).lineCount).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports key metrics', () => {
    const r = generateStockProbe(stock);
    const s = summarize(r);
    expect(s.lineCount).toBe(r.gcode.length);
    expect(s.estimatedTimeSec).toBe(r.estimatedTimeSec);
  });
});
