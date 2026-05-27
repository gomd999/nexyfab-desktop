/**
 * bomRollupPhantom.ts — Roll up BOM quantities with phantom assembly
 * flattening.
 *
 * Sub-assemblies of type "phantom" do not appear in the final BOM
 * but their child components flatten up into the parent BOM. Real
 * (non-phantom) sub-assemblies appear as a single line plus their
 * own indented BOM (multi-level).
 *
 * Module supports:
 *   - Recursive traversal of an assembly tree.
 *   - Per-node quantity multiplication.
 *   - Phantom flatten + non-phantom kept-as-one.
 *   - Flat BOM (single level), structured BOM (multi-level), and
 *     where-used (component → top-level usage path).
 */

export type ComponentKind = 'part' | 'assembly' | 'phantom-assembly';

export interface BomNode {
  id: string;
  partNumber: string;
  description: string;
  kind: ComponentKind;
  /** Quantity of this node within its parent. */
  quantity: number;
  children: BomNode[];
}

export interface FlatBomRow {
  partNumber: string;
  description: string;
  totalQuantity: number;
  kind: ComponentKind;
  /** Component ranks (assembly depth seen at first encounter). */
  firstSeenDepth: number;
}

export interface StructuredRow {
  partNumber: string;
  description: string;
  kind: ComponentKind;
  quantity: number;
  depth: number;
  isPhantom: boolean;
  hidden: boolean;        // True for items rolled up into phantom parent
}

// ── Flat BOM (with phantom flatten) ───────────────────────────

export function rollupFlat(root: BomNode): FlatBomRow[] {
  const accumulator = new Map<string, FlatBomRow>();
  traverseFlat(root, 1, 0, accumulator);
  return Array.from(accumulator.values());
}

function traverseFlat(node: BomNode, multiplier: number, depth: number, acc: Map<string, FlatBomRow>): void {
  const totalQty = node.quantity * multiplier;
  if (node.kind === 'phantom-assembly') {
    // Phantom: skip the node itself, flatten children up.
    for (const child of node.children) {
      traverseFlat(child, totalQty, depth + 1, acc);
    }
    return;
  }
  // Real part or assembly → add to BOM.
  const existing = acc.get(node.partNumber);
  if (existing) {
    existing.totalQuantity += totalQty;
  } else {
    acc.set(node.partNumber, {
      partNumber: node.partNumber,
      description: node.description,
      totalQuantity: totalQty,
      kind: node.kind,
      firstSeenDepth: depth,
    });
  }
  if (node.kind === 'assembly') {
    for (const child of node.children) {
      traverseFlat(child, totalQty, depth + 1, acc);
    }
  }
}

// ── Structured BOM (multi-level, phantom shown as hidden rows) ─

export function rollupStructured(root: BomNode): StructuredRow[] {
  const rows: StructuredRow[] = [];
  traverseStructured(root, 1, 0, false, rows);
  return rows;
}

function traverseStructured(node: BomNode, multiplier: number, depth: number, parentPhantom: boolean, rows: StructuredRow[]): void {
  const isPhantom = node.kind === 'phantom-assembly';
  rows.push({
    partNumber: node.partNumber,
    description: node.description,
    kind: node.kind,
    quantity: node.quantity * multiplier,
    depth,
    isPhantom,
    hidden: parentPhantom || isPhantom,
  });
  if (node.kind === 'assembly' || node.kind === 'phantom-assembly') {
    const childMult = node.quantity * multiplier;
    for (const child of node.children) {
      traverseStructured(child, childMult, depth + 1, parentPhantom || isPhantom, rows);
    }
  }
}

// ── Where used: list every place a part appears in the tree ────

export interface WhereUsedRow {
  parentPartNumber: string;
  quantity: number;
  path: string[];
}

export function whereUsed(root: BomNode, partNumber: string): WhereUsedRow[] {
  const results: WhereUsedRow[] = [];
  walkWhereUsed(root, partNumber, [], results);
  return results;
}

function walkWhereUsed(node: BomNode, target: string, path: string[], results: WhereUsedRow[]): void {
  const newPath = [...path, node.partNumber];
  for (const child of node.children) {
    if (child.partNumber === target) {
      results.push({
        parentPartNumber: node.partNumber,
        quantity: child.quantity,
        path: newPath,
      });
    }
    if (child.kind !== 'part') {
      walkWhereUsed(child, target, newPath, results);
    }
  }
}

// ── Compare two BOMs ──────────────────────────────────────────

export interface BomDiff {
  added: string[];
  removed: string[];
  quantityChanged: { partNumber: string; oldQty: number; newQty: number }[];
}

export function diff(oldBom: FlatBomRow[], newBom: FlatBomRow[]): BomDiff {
  const oldMap = new Map(oldBom.map(r => [r.partNumber, r]));
  const newMap = new Map(newBom.map(r => [r.partNumber, r]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: BomDiff['quantityChanged'] = [];
  for (const [pn, row] of newMap) {
    if (!oldMap.has(pn)) added.push(pn);
    else {
      const oldQ = oldMap.get(pn)!.totalQuantity;
      if (oldQ !== row.totalQuantity) {
        changed.push({ partNumber: pn, oldQty: oldQ, newQty: row.totalQuantity });
      }
    }
  }
  for (const pn of oldMap.keys()) if (!newMap.has(pn)) removed.push(pn);
  return { added, removed, quantityChanged: changed };
}

// ── Summary ────────────────────────────────────────────────────

export interface BomSummary {
  uniquePartCount: number;
  totalItemQuantity: number;
  phantomCount: number;
  partOnlyCount: number;
}

export function summarize(root: BomNode, flat: FlatBomRow[]): BomSummary {
  let phantoms = 0;
  countPhantoms(root, c => { phantoms += c ? 1 : 0; });
  let totalQty = 0;
  let partCount = 0;
  for (const row of flat) {
    totalQty += row.totalQuantity;
    if (row.kind === 'part') partCount++;
  }
  return {
    uniquePartCount: flat.length,
    totalItemQuantity: totalQty,
    phantomCount: phantoms,
    partOnlyCount: partCount,
  };
}

function countPhantoms(node: BomNode, visit: (isPhantom: boolean) => void): void {
  visit(node.kind === 'phantom-assembly');
  for (const c of node.children) countPhantoms(c, visit);
}
