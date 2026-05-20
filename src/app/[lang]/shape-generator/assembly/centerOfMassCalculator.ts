/**
 * centerOfMassCalculator.ts — Compute centre of mass + inertia tensor
 * for an assembly composed of rigid bodies.
 *
 * Each body has:
 *
 *   - Mass (kg)
 *   - Local centroid (relative to its own frame)
 *   - Rotation matrix or quaternion expressing its orientation
 *   - Translation expressing its global position
 *   - Optional local inertia tensor (3x3) about its own centroid
 *
 * Assembly properties:
 *
 *   - Total mass = Σ m_i
 *   - Global centroid X̄ = Σ (m_i · x̄_i) / total mass
 *   - Inertia about assembly centroid via parallel axis theorem:
 *       I_total = Σ R_i · I_i · R_i^T + m_i · ([d_i]× [d_i]×^T)
 *     where d_i = global_centroid_i - X̄_total.
 *
 * Used by FEA pre-processing, robotics, statics analysis.
 */

export interface Vec3 { x: number; y: number; z: number }

/** 3x3 matrix stored row-major. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY3: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export interface RigidBody {
  id: string;
  massKg: number;
  /** Centroid in the body's own local frame. */
  localCentroid: Vec3;
  /** Local inertia tensor (3x3) about the local centroid. */
  localInertia?: Matrix3;
  /** Body global position offset. */
  globalPosition: Vec3;
  /** Body orientation (3x3 rotation matrix); defaults to identity. */
  globalOrientation?: Matrix3;
  /** Optional pre-built rotation as quaternion (xyz, w). */
  globalQuaternion?: { x: number; y: number; z: number; w: number };
}

export interface MassProperties {
  totalMassKg: number;
  centroid: Vec3;
  inertiaAboutCentroid: Matrix3;
  /** Per-body global centroid (useful for visualization). */
  perBodyCentroid: Record<string, Vec3>;
}

// ── Top-level entry ────────────────────────────────────────────

export function computeMassProperties(bodies: RigidBody[]): MassProperties {
  if (bodies.length === 0) {
    return {
      totalMassKg: 0,
      centroid: { x: 0, y: 0, z: 0 },
      inertiaAboutCentroid: zeroMatrix(),
      perBodyCentroid: {},
    };
  }

  // Step 1: global centroid of each body.
  const perBody: Record<string, Vec3> = {};
  let totalMass = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const body of bodies) {
    const rot = orientationMatrix(body);
    const localC = body.localCentroid;
    const globalC: Vec3 = {
      x: body.globalPosition.x + rot[0]! * localC.x + rot[1]! * localC.y + rot[2]! * localC.z,
      y: body.globalPosition.y + rot[3]! * localC.x + rot[4]! * localC.y + rot[5]! * localC.z,
      z: body.globalPosition.z + rot[6]! * localC.x + rot[7]! * localC.y + rot[8]! * localC.z,
    };
    perBody[body.id] = globalC;
    totalMass += body.massKg;
    cx += body.massKg * globalC.x;
    cy += body.massKg * globalC.y;
    cz += body.massKg * globalC.z;
  }
  const centroid: Vec3 = totalMass === 0
    ? { x: 0, y: 0, z: 0 }
    : { x: cx / totalMass, y: cy / totalMass, z: cz / totalMass };

  // Step 2: inertia about the assembly centroid (parallel axis).
  let I: Matrix3 = zeroMatrix();
  for (const body of bodies) {
    const rot = orientationMatrix(body);
    const globalC = perBody[body.id]!;
    const d: Vec3 = { x: globalC.x - centroid.x, y: globalC.y - centroid.y, z: globalC.z - centroid.z };

    // Rotate local inertia into the global frame: R·I·R^T.
    const localI = body.localInertia ?? zeroMatrix();
    const rotated = multiply(multiply(rot, localI), transpose(rot));

    // Parallel axis offset: m · (d·d·I - d⊗d).
    const m = body.massKg;
    const dSq = d.x * d.x + d.y * d.y + d.z * d.z;
    const offset: Matrix3 = [
      m * (dSq - d.x * d.x), m * (-d.x * d.y),    m * (-d.x * d.z),
      m * (-d.y * d.x),    m * (dSq - d.y * d.y), m * (-d.y * d.z),
      m * (-d.z * d.x),    m * (-d.z * d.y),    m * (dSq - d.z * d.z),
    ];

    I = addMatrix(I, rotated);
    I = addMatrix(I, offset);
  }

  return {
    totalMassKg: totalMass,
    centroid,
    inertiaAboutCentroid: I,
    perBodyCentroid: perBody,
  };
}

// ── Matrix helpers ────────────────────────────────────────────

function zeroMatrix(): Matrix3 {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out: number[] = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i * 3 + k]! * b[k * 3 + j]!;
      out[i * 3 + j] = sum;
    }
  }
  return out as Matrix3;
}

function transpose(a: Matrix3): Matrix3 {
  return [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!];
}

function addMatrix(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!,
    a[3]! + b[3]!, a[4]! + b[4]!, a[5]! + b[5]!,
    a[6]! + b[6]!, a[7]! + b[7]!, a[8]! + b[8]!,
  ];
}

function orientationMatrix(body: RigidBody): Matrix3 {
  if (body.globalOrientation) return body.globalOrientation;
  if (body.globalQuaternion) return quaternionToMatrix(body.globalQuaternion);
  return IDENTITY3;
}

function quaternionToMatrix(q: { x: number; y: number; z: number; w: number }): Matrix3 {
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz),     2 * (xz + wy),
    2 * (xy + wz),     1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy),     2 * (yz + wx),     1 - 2 * (xx + yy),
  ];
}

// ── Principal axes / moments ──────────────────────────────────

export interface PrincipalAxes {
  /** Eigenvalues sorted descending. */
  principalMoments: [number, number, number];
}

/** Quick estimate of principal moments via diagonal extraction
 *  (exact only for diagonally-symmetric tensors). */
export function principalMoments(inertia: Matrix3): PrincipalAxes {
  const diag: [number, number, number] = [inertia[0]!, inertia[4]!, inertia[8]!];
  diag.sort((a, b) => b - a);
  return { principalMoments: diag };
}

// ── Summary ────────────────────────────────────────────────────

export interface MassSummary {
  bodyCount: number;
  totalMassKg: number;
  centroid: Vec3;
  largestPrincipalMoment: number;
}

export function summarize(bodies: RigidBody[], props: MassProperties): MassSummary {
  const pm = principalMoments(props.inertiaAboutCentroid);
  return {
    bodyCount: bodies.length,
    totalMassKg: props.totalMassKg,
    centroid: props.centroid,
    largestPrincipalMoment: pm.principalMoments[0],
  };
}
