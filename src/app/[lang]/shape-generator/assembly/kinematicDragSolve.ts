/**
 * kinematicDragSolve.ts — pure per-frame drag loop for mated assemblies.
 *
 * Same philosophy as `sketch/sketchDragSolve.ts`: soft-pin the dragged
 * entity at the cursor target, re-polish all constraints every frame, and
 * let the host register ONE undo step per gesture (begin → N steps → end).
 *
 * Honest scope (Phase 2 roadmap): the drag is **joint-space constrained**,
 * not free 6-DOF manipulation —
 *   - a body hinged/concentric to a FIXED body is dragged as a *revolute*
 *     joint: the grab point chases the cursor along its circle about the
 *     pivot axis (this is the four-bar / gear-pair case — most linkages
 *     are planar, and this is exactly how SolidWorks feels for them);
 *   - a body slider-mated to a fixed body is dragged as *prismatic*:
 *     motion is projected onto the slide axis;
 *   - any other body falls back to *free* translation soft-pinned at the
 *     cursor, with the Gauss-Seidel solver pulling it back onto the
 *     constraint manifold.
 * After the dragged body is posed it is temporarily pinned (`fixed`) and
 * the rest of the assembly re-solves around it with lever-arm rotational
 * response enabled (see `SolveOptions.rotationalResponse`) so couplers /
 * rockers / gear partners actually articulate.
 */

import * as THREE from 'three';
import type { AssemblyState, AssemblyBody, Mate } from './matesSolver';
import { solveAssembly } from './matesSolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DragMode =
  | { kind: 'revolute'; pivotWorld: THREE.Vector3; axisWorld: THREE.Vector3; mateId: string }
  | { kind: 'prismatic'; originWorld: THREE.Vector3; axisWorld: THREE.Vector3; mateId: string }
  | { kind: 'free' };

export interface DragGesture {
  bodyIndex: number;
  /** Grab point in the dragged body's local frame. */
  grabLocal: THREE.Vector3;
  mode: DragMode;
}

export interface DragStepResult {
  /** Solved poses for every body (same order as `state.bodies`). */
  bodies: { position: THREE.Vector3; rotation: THREE.Euler }[];
  converged: boolean;
  iterations: number;
}

export interface BodyPoseSnapshot {
  position: [number, number, number];
  rotation: [number, number, number];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bodyQuat(b: AssemblyBody): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(b.rotation);
}

function bodyWorldPoint(b: AssemblyBody, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyQuaternion(bodyQuat(b)).add(b.position);
}

/** Snapshot all body poses (for the one-undo-step-per-gesture contract). */
export function snapshotPoses(state: AssemblyState): BodyPoseSnapshot[] {
  return state.bodies.map(b => ({
    position: [b.position.x, b.position.y, b.position.z],
    rotation: [b.rotation.x, b.rotation.y, b.rotation.z],
  }));
}

/** Restore body poses from a snapshot (mutates `state`). */
export function restorePoses(state: AssemblyState, snap: BodyPoseSnapshot[]): void {
  for (let i = 0; i < state.bodies.length && i < snap.length; i++) {
    const b = state.bodies[i];
    const s = snap[i];
    b.position.set(s.position[0], s.position[1], s.position[2]);
    b.rotation.set(s.rotation[0], s.rotation[1], s.rotation[2]);
  }
}

/** World-space grab point for the current pose. */
export function gestureGrabWorld(state: AssemblyState, gesture: DragGesture): THREE.Vector3 {
  return bodyWorldPoint(state.bodies[gesture.bodyIndex], gesture.grabLocal);
}

// ─── Mode detection ──────────────────────────────────────────────────────────

const REVOLUTE_TYPES: ReadonlySet<Mate['type']> = new Set(['hinge', 'concentric']);

/**
 * Classify how `bodyIndex` should respond to a drag, by scanning its enabled
 * mates for a joint to a FIXED partner body. (Transitively-grounded chains are
 * treated as free — the GS re-solve still pulls them onto the manifold, just
 * without the exact joint-space projection.)
 */
export function detectDragMode(state: AssemblyState, bodyIndex: number): DragMode {
  for (const m of state.mates) {
    if (!m.enabled) continue;
    const [s0, s1] = m.selections;
    let selfSel = null, otherSel = null;
    if (s0.bodyIndex === bodyIndex && s1.bodyIndex !== bodyIndex) { selfSel = s0; otherSel = s1; }
    else if (s1.bodyIndex === bodyIndex && s0.bodyIndex !== bodyIndex) { selfSel = s1; otherSel = s0; }
    else continue;

    const other = state.bodies[otherSel.bodyIndex];
    if (!other || !other.fixed) continue;

    if (REVOLUTE_TYPES.has(m.type)) {
      return {
        kind: 'revolute',
        pivotWorld: bodyWorldPoint(other, otherSel.localPoint),
        axisWorld: (otherSel.localAxis ?? otherSel.localNormal)
          .clone().applyQuaternion(bodyQuat(other)).normalize(),
        mateId: m.id,
      };
    }
    if (m.type === 'slider') {
      return {
        kind: 'prismatic',
        originWorld: bodyWorldPoint(other, otherSel.localPoint),
        axisWorld: (otherSel.localAxis ?? otherSel.localNormal)
          .clone().applyQuaternion(bodyQuat(other)).normalize(),
        mateId: m.id,
      };
    }
    void selfSel;
  }
  return { kind: 'free' };
}

/** Begin a gesture: classify the joint and store the grab point in body-local
 *  coordinates so subsequent steps can chase the cursor with it. */
export function beginDragGesture(
  state: AssemblyState,
  bodyIndex: number,
  grabWorld: THREE.Vector3,
): DragGesture {
  const b = state.bodies[bodyIndex];
  const grabLocal = grabWorld.clone().sub(b.position).applyQuaternion(bodyQuat(b).invert());
  return { bodyIndex, grabLocal, mode: detectDragMode(state, bodyIndex) };
}

// ─── Per-frame step ──────────────────────────────────────────────────────────

/**
 * One drag frame: pose the dragged body toward `targetWorld` according to its
 * joint mode, pin it, re-solve everything else (rotational response ON), then
 * release the pin. Mutates `state.bodies` with the solved poses and also
 * returns them. Warm-started by construction — `state` carries the previous
 * frame's solution.
 */
export function kinematicDragStep(
  state: AssemblyState,
  gesture: DragGesture,
  targetWorld: THREE.Vector3,
  opts?: { iterations?: number },
): DragStepResult {
  const iterations = opts?.iterations ?? 60;
  const body = state.bodies[gesture.bodyIndex];
  if (!body || body.fixed) {
    return { bodies: state.bodies.map(b => ({ position: b.position.clone(), rotation: b.rotation.clone() })), converged: true, iterations: 0 };
  }

  const mode = gesture.mode;
  // Keep the pre-drag pose around.  A revolute drag is a kinematic command,
  // so a limit mate must reject the part of the command that leaves the
  // feasible interval instead of asking the solver to move a body that we
  // deliberately pinned for this solve.
  const startPosition = body.position.clone();
  const startQuaternion = bodyQuat(body);
  if (mode.kind === 'revolute') {
    // Project current grab + target onto the rotation plane ⊥ axis through
    // the pivot, and rotate the body by the signed angle between them.
    const a = mode.axisWorld;
    const grab = bodyWorldPoint(body, gesture.grabLocal);
    const rCur = grab.clone().sub(mode.pivotWorld);
    const rTgt = targetWorld.clone().sub(mode.pivotWorld);
    const curPerp = rCur.clone().sub(a.clone().multiplyScalar(rCur.dot(a)));
    const tgtPerp = rTgt.clone().sub(a.clone().multiplyScalar(rTgt.dot(a)));
    if (curPerp.lengthSq() > 1e-12 && tgtPerp.lengthSq() > 1e-12) {
      curPerp.normalize();
      tgtPerp.normalize();
      const cosA = THREE.MathUtils.clamp(curPerp.dot(tgtPerp), -1, 1);
      const sinA = new THREE.Vector3().crossVectors(curPerp, tgtPerp).dot(a);
      const dTheta = Math.atan2(sinA, cosA);
      if (Math.abs(dTheta) > 1e-9) {
        const q = new THREE.Quaternion().setFromAxisAngle(a, dTheta);
        // Rigid rotation about the pivot line: x' = pivot + q·(x − pivot)
        const rel = body.position.clone().sub(mode.pivotWorld).applyQuaternion(q);
        body.position.copy(mode.pivotWorld.clone().add(rel));
        const bq = bodyQuat(body);
        bq.premultiply(q);
        body.rotation.setFromQuaternion(bq);
      }
    }
  } else if (mode.kind === 'prismatic') {
    // Slide along the joint axis by the projected cursor delta.
    const a = mode.axisWorld;
    const grab = bodyWorldPoint(body, gesture.grabLocal);
    const slide = targetWorld.clone().sub(grab).dot(a);
    body.position.add(a.clone().multiplyScalar(slide));
  } else {
    // Free: soft-pin — place the grab point at the cursor; the re-solve
    // below pulls the body back onto whatever constraints it has.
    const grab = bodyWorldPoint(body, gesture.grabLocal);
    body.position.add(targetWorld.clone().sub(grab));
  }

  const desiredPosition = body.position.clone();
  const desiredQuaternion = bodyQuat(body);
  const hasLimitAngle = state.mates.some(m =>
    m.enabled && m.type === 'limitAngle' && m.selections.some(s => s.bodyIndex === gesture.bodyIndex),
  );

  const solvePinned = (): ReturnType<typeof solveAssembly> => {
    const prevFixed = body.fixed;
    if (mode.kind !== 'free') body.fixed = true;
    try {
      return solveAssembly(state, iterations, { rotationalResponse: true });
    } finally {
      body.fixed = prevFixed;
    }
  };

  const isFeasible = (result: ReturnType<typeof solveAssembly>): boolean =>
    result.converged && result.unsatisfied.length === 0 && result.conflicts.length === 0 &&
    state.mates.every(m => {
      if (!m.enabled || m.type !== 'limitAngle') return true;
      const [s0, s1] = m.selections;
      const p0 = result.bodies[s0.bodyIndex];
      const p1 = result.bodies[s1.bodyIndex];
      if (!p0 || !p1) return false;
      const n0 = s0.localNormal.clone().applyQuaternion(new THREE.Quaternion().setFromEuler(p0.rotation)).normalize();
      const n1 = s1.localNormal.clone().applyQuaternion(new THREE.Quaternion().setFromEuler(p1.rotation)).normalize();
      const angle = (Math.acos(THREE.MathUtils.clamp(n0.dot(n1), -1, 1)) * 180) / Math.PI;
      const lo = m.min ?? 0;
      const hi = m.max ?? lo;
      return angle >= lo - 1e-7 && angle <= hi + 1e-7;
    });

  // Interpolate a trial pose along the actual revolute path.  Linear Euler
  // interpolation would leave the hinge circle and can make a valid endpoint
  // appear invalid, so use a world-space quaternion delta for this mode.
  const setTrialFraction = (fraction: number): void => {
    if (mode.kind === 'revolute') {
      const delta = desiredQuaternion.clone().multiply(startQuaternion.clone().invert());
      const step = new THREE.Quaternion().slerp(delta, fraction);
      body.position.copy(startPosition.clone().sub(mode.pivotWorld).applyQuaternion(step).add(mode.pivotWorld));
      body.rotation.setFromQuaternion(step.clone().premultiply(startQuaternion));
      return;
    }
    body.position.lerpVectors(startPosition, desiredPosition, fraction);
    body.rotation.setFromQuaternion(startQuaternion.clone().slerp(desiredQuaternion, fraction));
  };

  // Pin the driven body for the re-solve so the correction flows outward
  // (the same trick positionDriver.applyDriver uses), unless it's free-mode
  // (then the solver may also polish the dragged body itself).
  let res = solvePinned();
  let commitResult = true;

  if (!isFeasible(res) && hasLimitAngle && mode.kind === 'revolute') {
    // If the previous frame was feasible, the feasible part of a continuous
    // drag is an interval [0, boundary].  Bisection gives stable behaviour at
    // either bound without depending on the limit mate's correction direction.
    setTrialFraction(0);
    const atStart = solvePinned();
    if (isFeasible(atStart)) {
      let lo = 0;
      let hi = 1;
      let best = atStart;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        setTrialFraction(mid);
        const trial = solvePinned();
        if (isFeasible(trial)) {
          lo = mid;
          best = trial;
        } else {
          hi = mid;
        }
      }
      setTrialFraction(lo);
      res = best;
    } else {
      // Contradictory limits (or another unsatisfied mate already present at
      // the prior pose) have no safe drag result.  Do not commit a pinned,
      // invalid candidate and do not report false convergence.
      setTrialFraction(0);
      res = atStart;
      commitResult = false;
    }
  }

  // Write the solved poses back so the next frame warm-starts from here.
  if (commitResult) {
    for (let i = 0; i < state.bodies.length; i++) {
      state.bodies[i].position.copy(res.bodies[i].position);
      state.bodies[i].rotation.copy(res.bodies[i].rotation);
    }
  }

  const resultBodies = commitResult
    ? res.bodies
    : state.bodies.map(b => ({ position: b.position.clone(), rotation: b.rotation.clone() }));
  return {
    bodies: resultBodies,
    converged: isFeasible(res),
    iterations: res.iterations,
  };
}
