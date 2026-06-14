import * as THREE from 'three';

/**
 * Assembly Mate Constraint Solver
 *
 * Implements iterative constraint satisfaction for assembly mates.
 * Supports: Coincident, Concentric, Parallel, Perpendicular, Distance, Angle, Fixed
 *
 * Uses Gauss-Seidel iteration to satisfy all constraints simultaneously.
 *
 * **Pipeline note (M3):** This module operates on `AssemblyState` / `Mate` with explicit
 * selections. It is **not** what `applyGeometryMatesToPlaced` uses — that path calls
 * `AssemblyMates.solveMates` with `AssemblyMate` face indices on `BufferGeometry`.
 * Unifying the two requires a mapping layer; see `docs/strategy/M3_ASSEMBLY.md` §2.
 */

export type MateType =
  | 'coincident'      // Two faces/edges/points share the same location
  | 'concentric'      // Two cylindrical/circular features share the same axis
  | 'parallel'        // Two faces/edges are parallel
  | 'perpendicular'   // Two faces/edges are perpendicular
  | 'distance'        // Two features are separated by a specific distance
  | 'angle'           // Two faces/edges meet at a specific angle
  | 'tangent'         // Two faces are tangent (touching without penetration)
  | 'fixed'           // Part is fixed in space
  | 'hinge'           // Kinematic: 1 rotational DOF (Concentric + Coincident plane)
  | 'slider'          // Kinematic: 1 translational DOF (Concentric without position lock)
  | 'gear'            // Kinematic: Rotation ratio between two axes (gear mesh)
  | 'belt'            // Kinematic: Rotation coupling via belt / chain — ratio derived from pulley radii
  | 'limitDistance'   // Inequality: distance between two points clamped to [min, max]
  | 'limitAngle'      // Inequality: angle between two normals clamped to [min, max] (degrees)
  | 'width';          // Center selection B between two parallel reference planes on body A

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
  /** For gear mates: gear ratio (e.g. 2.0 means body A rotates twice as fast as body B) */
  gearRatio?: number;
  /** For belt mates: driver pulley radius (mm). */
  beltRadius0?: number;
  /** For belt mates: driven pulley radius (mm). */
  beltRadius1?: number;
  /** For belt mates: `true` flips the direction (crossed belt). */
  beltCrossed?: boolean;
  /** For limitDistance (mm) / limitAngle (deg): lower bound of the allowed range. */
  min?: number;
  /** For limitDistance (mm) / limitAngle (deg): upper bound of the allowed range. */
  max?: number;
  /** For width mates: the SECOND reference plane on the same body as
   *  `selections[0]`. `selections[1]` is centered between the two planes. */
  widthSecond?: MateSelection;
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
  /** Degrees of freedom remaining (Grübler count, clamped ≥ 0). */
  remainingDOF: number;
  /**
   * The mates request more constraint DOF than the free bodies have (Σ
   * DOF_PER_MATE > 6·freeBodies) — the assembly is over-defined. A necessary
   * condition for over-constraint (the gross case); redundant-but-within-budget
   * mates need rank analysis (follow-up). Surfaced so the UI can warn instead
   * of falsely showing "fully constrained" (DOF clamps to 0 either way).
   */
  overConstrained: boolean;
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

/** Options threaded from `solveAssembly` into the appliers. */
export interface SolveOptions {
  /**
   * PBD-style lever-arm rotation on point-coincidence corrections
   * (coincident / concentric / hinge). OFF by default — the static
   * placement solver keeps its historical translate-only behavior so
   * existing placements stay byte-stable. The kinematic drag loop turns
   * this ON: articulating a linkage (e.g. a four-bar's coupler/rocker)
   * requires bodies to ROTATE about their remaining pins to chase a
   * point target, which pure translation can never satisfy for a body
   * with two pins at different local offsets.
   */
  rotationalResponse?: boolean;
}

/**
 * Move world point `p` (attached to `body` at lever arm r = p − body.position)
 * toward `p + e` using rotation-about-origin plus translation. The rotational
 * part absorbs the component of `e` perpendicular to the lever arm
 * (Δθ = (r × e)/|r|², the PBD point-constraint response); the remainder is
 * translated. Falls back to pure translation for tiny lever arms.
 */
function movePointWithRotation(body: AssemblyBody, p: THREE.Vector3, e: THREE.Vector3): void {
  const r = p.clone().sub(body.position);
  const r2 = r.lengthSq();
  if (r2 > 1e-8) {
    const dTheta = new THREE.Vector3().crossVectors(r, e).divideScalar(r2);
    const ang = dTheta.length();
    if (ang > 1e-9) {
      // Clamp single-step rotation so a far-off target can't flip the body.
      const clamped = Math.min(ang, 0.5);
      const q = new THREE.Quaternion().setFromAxisAngle(dTheta.normalize(), clamped);
      const bq = new THREE.Quaternion().setFromEuler(body.rotation);
      bq.premultiply(q);
      body.rotation.setFromQuaternion(bq);
      // p has moved with the rotation: p' = x + q·r
      const newP = body.position.clone().add(r.clone().applyQuaternion(q));
      const remaining = p.clone().add(e).sub(newP);
      body.position.add(remaining);
      return;
    }
  }
  body.position.add(e);
}

/** Distribute a point-gap correction `delta` (p1 → p0 means b1 moves by −delta,
 *  b0 by +delta) across the free bodies, optionally with lever-arm rotation. */
function applyPointGap(
  b0: AssemblyBody, b1: AssemblyBody,
  p0: THREE.Vector3, p1: THREE.Vector3,
  delta: THREE.Vector3,
  opts?: SolveOptions,
): void {
  const rot = opts?.rotationalResponse === true;
  if (!b0.fixed && !b1.fixed) {
    if (rot) {
      movePointWithRotation(b0, p0, delta.clone().multiplyScalar(0.5));
      movePointWithRotation(b1, p1, delta.clone().multiplyScalar(-0.5));
    } else {
      b0.position.add(delta.clone().multiplyScalar(0.5));
      b1.position.sub(delta.clone().multiplyScalar(0.5));
    }
  } else if (!b0.fixed) {
    if (rot) movePointWithRotation(b0, p0, delta);
    else b0.position.add(delta);
  } else if (!b1.fixed) {
    if (rot) movePointWithRotation(b1, p1, delta.clone().negate());
    else b1.position.sub(delta);
  }
}

/**
 * Coincident: bring the two selection points to the same world-space location.
 * Returns the residual distance before correction.
 */
function applyCoincidentConstraint(bodies: AssemblyBody[], mate: Mate, opts?: SolveOptions): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const delta = p1.clone().sub(p0);
  const residual = delta.length();

  if (residual < 1e-6) return residual;

  applyPointGap(b0, b1, p0, p1, delta, opts);

  return residual;
}

/**
 * Concentric: align two axis origins and orient the axes to be parallel.
 * Returns sum of position residual and axis-alignment residual.
 */
function applyConcentricConstraint(bodies: AssemblyBody[], mate: Mate, opts?: SolveOptions): number {
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

  // Align origins (lever-arm rotation when kinematic drag requests it —
  // this is what lets a rocker SWING about its grounded pin instead of
  // translating off it)
  applyPointGap(b0, b1, p0, p1, posDelta, opts);

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
  let correction = (Math.PI / 2 - currentAngle) * 0.5;

  let rotAxis = new THREE.Vector3().crossVectors(n0, n1);
  let usedFallback = false;
  if (rotAxis.lengthSq() < 1e-10) {
    // n0 ‖ n1 (or anti-parallel): cross product is zero so we have no
    // natural rotation plane. Pick any axis perpendicular to n0 (world
    // up unless n0 is itself up, in which case use world X) and apply a
    // FULL 90° rotation in one step. Partial corrections cause iter-2
    // to compute an opposite-signed natural axis and oscillate the
    // body away from perpendicular instead of toward it.
    const fallback = Math.abs(n0.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    rotAxis = new THREE.Vector3().crossVectors(n0, fallback);
    if (rotAxis.lengthSq() < 1e-10) return residual;
    usedFallback = true;
    correction = Math.PI / 2;
  }
  rotAxis.normalize();

  // Distribute the correction so it always sums to `correction` between
  // the two bodies. If both free: each rotates half (opposite signs).
  // If only one free: that body absorbs the full correction.
  // (Previously a *0.5 was always applied which under-rotated when one
  // body was fixed, and the fallback case oscillated past target.)
  const halfFor0 = (!b0.fixed && !b1.fixed) ? correction / 2 : (!b0.fixed ? correction : 0);
  const halfFor1 = (!b0.fixed && !b1.fixed) ? correction / 2 : (!b1.fixed ? correction : 0);

  // Sign convention (Phase 2 fix, mirrors applyAngleConstraint): rotating n1
  // by +φ about normalize(n0 × n1) increases the REAL n0→n1 angle. The folded
  // measure acos(|dot|) needs the real angle to grow when dot > 0 (acute) and
  // shrink when dot < 0 (obtuse) — the old fixed signs only handled obtuse.
  const sgn = dot >= 0 ? 1 : -1;
  if (halfFor0 > 0) {
    const q0 = new THREE.Quaternion().setFromEuler(b0.rotation);
    q0.premultiply(new THREE.Quaternion().setFromAxisAngle(rotAxis, -halfFor0 * sgn));
    b0.rotation.setFromQuaternion(q0);
  }
  if (halfFor1 > 0) {
    const q1 = new THREE.Quaternion().setFromEuler(b1.rotation);
    q1.premultiply(new THREE.Quaternion().setFromAxisAngle(rotAxis, halfFor1 * sgn));
    b1.rotation.setFromQuaternion(q1);
  }
  void usedFallback; // reserved for future telemetry — silences ts-unused.

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

  const b1 = bodies[s1.bodyIndex];
  const targetRad = (mate.angle ?? 0) * (Math.PI / 180);
  const clampedDot = Math.min(1, Math.max(-1, n0.dot(n1)));
  const currentAngle = Math.acos(clampedDot);
  const residual = Math.abs(currentAngle - targetRad);

  if (residual < 1e-6) return residual;

  let correction = (targetRad - currentAngle) * 0.5;
  let rotAxis = new THREE.Vector3().crossVectors(n0, n1);
  if (rotAxis.lengthSq() < 1e-10) {
    // n0 ∥ n1 (the common parallel start, or anti-parallel): the cross product is zero,
    // so there is no natural rotation plane. The old code just returned here, so the
    // bodies never rotated and the angle stayed at 0 (the angle mate did nothing). Mirror
    // the perpendicular constraint: pick a fallback axis ⟂ n0 and apply the FULL target
    // angle in one step.
    const fallback = Math.abs(n0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    rotAxis = new THREE.Vector3().crossVectors(n0, fallback);
    if (rotAxis.lengthSq() < 1e-10) return residual;
    correction = targetRad - currentAngle; // full (currentAngle ≈ 0 or π)
  }
  rotAxis.normalize();

  // Distribute the correction across whichever bodies are free (the old code only ever
  // rotated b0, so a fixed b0 left a free b1 untouched). Both free ⇒ each takes half
  // (opposite signs); one free ⇒ it absorbs the full correction.
  //
  // Sign convention (Phase 2 fix): with a = normalize(n0 × n1), rotating n1
  // by +φ about a INCREASES the n0→n1 angle, while rotating n0 by +φ about a
  // DECREASES it. The previous signs were inverted for both bodies, so from
  // any non-parallel start the iteration ran AWAY from the target
  // (angle_{k+1} = 2·angle_k − target) and oscillated. All prior tests began
  // at the parallel/degenerate pose where direction is arbitrary, which hid
  // this. Exposed by the limitAngle "clamp 120° down to 90°" case.
  const for0 = (!b0.fixed && !b1.fixed) ? correction / 2 : (!b0.fixed ? correction : 0);
  const for1 = (!b0.fixed && !b1.fixed) ? correction / 2 : (!b1.fixed ? correction : 0);
  if (for0 !== 0) {
    const q = new THREE.Quaternion().setFromEuler(b0.rotation);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(rotAxis, -for0));
    b0.rotation.setFromQuaternion(q);
  }
  if (for1 !== 0) {
    const q = new THREE.Quaternion().setFromEuler(b1.rotation);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(rotAxis, for1));
    b1.rotation.setFromQuaternion(q);
  }
  return residual;
}

// ─── Kinematic Mates ──────────────────────────────────────────────────────────

/**
 * Hinge: Acts as a revolute joint. Leaves exactly 1 rotational DOF.
 * Combines Concentric (align axes) + Coincident (align points along the axis).
 */
function applyHingeConstraint(bodies: AssemblyBody[], mate: Mate, opts?: SolveOptions): number {
  // A hinge is mathematically identical to a concentric mate that also enforces position match
  // Concentric already aligns position completely if we just use the points.
  // In our simplified solver, applyConcentricConstraint aligns the origins AND the axes.
  // So it effectively removes 5 DOF (2 translation, 2 rotation), leaving 1 rotational DOF.
  // Wait, applyConcentricConstraint aligns the exact local points.
  return applyConcentricConstraint(bodies, mate, opts);
}

/**
 * Slider: Acts as a prismatic joint. Leaves exactly 1 translational DOF.
 * Aligns axes like concentric, but allows arbitrary distance along the axis.
 */
function applySliderConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const ax0 = worldNormal(b0, s0.localAxis ?? s0.localNormal);
  const ax1 = worldNormal(b1, s1.localAxis ?? s1.localNormal);

  // Position residual (only penalize distance perpendicular to the axis)
  const posDelta = p1.clone().sub(p0);
  const projectedDistance = posDelta.dot(ax0);
  const posCorrection = posDelta.clone().sub(ax0.clone().multiplyScalar(projectedDistance));
  const posResidual = posCorrection.length();

  // Axis alignment residual
  const axDot = Math.min(1, Math.max(-1, ax0.dot(ax1)));
  const axisResidual = 1 - Math.abs(axDot);

  if (!b0.fixed && !b1.fixed) {
    b0.position.add(posCorrection.clone().multiplyScalar(0.5));
    b1.position.sub(posCorrection.clone().multiplyScalar(0.5));
  } else if (!b0.fixed) {
    b0.position.add(posCorrection);
  } else if (!b1.fixed) {
    b1.position.sub(posCorrection);
  }

  // Align axes exactly like parallel
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

  // Enforce rotation lock (slider doesn't allow twist).
  // We align their local X/Y vectors if needed. For now, prismatic is approximated.
  return posResidual + axisResidual;
}

/**
 * Tangent: the two selected faces touch along a common tangent plane.
 * Enforced as (a) the outward normals OPPOSE (anti-parallel — the two solids
 * sit on either side of the shared tangent plane, "touching without
 * penetration") and (b) the contact points have zero separation ALONG that
 * normal, while the in-plane offset stays free (a cylinder may roll or slide
 * along a flat face).
 *
 * Scope: this uses only the contact point + normal carried by the selection,
 * so it is exact for planar-to-planar contact and for the contact-point
 * tangency of curved faces. It deliberately does NOT read a curvature radius
 * (the selection carries none), so it will not park a free-floating cylinder
 * at `distance = radius` from an axis without a contact point — that needs a
 * radius the picker does not yet supply. Previously tangent fell through to a
 * silent no-op (reported satisfied while consuming a DOF); this makes it a
 * real, convergent constraint.
 */
function applyTangentConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const n0 = worldNormal(b0, s0.localNormal);
  const n1 = worldNormal(b1, s1.localNormal);

  // (a) Drive the normals anti-parallel (n1 → −n0).
  const dot = Math.min(1, Math.max(-1, n0.dot(n1)));
  const alignResidual = 1 + dot;                 // 0 when opposed (dot = −1)
  if (alignResidual > 1e-6) {
    const target = n0.clone().negate();          // where n1 should point
    let rotAxis = new THREE.Vector3().crossVectors(n1, target);
    if (rotAxis.lengthSq() < 1e-10) {
      // n1 is exactly +n0 (a 180° flip): pick any axis ⟂ n0.
      const fallback = Math.abs(n0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      rotAxis = new THREE.Vector3().crossVectors(n0, fallback);
    }
    rotAxis.normalize();
    const rotAngle = Math.acos(Math.min(1, Math.max(-1, n1.dot(target))));
    if (!b0.fixed && !b1.fixed) {
      const half = new THREE.Quaternion().setFromAxisAngle(rotAxis, rotAngle * 0.5);
      const q1 = new THREE.Quaternion().setFromEuler(b1.rotation);
      q1.premultiply(half); b1.rotation.setFromQuaternion(q1);
      const q0 = new THREE.Quaternion().setFromEuler(b0.rotation);
      q0.premultiply(half.clone().invert()); b0.rotation.setFromQuaternion(q0);
    } else if (!b1.fixed) {
      const full = new THREE.Quaternion().setFromAxisAngle(rotAxis, rotAngle);
      const q1 = new THREE.Quaternion().setFromEuler(b1.rotation);
      q1.premultiply(full); b1.rotation.setFromQuaternion(q1);
    } else if (!b0.fixed) {
      const full = new THREE.Quaternion().setFromAxisAngle(rotAxis, -rotAngle);
      const q0 = new THREE.Quaternion().setFromEuler(b0.rotation);
      q0.premultiply(full); b0.rotation.setFromQuaternion(q0);
    }
  }

  // (b) Zero the separation along the (now opposed) reference normal; in-plane
  // translation is left free. Recompute n0 after the rotation above.
  const nRef = worldNormal(b0, s0.localNormal);
  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const sep = p1.clone().sub(p0).dot(nRef);
  const posResidual = Math.abs(sep);
  if (posResidual > 1e-6) {
    const corr = nRef.clone().multiplyScalar(sep);
    if (!b0.fixed && !b1.fixed) {
      b0.position.add(corr.clone().multiplyScalar(0.5));
      b1.position.sub(corr.clone().multiplyScalar(0.5));
    } else if (!b1.fixed) {
      b1.position.sub(corr);
    } else if (!b0.fixed) {
      b0.position.add(corr);
    }
  }

  return alignResidual + posResidual;
}

/**
 * Limit distance: inequality constraint — the gap between the two selection
 * points must stay within `[mate.min, mate.max]` (mm). Inside the range the
 * mate is satisfied (residual 0, no correction); outside it behaves like a
 * distance mate targeting the violated bound. SolidWorks "Limit / Distance".
 */
function applyLimitDistanceConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const lo = mate.min ?? 0;
  const hi = mate.max ?? lo;
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];

  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const current = p0.distanceTo(p1);
  if (current >= lo - 1e-9 && current <= hi + 1e-9) return 0; // inside range — free DOF

  const target = current < lo ? lo : hi;
  return applyDistanceConstraint(bodies, { ...mate, distance: target });
}

/**
 * Limit angle: inequality constraint — the angle between the two selection
 * normals must stay within `[mate.min, mate.max]` (degrees). Inside the range
 * the mate is satisfied; outside it behaves like an angle mate targeting the
 * violated bound. SolidWorks "Limit / Angle".
 */
function applyLimitAngleConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const lo = mate.min ?? 0;
  const hi = mate.max ?? lo;
  const [s0, s1] = mate.selections;
  const n0 = worldNormal(bodies[s0.bodyIndex], s0.localNormal);
  const n1 = worldNormal(bodies[s1.bodyIndex], s1.localNormal);
  const currentDeg = (Math.acos(Math.min(1, Math.max(-1, n0.dot(n1)))) * 180) / Math.PI;
  if (currentDeg >= lo - 1e-7 && currentDeg <= hi + 1e-7) return 0; // inside range

  const target = currentDeg < lo ? lo : hi;
  return applyAngleConstraint(bodies, { ...mate, angle: target });
}

/**
 * Width: center selection B (`selections[1]`'s point) between two parallel
 * reference planes on body A — `selections[0]` and `mate.widthSecond`.
 * SolidWorks "Width" (centered variant): the tab is held at the midplane of
 * the groove, in-plane sliding stays free. Residual = |signed offset from the
 * midplane| along the reference normal. Without `widthSecond` the mate is a
 * no-op (reported as 0 so it doesn't poison convergence; the UI requires the
 * second face before creating the mate).
 */
function applyWidthConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const s2 = mate.widthSecond;
  if (!s2) return 0;
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];
  const bRef2 = bodies[s2.bodyIndex] ?? b0;

  const pA1 = worldPoint(b0, s0.localPoint);
  const pA2 = worldPoint(bRef2, s2.localPoint);
  const n = worldNormal(b0, s0.localNormal);

  // Midplane point: halfway between the two reference planes measured along n.
  const sep = pA2.clone().sub(pA1).dot(n);
  const mid = pA1.clone().add(n.clone().multiplyScalar(sep * 0.5));

  const pB = worldPoint(b1, s1.localPoint);
  const off = pB.clone().sub(mid).dot(n); // signed offset from midplane
  const residual = Math.abs(off);
  if (residual < 1e-6) return residual;

  const corr = n.clone().multiplyScalar(off);
  if (!b0.fixed && !b1.fixed) {
    b0.position.add(corr.clone().multiplyScalar(0.5));
    b1.position.sub(corr.clone().multiplyScalar(0.5));
  } else if (!b1.fixed) {
    b1.position.sub(corr);
  } else if (!b0.fixed) {
    b0.position.add(corr);
  }
  return residual;
}

/** Twist component of a quaternion around a given axis. Decomposes Q
 *  into swing × twist where twist is rotation purely around `axis` and
 *  returns the twist angle in radians (signed by right-hand rule).
 *  Used by the gear constraint to read out each body's current rotation
 *  around its gear axis without depending on iteration history. */
export function twistAngleAroundAxis(quat: THREE.Quaternion, axis: THREE.Vector3): number {
  const a = axis.clone().normalize();
  // The twist part of (qx, qy, qz, qw) is the projection of (qx, qy, qz)
  // onto the axis, plus the original qw — then renormalised.
  const v = new THREE.Vector3(quat.x, quat.y, quat.z);
  const proj = a.clone().multiplyScalar(v.dot(a));
  const twist = new THREE.Quaternion(proj.x, proj.y, proj.z, quat.w).normalize();
  // Signed twist angle: 2·atan2(|axis-component|, w), with sign from
  // whether the projection points along or against the axis.
  const sign = Math.sign(v.dot(a)) || 1;
  return 2 * Math.atan2(sign * proj.length(), twist.w);
}

/**
 * Gear: enforce a rotation ratio between two bodies around their gear
 * axes. `mate.gearRatio` is read as ω_A : ω_B — gearRatio = 2 means A
 * spins twice for every full turn of B. Negative ratio = opposite
 * rotation (external mesh); positive = same direction (internal mesh,
 * or pulleys via the open-belt path).
 *
 * Reference frame: rotation is measured from the identity orientation
 * (the assembly's modelling pose). When the user expects "current pose
 * is the rest pose", the caller should snapshot rotations and apply
 * `gearRatio = 0` here — that path is handled by the position-driver
 * task. For the static constraint we just enforce that
 *     twist(A) × ratio = twist(B)
 * with corrections distributed across free bodies. */
function applyGearConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];
  const ratio = mate.gearRatio ?? 1;
  if (!Number.isFinite(ratio) || ratio === 0) return 0;

  const axis0 = worldNormal(b0, s0.localAxis ?? s0.localNormal);
  const axis1 = worldNormal(b1, s1.localAxis ?? s1.localNormal);

  const q0 = new THREE.Quaternion().setFromEuler(b0.rotation);
  const q1 = new THREE.Quaternion().setFromEuler(b1.rotation);
  const twist0 = twistAngleAroundAxis(q0, axis0);
  const twist1 = twistAngleAroundAxis(q1, axis1);

  // Constraint: twist0 × ratio = twist1   →   error = twist1 - twist0×ratio
  // We rotate b1 by -error around its axis (or b0 by +error/ratio around
  // its axis when b1 is fixed). When both are free, share the load by
  // weighting each correction by the body it ultimately moves the most.
  const error = twist1 - twist0 * ratio;
  const residual = Math.abs(error);
  if (residual < 1e-6) return residual;

  if (!b0.fixed && !b1.fixed) {
    // Both free: rotate each by half the angle they each "owe".
    const dq0 = new THREE.Quaternion().setFromAxisAngle(axis0, error / (2 * ratio));
    const dq1 = new THREE.Quaternion().setFromAxisAngle(axis1, -error / 2);
    const nq0 = q0.clone().premultiply(dq0); b0.rotation.setFromQuaternion(nq0);
    const nq1 = q1.clone().premultiply(dq1); b1.rotation.setFromQuaternion(nq1);
  } else if (!b1.fixed) {
    const dq1 = new THREE.Quaternion().setFromAxisAngle(axis1, -error);
    const nq1 = q1.clone().premultiply(dq1); b1.rotation.setFromQuaternion(nq1);
  } else if (!b0.fixed) {
    const dq0 = new THREE.Quaternion().setFromAxisAngle(axis0, error / ratio);
    const nq0 = q0.clone().premultiply(dq0); b0.rotation.setFromQuaternion(nq0);
  }
  return residual;
}

/**
 * Belt / pulley: rotation coupling between two pulleys connected by a
 * belt or chain. Surface speed at the belt is identical on both sides,
 * so:  ω_A × R_A = ω_B × R_B  →  ω_A / ω_B = R_B / R_A.
 *
 * Implemented by delegating to the gear constraint with an effective
 * ratio derived from the pulley radii. `beltCrossed` flips the direction
 * (a crossed belt reverses the driven pulley); open belts are the default.
 */
function applyBeltConstraint(bodies: AssemblyBody[], mate: Mate): number {
  const r0 = mate.beltRadius0 ?? 0;
  const r1 = mate.beltRadius1 ?? 0;
  if (!(r0 > 0) || !(r1 > 0)) return 0;
  const sign = mate.beltCrossed ? -1 : 1;
  // ω_A × R_A = ω_B × R_B  →  twist0 × (R_A / R_B) = twist1  →  ratio = R_A / R_B
  // (matches the convention used in applyGearConstraint where
  // `twist0 × ratio = twist1`).
  const effectiveRatio = sign * (r0 / r1);
  return applyGearConstraint(bodies, { ...mate, gearRatio: effectiveRatio });
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
  hinge:         5,
  slider:        5,
  gear:          1,
  belt:          1,
  // Inequality (limit) mates remove no DOF while inside their range — they
  // only act at the bounds, so they're counted as 0 for DOF bookkeeping.
  limitDistance: 0,
  limitAngle:    0,
  width:         1,
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
 * Over-constraint check: the enabled mates request more constraint DOF than the
 * free bodies have (Σ DOF_PER_MATE > 6·freeBodies). `calculateDOF` clamps this
 * to 0, so without this an over-defined assembly looks "fully constrained"
 * (green) instead of warning. This is the gross necessary condition; redundant
 * mates that fit within the DOF budget need rank analysis (follow-up).
 */
export function isAssemblyOverConstrained(state: AssemblyState): boolean {
  const freeBodies = state.bodies.filter(b => !b.fixed).length;
  const constrained = state.mates
    .filter(m => m.enabled)
    .reduce((sum, m) => sum + (DOF_PER_MATE[m.type] ?? 0), 0);
  return constrained > freeBodies * 6;
}

/**
 * Main constraint solver using Gauss-Seidel iteration.
 *
 * Clones all body positions/rotations before solving so the input state is
 * never mutated. Iterates over all enabled mates, applying incremental
 * corrections until the maximum residual drops below 1e-5 or maxIterations
 * is reached.
 */
/** Dispatch one mate to its applier, returning the residual. Shared by the
 *  warm-start placement pass and the relaxation sweep. */
function dispatchMate(bodies: AssemblyBody[], mate: Mate, opts?: SolveOptions): number {
  switch (mate.type) {
    case 'coincident':   return applyCoincidentConstraint(bodies, mate, opts);
    case 'concentric':   return applyConcentricConstraint(bodies, mate, opts);
    case 'parallel':     return applyParallelConstraint(bodies, mate);
    case 'perpendicular': return applyPerpendicularConstraint(bodies, mate);
    case 'distance':     return applyDistanceConstraint(bodies, mate);
    case 'angle':        return applyAngleConstraint(bodies, mate);
    case 'fixed':        return 0; // handled by body.fixed flag
    case 'hinge':        return applyHingeConstraint(bodies, mate, opts);
    case 'slider':       return applySliderConstraint(bodies, mate);
    case 'gear':         return applyGearConstraint(bodies, mate);
    case 'belt':         return applyBeltConstraint(bodies, mate);
    case 'tangent':      return applyTangentConstraint(bodies, mate);
    case 'limitDistance': return applyLimitDistanceConstraint(bodies, mate);
    case 'limitAngle':   return applyLimitAngleConstraint(bodies, mate);
    case 'width':        return applyWidthConstraint(bodies, mate);
    default:             return 0;
  }
}

/**
 * Warm-start: place bodies in BFS order outward from the grounded (fixed)
 * bodies, treating each already-placed body as fixed so the whole correction
 * goes to the body being placed. For a tree/chain assembly this positions every
 * body in a SINGLE O(N) pass (a depth-N chain otherwise needs O(N²) relaxation
 * sweeps to propagate). Closed loops and over-constraints are left for the
 * relaxation that follows — this only provides a near-solved starting point, so
 * the converged result is unchanged; it just removes the chain-propagation cost.
 */
function warmStartPlacement(bodies: AssemblyBody[], mates: Mate[], opts?: SolveOptions): void {
  const n = bodies.length;
  if (n === 0) return;
  // Adjacency: body → mates touching it (with the index of the other body).
  const adj: Array<Array<{ mate: Mate; other: number }>> = Array.from({ length: n }, () => []);
  for (const m of mates) {
    const a = m.selections[0].bodyIndex, b = m.selections[1].bodyIndex;
    if (a < 0 || a >= n || b < 0 || b >= n || a === b) continue;
    adj[a]!.push({ mate: m, other: b });
    adj[b]!.push({ mate: m, other: a });
  }
  const origFixed = bodies.map(b => b.fixed);
  const placed = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (bodies[i]!.fixed) { placed[i] = 1; queue.push(i); }
  // No ground → no anchor to propagate from, and the final pose is arbitrary
  // (only relative positions are constrained). Skip the warm-start and let the
  // symmetric relaxation place a free-floating assembly; this preserves the
  // "both free bodies meet in the middle" behaviour. The O(N²) chain cost we are
  // removing is a GROUNDED-assembly concern (a chain attached to a frame).
  if (queue.length === 0) return;

  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const { mate, other } of adj[p]!) {
      if (placed[other]) continue;
      // Place `other` against the already-placed `p`: pin every placed body so
      // the applier routes the full correction onto `other`.
      bodies[other]!.fixed = false;
      try { dispatchMate(bodies, mate, opts); } catch { /* leave for relaxation */ }
      bodies[other]!.fixed = true; // now placed → fixed for its own children
      placed[other] = 1;
      queue.push(other);
    }
  }
  // Restore the real fixed flags so relaxation only pins genuinely-grounded bodies.
  for (let i = 0; i < n; i++) bodies[i]!.fixed = origFixed[i]!;
}

export function solveAssembly(state: AssemblyState, maxIterations = 200, opts?: SolveOptions): SolveResult {
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

  // O(N) warm-start: position the dependency tree in one BFS pass so the
  // relaxation below only has to clean up closed loops, not propagate a chain
  // one link per sweep.
  warmStartPlacement(bodies, enabledMates, opts);

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
        residual = dispatchMate(bodies, mate, opts);
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
      case 'limitDistance': {
        const p0 = worldPoint(b0, mate.selections[0].localPoint);
        const p1 = worldPoint(b1, mate.selections[1].localPoint);
        const d = p0.distanceTo(p1);
        const lo = mate.min ?? 0;
        const hi = mate.max ?? lo;
        if (d < lo - 0.01 || d > hi + 0.01) unsatisfied.push(mate.id);
        break;
      }
      case 'limitAngle': {
        const n0 = worldNormal(b0, mate.selections[0].localNormal);
        const n1 = worldNormal(b1, mate.selections[1].localNormal);
        const deg = (Math.acos(Math.min(1, Math.max(-1, n0.dot(n1)))) * 180) / Math.PI;
        const lo = mate.min ?? 0;
        const hi = mate.max ?? lo;
        if (deg < lo - 0.1 || deg > hi + 0.1) unsatisfied.push(mate.id);
        break;
      }
      case 'width': {
        const s2 = mate.widthSecond;
        if (!s2) break; // incomplete mate — UI prevents this; don't poison the report
        const bRef2 = bodies[s2.bodyIndex] ?? b0;
        const pA1 = worldPoint(b0, mate.selections[0].localPoint);
        const pA2 = worldPoint(bRef2, s2.localPoint);
        const n = worldNormal(b0, mate.selections[0].localNormal);
        const sep = pA2.clone().sub(pA1).dot(n);
        const mid = pA1.clone().add(n.clone().multiplyScalar(sep * 0.5));
        const pB = worldPoint(b1, mate.selections[1].localPoint);
        if (Math.abs(pB.clone().sub(mid).dot(n)) > 0.01) unsatisfied.push(mate.id);
        break;
      }
      case 'tangent': {
        // Honest check: the normals must oppose (anti-parallel) AND the gap
        // along that normal must close. Either failing → report unsatisfied
        // rather than silently rubber-stamping the mate.
        const n0 = worldNormal(b0, mate.selections[0].localNormal);
        const n1 = worldNormal(b1, mate.selections[1].localNormal);
        const p0 = worldPoint(b0, mate.selections[0].localPoint);
        const p1 = worldPoint(b1, mate.selections[1].localPoint);
        const opposed = 1 + Math.min(1, Math.max(-1, n0.dot(n1))); // 0 when anti-parallel
        const sep = Math.abs(p1.clone().sub(p0).dot(n0));
        if (opposed > 0.01 || sep > 0.01) unsatisfied.push(mate.id);
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
  const overConstrained = constrainedDOF > freeBodies * 6;

  return {
    bodies: bodies.map(b => ({ position: b.position, rotation: b.rotation })),
    unsatisfied,
    conflicts,
    remainingDOF,
    overConstrained,
    converged,
    iterations,
  };
}
