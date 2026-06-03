/**
 * sweepPath — Phase 2.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Sweep a single 2D profile loop along an arbitrary polyline / arc path in
 * 3D world space. This complements `sweepLoft` (whose `buildSweep` produces a
 * BOSL2 `path_sweep` IR): here we own a *self-contained, deterministic*
 * faceted approximation that needs no external OpenSCAD library.
 *
 * Approximation model
 * ───────────────────
 * The swept solid is approximated as a chain of `hull()` pairs. At every path
 * station we place a translated copy of the (small, thin) profile, then take
 * the convex `hull()` of each consecutive station-pair and `union()` the
 * results. This is the classic "convex hull of stacked slices" approximation:
 *   - It is deterministic and library-free (pure built-in OpenSCAD ops).
 *   - It is *only* exact when each swept segment is convex; concave profiles
 *     or sharp path turns are over-filled by the convex hull. Callers that
 *     need a faithful sweep should use `sweepLoft.buildSweep` →
 *     BOSL2 `path_sweep` instead. We document this here so the limitation is
 *     explicit at the call site.
 *
 * Profiles are NOT reoriented to the path tangent (no Frenet framing): the
 * profile is translated, not rotated. This keeps the serializer fully
 * deterministic and is adequate for the faceted preview use-case. Tangent-
 * aligned framing is a Phase 2.x follow-up (tracked with the rest of the
 * sweep roadmap in `sweepLoft.ts`).
 *
 * IR-first: the `SweepPathFeature` IR is backend-agnostic; only
 * `sweepPathToScad` is OpenSCAD-specific.
 */

// ─── IR ───────────────────────────────────────────────────────────────────

export interface SweepPathFeature {
  kind: 'sweep_path';
  /** Closed 2D profile loop (≥3 points). Translated, not rotated, per station. */
  profile: ReadonlyArray<{ x: number; y: number }>;
  /** Path stations in 3D world space (≥2 points). */
  path: ReadonlyArray<{ x: number; y: number; z: number }>;
}

export type ArcPlane = 'xz' | 'yz' | 'xy';

export interface SweepPathValidation {
  ok: boolean;
  errors: string[];
}

const EPS = 1e-9;

// ─── arc path tessellation ──────────────────────────────────────────────────

/**
 * Tessellate a circular arc into a deterministic list of 3D path points.
 *
 * The arc is centered at `center`, has the given `radius`, and sweeps from
 * `startAngleDeg` to `endAngleDeg` (degrees, signed — may go either way) using
 * `segments` straight chords, yielding `segments + 1` points. Angles are
 * measured CCW from the first in-plane axis.
 *
 * `plane` selects the plane the arc lives in (the third coordinate is taken
 * from `center` and held constant):
 *   - 'xy': x = cosθ, y = sinθ, z = center.z
 *   - 'xz': x = cosθ, z = sinθ, y = center.y
 *   - 'yz': y = cosθ, z = sinθ, x = center.x   (default for upright sweeps)
 */
export function arcPath(
  center: { x: number; y: number; z: number },
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  segments: number,
  plane: ArcPlane = 'xz',
): { x: number; y: number; z: number }[] {
  assertFinite(center.x, 'center.x');
  assertFinite(center.y, 'center.y');
  assertFinite(center.z, 'center.z');
  assertFinite(radius, 'radius');
  assertFinite(startAngleDeg, 'startAngleDeg');
  assertFinite(endAngleDeg, 'endAngleDeg');
  if (radius <= 0) throw new Error(`arcPath: radius must be > 0, got ${radius}`);
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error(`arcPath: segments must be an integer ≥ 1, got ${segments}`);
  }

  const start = (startAngleDeg * Math.PI) / 180;
  const end = (endAngleDeg * Math.PI) / 180;
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const theta = start + (end - start) * t;
    const c = Math.cos(theta) * radius;
    const s = Math.sin(theta) * radius;
    switch (plane) {
      case 'xy':
        out.push({ x: center.x + c, y: center.y + s, z: center.z });
        break;
      case 'xz':
        out.push({ x: center.x + c, y: center.y, z: center.z + s });
        break;
      case 'yz':
        out.push({ x: center.x, y: center.y + c, z: center.z + s });
        break;
    }
  }
  return out;
}

// ─── validation ─────────────────────────────────────────────────────────────

export function validateSweepPath(f: SweepPathFeature): SweepPathValidation {
  const errors: string[] = [];

  if (f.kind !== 'sweep_path') {
    errors.push(`kind must be 'sweep_path', got '${String((f as { kind?: unknown }).kind)}'`);
  }

  if (!Array.isArray(f.profile) || f.profile.length < 3) {
    errors.push(`profile must have ≥3 points, got ${f.profile?.length ?? 0}`);
  } else {
    for (let i = 0; i < f.profile.length; i++) {
      const p = f.profile[i]!;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        errors.push(`profile point ${i} has non-finite coordinate`);
      }
    }
  }

  if (!Array.isArray(f.path) || f.path.length < 2) {
    errors.push(`path must have ≥2 points, got ${f.path?.length ?? 0}`);
  } else {
    for (let i = 0; i < f.path.length; i++) {
      const p = f.path[i]!;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        errors.push(`path point ${i} has non-finite coordinate`);
      }
    }
    for (let i = 1; i < f.path.length; i++) {
      const a = f.path[i - 1]!;
      const b = f.path[i]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d < EPS) {
        errors.push(`path segment ${i - 1}→${i} is zero-length`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── measurement ─────────────────────────────────────────────────────────────

/** Total length of the path polyline (sum of consecutive segment lengths). */
export function pathLength(f: SweepPathFeature): number {
  if (!Array.isArray(f.path) || f.path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < f.path.length; i++) {
    const a = f.path[i - 1]!;
    const b = f.path[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

// ─── serialization ───────────────────────────────────────────────────────────

/**
 * Serialize the swept solid to OpenSCAD as a `union()` of `hull()` pairs.
 *
 * For a path with N stations we emit N-1 hulls, each hulling the profile
 * placed at station i with the profile placed at station i+1. A 2-point
 * (straight) path degenerates to exactly one `hull()`. The profile is given a
 * tiny extrusion height so each station is a thin 3D slab (a flat 2D polygon
 * would make `hull()` produce a degenerate solid in 3D).
 *
 * This is a *faceted convex approximation* — see the module header.
 * Deterministic: identical input → byte-identical output.
 */
export function sweepPathToScad(f: SweepPathFeature): string {
  const v = validateSweepPath(f);
  if (!v.ok) {
    throw new Error(`sweepPathToScad: invalid SweepPathFeature: ${v.errors.join('; ')}`);
  }

  const polyPts = f.profile.map((p) => `[${fmt(p.x)}, ${fmt(p.y)}]`).join(', ');
  // A thin slab so consecutive flat profiles hull into a real 3D solid.
  const slab = `linear_extrude(height=0.001) polygon([${polyPts}])`;

  const stationAt = (i: number): string => {
    const p = f.path[i]!;
    return `translate([${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}]) ${slab};`;
  };

  const hulls: string[] = [];
  for (let i = 1; i < f.path.length; i++) {
    hulls.push(
      `  hull() {\n` +
        `    ${stationAt(i - 1)}\n` +
        `    ${stationAt(i)}\n` +
        `  }`,
    );
  }

  return (
    `// NEXYFAB:SWEEP_PATH (faceted convex-hull approximation)\n` +
    `union() {\n${hulls.join('\n')}\n}`
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function assertFinite(n: number, name: string): void {
  if (!Number.isFinite(n)) throw new Error(`arcPath: ${name} must be finite, got ${n}`);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`sweepPath: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
