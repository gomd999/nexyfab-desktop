/**
 * Phase 2 ACCEPTANCE (SolidWorks-parity roadmap) — four-bar linkage drivable
 * by kinematic drag.
 *
 * Builds a Grashof crank-rocker as four bodies + four revolute (hinge) mates
 * on the viewport solver's AssemblyState, then DRAGS the crank tip through a
 * full revolution with `kinematicDragStep` (one call per pointer-move frame).
 * Every frame must:
 *   1. keep all four pin joints closed (residual < tolerance),
 *   2. match the closed-form four-bar position solution from the verified
 *      FEA suite (`fea/fourBar.fourBarPosition`) for the coupler and rocker.
 *
 * Honest scope note: this exercises the same pure functions the viewport
 * `KinematicDragManager` calls per pointer-move; the raycast/cursor plumbing
 * itself is browser-only and covered by manual QA.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  beginDragGesture,
  kinematicDragStep,
  gestureGrabWorld,
} from './kinematicDragSolve';
import type { AssemblyState, AssemblyBody, Mate, MateSelection } from './matesSolver';
import { fourBarPosition, grashof, loopResidual, type FourBar } from '../fea/fourBar';

// ─── Linkage definition (Grashof crank-rocker: s + l < p + q, s = crank) ─────

const LK: FourBar = { r1: 50, r2: 20, r3: 60, r4: 50 };

function axisSel(bodyIndex: number, point: [number, number, number]): MateSelection {
  return {
    bodyIndex,
    type: 'face',
    localPoint: new THREE.Vector3(...point),
    localNormal: new THREE.Vector3(0, 0, 1),
    localAxis: new THREE.Vector3(0, 0, 1),
  };
}

function hinge(id: string, a: MateSelection, b: MateSelection): Mate {
  return { id, type: 'hinge', enabled: true, selections: [a, b] };
}

/** Link body: pin 1 at local origin, pin 2 at local (L, 0, 0); pose = base
 *  point + z-rotation. */
function link(name: string, base: [number, number], angleRad: number, fixed = false): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(base[0], base[1], 0),
    rotation: new THREE.Euler(0, 0, angleRad),
    fixed,
  };
}

/** Assemble the four-bar at crank angle θ2 using the closed-form pose. */
function buildFourBar(theta2: number): AssemblyState {
  const pose = fourBarPosition(LK, theta2, 1);
  expect(pose.reachable).toBe(true);
  const rockerAngle = Math.atan2(0 - pose.B[1], LK.r1 - pose.B[0]); // B → O4

  const bodies: AssemblyBody[] = [
    link('ground', [0, 0], 0, true),                      // pins: A=(0,0), D=(r1,0)
    link('crank', [0, 0], theta2),                        // pins: A, crank tip
    link('coupler', [pose.A[0], pose.A[1]], pose.theta3), // pins: crank tip, B
    link('rocker', [pose.B[0], pose.B[1]], rockerAngle),  // pins: B, D
  ];
  const mates: Mate[] = [
    hinge('mA', axisSel(0, [0, 0, 0]), axisSel(1, [0, 0, 0])),
    hinge('mAB', axisSel(1, [LK.r2, 0, 0]), axisSel(2, [0, 0, 0])),
    hinge('mBC', axisSel(2, [LK.r3, 0, 0]), axisSel(3, [0, 0, 0])),
    hinge('mD', axisSel(3, [LK.r4, 0, 0]), axisSel(0, [LK.r1, 0, 0])),
  ];
  return { bodies, mates };
}

function worldPin(b: AssemblyBody, local: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(...local)
    .applyQuaternion(new THREE.Quaternion().setFromEuler(b.rotation))
    .add(b.position);
}

/** Smallest absolute angular difference (radians, wrap-safe). */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ACCEPTANCE · four-bar linkage drivable by drag', () => {
  it('the chosen dimensions are a Grashof crank-rocker (full crank rotation)', () => {
    const g = grashof(LK);
    expect(g.isGrashof).toBe(true);
    expect(g.type).toBe('crank-rocker');
  });

  it('drag the crank through a full revolution: joints stay closed and the pose matches the closed form every frame', () => {
    const theta0 = (30 * Math.PI) / 180;
    const st = buildFourBar(theta0);
    const gesture = beginDragGesture(
      st, 1,
      worldPin(st.bodies[1], [LK.r2, 0, 0]).clone(), // grab the crank tip
    );
    expect(gesture.mode.kind).toBe('revolute');

    const PIN_TOL = 0.25;   // mm — joint closure per frame
    const ANG_TOL = 0.02;   // rad (~1.1°) — vs closed-form coupler/rocker angles
    const stepDeg = 2;

    let maxPinResidual = 0;
    let maxAngErr = 0;

    for (let i = 1; i <= 360 / stepDeg; i++) {
      const th = theta0 + (i * stepDeg * Math.PI) / 180;
      const target = new THREE.Vector3(LK.r2 * Math.cos(th), LK.r2 * Math.sin(th), 0);
      kinematicDragStep(st, gesture, target, { iterations: 200 });

      // 1) Driver follows the cursor bearing exactly.
      const tip = gestureGrabWorld(st, gesture);
      expect(tip.distanceTo(target)).toBeLessThan(1e-3);

      // 2) All four revolute joints stay closed.
      const crankTip = worldPin(st.bodies[1], [LK.r2, 0, 0]);
      const couplerP0 = worldPin(st.bodies[2], [0, 0, 0]);
      const couplerP2 = worldPin(st.bodies[2], [LK.r3, 0, 0]);
      const rockerP0 = worldPin(st.bodies[3], [0, 0, 0]);
      const rockerP2 = worldPin(st.bodies[3], [LK.r4, 0, 0]);
      const D = new THREE.Vector3(LK.r1, 0, 0);
      const crankPin = worldPin(st.bodies[1], [0, 0, 0]);

      const residuals = [
        crankPin.length(),                  // A pin on ground origin
        couplerP0.distanceTo(crankTip),     // coupler ↔ crank tip
        couplerP2.distanceTo(rockerP0),     // coupler ↔ rocker (B)
        rockerP2.distanceTo(D),             // rocker ↔ ground (D)
      ];
      for (const r of residuals) {
        maxPinResidual = Math.max(maxPinResidual, r);
        expect(r).toBeLessThan(PIN_TOL);
      }

      // 3) Compare against the verified closed-form four-bar solution.
      const cf = fourBarPosition(LK, th, 1);
      expect(cf.reachable).toBe(true);
      const theta3Solver = Math.atan2(couplerP2.y - couplerP0.y, couplerP2.x - couplerP0.x);
      const theta4Solver = Math.atan2(rockerP0.y - rockerP2.y, rockerP0.x - rockerP2.x); // B − O4 bearing
      const e3 = angDiff(theta3Solver, cf.theta3);
      const e4 = angDiff(theta4Solver, cf.theta4);
      maxAngErr = Math.max(maxAngErr, e3, e4);
      expect(e3).toBeLessThan(ANG_TOL);
      expect(e4).toBeLessThan(ANG_TOL);

      // 4) The closed-form loop residual at the solver's angles is ~0 —
      //    cross-checks that the solver pose is a genuine loop closure.
      const [lrX, lrY] = loopResidual(LK, th, theta3Solver, theta4Solver);
      expect(Math.hypot(lrX, lrY)).toBeLessThan(PIN_TOL * 4);
    }

    // Useful when tuning solver iteration budgets:
    console.log(`[fourBarDrag] max pin residual ${maxPinResidual.toFixed(4)} mm · max angle err ${(maxAngErr * 180 / Math.PI).toFixed(3)}°`);
  });

  it('reversing the drag retraces the same branch (no pose popping)', () => {
    const theta0 = (45 * Math.PI) / 180;
    const st = buildFourBar(theta0);
    const gesture = beginDragGesture(st, 1, worldPin(st.bodies[1], [LK.r2, 0, 0]).clone());

    // Forward 40° then back to the start.
    const sweep: number[] = [];
    for (let d = 2; d <= 40; d += 2) sweep.push(theta0 + (d * Math.PI) / 180);
    for (let d = 38; d >= 0; d -= 2) sweep.push(theta0 + (d * Math.PI) / 180);

    for (const th of sweep) {
      kinematicDragStep(st, gesture, new THREE.Vector3(LK.r2 * Math.cos(th), LK.r2 * Math.sin(th), 0), { iterations: 200 });
    }

    // Back at θ0: the assembly must match the closed form pose at θ0 again.
    const cf = fourBarPosition(LK, theta0, 1);
    const couplerP0 = worldPin(st.bodies[2], [0, 0, 0]);
    expect(couplerP0.x).toBeCloseTo(cf.A[0], 1);
    expect(couplerP0.y).toBeCloseTo(cf.A[1], 1);
    const rockerP0 = worldPin(st.bodies[3], [0, 0, 0]);
    expect(rockerP0.distanceTo(new THREE.Vector3(cf.B[0], cf.B[1], 0))).toBeLessThan(0.5);
  });
});
