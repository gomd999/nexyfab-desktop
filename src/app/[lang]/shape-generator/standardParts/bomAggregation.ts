/**
 * bomAggregation.ts — Roll up standard-part instances into BOM rows.
 *
 * The assembly tree stores per-instance entries ("bolt at position
 * X1, bolt at position X2, ..."). The Bill of Materials wants
 * deduplicated rows with a quantity column ("M6 × 25 — qty 12").
 *
 * Aggregation key: designation + material + finish. Two M6×25 bolts
 * in 8.8-zinc and 12.9-blackoxide live as separate BOM lines because
 * the buyer needs to source them separately.
 */

import type { FastenerSpec } from './fastenerSchema';
import type { BearingSpec } from './bearingCatalog';

export type StandardPart =
  | { kind: 'fastener'; spec: FastenerSpec }
  | { kind: 'bearing'; spec: BearingSpec };

export interface BomRow {
  designation: string;
  category: 'fastener' | 'bearing' | 'other';
  qty: number;
  /** Optional partner / supplier hint. */
  supplier?: string;
  /** Optional unit cost (KRW) — set by the partner-RFQ enrichment. */
  unitCostKrw?: number;
  /** Optional notes (material, finish, etc). */
  notes?: string;
}

export interface AggregationOptions {
  /** Group bolts of the same designation but different finishes together
   *  (rare — typically you want them separate). */
  collapseFinishes?: boolean;
}

function fastenerKey(f: FastenerSpec, collapseFinishes: boolean): string {
  return collapseFinishes
    ? `fastener|${f.designation}|${f.material ?? ''}`
    : `fastener|${f.designation}|${f.material ?? ''}|${f.finish ?? ''}`;
}

function bearingKey(b: BearingSpec): string {
  return `bearing|${b.designation}`;
}

export function aggregateBom(
  parts: StandardPart[],
  opts: AggregationOptions = {},
): BomRow[] {
  const collapseFinishes = opts.collapseFinishes ?? false;
  const rowsByKey = new Map<string, BomRow>();

  for (const p of parts) {
    if (p.kind === 'fastener') {
      const key = fastenerKey(p.spec, collapseFinishes);
      const row = rowsByKey.get(key);
      if (row) {
        row.qty++;
      } else {
        const notes = [p.spec.material, p.spec.finish].filter(Boolean).join(' / ');
        rowsByKey.set(key, {
          designation: p.spec.designation,
          category: 'fastener',
          qty: 1,
          notes: notes || undefined,
        });
      }
    } else {
      const key = bearingKey(p.spec);
      const row = rowsByKey.get(key);
      if (row) {
        row.qty++;
      } else {
        rowsByKey.set(key, {
          designation: p.spec.designation,
          category: 'bearing',
          qty: 1,
          notes: `${p.spec.boreMm}×${p.spec.odMm}×${p.spec.widthMm}`,
        });
      }
    }
  }

  return Array.from(rowsByKey.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.designation.localeCompare(b.designation);
  });
}

export interface BomSummary {
  rowCount: number;
  totalParts: number;
  /** Estimated cost when unitCostKrw is set on every row, else null. */
  totalCostKrw: number | null;
}

export function summarizeBom(rows: BomRow[]): BomSummary {
  let totalParts = 0;
  let cost = 0;
  let costKnown = true;
  for (const r of rows) {
    totalParts += r.qty;
    if (r.unitCostKrw != null) cost += r.unitCostKrw * r.qty;
    else costKnown = false;
  }
  return {
    rowCount: rows.length,
    totalParts,
    totalCostKrw: costKnown ? cost : null,
  };
}

/** Apply partner unit-cost hints to a BOM. Returns a new list. */
export function applyPartnerCosts(
  rows: BomRow[],
  costMap: Map<string, number>,
): BomRow[] {
  return rows.map(r => {
    const c = costMap.get(r.designation);
    if (c != null) return { ...r, unitCostKrw: c };
    return r;
  });
}
