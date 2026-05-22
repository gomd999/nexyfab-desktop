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

import { bestEdgeMatch, type EdgeSig } from './edgeCorrespondence';

export interface NamedEdge {
  id: string;
  sig: EdgeSig;
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
