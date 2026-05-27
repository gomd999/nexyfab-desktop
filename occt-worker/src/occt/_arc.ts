/**
 * SVG elliptical arc → cubic Bezier — W14 D3-5 (ADR-007).
 *
 * Implements the W3C SVG 1.1 Appendix B "Implementation Notes" algorithm:
 *   1. Endpoint parameterization (input) → center parameterization
 *      (cx, cy, theta1, delta_theta)
 *   2. Split delta_theta into segments of ≤ π/2 (90°)
 *   3. Approximate each segment with a single cubic Bezier
 *
 * Math reference:
 *   https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes
 *   Maisonobe 2003: "Drawing an elliptical arc using polylines, quadratic
 *   or cubic Bezier curves"
 *
 * Why cubic-per-90° not finer?
 *   A single cubic Bezier matches a 90° circular arc to within
 *   ~0.027% radius error (Goldapp 1991). For engineering tolerances
 *   (0.1 mm on a 100 mm part = 0.1%) this is comfortably below the
 *   flattening tolerance the downstream subdivision applies. The
 *   subdivider then refines further as needed.
 *
 * Output is an array of (P0, P1, P2, P3) tuples in the same xy frame
 * as the caller's coordinates — no further transformation needed.
 */

import type { Point } from './_bezier.js';

const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;

export interface CubicSegment {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

/** Convert an SVG arc command to ≤ 4 cubic Bezier segments.
 *
 * @param x1y1 — start point (current pen position)
 * @param rxRy — radii (mm); both must be > 0
 * @param phiDeg — x-axis rotation in DEGREES (per SVG spec)
 * @param fA — large-arc-flag (0 = ≤180°, 1 = > 180°)
 * @param fS — sweep-flag (0 = CCW, 1 = CW in SVG's screen frame)
 * @param x2y2 — end point
 */
export function arcToCubicBeziers(
  x1y1: Point,
  rxRy: Point,
  phiDeg: number,
  fA: 0 | 1,
  fS: 0 | 1,
  x2y2: Point,
): CubicSegment[] {
  const [x1, y1] = x1y1;
  const [x2, y2] = x2y2;
  let [rx, ry] = rxRy;
  const phi = (phiDeg * Math.PI) / 180;

  if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
    throw new Error('invalid params: A radii must be finite');
  }
  // SVG spec: if either radius is 0, treat as a straight line. We
  // emit a single degenerate cubic (control points on the line) so
  // the downstream flattener still produces vertices.
  if (rx === 0 || ry === 0) {
    return [{
      p0: [x1, y1],
      p1: [x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3],
      p2: [x1 + 2 * (x2 - x1) / 3, y1 + 2 * (y2 - y1) / 3],
      p3: [x2, y2],
    }];
  }
  // SVG spec: negative radii are taken as their absolute value.
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  // Endpoint → center parameterization (W3C Appendix B.2.4).
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: compute (x1', y1') — endpoints in rotated/translated frame.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 2: scale radii up if they're too small to cover the chord.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // Step 3: compute center in rotated frame (cx', cy').
  const rxSq = rx * rx, rySq = ry * ry;
  const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
  let radicand = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq);
  if (radicand < 0) radicand = 0; // floating-point slop
  let coef = Math.sqrt(radicand);
  if (fA === fS) coef = -coef;
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * -((ry * x1p) / rx);

  // Step 4: rotate (cx', cy') back to original frame.
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // Step 5: theta1 and delta_theta.
  const v1x = (x1p - cxp) / rx;
  const v1y = (y1p - cyp) / ry;
  const v2x = (-x1p - cxp) / rx;
  const v2y = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, v1x, v1y);
  let deltaTheta = angle(v1x, v1y, v2x, v2y);
  if (fS === 0 && deltaTheta > 0) deltaTheta -= TWO_PI;
  else if (fS === 1 && deltaTheta < 0) deltaTheta += TWO_PI;

  // Split delta_theta into segments of ≤ 90°.
  const segCount = Math.max(1, Math.ceil(Math.abs(deltaTheta) / HALF_PI));
  const segDelta = deltaTheta / segCount;

  // For each sub-arc, compute the cubic via the standard formula.
  // Reference: Goldapp 1991 — single cubic per ≤ π/2 arc.
  //   alpha = (4/3) * tan(segDelta/4)
  const alpha = (4 / 3) * Math.tan(segDelta / 4);

  const out: CubicSegment[] = [];
  for (let i = 0; i < segCount; i++) {
    const t0 = theta1 + i * segDelta;
    const t1 = t0 + segDelta;
    const cosT0 = Math.cos(t0), sinT0 = Math.sin(t0);
    const cosT1 = Math.cos(t1), sinT1 = Math.sin(t1);

    // Unit circle control points (Goldapp formula).
    const u0x = cosT0,                   u0y = sinT0;
    const u1x = cosT0 - alpha * sinT0,   u1y = sinT0 + alpha * cosT0;
    const u2x = cosT1 + alpha * sinT1,   u2y = sinT1 - alpha * cosT1;
    const u3x = cosT1,                   u3y = sinT1;

    // Map unit-circle points to ellipse-in-world via:
    //   x =  cosPhi * (rx * ux) - sinPhi * (ry * uy) + cx
    //   y =  sinPhi * (rx * ux) + cosPhi * (ry * uy) + cy
    out.push({
      p0: mapPoint(u0x, u0y, rx, ry, cosPhi, sinPhi, cx, cy),
      p1: mapPoint(u1x, u1y, rx, ry, cosPhi, sinPhi, cx, cy),
      p2: mapPoint(u2x, u2y, rx, ry, cosPhi, sinPhi, cx, cy),
      p3: mapPoint(u3x, u3y, rx, ry, cosPhi, sinPhi, cx, cy),
    });
  }

  return out;
}

/** Signed angle from (ux, uy) to (vx, vy), in radians. SVG appendix B
 *  formula — sign comes from the 2D cross product. */
function angle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
  if (ux * vy - uy * vx < 0) a = -a;
  return a;
}

function mapPoint(
  ux: number, uy: number,
  rx: number, ry: number,
  cosPhi: number, sinPhi: number,
  cx: number, cy: number,
): Point {
  const ex = rx * ux;
  const ey = ry * uy;
  return [
    cosPhi * ex - sinPhi * ey + cx,
    sinPhi * ex + cosPhi * ey + cy,
  ];
}
