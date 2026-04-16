import * as THREE from 'three';

/**
 * Assembly Mate Constraint Solver
 *
 * Implements iterative constraint satisfaction for assembly mates.
 * Supports: Coincident, Concentric, Parallel, Perpendicular, Distance, Angle, Fixed
 *
 * Uses Gauss-Seidel iteration to satisfy all constraints simultaneously.
 */

export type MateType =
  | 'coincident'      // Two faces/edges/points share the same location
  | 'concentric'      // Two cylindrical/circular features share the same axis
  | 'parallel'        // Two faces/edges are parallel
  | 'perpendicular'   // Two faces/edges are perpendicular
  | 'distance'        // Two features are separated by a specific distance
  | 'angle'           // Two faces/edges meet at a specific angle
  | 'tangent'         // Two faces are tangent (touching without penetration)
  | 'fixed';          // Part is fixed in space

export type MateSelectionType = 'face' | 'edge' | 'point' | 'axis' | 'plane';

export interface MateSelection {
  /** Body index in assembly */
  bodyIndex: number;
  /** Selection type */
  type: MateSelectionType;
  /** Local-space position/point on the selection */
  localPoint: THREE.Vector3;
  /** Local-space normal/direction of the selection */
  localNormal: THREE.Vector3;
  /** For concentric/axis: local axis direction */
  localAxis?: THREE.Vector3;
}

export interface Mate {
  id: string;
  type: MateType;
  /** Two selections that are being constrained */
  selections: [MateSelection, MateSelection];
  /** For distance mates: target distance (mm) */
  distance?: number;
  /** For angle mates: target angle (degrees) */
  angle?: number;
  /** Is this mate enabled? */
  enabled: boolean;
  /** Is this mate over-defining (conflict detected)? */
  conflict?: boolean;
}

export interface AssemblyBody {
  /** Display name */
  name: string;
  /** World-space position */
  position: THREE.Vector3;
  /** World-space rotation */
  rotation: THREE.Euler;
  /** Whether this body is fixed/grounded */
  fixed: boolean;
  /** The mesh geometry (optional) */
  geometry?: THREE.BufferGeometry;
}

export interface AssemblyState {
  bodies: AssemblyBody[];
  mates: Mate[];
}

export interface SolveResult {
  /** Updated body positions/rotations */
  bodies: { position: THREE.Vector3; rotation: THREE.Euler }[];
  /** List of unsatisfied mate IDs */
  unsatisfied: string[];
  /** Conflicting mate IDs */
  conflicts: string[];
  /** Degrees of freedom remaining */
  remainingDOF: number;
  converged: boolean;
  iterations: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Compute world-space point from a body's current transform and a local point */
function worldPoint(body: AssemblyBody, local: THREE.Vector3): THREE.Vector3 {
  const matrix = new THREE.Matrix4().compose(
    body.position,
    new THREE.Quaternion().setFromEuler(body.rotation),
    new THREE.Vector3(1, 1, 1),
  );
  return local.clone().applyMatrix4(matrix);
}

/** Compute world-space direction from a body's current rotation and a local direction */
function worldNormal(body: AssemblyBody, localNorm: THREE.Vector3): THREE.Vector3 {
  const quat = new THREE.Quaternion().setFromEuler(body.rotation);
  return localNorm.clone().applyQuaternion(quat).normalize();
}

// ─── Per-constraint appliers ──────────────────────────────────────────────────

/**
 * Coincident: bring the two selection points to the same world-space location.
 * Returns the residual distance before correction.
 */
function applyCoincidentConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const delta = p1.clone().sub(p0);
  const residual = delta.length();

  if (residual < 1e-6) return residual;

  if (!b0.fixed && !b1.fixed) {
    b0.position.add(delta.clone().multiplyScalar(0.5));
    b1.position.sub(delta.clone().multiplyScalar(0.5));
  } else if (!b0.fixed) {
    b0.position.add(delta);
  } else if (!b1.fixed) {
    b1.position.sub(delta);
  }

  return residual;
}

/**
 * Concentric: align two axis origins and orient the axes to be parallel.
 * Returns sum of position residual and axis-alignment residual.
 */
function applyConcentricConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const ax0 = worldNormal(b0, s0.localAxis ?? s0.localNormal);
  const ax1 = worldNormal(b1, s1.localAxis ?? s1.localNormal);

  // Position residual
  const posDelta = p1.clone().sub(p0);
  const posResidual = posDelta.length();

  // Axis alignment residual
  const axDot = Math.min(1, Math.max(-1, ax0.dot(ax1)));
  const axisResidual = 1 - Math.abs(axDot);

  // Align origins
  if (!b0.fixed && !b1.fixed) {
    b0.position.add(posDelta.clone().multiplyScalar(0.5));
    b1.position.sub(posDelta.clone().multiplyScalar(0.5));
  } else if (!b0.fixed) {
    b0.position.add(posDelta);
  } else if (!b1.fixed) {
    b1.position.sub(posDelta);
  }

  // Align axes
  if (axisResidual > 1e-6) {
    const rotAxis = new THREE.Vector3().crossVectors(ax0, ax1);
    if (rotAxis.lengthSq() > 1e-10) {
      rotAxis.normalize();
      const rotAngle = Math.acos(Math.abs(axDot));
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, rotAngle * 0.5);

      if (!b0.fixed) {
        const q0 = new THREE.Quaternion().setFromEuler(b0.rotation);
        q0.premultiply(rotQuat);
        b0.rotation.setFromQuaternion(q0);
      }
      if (!b1.fixed) {
        const q1 = new THREE.Quaternion().setFromEuler(b1.rotation);
        q1.premultiply(rotQuat.clone().invert());
        b1.rotation.setFromQuaternion(q1);
      }
    }
  }

  return posResidual + axisResidual;
}

/**
 * Parallel: rotate bodies so their normals are parallel (dot product → ±1).
 * Returns 1 - |dot|.
 */
function applyParallelConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const n0 = worldNormal(b0, s0.localNormal);
  const n1 = worldNormal(b1, s1.localNormal);

  const dot = Math.min(1, Math.max(-1, n0.dot(n1)));
  const residual = 1 - Math.abs(dot);

  if (residual < 1e-6) return residual;

  const rotAxis = new THREE.Vector3().crossVectors(n0, n1);
  if (rotAxis.lengthSq() < 1e-10) return residual;
  rotAxis.normalize();

  const rotAngle = Math.acos(Math.abs(dot));
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, rotAngle * 0.5);

  if (!b0.fixed) {
    const q0 = new THREE.Quaternion().setFromEuler(b0.rotation);
    q0.premultiply(rotQuat);
    b0.rotation.setFromQuaternion(q0);
  }
  if (!b1.fixed) {
    const q1 = new THREE.Quaternion().setFromEuler(b1.rotation);
    q1.premultiply(rotQuat.clone().invert());
    b1.rotation.setFromQuaternion(q1);
  }

  return residual;
}

/**
 * Perpendicular: rotate body[s0] so its normal is perpendicular to body[s1]'s normal.
 * Returns |dot| (0 = satisfied).
 */
function applyPerpendicularConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const n0 = worldNormal(b0, s0.localNormal);
  const n1 = worldNormal(b1, s1.localNormal);

  const dot = Math.min(1, Math.max(-1, n0.dot(n1)));
  const residual = Math.abs(dot);

  if (residual < 1e-6) return residual;

  const currentAngle = Math.acos(Math.abs(dot));
  const correction = (Math.PI / 2 - currentAngle) * 0.5;

  const rotAxis = new THREE.Vector3().crossVectors(n0, n1);
  if (rotAxis.lengthSq() < 1e-10) return residual;
  rotAxis.normalize();

  const rotQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, correction);
  if (!b0.fixed) {
    const q = new THREE.Quaternion().setFromEuler(b0.rotation);
    q.premultiply(rotQuat);
    b0.rotation.setFromQuaternion(q);
  }

  return residual;
}

/**
 * Distance: enforce a target gap between two selection points.
 * Returns |current - target|.
 */
function applyDistanceConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const target = mate.distance ?? 0;
  const current = p0.distanceTo(p1);
  const residual = Math.abs(current - target);

  if (residual < 1e-6) return residual;

  const dir = current > 1e-8
    ? p1.clone().sub(p0).normalize()
    : new THREE.Vector3(0, 1, 0);

  const excess = current - target;

  if (!b0.fixed && !b1.fixed) {
    b0.position.add(dir.clone().multiplyScalar(excess * 0.5));
    b1.position.sub(dir.clone().multiplyScalar(excess * 0.5));
  } else if (!b0.fixed) {
    b0.position.add(dir.clone().multiplyScalar(excess));
  } else if (!b1.fixed) {
    b1.position.sub(dir.clone().multiplyScalar(excess));
  }

  return residual;
}

/**
 * Angle: enforce a target angle between two selection normals.
 * Returns |current - target| in radians.
 */
function applyAngleConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];

  const n0 = worldNormal(b0, s0.localNormal);
  const n1 = worldNormal(bodies[s1.bodyIndex], s1.localNormal);

  const targetRad = (mate.angle ?? 0) * (Math.PI / 180);
  const clampedDot = Math.min(1, Math.max(-1, n0.dot(n1)));
  const currentAngle = Math.acos(clampedDot);
  const residual = Math.abs(currentAngle - targetRad);

  if (residual < 1e-6) return residual;

  const rotAxis = new THREE.Vector3().crossVectors(n0, n1);
  if (rotAxis.lengthSq() < 1e-10) return residual;
  rotAxis.normalize();

  const correction = (targetRad - currentAngle) * 0.5;
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, correction);

  if (!b0.fixed) {
    const q = new THREE.Quaternion().setFromEuler(b0.rotation);
    q.premultiply(rotQuat);
    b0.rotation.setFromQuaternion(q);
  }

  return residual;
}

// ─── DOF bookkeeping ──────────────────────────────────────────────────────────

/** DOF removed by each mate type (approximate, assuming full constraint of that type) */
const DOF_PER_MATE: Record<MateType, number> = {
  coincident:    3,
  concentric:    4,
  parallel:      2,
  perpendicular: 1,
  distance:      1,
  angle:         1,
  tangent:       1,
  fixed:         6,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate the theoretical remaining degrees of freedom for the assembly.
 * Each free body contributes 6 DOF; each enabled mate removes some.
 */
export function calculateDOF(state: AssemblyState): number {
  const freeBodies = state.bodies.filter(b => !b.fixed).length;
  const constrained = state.mates
    .filter(m => m.enabled)
    .reduce((sum, m) => sum + (DOF_PER_MATE[m.type] ?? 0), 0);
  return Math.max(0, freeBodies * 6 - constrained);
}

/**
 * Main constraint solver using Gauss-Seidel iteration.
 *
 * Clones all body positions/rotations before solving so the input state is
 * never mutated. Iterates over all enabled mates, applying incremental
 * corrections until the maximum residual drops below 1e-5 or maxIterations
 * is reached.
 */
export function solveAssembly(state: AssemblyState, maxIterations = 200): SolveResult {
  // Deep-clone body transforms to avoid mutating the input
  const bodies: AssemblyBody[] = state.bodies.map(b => ({
    ...b,
    position: b.position.clone(),
    rotation: b.rotation.clone(),
  }));

  const conflicts: string[] = [];
  let iterations = 0;
  let converged = false;

  const enabledMates = state.mates.filter(m => m.enabled);

  for (let iter = 0; iter < maxIterations; iter++) {
    let maxResidual = 0;

    for (const mate of enabledMates) {
      let residual = 0;
      try {
        // Guard against invalid body indices before dispatching
        const [s0, s1] = mate.selections;
        if (
          s0.bodyIndex < 0 || s0.bodyIndex >= bodies.length ||
          s1.bodyIndex < 0 || s1.bodyIndex >= bodies.length
        ) {
          if (!conflicts.includes(mate.id)) conflicts.push(mate.id);
          continue;
        }
        switch (mate.type) {
          case 'coincident':
            residual = applyCoincidentConstraint(bodies, mate);
            break;
          case 'concentric':
            residual = applyConcentricConstraint(bodies, mate);
            break;
          case 'parallel':
            residual = applyParallelConstraint(bodies, mate);
            break;
          case 'perpendicular':
            residual = applyPerpendicularConstraint(bodies, mate);
            break;
          case 'distance':
            residual = applyDistanceConstraint(bodies, mate);
            break;
          case 'angle':
            residual = applyAngleConstraint(bodies, mate);
            break;
          case 'fixed':
            // Handled by body.fixed flag; no per-iteration work needed
            residual = 0;
            break;
          default:
            break;
        }
      } catch {
        if (!conflicts.includes(mate.id)) conflicts.push(mate.id);
        continue;
      }

      if (residual > maxResidual) maxResidual = residual;
    }

    iterations = iter + 1;
    if (maxResidual < 1e-5) {
      converged = true;
      break;
    }
  }

  // Post-solve: collect unsatisfied mates (residual still too large)
  const unsatisfied: string[] = [];
  for (const mate of enabledMates) {
    if (conflicts.includes(mate.id)) continue;

    const idx0 = mate.selections[0].bodyIndex;
    const idx1 = mate.selections[1].bodyIndex;
    if (idx0 < 0 || idx0 >= bodies.length || idx1 < 0 || idx1 >= bodies.length) continue;
    const b0 = bodies[idx0];
    const b1 = bodies[idx1];

    switch (mate.type) {
      case 'coincident': {
        const p0 = worldPoint(b0, mate.selections[0].localPoint);
        const p1 = worldPoint(b1, mate.selections[1].localPoint);
        if (p0.distanceTo(p1) > 0.01) unsatisfied.push(mate.id);
        break;
      }
      case 'distance': {
        const p0 = worldPoint(b0, mate.selections[0].localPoint);
        const p1 = worldPoint(b1, mate.selections[1].localPoint);
        if (Math.abs(p0.distanceTo(p1) - (mate.distance ?? 0)) > 0.01)
          unsatisfied.push(mate.id);
        break;
      }
      case 'parallel': {
        const n0 = worldNormal(b0, mate.selections[0].localNormal);
        const n1 = worldNormal(b1, mate.selections[1].localNormal);
        if (1 - Math.abs(n0.dot(n1)) > 0.01) unsatisfied.push(mate.id);
        break;
      }
      case 'perpendicular': {
        const n0 = worldNormal(b0, mate.selections[0].localNormal);
        const n1 = worldNormal(b1, mate.selections[1].localNormal);
        if (Math.abs(n0.dot(n1)) > 0.01) unsatisfied.push(mate.id);
        break;
      }
      case 'angle': {
        const n0 = worldNormal(b0, mate.selections[0].localNormal);
        const n1 = worldNormal(b1, mate.selections[1].localNormal);
        const targetRad = (mate.angle ?? 0) * (Math.PI / 180);
        const currentAngle = Math.acos(Math.min(1, Math.max(-1, n0.dot(n1))));
        if (Math.abs(currentAngle - targetRad) > 0.01) unsatisfied.push(mate.id);
        break;
      }
      default:
        break;
    }
  }

  const freeBodies = bodies.filter(b => !b.fixed).length;
  const constrainedDOF = enabledMates.reduce(
    (sum, m) => sum + (DOF_PER_MATE[m.type] ?? 0), 0,
  );
  const remainingDOF = Math.max(0, freeBodies * 6 - constrainedDOF);

  return {
    bodies: bodies.map(b => ({ position: b.position, rotation: b.rotation })),
    unsatisfied,
    conflicts,
    remainingDOF,
    converged,
    iterations,
  };
}
