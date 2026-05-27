import { describe, it, expect } from 'vitest';
import {
  sensorTriggered,
  applyAction,
  stepEventSimulation,
  camFollowerProfile,
  maxFollowerAcceleration,
  trapezoidalProfile,
  contactForce,
  recordPath,
  type MotionState,
  type MotionSensor,
  type MotionAction,
  type MotionEvent,
} from './motionStudyPro';

function emptyState(): MotionState {
  return {
    time: 0, positions: {}, velocities: {},
    motors: {}, contacts: new Set(),
  };
}

describe('sensorTriggered', () => {
  it('time sensor triggers at threshold', () => {
    const s: MotionSensor = { id: 's1', kind: 'time', threshold: 1.5 };
    const state = emptyState();
    state.time = 1.4;
    expect(sensorTriggered(s, state)).toBe(false);
    state.time = 1.5;
    expect(sensorTriggered(s, state)).toBe(true);
  });

  it('position sensor reads target entity', () => {
    const s: MotionSensor = { id: 's1', kind: 'position', targetEntityId: 'p1', threshold: 10 };
    const state = emptyState();
    state.positions['p1'] = 15;
    expect(sensorTriggered(s, state)).toBe(true);
  });

  it('≤ comparison flips trigger direction', () => {
    const s: MotionSensor = { id: 's1', kind: 'time', threshold: 5, comparison: '≤' };
    const state = emptyState();
    state.time = 3;
    expect(sensorTriggered(s, state)).toBe(true);
    state.time = 6;
    expect(sensorTriggered(s, state)).toBe(false);
  });

  it('contact sensor checks set membership', () => {
    const s: MotionSensor = { id: 's1', kind: 'contact', targetEntityId: 'pair1', threshold: 0 };
    const state = emptyState();
    state.contacts.add('pair1');
    expect(sensorTriggered(s, state)).toBe(true);
  });
});

describe('applyAction', () => {
  it('start-motor enables motor', () => {
    const state = emptyState();
    applyAction(state, { id: 'a1', kind: 'start-motor', targetMotorId: 'm1', value: 50 });
    expect(state.motors['m1']!.running).toBe(true);
    expect(state.motors['m1']!.velocity).toBe(50);
  });

  it('stop-motor sets velocity 0', () => {
    const state = emptyState();
    state.motors['m1'] = { running: true, velocity: 100 };
    applyAction(state, { id: 'a1', kind: 'stop-motor', targetMotorId: 'm1' });
    expect(state.motors['m1']!.velocity).toBe(0);
  });

  it('reverse flips velocity sign', () => {
    const state = emptyState();
    state.motors['m1'] = { running: true, velocity: 100 };
    applyAction(state, { id: 'a1', kind: 'reverse', targetMotorId: 'm1' });
    expect(state.motors['m1']!.velocity).toBe(-100);
  });
});

describe('stepEventSimulation', () => {
  it('event fires once', () => {
    const sensors: MotionSensor[] = [{ id: 's1', kind: 'time', threshold: 1 }];
    const actions: MotionAction[] = [{ id: 'a1', kind: 'start-motor', targetMotorId: 'm1', value: 10 }];
    const events: MotionEvent[] = [{ id: 'e1', sensorId: 's1', actionId: 'a1' }];
    const state = emptyState();
    state.time = 1.5;
    const r1 = stepEventSimulation(state, sensors, actions, events);
    expect(r1.firedEventIds).toContain('e1');
    // Second call — already fired, should NOT fire again.
    const r2 = stepEventSimulation(state, sensors, actions, events);
    expect(r2.firedEventIds).toHaveLength(0);
  });

  it('events with unfired sensors stay dormant', () => {
    const sensors: MotionSensor[] = [{ id: 's1', kind: 'time', threshold: 100 }];
    const actions: MotionAction[] = [{ id: 'a1', kind: 'start-motor', targetMotorId: 'm1' }];
    const events: MotionEvent[] = [{ id: 'e1', sensorId: 's1', actionId: 'a1' }];
    const state = emptyState();
    state.time = 1;
    const r = stepEventSimulation(state, sensors, actions, events);
    expect(r.firedEventIds).toHaveLength(0);
  });
});

describe('camFollowerProfile', () => {
  it('knife follower mirrors cam radii', () => {
    const cam = { radii: [10, 11, 12, 13] };
    expect(camFollowerProfile(cam, 'knife')).toEqual([10, 11, 12, 13]);
  });

  it('roller follower adds rollerRadius', () => {
    const cam = { radii: [10, 11, 12] };
    const r = camFollowerProfile(cam, 'roller', 3);
    expect(r).toEqual([13, 14, 15]);
  });

  it('flat follower smooths peaks (5-pt avg)', () => {
    const cam = { radii: [10, 10, 20, 10, 10] };
    const r = camFollowerProfile(cam, 'flat');
    // Middle (index 2) should be (10+10+20+10+10)/5 = 12.
    expect(r[2]).toBe(12);
  });
});

describe('maxFollowerAcceleration', () => {
  it('zero acceleration for constant displacement', () => {
    const r = maxFollowerAcceleration([10, 10, 10, 10], 60);
    expect(r).toBe(0);
  });

  it('non-zero for varying profile', () => {
    const r = maxFollowerAcceleration([10, 15, 10, 15], 60);
    expect(r).toBeGreaterThan(0);
  });
});

describe('trapezoidalProfile', () => {
  it('reaches the requested distance', () => {
    const samples = trapezoidalProfile({
      distanceMm: 100, maxVelocityMmS: 50, accelerationMmS2: 100,
    });
    expect(samples[samples.length - 1]!.position).toBeCloseTo(100, 1);
  });

  it('velocity peaks at maxVelocity for long enough move', () => {
    const samples = trapezoidalProfile({
      distanceMm: 1000, maxVelocityMmS: 50, accelerationMmS2: 100,
    });
    const peak = Math.max(...samples.map(s => s.velocity));
    expect(peak).toBeCloseTo(50, 1);
  });

  it('triangular profile when distance too short for full V', () => {
    const samples = trapezoidalProfile({
      distanceMm: 10, maxVelocityMmS: 100, accelerationMmS2: 50,
    });
    const peak = Math.max(...samples.map(s => s.velocity));
    expect(peak).toBeLessThan(100);
  });
});

describe('contactForce', () => {
  const pair = { bodyAId: 'a', bodyBId: 'b', stiffnessKn: 100, dampingC: 0.5, friction: 0.3 };

  it('zero penetration → zero force', () => {
    expect(contactForce(0, 0, pair)).toBe(0);
  });

  it('linear in penetration', () => {
    expect(contactForce(1, 0, pair)).toBe(100);
    expect(contactForce(2, 0, pair)).toBe(200);
  });

  it('damping adds with approach velocity', () => {
    expect(contactForce(1, 10, pair)).toBe(100 + 5);
  });
});

describe('recordPath', () => {
  it('first point adds zero length', () => {
    const trace = { entityId: 'e1', points: [], totalLengthMm: 0 };
    recordPath(trace, 0, 0, 0, 0);
    expect(trace.points).toHaveLength(1);
    expect(trace.totalLengthMm).toBe(0);
  });

  it('accumulates distance', () => {
    const trace = { entityId: 'e1', points: [], totalLengthMm: 0 };
    recordPath(trace, 0, 0, 0, 0);
    recordPath(trace, 1, 3, 4, 0);
    expect(trace.totalLengthMm).toBeCloseTo(5, 5);
  });
});
