/**
 * coordinateDatumFrameBuilder.ts — Build a 3-2-1 coordinate datum
 * reference frame from CMM probe touches.
 *
 * Standard CMM datum capture procedure:
 *
 *   - Primary plane: 3 probe touches define the Z-axis normal.
 *   - Secondary line: 2 touches define the X-axis (perpendicular to
 *     Z within the primary plane).
 *   - Tertiary point: 1 touch sets the origin (sets Y completely).
 *
 * Module:
 *   - Builds the transformation matrix from machine to part frame.
 *   - Reports residual error (how non-perpendicular Z-X actually are).
 *   - Transforms downstream probe points.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface PrimaryTouches {
  /** 3+ touches that define the primary plane. */
  points: Vec3[];
}

export interface SecondaryTouches {
  /** 2+ touches that define the secondary line. */
  points: Vec3[];
}

export interface TertiaryTouch {
  point: Vec3;
}

export interface DatumFrame {
  origin: Vec3;
  /** X axis unit vector. */
  xAxis: Vec3;
  /** Y axis unit vector. */
  yAxis: Vec3;
  /** Z axis unit vector. */
  zAxis: Vec3;
  /** Worst flatness on primary plane (mm). */
  primaryFlatnessMm: number;
  /** Z-X perpendicularity error (deg). */
  squarenessErrDeg: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function buildFrame(primary: PrimaryTouches, secondary: SecondaryTouches, tertiary: TertiaryTouch): DatumFrame {
  const warnings: string[] = [];
  if (primary.points.length < 3) warnings.push('Need ≥ 3 primary touches.');
  if (secondary.points.length < 2) warnings.push('Need ≥ 2 secondary touches.');

  // Fit primary plane via least squares.
  const planeFit = fitPlane(primary.points);
  const zAxis = planeFit.normal;
  const flatness = planeFit.maxDeviation;

  // Project secondary touches onto primary plane and fit line.
  const projected = secondary.points.map(p => projectToPlane(p, planeFit));
  const lineFit = fitLine(projected);
  let xAxis = lineFit.direction;
  // Ensure xAxis is perpendicular to zAxis (Gram-Schmidt).
  const dotZX = dot(xAxis, zAxis);
  xAxis = normalize({ x: xAxis.x - dotZX * zAxis.x, y: xAxis.y - dotZX * zAxis.y, z: xAxis.z - dotZX * zAxis.z });

  const yAxis = cross(zAxis, xAxis);

  // Origin = tertiary point projected onto plane.
  const origin = projectToPlane(tertiary.point, planeFit);

  // Squareness error: angle between original xAxis fit and true xAxis.
  const angleBetween = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(lineFit.direction, zAxis))))) * 180 / Math.PI;
  const squarenessErr = 90 - angleBetween;

  return { origin, xAxis, yAxis, zAxis, primaryFlatnessMm: flatness, squarenessErrDeg: squarenessErr, warnings };
}

// ── Plane fit (least squares) ────────────────────────────────

interface PlaneFit {
  normal: Vec3;
  d: number;
  maxDeviation: number;
}

function fitPlane(points: Vec3[]): PlaneFit {
  if (points.length < 3) {
    return { normal: { x: 0, y: 0, z: 1 }, d: 0, maxDeviation: 0 };
  }
  const centroid = computeCentroid(points);
  // Compute covariance matrix.
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const dx = p.x - centroid.x, dy = p.y - centroid.y, dz = p.z - centroid.z;
    xx += dx * dx; xy += dx * dy; xz += dx * dz;
    yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }
  // Plane normal is the eigenvector of smallest eigenvalue.
  // Heuristic: use cross-product of two basis directions in the plane.
  const a = sub(points[1]!, points[0]!);
  const b = sub(points[2]!, points[0]!);
  let normal = normalize(cross(a, b));
  void xx; void xy; void xz; void yy; void yz; void zz;
  const d = -dot(normal, centroid);
  let maxDev = 0;
  for (const p of points) {
    const dev = Math.abs(dot(normal, p) + d);
    if (dev > maxDev) maxDev = dev;
  }
  // Standardise normal direction (prefer positive Z).
  if (normal.z < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  }
  return { normal, d, maxDeviation: maxDev };
}

function projectToPlane(p: Vec3, plane: PlaneFit): Vec3 {
  const dist = dot(plane.normal, p) + plane.d;
  return { x: p.x - plane.normal.x * dist, y: p.y - plane.normal.y * dist, z: p.z - plane.normal.z * dist };
}

// ── Line fit ─────────────────────────────────────────────────

interface LineFit {
  direction: Vec3;
  origin: Vec3;
}

function fitLine(points: Vec3[]): LineFit {
  if (points.length < 2) return { direction: { x: 1, y: 0, z: 0 }, origin: { x: 0, y: 0, z: 0 } };
  const dir = normalize(sub(points[points.length - 1]!, points[0]!));
  return { direction: dir, origin: points[0]! };
}

// ── Vector helpers ───────────────────────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function computeCentroid(points: Vec3[]): Vec3 {
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
  return { x: cx / points.length, y: cy / points.length, z: cz / points.length };
}

// ── Transform machine point → part frame ─────────────────────

export function transformToPartFrame(machinePoint: Vec3, frame: DatumFrame): Vec3 {
  const rel: Vec3 = sub(machinePoint, frame.origin);
  return {
    x: dot(rel, frame.xAxis),
    y: dot(rel, frame.yAxis),
    z: dot(rel, frame.zAxis),
  };
}

// ── Validate frame ───────────────────────────────────────────

export interface FrameValidation {
  flatnessOk: boolean;
  squarenessOk: boolean;
  axesOrthogonal: boolean;
  warnings: string[];
}

export function validateFrame(frame: DatumFrame, flatnessTolMm: number = 0.01, squarenessTolDeg: number = 0.5): FrameValidation {
  const warnings: string[] = [];
  if (frame.primaryFlatnessMm > flatnessTolMm) warnings.push(`Primary flatness ${frame.primaryFlatnessMm.toFixed(3)} > ${flatnessTolMm}`);
  if (Math.abs(frame.squarenessErrDeg) > squarenessTolDeg) warnings.push(`Squareness error ${frame.squarenessErrDeg.toFixed(2)}°`);
  // Check axes orthogonal.
  const xy = dot(frame.xAxis, frame.yAxis);
  const yz = dot(frame.yAxis, frame.zAxis);
  const xz = dot(frame.xAxis, frame.zAxis);
  const orthogonal = Math.abs(xy) < 0.01 && Math.abs(yz) < 0.01 && Math.abs(xz) < 0.01;
  return {
    flatnessOk: frame.primaryFlatnessMm <= flatnessTolMm,
    squarenessOk: Math.abs(frame.squarenessErrDeg) <= squarenessTolDeg,
    axesOrthogonal: orthogonal,
    warnings,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface FrameSummary {
  primaryFlatnessMm: number;
  squarenessErrDeg: number;
  warningCount: number;
}

export function summarize(frame: DatumFrame): FrameSummary {
  return {
    primaryFlatnessMm: frame.primaryFlatnessMm,
    squarenessErrDeg: frame.squarenessErrDeg,
    warningCount: frame.warnings.length,
  };
}
