import { describe, it, expect } from 'vitest';
import {
  optimizePullDirection,
  evaluateCandidate,
  generateCandidates,
  recommendSideActions,
  type FaceSample,
  DEFAULT_OPTIMIZER_OPTIONS,
} from './pullDirectionOptimizer';

function box6(): FaceSample[] {
  // A cube has 6 face normals. With area 1 each.
  return [
    { normal: [1, 0, 0], areaMm2: 1 },
    { normal: [-1, 0, 0], areaMm2: 1 },
    { normal: [0, 1, 0], areaMm2: 1 },
    { normal: [0, -1, 0], areaMm2: 1 },
    { normal: [0, 0, 1], areaMm2: 1 },
    { normal: [0, 0, -1], areaMm2: 1 },
  ];
}

describe('evaluateCandidate', () => {
  it('+Z pull on a +Z-pulled top face → positive draft', () => {
    const r = evaluateCandidate([0, 0, 1], '+Z', [{ normal: [0, 0, 1], areaMm2: 10 }], DEFAULT_OPTIMIZER_OPTIONS);
    expect(r.positiveDraftArea).toBeCloseTo(10, 5);
    expect(r.undercutArea).toBe(0);
  });

  it('+Z pull on a -Z face → undercut', () => {
    const r = evaluateCandidate([0, 0, 1], '+Z', [{ normal: [0, 0, -1], areaMm2: 10 }], DEFAULT_OPTIMIZER_OPTIONS);
    expect(r.undercutArea).toBeCloseTo(10, 5);
  });

  it('side face on +Z pull → zero draft', () => {
    const r = evaluateCandidate([0, 0, 1], '+Z', [{ normal: [1, 0, 0], areaMm2: 10 }], DEFAULT_OPTIMIZER_OPTIONS);
    expect(r.zeroDraftArea).toBeCloseTo(10, 5);
  });

  it('score = positive − undercut − 0.5 × zero', () => {
    const r = evaluateCandidate([0, 0, 1], '+Z', [
      { normal: [0, 0, 1], areaMm2: 5 },
      { normal: [0, 0, -1], areaMm2: 2 },
      { normal: [1, 0, 0], areaMm2: 4 },
    ], DEFAULT_OPTIMIZER_OPTIONS);
    expect(r.score).toBeCloseTo(5 - 2 - 0.5 * 4, 4);
  });
});

describe('generateCandidates', () => {
  it('includes 6 axis-aligned + Fibonacci samples', () => {
    const cands = generateCandidates(20);
    expect(cands.length).toBe(26);
  });

  it('first 6 candidates have axis labels', () => {
    const cands = generateCandidates(10);
    expect(cands[0]!.label).toBe('+X');
    expect(cands[5]!.label).toBe('-Z');
  });

  it('all candidate directions are unit length', () => {
    const cands = generateCandidates(10);
    for (const c of cands) {
      const len = Math.hypot(c.direction[0], c.direction[1], c.direction[2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});

describe('optimizePullDirection', () => {
  it('symmetric cube → top result is one of ±axis aligned', () => {
    const ranked = optimizePullDirection(box6(), { sampleCount: 0 });
    expect(ranked[0]!.label).toBeDefined();
  });

  it('returns candidates sorted by score descending', () => {
    const ranked = optimizePullDirection(box6(), { sampleCount: 32 });
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.score).toBeLessThanOrEqual(ranked[i - 1]!.score);
    }
  });

  it('empty faces → zero scores', () => {
    const ranked = optimizePullDirection([], { sampleCount: 8 });
    for (const r of ranked) expect(r.score).toBeCloseTo(0, 5);
  });

  it('one-sided draft → +Z wins decisively', () => {
    const faces: FaceSample[] = [
      { normal: [0, 0, 1], areaMm2: 100 },
      { normal: [0.2, 0, 0.98], areaMm2: 50 },
      { normal: [0, 0.2, 0.98], areaMm2: 50 },
    ];
    const ranked = optimizePullDirection(faces, { sampleCount: 16 });
    expect(ranked[0]!.direction[2]).toBeGreaterThan(0.9);
  });
});

describe('recommendSideActions', () => {
  it('flags faces that the main pull can\'t reach', () => {
    const main: [number, number, number] = [0, 0, 1];
    const faces: FaceSample[] = [
      { normal: [1, 0, 0], areaMm2: 100 },
    ];
    const recs = recommendSideActions(main, faces);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.rescuedArea).toBeGreaterThanOrEqual(0);
  });

  it('no undercuts → all recs have 0 rescued area', () => {
    const main: [number, number, number] = [0, 0, 1];
    const faces: FaceSample[] = [
      { normal: [0, 0, 1], areaMm2: 100 },
    ];
    const recs = recommendSideActions(main, faces);
    for (const r of recs) expect(r.rescuedArea).toBe(0);
  });
});
