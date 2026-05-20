/**
 * balloonAutoNumbering.ts — Assign sequential balloon callout numbers
 * to parts on a drawing.
 *
 * Different shops/CAD systems use different numbering schemes:
 *
 *   - **Sequential** — simple 1, 2, 3, ... in input order.
 *   - **Quantity-desc** — highest-quantity part = 1, descending.
 *   - **Clockwise** — sorted by angle around the view centroid
 *     (matches reader's visual scan path).
 *   - **Alphabetical** — sorted by part number string.
 *
 * Each scheme produces an `{ instanceId → balloonNumber }` map. The
 * caller pairs that with their balloon-placement module.
 *
 * Module is independent from the geometry layout — that lives in
 * `balloonBom.ts`. This module is the *numbering policy*.
 */

export interface Vec2 { x: number; y: number }

export interface AssemblyItem {
  instanceId: string;
  partNumber: string;
  quantity: number;
  /** View-projected centroid for clockwise sort. */
  centroid?: Vec2;
}

export type NumberingScheme = 'sequential' | 'quantity-desc' | 'clockwise' | 'alphabetical';

export interface NumberingResult {
  /** instanceId → balloon number. */
  numbers: Map<string, number>;
  /** Display order (sorted instanceId list). */
  order: string[];
  scheme: NumberingScheme;
}

export interface NumberingOptions {
  scheme: NumberingScheme;
  /** Start number (default 1). */
  startAt: number;
  /** View centroid for clockwise sort. */
  viewCentroid?: Vec2;
  /** Skip certain numbers (e.g., reserved). */
  skipNumbers?: number[];
}

export const DEFAULT_OPTIONS: NumberingOptions = {
  scheme: 'sequential',
  startAt: 1,
};

// ── Top-level entry ────────────────────────────────────────────

export function numberBalloons(items: AssemblyItem[], options: Partial<NumberingOptions> = {}): NumberingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (items.length === 0) {
    return { numbers: new Map(), order: [], scheme: opts.scheme };
  }
  const sorted = orderItems(items, opts);
  const skip = new Set(opts.skipNumbers ?? []);
  const numbers = new Map<string, number>();
  let n = opts.startAt;
  for (const item of sorted) {
    while (skip.has(n)) n++;
    numbers.set(item.instanceId, n);
    n++;
  }
  return {
    numbers,
    order: sorted.map(i => i.instanceId),
    scheme: opts.scheme,
  };
}

// ── Ordering ───────────────────────────────────────────────────

function orderItems(items: AssemblyItem[], opts: NumberingOptions): AssemblyItem[] {
  switch (opts.scheme) {
    case 'sequential':
      return [...items];
    case 'quantity-desc':
      return [...items].sort((a, b) => b.quantity - a.quantity || a.partNumber.localeCompare(b.partNumber));
    case 'alphabetical':
      return [...items].sort((a, b) => a.partNumber.localeCompare(b.partNumber));
    case 'clockwise': {
      const center = opts.viewCentroid ?? computeViewCentroid(items);
      return [...items].sort((a, b) => angleAround(a.centroid, center) - angleAround(b.centroid, center));
    }
  }
}

function computeViewCentroid(items: AssemblyItem[]): Vec2 {
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const i of items) {
    if (!i.centroid) continue;
    cx += i.centroid.x;
    cy += i.centroid.y;
    count++;
  }
  if (count === 0) return { x: 0, y: 0 };
  return { x: cx / count, y: cy / count };
}

function angleAround(p: Vec2 | undefined, center: Vec2): number {
  if (!p) return -Infinity;
  return Math.atan2(p.y - center.y, p.x - center.x);
}

// ── Conversion helpers ────────────────────────────────────────

/** For each instance, produce its label string (e.g., for "ABC" mode). */
export function labelFor(instanceNumber: number, mode: 'numeric' | 'alpha' = 'numeric'): string {
  if (mode === 'numeric') return String(instanceNumber);
  // Convert 1 → A, 26 → Z, 27 → AA.
  let n = instanceNumber;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Group items by partNumber for the BOM table — same partNumber gets the same balloon. */
export function groupByPartNumber(items: AssemblyItem[]): Map<string, AssemblyItem[]> {
  const map = new Map<string, AssemblyItem[]>();
  for (const item of items) {
    const list = map.get(item.partNumber) ?? [];
    list.push(item);
    map.set(item.partNumber, list);
  }
  return map;
}

// ── Summary ────────────────────────────────────────────────────

export interface NumberingSummary {
  itemCount: number;
  uniqueNumbers: number;
  maxNumber: number;
  scheme: NumberingScheme;
  skippedCount: number;
}

export function summarize(result: NumberingResult, opts: Partial<NumberingOptions> = {}): NumberingSummary {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const numbers = [...result.numbers.values()];
  return {
    itemCount: result.numbers.size,
    uniqueNumbers: new Set(numbers).size,
    maxNumber: numbers.length > 0 ? Math.max(...numbers) : 0,
    scheme: result.scheme,
    skippedCount: o.skipNumbers?.length ?? 0,
  };
}
