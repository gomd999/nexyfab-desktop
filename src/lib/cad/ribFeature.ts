/**
 * ribFeature — rib / stiffener feature: a thin vertical wall raised along a
 * 2D centerline segment, extruded in +Z.
 *
 * Phase 2.1.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Why both an IR and a SCAD string?
 *   - The IR is the canonical, language-agnostic feature description that
 *     downstream OCCT/Parasolid integrations will consume (Phase 2.x+).
 *     Keeping it separate from the SCAD serializer means swapping kernels
 *     later doesn't require re-touching every rib call site.
 *   - SCAD is the present-day execution backend (existing NexyFab
 *     openscad-render pipeline). This module renders the IR to SCAD source
 *     ready for that pipeline.
 *
 * Geometry (Phase 2.1.4 — minimal):
 *   - A rib is modelled as a thin box of length=|end-start| (along the
 *     centerline), width=thickness, height=height (extruded in +Z).
 *   - The box is rotated about Z to the centerline angle and translated to
 *     the segment start (or to the segment midpoint when `centered`).
 *   - `centered` controls the in-plane placement of the wall relative to the
 *     centerline: when true the wall straddles the line (width centered) and
 *     the run is centered about the midpoint; otherwise the wall sits with
 *     its near face on the start point.
 *
 * Out of scope (Phase 2.1.5+):
 *   - Draft on the rib side walls.
 *   - Top fillet / rounded crown.
 *   - Up-to-surface termination (rib grown until it hits a parent face).
 *   - Multi-segment polyline ribs (handled as a chain of single ribs).
 */

// ─── IR ───────────────────────────────────────────────────────────────────

export interface RibPoint {
  x: number;
  y: number;
}

export interface RibFeature {
  kind: 'rib';
  /** Centerline start in sketch units (mm by convention). */
  start: RibPoint;
  /** Centerline end in sketch units (mm by convention). */
  end: RibPoint;
  /** Wall thickness across the centerline. Must be > 0. */
  thickness: number;
  /** Extrude height in +Z. Must be > 0. */
  height: number;
  /**
   * When true the wall straddles the centerline (thickness centered on the
   * line) and the run is centered about the segment midpoint. When false the
   * wall sits on the +normal side starting from `start`. Defaults to false.
   */
  centered?: boolean;
}

// ─── builders ─────────────────────────────────────────────────────────────

export interface RibOptions {
  start: RibPoint;
  end: RibPoint;
  thickness: number;
  height: number;
  centered?: boolean;
}

/**
 * Build a rib feature with defensive validation. Throws on a non-positive
 * thickness/height, a degenerate (zero-length) centerline, or any non-finite
 * coordinate.
 */
export function buildRib(opts: RibOptions): RibFeature {
  assertFinitePoint(opts.start, 'start');
  assertFinitePoint(opts.end, 'end');
  if (!(opts.thickness > 0) || !Number.isFinite(opts.thickness)) {
    throw new Error(`rib thickness must be positive, got: ${opts.thickness}`);
  }
  if (!(opts.height > 0) || !Number.isFinite(opts.height)) {
    throw new Error(`rib height must be positive, got: ${opts.height}`);
  }
  const dx = opts.end.x - opts.start.x;
  const dy = opts.end.y - opts.start.y;
  if (Math.hypot(dx, dy) <= 1e-9) {
    throw new Error('rib centerline is degenerate: start equals end');
  }
  return {
    kind: 'rib',
    start: { x: opts.start.x, y: opts.start.y },
    end: { x: opts.end.x, y: opts.end.y },
    thickness: opts.thickness,
    height: opts.height,
    centered: opts.centered ?? false,
  };
}

// ─── queries ──────────────────────────────────────────────────────────────

/** Centerline length |end - start| in sketch units. */
export function ribLength(f: RibFeature): number {
  return Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y);
}

/** Centerline angle relative to +X in degrees, in (-180, 180]. */
export function ribAngleDegrees(f: RibFeature): number {
  const a = Math.atan2(f.end.y - f.start.y, f.end.x - f.start.x) * (180 / Math.PI);
  return a;
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

/**
 * Convert a RibFeature to an OpenSCAD source string. Output is deterministic
 * for identical input (for caching/diffing).
 *
 * The local box is built axis-aligned (length along +X, thickness along Y,
 * height along +Z), rotated by the centerline angle about Z, then translated.
 * `center` on the cube handles thickness (always) and the run/Z placement
 * depending on the `centered` flag.
 */
export function ribToScad(f: RibFeature): string {
  const len = ribLength(f);
  const angle = ribAngleDegrees(f);

  // Anchor point of the local frame, in world XY:
  //   centered=false -> segment start (cube grows toward +X local).
  //   centered=true  -> segment midpoint (cube centered about it).
  const anchor: RibPoint = f.centered
    ? { x: (f.start.x + f.end.x) / 2, y: (f.start.y + f.end.y) / 2 }
    : { x: f.start.x, y: f.start.y };

  // cube center flags: [length, thickness, height].
  //   thickness is always centered on the line (straddle).
  //   length is centered only when `centered`.
  //   height grows from the sketch plane (+Z), never centered.
  const cubeCenter = `[${f.centered ? 'true' : 'false'}, true, false]`;

  const size = `[${formatNum(len)}, ${formatNum(f.thickness)}, ${formatNum(f.height)}]`;

  return (
    `translate([${formatNum(anchor.x)}, ${formatNum(anchor.y)}, 0])\n` +
    `  rotate([0, 0, ${formatNum(angle)}])\n` +
    `    cube(size=${size}, center=${cubeCenter});`
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function assertFinitePoint(p: RibPoint, label: string): void {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new Error(`rib ${label} must have finite x/y coordinates`);
  }
}

function formatNum(n: number): string {
  // 4-decimal precision balances determinism with OpenSCAD numeric noise.
  if (!Number.isFinite(n)) throw new Error(`rib: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
