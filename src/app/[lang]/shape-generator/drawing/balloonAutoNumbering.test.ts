import { describe, it, expect } from 'vitest';
import {
  numberBalloons,
  labelFor,
  groupByPartNumber,
  summarize,
  type AssemblyItem,
} from './balloonAutoNumbering';

function item(id: string, pn: string, qty: number, x?: number, y?: number): AssemblyItem {
  const it: AssemblyItem = { instanceId: id, partNumber: pn, quantity: qty };
  if (x !== undefined && y !== undefined) it.centroid = { x, y };
  return it;
}

describe('numberBalloons', () => {
  it('empty input → empty result', () => {
    const r = numberBalloons([]);
    expect(r.numbers.size).toBe(0);
    expect(r.order).toEqual([]);
  });

  it('sequential preserves input order', () => {
    const items = [item('a', 'P1', 1), item('b', 'P2', 1), item('c', 'P3', 1)];
    const r = numberBalloons(items, { scheme: 'sequential' });
    expect(r.numbers.get('a')).toBe(1);
    expect(r.numbers.get('b')).toBe(2);
    expect(r.numbers.get('c')).toBe(3);
  });

  it('quantity-desc puts high-qty first', () => {
    const items = [item('a', 'P1', 2), item('b', 'P2', 10), item('c', 'P3', 5)];
    const r = numberBalloons(items, { scheme: 'quantity-desc' });
    expect(r.numbers.get('b')).toBe(1);
    expect(r.numbers.get('c')).toBe(2);
    expect(r.numbers.get('a')).toBe(3);
  });

  it('alphabetical sorts by part number', () => {
    const items = [item('a', 'Zebra', 1), item('b', 'Alpha', 1), item('c', 'Mango', 1)];
    const r = numberBalloons(items, { scheme: 'alphabetical' });
    expect(r.numbers.get('b')).toBe(1);
    expect(r.numbers.get('c')).toBe(2);
    expect(r.numbers.get('a')).toBe(3);
  });

  it('clockwise sorts by angle around centroid', () => {
    const items = [
      item('top', 'P', 1, 0, 10),
      item('right', 'P', 1, 10, 0),
      item('bottom', 'P', 1, 0, -10),
      item('left', 'P', 1, -10, 0),
    ];
    const r = numberBalloons(items, { scheme: 'clockwise' });
    // atan2 sorts: bottom (-π/2) → right (0) → top (π/2) → left (π).
    expect(r.order[0]).toBe('bottom');
    expect(r.order[3]).toBe('left');
  });

  it('startAt offsets numbering', () => {
    const items = [item('a', 'P1', 1)];
    const r = numberBalloons(items, { scheme: 'sequential', startAt: 100 });
    expect(r.numbers.get('a')).toBe(100);
  });

  it('skipNumbers reserves gaps', () => {
    const items = [item('a', 'P1', 1), item('b', 'P2', 1)];
    const r = numberBalloons(items, { scheme: 'sequential', skipNumbers: [1] });
    expect(r.numbers.get('a')).toBe(2);
    expect(r.numbers.get('b')).toBe(3);
  });

  it('records scheme in result', () => {
    const r = numberBalloons([item('a', 'P', 1)], { scheme: 'alphabetical' });
    expect(r.scheme).toBe('alphabetical');
  });
});

describe('labelFor', () => {
  it('numeric mode returns digits', () => {
    expect(labelFor(5)).toBe('5');
  });

  it('alpha mode: 1 → A', () => {
    expect(labelFor(1, 'alpha')).toBe('A');
  });

  it('alpha mode: 26 → Z', () => {
    expect(labelFor(26, 'alpha')).toBe('Z');
  });

  it('alpha mode: 27 → AA', () => {
    expect(labelFor(27, 'alpha')).toBe('AA');
  });

  it('alpha mode: 28 → AB', () => {
    expect(labelFor(28, 'alpha')).toBe('AB');
  });
});

describe('groupByPartNumber', () => {
  it('empty input → empty map', () => {
    expect(groupByPartNumber([]).size).toBe(0);
  });

  it('groups same partNumber instances', () => {
    const items = [item('a', 'P1', 1), item('b', 'P1', 1), item('c', 'P2', 1)];
    const map = groupByPartNumber(items);
    expect(map.size).toBe(2);
    expect(map.get('P1')).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = numberBalloons([]);
    const s = summarize(r);
    expect(s.itemCount).toBe(0);
    expect(s.maxNumber).toBe(0);
  });

  it('reports max number', () => {
    const r = numberBalloons([item('a', 'P', 1), item('b', 'P', 1)], { scheme: 'sequential' });
    const s = summarize(r);
    expect(s.maxNumber).toBe(2);
  });

  it('uniqueNumbers = unique count', () => {
    const r = numberBalloons([item('a', 'P', 1), item('b', 'P', 1)], { scheme: 'sequential' });
    const s = summarize(r);
    expect(s.uniqueNumbers).toBe(2);
  });

  it('skippedCount reported', () => {
    const r = numberBalloons([item('a', 'P', 1)], { skipNumbers: [1, 3] });
    const s = summarize(r, { skipNumbers: [1, 3] });
    expect(s.skippedCount).toBe(2);
  });
});
