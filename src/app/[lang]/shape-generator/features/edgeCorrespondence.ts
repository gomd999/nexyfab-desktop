/**
 * edgeCorrespondence.ts — geometric edge matching for topology tracking.
 *
 * replicad (and the OCCT WASM under it) exposes no history-based topological
 * naming: after a rebuild the edge ids regenerate, so a stored fillet target
 * can't be recovered by id. The practical substitute is *correspondence by
 * geometric signature* — enumerate the current solid's edges and pick the one
 * that best matches the stored edge's direction, length, and (scale-normalized)
 * midpoint. Unlike a stale absolute click point, this re-anchors onto the real
 * current edge, so a fillet selection survives not just dimension edits but
 * also topology changes that leave the target edge intact (e.g. a hole added
 * elsewhere on the part).
 *
 * Pure + framework-free so it unit-tests without the OCCT WASM.
 */

export interface EdgeSig {
  /** Edge midpoint (chord midpoint for curved edges). */
  mid: [number, number, number];
  /** Unit edge direction, sign-normalised (an edge and its reverse match). */
  dir: [number, number, number];
  /** Edge length (chord length for curved edges). */
  length: number;
}

const EPS = 1e-9;

/** Sign-normalise a direction so an edge and its reverse compare equal:
 *  force the first significantly non-zero component positive. */
export function normalizeEdgeDir(d: [number, number, number]): [number, number, number] {
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < EPS) return [0, 0, 0];
  let x = d[0] / len, y = d[1] / len, z = d[2] / len;
  const lead = Math.abs(x) > 1e-6 ? x : Math.abs(y) > 1e-6 ? y : z;
  if (lead < 0) { x = -x; y = -y; z = -z; }
  // `|| 0` collapses −0 → 0 so reversed-axis edges compare deep-equal.
  return [x || 0, y || 0, z || 0];
}

function dirAlignment(a: [number, number, number], b: [number, number, number]): number {
  // Both sign-normalised → dot in [−1,1]; |dot| handles any residual flip.
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface MatchOptions {
  /** Minimum |dir·dir| for a candidate to be eligible (must be ~parallel). */
  minDirAlignment?: number;
  /** Length-scale used to normalise the midpoint distance term (≈ part size).
   *  Defaults to the target length, falling back to 1. */
  scale?: number;
}

/**
 * Pick the candidate edge that best corresponds to `target`.
 * Returns the candidate index, or −1 when none is parallel enough.
 *
 * Score = dirAlignment − 0.5·(midDist/scale) − 0.3·|1 − lenRatio|, maximised.
 * Direction dominates (it's the most topology-stable signal); the midpoint and
 * length terms break ties between parallel edges.
 */
export function matchEdgeBySignature(
  target: EdgeSig,
  candidates: EdgeSig[],
  opts: MatchOptions = {},
): number {
  const minAlign = opts.minDirAlignment ?? 0.9;
  const scale = opts.scale ?? (target.length > EPS ? target.length : 1);
  const tdir = normalizeEdgeDir(target.dir);

  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const align = dirAlignment(tdir, normalizeEdgeDir(c.dir));
    if (align < minAlign) continue;
    const midTerm = dist(target.mid, c.mid) / (scale > EPS ? scale : 1);
    const maxLen = Math.max(target.length, c.length, EPS);
    const lenRatio = Math.min(target.length, c.length) / maxLen;
    const score = align - 0.5 * midTerm - 0.3 * (1 - lenRatio);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
