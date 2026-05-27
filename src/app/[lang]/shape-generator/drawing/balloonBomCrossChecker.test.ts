import { describe, it, expect } from 'vitest';
import {
  crossCheck,
  suggestFixes,
  stats,
  summarize,
  type Balloon,
  type BomRow,
} from './balloonBomCrossChecker';

function bal(id: string, item: number, qty?: number): Balloon {
  return qty !== undefined ? { id, itemNumber: item, shownQuantity: qty } : { id, itemNumber: item };
}

function row(item: number, pn: string, qty: number, optional: boolean = false): BomRow {
  return optional ? { itemNumber: item, partNumber: pn, quantity: qty, optional } : { itemNumber: item, partNumber: pn, quantity: qty };
}

describe('crossCheck', () => {
  it('empty inputs → ok', () => {
    const r = crossCheck([], []);
    expect(r.ok).toBe(true);
  });

  it('matched balloon → no issue', () => {
    const r = crossCheck([bal('b1', 1)], [row(1, 'PN-1', 1)]);
    expect(r.issues).toEqual([]);
  });

  it('balloon to unknown row → error', () => {
    const r = crossCheck([bal('b1', 99)], [row(1, 'PN-1', 1)]);
    expect(r.issues.some(i => i.kind === 'balloon-unknown-row')).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('orphan BOM row → warn', () => {
    const r = crossCheck([], [row(1, 'PN-1', 1)]);
    expect(r.issues.some(i => i.kind === 'orphan-row')).toBe(true);
  });

  it('optional row is not flagged as orphan', () => {
    const r = crossCheck([], [row(1, 'PN-1', 1, true)]);
    expect(r.issues.some(i => i.kind === 'orphan-row')).toBe(false);
  });

  it('duplicate balloon → error', () => {
    const r = crossCheck([bal('b1', 1), bal('b2', 1)], [row(1, 'PN-1', 1)]);
    const dupes = r.issues.filter(i => i.kind === 'duplicate-balloon');
    expect(dupes.length).toBeGreaterThan(0);
  });

  it('qty mismatch → warn', () => {
    const r = crossCheck([bal('b1', 1, 3)], [row(1, 'PN-1', 2)]);
    expect(r.issues.some(i => i.kind === 'qty-mismatch')).toBe(true);
  });

  it('multiple balloon to row → no orphan', () => {
    const r = crossCheck([bal('b1', 1), bal('b2', 2)], [row(1, 'PN-1', 1), row(2, 'PN-2', 1)]);
    expect(r.issues.filter(i => i.kind === 'orphan-row')).toEqual([]);
  });

  it('errors set ok = false', () => {
    const r = crossCheck([bal('b1', 1), bal('b2', 1)], [row(1, 'PN-1', 1)]);
    expect(r.ok).toBe(false);
  });
});

describe('suggestFixes', () => {
  it('proposes rowsToAdd for unknown balloons', () => {
    const balloons = [bal('b1', 99)];
    const rows = [row(1, 'PN-1', 1)];
    const r = crossCheck(balloons, rows);
    const fix = suggestFixes(r, balloons, rows);
    expect(fix.rowsToAdd.some(x => x.itemNumber === 99)).toBe(true);
  });

  it('proposes rowsToRemove for orphans', () => {
    const balloons: Balloon[] = [];
    const rows = [row(1, 'PN-1', 1)];
    const r = crossCheck(balloons, rows);
    const fix = suggestFixes(r, balloons, rows);
    expect(fix.rowsToRemove).toContain(1);
  });

  it('renumbers duplicate balloons', () => {
    const balloons = [bal('b1', 1), bal('b2', 1)];
    const rows = [row(1, 'PN-1', 1)];
    const r = crossCheck(balloons, rows);
    const fix = suggestFixes(r, balloons, rows);
    expect(fix.balloonsToRenumber).toHaveLength(1);
  });
});

describe('stats', () => {
  it('reports error and warn counts', () => {
    const balloons = [bal('b1', 99)];
    const rows = [row(1, 'PN-1', 1)];
    const r = crossCheck(balloons, rows);
    const s = stats(r, balloons, rows);
    expect(s.errorCount).toBeGreaterThan(0);
  });

  it('balloonCount + rowCount reported', () => {
    const s = stats(crossCheck([bal('b1', 1)], [row(1, 'A', 1)]), [bal('b1', 1)], [row(1, 'A', 1)]);
    expect(s.balloonCount).toBe(1);
    expect(s.rowCount).toBe(1);
  });
});

describe('summarize', () => {
  it('counts matched balloons', () => {
    const balloons = [bal('b1', 1), bal('b2', 2)];
    const rows = [row(1, 'PN-1', 1), row(2, 'PN-2', 1)];
    const s = summarize(crossCheck(balloons, rows), balloons);
    expect(s.matchedCount).toBe(2);
    expect(s.ok).toBe(true);
  });

  it('erroneous balloons excluded from matched', () => {
    const balloons = [bal('b1', 99)];
    const rows = [row(1, 'PN-1', 1)];
    const s = summarize(crossCheck(balloons, rows), balloons);
    expect(s.matchedCount).toBe(0);
  });
});
