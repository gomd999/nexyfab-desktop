/**
 * adaptiveTessellation.ts — Per-feature tessellation tolerance policy.
 *
 * A single global tolerance over-tessellates large plane regions
 * (wastes triangles on a flat car body) AND under-tessellates small
 * features (a 1mm hole vanishes into 4 triangles). Adaptive picks a
 * tolerance proportional to each feature's size — small holes get
 * tight tolerance, big planes get loose.
 *
 * Rules (memory `nexyfab-3d-burnin` calibrated against the burn-in suite):
 *
 *   - Plane / linear face: tolerance ≈ feature span × 0.5%
 *   - Cylinder / cone:     tolerance ≈ radius × 1.5%
 *   - Sphere:              tolerance ≈ radius × 0.8%
 *   - B-spline / NURBS:    tolerance ≈ bbox-diag × 0.5%
 *
 * Hard clamps to keep things sane:
 *   - Never below `minToleranceMm` (default 0.01 mm)
 *   - Never above `maxToleranceMm` (default 1.0 mm)
 *
 * Used by the OCCT import pipeline to call `replicad.mesh()` per-shape
 * with the right tolerance instead of one blanket value for the file.
 */

export type SurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'bspline' | 'unknown';

export interface FeatureSizeInput {
  kind: SurfaceKind;
  /** Bounding-box diagonal (mm). */
  bboxDiagMm: number;
  /** Surface-specific principal dimension (radius / span / chord). */
  principalMm?: number;
}

export interface TessellationOptions {
  minToleranceMm?: number;
  maxToleranceMm?: number;
  /** Quality preset multiplier — preview = 1.5×, hi-quality = 0.5×. */
  qualityFactor?: number;
}

const DEFAULT_MIN = 0.01;
const DEFAULT_MAX = 1.0;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Compute the recommended tessellation tolerance for a single
 *  feature. Higher tolerance = coarser mesh, faster. */
export function tessellationToleranceFor(
  feature: FeatureSizeInput,
  opts: TessellationOptions = {},
): number {
  const min = opts.minToleranceMm ?? DEFAULT_MIN;
  const max = opts.maxToleranceMm ?? DEFAULT_MAX;
  const quality = opts.qualityFactor ?? 1.0;

  let base: number;
  switch (feature.kind) {
    case 'plane':
      base = feature.bboxDiagMm * 0.005;
      break;
    case 'cylinder':
    case 'cone':
      base = (feature.principalMm ?? feature.bboxDiagMm * 0.5) * 0.015;
      break;
    case 'sphere':
      base = (feature.principalMm ?? feature.bboxDiagMm * 0.5) * 0.008;
      break;
    case 'torus':
      base = (feature.principalMm ?? feature.bboxDiagMm * 0.5) * 0.012;
      break;
    case 'bspline':
      base = feature.bboxDiagMm * 0.005;
      break;
    case 'unknown':
      base = feature.bboxDiagMm * 0.01;
      break;
  }
  return clamp(base * quality, min, max);
}

/** Determine the angular tolerance (radians) for surface tessellation.
 *  This caps the deviation of normal vectors between adjacent
 *  triangles — separate from spatial tolerance, with its own quality
 *  scale. */
export function angularToleranceFor(
  feature: FeatureSizeInput,
  opts: TessellationOptions = {},
): number {
  const quality = opts.qualityFactor ?? 1.0;
  // Cylinders / spheres benefit from tighter angular tolerance because
  // they're "curvy" — planes don't need it at all.
  switch (feature.kind) {
    case 'plane':            return 1.0 * quality; // basically unused
    case 'cylinder':
    case 'cone':
    case 'torus':            return 0.2 * quality;
    case 'sphere':           return 0.15 * quality;
    case 'bspline':          return 0.25 * quality;
    case 'unknown':          return 0.3 * quality;
  }
}

/** Aggregate plan for a whole imported file. Returns the per-feature
 *  tolerances + a worst-case summary the import UI shows
 *  ("tessellating 1,234 faces at 0.01–0.45 mm"). */
export interface BulkTessellationPlan {
  features: Array<{ id: string; toleranceMm: number; angularRad: number }>;
  minToleranceMm: number;
  maxToleranceMm: number;
  meanToleranceMm: number;
}

export function planTessellation(
  features: Array<{ id: string } & FeatureSizeInput>,
  opts: TessellationOptions = {},
): BulkTessellationPlan {
  const plan: BulkTessellationPlan = {
    features: [],
    minToleranceMm: Infinity,
    maxToleranceMm: 0,
    meanToleranceMm: 0,
  };
  for (const f of features) {
    const tolerance = tessellationToleranceFor(f, opts);
    const angular = angularToleranceFor(f, opts);
    plan.features.push({ id: f.id, toleranceMm: tolerance, angularRad: angular });
    if (tolerance < plan.minToleranceMm) plan.minToleranceMm = tolerance;
    if (tolerance > plan.maxToleranceMm) plan.maxToleranceMm = tolerance;
  }
  if (features.length > 0) {
    plan.meanToleranceMm = plan.features.reduce((s, f) => s + f.toleranceMm, 0) / plan.features.length;
  } else {
    plan.minToleranceMm = 0;
  }
  return plan;
}
