// Analytic verification layer (methodology §7 net + §12.4/§12.7.2 ΔV rules).
//
// Everything here is closed-form math over the intent — it runs WITHOUT any
// geometry kernel, so it can gate emission cheaply (and deterministically)
// before OpenSCAD/OCCT ever see the model:
//   - polygon invariants (closed / simple / CCW / off-axis)
//   - Pappus centroid-theorem volumes for revolve profiles
//   - closed-form vessel capacity (cylinder + cone frustum)
//   - analytic radial interference (impeller vs baffles) — the draft-stage
//     stand-in for the full assemblyInterference mesh check
//   - expected-ΔV estimator for draft-omitted fillets (§12.7.2, narrow band)

import type { Pt2, Profile2D } from './schema';

// ─── Polygon primitives ──────────────────────────────────────────────────────

/** Shoelace signed area — positive = CCW. */
export function signedArea(points: Pt2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Area centroid of a simple polygon. */
export function centroid(points: Pt2[]): Pt2 {
  const A = signedArea(points);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

function segmentsIntersect(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false; // parallel — adjacency handles touching
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/** True if no two non-adjacent edges cross (O(n²) — profiles are small). */
export function isSimplePolygon(points: Pt2[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges (share a vertex), incl. first/last wrap pair
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      if (
        segmentsIntersect(
          points[i], points[(i + 1) % n],
          points[j], points[(j + 1) % n],
        )
      ) return false;
    }
  }
  return true;
}

// ─── Profile invariants (emission gate) ──────────────────────────────────────

export interface ProfileCheckOptions {
  /** For revolve profiles: minimum allowed distance from the axis, mm. */
  minAxisOffset?: number;
}

/** Returns human-readable violations; empty array = profile is emission-safe. */
export function profileViolations(profile: Profile2D, opts: ProfileCheckOptions = {}): string[] {
  const v: string[] = [];
  const pts = profile.points;
  if (pts.length < 3) v.push(`${profile.id}: fewer than 3 points`);
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    v.push(`${profile.id}: non-finite coordinate`);
  }
  if (Math.abs(signedArea(pts)) < 1e-9) v.push(`${profile.id}: zero area`);
  if (signedArea(pts) < 0) v.push(`${profile.id}: clockwise winding (expected CCW)`);
  if (!isSimplePolygon(pts)) v.push(`${profile.id}: self-intersecting`);
  if (opts.minAxisOffset !== undefined) {
    const minX = Math.min(...pts.map((p) => p.x));
    if (minX < opts.minAxisOffset - 1e-9) {
      v.push(
        `${profile.id}: point at x=${minX.toFixed(3)} violates minAxisOffset=` +
        `${opts.minAxisOffset} (axis-sliver risk)`,
      );
    }
  }
  return v;
}

// ─── Volumes ─────────────────────────────────────────────────────────────────

/**
 * Pappus' centroid theorem: a full revolve of area A whose centroid sits at
 * radius x̄ sweeps volume V = 2π·x̄·A. Exact for any simple profile with
 * x ≥ 0 — our independent check against closed-form formulas (N-version
 * validation applied to math, §6.2 pattern).
 */
export function pappusRevolveVolumeMm3(profile: Profile2D): number {
  const A = Math.abs(signedArea(profile.points));
  const cx = centroid(profile.points).x;
  return 2 * Math.PI * cx * A;
}

export function cylinderVolumeMm3(radius: number, height: number): number {
  return Math.PI * radius * radius * height;
}

/** Cone frustum between radii r1 (bottom) and r2 (top). */
export function coneFrustumVolumeMm3(r1: number, r2: number, height: number): number {
  return (Math.PI * height * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
}

export const MM3_PER_LITER = 1_000_000;

// ─── Analytic interference (draft-stage §12.7.3 stand-in) ────────────────────

export interface DiscVsRingCheck {
  /** Rotating disc (impeller) tip radius, mm. */
  discRadius: number;
  /** Disc z-extent [lo, hi], mm. */
  discZ: [number, number];
  /** Inner face radius of the surrounding obstacles (baffle inner edge), mm. */
  obstacleInnerRadius: number;
  /** Obstacle z-extent [lo, hi], mm. */
  obstacleZ: [number, number];
}

export interface InterferenceResult {
  interferes: boolean;
  /** Positive = clear by this much; negative = radial overlap depth, mm. */
  radialClearanceMm: number;
  /** Overlap of the two z-ranges, mm (0 = no vertical overlap). */
  zOverlapMm: number;
}

/**
 * A rotating disc sweeps a full annulus, so if the z-ranges overlap the only
 * question is radial: tip radius vs obstacle inner radius. Exact, O(1).
 */
export function checkDiscVsRing(c: DiscVsRingCheck): InterferenceResult {
  const zOverlap = Math.min(c.discZ[1], c.obstacleZ[1]) - Math.max(c.discZ[0], c.obstacleZ[0]);
  const radialClearance = c.obstacleInnerRadius - c.discRadius;
  return {
    interferes: zOverlap > 0 && radialClearance < 0,
    radialClearanceMm: radialClearance,
    zOverlapMm: Math.max(0, zOverlap),
  };
}

// ─── Expected-ΔV estimator (§12.7.2 — fillet/chamfer only, narrow band) ─────

/**
 * Material removed by rounding a convex 90° edge of length L with radius r:
 * exactly (r² − πr²/4)·L. Draft kernel omits fillets, so the record-kernel
 * volume is expected to differ by Σ of these. Scope: simple fillet/chamfer
 * ONLY — shell/draft use their own wide-band estimators (§12.7.2 table).
 */
export function filletDeltaVMm3(radius: number, edgeLengthMm: number): number {
  return (radius * radius - (Math.PI * radius * radius) / 4) * edgeLengthMm;
}
