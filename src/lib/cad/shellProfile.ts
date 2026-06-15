/**
 * shellProfile — Phase 2.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Shell turns a solid into a hollow shell of uniform wall thickness, then
 * optionally "opens" specified faces (top and/or bottom of an extruded body).
 *
 * Implementation strategy (Phase 1 minimal):
 *   - Wrap an existing ExtrudeFeature as the child body.
 *   - Emit SCAD as `difference() { outer-extrude; inner-extrude; }` where
 *     the inner extrude is the outer profile shrunk inward by `thickness`.
 *   - Profile offset for arbitrary 2D loops is non-trivial (Minkowski /
 *     straight-skeleton territory). For Phase 1 we ONLY support axis-aligned
 *     rectangles — easy to inset (clamp each side by `thickness`).
 *   - Non-rect profiles must be rejected by the caller (the
 *     shellFromSketch pipeline does this); shellToScad itself trusts that
 *     the child extrude's loop is a 4-corner axis-aligned rect.
 *
 * Open-face semantics:
 *   - `openTopFace`: extend the inner extrude THROUGH the top face so the
 *     boolean leaves an opening at z=depth. We extend by 2*thickness past
 *     the top to guarantee the boolean clears the face.
 *   - `openBottomFace`: similarly extend below z=0.
 *   - When neither face is open, the inner extrude sits *inside* the outer
 *     body with `thickness` of material on the floor and ceiling.
 *
 * Phase 1 limitations (documented for the UI to surface):
 *   - Rect profiles only (4 axis-aligned corners). The pipeline returns an
 *     error for non-rect input.
 *   - Uniform wall thickness only (no per-face thickness override).
 *   - Child must be a single ExtrudeFeature; revolves/sweeps/lofts are out
 *     of scope until Phase 2 OCCT shell lands.
 *
 * Out of scope (Phase 2+):
 *   - General 2D loop offset (any convex/concave polygon, then arbitrary
 *     planar face)
 *   - Per-face thickness
 *   - Shell a body produced by revolve/sweep/loft/pattern
 *   - Multi-loop shells with hole preservation
 */

import type { ExtrudeFeature } from './extrudeProfile';
import { extrudeToScad } from './extrudeProfile';

// ─── IR ───────────────────────────────────────────────────────────────────

export interface ShellFeature {
  kind: 'shell';
  /** The body to be shelled. Phase 1 supports ExtrudeFeature only. */
  childExtrude: ExtrudeFeature;
  /** Uniform wall thickness (mm). Must be > 0 and < min(profileBBox)/2. */
  thickness: number;
  /** If true, the top face (z=depth) is left open. */
  openTopFace?: boolean;
  /** If true, the bottom face (z=0) is left open. */
  openBottomFace?: boolean;
}

export interface ShellOptions {
  thickness: number;
  openTopFace?: boolean;
  openBottomFace?: boolean;
}

// ─── rect detection helper (shared with shellFromSketch) ─────────────────

/**
 * Returns true iff the loop is an axis-aligned rectangle: exactly 4 points
 * with the bounding box reachable through the 4 points and consecutive
 * edges meeting at right angles.
 */
export function isAxisAlignedRect(
  loop: ReadonlyArray<{ x: number; y: number }>,
  tol = 1e-6,
): boolean {
  if (loop.length !== 4) return false;
  // Each consecutive edge must be either horizontal (Δy ≈ 0) or vertical
  // (Δx ≈ 0). Also: edges must alternate (no two consecutive horizontals).
  let lastWasHorizontal: boolean | null = null;
  for (let i = 0; i < 4; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % 4]!;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < tol && dy < tol) return false; // zero-length edge
    const horizontal = dy < tol;
    const vertical = dx < tol;
    if (!horizontal && !vertical) return false;
    if (lastWasHorizontal !== null && horizontal === lastWasHorizontal) {
      // two consecutive edges in same orientation → not a rectangle
      return false;
    }
    lastWasHorizontal = horizontal;
  }
  return true;
}

function loopBoundingBox(
  loop: ReadonlyArray<{ x: number; y: number }>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// ─── builder ──────────────────────────────────────────────────────────────

/**
 * Build a ShellFeature wrapping an ExtrudeFeature.
 *
 * Validation:
 *   - thickness must be > 0 and finite
 *   - thickness must be < min(profileWidth, profileHeight) / 2 — otherwise
 *     the inner extrude would invert (no interior space)
 *   - thickness must be < depth / 2 when at least one face is open
 *     (otherwise the open-face boolean removes more than what's left after
 *     accounting for the closed cap thickness)
 *   - Phase 1 only: child loop must be an axis-aligned rect
 */
export function buildShellFromExtrude(
  child: ExtrudeFeature,
  thickness: number,
  opts: { openTopFace?: boolean; openBottomFace?: boolean } = {},
): ShellFeature {
  if (!Number.isFinite(thickness) || thickness <= 0) {
    throw new Error(`shell thickness must be a positive number, got: ${thickness}`);
  }
  if (!isAxisAlignedRect(child.loop)) {
    throw new Error('shell Phase 1: child extrude profile must be an axis-aligned rectangle');
  }
  const bb = loopBoundingBox(child.loop);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const minDim = Math.min(w, h);
  if (thickness >= minDim / 2) {
    throw new Error(
      `shell thickness ${thickness} must be < min(profile bbox)/2 = ${minDim / 2}`,
    );
  }
  const opening = !!(opts.openTopFace || opts.openBottomFace);
  if (opening && thickness >= child.depth / 2) {
    throw new Error(
      `shell thickness ${thickness} must be < depth/2 = ${child.depth / 2} when opening a face`,
    );
  }
  return {
    kind: 'shell',
    childExtrude: child,
    thickness,
    openTopFace: !!opts.openTopFace,
    openBottomFace: !!opts.openBottomFace,
  };
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`shell: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}

/**
 * Convert a ShellFeature to OpenSCAD source. The output is deterministic:
 * same input always yields the same string (suitable for cache keys).
 *
 * Structure:
 *   difference() {
 *     <outer extrude>;
 *     translate([+t,+t,zStart]) linear_extrude(height=innerDepth)
 *       polygon([inset rect points]);
 *   }
 */
export function shellToScad(feature: ShellFeature): string {
  const t = feature.thickness;
  const outerScad = extrudeToScad(feature.childExtrude);

  // Inset the bounding box inward by `thickness` on all 4 sides.
  const bb = loopBoundingBox(feature.childExtrude.loop);
  const innerMinX = bb.minX + t;
  const innerMaxX = bb.maxX - t;
  const innerMinY = bb.minY + t;
  const innerMaxY = bb.maxY - t;

  // CCW order: (minX,minY) → (maxX,minY) → (maxX,maxY) → (minX,maxY).
  const innerPolygon =
    `[[${formatNum(innerMinX)}, ${formatNum(innerMinY)}], ` +
    `[${formatNum(innerMaxX)}, ${formatNum(innerMinY)}], ` +
    `[${formatNum(innerMaxX)}, ${formatNum(innerMaxY)}], ` +
    `[${formatNum(innerMinX)}, ${formatNum(innerMaxY)}]]`;

  // Compute the Z extents of the inner extrude.
  //   Closed-floor: zStart = +thickness (leaves a floor of `thickness`)
  //   Open-bottom: zStart = -thickness (pokes through z=0 so the boolean
  //     removes the floor)
  //   Closed-ceiling: innerDepth ends at depth - thickness
  //   Open-top: innerDepth ends at depth + thickness (pokes through z=depth)
  const depth = feature.childExtrude.depth;
  const zStart = feature.openBottomFace ? -t : t;
  const zEnd = feature.openTopFace ? depth + t : depth - t;
  const innerHeight = zEnd - zStart;

  const innerExtrude =
    `translate([0, 0, ${formatNum(zStart)}])\n` +
    `    linear_extrude(height=${formatNum(innerHeight)})\n` +
    `    polygon(${innerPolygon});`;

  return (
    `// NEXYFAB:SHELL thickness=${formatNum(t)} ` +
    `openTop=${feature.openTopFace ? 'true' : 'false'} ` +
    `openBottom=${feature.openBottomFace ? 'true' : 'false'}\n` +
    `difference() {\n` +
    `  ${outerScad.split('\n').join('\n  ')}\n` +
    `  ${innerExtrude.split('\n').join('\n  ')}\n` +
    `}`
  );
}
