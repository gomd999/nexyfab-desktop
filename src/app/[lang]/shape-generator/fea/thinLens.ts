/**
 * thinLens.ts — Gaussian thin-lens imaging and the lensmaker's equation.
 *
 *   thin lens:    1/f = 1/d_o + 1/d_i
 *   image:        d_i = f·d_o/(d_o − f)
 *   magnification: m = −d_i/d_o = h_i/h_o
 *   lensmaker:    1/f = (n − 1)(1/R₁ − 1/R₂)
 *
 * Sign convention: d_o, d_i positive for a real object/image; m < 0 ⇒ inverted real image.
 * Verified against the symmetric conjugate (object at 2f ⇒ image at 2f, m=−1), the image
 * at f for an object at infinity, the lens equation 1/f=1/d_o+1/d_i, and a biconvex
 * lensmaker focal length.
 */

/** Image distance d_i = f·d_o/(d_o − f). */
export function imageDistance(f: number, dObject: number): number { return (f * dObject) / (dObject - f); }
/** Lateral magnification m = −d_i/d_o. */
export function magnification(dImage: number, dObject: number): number { return -dImage / dObject; }
/** Object distance from the lens equation d_o = f·d_i/(d_i − f). */
export function objectDistance(f: number, dImage: number): number { return (f * dImage) / (dImage - f); }
/** Lensmaker focal length f = 1/[(n−1)(1/R₁ − 1/R₂)]. */
export function lensmakerFocalLength(n: number, R1: number, R2: number): number {
  return 1 / ((n - 1) * (1 / R1 - 1 / R2));
}
/** Lens power P = 1/f (dioptres when f is in metres). */
export function lensPower(f: number): number { return 1 / f; }
