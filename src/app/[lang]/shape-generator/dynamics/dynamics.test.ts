import { describe, it, expect } from 'vitest';
import { createBody, applyForce, stepBody, stepWorld, v3, quat } from './rigidBody';
import { solveConstraints, type Constraint } from './constraints';
import { applyActuators, type Actuator } from './actuators';
import {
  aabbFromOrientedBody, aabbOverlap, broadPhase, satOverlap, detectContacts,
  type OrientedBody,
} from './contactDetection';

// ── rigidBody ───────────────────────────────────────────────────────

describe('rigidBody integrator', () => {
  it('free fall accelerates under gravity', () => {
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    stepBody(b, 0.1, { gravity: { x: 0, y: -9.81, z: 0 } });
    expect(b.state.velocity.y).toBeCloseTo(-0.981, 3);
    expect(b.state.position.y).toBeCloseTo(-0.0981, 3);
  });

  it('fixed body does not move', () => {
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 }, isFixed: true });
    applyForce(b, { x: 100, y: 0, z: 0 });
    stepBody(b, 0.1, { gravity: { x: 0, y: -9.81, z: 0 } });
    expect(b.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('applyForce accumulates per step', () => {
    const b = createBody('b', { massKg: 2, inertia: { x: 1, y: 1, z: 1 } });
    applyForce(b, { x: 10, y: 0, z: 0 });
    stepBody(b, 0.1, { gravity: null });
    expect(b.state.velocity.x).toBeCloseTo(0.5, 5); // 10/2 * 0.1
  });

  it('damping reduces velocity', () => {
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { velocity: { x: 10, y: 0, z: 0 } });
    stepBody(b, 0.1, { gravity: null, linearDamping: 1.0 });
    expect(b.state.velocity.x).toBeLessThan(10);
  });

  it('quaternion stays normalised after step', () => {
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { angularVelocity: { x: 1, y: 0, z: 0 } });
    stepBody(b, 0.1, { gravity: null });
    const q = b.state.orientation;
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(len).toBeCloseTo(1, 5);
  });

  it('stepWorld advances all bodies', () => {
    const a = createBody('a', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    stepWorld([a, b], 0.1);
    expect(a.state.position.y).toBeLessThan(0);
    expect(b.state.position.y).toBeLessThan(0);
  });
});

// ── constraints ─────────────────────────────────────────────────────

describe('constraints', () => {
  it('distance constraint pulls bodies to target', () => {
    const a = createBody('a', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { position: { x: 0.5, y: 0, z: 0 } });
    const c: Constraint = {
      kind: 'distance', bodyA: 'a', bodyB: 'b',
      anchorA: v3.zero(), anchorB: v3.zero(),
      targetMm: 100, // 0.1m
    };
    solveConstraints({ a, b }, [c], 10);
    const finalDist = v3.length(v3.sub(b.state.position, a.state.position));
    expect(finalDist).toBeCloseTo(0.1, 3);
  });

  it('point-on-plane constraint corrects offset', () => {
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { position: { x: 0, y: 0.5, z: 0 } });
    const c: Constraint = {
      kind: 'point-on-plane', body: 'b', anchor: v3.zero(),
      planeNormal: { x: 0, y: 1, z: 0 }, planePoint: v3.zero(),
    };
    solveConstraints({ b }, [c]);
    expect(b.state.position.y).toBeCloseTo(0, 5);
  });

  it('fixed body cannot be moved by constraints', () => {
    const a = createBody('a', { massKg: 1, inertia: { x: 1, y: 1, z: 1 }, isFixed: true });
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { position: { x: 1, y: 0, z: 0 } });
    const c: Constraint = {
      kind: 'distance', bodyA: 'a', bodyB: 'b',
      anchorA: v3.zero(), anchorB: v3.zero(), targetMm: 100,
    };
    solveConstraints({ a, b }, [c], 10);
    // A stays put.
    expect(a.state.position.x).toBe(0);
    // B moves toward A.
    expect(b.state.position.x).toBeLessThan(1);
  });
});

// ── actuators ───────────────────────────────────────────────────────

describe('actuators', () => {
  it('spring pulls bodies toward rest length', () => {
    const a = createBody('a', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { position: { x: 0.5, y: 0, z: 0 } });
    const s: Actuator = {
      kind: 'spring', bodyA: 'a', bodyB: 'b',
      anchorA: v3.zero(), anchorB: v3.zero(),
      kNperMm: 100, restMm: 100,
    };
    // Initial distance is 500mm, rest is 100mm — strong restoring force.
    applyActuators({ a, b }, [s]);
    expect(b.netForce.x).toBeLessThan(0);   // B pulled toward A
    expect(a.netForce.x).toBeGreaterThan(0); // A pulled toward B
  });

  it('damper opposes relative velocity', () => {
    const a = createBody('a', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { position: { x: 1, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } });
    const d: Actuator = {
      kind: 'damper', bodyA: 'a', bodyB: 'b',
      anchorA: v3.zero(), anchorB: v3.zero(), cNsPerM: 10,
    };
    applyActuators({ a, b }, [d]);
    // B moving away from A → damper pulls B back.
    expect(b.netForce.x).toBeLessThan(0);
  });

  it('motor produces torque on hinge', () => {
    const a = createBody('a', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    const b = createBody('b', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } });
    const m: Actuator = {
      kind: 'motor', bodyA: 'a', bodyB: 'b',
      axis: { x: 0, y: 0, z: 1 }, mode: 'torque', target: 5,
    };
    applyActuators({ a, b }, [m]);
    expect(a.netTorque.z).toBe(5);
    expect(b.netTorque.z).toBe(-5);
  });
});

// ── contact detection ──────────────────────────────────────────────

describe('contact detection', () => {
  function box(id: string, center: { x: number; y: number; z: number }, half: number = 0.5): OrientedBody {
    return {
      id,
      center,
      halfExtents: { x: half, y: half, z: half },
      axes: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    };
  }

  it('AABB overlap detects intersecting boxes', () => {
    const a = aabbFromOrientedBody(box('a', { x: 0, y: 0, z: 0 }));
    const b = aabbFromOrientedBody(box('b', { x: 0.5, y: 0, z: 0 }));
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('broadPhase returns pairs that overlap', () => {
    const bodies = [
      box('a', { x: 0, y: 0, z: 0 }),
      box('b', { x: 0.5, y: 0, z: 0 }),
      box('c', { x: 10, y: 0, z: 0 }),
    ];
    const pairs = broadPhase(bodies);
    expect(pairs.length).toBe(1);
  });

  it('SAT detects penetration', () => {
    const c = satOverlap(box('a', { x: 0, y: 0, z: 0 }), box('b', { x: 0.5, y: 0, z: 0 }));
    expect(c).not.toBeNull();
    expect(c!.depth).toBeGreaterThan(0);
  });

  it('SAT returns null for non-touching boxes', () => {
    const c = satOverlap(box('a', { x: 0, y: 0, z: 0 }), box('b', { x: 5, y: 0, z: 0 }));
    expect(c).toBeNull();
  });

  it('contact normal points A → B', () => {
    const c = satOverlap(box('a', { x: 0, y: 0, z: 0 }), box('b', { x: 0.5, y: 0, z: 0 }))!;
    expect(c.normal.x).toBeGreaterThan(0);
  });

  it('detectContacts returns all penetrating pairs', () => {
    const bodies = [
      box('a', { x: 0, y: 0, z: 0 }),
      box('b', { x: 0.5, y: 0, z: 0 }),
      box('c', { x: 0, y: 0.5, z: 0 }),
    ];
    expect(detectContacts(bodies).length).toBeGreaterThanOrEqual(2);
  });
});

// ── integration scenario ──────────────────────────────────────────

describe('integration · pendulum', () => {
  it('pendulum swings (gravity + distance constraint)', () => {
    const anchor = createBody('anchor', { massKg: 1, inertia: { x: 1, y: 1, z: 1 }, isFixed: true });
    const bob = createBody('bob', { massKg: 1, inertia: { x: 1, y: 1, z: 1 } },
      { position: { x: 0.5, y: -0.5, z: 0 } });
    const rod: Constraint = {
      kind: 'distance', bodyA: 'anchor', bodyB: 'bob',
      anchorA: v3.zero(), anchorB: v3.zero(),
      targetMm: 707,
    };

    // Simulate for 1 second of physics.
    for (let i = 0; i < 60; i++) {
      stepWorld([anchor, bob], 1 / 60);
      solveConstraints({ anchor, bob }, [rod], 4);
    }
    // Distance should still be approximately 0.707m.
    const dist = v3.length(v3.sub(bob.state.position, anchor.state.position));
    expect(dist).toBeCloseTo(0.707, 1);
  });
});

// ── quat helper ─────────────────────────────────────────────────────

describe('quaternion', () => {
  it('identity × any = any', () => {
    const q = { x: 0.1, y: 0.2, z: 0.3, w: 0.927 };
    const r = quat.mul(quat.identity(), q);
    expect(r.x).toBeCloseTo(q.x, 5);
    expect(r.w).toBeCloseTo(q.w, 5);
  });

  it('normalize unit length', () => {
    const q = quat.normalize({ x: 1, y: 1, z: 1, w: 1 });
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(len).toBeCloseTo(1, 5);
  });
});
