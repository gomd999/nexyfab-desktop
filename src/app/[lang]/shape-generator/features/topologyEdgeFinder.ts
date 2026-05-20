/**
 * topologyEdgeFinder.ts — Phase 3-c-1 spike (Topology Naming Problem)
 *
 * Bridge between NexyFab's selection model (`EdgeSelectionInfo`) and
 * replicad's `EdgeFinder` predicate. The bridge is what lets a fillet
 * feature continue to target *the same edge* after an upstream sketch
 * parameter change — without it, the user-clicked edge becomes a stale
 * triangle index after the next remesh and the feature silently drifts.
 *
 * **Scope of this spike** (intentionally small):
 *   1. Convert a single click-point selection into an EdgeFinder that
 *      matches one specific edge by spatial position.
 *   2. Stay opaque about replicad's internal API — we only call the
 *      builder methods documented in replicad's README so future
 *      version bumps don't break us. Strong typing of EdgeFinder itself
 *      is deferred until phase 3-c-2.
 *   3. No production wiring. The pipeline manager keeps using the
 *      pass-through `edgeFinder?` slot already present in
 *      `occtFilletBox` / `occtChamferBox`.
 *
 * **Out of scope** (logged as follow-ups):
 *   - Multi-edge selection (an array of finders chained with `.or()`).
 *   - Direction-based finders (`inDirection`) — needed when the user
 *     selects an edge loop (e.g. "all four top edges of the box").
 *   - Robustness against B-rep splits / merges across boolean ops.
 *
 * Tested manually via the OCCT-feasibility vitest harness (see the
 * companion `topologyEdgeFinder.spike.test.ts`, skipped unless
 * `RUN_OCCT_FEASIBILITY=1`).
 */

import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import type { ReplicadEdgeFinder } from './occtEngine';

/** The subset of EdgeFinder builder methods we rely on. Pulled from
 *  replicad's README — kept here as a typed shim so consumers don't
 *  need to import `replicad` directly. */
interface EdgeFinderBuilder {
  containsPoint: (point: [number, number, number], tolerance?: number) => EdgeFinderBuilder;
  inDirection: (direction: [number, number, number]) => EdgeFinderBuilder;
  ofLength: (length: number, tolerance?: number) => EdgeFinderBuilder;
  /** OR-combine with another finder. Multi-edge selection composes
   *  per-edge finders with .or() so OCCT matches any of them. */
  either?: (finders: EdgeFinderBuilder[]) => EdgeFinderBuilder;
  or?: (other: EdgeFinderBuilder) => EdgeFinderBuilder;
}

/** Dynamic-import lookup so this module doesn't drag `replicad` into the
 *  type graph at compile time. Returns null when replicad hasn't been
 *  initialised (e.g. on the server before WASM load, or in unit tests
 *  without the OCCT_FEASIBILITY flag). */
async function getEdgeFinderConstructor(): Promise<{ new(): EdgeFinderBuilder } | null> {
  try {
    const rc = (await import('replicad')) as unknown as { EdgeFinder?: new () => EdgeFinderBuilder };
    return rc.EdgeFinder ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a replicad EdgeFinder predicate from a NexyFab edge selection.
 *
 * Strategy (single-edge case): combine `containsPoint` with the click
 * location + an `ofLength` filter using the recorded edge length. This
 * is more discriminating than position alone — two edges meeting at the
 * click point share `containsPoint`, but the length filter breaks ties.
 *
 * Returns `null` when replicad isn't available (the caller should fall
 * back to the previous "fillet every edge" behaviour rather than crash).
 */
export async function buildEdgeFinderFromSelection(
  selection: EdgeSelectionInfo,
  opts: { positionTolerance?: number; lengthTolerance?: number } = {},
): Promise<ReplicadEdgeFinder | null> {
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return null;
  // replicad's EdgeFinder may throw if OCCT WASM hasn't initialised yet
  // (e.g. tests that load the module but skip ensureOcctReady). Failing
  // fast with `null` matches the "no replicad" path so the caller's
  // fallback path is the same.
  try {
    const f = new Ctor()
      .containsPoint(selection.position, opts.positionTolerance ?? 0.5);
    if (Number.isFinite(selection.length) && selection.length > 0) {
      return f.ofLength(selection.length, opts.lengthTolerance ?? 0.1) as unknown as ReplicadEdgeFinder;
    }
    return f as unknown as ReplicadEdgeFinder;
  } catch {
    return null;
  }
}

/** Pick a "shared direction" for a group of edges so a single
 *  `inDirection` filter captures the full loop (e.g. all four top
 *  edges of a box share +Z normal-of-face × axis-of-edge).
 *
 *  Heuristic: take the per-selection face normal, find the dominant
 *  axis (max-abs component) across the group. If a clear winner
 *  (≥ 75% agreement) exists, return the unit vector. Otherwise
 *  return null — caller should fall back to multi-edge .or() finder.
 */
export function inferLoopDirection(
  selections: EdgeSelectionInfo[],
): [number, number, number] | null {
  if (selections.length < 2) return null;
  const axisVotes = [0, 0, 0]; // X, Y, Z
  const axisSign = [0, 0, 0];  // +/- sign for the winning axis
  for (const sel of selections) {
    const n = sel.normal;
    const abs = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    const max = Math.max(...abs);
    const idx = abs.indexOf(max);
    axisVotes[idx]!++;
    axisSign[idx]! += n[idx]! >= 0 ? 1 : -1;
  }
  const winnerIdx = axisVotes.indexOf(Math.max(...axisVotes));
  const winnerVotes = axisVotes[winnerIdx]!;
  if (winnerVotes / selections.length < 0.75) return null;
  const sign = axisSign[winnerIdx]! >= 0 ? 1 : -1;
  const dir: [number, number, number] = [0, 0, 0];
  dir[winnerIdx] = sign;
  return dir;
}

/**
 * Build an EdgeFinder that matches a *loop* of edges by direction.
 * Cheaper to query than multi-edge .or() when the user really meant
 * "all top edges" rather than "these four specific edges".
 *
 * Returns null if direction can't be inferred (mixed normals) or
 * replicad isn't loaded — callers should chain to
 * `buildEdgeFinderFromMultiSelection` as the fallback.
 */
export async function buildEdgeFinderForLoop(
  selections: EdgeSelectionInfo[],
  opts: { positionTolerance?: number } = {},
): Promise<ReplicadEdgeFinder | null> {
  const dir = inferLoopDirection(selections);
  if (!dir) return null;
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return null;
  try {
    const f = new Ctor().inDirection(dir);
    // Anchor the direction filter with a single representative point
    // so we don't match every parallel edge in the model — only those
    // sharing the loop's plane region.
    const rep = selections[0]!;
    return f.containsPoint(rep.position, opts.positionTolerance ?? 5.0) as unknown as ReplicadEdgeFinder;
  } catch {
    return null;
  }
}

/**
 * Build a single finder that matches *any* of the supplied edges.
 *
 * replicad's `EdgeFinder` exposes two OR shapes across versions —
 * `.either([f1, f2, ...])` and `.or(other)`. We probe both at call time
 * because pinning to one breaks on upstream renames. If neither is
 * available, the single-edge fallback is the first selection — better
 * than returning null and filleting every edge.
 */
export async function buildEdgeFinderFromMultiSelection(
  selections: EdgeSelectionInfo[],
  opts: { positionTolerance?: number; lengthTolerance?: number } = {},
): Promise<ReplicadEdgeFinder | null> {
  if (selections.length === 0) return null;
  if (selections.length === 1) {
    return buildEdgeFinderFromSelection(selections[0]!, opts);
  }
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return null;

  const posTol = opts.positionTolerance ?? 0.5;
  const lenTol = opts.lengthTolerance ?? 0.1;

  try {
    const finders: EdgeFinderBuilder[] = [];
    for (const sel of selections) {
      let f = new Ctor().containsPoint(sel.position, posTol);
      if (Number.isFinite(sel.length) && sel.length > 0) {
        f = f.ofLength(sel.length, lenTol);
      }
      finders.push(f);
    }

    const head = finders[0]!;
    // Prefer .either([…]) if replicad exposes it.
    if (typeof head.either === 'function') {
      return head.either(finders.slice(1)) as unknown as ReplicadEdgeFinder;
    }
    // Fall back to chained .or() pairs.
    if (typeof head.or === 'function') {
      let combined: EdgeFinderBuilder = head;
      for (let i = 1; i < finders.length; i++) {
        combined = combined.or!(finders[i]!);
      }
      return combined as unknown as ReplicadEdgeFinder;
    }
    // Neither — degrade to the first selection alone.
    return head as unknown as ReplicadEdgeFinder;
  } catch {
    return null;
  }
}
