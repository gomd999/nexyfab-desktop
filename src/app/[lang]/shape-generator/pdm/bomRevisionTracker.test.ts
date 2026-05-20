import { describe, it, expect } from 'vitest';
import {
  createBom,
  addRevision,
  latestRevision,
  getRevision,
  diffRevisions,
  analyzeImpact,
  buildAuditTrail,
  bomAt,
  summarize,
  type BomLineItem,
  type OpenOrder,
} from './bomRevisionTracker';

function item(part: string, qty: number, cost: number = 1): BomLineItem {
  return { partNumber: part, quantity: qty, uom: 'EA', costUsd: cost };
}

describe('BOM management', () => {
  it('addRevision auto-versions', () => {
    const bom = createBom('asm-1');
    const r = addRevision(bom, { approvedAtMs: 1000, approvedBy: 'alice', ecoId: 'ECO-1', items: [item('A', 1)] });
    expect(r.version).toBe(1);
    expect(latestRevision(bom)).toBe(r);
  });

  it('subsequent revisions increment', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 1000, approvedBy: 'alice', ecoId: 'ECO-1', items: [] });
    const r2 = addRevision(bom, { approvedAtMs: 2000, approvedBy: 'bob', ecoId: 'ECO-2', items: [] });
    expect(r2.version).toBe(2);
  });

  it('getRevision by version', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 1000, approvedBy: 'alice', ecoId: 'ECO-1', items: [] });
    expect(getRevision(bom, 1)?.ecoId).toBe('ECO-1');
    expect(getRevision(bom, 99)).toBeNull();
  });
});

describe('diffRevisions', () => {
  it('detects added items', () => {
    const r1 = { version: 1, approvedAtMs: 0, approvedBy: 'a', ecoId: 'E1', items: [item('A', 1)] };
    const r2 = { version: 2, approvedAtMs: 1, approvedBy: 'b', ecoId: 'E2', items: [item('A', 1), item('B', 2)] };
    const d = diffRevisions(r1, r2);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.partNumber).toBe('B');
  });

  it('detects removed items', () => {
    const r1 = { version: 1, approvedAtMs: 0, approvedBy: 'a', ecoId: 'E1', items: [item('A', 1), item('B', 1)] };
    const r2 = { version: 2, approvedAtMs: 1, approvedBy: 'b', ecoId: 'E2', items: [item('A', 1)] };
    const d = diffRevisions(r1, r2);
    expect(d.removed.map(x => x.partNumber)).toEqual(['B']);
  });

  it('detects modified quantity', () => {
    const r1 = { version: 1, approvedAtMs: 0, approvedBy: 'a', ecoId: 'E1', items: [item('A', 1)] };
    const r2 = { version: 2, approvedAtMs: 1, approvedBy: 'b', ecoId: 'E2', items: [item('A', 5)] };
    const d = diffRevisions(r1, r2);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]!.changedFields).toContain('quantity');
  });

  it('cost delta reflects price change', () => {
    const r1 = { version: 1, approvedAtMs: 0, approvedBy: 'a', ecoId: 'E1', items: [item('A', 2, 10)] };
    const r2 = { version: 2, approvedAtMs: 1, approvedBy: 'b', ecoId: 'E2', items: [item('A', 2, 15)] };
    const d = diffRevisions(r1, r2);
    expect(d.costDeltaUsd).toBe(10); // (2 × 15) - (2 × 10)
  });
});

describe('analyzeImpact', () => {
  it('orders referencing changed parts are flagged', () => {
    const diff = {
      added: [], removed: [], costDeltaUsd: 0,
      modified: [{ before: item('A', 1), after: item('A', 2), changedFields: ['quantity'] }],
    };
    const orders: OpenOrder[] = [
      { id: 'O1', assemblyId: 'asm-1', pendingUnits: 10, partsConsumed: ['A', 'X'] },
      { id: 'O2', assemblyId: 'asm-2', pendingUnits: 5, partsConsumed: ['Y'] },
    ];
    const impact = analyzeImpact(diff, orders);
    expect(impact.affectedOrderIds).toContain('O1');
    expect(impact.affectedOrderIds).not.toContain('O2');
    expect(impact.inFlightUnits.A).toBe(10);
  });

  it('no changes → no impact', () => {
    const impact = analyzeImpact({ added: [], removed: [], modified: [], costDeltaUsd: 0 }, [
      { id: 'O1', assemblyId: 'asm-1', pendingUnits: 10, partsConsumed: ['A'] },
    ]);
    expect(impact.affectedOrderIds).toHaveLength(0);
  });
});

describe('buildAuditTrail', () => {
  it('first revision shows all items as added', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 1000, approvedBy: 'a', ecoId: 'E1', items: [item('A', 1), item('B', 1)] });
    const trail = buildAuditTrail(bom);
    expect(trail[0]!.added).toBe(2);
  });

  it('subsequent revision uses diff counts', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 1000, approvedBy: 'a', ecoId: 'E1', items: [item('A', 1)] });
    addRevision(bom, { approvedAtMs: 2000, approvedBy: 'b', ecoId: 'E2', items: [item('A', 1), item('B', 2)] });
    const trail = buildAuditTrail(bom);
    expect(trail[1]!.added).toBe(1);
  });
});

describe('bomAt', () => {
  it('returns null before first revision', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 5000, approvedBy: 'a', ecoId: 'E', items: [] });
    expect(bomAt(bom, 1000)).toBeNull();
  });

  it('returns latest revision at-or-before timestamp', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 1000, approvedBy: 'a', ecoId: 'E1', items: [] });
    addRevision(bom, { approvedAtMs: 5000, approvedBy: 'b', ecoId: 'E2', items: [] });
    expect(bomAt(bom, 3000)?.ecoId).toBe('E1');
    expect(bomAt(bom, 6000)?.ecoId).toBe('E2');
  });
});

describe('summarize', () => {
  it('empty BOM returns zero', () => {
    const s = summarize(createBom('asm-1'));
    expect(s.revisionCount).toBe(0);
  });

  it('totalCost = sum(qty × cost) of latest revision', () => {
    const bom = createBom('asm-1');
    addRevision(bom, { approvedAtMs: 0, approvedBy: 'a', ecoId: 'E', items: [item('A', 2, 5), item('B', 1, 10)] });
    expect(summarize(bom).totalCostUsd).toBe(20);
  });
});
