/**
 * bomRevisionTracker.ts — BOM revision tracking + ECO impact.
 *
 * Manufacturing parts evolve: bolt M5×16 → M5×18, plastic ABS → PC,
 * paint code 7042 → 7044. Each change is an ECO (engineering change
 * order) that propagates through the BOM. This module:
 *
 *   - Stores BOM **revisions** with monotonic version numbers.
 *   - **Diffs** two revisions: added/removed/modified line items.
 *   - **Impact analysis**: which assemblies / customers / open orders
 *     are affected by an ECO.
 *   - **Audit trail**: who approved which ECO when.
 */

export interface BomLineItem {
  /** Part number. */
  partNumber: string;
  /** Quantity (units). */
  quantity: number;
  /** Unit of measure. */
  uom: string;
  /** Part name. */
  name?: string;
  /** Effective revision range (inclusive). */
  effectiveFromRevision?: number;
  effectiveToRevision?: number;
  /** Cost per unit (USD). */
  costUsd?: number;
}

export interface BomRevision {
  /** Monotonic version number. */
  version: number;
  /** ISO timestamp of approval. */
  approvedAtMs: number;
  /** Approver user id / email. */
  approvedBy: string;
  /** ECO reference. */
  ecoId: string;
  /** Comment / notes. */
  notes?: string;
  /** Line items at this revision. */
  items: BomLineItem[];
}

export interface Bom {
  /** Assembly id this BOM belongs to. */
  assemblyId: string;
  /** Revisions in chronological order. */
  revisions: BomRevision[];
}

// ── Revision management ───────────────────────────────────────

export function createBom(assemblyId: string): Bom {
  return { assemblyId, revisions: [] };
}

export function addRevision(bom: Bom, rev: Omit<BomRevision, 'version'>): BomRevision {
  const version = (bom.revisions[bom.revisions.length - 1]?.version ?? 0) + 1;
  const stamped: BomRevision = { ...rev, version };
  bom.revisions.push(stamped);
  return stamped;
}

export function latestRevision(bom: Bom): BomRevision | null {
  return bom.revisions[bom.revisions.length - 1] ?? null;
}

export function getRevision(bom: Bom, version: number): BomRevision | null {
  return bom.revisions.find(r => r.version === version) ?? null;
}

// ── Diff between revisions ─────────────────────────────────────

export interface BomDiff {
  /** Items added in `to` revision. */
  added: BomLineItem[];
  /** Items removed in `to` revision. */
  removed: BomLineItem[];
  /** Items with changed properties. */
  modified: Array<{ before: BomLineItem; after: BomLineItem; changedFields: string[] }>;
  /** Cost delta (sum of (qty × cost) diffs). */
  costDeltaUsd: number;
}

export function diffRevisions(from: BomRevision, to: BomRevision): BomDiff {
  const fromMap = new Map(from.items.map(i => [i.partNumber, i]));
  const toMap = new Map(to.items.map(i => [i.partNumber, i]));
  const added: BomLineItem[] = [];
  const removed: BomLineItem[] = [];
  const modified: BomDiff['modified'] = [];
  let costFrom = 0, costTo = 0;
  for (const item of from.items) costFrom += (item.costUsd ?? 0) * item.quantity;
  for (const item of to.items) costTo += (item.costUsd ?? 0) * item.quantity;

  for (const item of to.items) {
    const prev = fromMap.get(item.partNumber);
    if (!prev) added.push(item);
    else {
      const changes: string[] = [];
      if (prev.quantity !== item.quantity) changes.push('quantity');
      if (prev.uom !== item.uom) changes.push('uom');
      if (prev.name !== item.name) changes.push('name');
      if (prev.costUsd !== item.costUsd) changes.push('costUsd');
      if (changes.length > 0) modified.push({ before: prev, after: item, changedFields: changes });
    }
  }
  for (const item of from.items) {
    if (!toMap.has(item.partNumber)) removed.push(item);
  }
  return {
    added,
    removed,
    modified,
    costDeltaUsd: costTo - costFrom,
  };
}

// ── ECO impact analysis ───────────────────────────────────────

export interface ImpactScope {
  /** Open orders that reference an affected part. */
  affectedOrderIds: string[];
  /** Sub-assemblies that consume an affected part. */
  affectedAssemblyIds: string[];
  /** Number of in-flight units (per part). */
  inFlightUnits: Record<string, number>;
}

export interface OpenOrder {
  id: string;
  assemblyId: string;
  /** Units pending. */
  pendingUnits: number;
  /** Part numbers consumed by this order (from BOM expansion). */
  partsConsumed: string[];
}

export function analyzeImpact(diff: BomDiff, openOrders: OpenOrder[]): ImpactScope {
  const affectedParts = new Set<string>();
  for (const item of diff.added) affectedParts.add(item.partNumber);
  for (const item of diff.removed) affectedParts.add(item.partNumber);
  for (const change of diff.modified) affectedParts.add(change.after.partNumber);
  const affectedOrderIds: string[] = [];
  const affectedAssemblyIds = new Set<string>();
  const inFlight: Record<string, number> = {};
  for (const order of openOrders) {
    const intersect = order.partsConsumed.some(p => affectedParts.has(p));
    if (intersect) {
      affectedOrderIds.push(order.id);
      affectedAssemblyIds.add(order.assemblyId);
      for (const part of order.partsConsumed) {
        if (affectedParts.has(part)) {
          inFlight[part] = (inFlight[part] ?? 0) + order.pendingUnits;
        }
      }
    }
  }
  return {
    affectedOrderIds,
    affectedAssemblyIds: [...affectedAssemblyIds],
    inFlightUnits: inFlight,
  };
}

// ── Audit trail ───────────────────────────────────────────────

export interface AuditEntry {
  version: number;
  approvedAtMs: number;
  approvedBy: string;
  ecoId: string;
  /** Counts from the diff vs previous. */
  added: number;
  removed: number;
  modified: number;
  costDeltaUsd: number;
}

export function buildAuditTrail(bom: Bom): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (let i = 0; i < bom.revisions.length; i++) {
    const cur = bom.revisions[i]!;
    if (i === 0) {
      entries.push({
        version: cur.version,
        approvedAtMs: cur.approvedAtMs,
        approvedBy: cur.approvedBy,
        ecoId: cur.ecoId,
        added: cur.items.length,
        removed: 0,
        modified: 0,
        costDeltaUsd: cur.items.reduce((s, item) => s + (item.costUsd ?? 0) * item.quantity, 0),
      });
    } else {
      const prev = bom.revisions[i - 1]!;
      const d = diffRevisions(prev, cur);
      entries.push({
        version: cur.version,
        approvedAtMs: cur.approvedAtMs,
        approvedBy: cur.approvedBy,
        ecoId: cur.ecoId,
        added: d.added.length,
        removed: d.removed.length,
        modified: d.modified.length,
        costDeltaUsd: d.costDeltaUsd,
      });
    }
  }
  return entries;
}

// ── Effective-revision lookup ─────────────────────────────────

/** Resolve which BOM is in effect at the given timestamp. */
export function bomAt(bom: Bom, timeMs: number): BomRevision | null {
  let result: BomRevision | null = null;
  for (const r of bom.revisions) {
    if (r.approvedAtMs <= timeMs) result = r;
    else break;
  }
  return result;
}

// ── Stats ─────────────────────────────────────────────────────

export interface BomStats {
  revisionCount: number;
  currentItemCount: number;
  totalCostUsd: number;
  lastApprovedAtMs: number | null;
}

export function summarize(bom: Bom): BomStats {
  const last = latestRevision(bom);
  if (!last) {
    return { revisionCount: 0, currentItemCount: 0, totalCostUsd: 0, lastApprovedAtMs: null };
  }
  const totalCost = last.items.reduce((s, item) => s + (item.costUsd ?? 0) * item.quantity, 0);
  return {
    revisionCount: bom.revisions.length,
    currentItemCount: last.items.length,
    totalCostUsd: totalCost,
    lastApprovedAtMs: last.approvedAtMs,
  };
}
