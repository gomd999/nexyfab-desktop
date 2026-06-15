/**
 * sweepLoft — Phase 2.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Path-driven feature IRs that join sketch profiles into 3D solids:
 *   - Sweep: one profile + one path = swept solid (profile follows the path).
 *   - Loft: 2+ profiles connected by smooth interpolation.
 *
 * OpenSCAD has no native sweep/loft primitives, so we emit calls to the
 * BOSL2 library bundled with the NexyFab OpenSCAD runtime (see
 * `Dockerfile` — BOSL2 is git-cloned into `/opt/openscad-libs/BOSL2`).
 *
 * IR-first design: future OCCT/Parasolid backends consume the IR
 * directly; only the serializer is BOSL2-specific.
 *
 * Scope (Phase 2.2 minimal):
 *   - Sweep along a straight or polyline path in 3D.
 *   - Loft between 2+ profiles in parallel sketch planes.
 *   - add / cut modes (matches extrude / revolve).
 *
 * Out of scope (Phase 2.x+):
 *   - Sweep with twist / guide rails
 *   - Loft with guide curves / centerline / continuity-preserving G1/G2
 *   - Helix sweep (separate IR — handled later)
 */

import type { ProfilePoint } from '@/lib/sketch/sketchProfile';
import type { ClosedLoop } from '@/lib/sketch/sketchProfile';

// ─── shared types ─────────────────────────────────────────────────────────

export type SweepLoftMode = 'add' | 'cut';

interface Profile2D {
  /** 2D points (CCW-oriented). */
  points: ReadonlyArray<{ x: number; y: number }>;
}

// ─── sweep ────────────────────────────────────────────────────────────────

export interface SweepFeature {
  kind: 'sweep';
  profile: Profile2D;
  /** Path is a polyline in 3D world space. Sweep slides the profile along it,
   *  keeping the profile plane perpendicular to the path tangent. */
  path: ReadonlyArray<{ x: number; y: number; z: number }>;
  mode: SweepLoftMode;
}

export interface SweepOptions {
  profileLoop: ClosedLoop;
  profilePoints: ReadonlyMap<string, ProfilePoint>;
  path: ReadonlyArray<{ x: number; y: number; z: number }>;
  mode?: SweepLoftMode;
}

export function buildSweep(opts: SweepOptions): SweepFeature {
  if (opts.path.length < 2) {
    throw new Error(`sweep: path must have at least 2 points, got ${opts.path.length}`);
  }
  // Reject zero-length path segments.
  for (let i = 1; i < opts.path.length; i++) {
    const a = opts.path[i - 1]!;
    const b = opts.path[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (d < 1e-9) {
      throw new Error(`sweep: path segment ${i - 1}→${i} is zero-length`);
    }
  }
  const orderedIds = opts.profileLoop.signedArea >= 0
    ? opts.profileLoop.points
    : [...opts.profileLoop.points].reverse();
  const pts: { x: number; y: number }[] = [];
  for (const id of orderedIds) {
    const p = opts.profilePoints.get(id);
    if (!p) throw new Error(`sweep: profile point ${id} missing`);
    pts.push({ x: p.x, y: p.y });
  }
  return {
    kind: 'sweep',
    profile: { points: pts },
    path: opts.path,
    mode: opts.mode ?? 'add',
  };
}

export function sweepToScad(feature: SweepFeature): string {
  // BOSL2's `path_sweep(shape, path)` consumes 2D shape + 3D path.
  const shapeArr = feature.profile.points
    .map((p) => `[${fmt(p.x)}, ${fmt(p.y)}]`)
    .join(', ');
  const pathArr = feature.path
    .map((p) => `[${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}]`)
    .join(', ');
  const block = `include <BOSL2/std.scad>\npath_sweep([${shapeArr}], [${pathArr}]);`;
  if (feature.mode === 'cut') {
    return `// NEXYFAB:SWEEP_CUT\n${block}`;
  }
  return block;
}

// ─── loft ─────────────────────────────────────────────────────────────────

export interface LoftFeature {
  kind: 'loft';
  /** 2+ profiles, each in its own parallel plane stacked along z. */
  sections: ReadonlyArray<{
    profile: Profile2D;
    /** z-coordinate of the section's plane (sections must be in monotonic order). */
    z: number;
  }>;
  mode: SweepLoftMode;
}

export interface LoftOptions {
  sections: ReadonlyArray<{
    loop: ClosedLoop;
    /** Per-section point lookup (each section can have its own ids). */
    pointsById: ReadonlyMap<string, ProfilePoint>;
    z: number;
  }>;
  mode?: SweepLoftMode;
}

export function buildLoft(opts: LoftOptions): LoftFeature {
  if (opts.sections.length < 2) {
    throw new Error(`loft: needs ≥2 sections, got ${opts.sections.length}`);
  }
  // Verify monotonic z (ascending) — easier guarantee for downstream
  // matching of section points.
  for (let i = 1; i < opts.sections.length; i++) {
    if (opts.sections[i]!.z <= opts.sections[i - 1]!.z) {
      throw new Error(`loft: sections must be monotonically ascending in z`);
    }
  }
  const sections = opts.sections.map((s) => {
    const orderedIds = s.loop.signedArea >= 0 ? s.loop.points : [...s.loop.points].reverse();
    const pts: { x: number; y: number }[] = [];
    for (const id of orderedIds) {
      const p = s.pointsById.get(id);
      if (!p) throw new Error(`loft: profile point ${id} missing`);
      pts.push({ x: p.x, y: p.y });
    }
    return { profile: { points: pts }, z: s.z };
  });
  // Sanity: all sections should have the same number of points for a
  // well-defined loft (per-corner correspondence). Different counts are
  // allowed by BOSL2 (it resamples), but we warn callers indirectly by
  // enforcing this in Phase 2.2 to avoid surprising results.
  const expectedN = sections[0]!.profile.points.length;
  for (const s of sections) {
    if (s.profile.points.length !== expectedN) {
      throw new Error(
        `loft: all sections must have the same point count (Phase 2.2 limitation). ` +
          `Section z=${s.z} has ${s.profile.points.length}, expected ${expectedN}.`,
      );
    }
  }
  return { kind: 'loft', sections, mode: opts.mode ?? 'add' };
}

export function loftToScad(feature: LoftFeature): string {
  // BOSL2's `skin` takes a list of 3D profiles (each profile is a list of
  // 3D points already lifted to its plane).
  const lifted = feature.sections
    .map((s) => {
      const pts = s.profile.points
        .map((p) => `[${fmt(p.x)}, ${fmt(p.y)}, ${fmt(s.z)}]`)
        .join(', ');
      return `[${pts}]`;
    })
    .join(', ');
  const block = `include <BOSL2/std.scad>\nskin([${lifted}], slices=0, refine=1);`;
  if (feature.mode === 'cut') {
    return `// NEXYFAB:LOFT_CUT\n${block}`;
  }
  return block;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`sweepLoft: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
