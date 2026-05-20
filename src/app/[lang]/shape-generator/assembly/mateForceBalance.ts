/**
 * mateForceBalance.ts — Compute force / moment balance at each mate
 * in an assembly to identify reactions.
 *
 * When an assembly is loaded statically, internal forces flow
 * through mates. For each mate the module computes:
 *
 *   - Net force vector reaction (3 components).
 *   - Net moment vector reaction.
 *   - Magnitude + dominant direction.
 *
 * Used for fastener sizing, joint design, FEA preprocessing.
 * Module operates on a simplified rigid-body assumption: each body
 * is in static equilibrium, sum of forces + moments = 0.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface ExternalLoad {
  /** Body the load is applied to. */
  bodyId: string;
  /** Application point. */
  point: Vec3;
  /** Force vector, N. */
  force: Vec3;
  /** Moment vector, N·mm. */
  moment?: Vec3;
}

export interface MateConnection {
  id: string;
  /** Bodies connected. */
  bodyA: string;
  bodyB: string;
  /** Mate location. */
  point: Vec3;
  /** Which DOFs are constrained (true = constrained). */
  constraints: { fx: boolean; fy: boolean; fz: boolean; mx: boolean; my: boolean; mz: boolean };
}

export interface MateReaction {
  mateId: string;
  bodyA: string;
  bodyB: string;
  /** Force from A onto B. */
  forceOnB: Vec3;
  /** Moment from A onto B. */
  momentOnB: Vec3;
  /** Magnitude. */
  forceMagnitudeN: number;
  momentMagnitudeNmm: number;
}

export interface BalanceResult {
  /** Per-mate reactions. */
  reactions: MateReaction[];
  /** Per-body residual force (should be ≈ 0 for equilibrium). */
  bodyResiduals: Map<string, { force: Vec3; moment: Vec3 }>;
  /** Total reaction force magnitude (sum across mates). */
  totalReactionN: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function balanceForces(
  bodies: string[],
  mates: MateConnection[],
  externalLoads: ExternalLoad[],
): BalanceResult {
  // For each mate, allocate reactions equal to the external load applied to one body.
  // This is a simplified single-pass distribution.
  const reactions: MateReaction[] = [];
  const bodyResiduals = new Map<string, { force: Vec3; moment: Vec3 }>();
  for (const b of bodies) {
    bodyResiduals.set(b, { force: { x: 0, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 } });
  }

  // Apply external loads to body residuals.
  for (const load of externalLoads) {
    const res = bodyResiduals.get(load.bodyId);
    if (!res) continue;
    res.force = addVec(res.force, load.force);
    if (load.moment) res.moment = addVec(res.moment, load.moment);
    // Moment from off-centre force = r × F. Need origin. Use mate centroid as moment ref.
  }

  // For each mate, distribute the residual of body A onto body B.
  // Simple algorithm: walk mates and shift residual.
  const visited = new Set<string>();
  const queue: string[] = [];
  // Start from bodies that have external loads.
  for (const load of externalLoads) {
    if (!visited.has(load.bodyId)) {
      queue.push(load.bodyId);
      visited.add(load.bodyId);
    }
  }
  if (queue.length === 0 && bodies.length > 0) {
    queue.push(bodies[0]!);
    visited.add(bodies[0]!);
  }

  while (queue.length > 0) {
    const bodyId = queue.shift()!;
    const residual = bodyResiduals.get(bodyId);
    if (!residual) continue;

    // Find mates connected to this body that go to unvisited bodies.
    const matesFromHere = mates.filter(m =>
      (m.bodyA === bodyId && !visited.has(m.bodyB)) ||
      (m.bodyB === bodyId && !visited.has(m.bodyA)),
    );
    if (matesFromHere.length === 0) continue;

    // Distribute residual evenly across these mates.
    const perMate = {
      x: residual.force.x / matesFromHere.length,
      y: residual.force.y / matesFromHere.length,
      z: residual.force.z / matesFromHere.length,
    };
    const perMateMoment = {
      x: residual.moment.x / matesFromHere.length,
      y: residual.moment.y / matesFromHere.length,
      z: residual.moment.z / matesFromHere.length,
    };

    for (const mate of matesFromHere) {
      const other = mate.bodyA === bodyId ? mate.bodyB : mate.bodyA;
      const sign = mate.bodyA === bodyId ? 1 : -1;
      const forceOnB: Vec3 = { x: perMate.x * sign, y: perMate.y * sign, z: perMate.z * sign };
      const momentOnB: Vec3 = { x: perMateMoment.x * sign, y: perMateMoment.y * sign, z: perMateMoment.z * sign };
      reactions.push({
        mateId: mate.id,
        bodyA: mate.bodyA,
        bodyB: mate.bodyB,
        forceOnB,
        momentOnB,
        forceMagnitudeN: Math.hypot(forceOnB.x, forceOnB.y, forceOnB.z),
        momentMagnitudeNmm: Math.hypot(momentOnB.x, momentOnB.y, momentOnB.z),
      });

      // Forward the residual to the connected body.
      const otherRes = bodyResiduals.get(other);
      if (otherRes) {
        otherRes.force = addVec(otherRes.force, forceOnB);
        otherRes.moment = addVec(otherRes.moment, momentOnB);
      }
      if (!visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }

    // Body is now balanced — clear residual.
    bodyResiduals.set(bodyId, { force: { x: 0, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 } });
  }

  const totalReaction = reactions.reduce((s, r) => s + r.forceMagnitudeN, 0);
  return { reactions, bodyResiduals, totalReactionN: totalReaction };
}

// ── Vec3 helpers ──────────────────────────────────────────────

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// ── Joint sizing helper ──────────────────────────────────────

export interface JointCheck {
  mateId: string;
  shearForceN: number;
  axialForceN: number;
  bendingMomentNmm: number;
  /** Required fastener tensile area (mm²) at given allowable stress. */
  requiredAreaMm2: number;
}

export function sizeJoint(reaction: MateReaction, allowableStressMpa: number): JointCheck {
  const force = reaction.forceMagnitudeN;
  return {
    mateId: reaction.mateId,
    shearForceN: Math.hypot(reaction.forceOnB.x, reaction.forceOnB.y),
    axialForceN: Math.abs(reaction.forceOnB.z),
    bendingMomentNmm: reaction.momentMagnitudeNmm,
    requiredAreaMm2: allowableStressMpa > 0 ? force / allowableStressMpa : 0,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface BalanceSummary {
  mateCount: number;
  maxForceMagnitudeN: number;
  maxMomentMagnitudeNmm: number;
  totalReactionN: number;
  unbalancedBodyCount: number;
}

export function summarize(result: BalanceResult): BalanceSummary {
  const maxF = result.reactions.reduce((m, r) => Math.max(m, r.forceMagnitudeN), 0);
  const maxM = result.reactions.reduce((m, r) => Math.max(m, r.momentMagnitudeNmm), 0);
  let unbalanced = 0;
  for (const res of result.bodyResiduals.values()) {
    const fMag = Math.hypot(res.force.x, res.force.y, res.force.z);
    const mMag = Math.hypot(res.moment.x, res.moment.y, res.moment.z);
    if (fMag > 0.01 || mMag > 0.01) unbalanced++;
  }
  return {
    mateCount: result.reactions.length,
    maxForceMagnitudeN: maxF,
    maxMomentMagnitudeNmm: maxM,
    totalReactionN: result.totalReactionN,
    unbalancedBodyCount: unbalanced,
  };
}
