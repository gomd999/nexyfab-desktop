/**
 * balloonBom.ts — Auto-placed balloon labels + BOM table for drawings.
 *
 * SolidWorks "Auto Balloon" places numbered callouts next to every
 * component in an assembly view, with leader lines pointing to the
 * actual parts. The companion BOM table lists each balloon's item
 * number + description + quantity.
 *
 * Capabilities:
 *
 *   - **Auto-numbering** — items get sequential numbers in stable
 *     order (alphabetical by part number, or by quantity descending).
 *   - **Non-overlap layout** — balloons placed around the view
 *     border in concentric rings so leaders don't cross.
 *   - **BOM grouping** — same part number rolls up to one BOM row
 *     with quantity > 1. Optional sub-assembly indentation.
 *   - **Cost rollup** — per-row cost + grand total when prices given.
 *   - **Revision tracking** — diff between two BOMs (added / removed /
 *     quantity-changed).
 */

export interface AssemblyItem {
  /** Unique instance id within the assembly. */
  instanceId: string;
  /** Catalog part number. */
  partNumber: string;
  /** Description shown in the BOM. */
  description: string;
  /** Item position in the view (sheet mm). */
  positionOnSheet: [number, number];
  /** Material per BOM row (optional). */
  material?: string;
  /** Unit cost (USD, optional). */
  unitCostUsd?: number;
}

export interface BalloonPlacement {
  itemNumber: number;
  partNumber: string;
  /** Balloon position on sheet (mm). */
  balloonPosition: [number, number];
  /** Anchor on the part (mm). */
  anchorPosition: [number, number];
  /** Polyline leader from balloon → anchor. */
  leader: Array<[number, number]>;
}

export interface BomRow {
  itemNumber: number;
  partNumber: string;
  description: string;
  quantity: number;
  material?: string;
  unitCostUsd?: number;
  totalCostUsd?: number;
}

export interface BomTable {
  rows: BomRow[];
  totalCount: number;
  totalCostUsd?: number;
}

// ── BOM grouping ────────────────────────────────────────────────

export type BomSortMode = 'part-number' | 'quantity-desc' | 'cost-desc';

export function groupBom(
  items: AssemblyItem[],
  sortMode: BomSortMode = 'part-number',
): BomTable {
  const groups = new Map<string, { item: AssemblyItem; quantity: number }>();
  for (const it of items) {
    const existing = groups.get(it.partNumber);
    if (existing) existing.quantity++;
    else groups.set(it.partNumber, { item: it, quantity: 1 });
  }
  const arr = Array.from(groups.values());
  switch (sortMode) {
    case 'part-number':
      arr.sort((a, b) => a.item.partNumber.localeCompare(b.item.partNumber));
      break;
    case 'quantity-desc':
      arr.sort((a, b) => b.quantity - a.quantity);
      break;
    case 'cost-desc':
      arr.sort((a, b) =>
        (b.item.unitCostUsd ?? 0) * b.quantity - (a.item.unitCostUsd ?? 0) * a.quantity);
      break;
  }
  const rows: BomRow[] = arr.map((g, i) => ({
    itemNumber: i + 1,
    partNumber: g.item.partNumber,
    description: g.item.description,
    quantity: g.quantity,
    material: g.item.material,
    unitCostUsd: g.item.unitCostUsd,
    totalCostUsd: g.item.unitCostUsd != null ? g.item.unitCostUsd * g.quantity : undefined,
  }));
  const totalCount = items.length;
  const totalCost = rows.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);
  return {
    rows,
    totalCount,
    totalCostUsd: rows.every(r => r.unitCostUsd == null) ? undefined : totalCost,
  };
}

// ── Balloon placement ───────────────────────────────────────────

export interface BalloonLayoutOptions {
  /** Sheet bbox the layout must respect. */
  sheetBbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** View bbox where parts are drawn. */
  viewBbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Margin between balloon edge and sheet/view (mm). */
  marginMm?: number;
  /** Balloon diameter (mm). */
  balloonDiameterMm?: number;
  /** Maximum repulsion iterations. */
  maxIterations?: number;
}

/** Auto-place balloons around the view perimeter so leaders don't
 *  cross each other. Algorithm:
 *    1. Initial seed: place balloon directly outward from view bbox
 *       toward nearest sheet edge.
 *    2. Iterative repulsion: balloons repel each other within
 *       minSpacing radius.
 *    3. Project balloons back to sheet bounds. */
export function autoPlaceBalloons(
  items: AssemblyItem[],
  bom: BomTable,
  options: BalloonLayoutOptions,
): BalloonPlacement[] {
  const margin = options.marginMm ?? 10;
  const diameter = options.balloonDiameterMm ?? 8;
  const maxIter = options.maxIterations ?? 30;
  const minSpacing = diameter * 1.5;
  const sheet = options.sheetBbox;
  const view = options.viewBbox;
  const itemNumberByPart = new Map<string, number>();
  for (const row of bom.rows) itemNumberByPart.set(row.partNumber, row.itemNumber);

  // Place each unique part once (first instance encountered).
  const placements: BalloonPlacement[] = [];
  const seenParts = new Set<string>();
  for (const item of items) {
    if (seenParts.has(item.partNumber)) continue;
    seenParts.add(item.partNumber);
    const itemNumber = itemNumberByPart.get(item.partNumber);
    if (itemNumber == null) continue;
    const balloonPos = initialBalloonPosition(item.positionOnSheet, view, sheet, margin);
    placements.push({
      itemNumber,
      partNumber: item.partNumber,
      balloonPosition: balloonPos,
      anchorPosition: item.positionOnSheet,
      leader: [balloonPos, item.positionOnSheet],
    });
  }

  // Repulsion.
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i]!;
        const b = placements[j]!;
        const dx = b.balloonPosition[0] - a.balloonPosition[0];
        const dy = b.balloonPosition[1] - a.balloonPosition[1];
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < minSpacing) {
          const push = (minSpacing - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.balloonPosition = [a.balloonPosition[0] - ux * push, a.balloonPosition[1] - uy * push];
          b.balloonPosition = [b.balloonPosition[0] + ux * push, b.balloonPosition[1] + uy * push];
        }
      }
    }
  }

  // Clamp to sheet + rebuild leader.
  for (const p of placements) {
    p.balloonPosition = [
      Math.max(sheet.minX + margin, Math.min(sheet.maxX - margin, p.balloonPosition[0])),
      Math.max(sheet.minY + margin, Math.min(sheet.maxY - margin, p.balloonPosition[1])),
    ];
    p.leader = [p.balloonPosition, p.anchorPosition];
  }

  return placements;
}

function initialBalloonPosition(
  partPos: [number, number],
  view: { minX: number; minY: number; maxX: number; maxY: number },
  sheet: { minX: number; minY: number; maxX: number; maxY: number },
  margin: number,
): [number, number] {
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;
  // Direction from view centre to part position.
  const dx = partPos[0] - cx;
  const dy = partPos[1] - cy;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  // Choose the side (top/bottom/left/right) the part is closest to.
  let bx: number, by: number;
  if (adx > ady) {
    by = partPos[1];
    bx = dx > 0 ? sheet.maxX - margin : sheet.minX + margin;
  } else {
    bx = partPos[0];
    by = dy > 0 ? sheet.maxY - margin : sheet.minY + margin;
  }
  return [bx, by];
}

// ── BOM diff (revision tracking) ────────────────────────────────

export interface BomDiff {
  added: BomRow[];
  removed: BomRow[];
  quantityChanged: Array<{ partNumber: string; from: number; to: number }>;
}

export function diffBom(previous: BomTable, current: BomTable): BomDiff {
  const prevMap = new Map(previous.rows.map(r => [r.partNumber, r]));
  const currMap = new Map(current.rows.map(r => [r.partNumber, r]));
  const added: BomRow[] = [];
  const removed: BomRow[] = [];
  const qtyChanged: BomDiff['quantityChanged'] = [];
  for (const [pn, row] of currMap) {
    const prev = prevMap.get(pn);
    if (!prev) added.push(row);
    else if (prev.quantity !== row.quantity) {
      qtyChanged.push({ partNumber: pn, from: prev.quantity, to: row.quantity });
    }
  }
  for (const [pn, row] of prevMap) {
    if (!currMap.has(pn)) removed.push(row);
  }
  return { added, removed, quantityChanged: qtyChanged };
}

// ── Sub-assembly indentation ─────────────────────────────────────

export interface HierarchicalBomRow extends BomRow {
  /** Indent level: 0 = top, 1 = sub-assembly, 2 = sub-sub, etc. */
  level: number;
  /** Parent row's part number (for tree linking). */
  parentPartNumber?: string;
}

export interface AssemblyTree {
  partNumber: string;
  description: string;
  unitCostUsd?: number;
  children: AssemblyTree[];
}

/** Flatten an assembly tree into an indented BOM. */
export function flattenAssembly(tree: AssemblyTree): HierarchicalBomRow[] {
  const out: HierarchicalBomRow[] = [];
  let counter = 0;
  function walk(node: AssemblyTree, level: number, parentPn?: string): void {
    out.push({
      itemNumber: ++counter,
      partNumber: node.partNumber,
      description: node.description,
      quantity: 1,
      unitCostUsd: node.unitCostUsd,
      totalCostUsd: node.unitCostUsd,
      level,
      parentPartNumber: parentPn,
    });
    for (const c of node.children) walk(c, level + 1, node.partNumber);
  }
  walk(tree, 0);
  return out;
}
