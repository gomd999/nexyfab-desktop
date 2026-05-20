import { describe, it, expect } from 'vitest';
import {
  propagateECO,
  summarize,
  type BOMEdge,
  type ChangedPart,
  type CustomerOrder,
} from './ecoImpactPropagation';

function part(num: string, kind: ChangedPart['changeKind'] = 'price', costDeltaUsd: number = 0.5, reworkMin: number = 2): ChangedPart {
  return { partNumber: num, changeKind: kind, costDeltaUsd, reworkMin };
}

const edges: BOMEdge[] = [
  { parent: 'TOP', child: 'SUB-A', quantity: 1 },
  { parent: 'TOP', child: 'SUB-B', quantity: 1 },
  { parent: 'SUB-A', child: 'LEAF-1', quantity: 4 },
  { parent: 'SUB-A', child: 'LEAF-2', quantity: 2 },
  { parent: 'SUB-B', child: 'LEAF-2', quantity: 1 },
];

describe('propagateECO', () => {
  it('no edges → empty result', () => {
    const r = propagateECO(part('X'), []);
    expect(r.affectedAssemblies).toEqual([]);
    expect(r.totalCostImpactUsd).toBe(0);
  });

  it('leaf change reaches direct parent', () => {
    const r = propagateECO(part('LEAF-1', 'price', 0.5, 2), edges);
    const parts = r.affectedAssemblies.map(a => a.partNumber);
    expect(parts).toContain('SUB-A');
  });

  it('propagates up to top assembly', () => {
    const r = propagateECO(part('LEAF-1'), edges);
    expect(r.affectedAssemblies.map(a => a.partNumber)).toContain('TOP');
  });

  it('quantity scales cost impact', () => {
    // LEAF-1 used 4x in SUB-A; 1x SUB-A in TOP; total qty for TOP = 4.
    const r = propagateECO(part('LEAF-1', 'price', 1.0, 0), edges);
    const top = r.affectedAssemblies.find(a => a.partNumber === 'TOP');
    expect(top!.costDeltaUsd).toBe(4);
  });

  it('LEAF-2 shared by two sub-assemblies', () => {
    const r = propagateECO(part('LEAF-2'), edges);
    const subs = r.affectedAssemblies.filter(a => a.partNumber.startsWith('SUB'));
    expect(subs).toHaveLength(2);
  });

  it('depth increases up the tree', () => {
    const r = propagateECO(part('LEAF-1'), edges);
    const subA = r.affectedAssemblies.find(a => a.partNumber === 'SUB-A');
    const top = r.affectedAssemblies.find(a => a.partNumber === 'TOP');
    expect(top!.depth).toBeGreaterThan(subA!.depth);
  });

  it('obsolete change → critical severity', () => {
    const r = propagateECO(part('LEAF-1', 'obsolete'), edges);
    expect(r.worstSeverity).toBe('critical');
  });

  it('severityHint overrides auto', () => {
    const change = { ...part('LEAF-1'), severityHint: 'high' as const };
    const r = propagateECO(change, edges);
    expect(r.affectedAssemblies[0]!.severity).toBe('high');
  });

  it('shipped orders are not notified', () => {
    const orders: CustomerOrder[] = [
      { orderId: 'O1', customer: 'C', partNumber: 'TOP', quantity: 1, status: 'shipped' },
      { orderId: 'O2', customer: 'C', partNumber: 'TOP', quantity: 1, status: 'open' },
    ];
    const r = propagateECO(part('LEAF-1'), edges, orders);
    expect(r.notifications.map(n => n.orderId)).toEqual(['O2']);
  });

  it('notifications include severity + reason', () => {
    const orders: CustomerOrder[] = [
      { orderId: 'O1', customer: 'C', partNumber: 'TOP', quantity: 1, status: 'open' },
    ];
    const r = propagateECO(part('LEAF-1', 'material'), edges, orders);
    expect(r.notifications[0]!.reason).toContain('material');
    expect(r.notifications[0]!.severity).toBeDefined();
  });

  it('total cost impact = sum of affected costs', () => {
    const r = propagateECO(part('LEAF-1', 'price', 1.0, 0), edges);
    const sum = r.affectedAssemblies.reduce((s, a) => s + a.costDeltaUsd, 0);
    expect(r.totalCostImpactUsd).toBeCloseTo(sum, 5);
  });

  it('total rework hours = sum / 60', () => {
    const r = propagateECO(part('LEAF-1', 'material', 0, 60), edges);
    const sumMin = r.affectedAssemblies.reduce((s, a) => s + a.reworkMin, 0);
    expect(r.totalReworkHours).toBeCloseTo(sumMin / 60, 5);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({ affectedAssemblies: [], notifications: [], totalCostImpactUsd: 0, totalReworkHours: 0, worstSeverity: 'low' });
    expect(s.affectedCount).toBe(0);
    expect(s.needsCustomerNotification).toBe(false);
  });

  it('reports affectedCount and notificationCount', () => {
    const orders: CustomerOrder[] = [
      { orderId: 'O1', customer: 'C', partNumber: 'TOP', quantity: 1, status: 'open' },
    ];
    const r = propagateECO(part('LEAF-1'), edges, orders);
    const s = summarize(r);
    expect(s.affectedCount).toBe(r.affectedAssemblies.length);
    expect(s.notificationCount).toBe(1);
  });

  it('worstSeverity reflects highest in list', () => {
    const r = propagateECO(part('LEAF-1', 'obsolete'), edges);
    const s = summarize(r);
    expect(s.worstSeverity).toBe('critical');
  });
});
