/**
 * revolveProfile — convert a sketch profile (closed loop) into a revolve
 * IR + OpenSCAD source.
 *
 * Phase 2.2 of NexyFab Pro own-CAD (ADR-013). Sibling to extrudeProfile.
 *
 * Revolve = take a 2D profile and rotate it around an axis line in the
 * same sketch plane. OpenSCAD's `rotate_extrude` always rotates around
 * the Y axis (positive-X half-plane), so this module transforms the
 * profile into that canonical frame before emitting SCAD.
 *
 * Axis specification: a 2D line in sketch coordinates (sketch u/v axes).
 * The axis must not intersect the profile interior (would produce
 * self-intersecting body — caught here as an error).
 *
 * Scope (Phase 2.2 minimal):
 *   - Single closed loop, full or partial angular sweep (0 < angle ≤ 360°)
 *   - add / cut modes (matches extrude)
 *   - Axis = arbitrary 2D line in the sketch plane
 *
 * Out of scope (later):
 *   - Multi-loop revolve with hole detection
 *   - Helix sweep (different feature kind — would be `sweep`, not revolve)
 *   - Up-to-surface termination
 */

import type { ClosedLoop, ProfilePoint } from '@/lib/sketch/sketchProfile';

// ─── IR ───────────────────────────────────────────────────────────────────

export type RevolveMode = 'add' | 'cut';

export interface AxisLine2D {
  /** A point on the axis line. */
  a: { x: number; y: number };
  /** A second point on the axis line. Together, a→b defines the axis direction. */
  b: { x: number; y: number };
}

export interface RevolveFeature {
  kind: 'revolve';
  /** Profile loop in canonical axis frame (axis = Y, profile in X≥0 half). */
  loop: ReadonlyArray<{ x: number; y: number }>;
  /** Angular sweep in degrees. 360 = full revolve. */
  angleDegrees: number;
  mode: RevolveMode;
}

// ─── builder ──────────────────────────────────────────────────────────────

export interface RevolveOptions {
  axis: AxisLine2D;
  angleDegrees?: number; // default 360
  mode?: RevolveMode; // default 'add'
}

export function buildRevolveFromLoop(
  loop: ClosedLoop,
  pointById: ReadonlyMap<string, ProfilePoint>,
  opts: RevolveOptions,
): RevolveFeature {
  const angle = opts.angleDegrees ?? 360;
  if (angle <= 0 || angle > 360 || !Number.isFinite(angle)) {
    throw new Error(`revolve angle must be in (0, 360], got: ${angle}`);
  }
  // Transform each profile point into the axis's local frame:
  //   Y' = projection onto axis direction
  //   X' = perpendicular distance from axis (signed)
  // The profile must lie entirely on one side (X' all same sign, or 0).
  const ax = opts.axis.a;
  const bx = opts.axis.b;
  const dirX = bx.x - ax.x;
  const dirY = bx.y - ax.y;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 1e-9) {
    throw new Error('revolve axis points are coincident');
  }
  const ux = dirX / dirLen;
  const uy = dirY / dirLen;
  // Perpendicular (rotated -90° in 2D for "right of axis").
  const nx = uy;
  const ny = -ux;

  const transformed: { x: number; y: number }[] = [];
  let signSeen: 1 | -1 | 0 = 0;
  let pointsOnAxis = 0;
  for (const id of loop.points) {
    const p = pointById.get(id);
    if (!p) throw new Error(`revolve: point ${id} missing from input`);
    const rx = p.x - ax.x;
    const ry = p.y - ax.y;
    const projOnAxis = rx * ux + ry * uy;
    const perpDist = rx * nx + ry * ny;
    if (Math.abs(perpDist) < 1e-9) {
      pointsOnAxis += 1;
    } else {
      const sign = perpDist > 0 ? 1 : -1;
      if (signSeen === 0) signSeen = sign;
      else if (signSeen !== sign) {
        throw new Error('revolve: profile straddles the axis (would self-intersect)');
      }
    }
    transformed.push({ x: Math.abs(perpDist), y: projOnAxis });
  }
  if (pointsOnAxis === loop.points.length) {
    throw new Error('revolve: profile is entirely on the axis (zero-volume)');
  }
  // Re-orient to CCW for SCAD polygon stability (rotate_extrude tolerates
  // either, but a deterministic order eases caching).
  let oriented = transformed;
  if (loop.signedArea < 0) {
    oriented = [...transformed].reverse();
  }
  return {
    kind: 'revolve',
    loop: oriented,
    angleDegrees: angle,
    mode: opts.mode ?? 'add',
  };
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

export function revolveToScad(feature: RevolveFeature): string {
  const polygonPoints = feature.loop
    .map((p) => `[${formatNum(p.x)}, ${formatNum(p.y)}]`)
    .join(', ');

  const angleClause = feature.angleDegrees === 360 ? '' : `angle=${formatNum(feature.angleDegrees)}`;
  const block = `rotate_extrude(${angleClause})\n  polygon([${polygonPoints}]);`;

  if (feature.mode === 'cut') {
    return `// NEXYFAB:REVOLVE_CUT\n${block}`;
  }
  return block;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`revolve: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
