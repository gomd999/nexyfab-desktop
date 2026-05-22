/**
 * topologyRegistry.ts — persistent topological naming across a rebuild history.
 *
 * The signature matcher (edgeCorrespondence) re-resolves a selection against the
 * CURRENT solid each rebuild. That survives a single dimension/topology change,
 * but a fillet target should stay bound through a *chain* of edits (change a
 * dimension, then add a hole, then reorder a feature…). This registry adds the
 * missing persistence layer: it assigns each edge a stable id on first sight and
 * carries that id forward every rebuild by matching the new edge set against the
 * previous one. New topology mints fresh ids; vanished topology retires.
 *
 * This is the practical substitute for OCCT's history-based naming (which
 * replicad does not expose): instead of operation generated/modified maps, we
 * reconcile successive solid states by geometric signature. Pure + framework-
 * free so it unit-tests without the WASM kernel.
 */

import { bestEdgeMatch, normalizeEdgeDir, type EdgeSig } from './edgeCorrespondence';

export interface NamedEdge {
  id: string;
  sig: EdgeSig;
}

/** A current edge signature carrying its stable id — emitted on the pipeline
 *  result (userData.topoEdgeSignatures) so the selection layer can tag a click
 *  with a rebuild-stable id. */
export interface TaggedEdgeSig extends EdgeSig {
  id: string;
}

/**
 * Stable id of the edge a click lands on. A click sits *anywhere* along an edge
 * (not at its midpoint), so we pick the parallel edge whose infinite line is
 * nearest the click point, with the projection inside the edge's extent. Pure,
 * so the selection layer can tag a click without the OCCT kernel. Returns null
 * when no parallel edge passes near the point (`tol` mm).
 */
export function findStableEdgeId(
  tagged: TaggedEdgeSig[],
  position: [number, number, number],
  direction: [number, number, number],
  tol = 1.0,
): string | null {
  const tdir = normalizeEdgeDir(direction);
  let bestId: string | null = null;
  let bestPerp = Infinity;
  for (const e of tagged) {
    const cdir = normalizeEdgeDir(e.dir);
    const align = Math.abs(tdir[0] * cdir[0] + tdir[1] * cdir[1] + tdir[2] * cdir[2]);
    if (align < 0.95) continue; // must be parallel to the picked edge
    // Project the click onto the edge line through its midpoint.
    const wx = position[0] - e.mid[0], wy = position[1] - e.mid[1], wz = position[2] - e.mid[2];
    const t = wx * cdir[0] + wy * cdir[1] + wz * cdir[2];        // signed distance along the edge
    if (Math.abs(t) > e.length / 2 + 2) continue;                // click beyond the edge ends
    const px = wx - t * cdir[0], py = wy - t * cdir[1], pz = wz - t * cdir[2];
    const perp = Math.hypot(px, py, pz);                          // distance to the edge line
    if (perp < bestPerp) { bestPerp = perp; bestId = e.id; }
  }
  return bestPerp <= tol ? bestId : null;
}

/** Minimum match score for a current edge to inherit a previous edge's id. */
const INHERIT_THRESHOLD = 0.5;

/**
 * Carry stable edge ids forward from `prev` onto the current edge set
 * (`nextSigs`). Returns the named current edges (same order/length as nextSigs).
 *
 * Each current edge greedily claims the best-matching previous edge (highest
 * score first, 1:1) and inherits its id; current edges with no good match — new
 * topology from an added feature — get a fresh id from `mint`. Previous ids that
 * nothing claims simply retire (their topology was removed).
 */
export function reconcileEdges(
  prev: NamedEdge[],
  nextSigs: EdgeSig[],
  mint: () => string,
): NamedEdge[] {
  // Score every (current, previous) pair, keep each current edge's best.
  const prevSigs = prev.map(p => p.sig);
  const candidates: { nextIdx: number; prevIdx: number; score: number }[] = [];
  for (let n = 0; n < nextSigs.length; n++) {
    const { index, score } = bestEdgeMatch(nextSigs[n]!, prevSigs);
    if (index >= 0 && score >= INHERIT_THRESHOLD) {
      candidates.push({ nextIdx: n, prevIdx: index, score });
    }
  }
  // Assign highest-confidence matches first, enforcing a 1:1 prev→next mapping.
  candidates.sort((a, b) => b.score - a.score);
  const idForNext = new Array<string | null>(nextSigs.length).fill(null);
  const claimedPrev = new Set<number>();
  for (const c of candidates) {
    if (idForNext[c.nextIdx] !== null || claimedPrev.has(c.prevIdx)) continue;
    idForNext[c.nextIdx] = prev[c.prevIdx]!.id;
    claimedPrev.add(c.prevIdx);
  }
  // Materialise: inherited id where matched, a fresh id otherwise.
  return nextSigs.map((sig, n) => ({ id: idForNext[n] ?? mint(), sig }));
}

/**
 * Stateful namer that maintains stable edge ids over a sequence of rebuilds.
 * Feed it each rebuild's edge signatures; it returns the ids in edge order and
 * remembers them for the next reconcile.
 */
export class TopologyNamer {
  private seq = 0;
  private edges: NamedEdge[] = [];

  private mint = (): string => `e${this.seq++}`;

  /** Reconcile a new edge set, returning the stable id per edge (in order). */
  update(nextSigs: EdgeSig[]): string[] {
    this.edges = reconcileEdges(this.edges, nextSigs, this.mint);
    return this.edges.map(e => e.id);
  }

  /** Current edge index carrying `id`, or −1 if that id is no longer present. */
  indexOf(id: string): number {
    return this.edges.findIndex(e => e.id === id);
  }

  reset(): void {
    this.seq = 0;
    this.edges = [];
  }
}
