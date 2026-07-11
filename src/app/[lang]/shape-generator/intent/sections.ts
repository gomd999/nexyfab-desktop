// Parametric 2D section library (methodology §8 item ② / §12.1 primitive #1).
//
// Every factory here returns a CLOSED, CCW-normalized, manifold-safe
// Profile2D that the deterministic emitters can revolve/extrude directly —
// this is what replaces the old `square([10,10])` sketch stubs.
//
// Manifold-safety rules baked in (methodology §1.1 / hand-coded-SCAD pitfalls):
//   - Revolve profiles never touch the axis with a sliver: the tank cone
//     terminates at a drain opening (drainDia > 0 enforced), not at x=0.
//   - Cone angle is an INPUT and cone height is DERIVED from it, so the
//     angle parameter can never silently disagree with the geometry
//     (the "decorative parameter + fake assert" trap).
//   - All outputs are validated by verify.ts invariants in tests.

import type { Profile2D, Pt2 } from './schema';
import { signedArea } from './verify';

/** Reverse point order if needed so the polygon is CCW (positive area). */
function normalizeCcw(points: Pt2[]): Pt2[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

// ─── Tank wall (revolve section) ─────────────────────────────────────────────

export interface TankWallParams {
  /** Tank inner diameter, mm. */
  innerDia: number;
  /** Plate thickness, mm (e.g. STS304 5t). */
  wallThk: number;
  /** Straight (cylindrical) shell height, mm. */
  cylinderH: number;
  /** Cone half-angle from horizontal, degrees. Height is DERIVED from this. */
  coneAngleDeg: number;
  /** Bottom drain opening diameter, mm. MUST be > 0 (axis-sliver guard). */
  drainDia: number;
}

export interface TankWallSection {
  profile: Profile2D;
  derived: {
    /** Cone height derived from angle: (innerR − drainR)·tan(angle). */
    coneHeightMm: number;
    innerRadiusMm: number;
    outerRadiusMm: number;
    drainRadiusMm: number;
    totalHeightMm: number;
  };
}

/**
 * Wall cross-section of a cone-bottom cylindrical tank as ONE closed polygon
 * (inner surface up, outer surface down) — no 2D difference() needed, which
 * removes a whole class of coincident-face CSG failures.
 *
 * Coordinates: x = radial (≥ drainR > 0), y = height, y=0 at the inner
 * cone/drain lip.
 */
export function tankWallProfile(p: TankWallParams): TankWallSection {
  const { innerDia, wallThk, cylinderH, coneAngleDeg, drainDia } = p;
  if (!(drainDia > 0)) {
    throw new Error(
      'tankWallProfile: drainDia must be > 0 — a cone apex touching the ' +
      'revolve axis creates a non-manifold sliver (methodology §1.1).',
    );
  }
  if (!(innerDia > drainDia)) throw new Error('tankWallProfile: innerDia must exceed drainDia.');
  if (!(wallThk > 0)) throw new Error('tankWallProfile: wallThk must be > 0.');
  if (!(cylinderH > 0)) throw new Error('tankWallProfile: cylinderH must be > 0.');
  if (!(coneAngleDeg >= 20 && coneAngleDeg <= 80)) {
    throw new Error('tankWallProfile: coneAngleDeg out of sane range [20, 80].');
  }

  const R = innerDia / 2;
  const rd = drainDia / 2;
  const W = wallThk;
  const H = cylinderH;
  // Height DERIVED from the angle — single source of truth.
  const C = (R - rd) * Math.tan((coneAngleDeg * Math.PI) / 180);

  // Inner polyline bottom→top: A(rd,0) → B(R,C) → Ctop(R,C+H)
  // Outer surface = inner offset by W along the outward normal, mitred at
  // the cone/cylinder junction.
  const d1x = R - rd;
  const d1y = C;
  const L1 = Math.hypot(d1x, d1y);
  const n1x = d1y / L1;   // outward normal of cone segment (+x, −y)
  const n1y = -d1x / L1;

  const Ao: Pt2 = { x: rd + W * n1x, y: 0 + W * n1y }; // outer plate end at drain
  // Miter: outer cone line ∩ vertical outer shell line x = R + W
  const tMiter = (R + W - Ao.x) / d1x;
  const M: Pt2 = { x: R + W, y: Ao.y + tMiter * d1y };

  const points: Pt2[] = [
    { x: rd, y: 0 },        // inner drain lip
    { x: R, y: C },         // inner cone→shell junction
    { x: R, y: C + H },     // inner top rim
    { x: R + W, y: C + H }, // outer top rim
    M,                      // outer cone/shell miter
    Ao,                     // outer plate end at drain
  ];

  return {
    profile: { id: 'tank-wall', points: normalizeCcw(points), label: 'tank wall section' },
    derived: {
      coneHeightMm: C,
      innerRadiusMm: R,
      outerRadiusMm: R + W,
      drainRadiusMm: rd,
      totalHeightMm: C + H,
    },
  };
}

/**
 * Inner-cavity section (axis-bounded) for ANALYTIC capacity checks only —
 * never manufactured, so touching the axis is fine here. Used by tests to
 * cross-validate Pappus volume vs closed-form cylinder+frustum (§6.2
 * dual-emit N-version idea applied to math).
 */
export function tankCavityProfile(p: TankWallParams): Profile2D {
  const R = p.innerDia / 2;
  const rd = p.drainDia / 2;
  const C = (R - rd) * Math.tan((p.coneAngleDeg * Math.PI) / 180);
  const points: Pt2[] = [
    { x: 0, y: 0 },
    { x: rd, y: 0 },
    { x: R, y: C },
    { x: R, y: C + p.cylinderH },
    { x: 0, y: C + p.cylinderH },
  ];
  return { id: 'tank-cavity', points: normalizeCcw(points), label: 'capacity region' };
}

// ─── Simple rectangles (baffles, plates) ─────────────────────────────────────

/** Axis-aligned rectangle with corner at origin — baffle/plate sections. */
export function rectSection(id: string, width: number, thickness: number): Profile2D {
  if (!(width > 0 && thickness > 0)) throw new Error('rectSection: width/thickness must be > 0.');
  return {
    id,
    points: normalizeCcw([
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: thickness },
      { x: 0, y: thickness },
    ]),
  };
}

// ─── Structural channel (ㄷ형강) — frame pilot (ULD rack) groundwork ─────────

export interface ChannelParams {
  /** Overall depth (web height), mm — e.g. ㄷ200 → 200. */
  depth: number;
  /** Flange width, mm. */
  flangeW: number;
  /** Web thickness, mm. */
  webT: number;
  /** Flange thickness, mm. */
  flangeT: number;
}

/** U-channel outline (open side +x), origin at web outer bottom corner. */
export function channelSection(id: string, p: ChannelParams): Profile2D {
  const { depth, flangeW, webT, flangeT } = p;
  if (!(depth > 2 * flangeT && flangeW > webT)) {
    throw new Error('channelSection: degenerate channel dimensions.');
  }
  return {
    id,
    points: normalizeCcw([
      { x: 0, y: 0 },
      { x: flangeW, y: 0 },
      { x: flangeW, y: flangeT },
      { x: webT, y: flangeT },
      { x: webT, y: depth - flangeT },
      { x: flangeW, y: depth - flangeT },
      { x: flangeW, y: depth },
      { x: 0, y: depth },
    ]),
  };
}
