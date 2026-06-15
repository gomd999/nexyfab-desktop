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
  // Body nodes consumed by a boolean are rendered INSIDE the boolean's
  // combinator, so they are not also emitted as standalone top-level parts.
  const consumed = new Set<string>();
  for (const node of tree.nodes) {
    if (node.payload.kind === 'boolean') {
      for (const b of node.payload.bodies) consumed.add(b);
    }
  }
  const emitted: string[] = [];
  const parts: string[] = [];
  for (const node of tree.nodes) {
    let body: string;
    if (node.payload.kind === 'boolean') {
      // Topological order guarantees the body nodes were rendered already.
      const childScads = node.payload.bodies.map((bid) => perNode.get(bid) ?? '');
      body = booleanToScad(node.payload, childScads);
    } else {
      body = renderNode(node);
    }
    perNode.set(node.id, body);
    if (node.suppressed || consumed.has(node.id)) continue;
    emitted.push(node.id);
    parts.push(`// === ${node.id} (${node.name}) ===\n${body}`);
  }
  return { scad: parts.join('\n\n'), perNode, emittedOrder: emitted };
}

function renderNode(node: FeatureNode): string {
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
      return filletToScad(p);
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
