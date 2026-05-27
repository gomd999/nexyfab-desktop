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
export function bestEdgeMatch(
  target: EdgeSig,
  candidates: EdgeSig[],
  opts: MatchOptions = {},
): { index: number; score: number } {
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
  return { index: bestIdx, score: bestScore };
}

export function matchEdgeBySignature(
  target: EdgeSig,
  candidates: EdgeSig[],
  opts: MatchOptions = {},
): number {
  return bestEdgeMatch(target, candidates, opts).index;
}

// ─── Face correspondence ──────────────────────────────────────────────────────

export interface FaceSig {
  /** A representative point on the face (surface point near its UV centre). */
  center: [number, number, number];
  /** Unit OUTWARD normal — a face's two sides are distinct, so this is signed
   *  (unlike an edge direction). Opposite faces of a box do NOT match. */
  normal: [number, number, number];
  /** OCCT surface type tag (e.g. "PLANE", "CYLINDRE") when known; used as a
   *  hard filter so a plane never matches a cylindrical face. */
  geomType?: string;
}

function unit(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < EPS) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export interface FaceMatchOptions {
  /** Minimum signed normal·normal for a candidate to be eligible. */
  minNormalAlignment?: number;
  /** Length-scale used to normalise the centre-distance term (≈ part size). */
  scale?: number;
}

/**
 * Pick the candidate face that best corresponds to `target`.
 * Returns the candidate index, or −1 when none aligns well enough.
 *
 * Normal direction (signed, outward) dominates; surface type is a hard filter;
 * the centre distance breaks ties between parallel co-typed faces (e.g. the two
 * +Z faces of a stepped part). Mirrors matchEdgeBySignature so face-based
 * selections (shell face removal, sketch-on-face) survive rebuilds the same way.
 */
export function matchFaceBySignature(
  target: FaceSig,
  candidates: FaceSig[],
  opts: FaceMatchOptions = {},
): number {
  const minAlign = opts.minNormalAlignment ?? 0.95;
  const scale = opts.scale ?? 1;
  const tn = unit(target.normal);

  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (target.geomType && c.geomType && target.geomType !== c.geomType) continue;
    const cn = unit(c.normal);
    const align = tn[0] * cn[0] + tn[1] * cn[1] + tn[2] * cn[2]; // signed
    if (align < minAlign) continue;
    const centerTerm = dist(target.center, c.center) / (scale > EPS ? scale : 1);
    const score = align - 0.5 * centerTerm;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
