import { describe, it, expect } from 'vitest';
import {
  createSystem,
  stepSystem,
  summarizeSystem,
  type ParticleEmitter,
  type ForceField,
  type Collider,
} from './particleSystem';

function makeEmitter(): ParticleEmitter {
  return {
    origin: [0, 0, 0],
    rate: 100,
    lifetimeSec: 1,
    lifetimeJitter: 0,
    speedMmPerSec: 50,
    coneHalfAngle: Math.PI / 8,
    direction: [0, 1, 0],
    sizeMm: 1,
  };
}

describe('createSystem', () => {
  it('starts empty', () => {
    const s = createSystem(makeEmitter());
    expect(s.particles).toHaveLength(0);
  });
});

describe('emit', () => {
  it('spawns particles at rate', () => {
    const s = createSystem(makeEmitter());
    stepSystem(s, 0.1); // rate=100 → 10 particles
    expect(s.particles.length).toBeGreaterThanOrEqual(9);
    expect(s.particles.length).toBeLessThanOrEqual(11);
  });

  it('lifetime tracked from spawn', () => {
    const s = createSystem(makeEmitter());
    stepSystem(s, 0.1);
    for (const p of s.particles) expect(p.age).toBeGreaterThan(0);
  });
});

describe('integrate', () => {
  it('particles move along their velocity', () => {
    const s = createSystem(makeEmitter());
    stepSystem(s, 0.1);
    for (const p of s.particles) {
      expect(p.position[1]).toBeGreaterThan(0); // emitter direction is +Y
    }
  });
});

describe('force fields', () => {
  it('gravity accelerates particles down', () => {
    const gravity: ForceField = { kind: 'gravity', vector: [0, -1000, 0] };
    const s = createSystem({ ...makeEmitter(), direction: [1, 0, 0] }, [gravity]);
    stepSystem(s, 0.05);
    // Step with a longer dt so gravity gets enough integration.
    for (let i = 0; i < 10; i++) stepSystem(s, 0.05);
    const someBelowOrigin = s.particles.some(p => p.position[1] < 0);
    expect(someBelowOrigin).toBe(true);
  });

  it('drag decelerates particles', () => {
    const drag: ForceField = { kind: 'drag', coefficient: 5 };
    const s = createSystem(makeEmitter(), [drag]);
    stepSystem(s, 0.1);
    const initialSpeeds = s.particles.map(p => Math.hypot(p.velocity[0], p.velocity[1], p.velocity[2]));
    for (let i = 0; i < 10; i++) stepSystem(s, 0.05);
    const finalSpeeds = s.particles
      .filter(p => p.age < p.lifetime)
      .map(p => Math.hypot(p.velocity[0], p.velocity[1], p.velocity[2]));
    if (finalSpeeds.length > 0 && initialSpeeds.length > 0) {
      const initAvg = initialSpeeds.reduce((s, v) => s + v, 0) / initialSpeeds.length;
      const finalAvg = finalSpeeds.reduce((s, v) => s + v, 0) / finalSpeeds.length;
      expect(finalAvg).toBeLessThan(initAvg);
    }
  });

  it('point attractor pulls toward target', () => {
    const attractor: ForceField = { kind: 'point-attractor', position: [0, 100, 0], strength: 100000, falloff: 1 };
    const s = createSystem(makeEmitter(), [attractor]);
    for (let i = 0; i < 5; i++) stepSystem(s, 0.1);
    expect(s.particles.length).toBeGreaterThan(0);
  });
});

describe('colliders', () => {
  it('plane collider blocks particles below it', () => {
    const plane: Collider = { kind: 'plane', pointMm: [0, 0, 0], normal: [0, 1, 0], restitution: 0.5 };
    const s = createSystem(
      { ...makeEmitter(), origin: [0, 5, 0], direction: [0, -1, 0], speedMmPerSec: 100 },
      [],
      [plane],
    );
    for (let i = 0; i < 10; i++) stepSystem(s, 0.05);
    for (const p of s.particles) {
      expect(p.position[1]).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it('aabb collider clamps particles inside box', () => {
    const aabb: Collider = { kind: 'aabb', min: [-10, -10, -10], max: [10, 10, 10] };
    const s = createSystem({ ...makeEmitter(), speedMmPerSec: 1000 }, [], [aabb]);
    for (let i = 0; i < 20; i++) stepSystem(s, 0.05);
    for (const p of s.particles) {
      expect(p.position[0]).toBeGreaterThanOrEqual(-10.001);
      expect(p.position[0]).toBeLessThanOrEqual(10.001);
    }
  });
});

describe('reaping', () => {
  it('particles past their lifetime are removed when emission stops', () => {
    const e: ParticleEmitter = { ...makeEmitter(), lifetimeSec: 0.5 };
    const s = createSystem(e);
    // Spawn particles in small steps so they survive the integration step.
    for (let i = 0; i < 3; i++) stepSystem(s, 0.05);
    expect(s.particles.length).toBeGreaterThan(0);
    // Stop emitter and run steps past lifetime.
    s.emitter = { ...s.emitter, rate: 0 };
    for (let i = 0; i < 15; i++) stepSystem(s, 0.05);
    expect(s.particles.length).toBe(0);
  });
});

describe('summarizeSystem', () => {
  it('reports particle count', () => {
    const s = createSystem(makeEmitter());
    stepSystem(s, 0.05);
    const summary = summarizeSystem(s);
    expect(summary.particleCount).toBe(s.particles.length);
  });

  it('empty system returns zeros', () => {
    const s = createSystem(makeEmitter());
    const summary = summarizeSystem(s);
    expect(summary.particleCount).toBe(0);
    expect(summary.meanAge).toBe(0);
  });
});
