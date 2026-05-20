/**
 * positionDriver.ts — Drive a hinge angle or slider distance directly.
 *
 * Position drivers are the foundation of kinematic playback: the user
 * specifies one DOF as the driver, every other body follows via the
 * mate constraints (gear / belt / linked sliders). In practice this
 * looks like sliding a UI slider and watching the assembly animate.
 *
 * Workflow:
 *   1. User picks a hinge mate as the driver → sets `driverValue` (deg).
 *   2. `applyDriver` mutates the AssemblyState to pin the driving body
 *      at the requested angle along the hinge axis.
 *   3. Caller runs `solveAssembly` — the rest of the rig follows
 *      through gear / belt couplings.
 *
 * **Why mutate, not return** — the driving body gets temporarily
 * marked `fixed: true` so the GS solver won't push it back during
 * iteration. The original `fixed` state is preserved on the returned
 * `restore()` closure so the caller can release the driver after the
 * frame. Callers that prefer immutable state should `structuredClone`
 * the state before passing it in (state.bodies hold THREE.Vector3 /
 * Euler which structuredClone preserves as plain objects — Vector3
 * may need explicit reconstruction).
 */

import * as THREE from 'three';
import type { AssemblyState, Mate } from './matesSolver';

export type PositionDriverType = 'hinge-angle' | 'slider-distance';

export interface PositionDriver {
  type: PositionDriverType;
  /** Mate that the driver controls. The mate's `type` should match:
   *  hinge-angle → 'hinge', slider-distance → 'slider'. */
  mateId: string;
  /** For hinge-angle: angle in degrees relative to the reference pose
   *  (the state's bodies as supplied are treated as the reference).
   *  For slider-distance: signed distance in mm along the slider axis. */
  value: number;
}

export interface DriverApplication {
  /** True when the driver successfully pinned a body. */
  ok: boolean;
  /** Body index that was pinned (so callers can restore `fixed` later). */
  drivenBodyIndex?: number;
  /** Previous `fixed` flag on the driven body (for restoration). */
  previousFixed?: boolean;
  /** Reason the driver did not apply, when `ok` is false. */
  reason?: 'mate-not-found' | 'mate-disabled' | 'mate-type-mismatch' | 'body-index-out-of-range';
}

/** Locate a mate by id with a type guard for the driver kind. */
function findMate(state: AssemblyState, driver: PositionDriver): Mate | null {
  const m = state.mates.find(x => x.id === driver.mateId) ?? null;
  if (!m) return null;
  if (!m.enabled) return null;
  if (driver.type === 'hinge-angle' && m.type !== 'hinge') return null;
  if (driver.type === 'slider-distance' && m.type !== 'slider') return null;
  return m;
}

/**
 * Apply a driver to an AssemblyState in-place. Returns a record the
 * caller uses to roll back the `fixed` flag once the solve completes.
 * Doesn't run the solver — the caller chains `solveAssembly` after.
 *
 * Convention: the SECOND selection's body is the "driven" body.
 * The first selection's body is the reference (typically grounded or
 * controlled by an earlier driver in a multi-driver chain).
 */
export function applyDriver(state: AssemblyState, driver: PositionDriver): DriverApplication {
  const mate = findMate(state, driver);
  if (!mate) {
    const m = state.mates.find(x => x.id === driver.mateId);
    if (!m) return { ok: false, reason: 'mate-not-found' };
    if (!m.enabled) return { ok: false, reason: 'mate-disabled' };
    return { ok: false, reason: 'mate-type-mismatch' };
  }
  const [, sDriven] = mate.selections;
  const drivenIdx = sDriven.bodyIndex;
  if (drivenIdx < 0 || drivenIdx >= state.bodies.length) {
    return { ok: false, reason: 'body-index-out-of-range' };
  }
  const body = state.bodies[drivenIdx];
  const previousFixed = body.fixed;

  if (driver.type === 'hinge-angle') {
    // Rotate the driven body around its hinge axis (local axis of the
    // driven selection) by the requested angle. We snap to that pose
    // (no incremental accumulation) so the same driver value always
    // produces the same configuration regardless of solve history.
    const axisLocal = sDriven.localAxis ?? sDriven.localNormal;
    // Compose: reset rotation, then rotate by driver angle around axis.
    const angleRad = (driver.value * Math.PI) / 180;
    const q = new THREE.Quaternion().setFromAxisAngle(axisLocal, angleRad);
    body.rotation.setFromQuaternion(q);
  } else {
    // slider-distance: translate driven body along the slider axis from
    // the world-space origin of the joint. We use the first selection's
    // localPoint (in body 0's local frame) as the reference point and
    // the localAxis as the direction.
    const [s0] = mate.selections;
    const refBody = state.bodies[s0.bodyIndex];
    const refQ = new THREE.Quaternion().setFromEuler(refBody.rotation);
    const refPoint = s0.localPoint.clone().applyQuaternion(refQ).add(refBody.position);
    const axisWorld = (s0.localAxis ?? s0.localNormal).clone().applyQuaternion(refQ).normalize();
    const newPos = refPoint.clone().add(axisWorld.multiplyScalar(driver.value));
    body.position.copy(newPos);
  }

  body.fixed = true;
  return { ok: true, drivenBodyIndex: drivenIdx, previousFixed };
}

/** Roll back a driver application — restores the driven body's
 *  original `fixed` flag so the GS solver sees it as free again on the
 *  next frame's call. Use when the driver is removed or the playback
 *  pauses. */
export function restoreDriver(state: AssemblyState, app: DriverApplication): void {
  if (!app.ok || app.drivenBodyIndex == null) return;
  const body = state.bodies[app.drivenBodyIndex];
  if (!body) return;
  body.fixed = app.previousFixed ?? false;
}
