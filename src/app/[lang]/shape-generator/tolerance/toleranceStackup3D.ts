/**
 * toleranceStackup3D.ts — DIRECTIONAL 3D tolerance stack-up through a DRF chain.
 *
 * The existing `datumReferenceFrame.ts:stackup3D` sums each feature's tolerance
 * as a SCALAR and (honest comment at `evaluateFeatureInDrf`) throws away the DRF
 * rotation — it builds `drfTransform` but `void`s it. That collapses a 3D
 * problem to 1D: a ±0.2 zone on a feature whose DRF is rotated 90° contributes
 * to the WRONG global axis.
 *
 * This module closes that gap (roadmap D1). Each link's tolerance is a box of
 * half-widths in its LOCAL DRF frame; we rotate that box into the GLOBAL frame
 * via the DRF transform and accumulate PER-AXIS:
 *
 *   - **Worst case** — the supporting half-width of the rotated box along each
 *     global axis is `Σ_j |R⁻¹[i][j]| · local[j]`; summed over links.
 *   - **RSS** — treats each local half-width as ±3σ, independent: the global
 *     variance along axis i is `Σ_links Σ_j (R⁻¹[i][j])² · (local[j]/3)²`.
 *
 * Datum FORM error (flatness/straightness of the datums) is folded in via the
 * existing `evaluateFeatureInDrf` (its `datumContributions`, RSS-combined) as an
 * isotropic addition to each link's local box — so the two modules compose
 * rather than duplicate.
 *
 * Verified against closed form in `toleranceStackup3D.test.ts`:
 * identity DRFs reproduce the 1D answer; a rotated DRF routes the zone to the
 * correct global axis.
 */

import {
  drfTransform,
  evaluateFeatureInDrf,
  type DatumReferenceFrame,
  type FeatureInDrf,
} from './datumReferenceFrame';

export type Vec3Tuple = [number, number, number];

export interface Tol3DLink {
  drf: DatumReferenceFrame;
  feature: FeatureInDrf;
  /**
   * Tolerance half-widths in the link's LOCAL DRF frame (mm), per local axis
   * [x, y, z]. Omit for an isotropic zone derived from
   * `feature.positionToleranceMm / 2` (a position-diameter → radius).
   */
  localHalfWidthsMm?: Vec3Tuple;
}

export interface Tol3DResult {
  /** Worst-case half-width per GLOBAL axis (mm). */
  worstCaseAxisMm: Vec3Tuple;
  /** RSS (±3σ) half-width per GLOBAL axis (mm). */
  rssAxisMm: Vec3Tuple;
  /** Magnitude of the worst-case zone (mm) = |worstCaseAxis|. */
  worstCaseMagMm: number;
  /** Magnitude of the RSS zone (mm) = |rssAxis|. */
  rssMagMm: number;
  /** Per-link breakdown in global coords. */
  perLink: Array<{
    index: number;
    /** This link's worst-case half-width per global axis (mm). */
    globalHalfWidthsMm: Vec3Tuple;
    /** Isotropic datum-form budget folded into this link (mm), if any. */
    datumFormMm: number;
  }>;
}

/** Inverse (= transpose, rotations are orthonormal) of a 3×3 row-major matrix. */
function transpose3(r: number[][]): number[][] {
  return [
    [r[0]![0]!, r[1]![0]!, r[2]![0]!],
    [r[0]![1]!, r[1]![1]!, r[2]![1]!],
    [r[0]![2]!, r[1]![2]!, r[2]![2]!],
  ];
}

/**
 * Run a directional 3D stack-up. `chain` is an ordered list of features, each
 * located in its own datum reference frame.
 */
export function directionalStackup3D(chain: Tol3DLink[]): Tol3DResult {
  // Accumulators per global axis.
  const wc: Vec3Tuple = [0, 0, 0];
  const rssVar: Vec3Tuple = [0, 0, 0]; // variance (σ²) per axis
  const perLink: Tol3DResult['perLink'] = [];

  for (let k = 0; k < chain.length; k++) {
    const link = chain[k]!;
    // R maps part→DRF (rows are the DRF basis in part coords); to take a vector
    // FROM local DRF coords TO global/part coords we use R⁻¹ = Rᵀ.
    const Rinv = transpose3(drfTransform(link.drf).rotation);

    // Base local box: explicit, else isotropic from the position diameter.
    const base: Vec3Tuple = link.localHalfWidthsMm ?? [
      link.feature.positionToleranceMm / 2,
      link.feature.positionToleranceMm / 2,
      link.feature.positionToleranceMm / 2,
    ];

    // Datum FORM error → isotropic budget folded into the local box (RSS of the
    // existing per-datum contributions from evaluateFeatureInDrf).
    const drfEval = evaluateFeatureInDrf(link.drf, link.feature);
    const datumFormMm = Math.sqrt(
      drfEval.datumContributions.reduce((s, c) => s + c.contributionMm * c.contributionMm, 0),
    );
    const local: Vec3Tuple = [
      Math.sqrt(base[0] * base[0] + datumFormMm * datumFormMm),
      Math.sqrt(base[1] * base[1] + datumFormMm * datumFormMm),
      Math.sqrt(base[2] * base[2] + datumFormMm * datumFormMm),
    ];

    const globalHalf: Vec3Tuple = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let wcI = 0;
      let varI = 0;
      for (let j = 0; j < 3; j++) {
        const rij = Rinv[i]![j]!;
        wcI += Math.abs(rij) * local[j]!;       // supporting half-width (worst case)
        const sigmaJ = local[j]! / 3;            // ±3σ interpretation
        varI += rij * rij * sigmaJ * sigmaJ;     // rotated variance
      }
      globalHalf[i] = wcI;
      wc[i] += wcI;
      rssVar[i] += varI;
    }

    perLink.push({ index: k, globalHalfWidthsMm: globalHalf, datumFormMm });
  }

  const rssAxis: Vec3Tuple = [
    3 * Math.sqrt(rssVar[0]),
    3 * Math.sqrt(rssVar[1]),
    3 * Math.sqrt(rssVar[2]),
  ];

  return {
    worstCaseAxisMm: wc,
    rssAxisMm: rssAxis,
    worstCaseMagMm: Math.hypot(wc[0], wc[1], wc[2]),
    rssMagMm: Math.hypot(rssAxis[0], rssAxis[1], rssAxis[2]),
    perLink,
  };
}
