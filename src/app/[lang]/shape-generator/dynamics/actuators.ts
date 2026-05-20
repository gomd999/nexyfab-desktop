/**
 * actuators.ts — Springs, dampers, motors.
 *
 * Each frame they emit forces / torques that get accumulated on
 * the participating bodies before `stepWorld` integrates.
 *
 * Spring (linear): F = -k · (x - rest) along the unit vector
 * connecting the two anchor points.
 *
 * Damper (linear): F = -c · v_relative along the same line.
 *
 * Motor (rotational): emits torque to drive a hinge to a target
 * position / velocity. Three control modes:
 *   - position: PD controller (Kp, Kd)
 *   - velocity: P controller
 *   - torque: direct torque input (open-loop)
 */

import type { RigidBody, Vec3 } from './rigidBody';
import { applyForceAtPoint, applyTorque, v3 } from './rigidBody';

export interface SpringSpec {
  kind: 'spring';
  bodyA: string;
  bodyB: string;
  anchorA: Vec3;
  anchorB: Vec3;
  /** Spring stiffness N/m. */
  kNperMm: number;
  /** Rest length (mm). */
  restMm: number;
}

export interface DamperSpec {
  kind: 'damper';
  bodyA: string;
  bodyB: string;
  anchorA: Vec3;
  anchorB: Vec3;
  /** Damping coefficient (N·s/m). */
  cNsPerM: number;
}

export type MotorMode = 'position' | 'velocity' | 'torque';

export interface MotorSpec {
  kind: 'motor';
  bodyA: string;
  bodyB: string;
  axis: Vec3;
  mode: MotorMode;
  /** Target value: angle (rad), angular velocity (rad/s), or torque (N·m). */
  target: number;
  /** Position-mode gains. */
  kp?: number;
  kd?: number;
}

export type Actuator = SpringSpec | DamperSpec | MotorSpec;

function lookup(bodies: Record<string, RigidBody>, id: string): RigidBody | null {
  return bodies[id] ?? null;
}

export function applyActuators(
  bodies: Record<string, RigidBody>,
  actuators: Actuator[],
): void {
  for (const a of actuators) {
    switch (a.kind) {
      case 'spring':  applySpring(bodies, a); break;
      case 'damper':  applyDamper(bodies, a); break;
      case 'motor':   applyMotor(bodies, a); break;
    }
  }
}

function applySpring(bodies: Record<string, RigidBody>, s: SpringSpec): void {
  const A = lookup(bodies, s.bodyA);
  const B = lookup(bodies, s.bodyB);
  if (!A || !B) return;
  const pa = v3.add(A.state.position, s.anchorA);
  const pb = v3.add(B.state.position, s.anchorB);
  const delta = v3.sub(pb, pa);
  const distMm = v3.length(delta) * 1000;
  if (distMm < 1e-9) return;
  const dir = v3.scale(delta, 1 / (distMm / 1000));
  const force = (distMm - s.restMm) * s.kNperMm;
  const F = v3.scale(dir, force);
  applyForceAtPoint(A, F, pa);
  applyForceAtPoint(B, v3.scale(F, -1), pb);
}

function applyDamper(bodies: Record<string, RigidBody>, d: DamperSpec): void {
  const A = lookup(bodies, d.bodyA);
  const B = lookup(bodies, d.bodyB);
  if (!A || !B) return;
  const pa = v3.add(A.state.position, d.anchorA);
  const pb = v3.add(B.state.position, d.anchorB);
  const delta = v3.sub(pb, pa);
  const dist = v3.length(delta);
  if (dist < 1e-9) return;
  const dir = v3.scale(delta, 1 / dist);
  const relVel = v3.sub(B.state.velocity, A.state.velocity);
  const speedAlong = v3.dot(relVel, dir);
  const F = v3.scale(dir, -d.cNsPerM * speedAlong);
  applyForceAtPoint(A, v3.scale(F, -1), pa);
  applyForceAtPoint(B, F, pb);
}

function applyMotor(bodies: Record<string, RigidBody>, m: MotorSpec): void {
  const A = lookup(bodies, m.bodyA);
  const B = lookup(bodies, m.bodyB);
  if (!A || !B) return;
  // Project relative angular velocity onto the axis.
  const omegaRel = v3.sub(A.state.angularVelocity, B.state.angularVelocity);
  const omegaAlong = v3.dot(omegaRel, m.axis);

  let torque = 0;
  switch (m.mode) {
    case 'velocity':
      torque = (m.target - omegaAlong) * (m.kp ?? 10);
      break;
    case 'torque':
      torque = m.target;
      break;
    case 'position':
      // Phase-3 starter: simple proportional control on omega only
      // (real PD needs measured angle integration — caller can do).
      torque = (m.target * (m.kp ?? 5)) - omegaAlong * (m.kd ?? 1);
      break;
  }
  const T = v3.scale(m.axis, torque);
  applyTorque(A, T);
  applyTorque(B, v3.scale(T, -1));
}
