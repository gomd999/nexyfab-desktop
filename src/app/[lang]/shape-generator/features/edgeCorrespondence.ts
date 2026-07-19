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
import { ZERO_LENGTH_EPS as EPS, AXIS_EPS } from './tolerancePolicy';

export interface EdgeSig {
  /** Edge midpoint (chord midpoint for curved edges). */
  mid: [number, number, number];
  /** Unit edge direction, sign-normalised (an edge and its reverse match). */
  dir: [number, number, number];
  /** Edge length (chord length for curved edges). */
  length: number;
}

/** Sign-normalise a direction so an edge and its reverse compare equal:
 *  force the first significantly non-zero component positive. */
export function normalizeEdgeDir(d: [number, number, number]): [number, number, number] {
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < EPS) return [0, 0, 0];
  let x = d[0] / len, y = d[1] / len, z = d[2] / len;
  const lead = Math.abs(x) > AXIS_EPS ? x : Math.abs(y) > AXIS_EPS ? y : z;
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
  /** Confidence floor — see MIN_CONFIDENCE_SCORE. Override only with evidence. */
  minScore?: number;
  /** Runner-up margin — see MIN_MARGIN. Override only with evidence. */
  minMargin?: number;
  /**
   * Disable the confidence/margin gate and fall back to the pre-ADR-017
   * "always return the nearest candidate" behaviour.
   *
   * ⚠ This re-enables SILENT MISMATCHES and violates ADR-017 §D1. It exists for
   * one legitimate case: callers that perform their own global assignment and
   * treat a weak match as provisional (see topologyRegistry.reconcileEdges,
   * which resolves competition 1:1 across the whole edge set rather than
   * per-edge). Never set it to make a UI selection "work".
   */
  ungated?: boolean;
}

/**
 * Why a match was refused. Callers MUST surface these to the user as
 * "reference lost — please re-select" rather than silently substituting an edge
 * (ADR-017 §D1: a wrong-but-silent answer is worse than an honest refusal).
 */
export type EdgeMatchRejection =
  /** No candidate edges were supplied at all. */
  | 'no_candidates'
  /** No candidate was parallel enough to the stored direction. */
  | 'no_parallel_candidate'
  /** The best candidate's absolute similarity is below the confidence floor —
   *  the stored edge probably no longer exists. */
  | 'low_confidence'
  /** Two or more candidates score within `minMargin` of each other — the
   *  matcher cannot tell them apart, so it refuses to guess. */
  | 'ambiguous';

export interface EdgeMatchResult {
  /** Matched candidate index, or −1 meaning THE REFERENCE IS LOST. */
  index: number;
  /** Score of the best geometric candidate (−Infinity when none was eligible). */
  score: number;
  /** Score of the second-best eligible candidate (−Infinity when there is none). */
  runnerUpScore: number;
  /** score − runnerUpScore. Infinity when the best candidate was unopposed. */
  margin: number;
  /** True when `index` is −1. Kept explicit so `if (r.lost)` reads honestly at
   *  call sites instead of the easily-ignored `index < 0`. */
  lost: boolean;
  /** Set iff `lost`. */
  reason?: EdgeMatchRejection;
  /**
   * The candidate the gate REFUSED, when a geometric best existed but failed
   * the confidence/margin test (−1 otherwise). Callers may offer it as a
   * "did you mean this edge?" suggestion for the user to CONFIRM — they must
   * not adopt it automatically.
   */
  rejectedIndex: number;
}

/**
 * Confidence floor and runner-up margin for `bestEdgeMatch`.
 *
 * ── Empirical derivation (do not change without re-running the sweep) ────────
 * Measured by `features/__tests__/edgeMatchMarginGate.test.ts`, which replays
 * the ADR-017 spike's adversarial part families (box · L-profile · skewed
 * parallelogram · moving through-hole · corner-hole bait) across the same
 * 12-config rebuild sweep, plus the S2b "second cut inserted" and S4
 * "feature mid-insert" topology changes. **1,512 scored resolutions.**
 *
 * The test sweeps minScore ∈ [0, 0.9] × minMargin ∈ [0, 0.5] over the recorded
 * (best, runner-up) score pairs and picks the setting that drives silent
 * mismatches to ZERO while giving up the fewest correct matches. Measured, at
 * minScore = 0 (survival / lost / **mismatch**):
 *
 *   minMargin 0     → 95.7% /  0.0% / **4.3%**   ← the ungated matcher today
 *   minMargin 0.02  → 91.3% /  6.1% / **2.6%**
 *   minMargin 0.05  → 88.4% / 10.8% / **0.8%**
 *   minMargin 0.07  → 81.1% / 18.7% / **0.3%**
 *   **minMargin 0.08 → 74.5% / 25.5% / 0.0%**   ← shipped
 *   minMargin 0.10  → 64.4% / 35.6% / 0.0%      (10pt more survival lost, no gain)
 *
 * 0.08 is the smallest margin on the grid that reaches zero mismatch, so it is
 * the cheapest honest setting. The 21.2pt of survival it spends is the price of
 * the ADR-017 §D1 property: every remaining failure is an EXPLICIT loss the user
 * can act on, instead of a wrong edge applied behind their back.
 *
 * ── Why the confidence floor is 0 (and not "a nice round 0.3") ───────────────
 * The sweep shows the floor is **inert** on this corpus: every value from 0 to
 * 0.6 produces byte-identical rates, because `score` is dominated by the
 * direction term, which is ≈1.0 for the parallel candidates that mismatches are
 * drawn from. Wrong answers here score HIGH; only the runner-up margin
 * distinguishes them. Raising the floor to 0.7+ starts destroying correct
 * matches (0.9 → survival 51.6%) without removing mismatches the margin hasn't
 * already caught. So 0 is the value the evidence supports, and inventing a
 * larger one would be exactly the arbitrary constant this work exists to avoid.
 *
 * 0 is still a real test, not a no-op: `score` goes negative once the midpoint
 * term exceeds the alignment term, so a lone candidate on the far side of the
 * part is rejected as `low_confidence` rather than accepted for lack of a rival.
 *
 * ── Independent confirmation on the REAL kernel ─────────────────────────────
 * The calibration corpus is analytic (pure TS). Re-running the OCCT-backed
 * spike `scripts/spike/topo-naming-k22.test.ts` with these constants in place
 * gives System B, mismatch **before → after**:
 *
 *   S1  0.4% → 0%   (survival 99.6% → 90.9%)
 *   S2  8.7% → 0%   (survival 91.3% → 59.6%)
 *   S2b 10.1% → 0%  (survival 89.9% → 67.4%)
 *   S3  2.3% → 0%   (survival 97.7% → 73.5%)
 *   S4  0%   → 0%   (survival  100% → 94.4%)
 *
 * The analytic corpus and the kernel agree to the decimal where they overlap
 * (S1 90.9%, S2b 67.4%), so the calibration is not an artefact of the model.
 *
 * Every number in the sweep section is re-derived and asserted on each test
 * run, so this comment cannot silently rot.
 */
export const MIN_CONFIDENCE_SCORE = 0;
export const MIN_MARGIN = 0.08;

/**
 * Pick the candidate edge that best corresponds to `target`.
 *
 * Score = dirAlignment − 0.5·(midDist/scale) − 0.3·|1 − lenRatio|, maximised.
 * Direction dominates (it's the most topology-stable signal); the midpoint and
 * length terms break ties between parallel edges.
 *
 * ⚠ ADR-017 §D1 — this function REFUSES rather than guesses. It returns
 * `index: −1` (with `lost: true` and a `reason`) when the best candidate is not
 * convincing on its own (`MIN_CONFIDENCE_SCORE`) or is not clearly better than
 * the runner-up (`MIN_MARGIN`). The spike measured that the ungated matcher
 * never reports a loss, so every one of its failures was a silent mismatch —
 * the matcher confidently handing back the WRONG edge. Callers must turn a loss
 * into "reference lost — please re-select", not into a fallback guess.
 */
export function bestEdgeMatch(
  target: EdgeSig,
  candidates: EdgeSig[],
  opts: MatchOptions = {},
): EdgeMatchResult {
  const minAlign = opts.minDirAlignment ?? 0.9;
  const scale = opts.scale ?? (target.length > EPS ? target.length : 1);
  const minScore = opts.minScore ?? MIN_CONFIDENCE_SCORE;
  const minMargin = opts.minMargin ?? MIN_MARGIN;
  const tdir = normalizeEdgeDir(target.dir);

  let bestIdx = -1;
  let bestScore = -Infinity;
  let runnerUp = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const align = dirAlignment(tdir, normalizeEdgeDir(c.dir));
    if (align < minAlign) continue;
    const midTerm = dist(target.mid, c.mid) / (scale > EPS ? scale : 1);
    const maxLen = Math.max(target.length, c.length, EPS);
    const lenRatio = Math.min(target.length, c.length) / maxLen;
    const score = align - 0.5 * midTerm - 0.3 * (1 - lenRatio);
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      bestIdx = i;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  const margin = bestIdx < 0 ? -Infinity : bestScore - runnerUp; // Infinity when unopposed
  const base = { score: bestScore, runnerUpScore: runnerUp, margin };

  if (bestIdx < 0) {
    return {
      ...base,
      index: -1,
      lost: true,
      reason: candidates.length === 0 ? 'no_candidates' : 'no_parallel_candidate',
      rejectedIndex: -1,
    };
  }
  if (opts.ungated) {
    return { ...base, index: bestIdx, lost: false, rejectedIndex: -1 };
  }
  if (bestScore < minScore) {
    return { ...base, index: -1, lost: true, reason: 'low_confidence', rejectedIndex: bestIdx };
  }
  if (margin < minMargin) {
    return { ...base, index: -1, lost: true, reason: 'ambiguous', rejectedIndex: bestIdx };
  }
  return { ...base, index: bestIdx, lost: false, rejectedIndex: -1 };
}

/**
 * Index of the corresponding edge, or **−1 meaning the reference was lost**.
 *
 * −1 is not "nothing happened" — it is a verdict the caller owes the user (see
 * `bestEdgeMatch`). Use `bestEdgeMatch` directly when you need the `reason` or
 * the rejected suggestion.
 */
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
