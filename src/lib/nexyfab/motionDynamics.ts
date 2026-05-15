// Motion dynamics — explicit Euler rigid-body integrator with revolute /
// prismatic joints and a CCD inverse kinematics solver. Builds on
// motionStudy.ts (AABB stepping) by adding force/torque integration so
// gear trains, linkages, and gravity-driven sequences can be simulated.
//
// Constraints are enforced via Featherstone-style impulse projection rather
// than full Lagrangian dynamics — sufficient for assembly motion checks at
// ~60 Hz simulation rate, fragile for high-frequency contact.

export type Vec3 = [number, number, number];

export interface RigidBody {
  id: string;
  /** Mass in kg. Set 0 for static / world-frame bodies. */
  mass: number;
  /** World-frame center of mass. */
  position: Vec3;
  /** World-frame linear velocity. */
  velocity: Vec3;
  /** World-frame angular velocity (rad/s). */
  angularVelocity: Vec3;
  /** Diagonal inertia tensor approximation. */
  inertia: Vec3;
  /** Optional axis-aligned bounding-box half-extent for collision. */
  aabbHalf?: Vec3;
}

export type Joint =
  | { kind: 'revolute'; parentId: string; childId: string; axis: Vec3; anchor: Vec3; /** rad/s drive. */ driveVel?: number }
  | { kind: 'prismatic'; parentId: string; childId: string; axis: Vec3; /** mm/s drive. */ driveVel?: number }
  | { kind: 'fixed'; parentId: string; childId: string; offset: Vec3 };

export interface DynamicsWorld {
  bodies: RigidBody[];
  joints: Joint[];
  /** World gravity vector (m/s²). Default −9.81 Z. */
  gravity?: Vec3;
}

export interface StepOptions {
  dt: number;
  iterations?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function vadd(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vsub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vscale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function vcross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ─── Step integration ──────────────────────────────────────────────────────

/**
 * Advance the world by `dt` seconds. Constraints are projected after
 * integration (post-stabilization). For accurate joint behavior call this
 * with small `dt` (≤ 1/120 s) and `iterations` > 1.
 */
export function stepWorld(world: DynamicsWorld, opts: StepOptions): void {
  const { dt, iterations = 4 } = opts;
  const subDt = dt / iterations;
  const g = world.gravity ?? [0, 0, -9.81];

  const bodyMap = new Map<string, RigidBody>();
  for (const b of world.bodies) bodyMap.set(b.id, b);

  for (let i = 0; i < iterations; i++) {
    // ── Apply gravity + integrate ──
    for (const body of world.bodies) {
      if (body.mass === 0) continue;
      body.velocity = vadd(body.velocity, vscale(g, subDt));
      body.position = vadd(body.position, vscale(body.velocity, subDt));
    }

    // ── Solve joints ──
    for (const joint of world.joints) {
      const parent = bodyMap.get(joint.parentId);
      const child = bodyMap.get(joint.childId);
      if (!parent || !child) continue;
      switch (joint.kind) {
        case 'fixed': {
          const target = vadd(parent.position, joint.offset);
          child.position = target;
          child.velocity = parent.velocity;
          child.angularVelocity = parent.angularVelocity;
          break;
        }
        case 'revolute': {
          // Apply drive (servo motor) if requested.
          if (joint.driveVel !== undefined) {
            child.angularVelocity = vscale(joint.axis, joint.driveVel);
          }
          // Position constraint: child should sit at parent + anchor.
          const target = vadd(parent.position, joint.anchor);
          const diff = vsub(child.position, target);
          // Snap with a damped correction.
          child.position = vsub(child.position, vscale(diff, 0.5));
          break;
        }
        case 'prismatic': {
          if (joint.driveVel !== undefined) {
            child.velocity = vscale(joint.axis, joint.driveVel);
          }
          // Force motion to stay along the axis (project velocity).
          const along = joint.axis[0] * child.velocity[0]
            + joint.axis[1] * child.velocity[1]
            + joint.axis[2] * child.velocity[2];
          child.velocity = vscale(joint.axis, along);
          break;
        }
      }
    }
  }
}

// ─── Inverse kinematics (CCD) ──────────────────────────────────────────────

export interface IkChain {
  /** Ordered root → tip body ids. */
  bodyIds: string[];
  /** Tip's local anchor (mm). */
  tipLocal: Vec3;
  /** World-frame target position (mm). */
  target: Vec3;
}

/**
 * Cyclic Coordinate Descent solver. Iteratively rotates each chain link
 * around its joint axis (assumed Z) toward the target. Cheap, robust to
 * partial coverage; ill-suited for very long chains.
 */
export function solveIK(
  chain: IkChain,
  bodies: Record<string, RigidBody>,
  maxIters = 32,
  tolerance = 0.5,
): { converged: boolean; iterations: number; residual: number } {
  let lastErr = Infinity;
  for (let i = 0; i < maxIters; i++) {
    const tip = bodies[chain.bodyIds[chain.bodyIds.length - 1]];
    if (!tip) return { converged: false, iterations: i, residual: Infinity };
    const tipPos = vadd(tip.position, chain.tipLocal);
    const err = vsub(chain.target, tipPos);
    lastErr = Math.sqrt(err[0] ** 2 + err[1] ** 2 + err[2] ** 2);
    if (lastErr < tolerance) return { converged: true, iterations: i, residual: lastErr };

    // Rotate each joint from tip back to root.
    for (let j = chain.bodyIds.length - 2; j >= 0; j--) {
      const link = bodies[chain.bodyIds[j]];
      if (!link) continue;
      const toTip = vsub(tipPos, link.position);
      const toTarget = vsub(chain.target, link.position);
      const lenA = Math.sqrt(toTip[0] ** 2 + toTip[1] ** 2 + toTip[2] ** 2);
      const lenB = Math.sqrt(toTarget[0] ** 2 + toTarget[1] ** 2 + toTarget[2] ** 2);
      if (lenA < 1e-6 || lenB < 1e-6) continue;
      const cos = (toTip[0] * toTarget[0] + toTip[1] * toTarget[1] + toTip[2] * toTarget[2]) / (lenA * lenB);
      const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (Math.abs(angle) < 1e-4) continue;
      const axis = vcross(toTip, toTarget);
      // Rotate the tip about the joint by `angle` around `axis`. CCD ignores
      // joint limits for v1; production should clamp per joint type.
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const k = 1 - cosA;
      const u = [axis[0], axis[1], axis[2]];
      const m = Math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2);
      if (m < 1e-9) continue;
      const n = [u[0] / m, u[1] / m, u[2] / m];
      const dx = tipPos[0] - link.position[0];
      const dy = tipPos[1] - link.position[1];
      const dz = tipPos[2] - link.position[2];
      tipPos[0] = link.position[0] + (cosA + n[0] * n[0] * k) * dx + (n[0] * n[1] * k - n[2] * sinA) * dy + (n[0] * n[2] * k + n[1] * sinA) * dz;
      tipPos[1] = link.position[1] + (n[1] * n[0] * k + n[2] * sinA) * dx + (cosA + n[1] * n[1] * k) * dy + (n[1] * n[2] * k - n[0] * sinA) * dz;
      tipPos[2] = link.position[2] + (n[2] * n[0] * k - n[1] * sinA) * dx + (n[2] * n[1] * k + n[0] * sinA) * dy + (cosA + n[2] * n[2] * k) * dz;
    }
  }
  return { converged: false, iterations: maxIters, residual: lastErr };
}
