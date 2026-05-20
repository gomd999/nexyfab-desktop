/**
 * rigidBody.ts — Time-step integrator for rigid-body dynamics.
 *
 * Stage-2 FEA handles static stress; Stage-2 motion study handles
 * keyframed motion. Stage-3 (this) introduces *physical* motion:
 * a part starts at rest, gravity + spring force pulls it, the
 * pendulum swings naturally without keyframing.
 *
 * Integration scheme: semi-implicit Euler (a.k.a. symplectic Euler).
 *
 *   v += a · dt        // velocity uses NEW acceleration
 *   x += v · dt        // position uses NEW velocity
 *
 * Better energy preservation than explicit Euler; cheap (1 force
 * eval per step). Good enough for preview-grade animation. Real
 * physics (chaotic systems, stiff springs) would warrant RK4 or
 * Verlet — out of scope.
 */

export interface Vec3 {
  x: number; y: number; z: number;
}

export interface Quat {
  x: number; y: number; z: number; w: number;
}

export interface RigidBodyState {
  /** Position (m). */
  position: Vec3;
  /** Orientation quaternion (unit). */
  orientation: Quat;
  /** Linear velocity (m/s). */
  velocity: Vec3;
  /** Angular velocity (rad/s) — in world frame. */
  angularVelocity: Vec3;
}

export interface RigidBodyProps {
  massKg: number;
  /** Diagonal inertia tensor in body frame (kg·m²). */
  inertia: Vec3;
  /** Fixed bodies (mass = ∞) don't move — used for floors / anchors. */
  isFixed?: boolean;
}

export interface RigidBody {
  id: string;
  props: RigidBodyProps;
  state: RigidBodyState;
  /** Net force + torque accumulators reset each frame. */
  netForce: Vec3;
  netTorque: Vec3;
}

// ── Vector helpers ──────────────────────────────────────────────────

export const v3 = {
  zero(): Vec3 { return { x: 0, y: 0, z: 0 }; },
  add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
  sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
  scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
  dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; },
  cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  },
  length(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); },
};

// ── Quaternion helpers ──────────────────────────────────────────────

export const quat = {
  identity(): Quat { return { x: 0, y: 0, z: 0, w: 1 }; },
  mul(a: Quat, b: Quat): Quat {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  },
  normalize(q: Quat): Quat {
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (len === 0) return { x: 0, y: 0, z: 0, w: 1 };
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  },
};

// ── Body construction ───────────────────────────────────────────────

export function createBody(
  id: string,
  props: RigidBodyProps,
  initial: Partial<RigidBodyState> = {},
): RigidBody {
  return {
    id,
    props,
    state: {
      position: initial.position ?? v3.zero(),
      orientation: initial.orientation ?? quat.identity(),
      velocity: initial.velocity ?? v3.zero(),
      angularVelocity: initial.angularVelocity ?? v3.zero(),
    },
    netForce: v3.zero(),
    netTorque: v3.zero(),
  };
}

// ── Force application ───────────────────────────────────────────────

export function applyForce(body: RigidBody, force: Vec3): void {
  if (body.props.isFixed) return;
  body.netForce = v3.add(body.netForce, force);
}

export function applyTorque(body: RigidBody, torque: Vec3): void {
  if (body.props.isFixed) return;
  body.netTorque = v3.add(body.netTorque, torque);
}

/** Apply a force at a point on the body (not the COM) — produces
 *  both linear force and torque relative to COM. */
export function applyForceAtPoint(body: RigidBody, force: Vec3, pointWorld: Vec3): void {
  if (body.props.isFixed) return;
  body.netForce = v3.add(body.netForce, force);
  const r = v3.sub(pointWorld, body.state.position);
  body.netTorque = v3.add(body.netTorque, v3.cross(r, force));
}

// ── Integrator ──────────────────────────────────────────────────────

export interface StepOptions {
  /** Default gravity vector (m/s²). null = no gravity. */
  gravity?: Vec3 | null;
  /** Damping coefficient applied to velocities (0 = none, 1 = full). */
  linearDamping?: number;
  angularDamping?: number;
}

/** Advance one body by dt seconds using semi-implicit Euler. */
export function stepBody(body: RigidBody, dt: number, opts: StepOptions = {}): void {
  if (body.props.isFixed) {
    body.netForce = v3.zero();
    body.netTorque = v3.zero();
    return;
  }
  const { massKg, inertia } = body.props;
  // Linear: a = F / m + g
  const grav = opts.gravity ?? { x: 0, y: -9.81, z: 0 };
  const acc = v3.scale(v3.add(body.netForce, v3.scale(grav, massKg)), 1 / massKg);
  body.state.velocity = v3.add(body.state.velocity, v3.scale(acc, dt));
  if (opts.linearDamping) {
    body.state.velocity = v3.scale(body.state.velocity, 1 - opts.linearDamping * dt);
  }
  body.state.position = v3.add(body.state.position, v3.scale(body.state.velocity, dt));

  // Angular: α = I⁻¹ · τ (diagonal inertia, in world frame approximation).
  const ang = {
    x: body.netTorque.x / inertia.x,
    y: body.netTorque.y / inertia.y,
    z: body.netTorque.z / inertia.z,
  };
  body.state.angularVelocity = v3.add(body.state.angularVelocity, v3.scale(ang, dt));
  if (opts.angularDamping) {
    body.state.angularVelocity = v3.scale(body.state.angularVelocity, 1 - opts.angularDamping * dt);
  }
  // Orientation update via quaternion derivative q' = ½ω·q.
  const w = body.state.angularVelocity;
  const omegaQuat: Quat = { x: w.x, y: w.y, z: w.z, w: 0 };
  const dq = quat.mul(omegaQuat, body.state.orientation);
  body.state.orientation = quat.normalize({
    x: body.state.orientation.x + dq.x * 0.5 * dt,
    y: body.state.orientation.y + dq.y * 0.5 * dt,
    z: body.state.orientation.z + dq.z * 0.5 * dt,
    w: body.state.orientation.w + dq.w * 0.5 * dt,
  });

  // Reset accumulators for next frame.
  body.netForce = v3.zero();
  body.netTorque = v3.zero();
}

/** Advance a list of bodies. */
export function stepWorld(bodies: RigidBody[], dt: number, opts: StepOptions = {}): void {
  for (const b of bodies) stepBody(b, dt, opts);
}
