/**
 * ecoImpactPropagation.ts — Propagate ECO (Engineering Change Order)
 * impact through a BOM hierarchy.
 *
 * When a leaf part changes (price / material / dimension), all
 * sub-assemblies and assemblies containing it inherit some level
 * of impact: rework, requalification, customer notification. This
 * module walks the where-used graph and produces:
 *
 *   - Affected assembly list.
 *   - Per-assembly impact score (additive across descendants).
 *   - Cost / time impact rollup.
 *   - Notification list (which customers / open orders should
 *     receive an ECN).
 */

export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ChangedPart {
  partNumber: string;
  /** Type of change. */
  changeKind: 'price' | 'material' | 'dimension' | 'manufacturer' | 'obsolete';
  /** Cost delta per unit, USD. */
  costDeltaUsd: number;
  /** Rework time per unit, minutes. */
  reworkMin: number;
  /** Optional impact severity hint. */
  severityHint?: ImpactSeverity;
}

export interface BOMEdge {
  /** Parent assembly part number. */
  parent: string;
  /** Child part number. */
  child: string;
  /** Quantity of child in parent. */
  quantity: number;
}

export interface AffectedAssembly {
  partNumber: string;
  /** Walking depth from the leaf change (0 = direct parent). */
  depth: number;
  /** Aggregated cost delta, USD. */
  costDeltaUsd: number;
  /** Aggregated rework time, min. */
  reworkMin: number;
  /** Effective quantity multiplier. */
  totalQuantityImpacted: number;
  severity: ImpactSeverity;
}

export interface CustomerOrder {
  /** Order id. */
  orderId: string;
  /** Customer name. */
  customer: string;
  /** Part number ordered (typically a top-level assembly). */
  partNumber: string;
  /** Order quantity. */
  quantity: number;
  /** Order status. */
  status: 'open' | 'in-production' | 'shipped';
}

export interface NotificationItem {
  orderId: string;
  customer: string;
  affectedAssembly: string;
  severity: ImpactSeverity;
  reason: string;
}

export interface PropagationResult {
  affectedAssemblies: AffectedAssembly[];
  notifications: NotificationItem[];
  totalCostImpactUsd: number;
  totalReworkHours: number;
  worstSeverity: ImpactSeverity;
}

// ── Top-level entry ────────────────────────────────────────────

export function propagateECO(
  change: ChangedPart,
  edges: BOMEdge[],
  orders: CustomerOrder[] = [],
): PropagationResult {
  // Build parent map: child → list of (parent, qty).
  const parentMap = new Map<string, Array<{ parent: string; quantity: number }>>();
  for (const e of edges) {
    const list = parentMap.get(e.child) ?? [];
    list.push({ parent: e.parent, quantity: e.quantity });
    parentMap.set(e.child, list);
  }

  const affected = new Map<string, AffectedAssembly>();
  // BFS up the BOM tree.
  const queue: Array<{ part: string; depth: number; qty: number }> = [];
  for (const link of parentMap.get(change.partNumber) ?? []) {
    queue.push({ part: link.parent, depth: 0, qty: link.quantity });
  }
  while (queue.length > 0) {
    const { part, depth, qty } = queue.shift()!;
    const existing = affected.get(part);
    if (existing) {
      existing.totalQuantityImpacted += qty;
      existing.costDeltaUsd = qty * change.costDeltaUsd + existing.costDeltaUsd;
      existing.reworkMin = qty * change.reworkMin + existing.reworkMin;
    } else {
      affected.set(part, {
        partNumber: part,
        depth,
        costDeltaUsd: qty * change.costDeltaUsd,
        reworkMin: qty * change.reworkMin,
        totalQuantityImpacted: qty,
        severity: computeSeverity(change, qty, depth),
      });
    }
    for (const link of parentMap.get(part) ?? []) {
      queue.push({ part: link.parent, depth: depth + 1, qty: qty * link.quantity });
    }
  }

  const affectedList = [...affected.values()].sort((a, b) => a.depth - b.depth);

  // Notifications based on open orders touching affected assemblies.
  const affectedSet = new Set([change.partNumber, ...affectedList.map(a => a.partNumber)]);
  const notifications: NotificationItem[] = [];
  for (const order of orders) {
    if (!affectedSet.has(order.partNumber)) continue;
    if (order.status === 'shipped') continue;
    const aff = affectedList.find(a => a.partNumber === order.partNumber);
    notifications.push({
      orderId: order.orderId,
      customer: order.customer,
      affectedAssembly: order.partNumber,
      severity: aff?.severity ?? computeSeverity(change, order.quantity, 0),
      reason: `${change.changeKind} change on ${change.partNumber}`,
    });
  }

  const totalCost = affectedList.reduce((s, a) => s + a.costDeltaUsd, 0);
  const totalRework = affectedList.reduce((s, a) => s + a.reworkMin, 0) / 60;
  const worst = worstSeverity(affectedList.map(a => a.severity));

  return {
    affectedAssemblies: affectedList,
    notifications,
    totalCostImpactUsd: totalCost,
    totalReworkHours: totalRework,
    worstSeverity: worst,
  };
}

// ── Severity classification ───────────────────────────────────

function computeSeverity(change: ChangedPart, qty: number, depth: number): ImpactSeverity {
  if (change.severityHint) return change.severityHint;
  if (change.changeKind === 'obsolete') return 'critical';
  const absCost = Math.abs(change.costDeltaUsd * qty);
  if (absCost > 1000) return 'high';
  if (absCost > 100) return 'medium';
  if (depth > 3) return 'low';
  return 'low';
}

const SEVERITY_RANK: Record<ImpactSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function worstSeverity(list: ImpactSeverity[]): ImpactSeverity {
  let best: ImpactSeverity = 'low';
  for (const s of list) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  }
  return best;
}

// ── Summary ────────────────────────────────────────────────────

export interface ImpactSummary {
  affectedCount: number;
  notificationCount: number;
  totalCostImpactUsd: number;
  totalReworkHours: number;
  worstSeverity: ImpactSeverity;
  needsCustomerNotification: boolean;
}

export function summarize(result: PropagationResult): ImpactSummary {
  return {
    affectedCount: result.affectedAssemblies.length,
    notificationCount: result.notifications.length,
    totalCostImpactUsd: result.totalCostImpactUsd,
    totalReworkHours: result.totalReworkHours,
    worstSeverity: result.worstSeverity,
    needsCustomerNotification: result.notifications.length > 0,
  };
}
