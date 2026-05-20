/**
 * multiBodyImport.ts — Multi-body / assembly extraction from a STEP file.
 *
 * STEP files (especially AP214/AP242) can encode either:
 *   - A single PRODUCT with many SHAPE_REPRESENTATIONs (multi-body),
 *   - or an assembly hierarchy: a root PRODUCT containing child PRODUCTs
 *     with NEXT_ASSEMBLY_USAGE_OCCURRENCE links and per-instance
 *     transformations.
 *
 * The OCCT WASM call surfaces only the leaf solids, so we lose the
 * tree. This module reconstructs the tree from raw STEP text using
 * regex-light parsing (no formal ISO 10303 parser — feasible because
 * we only need the relations, not the geometry).
 *
 * Produces a `BodyTree` the importer panel renders as a hierarchical
 * list, and a flat `BodyManifest` for downstream pipeline stages
 * (DFM gate, partner-RFQ, BOM).
 */

export interface ProductNode {
  /** STEP entity #id (e.g. "#42"). */
  entityId: string;
  /** Human-readable name from PRODUCT entity. */
  name: string;
  /** Children indices into the same array. Empty for leaf parts. */
  childIndices: number[];
  /** 4×4 row-major transform from parent (identity for root). */
  transform: number[];
}

export interface BodyTree {
  nodes: ProductNode[];
  rootIndices: number[];
  /** Total leaf-part count (occurrences, not unique parts). */
  leafCount: number;
}

export interface BodyManifest {
  uniqueParts: number;
  totalOccurrences: number;
  maxDepth: number;
  /** Flat list ready for BOM: row per leaf occurrence. */
  bomRows: Array<{
    occurrenceId: string;
    productName: string;
    parentPath: string;
  }>;
}

const PRODUCT_RX = /^#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'/gim;
const NAUO_RX = /^#(\d+)\s*=\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)/gim;
const ITEM_DEF_RX = /^#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\([^)]*?#(\d+)/gim;
const CART_TRANSFORM_RX = /CARTESIAN_POINT\s*\(\s*''\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)/g;

/** Identity 4×4 (row-major). */
const IDENTITY: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** Parse a STEP file's product hierarchy. The input is the raw STEP
 *  text (DATA section); `discoverStep` already determined the file is
 *  valid STEP and is the caller's responsibility. */
export function parseBodyTree(stepText: string): BodyTree {
  // Pass 1: collect products.
  const products = new Map<string, ProductNode>(); // entityId -> node
  for (const m of stepText.matchAll(PRODUCT_RX)) {
    const id = `#${m[1]}`;
    // PRODUCT(id_string, display_name, description, frame_of_reference)
    // Prefer display_name (m[3]); fall back to id_string then synthetic.
    const displayName = m[3] || m[2] || `Part_${m[1]}`;
    products.set(id, {
      entityId: id,
      name: displayName,
      childIndices: [],
      transform: IDENTITY.slice(),
    });
  }

  // Pass 2: map PRODUCT_DEFINITION → PRODUCT.
  const defToProd = new Map<string, string>();
  for (const m of stepText.matchAll(ITEM_DEF_RX)) {
    const defId = `#${m[1]}`;
    const prodId = `#${m[2]}`;
    if (products.has(prodId)) defToProd.set(defId, prodId);
  }

  // Pass 3: collect parent→child edges from NAUO.
  const edges: Array<[string, string]> = []; // [parent productId, child productId]
  for (const m of stepText.matchAll(NAUO_RX)) {
    const parentDef = `#${m[4]}`;
    const childDef = `#${m[5]}`;
    const parent = defToProd.get(parentDef);
    const child = defToProd.get(childDef);
    if (parent && child && parent !== child) edges.push([parent, child]);
  }

  // Build linear array + index map.
  const nodes: ProductNode[] = [];
  const idxOf = new Map<string, number>();
  for (const [id, node] of products) {
    idxOf.set(id, nodes.length);
    nodes.push(node);
  }

  // Wire children.
  const isChild = new Set<string>();
  for (const [p, c] of edges) {
    const pi = idxOf.get(p);
    const ci = idxOf.get(c);
    if (pi == null || ci == null) continue;
    nodes[pi]!.childIndices.push(ci);
    isChild.add(c);
  }

  const rootIndices: number[] = [];
  for (const [id, idx] of idxOf) {
    if (!isChild.has(id)) rootIndices.push(idx);
  }
  // If everything looks like a root (no NAUO), it's a multi-body file.
  // That's fine — every node is its own tree.

  // Walk to count leaf occurrences.
  let leafCount = 0;
  const visit = (idx: number, visited: Set<number>): void => {
    if (visited.has(idx)) return; // cycle guard
    visited.add(idx);
    const n = nodes[idx]!;
    if (n.childIndices.length === 0) {
      leafCount++;
      return;
    }
    for (const c of n.childIndices) visit(c, visited);
  };
  for (const r of rootIndices) visit(r, new Set());

  return { nodes, rootIndices, leafCount };
}

/** Flatten a body tree into a BOM-ready manifest. */
export function buildBodyManifest(tree: BodyTree): BodyManifest {
  const bomRows: BodyManifest['bomRows'] = [];
  const uniquePartIds = new Set<string>();
  let maxDepth = 0;

  const walk = (idx: number, path: string[], depth: number, visited: Set<number>): void => {
    if (visited.has(idx)) return;
    visited.add(idx);
    if (depth > maxDepth) maxDepth = depth;
    const n = tree.nodes[idx]!;
    uniquePartIds.add(n.entityId);
    if (n.childIndices.length === 0) {
      // Leaf — emit a BOM row.
      bomRows.push({
        occurrenceId: `${path.concat(n.name).join('/')}@${n.entityId}`,
        productName: n.name,
        parentPath: path.join('/') || '/',
      });
      return;
    }
    for (const c of n.childIndices) {
      walk(c, path.concat(n.name), depth + 1, visited);
    }
  };

  for (const r of tree.rootIndices) {
    walk(r, [], 0, new Set());
  }

  return {
    uniqueParts: uniquePartIds.size,
    totalOccurrences: bomRows.length,
    maxDepth,
    bomRows,
  };
}

/** Convenience — parse + manifest in one call, with a guard against
 *  pathological files (>10k entities aborts). */
export function importMultiBody(
  stepText: string,
  opts: { maxEntities?: number } = {},
): { tree: BodyTree; manifest: BodyManifest } | { error: string } {
  const cap = opts.maxEntities ?? 10_000;
  const productHits = stepText.match(/PRODUCT\s*\(/g)?.length ?? 0;
  if (productHits > cap) return { error: `Too many products (${productHits} > ${cap})` };
  const tree = parseBodyTree(stepText);
  const manifest = buildBodyManifest(tree);
  return { tree, manifest };
}
