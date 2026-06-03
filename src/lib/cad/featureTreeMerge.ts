/**
 * featureTreeMerge — semantic merge strategies for FeatureTree.
 *
 * Companion to featureTreeOps.ts (which provides STRUCTURAL merge via
 * mergeTrees: id-collision based, suffix/prefix/skip). This module adds
 * four SEMANTIC strategies on top that look past the id key into the
 * payload itself:
 *
 *   - 'structural'      — Delegates to featureTreeOps.mergeTrees with the
 *                         default 'suffix' collision policy. Provided here
 *                         only so callers can pick "any strategy" from a
 *                         single dispatcher without branching to a second
 *                         module.
 *
 *   - 'semantic_dedup'  — Walks the concatenated base+other node list and
 *                         drops every node whose payload deep-equals an
 *                         EARLIER node's payload (regardless of id). The
 *                         kept node's id is reused everywhere the dropped
 *                         id was referenced (deps + later payload refs).
 *                         Use case: pasting a sub-assembly whose primitive
 *                         features the base tree already contains —
 *                         deduplication keeps replay output identical to a
 *                         naive merge but with fewer nodes.
 *
 *                         "Payload deep-equal" here ignores id and name
 *                         (those are bookkeeping, not geometry); kind +
 *                         payload structure + suppressed flag + dependency
 *                         REFERENCES (after remap to canonical ids) are
 *                         what counts. Two nodes that build the same
 *                         primitive from differently-named sketches still
 *                         dedupe so long as their dependencies resolve to
 *                         the same canonical predecessors.
 *
 *   - 'last_wins'       — For every id that appears in BOTH base and
 *                         other, the OTHER tree's node replaces base's.
 *                         Ids unique to base or other are kept verbatim.
 *                         The merged order is: base order (with replaced
 *                         payloads), followed by other-only nodes in
 *                         other's declared order. Use case: collaborator
 *                         pushed an updated tree; their version is canon.
 *
 *   - 'first_wins'      — Mirror of last_wins: base's version wins for
 *                         every shared id. Other-only nodes are still
 *                         appended (so this is NOT "ignore other entirely"
 *                         — it's "keep base where they disagree, take
 *                         other's new contributions"). Cascade applies:
 *                         any other-only node whose deps include a SHARED
 *                         id is fine (the shared id still exists, just
 *                         with base's payload); no node ever needs to be
 *                         dropped here.
 *
 *   - 'composite'       — No deduplication, no replacement. Both trees
 *                         are concatenated, id collisions get the suffix
 *                         treatment (same as structural), AND every node
 *                         is tagged with an `originalSource: 'base' |
 *                         'other'` annotation so downstream UIs can color
 *                         or filter by origin. This is the "what did each
 *                         collaborator contribute?" view, not a logical
 *                         merge of geometry.
 *
 * Design notes:
 *
 *   1) Why a SEPARATE module from featureTreeOps?
 *      featureTreeOps holds STRUCTURAL primitives (id-keyed clone / merge
 *      / diff / extract). Semantic operations need to peek into payloads,
 *      which introduces a dependency on the stable-equality machinery and
 *      a different set of edge cases (cascading deps when an id is
 *      replaced, originalSource tagging, etc.). Splitting them keeps the
 *      structural layer auditable and free of payload-aware logic.
 *
 *   2) Why is `originalSource` an extra property instead of a real field
 *      on FeatureNode?
 *      The constraint for this module is "do NOT modify featureTree.ts".
 *      TypeScript interfaces accept extra properties on the runtime object
 *      without complaint, but consumers can't reference them via the
 *      FeatureNode type. We expose `CompositeFeatureNode` (extends
 *      FeatureNode with the source tag) for the typed surface, and the
 *      runtime cast in `tagSource()` is the only place we widen the
 *      interface.
 *
 *   3) Deduplication equality (semantic_dedup):
 *      Uses the same stable JSON serialization as featureTreeOps's diff
 *      (sorted object keys, preserved array order). We DO compare the
 *      `suppressed` flag — two extrudes with the same geometry but
 *      different suppression states are DIFFERENT semantically (one
 *      contributes to the model, the other doesn't). We do NOT compare
 *      `id` or `name`; those are bookkeeping, not geometry.
 *
 *      Dependencies need a subtle pass: if node X in `other` depends on
 *      node Y which gets deduped against node Y' in `base`, then X's dep
 *      must be rewritten to Y' BEFORE we compute X's payload key.
 *      Otherwise two structurally-identical patterns (both pointing at
 *      "their own" extrude) would FAIL to dedupe because their dep lists
 *      list different ids. The implementation does one forward pass:
 *      remap deps using the running dedupMap, then key the node.
 *
 *   4) Cascading drops are NOT used here.
 *      In structural merge, dropping a node forces cascading drops of its
 *      dependents (otherwise validateTree breaks). In semantic_dedup the
 *      "dropped" node is replaced by an equivalent — dependents have a
 *      valid id to point to. In last_wins / first_wins both versions of
 *      the id stay in the tree (just with different payloads), so deps
 *      are always resolvable. Composite never drops.
 *
 *   5) Validation:
 *      Every returned tree passes `validateTree` before return — same
 *      contract as featureTreeOps.mergeTrees. If a strategy produces an
 *      invalid tree it's a bug in this module, not a user error.
 *
 * Out of scope:
 *   - Three-way merge with a common ancestor — that's the CRDT layer
 *     (Phase 2.11+). All five strategies here are two-way.
 *   - Conflict resolution UI — this module returns enough metadata
 *     (replacedNodes, warnings) for a UI to surface the diff, but it
 *     does not itself render anything.
 *   - Cross-payload semantic equivalence (e.g. two different extrude
 *     profiles whose SCAD output happens to be identical). We compare
 *     IRs, not rendered geometry.
 */

import {
  validateTree,
  type FeatureNode,
  type FeatureTree,
} from './featureTree';
import {
  cloneTree,
  mergeTrees,
  type MergeOptions,
} from './featureTreeOps';

// ─── public types ─────────────────────────────────────────────────────────

export type MergeStrategy =
  | 'structural'
  | 'semantic_dedup'
  | 'last_wins'
  | 'first_wins'
  | 'composite';

/** Source-tag annotation for the 'composite' strategy. Attached to the
 *  runtime node object via a widening cast (FeatureNode has no such
 *  field in featureTree.ts, which we cannot modify). */
export interface CompositeFeatureNode extends FeatureNode {
  originalSource: 'base' | 'other';
}

export interface SemanticMergeResult {
  /** The merged tree. Always passes validateTree. */
  merged: FeatureTree;
  /** Which strategy was applied (echoed for caller convenience — useful
   *  when the dispatcher is wrapped behind a config). */
  strategy: MergeStrategy;
  /** How many nodes were eliminated by deduplication (semantic_dedup
   *  only; 0 for every other strategy). */
  dedupedCount: number;
  /** Every node id that had two competing versions, plus which one was
   *  kept. Populated by last_wins, first_wins, and semantic_dedup; empty
   *  for structural and composite. */
  replacedNodes: ReadonlyArray<{ id: string; kept: 'base' | 'other' }>;
  /** Non-fatal advisories (e.g. dependencies that couldn't be remapped,
   *  oddities the caller might want to surface in a merge-preview UI). */
  warnings: ReadonlyArray<string>;
}

// ─── dispatcher ───────────────────────────────────────────────────────────

/**
 * Merge two FeatureTrees under the chosen strategy. Pure function — neither
 * `base` nor `other` is mutated. The result is always validated before
 * return.
 */
export function semanticMergeTrees(
  base: FeatureTree,
  other: FeatureTree,
  strategy: MergeStrategy,
): SemanticMergeResult {
  // Defensive validation of inputs (cheap, and a much friendlier error
  // than a downstream renderer crash).
  validateTree(base);
  validateTree(other);

  switch (strategy) {
    case 'structural':
      return runStructural(base, other);
    case 'semantic_dedup':
      return runSemanticDedup(base, other);
    case 'last_wins':
      return runLastWins(base, other);
    case 'first_wins':
      return runFirstWins(base, other);
    case 'composite':
      return runComposite(base, other);
  }
}

// ─── structural ──────────────────────────────────────────────────────────

function runStructural(
  base: FeatureTree,
  other: FeatureTree,
): SemanticMergeResult {
  // Default collision policy = 'suffix' (matches mergeTrees default).
  const opts: MergeOptions = { collisionStrategy: 'suffix' };
  const { merged, remappedIds } = mergeTrees(base, other, opts);
  const warnings: string[] = [];
  if (remappedIds.size > 0) {
    warnings.push(
      `structural merge renamed ${remappedIds.size} colliding id(s) with suffix policy`,
    );
  }
  // validateTree already ran inside mergeTrees, but re-asserting here is
  // cheap and documents the contract.
  validateTree(merged);
  return {
    merged,
    strategy: 'structural',
    dedupedCount: 0,
    replacedNodes: [],
    warnings,
  };
}

// ─── semantic_dedup ──────────────────────────────────────────────────────

function runSemanticDedup(
  base: FeatureTree,
  other: FeatureTree,
): SemanticMergeResult {
  const warnings: string[] = [];
  const replaced: Array<{ id: string; kept: 'base' | 'other' }> = [];

  // We walk base first, then other. For each node we:
  //   1. remap its dependencies to canonical ids (via dedupMap).
  //   2. compute a payload-aware key (kind + payload + suppressed + deps).
  //   3. if key already seen, the new node is "deduped to" the existing
  //      one; record id remap and skip.
  //   4. otherwise, push a fresh node (with remapped deps) into out.
  //
  // dedupMap[oldId] -> canonicalId. Resolves transitively in deps lookup.

  const out: FeatureNode[] = [];
  const keyToCanonicalId = new Map<string, string>();
  const dedupMap = new Map<string, string>();
  let dedupedCount = 0;
  // Track every id already used in `out` so we can detect (and rename)
  // a same-id collision where the payloads DIFFER. Two nodes with the
  // same id but different payloads cannot both live in the result; we
  // suffix-rename the second one (and surface it in replacedNodes so
  // the caller knows base was kept canonically).
  const usedOutIds = new Set<string>();

  const consume = (node: FeatureNode, source: 'base' | 'other') => {
    // Remap deps to canonical ids via the running dedupMap.
    const remappedDeps = node.dependencies.map((d) => dedupMap.get(d) ?? d);
    const keyedNode: FeatureNode = {
      id: node.id,
      name: node.name,
      ...(node.suppressed !== undefined ? { suppressed: node.suppressed } : {}),
      dependencies: remappedDeps,
      payload: node.payload,
    };
    const key = payloadKey(keyedNode);
    const existingCanonical = keyToCanonicalId.get(key);
    if (existingCanonical !== undefined) {
      // Duplicate. Remap this id to the canonical one and drop the node.
      dedupMap.set(node.id, existingCanonical);
      dedupedCount += 1;
      if (node.id !== existingCanonical) {
        replaced.push({ id: node.id, kept: source === 'other' ? 'base' : 'other' });
      } else {
        // Same id, same payload — silent dedup (the literal same node
        // showed up twice; legitimate when other re-imports base).
        replaced.push({ id: node.id, kept: 'base' });
      }
      return;
    }
    // Not a duplicate. Choose an output id, renaming if it collides with
    // an already-emitted, payload-DIFFERENT node.
    let outId = node.id;
    if (usedOutIds.has(outId)) {
      outId = nextSuffixId(outId, usedOutIds);
      dedupMap.set(node.id, outId);
      warnings.push(
        `semantic_dedup: ${source} node "${node.id}" renamed to "${outId}" — same id, different payload`,
      );
      replaced.push({ id: node.id, kept: source === 'other' ? 'base' : 'other' });
    }
    usedOutIds.add(outId);
    keyToCanonicalId.set(key, outId);
    // Re-key with the (possibly renamed) outId so future deps resolve to it.
    out.push({
      id: outId,
      name: keyedNode.name,
      ...(keyedNode.suppressed !== undefined ? { suppressed: keyedNode.suppressed } : {}),
      dependencies: keyedNode.dependencies,
      payload: keyedNode.payload,
    });
  };

  // Process base first so base ids are "canonical" by convention.
  for (const node of base.nodes) consume(node, 'base');
  for (const node of other.nodes) consume(node, 'other');

  const merged: FeatureTree = { nodes: out };
  const cloned = cloneTree(merged);
  validateTree(cloned);
  return {
    merged: cloned,
    strategy: 'semantic_dedup',
    dedupedCount,
    replacedNodes: replaced,
    warnings,
  };
}

// ─── last_wins ────────────────────────────────────────────────────────────

function runLastWins(
  base: FeatureTree,
  other: FeatureTree,
): SemanticMergeResult {
  const warnings: string[] = [];
  const replaced: Array<{ id: string; kept: 'base' | 'other' }> = [];

  const otherById = new Map(other.nodes.map((n) => [n.id, n]));
  const baseIds = new Set(base.nodes.map((n) => n.id));

  const out: FeatureNode[] = [];
  for (const bn of base.nodes) {
    const overlay = otherById.get(bn.id);
    if (overlay) {
      replaced.push({ id: bn.id, kept: 'other' });
      out.push(cloneNode(overlay));
    } else {
      out.push(cloneNode(bn));
    }
  }
  for (const on of other.nodes) {
    if (!baseIds.has(on.id)) {
      out.push(cloneNode(on));
    }
  }

  const merged: FeatureTree = { nodes: out };
  try {
    validateTree(merged);
  } catch (e) {
    warnings.push(
      `last_wins: overlay produced invalid topology (${(e as Error).message})`,
    );
    throw e;
  }
  return {
    merged,
    strategy: 'last_wins',
    dedupedCount: 0,
    replacedNodes: replaced,
    warnings,
  };
}

// ─── first_wins ──────────────────────────────────────────────────────────

function runFirstWins(
  base: FeatureTree,
  other: FeatureTree,
): SemanticMergeResult {
  const warnings: string[] = [];
  const replaced: Array<{ id: string; kept: 'base' | 'other' }> = [];

  const baseIds = new Set(base.nodes.map((n) => n.id));

  const out: FeatureNode[] = base.nodes.map((n) => cloneNode(n));
  for (const on of other.nodes) {
    if (baseIds.has(on.id)) {
      replaced.push({ id: on.id, kept: 'base' });
      // Skipped — base wins. No cascade needed because the id still
      // exists in `out`; dependents in `other` still resolve.
      continue;
    }
    out.push(cloneNode(on));
  }

  const merged: FeatureTree = { nodes: out };
  try {
    validateTree(merged);
  } catch (e) {
    warnings.push(
      `first_wins: overlay produced invalid topology (${(e as Error).message})`,
    );
    throw e;
  }
  return {
    merged,
    strategy: 'first_wins',
    dedupedCount: 0,
    replacedNodes: replaced,
    warnings,
  };
}

// ─── composite ───────────────────────────────────────────────────────────

function runComposite(
  base: FeatureTree,
  other: FeatureTree,
): SemanticMergeResult {
  const warnings: string[] = [];

  // Structural merge with suffix collision (so both halves survive).
  const { merged: structMerged, remappedIds } = mergeTrees(base, other, {
    collisionStrategy: 'suffix',
  });

  // Tag base ids that appear in the original `base.nodes` and tag the
  // rest as 'other'. Note: an id that was renamed (collision) will land
  // under its new id in structMerged — we still tag those as 'other'
  // because they came from the `other` tree.
  const baseIds = new Set(base.nodes.map((n) => n.id));
  const taggedNodes: FeatureNode[] = structMerged.nodes.map((n) => {
    const wasBase = baseIds.has(n.id);
    return tagSource(n, wasBase ? 'base' : 'other');
  });

  if (remappedIds.size > 0) {
    warnings.push(
      `composite: ${remappedIds.size} id collision(s) suffix-renamed; originalSource tag preserved`,
    );
  }

  const merged: FeatureTree = { nodes: taggedNodes };
  validateTree(merged);
  return {
    merged,
    strategy: 'composite',
    dedupedCount: 0,
    replacedNodes: [],
    warnings,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Attach an `originalSource` tag to a FeatureNode. The field is not part
 * of the FeatureNode interface (we cannot modify featureTree.ts), so we
 * widen with a runtime cast and a typed wrapper for the return value.
 */
function tagSource(node: FeatureNode, source: 'base' | 'other'): FeatureNode {
  const out: CompositeFeatureNode = {
    id: node.id,
    name: node.name,
    ...(node.suppressed !== undefined ? { suppressed: node.suppressed } : {}),
    dependencies: [...node.dependencies],
    payload: JSON.parse(JSON.stringify(node.payload)),
    originalSource: source,
  };
  return out;
}

/** Deep clone a single node via JSON round-trip (same invariant as
 *  cloneTree — all payloads are plain JSON). */
function cloneNode(node: FeatureNode): FeatureNode {
  return JSON.parse(JSON.stringify(node)) as FeatureNode;
}

/**
 * Compute a deterministic key for a node based on its SEMANTIC content
 * (everything that influences replay output) — excluding the id and the
 * human-readable name, which are bookkeeping. Used by semantic_dedup.
 */
function payloadKey(node: FeatureNode): string {
  const normalized = {
    kind: (node.payload as { kind: string }).kind,
    suppressed: node.suppressed ?? false,
    dependencies: [...node.dependencies],
    payload: node.payload,
  };
  return stableStringify(normalized);
}

/**
 * JSON.stringify with deterministic key order. Arrays preserve order
 * (load-bearing for sketch loops, pattern direction, dependency lists);
 * object keys are sorted lexicographically. Same algorithm as
 * featureTreeOps.stableStringify — duplicated here to keep this module
 * self-contained (we cannot widen featureTreeOps's exports per the
 * constraints, and importing a private helper would be brittle).
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
  const parts = entries.map(
    ([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`,
  );
  return `{${parts.join(',')}}`;
}

/**
 * Pick the next available `__N` suffix for `id` that doesn't collide
 * with `reserved`. Starts at __2 to match featureTreeOps.mergeTrees
 * convention.
 */
function nextSuffixId(id: string, reserved: ReadonlySet<string>): string {
  let i = 2;
  while (reserved.has(`${id}__${i}`)) i += 1;
  return `${id}__${i}`;
}
