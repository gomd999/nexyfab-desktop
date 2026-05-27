/**
 * cmmCoordinateFrameSetup.ts — Establish the CMM/part coordinate
 * frame via the 3-2-1 method.
 *
 * Before measuring deviations, the CMM operator probes 6 points to
 * uniquely lock the part's coordinate frame:
 *
 *   - 3 points on the *primary datum* (a face) → defines the
 *     primary Z axis (face normal) + Z origin.
 *   - 2 points on the *secondary datum* (an edge) → defines the
 *     X axis direction.
 *   - 1 point on the *tertiary datum* (a feature) → defines the
 *     X & Y origin.
 *
 * The 3-2-1 method is the foundation of every dimensional
 * inspection. This module computes the resulting frame
 * (origin + orthonormal basis) from the 6 probed points.
 *
 * Output: a 4×4 transform that maps machine coordinates into the
 * part's measurement frame. Caller multiplies subsequent measured
 * points by this transform to get part-frame coordinates.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface FrameSetupInput {
  /** 3 points on the primary datum face. */
  primaryPoints: [Vec3, Vec3, Vec3];
  /** 2 points on the secondary datum edge. */
  secondaryPoints: [Vec3, Vec3];
  /** 1 point on the tertiary datum (origin in XY). */
  tertiaryPoint: Vec3;
}

export interface CoordinateFrame {
  origin: Vec3;
  /** Unit vector for part-X axis (in machine frame). */
  xAxis: Vec3;
  /** Unit vector for part-Y axis. */
  yAxis: Vec3;
  /** Unit vector for part-Z axis (= primary normal). */
  zAxis: Vec3;
  /** 4×4 row-major matrix transforming machine → part coords. */
  machineToPartMatrix: number[];
}

export interface FrameDiagnostics {
  /** Max distance of primary points from the fitted plane (mm). */
  primaryPlaneError: number;
  /** Skew between secondary direction and primary plane (radians). */
  secondaryProjectionAngle: number;
  /** Orthogonality check: |dot(X, Z)| (should be ≈ 0). */
  axisOrthogonality: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function setupCoordinateFrame(input: FrameSetupInput): { frame: CoordinateFrame; diagnostics: FrameDiagnostics } {
  // 1. Primary plane normal = cross of (p2-p1) × (p3-p1).
  const p1 = input.primaryPoints[0];
  const p2 = input.primaryPoints[1];
  const p3 = input.primaryPoints[2];
  const v12 = sub(p2, p1);
  const v13 = sub(p3, p1);
  const zAxis = normalize(cross(v12, v13));
  // Primary plane passes through centroid of the 3 points.
  const primaryCentroid: Vec3 = {
    x: (p1.x + p2.x + p3.x) / 3,
    y: (p1.y + p2.y + p3.y) / 3,
    z: (p1.z + p2.z + p3.z) / 3,
  };

  // 2. Secondary direction = projected onto primary plane.
  const s1 = input.secondaryPoints[0];
  const s2 = input.secondaryPoints[1];
  const sDir = sub(s2, s1);
  // Remove the component along zAxis to project onto primary plane.
  const sDirProjected = subScaled(sDir, zAxis, dot(sDir, zAxis));
  const xAxis = normalize(sDirProjected);
  const yAxis = normalize(cross(zAxis, xAxis));

  // 3. Origin: tertiary point projected onto primary plane gives X, Y origin
  //    in part frame, but its Z is 0 (lies on the primary plane).
  const t = input.tertiaryPoint;
  // Origin in machine frame: project t onto primary plane, then keep its
  // X-coord = 0, Y-coord = 0 in part frame → equivalent to origin = t projected onto plane.
  const distToPlane = dot(sub(t, primaryCentroid), zAxis);
  const origin: Vec3 = subScaled(t, zAxis, distToPlane);

  // Build the matrix (3x3 rotation column-major, with translation).
  // World → Part: R^T (p - origin).
  // We expose row-major for compatibility with typical 3D libs.
  const tx = -(xAxis.x * origin.x + xAxis.y * origin.y + xAxis.z * origin.z);
  const ty = -(yAxis.x * origin.x + yAxis.y * origin.y + yAxis.z * origin.z);
  const tz = -(zAxis.x * origin.x + zAxis.y * origin.y + zAxis.z * origin.z);
  const matrix = [
    xAxis.x, xAxis.y, xAxis.z, tx,
    yAxis.x, yAxis.y, yAxis.z, ty,
    zAxis.x, zAxis.y, zAxis.z, tz,
    0, 0, 0, 1,
  ];

  // Diagnostics.
  const planeErr = Math.max(
    Math.abs(dot(sub(p1, primaryCentroid), zAxis)),
    Math.abs(dot(sub(p2, primaryCentroid), zAxis)),
    Math.abs(dot(sub(p3, primaryCentroid), zAxis)),
  );
  const sDirLen = Math.hypot(sDir.x, sDir.y, sDir.z) || 1;
  const angleProj = Math.asin(Math.min(1, Math.abs(dot(sDir, zAxis)) / sDirLen));
  const ortho = Math.abs(dot(xAxis, zAxis));
  void v13;
  void xAxis;
  return {
    frame: { origin, xAxis, yAxis, zAxis, machineToPartMatrix: matrix },
    diagnostics: { primaryPlaneError: planeErr, secondaryProjectionAngle: angleProj, axisOrthogonality: ortho },
  };
}

// ── Apply transform ────────────────────────────────────────────

export function applyFrame(frame: CoordinateFrame, point: Vec3): Vec3 {
  const m = frame.machineToPartMatrix;
  return {
    x: m[0]! * point.x + m[1]! * point.y + m[2]! * point.z + m[3]!,
    y: m[4]! * point.x + m[5]! * point.y + m[6]! * point.z + m[7]!,
    z: m[8]! * point.x + m[9]! * point.y + m[10]! * point.z + m[11]!,
  };
}

// ── Vec3 helpers ───────────────────────────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function subScaled(a: Vec3, v: Vec3, s: number): Vec3 {
  return { x: a.x - v.x * s, y: a.y - v.y * s, z: a.z - v.z * s };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 1, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ── Summary ────────────────────────────────────────────────────

export interface FrameSummary {
  primaryPlaneErrorMm: number;
  secondaryProjectionDeg: number;
  axesOrthogonal: boolean;
  isValid: boolean;
}

export function summarize(diagnostics: FrameDiagnostics): FrameSummary {
  return {
    primaryPlaneErrorMm: diagnostics.primaryPlaneError,
    secondaryProjectionDeg: (diagnostics.secondaryProjectionAngle * 180) / Math.PI,
    axesOrthogonal: diagnostics.axisOrthogonality < 1e-3,
    isValid: diagnostics.primaryPlaneError < 0.1 && diagnostics.axisOrthogonality < 1e-3,
  };
}
