import { describe, it, expect } from 'vitest';
import {
  parseCsvPaste,
  csvPointsToManualPoints,
  CSV_PASTE_MAX_POINTS,
} from '../csvPaste';

/**
 * CSV paste parser tests (W5 — Track C5). Covers delimiter precedence
 * (TAB → ';' → ','), malformed/empty/oversize input, error line-numbers,
 * bbox, and the manual-points adapter.
 */

describe('parseCsvPaste — valid input', () => {
  it('parses a 3-row comma CSV', () => {
    const out = parseCsvPaste('10, 20\n30, 40\n50, 60');
    expect(out.points).toHaveLength(3);
    expect(out.points.map((p) => [p.x, p.y])).toEqual([
      [10, 20], [30, 40], [50, 60],
    ]);
    expect(out.errors).toEqual([]);
    expect(out.delimiter).toBe(',');
  });

  it('parses tab-separated input (clipboard from Excel)', () => {
    const out = parseCsvPaste('10\t20\n30\t40');
    expect(out.points).toHaveLength(2);
    expect(out.delimiter).toBe('\t');
    expect(out.errors).toEqual([]);
  });

  it('parses semicolon-separated input (EU locale)', () => {
    const out = parseCsvPaste('10;20\n30;40');
    expect(out.points).toHaveLength(2);
    expect(out.delimiter).toBe(';');
  });

  it('TAB wins when both TAB and comma appear', () => {
    const out = parseCsvPaste('10\t20\n30,40');
    expect(out.delimiter).toBe('\t');
    // Comma-separated row stays as a single field after TAB split → malformed.
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it('reads optional diameter (3rd column)', () => {
    const out = parseCsvPaste('10, 20, 6\n30, 40');
    expect(out.points[0].diameter).toBe(6);
    expect(out.points[1].diameter).toBeUndefined();
  });

  it('reads optional label (4th column)', () => {
    const out = parseCsvPaste('10, 20, 5, A1\n30, 40, 5, A2');
    expect(out.points[0].label).toBe('A1');
    expect(out.points[1].label).toBe('A2');
  });

  it('skips empty lines', () => {
    const out = parseCsvPaste('10, 20\n\n30, 40\n   \n50, 60');
    expect(out.points).toHaveLength(3);
    // Line numbers preserved
    expect(out.points.map((p) => p.line)).toEqual([1, 3, 5]);
  });

  it('handles negative coordinates', () => {
    const out = parseCsvPaste('-10, -20\n0, 0\n10, 20');
    expect(out.points.map((p) => [p.x, p.y])).toEqual([
      [-10, -20], [0, 0], [10, 20],
    ]);
  });

  it('handles decimal coordinates', () => {
    const out = parseCsvPaste('1.5, 2.5\n3.25, 4.75');
    expect(out.points.map((p) => [p.x, p.y])).toEqual([
      [1.5, 2.5], [3.25, 4.75],
    ]);
  });

  it('computes bbox for parsed points', () => {
    const out = parseCsvPaste('10, 20\n5, 30\n15, 25');
    expect(out.bbox).toEqual({ minX: 5, maxX: 15, minY: 20, maxY: 30 });
  });

  it('bbox is null when no points parsed', () => {
    const out = parseCsvPaste('not, valid\nstill, bad');
    expect(out.bbox).toBeNull();
  });
});

describe('parseCsvPaste — errors', () => {
  it('flags EMPTY_INPUT on whitespace-only input', () => {
    const out = parseCsvPaste('   \n\n   ');
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].code).toBe('EMPTY_INPUT');
  });

  it('flags TOO_FEW_FIELDS with the source line number', () => {
    const out = parseCsvPaste('10\n20, 30');
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].code).toBe('TOO_FEW_FIELDS');
    expect(out.errors[0].line).toBe(1);
    // Second row still parses.
    expect(out.points).toHaveLength(1);
  });

  it('flags INVALID_NUMBER with the source line number', () => {
    const out = parseCsvPaste('10, 20\nfoo, bar\n30, 40');
    expect(out.errors.some((e) => e.code === 'INVALID_NUMBER')).toBe(true);
    const err = out.errors.find((e) => e.code === 'INVALID_NUMBER');
    expect(err?.line).toBe(2);
    expect(out.points).toHaveLength(2);
  });

  it('flags TOO_MANY_POINTS past the 500 cap', () => {
    const lines: string[] = [];
    for (let i = 0; i < CSV_PASTE_MAX_POINTS + 5; i++) {
      lines.push(`${i}, ${i}`);
    }
    const out = parseCsvPaste(lines.join('\n'));
    expect(out.points).toHaveLength(CSV_PASTE_MAX_POINTS);
    expect(out.errors.some((e) => e.code === 'TOO_MANY_POINTS')).toBe(true);
  });

  it('error line numbers stay 1-based even with leading blank lines', () => {
    const out = parseCsvPaste('\n\nfoo, bar');
    const err = out.errors.find((e) => e.code === 'INVALID_NUMBER');
    expect(err?.line).toBe(3);
  });
});

describe('csvPointsToManualPoints', () => {
  it('maps parsed points to manual ids + xy', () => {
    const out = parseCsvPaste('10, 20\n30, 40');
    const manual = csvPointsToManualPoints('arr-1', out.points);
    expect(manual).toEqual([
      { id: 'arr-1#csv-0', x: 10, y: 20 },
      { id: 'arr-1#csv-1', x: 30, y: 40 },
    ]);
  });

  it('uses label as id-suffix when present', () => {
    const out = parseCsvPaste('10, 20, 5, A1\n30, 40, 5, A2');
    const manual = csvPointsToManualPoints('arr-1', out.points);
    expect(manual[0].id).toBe('arr-1#csv-A1');
    expect(manual[1].id).toBe('arr-1#csv-A2');
  });
});
