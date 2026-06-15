/**
 * featureTreeOps — Phase 2.10 of NexyFab Pro own-CAD (ADR-013).
 *
 * Higher-level whole-tree operations that compose on top of the IR
 * primitives in featureTree.ts (validateTree / downstreamOf) and the
 * round-trip layer in featureTreePersist.ts. These are pure functions
 * that always return brand-new tree objects — callers can safely keep
 * the inputs as cache keys.
 *
 * Five operations:
 *   - cloneTree         — defensive deep copy for "snapshot before
 *                         destructive transform" call sites.
 *   - mergeTrees        — graft a second tree into a base (e.g. paste a
 *                         saved sub-assembly into the current document).
 *                         Re-maps id collisions deterministically.
 *   - diffTrees         — node-level structural diff
 *                         (added / removed / modified / unchanged).
 *                         Different shape from the SCAD-replay-oriented
 *                         diff in featureTreeEdit.ts; this one is for
 *                         history-replay UIs and merge previews.
 *   - extractSubtree    — pull a node plus its transitive dependencies
 *                         (the upstream cone) into a self-contained
 *                         tree, used by "save selection" and
 *                         derived-feature export.
 *   - applyDiff         — fold a TreeDiff onto a base tree; the inverse
 *                         of diffTrees for the modified/added/removed
 *                         axes (unchanged is ignored — base already has
 *                         those nodes).
 *
 * Design notes:
 *
 *   1) Why a SECOND TreeDiff shape (vs the one in featureTreeEdit.ts)?
 *      featureTreeEdit's diff is tuned for the incremental SCAD replay
 *      pipeline: it returns sets of ids so the replay worker can keep
 *      its cache table keyed by id. This file's diff is for higher-level
 *      "show the user what changed" surfaces (history sidebar, paste
 *      preview, three-way-merge UI), so it carries the actual before /
 *      after FeatureNode payloads. Both diffs serve real call sites; we
 *      deliberately don't try to unify them (the cache-keyed-set shape
 *      would force history UIs to re-lookup every id, and the
 *      payload-bearing shape would bloat the per-replay hot path).
 *
 *   2) Deep clone via JSON round-trip
 *      All FeaturePayload kinds are plain JSON (same invariant
 *      featureTreePersist.ts relies on). JSON.parse(JSON.stringify(.))
 *      gives us a true deep copy without any Map/Set/Date worries and
 *      no dependency on Node-only structuredClone fallbacks. Cost is
 *      ~5x slower than structuredClone on very large trees, but the
 *      worst case (1000-node tree, ~150 KB JSON) is sub-millisecond on
 *      modern V8 — well within the editor's 16ms budget.
 *
 *   3) Collision policy on merge
 *      Default = 'suffix' (append "__2" / "__3" until unique). 'prefix'
 *      prepends "merged__" instead — useful when the user knows the
 *      foreign tree is the "incoming change" and wants every node
 *      visually tagged. 'skip' drops conflicting nodes entirely (and
 *      every dependent of a dropped node is also skipped, otherwise
 *      validateTree would reject the result).
 *
 *   4) Diff "modified" precision
 *      We compare nodes by deep structural equality (JSON.stringify of
 *      a normalized shape — dependencies array order matters, but key
 *      order in the payload does not because both are stringified
 *      identically after normalization). This catches every change
 *      that could affect replay output without false positives from
 *      object-identity churn (e.g. a setTree that rebuilt the wrapper
 *      with the same content).
 *
 *   5) applyDiff is intentionally NOT a strict inverse of diffTrees
 *      diffTrees(a, b) → diff,  applyDiff(a, diff) === structurally(b)
 *      only when `a` is exactly the base used in the diff. We do NOT
 *      attempt three-way merge here (that's a Phase 2.11+ concern with
 *      CRDT history). What we DO guarantee: round-trip a → diff → a' is
 *      structurally identical to b for the additive/destructive/modify
 *      operations, and the result is validated by validateTree before
 *      return so callers can trust the topology invariant.
 */

import {
  validateTree,
  type FeatureNode,
  type FeatureTree,
} from './featureTree';

// ─── cloneTree ────────────────────────────────────────────────────────────

/**
 * Deep clone a FeatureTree. Output shares no object references with the
 * input — mutating any nested field on the result is safe.
 *
 * Uses JSON round-trip because every FeaturePayload kind is plain JSON
 * (see featureTreePersist.ts contract). For the 1000-node ceiling this
 * is sub-millisecond on modern V8.
 */
export function cloneTree(tree: FeatureTree): FeatureTree {
  return JSON.parse(JSON.stringify({ nodes: tree.nodes })) as FeatureTree;
}

// ─── mergeTrees ───────────────────────────────────────────────────────────

export type CollisionStrategy = 'prefix' | 'suffix' | 'skip';

export interface MergeOptions {
  /** How to handle id collisions between base and other.
   *  Default = 'suffix' (append __2, __3, ...). */
  collisionStrategy?: CollisionStrategy;
}

export interface MergeResult {
  merged: FeatureTree;
  /** Map of old id → new id for every node in `other` that was renamed.
   *  Nodes that kept their id (no collision, or were skipped) do NOT
   *  appear in this map. Skipped ids map to '' (empty string) so callers
   *  can distinguish "renamed" from "dropped". */
  remappedIds: Map<string, string>;
}

/**
 * Append `other` after `base`, returning a NEW tree.
 *
 * Collision behaviour (governed by opts.collisionStrategy):
 *   - 'suffix' (default): each colliding id gets __2, __3, ... appended
 *     until unique. Dependencies inside `other` are remapped accordingly.
 *   - 'prefix': each colliding id gets 'merged__' prepended; if still
 *     not unique, falls through to __2 suffix. Useful when the user
 *     wants every grafted node visually tagged.
 *   - 'skip': drop conflicting nodes outright, plus every node in `other`
 *     that transitively depends on a dropped node (otherwise the merged
 *     tree would have dangling deps and validateTree would reject it).
 *
 * The returned tree is validated before return — any internal-only
 * dependency violation in `other` (already-invalid input) will throw.
 */
export function mergeTrees(
  base: FeatureTree,
  other: FeatureTree,
  opts: MergeOptions = {},
): MergeResult {
  const strategy: CollisionStrategy = opts.collisionStrategy ?? 'suffix';

  // Defensive deep clone so callers can mutate base/other after the call.
  const baseClone = cloneTree(base);

  // Fast path: nothing to merge.
  if (other.nodes.length === 0) {
    validateTree(baseClone);
    return { merged: baseClone, remappedIds: new Map() };
  }

  const otherClone = cloneTree(other);

  const baseIds = new Set(baseClone.nodes.map((n) => n.id));
  // Track the running set of all ids that will appear in the final tree
  // so we don't pick a "unique" name that collides with a later original.
  const reserved = new Set(baseIds);
  for (const n of otherClone.nodes) reserved.add(n.id);

  const remap = new Map<string, string>();
  const dropped = new Set<string>();

  // First pass — assign new ids (or mark as dropped). We walk in order
  // because later nodes in `other` may depend on earlier ones, so we
  // need to know whether a dependency was renamed by the time we hit
  // its dependent.
  for (const node of otherClone.nodes) {
    if (!baseIds.has(node.id)) {
      // No collision. Leave id alone.
      continue;
    }
    if (strategy === 'skip') {
      dropped.add(node.id);
      remap.set(node.id, '');
      continue;
    }
    const newId = pickUniqueId(node.id, strategy, reserved);
    reserved.add(newId);
    remap.set(node.id, newId);
  }

  // Second pass — rebuild each node with remapped id + remapped deps,
  // dropping nodes whose deps were dropped (cascade).
  const appended: FeatureNode[] = [];
  for (const node of otherClone.nodes) {
    if (dropped.has(node.id)) continue;

    // Check transitive drop: if any dep is in `dropped`, skip this node
    // too (otherwise validateTree would fail on a missing dep).
    let cascade = false;
    for (const dep of node.dependencies) {
      if (dropped.has(dep)) {
        cascade = true;
        break;
      }
    }
    if (cascade) {
      dropped.add(node.id);
      remap.set(node.id, '');
      continue;
    }

    const newId = remap.get(node.id) ?? node.id;
    const newDeps = node.dependencies.map((d) => remap.get(d) ?? d);
    appended.push({
      id: newId,
      name: node.name,
      ...(node.suppressed !== undefined ? { suppressed: node.suppressed } : {}),
      dependencies: newDeps,
      payload: node.payload,
    });
  }

  const merged: FeatureTree = { nodes: [...baseClone.nodes, ...appended] };
  validateTree(merged);
  return { merged, remappedIds: remap };
}

function pickUniqueId(
  original: string,
  strategy: Exclude<CollisionStrategy, 'skip'>,
  reserved: ReadonlySet<string>,
): string {
  if (strategy === 'prefix') {
    const prefixed = `merged__${original}`;
    if (!reserved.has(prefixed)) return prefixed;
    // Fall through to numeric suffix on top of the prefix.
    let i = 2;
    while (reserved.has(`${prefixed}__${i}`)) i += 1;
    return `${prefixed}__${i}`;
  }
  // suffix
  let i = 2;
  while (reserved.has(`${original}__${i}`)) i += 1;
  return `${original}__${i}`;
}

// ─── diffTrees ────────────────────────────────────────────────────────────

/**
 * Tree diff with full node payloads. Used by history UIs and merge
 * previews. The complementary set-of-ids shape in featureTreeEdit.ts
 * (also called TreeDiff there) drives the SCAD replay cache; the two
 * coexist deliberately. See module header note (1).
 */
export interface TreeDiff {
  /** Nodes present in `b` but not in `a`. */
  added: FeatureNode[];
  /** Nodes present in `a` but not in `b`. */
  removed: FeatureNode[];
  /** Nodes whose deep structure differs between `a` and `b`. */
  modified: Array<{ before: FeatureNode; after: FeatureNode }>;
  /** Nodes that exist in both with deep-equal structure. The `after`
   *  reference (from `b`) is used here to mirror what callers see in
   *  `modified`. */
  unchanged: FeatureNode[];
}

/**
 * Diff two trees by node id. Deep equality (JSON.stringify of a
 * normalized node shape) decides modified vs unchanged so we catch
 * every structural change without false positives from harmless
 * object-identity churn.
 *
 * Order:
 *   - added: in `b.nodes` order
 *   - removed: in `a.nodes` order
 *   - modified: in `b.nodes` order
 *   - unchanged: in `b.nodes` order
 */
export function diffTrees(a: FeatureTree, b: FeatureTree): TreeDiff {
  const byIdA = new Map(a.nodes.map((n) => [n.id, n]));
  const byIdB = new Map(b.nodes.map((n) => [n.id, n]));

  const added: FeatureNode[] = [];
  const removed: FeatureNode[] = [];
  const modified: Array<{ before: FeatureNode; after: FeatureNode }> = [];
  const unchanged: FeatureNode[] = [];

  for (const nb of b.nodes) {
    const na = byIdA.get(nb.id);
    if (!na) {
      added.push(nb);
      continue;
    }
    if (nodeEquals(na, nb)) {
      unchanged.push(nb);
    } else {
      modified.push({ before: na, after: nb });
    }
  }
  for (const na of a.nodes) {
    if (!byIdB.has(na.id)) removed.push(na);
  }

  return { added, removed, modified, unchanged };
}

/**
 * Deep equality on the FeatureNode shape. Normalizes:
 *   - suppressed: undefined === false (so { suppressed: false } and
 *     {} are equal; both replay identically).
 *   - dependencies: ORDER IS SIGNIFICANT (a re-ordered dep list could
 *     legitimately change replay semantics in a future kernel).
 *   - payload: structurally deep-equal via JSON.stringify after a key
 *     sort — JSON.stringify is non-deterministic across key insertion
 *     order, so we walk and re-emit with sorted keys.
 */
function nodeEquals(a: FeatureNode, b: FeatureNode): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  const aSup = a.suppressed ?? false;
  const bSup = b.suppressed ?? false;
  if (aSup !== bSup) return false;
  if (a.dependencies.length !== b.dependencies.length) return false;
  for (let i = 0; i < a.dependencies.length; i++) {
    if (a.dependencies[i] !== b.dependencies[i]) return false;
  }
  return stableStringify(a.payload) === stableStringify(b.payload);
}

/**
 * JSON.stringify with deterministic key order. Arrays preserve their
 * order (that's load-bearing for sketch loops, pattern direction, etc.);
 * object keys are sorted lexicographically.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([k1], [k2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : 0));
  const parts = entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${parts.join(',')}}`;
}

// ─── extractSubtree ──────────────────────────────────────────────────────

/**
 * Build a new tree containing `rootId` plus its full transitive
 * dependency cone (the UPSTREAM set — nodes the root needs to replay).
 *
 * Order is preserved from the input tree so the result is still topo-
 * valid (every dep appears before its dependent).
 *
 * Throws if `rootId` doesn't exist in `tree`.
 */
export function extractSubtree(tree: FeatureTree, rootId: string): FeatureTree {
  const idToNode = new Map(tree.nodes.map((n) => [n.id, n]));
  const root = idToNode.get(rootId);
  if (!root) {
    throw new Error(`extractSubtree: node ${rootId} not found in tree`);
  }

  // BFS/DFS over the dependency graph (upstream direction).
  const keep = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (keep.has(cur)) continue;
    keep.add(cur);
    const node = idToNode.get(cur);
    if (!node) {
      throw new Error(
        `extractSubtree: dangling dependency ${cur} (referenced from ${rootId}'s cone)`,
      );
    }
    for (const dep of node.dependencies) stack.push(dep);
  }

  // Filter the original list to preserve declared order.
  const nodes = tree.nodes.filter((n) => keep.has(n.id));
  // Deep clone so the caller can mutate the subtree without affecting
  // the source.
  const subtree = cloneTree({ nodes });
  validateTree(subtree);
  return subtree;
}

// ─── applyDiff ────────────────────────────────────────────────────────────

/**
 * Fold a TreeDiff onto a base tree. Semantics:
 *   - removed: drop every removed node id from the result
 *   - modified: replace every modified node by its `after` payload
 *   - added: append each added node at the end (preserving the diff's
 *     declared order); validateTree catches any forward-ref violation
 *
 * The `unchanged` field is ignored (base already contains those nodes,
 * unmodified).
 *
 * This is the natural fold for "apply patch from collaborator" call
 * sites. It does NOT attempt three-way merge — concurrent edits should
 * go through the CRDT layer (Phase 2.11+).
 *
 * Throws if:
 *   - a 'modified' entry's `before.id` is not in base
 *   - an 'added' entry collides with an existing id
 *   - the result fails validateTree (e.g. an added node depends on a
 *     removed node)
 */
export function applyDiff(base: FeatureTree, diff: TreeDiff): FeatureTree {
  const removedIds = new Set(diff.removed.map((n) => n.id));
  const modifiedById = new Map(diff.modified.map((m) => [m.before.id, m.after]));

  // Sanity-check: every modified.before id must exist in base.
  const baseIds = new Set(base.nodes.map((n) => n.id));
  for (const m of diff.modified) {
    if (!baseIds.has(m.before.id)) {
      throw new Error(
        `applyDiff: modified node ${m.before.id} not present in base`,
      );
    }
  }
  for (const a of diff.added) {
    if (baseIds.has(a.id)) {
      throw new Error(`applyDiff: added node ${a.id} already exists in base`);
    }
  }

  const out: FeatureNode[] = [];
  for (const node of base.nodes) {
    if (removedIds.has(node.id)) continue;
    const replacement = modifiedById.get(node.id);
    out.push(replacement ?? node);
  }
  for (const added of diff.added) {
    out.push(added);
  }

  const next = cloneTree({ nodes: out });
  validateTree(next);
  return next;
}
