/**
 * constraints.ts — Lagrangian constraint forces for assembly mates.
 *
 * Mates in static assembly are pre-evaluated by the mate solver.
 * For dynamic simulation, we need *forces* that maintain the mate
 * even under gravity/contact loads. This module computes those
 * forces using a simple impulse-based approach common in real-time
 * physics (PGS — projected Gauss-Seidel).
 *
 * Each tick:
 *   1. Compute the constraint error (e.g. distance deviation).
 *   2. Compute the Jacobian J (how the error responds to body
 *      velocities).
 *   3. Compute the impulse λ that zeros the velocity along the
 *      constraint direction:  λ = - (J·v + bias) / (J·M⁻¹·Jᵀ)
 *   4. Apply impulse to involved bodies.
 *
 * Implemented constraints: distance (rod), point-on-plane, hinge.
 * Each constraint reduces 1, 2, or 5 degrees of freedom respectively.
 */

import type { RigidBody, Vec3 } from './rigidBody';
import { v3 } from './rigidBody';

export type Constraint =
  | DistanceConstraint
  | HingeConstraint
  | PointOnPlaneConstraint;

export interface DistanceConstraint {
  kind: 'distance';
  bodyA: string;
  bodyB: string;
  /** Anchor points in each body's local frame. */
  anchorA: Vec3;
  anchorB: Vec3;
  /** Target distance (m). */
  targetMm: number;
}

export interface HingeConstraint {
  kind: 'hinge';
  bodyA: string;
  bodyB: string;
  /** Hinge axis (world frame, unit vector). */
  axis: Vec3;
  anchorA: Vec3;
  anchorB: Vec3;
}

export interface PointOnPlaneConstraint {
  kind: 'point-on-plane';
  body: string;
  /** Anchor on the body (local frame). */
  anchor: Vec3;
  /** Plane normal + point (world frame). */
  planeNormal: Vec3;
  planePoint: Vec3;
}

function lookup(bodies: Record<string, RigidBody>, id: string): RigidBody | null {
  return bodies[id] ?? null;
}

/** Compute and apply constraint forces for one tick. */
export interface SolveResult {
  /** Constraint error magnitudes (m) — for diagnostic. */
  errors: number[];
  /** Number of constraints actually applied. */
  applied: number;
}

export function solveConstraints(
  bodies: Record<string, RigidBody>,
  constraints: Constraint[],
  iterations: number = 4,
): SolveResult {
  const errors: number[] = [];
  let applied = 0;

  // Projected Gauss-Seidel: relax constraints iteratively.
  for (let iter = 0; iter < iterations; iter++) {
    for (const c of constraints) {
      const err = solveOne(bodies, c);
      if (err !== null) {
        applied++;
        if (iter === iterations - 1) errors.push(err);
      }
    }
  }

  return { errors, applied };
}

function solveOne(
  bodies: Record<string, RigidBody>,
  c: Constraint,
): number | null {
  switch (c.kind) {
    case 'distance': return solveDistance(bodies, c);
    case 'hinge': return solveHinge(bodies, c);
    case 'point-on-plane': return solvePointOnPlane(bodies, c);
  }
}

function solveDistance(
  bodies: Record<string, RigidBody>,
  c: DistanceConstraint,
): number | null {
  const A = lookup(bodies, c.bodyA);
  const B = lookup(bodies, c.bodyB);
  if (!A || !B) return null;

  const pa = v3.add(A.state.position, c.anchorA);
  const pb = v3.add(B.state.position, c.anchorB);
  const delta = v3.sub(pb, pa);
  const dist = v3.length(delta);
  if (dist === 0) return 0;
  const error = dist - (c.targetMm / 1000);
  if (Math.abs(error) < 1e-6) return error;

  // Direction unit vector.
  const dir = v3.scale(delta, 1 / dist);
  // Effective mass — both bodies' inverse masses sum.
  const invMassA = A.props.isFixed ? 0 : 1 / A.props.massKg;
  const invMassB = B.props.isFixed ? 0 : 1 / B.props.massKg;
  const w = invMassA + invMassB;
  if (w === 0) return error;

  // Positional correction (Baumgarte stabilisation simplified).
  const correction = v3.scale(dir, error / w);
  if (!A.props.isFixed) A.state.position = v3.add(A.state.position, v3.scale(correction, invMassA));
  if (!B.props.isFixed) B.state.position = v3.sub(B.state.position, v3.scale(correction, invMassB));
  return error;
}

function solveHinge(
  bodies: Record<string, RigidBody>,
  c: HingeConstraint,
): number | null {
  // Hinge = distance + axial alignment. Phase-3 starter handles
  // anchor-coincidence; axial alignment is a follow-up.
  const A = lookup(bodies, c.bodyA);
  const B = lookup(bodies, c.bodyB);
  if (!A || !B) return null;
  const pa = v3.add(A.state.position, c.anchorA);
  const pb = v3.add(B.state.position, c.anchorB);
  const delta = v3.sub(pb, pa);
  const err = v3.length(delta);
  if (err < 1e-6) return err;

  const invMassA = A.props.isFixed ? 0 : 1 / A.props.massKg;
  const invMassB = B.props.isFixed ? 0 : 1 / B.props.massKg;
  const w = invMassA + invMassB;
  if (w === 0) return err;

  const correction = v3.scale(delta, 1 / w);
  if (!A.props.isFixed) A.state.position = v3.add(A.state.position, v3.scale(correction, invMassA));
  if (!B.props.isFixed) B.state.position = v3.sub(B.state.position, v3.scale(correction, invMassB));
  return err;
}

function solvePointOnPlane(
  bodies: Record<string, RigidBody>,
  c: PointOnPlaneConstraint,
): number | null {
  const body = lookup(bodies, c.body);
  if (!body) return null;
  const p = v3.add(body.state.position, c.anchor);
  // Signed distance to plane.
  const d = v3.dot(v3.sub(p, c.planePoint), c.planeNormal);
  if (Math.abs(d) < 1e-6) return d;
  const invMass = body.props.isFixed ? 0 : 1 / body.props.massKg;
  if (invMass === 0) return d;
  const correction = v3.scale(c.planeNormal, -d);
  body.state.position = v3.add(body.state.position, correction);
  return d;
}
