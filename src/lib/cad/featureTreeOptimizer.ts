/**
 * featureTreeOptimizer — non-destructive whole-tree garbage collection.
 *
 * Companion to featureTreeOps.ts (clone/merge/diff/extract/applyDiff) and
 * featureTreeEdit.ts (pure ops + incremental replay). This module answers a
 * different question: given an in-progress FeatureTree, which nodes are
 * dead weight and can be safely dropped from the IR without changing the
 * model the user sees?
 *
 * Three reductions, each gated by an opt flag:
 *
 *   1) removeSuppressed   — Drop every node whose `suppressed` flag is
 *      true. Because suppressed nodes are silently skipped during replay
 *      (see featureTree.replayTree), dropping them is render-equivalent
 *      to leaving them in. The catch: a suppressed node may still be
 *      listed as a `dependency` of a non-suppressed node, and removing
 *      it would dangle that reference. We CASCADE — any dependent of a
 *      dropped node is also dropped (and the warning surface records the
 *      cascade so the UI can flag it for the user).
 *
 *   2) removeOrphans      — Drop every node that is (a) not referenced
 *      as a dependency by any other node AND (b) is not the terminal
 *      output of the tree. The "terminal output" is defined as the LAST
 *      non-suppressed node in declared order — in feature-based CAD
 *      that's conventionally "the current model the user is working on".
 *      Any node that has no dependents AND appears before the terminal
 *      is dead weight (abandoned mid-history sketch, unused
 *      reference geometry, etc.).
 *
 *      WHY this definition? In a featureless tree, "any leaf in the
 *      dependents graph is a root output" would be safer but would prune
 *      nothing — every node a CAD user creates ends up as a leaf
 *      eventually. The "last node = terminal" convention matches the
 *      Fusion 360 / SOLIDWORKS rollback-bar mental model: the final
 *      feature IS the model. Multi-body documents (where the user keeps
 *      several independent terminal leaves) are a Phase 2 concern — for
 *      those we'd need an explicit `outputIds` field on FeatureTree, and
 *      this optimizer would consult it instead of "last node". Today's
 *      callers all build single-body parts.
 *
 *   3) mergePatterns      — Phase 2 placeholder. The idea: two adjacent
 *      `linear_pattern` nodes with the same child + perpendicular
 *      directions can collapse into a single `grid_pattern` node (or
 *      equivalent rectangular array). Not implemented here; gated off by
 *      default, emits a `warnings` entry when requested so callers know
 *      they didn't get any merging. See "Phase 2 wishlist" at the bottom
 *      of this header.
 *
 * Contract:
 *   - Pure function — input tree is never mutated. Output is a freshly
 *     constructed FeatureTree (no shared node references with input).
 *   - Always returns a validateTree-clean result. If the input itself
 *     fails validation, we throw before any reduction runs (fail fast).
 *   - Empty tree in → empty tree out (no warnings).
 *   - All three flags default to safe values: suppressed and orphan
 *     removal default to ON (these are conservative — they only drop
 *     nodes whose removal cannot change render output); mergePatterns
 *     defaults to OFF (Phase 2).
 *
 * Cascade policy (also documented in removeSuppressed comment):
 *   When a node is dropped (suppressed or orphan), every node that
 *   transitively depends on it is also dropped. We compute the cascade
 *   set in one pass over the dependents map, then filter in a second
 *   pass. Every cascaded node lands in `removedNodes` AND in `warnings`
 *   with the cascade source attribution (so the UI can highlight which
 *   user-visible dependent vanished because of a suppression they may
 *   not have realized was load-bearing).
 *
 * Phase 2 wishlist (NOT implemented here):
 *   - mergePatterns:
 *       linear_pattern(dir=X, count=Nx, spacing=Sx)
 *         + linear_pattern(dir=Y, count=Ny, spacing=Sy) on same child
 *         → grid_pattern(Nx × Ny). Requires a `grid_pattern` IR kind in
 *         featureTree.ts, which would also need solid kernel support.
 *   - mergeIdenticalSubtrees: two sibling subtrees with deep-equal
 *       payloads → a single subtree + an `instance` reference (saves
 *       replay time and memory). Needs an `instance` IR kind.
 *   - inlineSingleUseSketches: a sketch referenced by exactly one
 *       feature can be inlined into that feature's payload (eliminates
 *       a node). Currently sketches don't live as nodes — when they do
 *       (Phase 2.6.3+), this becomes relevant.
 *   - constantFold:  a `linear_pattern` with count=1 is a no-op (just
 *       the child); replace the pattern node with its child's payload
 *       inlined. Same for circular_pattern with count=1.
 *   - deadCodeAfterTerminal: nodes that appear AFTER the last
 *       non-suppressed node (i.e. trailing suppressed-only tail) can
 *       also drop. removeSuppressed handles this incidentally today.
 *   - mergeCoplanarFillets: adjacent fillet ops on the same body with
 *       compatible radii → a single fillet op with a multi-edge target
 *       set. Requires fillet IR to model edge-sets (currently single
 *       edge per node).
 *   - compactEditHistory: drop history entries that are subsumed by a
 *       later entry on the same node (slider-drag spam). NOT done here
 *       because history lives in featureTreeHistory.ts and is a
 *       separate-module concern; this optimizer is IR-only.
 */

import {
  validateTree,
  type FeatureNode,
  type FeatureTree,
} from './featureTree';
import { cloneTree } from './featureTreeOps';

// ─── public API ───────────────────────────────────────────────────────────

export interface OptimizeResult {
  /** Freshly constructed tree. Guaranteed validateTree-clean. */
  optimized: FeatureTree;
  /** All node ids dropped by any pass, in the order they were removed. */
  removedNodes: string[];
  /** Pattern merges performed (Phase 2 — empty today). */
  mergedNodes: Array<{ from: string[]; to: string }>;
  /** Human-readable notices: cascades, no-op flags, Phase 2 placeholders. */
  warnings: string[];
}

export interface OptimizeOptions {
  /** Drop suppressed nodes (and cascade their dependents). Default true. */
  removeSuppressed?: boolean;
  /** Drop non-terminal nodes with no dependents. Default true. */
  removeOrphans?: boolean;
  /** Phase 2 placeholder. Default false. */
  mergePatterns?: boolean;
}

/**
 * Run a multi-pass garbage collection over `tree`. See module header for
 * the cascade policy and the orphan definition.
 *
 * Multi-pass detail:
 *   - removeSuppressed runs first. Dropping a suppressed node can convert
 *     a previously-referenced node into an orphan (the only thing that
 *     referenced it was the suppressed one). So orphan removal sees a
 *     fresh post-suppression view.
 *   - mergePatterns (when implemented) runs last so the orphan pass
 *     doesn't churn nodes we're about to fold.
 *
 * Throws (does not return an OptimizeResult) if the INPUT tree fails
 * validateTree — we don't want to silently "fix" structural bugs by
 * dropping nodes that point at missing deps.
 */
export function optimizeTree(
  tree: FeatureTree,
  opts: OptimizeOptions = {},
): OptimizeResult {
  // Fail fast on broken input — pruning a malformed tree would mask bugs.
  validateTree(tree);

  const removeSuppressed = opts.removeSuppressed ?? true;
  const removeOrphans = opts.removeOrphans ?? true;
  const mergePatterns = opts.mergePatterns ?? false;

  // Defensive deep clone so callers can mutate the input after the call.
  let current: FeatureTree = cloneTree(tree);
  const removedNodes: string[] = [];
  const mergedNodes: Array<{ from: string[]; to: string }> = [];
  const warnings: string[] = [];

  // Fast path: nothing to do.
  if (current.nodes.length === 0) {
    return { optimized: current, removedNodes, mergedNodes, warnings };
  }

  if (removeSuppressed) {
    const r = dropSuppressed(current);
    current = r.tree;
    for (const id of r.removed) removedNodes.push(id);
    for (const w of r.warnings) warnings.push(w);
  }

  if (removeOrphans) {
    const r = dropOrphans(current);
    current = r.tree;
    for (const id of r.removed) removedNodes.push(id);
    for (const w of r.warnings) warnings.push(w);
  }

  if (mergePatterns) {
    warnings.push(
      'mergePatterns: not implemented (Phase 2 — requires grid_pattern IR kind)',
    );
  }

  // Final validation — every pass must preserve topo invariant.
  validateTree(current);

  return { optimized: current, removedNodes, mergedNodes, warnings };
}

// ─── pass 1: suppressed + cascade ─────────────────────────────────────────

interface PassResult {
  tree: FeatureTree;
  removed: string[];
  warnings: string[];
}

/**
 * Drop every suppressed node, then cascade-drop every node that depends
 * (transitively) on a dropped node. Cascade is recorded in warnings so
 * the UI can surface "node X went away because suppressed node Y was
 * load-bearing".
 */
function dropSuppressed(tree: FeatureTree): PassResult {
  const suppressed = new Set<string>();
  for (const node of tree.nodes) {
    if (node.suppressed) suppressed.add(node.id);
  }
  if (suppressed.size === 0) {
    return { tree, removed: [], warnings: [] };
  }

  const dependentsMap = buildDependentsMap(tree);

  // Compute cascade closure: every node transitively reachable from a
  // suppressed seed via the dependents graph.
  const dropClosure = new Set<string>(suppressed);
  const cascadedFrom = new Map<string, string>(); // dropped id → seed id
  const stack = [...suppressed];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const dependents = dependentsMap.get(cur);
    if (!dependents) continue;
    for (const dep of dependents) {
      if (!dropClosure.has(dep)) {
        dropClosure.add(dep);
        // Record the proximate cause (first seed that hit it) — that's
        // the most useful breadcrumb for the user.
        cascadedFrom.set(dep, suppressed.has(cur) ? cur : (cascadedFrom.get(cur) ?? cur));
        stack.push(dep);
      }
    }
  }

  const warnings: string[] = [];
  for (const [dropped, source] of cascadedFrom) {
    warnings.push(
      `node "${dropped}" was cascade-removed because suppressed node "${source}" was a transitive dependency`,
    );
  }

  // removed list = closure in declared order (suppressed nodes first, in
  // declared order; then cascaded nodes, in declared order). This is
  // deterministic and matches what the user would see in the UI.
  const removed = tree.nodes.filter((n) => dropClosure.has(n.id)).map((n) => n.id);

  const nodes = tree.nodes.filter((n) => !dropClosure.has(n.id));
  return { tree: { nodes }, removed, warnings };
}

// ─── pass 2: orphans ──────────────────────────────────────────────────────

/**
 * Drop every node that (a) has no dependents AND (b) is not the terminal
 * (= last non-suppressed) node in declared order.
 *
 * NB: after dropSuppressed has run there are no suppressed nodes in the
 * tree, so "last non-suppressed" simplifies to "last node". We still
 * write it the long way in case orphan removal is invoked WITHOUT
 * suppressed removal (the opts flags are independent).
 *
 * Single-pass: dropping orphans can create new orphans (a node whose
 * only dependent was just removed). We loop until a fixed point so a
 * chain of dead nodes collapses in one call.
 */
function dropOrphans(tree: FeatureTree): PassResult {
  const removed: string[] = [];
  const warnings: string[] = [];

  let current = tree;
  // Bounded loop — each iteration removes ≥1 node, so we can't exceed
  // tree.nodes.length iterations. The bound guards against any future
  // bug that would otherwise loop forever.
  for (let iter = 0; iter < tree.nodes.length; iter++) {
    const terminalId = findTerminalId(current);
    const dependentsMap = buildDependentsMap(current);
    const drop: FeatureNode[] = [];
    for (const node of current.nodes) {
      if (node.id === terminalId) continue;
      const dependents = dependentsMap.get(node.id);
      if (!dependents || dependents.size === 0) {
        drop.push(node);
      }
    }
    if (drop.length === 0) break;

    for (const n of drop) {
      removed.push(n.id);
      warnings.push(
        `node "${n.id}" removed as orphan (no dependents, not the terminal output)`,
      );
    }
    const dropIds = new Set(drop.map((n) => n.id));
    current = { nodes: current.nodes.filter((n) => !dropIds.has(n.id)) };
  }

  return { tree: current, removed, warnings };
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Build a `nodeId → Set<dependentId>` map in one O(N · D) walk where
 * D is the average dependency count per node.
 */
function buildDependentsMap(tree: FeatureTree): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const node of tree.nodes) {
    for (const dep of node.dependencies) {
      let set = map.get(dep);
      if (!set) {
        set = new Set<string>();
        map.set(dep, set);
      }
      set.add(node.id);
    }
  }
  return map;
}

/**
 * Find the terminal output node — the last non-suppressed node in
 * declared order. Returns null for a tree of all-suppressed nodes or
 * an empty tree (in either case there's nothing to preserve as a root).
 */
function findTerminalId(tree: FeatureTree): string | null {
  for (let i = tree.nodes.length - 1; i >= 0; i--) {
    const n = tree.nodes[i]!;
    if (!n.suppressed) return n.id;
  }
  return null;
}
