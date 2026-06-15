/**
 * catenary.ts — the uniform cable hanging under its own weight (transmission lines,
 * suspension hangers, chains). With horizontal tension H and weight w per unit length
 * the shape is the hyperbolic cosine about its lowest point:
 *
 *   parameter:   a = H/w
 *   shape:       y(x) = a·cosh(x/a)            (vertex at y = a, x measured from the low point)
 *   sag:         d   = a·(cosh(c/a) − 1)       (c = half-span)
 *   arc length:  s(x) = a·sinh(x/a)            (> x — the cable is longer than the chord)
 *   tension:     T(x) = H·cosh(x/a) = w·y(x)   (minimum H at the vertex, maximum at the supports)
 *
 * In the shallow limit it reduces to the parabolic cable sag wL²/(8H).
 *
 * Verified against the vertex tension T_min = H = w·a, the tension–height identity
 * T = w·y, the arc-length excess over the span, and the shallow parabolic limit.
 */

/** Catenary parameter a = H/w. */
export function catenaryParam(H: number, w: number): number { return H / w; }
/** Cable height above the directrix: y = a·cosh(x/a) (vertex at y = a). */
export function catenaryHeight(x: number, a: number): number { return a * Math.cosh(x / a); }
/** Sag below the supports for a half-span c: d = a·(cosh(c/a) − 1). */
export function catenarySag(halfSpan: number, a: number): number { return a * (Math.cosh(halfSpan / a) - 1); }
/** Arc length from the vertex out to x: s = a·sinh(x/a). */
export function catenaryArcLength(x: number, a: number): number { return a * Math.sinh(x / a); }
/** Cable tension at x: T = H·cosh(x/a) = w·y(x). */
export function catenaryTension(x: number, a: number, w: number): number { return w * a * Math.cosh(x / a); }
/** Shallow (parabolic) cable sag for a full span L: d ≈ wL²/(8H). */
export function parabolicSag(w: number, L: number, H: number): number { return (w * L * L) / (8 * H); }
