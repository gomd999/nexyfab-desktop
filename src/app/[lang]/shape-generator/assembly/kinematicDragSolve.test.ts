/**
 * Phase 2 (SolidWorks-parity roadmap) — kinematic drag as pure functions.
 *
 * Covers: drag-mode detection (revolute / prismatic / free), the per-frame
 * soft-pin + re-polish step, snapshot/restore (one-undo-per-gesture), and the
 * GEAR-PAIR acceptance: dragging one wheel rotates its partner at the mate
 * ratio every frame.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  beginDragGesture,
  detectDragMode,
  kinematicDragStep,
  snapshotPoses,
  restorePoses,
  gestureGrabWorld,
} from './kinematicDragSolve';
import {
  twistAngleAroundAxis,
  type AssemblyState,
  type AssemblyBody,
  type Mate,
  type MateSelection,
} from './matesSolver';

const Z = new THREE.Vector3(0, 0, 1);

function body(name: string, pos: [number, number, number], fixed = false): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(...pos),
    rotation: new THREE.Euler(0, 0, 0),
    fixed,
  };
}

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

// ─── Mode detection ───────────────────────────────────────────────────────────

describe('detectDragMode', () => {
  it('hinge to a FIXED partner → revolute with that pivot/axis', () => {
    const st: AssemblyState = {
      bodies: [body('ground', [0, 0, 0], true), body('arm', [0, 0, 0])],
      mates: [hinge('h', axisSel(0, [5, 2, 0]), axisSel(1, [0, 0, 0]))],
    };
    const mode = detectDragMode(st, 1);
    expect(mode.kind).toBe('revolute');
    if (mode.kind === 'revolute') {
      expect(mode.pivotWorld.x).toBeCloseTo(5);
      expect(mode.pivotWorld.y).toBeCloseTo(2);
      expect(mode.axisWorld.z).toBeCloseTo(1);
    }
  });

  it('slider to a FIXED partner → prismatic', () => {
    const st: AssemblyState = {
      bodies: [body('rail', [0, 0, 0], true), body('cart', [0, 0, 0])],
      mates: [{
        id: 's', type: 'slider', enabled: true,
        selections: [
          { bodyIndex: 0, type: 'face', localPoint: new THREE.Vector3(0, 0, 0), localNormal: new THREE.Vector3(1, 0, 0), localAxis: new THREE.Vector3(1, 0, 0) },
          { bodyIndex: 1, type: 'face', localPoint: new THREE.Vector3(0, 0, 0), localNormal: new THREE.Vector3(1, 0, 0), localAxis: new THREE.Vector3(1, 0, 0) },
        ],
      }],
    };
    const mode = detectDragMode(st, 1);
    expect(mode.kind).toBe('prismatic');
  });

  it('hinge to a FREE partner → free (no exact joint-space projection)', () => {
    const st: AssemblyState = {
      bodies: [body('a', [0, 0, 0]), body('b', [10, 0, 0])],
      mates: [hinge('h', axisSel(0, [0, 0, 0]), axisSel(1, [0, 0, 0]))],
    };
    expect(detectDragMode(st, 1).kind).toBe('free');
  });

  it('disabled mates are ignored', () => {
    const st: AssemblyState = {
      bodies: [body('ground', [0, 0, 0], true), body('arm', [0, 0, 0])],
      mates: [{ ...hinge('h', axisSel(0, [0, 0, 0]), axisSel(1, [0, 0, 0])), enabled: false }],
    };
    expect(detectDragMode(st, 1).kind).toBe('free');
  });
});

// ─── Revolute drag step ───────────────────────────────────────────────────────

describe('kinematicDragStep · revolute', () => {
  it('the grab point chases the cursor along its circle about the pivot', () => {
    // Arm of length 10 hinged at the origin to a fixed ground.
    const st: AssemblyState = {
      bodies: [body('ground', [0, 0, 0], true), body('arm', [0, 0, 0])],
      mates: [hinge('h', axisSel(0, [0, 0, 0]), axisSel(1, [0, 0, 0]))],
    };
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(10, 0, 0)); // grab the tip
    expect(gesture.mode.kind).toBe('revolute');

    // Drag toward 90°: cursor far off the circle — the tip must still land
    // ON the circle (radius 10) at the cursor's bearing.
    kinematicDragStep(st, gesture, new THREE.Vector3(0, 25, 0));
    const tip = gestureGrabWorld(st, gesture);
    expect(tip.x).toBeCloseTo(0, 4);
    expect(tip.y).toBeCloseTo(10, 4);
    // Hinge pin stays put.
    expect(st.bodies[1].position.length()).toBeLessThan(1e-6);
  });

  it('off-center pivot: the body rotates rigidly about the pivot line', () => {
    const st: AssemblyState = {
      bodies: [body('ground', [0, 0, 0], true), body('arm', [5, 0, 0])],
      mates: [hinge('h', axisSel(0, [5, 0, 0]), axisSel(1, [0, 0, 0]))],
    };
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(15, 0, 0)); // tip 10 from pivot
    kinematicDragStep(st, gesture, new THREE.Vector3(5, 30, 0)); // straight up from pivot
    const tip = gestureGrabWorld(st, gesture);
    expect(tip.x).toBeCloseTo(5, 4);
    expect(tip.y).toBeCloseTo(10, 4);
    // Pin point of the arm (local origin) must remain on the pivot.
    expect(st.bodies[1].position.distanceTo(new THREE.Vector3(5, 0, 0))).toBeLessThan(1e-4);
  });
});

// ─── Prismatic drag step ──────────────────────────────────────────────────────

describe('kinematicDragStep · prismatic', () => {
  it('motion is projected onto the slide axis only', () => {
    const st: AssemblyState = {
      bodies: [body('rail', [0, 0, 0], true), body('cart', [0, 0, 0])],
      mates: [{
        id: 's', type: 'slider', enabled: true,
        selections: [
          { bodyIndex: 0, type: 'face', localPoint: new THREE.Vector3(0, 0, 0), localNormal: new THREE.Vector3(1, 0, 0), localAxis: new THREE.Vector3(1, 0, 0) },
          { bodyIndex: 1, type: 'face', localPoint: new THREE.Vector3(0, 0, 0), localNormal: new THREE.Vector3(1, 0, 0), localAxis: new THREE.Vector3(1, 0, 0) },
        ],
      }],
    };
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(0, 0, 0));
    kinematicDragStep(st, gesture, new THREE.Vector3(7, 99, -3)); // wildly off-axis cursor
    expect(st.bodies[1].position.x).toBeCloseTo(7, 4);
    expect(st.bodies[1].position.y).toBeCloseTo(0, 4);
    expect(st.bodies[1].position.z).toBeCloseTo(0, 4);
  });
});

// ─── Free drag step (soft pin + re-polish) ────────────────────────────────────

describe('kinematicDragStep · free', () => {
  it('unmated body follows the cursor exactly', () => {
    const st: AssemblyState = { bodies: [body('lone', [0, 0, 0])], mates: [] };
    const gesture = beginDragGesture(st, 0, new THREE.Vector3(1, 1, 0));
    kinematicDragStep(st, gesture, new THREE.Vector3(11, 5, 2));
    expect(gestureGrabWorld(st, gesture).distanceTo(new THREE.Vector3(11, 5, 2))).toBeLessThan(1e-6);
  });

  it('distance-mated body is pulled back onto the constraint manifold', () => {
    const st: AssemblyState = {
      bodies: [body('anchor', [0, 0, 0], true), body('sat', [10, 0, 0])],
      mates: [{
        id: 'd', type: 'distance', enabled: true, distance: 10,
        selections: [
          { bodyIndex: 0, type: 'face', localPoint: new THREE.Vector3(0, 0, 0), localNormal: new THREE.Vector3(1, 0, 0) },
          { bodyIndex: 1, type: 'face', localPoint: new THREE.Vector3(0, 0, 0), localNormal: new THREE.Vector3(1, 0, 0) },
        ],
      }],
    };
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(10, 0, 0));
    kinematicDragStep(st, gesture, new THREE.Vector3(40, 30, 0));
    // Soft-pin: target is at distance 50, the solver re-polishes back to 10.
    expect(st.bodies[1].position.length()).toBeCloseTo(10, 2);
  });
});

// ─── Gesture snapshots (one undo step per gesture) ────────────────────────────

describe('snapshotPoses / restorePoses', () => {
  it('round-trips every body pose', () => {
    const st: AssemblyState = {
      bodies: [body('ground', [0, 0, 0], true), body('arm', [0, 0, 0])],
      mates: [hinge('h', axisSel(0, [0, 0, 0]), axisSel(1, [0, 0, 0]))],
    };
    const before = snapshotPoses(st);
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(10, 0, 0));
    for (let i = 1; i <= 5; i++) {
      kinematicDragStep(st, gesture, new THREE.Vector3(10 * Math.cos(i * 0.2), 10 * Math.sin(i * 0.2), 0));
    }
    expect(st.bodies[1].rotation.z).not.toBeCloseTo(0, 3);
    restorePoses(st, before);
    expect(st.bodies[1].rotation.z).toBeCloseTo(0, 10);
    expect(st.bodies[1].position.length()).toBeLessThan(1e-10);
  });
});

// ─── ACCEPTANCE: gear pair driven by drag ─────────────────────────────────────

describe('ACCEPTANCE · gear pair drivable by drag', () => {
  function gearPair(ratio: number): AssemblyState {
    return {
      bodies: [
        body('ground', [0, 0, 0], true),
        body('wheelA', [0, 0, 0]),
        body('wheelB', [30, 0, 0]),
      ],
      mates: [
        hinge('hA', axisSel(0, [0, 0, 0]), axisSel(1, [0, 0, 0])),
        hinge('hB', axisSel(0, [30, 0, 0]), axisSel(2, [0, 0, 0])),
        {
          id: 'g', type: 'gear', enabled: true, gearRatio: ratio,
          selections: [axisSel(1, [0, 0, 0]), axisSel(2, [0, 0, 0])],
        },
      ],
    };
  }

  function twist(st: AssemblyState, i: number): number {
    return twistAngleAroundAxis(new THREE.Quaternion().setFromEuler(st.bodies[i].rotation), Z);
  }

  it('dragging wheel A through a sweep rotates wheel B at the mate ratio each frame', () => {
    const ratio = -2; // external mesh, B counter-rotates at 2×
    const st = gearPair(ratio);
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(10, 0, 0)); // grab A's rim
    expect(gesture.mode.kind).toBe('revolute');

    const R = 10;
    for (let deg = 2; deg <= 70; deg += 2) {
      const th = (deg * Math.PI) / 180;
      const res = kinematicDragStep(st, gesture, new THREE.Vector3(R * Math.cos(th), R * Math.sin(th), 0), { iterations: 80 });
      expect(res.converged).toBe(true);
      const tA = twist(st, 1);
      const tB = twist(st, 2);
      // Driver follows the cursor bearing exactly (revolute projection).
      expect(tA).toBeCloseTo(th, 3);
      // Gear relation: twist(A) × ratio = twist(B), every frame.
      expect(tB).toBeCloseTo(ratio * th, 2);
      // Both wheels stay on their hinge pins.
      expect(st.bodies[1].position.length()).toBeLessThan(1e-3);
      expect(st.bodies[2].position.distanceTo(new THREE.Vector3(30, 0, 0))).toBeLessThan(1e-3);
    }
  });

  it('positive ratio couples in the same direction', () => {
    const st = gearPair(0.5); // internal mesh / belt-like
    const gesture = beginDragGesture(st, 1, new THREE.Vector3(10, 0, 0));
    const th = (40 * Math.PI) / 180;
    for (let f = 1; f <= 10; f++) {
      kinematicDragStep(st, gesture, new THREE.Vector3(10 * Math.cos(th * f / 10), 10 * Math.sin(th * f / 10), 0), { iterations: 80 });
    }
    expect(twist(st, 2)).toBeCloseTo(0.5 * th, 2);
  });
});
