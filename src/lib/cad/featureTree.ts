/**
 * featureTree — Phase 2.6 starter of NexyFab Pro own-CAD (ADR-013).
 *
 * Stitches all per-feature IRs (extrude / revolve / sweep / loft / pattern)
 * into an ordered, dependency-aware tree that:
 *   1. enforces a topological order (a pattern can reference an extrude,
 *      but not vice versa);
 *   2. detects cycles;
 *   3. replays the whole tree into a single SCAD source by walking the
 *      order and concatenating each node's SCAD output.
 *
 * "Parametric history with edit-replay" (the full Phase 2.6 deliverable)
 * builds on this: editing a node's parameters should trigger replay of
 * that node and all downstream dependents. This starter establishes the
 * IR shape and the replay primitive; the diff-aware edit handler comes
 * next.
 *
 * Scope (Phase 2.6.1 minimal):
 *   - 5 feature kinds: extrude, revolve, sweep, loft, linear/circular pattern.
 *   - String dependencies (node id refs).
 *   - Linear replay (re-emit every node every time).
 *
 * Out of scope (Phase 2.6.2+):
 *   - Incremental replay (only re-emit changed nodes + dependents)
 *   - Undo/redo stack
 *   - Sketch IR as nodes (currently sketches live in the editor; their
 *     extracted profiles are inlined into feature IRs)
 *   - Cross-tree sharing (configurations / linked instances)
 */

import type { ExtrudeFeature } from './extrudeProfile';
import { extrudeToScad } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import { revolveToScad } from './revolveProfile';
import type { SweepFeature, LoftFeature } from './sweepLoft';
import { sweepToScad, loftToScad } from './sweepLoft';
import type { LinearPatternFeature, CircularPatternFeature } from './pattern';
import { linearPatternToScad, circularPatternToScad } from './pattern';
import type { HoleFeature } from './holeProfile';
import { holeToScad } from './holeProfile';
import type { FilletFeature } from './filletProfile';
import { filletToScad } from './filletProfile';
import type { ChamferFeature } from './chamferProfile';
import { chamferToScad } from './chamferProfile';
import type { RibFeature } from './ribFeature';
import { ribToScad } from './ribFeature';
import type { SweepPathFeature } from './sweepPath';
import { sweepPathToScad } from './sweepPath';
import type { BooleanFeature } from './booleanFeature';
import { booleanToScad } from './booleanFeature';

// ─── IR ───────────────────────────────────────────────────────────────────

export type FeatureKind =
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'linear_pattern'
  | 'circular_pattern'
  | 'hole'
  | 'fillet'
  | 'chamfer'
  | 'rib'
  | 'sweep_path'
  | 'boolean';

export type FeaturePayload =
  | ExtrudeFeature
  | RevolveFeature
  | SweepFeature
  | LoftFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | HoleFeature
  | FilletFeature
  | ChamferFeature
  | RibFeature
  | SweepPathFeature
  | BooleanFeature;

export interface FeatureNode {
  /** Stable id within the tree. Used for dependency refs + UI selection. */
  id: string;
  /** Human-readable label shown in the feature-tree UI panel. */
  name: string;
  /** When false, the node still renders SCAD but its parent body is
   *  suppressed in the output. UI shows as struck-through. */
  suppressed?: boolean;
  /** Ordered list of node ids this node depends on (must appear before
   *  this one in the tree). Empty for root-level features. */
  dependencies: ReadonlyArray<string>;
  payload: FeaturePayload;
}

export interface FeatureTree {
  /** Ordered list. Position determines render order; topological validity
   *  is checked by `validateTree`. */
  nodes: ReadonlyArray<FeatureNode>;
}

// ─── upstream references (W2-0 — see docs/design/w2-downstream-regen.md) ──
//
// A payload that consumes an upstream BODY must name it by node id, never
// embed a copy of it. Copies go stale the moment the upstream is edited,
// which is exactly the bug W2-0 fixes (roadmap §1).
//
// Three ref-carrying shapes cover all 12 FeatureKinds:
//   `childId: string`       — single upstream body  (fillet, chamfer, hole
//                             host, rib host, pattern seed, …)
//   `childIds: string[]`    — N upstream bodies     (future multi-body ops)
//   `bodies: string[]`      — boolean's pre-existing, already-correct form
//
// The reader below is deliberately duck-typed on `childId`/`childIds` so
// W2-A can convert the remaining 10 kinds WITHOUT editing this file.

/**
 * Node ids whose *rendered body* this payload consumes. Order is
 * significant (boolean difference is base-first).
 *
 * Returns `[]` for self-contained payloads and for legacy payloads still
 * carrying an embedded copy — those are emitted exactly as before, so
 * conversion is per-kind and incremental.
 */
export function upstreamRefsOf(payload: FeaturePayload): string[] {
  if (payload.kind === 'boolean') return [...payload.bodies];
  const single = (payload as { childId?: unknown }).childId;
  if (typeof single === 'string' && single.length > 0) return [single];
  const multi = (payload as { childIds?: unknown }).childIds;
  if (Array.isArray(multi)) {
    return multi.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return [];
}

/**
 * Resolution surface handed to a payload's SCAD emitter at replay time.
 *
 * Every accessor either returns a LIVE value from the tree currently being
 * replayed, or throws. There is no fallback to an embedded snapshot and no
 * silent substitution — ADR-017 D1 (no quiet guessing).
 */
export interface EmitContext {
  /** Live payload of `refId`. Throws if absent or of an unexpected kind. */
  requirePayload<K extends FeatureKind>(
    refId: string,
    forId: string,
    expectKind: K,
  ): Extract<FeaturePayload, { kind: K }>;
  /** Already-emitted SCAD body of `refId`. Throws if not yet rendered. */
  requireScad(refId: string, forId: string): string;
}

// ─── validation ───────────────────────────────────────────────────────────

export class FeatureTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureTreeError';
  }
}

/**
 * Verify that:
 *   - all node ids are unique;
 *   - every dependency points to a node that appears earlier in the list
 *     (this implicitly rules out cycles).
 *
 * Throws `FeatureTreeError` with a specific message on first violation.
 */
export function validateTree(tree: FeatureTree): void {
  const seen = new Set<string>();
  for (const node of tree.nodes) {
    if (!node.id) {
      throw new FeatureTreeError(`feature node has empty id (name=${node.name})`);
    }
    if (seen.has(node.id)) {
      throw new FeatureTreeError(`duplicate node id: ${node.id}`);
    }
    for (const dep of node.dependencies) {
      if (dep === node.id) {
        throw new FeatureTreeError(`node ${node.id} depends on itself`);
      }
      if (!seen.has(dep)) {
        throw new FeatureTreeError(
          `node ${node.id} depends on ${dep}, which appears later or not at all`,
        );
      }
    }
    // W2-0 integrity invariant: every upstream body a payload names must
    // also be a declared dependency. This is what makes "cycle" and
    // "dangling ref" structurally impossible rather than a runtime hazard:
    // dependencies are already proven to appear EARLIER in the list, so a
    // ref can only ever point backwards.
    for (const ref of upstreamRefsOf(node.payload)) {
      if (!node.dependencies.includes(ref)) {
        throw new FeatureTreeError(
          `node ${node.id} references upstream body ${ref} in its payload but ` +
            `does not declare it in dependencies (declared: [${node.dependencies.join(', ')}])`,
        );
      }
    }
    seen.add(node.id);
  }
}

// ─── replay ───────────────────────────────────────────────────────────────

export interface ReplayResult {
  /** Concatenated SCAD source for the whole tree. */
  scad: string;
  /** Per-node SCAD bodies, keyed by node id. Useful for incremental
   *  editor previews and for cache-keys. */
  perNode: ReadonlyMap<string, string>;
  /** Order in which nodes contributed to `scad`. Matches tree.nodes order
   *  with suppressed nodes filtered out. */
  emittedOrder: ReadonlyArray<string>;
  /** Nodes skipped because an upstream body they REFERENCE is suppressed
   *  (not because they were suppressed themselves). Surfaced so the UI can
   *  show "suppressed (parent)" instead of silently dropping geometry. */
  autoSuppressed: ReadonlyArray<string>;
}

/**
 * Walk the tree in declared order and emit SCAD source for each node.
 * Suppressed nodes are skipped (their dependents still see them as a
 * dependency for graph validation, but no SCAD is emitted).
 *
 * Returns both the concatenated source and the per-node breakdown so the
 * editor can highlight a specific feature's contribution.
 */
export function replayTree(tree: FeatureTree): ReplayResult {
  validateTree(tree);
  const perNode = new Map<string, string>();
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));

  // A body consumed by a downstream feature is rendered INSIDE that
  // feature's output, so it must not ALSO appear as a standalone top-level
  // part. Previously boolean-only; now uniform across every ref-carrying
  // payload (a filleted box must not emit the sharp box alongside it).
  const consumed = new Set<string>();
  for (const node of tree.nodes) {
    for (const ref of upstreamRefsOf(node.payload)) consumed.add(ref);
  }

  // Suppression cascades along references. Suppressing an extrude cannot
  // leave a fillet-of-that-extrude standing — there is no body to round.
  // We skip the dependent rather than guess a substitute geometry, and
  // report it in `autoSuppressed`. Single forward pass is sufficient
  // because validateTree proved refs point strictly backwards.
  const effSuppressed = new Set<string>();
  const autoSuppressed: string[] = [];
  for (const node of tree.nodes) {
    if (node.suppressed) {
      effSuppressed.add(node.id);
      continue;
    }
    const blocked = upstreamRefsOf(node.payload).find((r) => effSuppressed.has(r));
    if (blocked !== undefined) {
      effSuppressed.add(node.id);
      autoSuppressed.push(node.id);
    }
  }

  function requirePayload<K extends FeatureKind>(
    refId: string,
    forId: string,
    expectKind: K,
  ): Extract<FeaturePayload, { kind: K }> {
    const target = byId.get(refId);
    if (!target) {
      throw new FeatureTreeError(
        `node ${forId} references upstream body ${refId}, which is not in the tree`,
      );
    }
    if (target.payload.kind !== expectKind) {
      throw new FeatureTreeError(
        `node ${forId} requires upstream ${refId} to be a '${expectKind}' feature, ` +
          `but it is '${target.payload.kind}'`,
      );
    }
    return target.payload as Extract<FeaturePayload, { kind: K }>;
  }

  function requireScad(refId: string, forId: string): string {
    const s = perNode.get(refId);
    if (s === undefined) {
      throw new FeatureTreeError(
        `node ${forId} references upstream body ${refId}, which has not been rendered ` +
          `(it must appear earlier in the tree)`,
      );
    }
    return s;
  }

  const ctx: EmitContext = { requirePayload, requireScad };

  const emitted: string[] = [];
  const parts: string[] = [];
  for (const node of tree.nodes) {
    let body: string;
    if (node.payload.kind === 'boolean') {
      // Topological order guarantees the body nodes were rendered already.
      const childScads = node.payload.bodies.map((bid) => ctx.requireScad(bid, node.id));
      body = booleanToScad(node.payload, childScads);
    } else {
      body = renderNode(node, ctx);
    }
    // Suppressed nodes are still RENDERED into perNode (editor previews and
    // cache-keys want the body); they are only withheld from `scad`.
    perNode.set(node.id, body);
    if (effSuppressed.has(node.id) || consumed.has(node.id)) continue;
    emitted.push(node.id);
    parts.push(`// === ${node.id} (${node.name}) ===\n${body}`);
  }
  return { scad: parts.join('\n\n'), perNode, emittedOrder: emitted, autoSuppressed };
}

function renderNode(node: FeatureNode, ctx: EmitContext): string {
  const p = node.payload;
  switch (p.kind) {
    case 'extrude':
      return extrudeToScad(p);
    case 'revolve':
      return revolveToScad(p);
    case 'sweep':
      return sweepToScad(p);
    case 'loft':
      return loftToScad(p);
    case 'linear_pattern':
      return linearPatternToScad(p);
    case 'circular_pattern':
      return circularPatternToScad(p);
    case 'hole':
      return holeToScad(p);
    case 'fillet':
      return filletToScad(p, ctx, node.id);
    case 'chamfer':
      return chamferToScad(p);
    case 'rib':
      return ribToScad(p);
    case 'sweep_path':
      return sweepPathToScad(p);
    case 'boolean':
      // Booleans need their body nodes' SCAD, which only replayTree has; it
      // intercepts this kind before renderNode is reached.
      throw new FeatureTreeError('boolean features are resolved by replayTree, not renderNode');
  }
}

// ─── edit helpers (Phase 2.6.2 lays incremental replay on top of these) ──

/**
 * W2-0 migration bridge — refresh every stale embedded snapshot in `tree`
 * from the live upstream node it references.
 *
 * Ref-mode payloads keep a `childExtrude`-style snapshot alongside
 * `childId` for consumers not yet converted (`lib/occt/featurePlan.ts`,
 * `brep-bridge/stepWriteFilletChamfer.ts`, `featureTreeStats.ts`). Those
 * consumers read the snapshot, so it must be re-synced before they run or
 * they see pre-edit geometry — the very staleness W2-0 removes from the
 * SCAD path.
 *
 * Returns a NEW tree; the input is untouched. Nodes with nothing to sync
 * are passed through by reference so downstream `diffTrees` reference
 * equality still holds for them.
 *
 * This is scaffolding with a fixed lifetime: once every consumer resolves
 * refs through `EmitContext`, the snapshot fields and this function are
 * deleted together.
 */
export function syncEmbeddedSnapshots(tree: FeatureTree): FeatureTree {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const nodes = tree.nodes.map((node) => {
    const p = node.payload as { childId?: unknown; childExtrude?: unknown };
    if (typeof p.childId !== 'string' || p.childExtrude === undefined) return node;
    const upstream = byId.get(p.childId);
    if (!upstream) {
      throw new FeatureTreeError(
        `syncEmbeddedSnapshots: node ${node.id} references ${p.childId}, which is not in the tree`,
      );
    }
    if (upstream.payload.kind !== 'extrude') {
      throw new FeatureTreeError(
        `syncEmbeddedSnapshots: node ${node.id} references ${p.childId}, which is ` +
          `'${upstream.payload.kind}' and cannot back a childExtrude snapshot`,
      );
    }
    if (p.childExtrude === upstream.payload) return node; // already in sync
    return { ...node, payload: { ...node.payload, childExtrude: upstream.payload } };
  });
  return { nodes };
}

/**
 * Return the set of node ids that depend (transitively) on `targetId`.
 * Used by future incremental replay to decide which nodes to re-emit
 * after a parameter edit.
 */
export function downstreamOf(tree: FeatureTree, targetId: string): Set<string> {
  const dependents = new Map<string, Set<string>>();
  for (const node of tree.nodes) {
    for (const dep of node.dependencies) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(node.id);
    }
  }
  const out = new Set<string>();
  const stack = [targetId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of dependents.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}
