import { describe, it, expect } from 'vitest';
import {
  rollupFlat,
  rollupStructured,
  whereUsed,
  diff,
  summarize,
  type BomNode,
} from './bomRollupPhantom';

function part(id: string, pn: string, qty: number = 1): BomNode {
  return { id, partNumber: pn, description: pn, kind: 'part', quantity: qty, children: [] };
}

function asm(id: string, pn: string, qty: number, children: BomNode[]): BomNode {
  return { id, partNumber: pn, description: pn, kind: 'assembly', quantity: qty, children };
}

function phantom(id: string, pn: string, qty: number, children: BomNode[]): BomNode {
  return { id, partNumber: pn, description: pn, kind: 'phantom-assembly', quantity: qty, children };
}

describe('rollupFlat', () => {
  it('single part → 1 row', () => {
    const rows = rollupFlat(part('p1', 'PN-1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalQuantity).toBe(1);
  });

  it('assembly with 2 parts × 3 → quantities 3 each', () => {
    const root = asm('a1', 'ASM-1', 1, [part('p1', 'PN-1', 3), part('p2', 'PN-2', 3)]);
    const rows = rollupFlat(root);
    expect(rows.find(r => r.partNumber === 'PN-1')!.totalQuantity).toBe(3);
  });

  it('phantom assembly flattens children', () => {
    const root = phantom('ph1', 'PHANTOM', 1, [part('p1', 'PN-1', 5)]);
    const rows = rollupFlat(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partNumber).toBe('PN-1');
    expect(rows[0]!.totalQuantity).toBe(5);
  });

  it('non-phantom assembly produces both itself and children in flat BOM', () => {
    const root = asm('a1', 'ASM-1', 1, [part('p1', 'PN-1', 2)]);
    const rows = rollupFlat(root);
    expect(rows).toHaveLength(2);
  });

  it('quantity multiplies through assemblies', () => {
    const sub = asm('a2', 'SUB', 2, [part('p1', 'PN-1', 3)]);
    const root = asm('a1', 'TOP', 1, [sub]);
    const rows = rollupFlat(root);
    expect(rows.find(r => r.partNumber === 'PN-1')!.totalQuantity).toBe(6);
  });

  it('same part referenced twice → quantities sum', () => {
    const root = asm('a1', 'TOP', 1, [
      part('p1a', 'PN-1', 2),
      part('p1b', 'PN-1', 3),
    ]);
    const rows = rollupFlat(root);
    expect(rows.find(r => r.partNumber === 'PN-1')!.totalQuantity).toBe(5);
  });
});

describe('rollupStructured', () => {
  it('produces row per node with depth', () => {
    const sub = asm('a2', 'SUB', 1, [part('p1', 'PN-1', 1)]);
    const root = asm('a1', 'TOP', 1, [sub]);
    const rows = rollupStructured(root);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.depth).toBe(0);
    expect(rows[2]!.depth).toBe(2);
  });

  it('phantom children are flagged hidden', () => {
    const root = phantom('ph1', 'PH', 1, [part('p1', 'PN-1', 1)]);
    const rows = rollupStructured(root);
    expect(rows[1]!.hidden).toBe(true);
  });

  it('non-phantom children are visible', () => {
    const root = asm('a1', 'TOP', 1, [part('p1', 'PN-1', 1)]);
    const rows = rollupStructured(root);
    expect(rows[1]!.hidden).toBe(false);
  });
});

describe('whereUsed', () => {
  it('finds direct parent', () => {
    const root = asm('a1', 'TOP', 1, [part('p1', 'PN-X', 1)]);
    const usage = whereUsed(root, 'PN-X');
    expect(usage).toHaveLength(1);
    expect(usage[0]!.parentPartNumber).toBe('TOP');
  });

  it('reports path', () => {
    const sub = asm('a2', 'SUB', 1, [part('p1', 'PN-X', 1)]);
    const root = asm('a1', 'TOP', 1, [sub]);
    const usage = whereUsed(root, 'PN-X');
    expect(usage[0]!.path).toEqual(['TOP', 'SUB']);
  });

  it('empty if not found', () => {
    const root = asm('a1', 'TOP', 1, [part('p1', 'PN-1', 1)]);
    expect(whereUsed(root, 'PN-X')).toEqual([]);
  });
});

describe('diff', () => {
  it('detects added parts', () => {
    const oldB = rollupFlat(asm('a', 'TOP', 1, [part('p1', 'PN-1')]));
    const newB = rollupFlat(asm('a', 'TOP', 1, [part('p1', 'PN-1'), part('p2', 'PN-2')]));
    expect(diff(oldB, newB).added).toEqual(['PN-2']);
  });

  it('detects removed parts', () => {
    const oldB = rollupFlat(asm('a', 'TOP', 1, [part('p1', 'PN-1'), part('p2', 'PN-2')]));
    const newB = rollupFlat(asm('a', 'TOP', 1, [part('p1', 'PN-1')]));
    expect(diff(oldB, newB).removed).toEqual(['PN-2']);
  });

  it('detects quantity changes', () => {
    const oldB = rollupFlat(asm('a', 'TOP', 1, [part('p1', 'PN-1', 1)]));
    const newB = rollupFlat(asm('a', 'TOP', 1, [part('p1', 'PN-1', 3)]));
    expect(diff(oldB, newB).quantityChanged).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('reports unique part + phantom count', () => {
    const root = phantom('ph', 'PH', 1, [part('p1', 'PN-1', 1), part('p2', 'PN-2', 1)]);
    const flat = rollupFlat(root);
    const s = summarize(root, flat);
    expect(s.uniquePartCount).toBe(2);
    expect(s.phantomCount).toBe(1);
  });
});
