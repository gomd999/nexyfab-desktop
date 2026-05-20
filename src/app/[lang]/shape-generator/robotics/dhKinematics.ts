/**
 * dhKinematics.ts — Denavit-Hartenberg robot forward kinematics.
 *
 * Robot-arm CAD workflows need forward kinematics: given joint
 * angles, compute the tool-tip pose. DH parameters describe each
 * link with 4 numbers (a, α, d, θ) — once tabulated, the transform
 * for the full chain is the product of per-link homogeneous
 * transforms.
 *
 * Standard (Khalil-Kleinfinger) and modified (Craig) conventions
 * exist; this module uses the **standard** Denavit-Hartenberg
 * convention as documented in Spong's "Robot Modeling and Control":
 *
 *   T_i = Rot_z(θ) · Trans_z(d) · Trans_x(a) · Rot_x(α)
 *
 * Used by:
 *   - **Workcell simulator** — predict the tool-tip path through a
 *     CAM program.
 *   - **Reachability** — does the customer's robot reach every CAM
 *     waypoint? Tool-table check.
 *   - **Collision check** — link transforms feed into mesh
 *     swept-volume vs. obstacle test.
 *
 * Output is a 4×4 homogeneous transform matrix in row-major order.
 */

export interface DHParameter {
  /** Link length (mm) along x. */
  a: number;
  /** Link twist (rad) around x. */
  alpha: number;
  /** Link offset (mm) along z. */
  d: number;
  /** Joint angle (rad) around z. For revolute = the joint variable. */
  theta: number;
  /** Joint kind. */
  kind: 'revolute' | 'prismatic';
  /** Joint name (e.g. 'shoulder', 'elbow'). */
  name?: string;
}

/** 4×4 matrix in row-major order: m[row * 4 + col]. */
export type Mat4 = number[];

// ── Single-link transform ───────────────────────────────────────

/** Compute the 4×4 transform for a single DH link. */
export function dhTransform(p: DHParameter): Mat4 {
  const cTh = Math.cos(p.theta), sTh = Math.sin(p.theta);
  const cAl = Math.cos(p.alpha), sAl = Math.sin(p.alpha);
  // T = Rot_z(θ) · Trans_z(d) · Trans_x(a) · Rot_x(α)
  return [
    cTh, -sTh * cAl,  sTh * sAl, p.a * cTh,
    sTh,  cTh * cAl, -cTh * sAl, p.a * sTh,
    0,    sAl,        cAl,       p.d,
    0,    0,          0,         1,
  ];
}

// ── Chain (forward kinematics) ──────────────────────────────────

export interface ToolPose {
  /** Position (mm). */
  positionMm: [number, number, number];
  /** Rotation matrix (row-major 3×3). */
  rotation: number[];
  /** Full 4×4 homogeneous transform. */
  transform: Mat4;
}

/** Forward kinematics: apply each DH transform in sequence. */
export function forwardKinematics(
  links: DHParameter[],
  jointVariables: number[],
): ToolPose {
  if (jointVariables.length !== links.length) {
    throw new Error(`Expected ${links.length} joint variables, got ${jointVariables.length}`);
  }
  let acc = identity4();
  for (let i = 0; i < links.length; i++) {
    const link = { ...links[i]! };
    const jv = jointVariables[i]!;
    if (link.kind === 'revolute') link.theta = jv;
    else link.d = jv;
    const T = dhTransform(link);
    acc = multiply4(acc, T);
  }
  return extractPose(acc);
}

/** Per-link transforms (useful for collision testing each link). */
export function linkTransforms(
  links: DHParameter[],
  jointVariables: number[],
): Mat4[] {
  if (jointVariables.length !== links.length) {
    throw new Error(`Expected ${links.length} joint variables, got ${jointVariables.length}`);
  }
  let acc = identity4();
  const out: Mat4[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = { ...links[i]! };
    const jv = jointVariables[i]!;
    if (link.kind === 'revolute') link.theta = jv;
    else link.d = jv;
    acc = multiply4(acc, dhTransform(link));
    out.push(acc.slice());
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────

export function identity4(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0]! * b[0 * 4 + c]! +
        a[r * 4 + 1]! * b[1 * 4 + c]! +
        a[r * 4 + 2]! * b[2 * 4 + c]! +
        a[r * 4 + 3]! * b[3 * 4 + c]!;
    }
  }
  return out;
}

function extractPose(t: Mat4): ToolPose {
  return {
    positionMm: [t[3]!, t[7]!, t[11]!],
    rotation: [
      t[0]!, t[1]!, t[2]!,
      t[4]!, t[5]!, t[6]!,
      t[8]!, t[9]!, t[10]!,
    ],
    transform: t,
  };
}

// ── Standard robot presets ──────────────────────────────────────

/** UR5 DH parameters (Universal Robots). All angles in radians. */
export const UR5_DH: DHParameter[] = [
  { a: 0,        alpha: Math.PI / 2,  d: 0.089159, theta: 0, kind: 'revolute', name: 'base' },
  { a: -0.42500, alpha: 0,            d: 0,        theta: 0, kind: 'revolute', name: 'shoulder' },
  { a: -0.39225, alpha: 0,            d: 0,        theta: 0, kind: 'revolute', name: 'elbow' },
  { a: 0,        alpha: Math.PI / 2,  d: 0.10915,  theta: 0, kind: 'revolute', name: 'wrist1' },
  { a: 0,        alpha: -Math.PI / 2, d: 0.09465,  theta: 0, kind: 'revolute', name: 'wrist2' },
  { a: 0,        alpha: 0,            d: 0.0823,   theta: 0, kind: 'revolute', name: 'wrist3' },
];

/** 6-axis generic articulated robot (Fanuc / ABB style approx). */
export const SIX_AXIS_GENERIC_DH: DHParameter[] = [
  { a: 150,   alpha: -Math.PI / 2, d: 450, theta: 0, kind: 'revolute', name: 'J1' },
  { a: 600,   alpha: 0,            d: 0,   theta: 0, kind: 'revolute', name: 'J2' },
  { a: 150,   alpha: -Math.PI / 2, d: 0,   theta: 0, kind: 'revolute', name: 'J3' },
  { a: 0,     alpha: Math.PI / 2,  d: 800, theta: 0, kind: 'revolute', name: 'J4' },
  { a: 0,     alpha: -Math.PI / 2, d: 0,   theta: 0, kind: 'revolute', name: 'J5' },
  { a: 0,     alpha: 0,            d: 100, theta: 0, kind: 'revolute', name: 'J6' },
];

// ── Workspace inverse kinematics (numeric, Jacobian transpose) ──

/** Solve for joint angles that approximately reach the target.
 *  Uses the Jacobian transpose method — convergent for most poses,
 *  not robust at singularities. Production needs damped least-squares. */
export function inverseKinematicsNumeric(
  links: DHParameter[],
  targetPositionMm: [number, number, number],
  initialJoints: number[],
  maxIterations: number = 200,
  tolerance: number = 1,
): { joints: number[]; converged: boolean; finalErrorMm: number; iterations: number } {
  const joints = initialJoints.slice();
  let lastErr = Infinity;
  let iter = 0;
  const epsilon = 0.001;

  for (iter = 0; iter < maxIterations; iter++) {
    const pose = forwardKinematics(links, joints);
    const err: [number, number, number] = [
      targetPositionMm[0] - pose.positionMm[0],
      targetPositionMm[1] - pose.positionMm[1],
      targetPositionMm[2] - pose.positionMm[2],
    ];
    const errMag = Math.hypot(err[0], err[1], err[2]);
    lastErr = errMag;
    if (errMag < tolerance) break;

    // Numerical Jacobian (3 × n).
    const J: number[][] = Array.from({ length: 3 }, () => new Array(joints.length).fill(0));
    for (let j = 0; j < joints.length; j++) {
      const original = joints[j]!;
      joints[j] = original + epsilon;
      const perturbed = forwardKinematics(links, joints);
      joints[j] = original;
      J[0]![j] = (perturbed.positionMm[0] - pose.positionMm[0]) / epsilon;
      J[1]![j] = (perturbed.positionMm[1] - pose.positionMm[1]) / epsilon;
      J[2]![j] = (perturbed.positionMm[2] - pose.positionMm[2]) / epsilon;
    }
    // Jacobian transpose step: Δq = α · J^T · err
    const alpha = 0.01;
    for (let j = 0; j < joints.length; j++) {
      joints[j] += alpha * (J[0]![j]! * err[0] + J[1]![j]! * err[1] + J[2]![j]! * err[2]);
    }
  }

  return {
    joints,
    converged: lastErr < tolerance,
    finalErrorMm: lastErr,
    iterations: iter,
  };
}

// ── Joint limits ────────────────────────────────────────────────

export interface JointLimits {
  min: number;
  max: number;
}

export function violatesLimits(joints: number[], limits: JointLimits[]): number[] {
  const violations: number[] = [];
  for (let i = 0; i < joints.length; i++) {
    const l = limits[i];
    if (!l) continue;
    if (joints[i]! < l.min || joints[i]! > l.max) violations.push(i);
  }
  return violations;
}
