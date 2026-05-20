/**
 * breakoutAuxViewGenerator.ts — Auto-generate broken-out section /
 * auxiliary views to dimension a feature obscured by other geometry.
 *
 * A breakout view exposes an internal feature (hole, recess) without
 * showing a full section. An auxiliary view projects onto an
 * inclined face so dimensions appear true-length.
 *
 * Module:
 *   - Accepts a feature position + extent + view orientation.
 *   - Generates the cut polygon (cloud-shaped boundary).
 *   - Computes auxiliary view rotation matrix.
 *   - Outputs placement + scale metadata.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; y: number }

export interface FeatureToExpose {
  id: string;
  /** Centre in 3D. */
  centre: Vec3;
  /** Bounding extent. */
  extentMm: { width: number; height: number; depth: number };
  /** Surface normal direction. */
  normal: Vec3;
}

export interface ViewOptions {
  /** Cut depth fraction (0..1 of extent.depth). */
  cutDepthFraction: number;
  /** Number of cloud-curve vertices around the breakout. */
  cloudVertices: number;
  /** Cloud "fluctuation" amplitude. */
  cloudAmplitudeMm: number;
  /** Scale ratio for the auxiliary view (1.0 = same). */
  scale: number;
}

export const DEFAULT_OPTIONS: ViewOptions = {
  cutDepthFraction: 0.3,
  cloudVertices: 16,
  cloudAmplitudeMm: 1,
  scale: 1,
};

export interface BreakoutView {
  featureId: string;
  /** Cloud polygon in parent-view 2D coords. */
  cloudPolygon: Vec2[];
  /** Cut depth (mm) into the part. */
  cutDepthMm: number;
  /** Centre of the breakout. */
  centre2d: Vec2;
}

export interface AuxView {
  featureId: string;
  /** Rotation matrix (3×3 row-major) into auxiliary projection plane. */
  rotation: [number, number, number, number, number, number, number, number, number];
  /** Origin of the aux view in parent coords. */
  origin: Vec2;
  /** Scale. */
  scale: number;
  /** Reference label (e.g. "VIEW A-A"). */
  label: string;
}

// ── Top-level entry: breakout view ────────────────────────────

export function generateBreakout(feature: FeatureToExpose, parentProject: 'xy' | 'xz' | 'yz', options: Partial<ViewOptions> = {}): BreakoutView {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const centre2d = project(feature.centre, parentProject);
  const extent2d = projectExtent(feature.extentMm, parentProject);
  const cloud: Vec2[] = [];
  for (let i = 0; i < opts.cloudVertices; i++) {
    const t = (i / opts.cloudVertices) * Math.PI * 2;
    const rBase = Math.max(extent2d.width, extent2d.height) / 2;
    const r = rBase + (Math.sin(t * 5) + Math.cos(t * 3)) * opts.cloudAmplitudeMm * 0.5;
    cloud.push({
      x: centre2d.x + r * Math.cos(t),
      y: centre2d.y + r * Math.sin(t),
    });
  }
  return {
    featureId: feature.id,
    cloudPolygon: cloud,
    cutDepthMm: feature.extentMm.depth * opts.cutDepthFraction,
    centre2d,
  };
}

function project(p: Vec3, plane: 'xy' | 'xz' | 'yz'): Vec2 {
  if (plane === 'xy') return { x: p.x, y: p.y };
  if (plane === 'xz') return { x: p.x, y: p.z };
  return { x: p.y, y: p.z };
}

function projectExtent(e: { width: number; height: number; depth: number }, plane: 'xy' | 'xz' | 'yz'): { width: number; height: number } {
  if (plane === 'xy') return { width: e.width, height: e.height };
  if (plane === 'xz') return { width: e.width, height: e.depth };
  return { width: e.height, height: e.depth };
}

// ── Top-level entry: auxiliary view ───────────────────────────

export function generateAuxView(feature: FeatureToExpose, offset: Vec2, label: string, options: Partial<ViewOptions> = {}): AuxView {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rotation = rotationFromNormal(feature.normal);
  return {
    featureId: feature.id,
    rotation,
    origin: offset,
    scale: opts.scale,
    label,
  };
}

function rotationFromNormal(normal: Vec3): [number, number, number, number, number, number, number, number, number] {
  // Build a rotation that maps the normal to +Z.
  const nx = normal.x, ny = normal.y, nz = normal.z;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const nz0 = nz / len;
  const nx0 = nx / len;
  const ny0 = ny / len;
  // Construct orthogonal axes.
  const helper = Math.abs(nx0) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const axisX = cross(helper, { x: nx0, y: ny0, z: nz0 });
  const lenX = Math.hypot(axisX.x, axisX.y, axisX.z);
  const ax = axisX.x / lenX, ay = axisX.y / lenX, az = axisX.z / lenX;
  const axisY = cross({ x: nx0, y: ny0, z: nz0 }, { x: ax, y: ay, z: az });
  return [ax, ay, az, axisY.x, axisY.y, axisY.z, nx0, ny0, nz0];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

// ── Cloud polygon length ─────────────────────────────────────

export function cloudPerimeter(view: BreakoutView): number {
  let total = 0;
  const pts = view.cloudPolygon;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ── Scale fitness ────────────────────────────────────────────

export interface ScaleFit {
  scale: number;
  /** Whether feature fits in the suggested aux view box. */
  fits: boolean;
  /** Suggested scale to make the feature 30 mm tall on paper. */
  suggested: number;
}

export function checkScaleFit(feature: FeatureToExpose, aux: AuxView, maxBoxMm: number = 100): ScaleFit {
  const maxDim = Math.max(feature.extentMm.width, feature.extentMm.height, feature.extentMm.depth) * aux.scale;
  const fits = maxDim <= maxBoxMm;
  const suggested = 30 / Math.max(0.001, Math.max(feature.extentMm.width, feature.extentMm.height, feature.extentMm.depth));
  return { scale: aux.scale, fits, suggested };
}

// ── Summary ────────────────────────────────────────────────────

export interface ViewSummary {
  breakoutCloudVertexCount: number;
  cloudPerimeterMm: number;
  cutDepthMm: number;
  auxScale: number;
}

export function summarize(breakout: BreakoutView, aux: AuxView): ViewSummary {
  return {
    breakoutCloudVertexCount: breakout.cloudPolygon.length,
    cloudPerimeterMm: cloudPerimeter(breakout),
    cutDepthMm: breakout.cutDepthMm,
    auxScale: aux.scale,
  };
}
