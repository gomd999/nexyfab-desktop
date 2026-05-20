import { describe, it, expect } from 'vitest';
import {
  detectGroundedBody,
  getConnectivity,
  isFullyConnected,
  summarize,
  type AssemblyBody,
  type BodyMate,
} from './groundedBodyDetector';

function body(id: string, options: Partial<AssemblyBody> = {}): AssemblyBody {
  return { id, ...options };
}

function mate(a: string, b: string): BodyMate {
  return { bodyA: a, bodyB: b };
}

describe('detectGroundedBody', () => {
  it('empty input → null grounded body', () => {
    const r = detectGroundedBody([], []);
    expect(r.groundedBodyId).toBeNull();
  });

  it('explicit isGrounded wins', () => {
    const bodies = [body('a', { isGrounded: true }), body('b', { massKg: 100 })];
    const r = detectGroundedBody(bodies, []);
    expect(r.groundedBodyId).toBe('a');
  });

  it('most-mated body picked when no explicit flag', () => {
    const bodies = [body('a'), body('b'), body('c'), body('hub')];
    const mates = [mate('hub', 'a'), mate('hub', 'b'), mate('hub', 'c')];
    const r = detectGroundedBody(bodies, mates);
    expect(r.groundedBodyId).toBe('hub');
  });

  it('largest mass picked among similar mate counts', () => {
    const bodies = [
      body('small', { massKg: 1 }),
      body('big', { massKg: 100 }),
    ];
    const r = detectGroundedBody(bodies, []);
    expect(r.groundedBodyId).toBe('big');
  });

  it('closest centroid to origin wins on ties', () => {
    const bodies = [
      body('far', { centroid: { x: 1000, y: 0, z: 0 } }),
      body('near', { centroid: { x: 1, y: 0, z: 0 } }),
    ];
    const r = detectGroundedBody(bodies, []);
    expect(r.groundedBodyId).toBe('near');
  });

  it('all candidates have score breakdown', () => {
    const bodies = [body('a'), body('b')];
    const r = detectGroundedBody(bodies, [mate('a', 'b')]);
    expect(r.candidates).toHaveLength(2);
    for (const c of r.candidates) {
      expect(typeof c.totalScore).toBe('number');
    }
  });

  it('confidence in [0, 1]', () => {
    const bodies = [body('a', { isGrounded: true }), body('b')];
    const r = detectGroundedBody(bodies, []);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('sorted descending by score', () => {
    const bodies = [
      body('weak'),
      body('grounded', { isGrounded: true }),
    ];
    const r = detectGroundedBody(bodies, []);
    expect(r.candidates[0]!.bodyId).toBe('grounded');
  });
});

describe('getConnectivity', () => {
  it('builds adjacency map', () => {
    const bodies = [body('a'), body('b'), body('c')];
    const adj = getConnectivity(bodies, [mate('a', 'b'), mate('b', 'c')]);
    expect(adj.get('a')?.has('b')).toBe(true);
    expect(adj.get('c')?.has('b')).toBe(true);
  });
});

describe('isFullyConnected', () => {
  it('true when all parts reachable', () => {
    const bodies = [body('a', { isGrounded: true }), body('b'), body('c')];
    const r = detectGroundedBody(bodies, [mate('a', 'b'), mate('b', 'c')]);
    expect(isFullyConnected(r, bodies, [mate('a', 'b'), mate('b', 'c')])).toBe(true);
  });

  it('false when isolated body exists', () => {
    const bodies = [body('a', { isGrounded: true }), body('b'), body('isolated')];
    const r = detectGroundedBody(bodies, [mate('a', 'b')]);
    expect(isFullyConnected(r, bodies, [mate('a', 'b')])).toBe(false);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize({ groundedBodyId: null, candidates: [], confidence: 0 });
    expect(s.bodyCount).toBe(0);
  });

  it('reports ratio to second', () => {
    const bodies = [
      body('a', { isGrounded: true, massKg: 100 }),
      body('b', { massKg: 50 }),
    ];
    const r = detectGroundedBody(bodies, []);
    const s = summarize(r);
    expect(s.ratioToSecond).toBeGreaterThan(0);
  });
});
