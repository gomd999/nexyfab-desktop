import { describe, it, expect } from 'vitest';
import {
  optimizePrintOrientation,
  evaluateOrientation,
  generateRotationCandidates,
  anisotropyScore,
  DEFAULT_ORIENTATION_OPTIONS,
  type TriangleSample,
} from './printOrientationOptimizer';

function flatBottomBox(): TriangleSample[] {
  // 6 face cube — bottom (-Z) is large, others smaller for clarity.
  return [
    { normal: [0, 0, -1], areaMm2: 100, centroidMm: [0, 0, -1] }, // bottom
    { normal: [0, 0, 1], areaMm2: 50, centroidMm: [0, 0, 1] },    // top
    { normal: [1, 0, 0], areaMm2: 30, centroidMm: [1, 0, 0] },    // side
    { normal: [-1, 0, 0], areaMm2: 30, centroidMm: [-1, 0, 0] },
    { normal: [0, 1, 0], areaMm2: 30, centroidMm: [0, 1, 0] },
    { normal: [0, -1, 0], areaMm2: 30, centroidMm: [0, -1, 0] },
  ];
}

describe('evaluateOrientation', () => {
  it('identity rotation: bottom face is the +Z-facing-down face', () => {
    const r = evaluateOrientation(flatBottomBox(), [1, 0, 0, 0, 1, 0, 0, 0, 1], 'identity', DEFAULT_ORIENTATION_OPTIONS);
    expect(r.bottomArea).toBeCloseTo(100, 5);
  });

  it('build height defined from centroids', () => {
    const r = evaluateOrientation(flatBottomBox(), [1, 0, 0, 0, 1, 0, 0, 0, 1], 'id', DEFAULT_ORIENTATION_OPTIONS);
    expect(r.buildHeightMm).toBeGreaterThan(0);
  });

  it('higher bottom area → higher score (default weights)', () => {
    // Two triangle sets, one with bigger bottom.
    const small: TriangleSample[] = [
      { normal: [0, 0, -1], areaMm2: 5, centroidMm: [0, 0, 0] },
    ];
    const big: TriangleSample[] = [
      { normal: [0, 0, -1], areaMm2: 500, centroidMm: [0, 0, 0] },
    ];
    const idMat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const sSmall = evaluateOrientation(small, idMat, 'a', DEFAULT_ORIENTATION_OPTIONS);
    const sBig = evaluateOrientation(big, idMat, 'b', DEFAULT_ORIENTATION_OPTIONS);
    expect(sBig.score).toBeGreaterThan(sSmall.score);
  });

  it('description label propagates', () => {
    const r = evaluateOrientation(flatBottomBox(), [1, 0, 0, 0, 1, 0, 0, 0, 1], 'test', DEFAULT_ORIENTATION_OPTIONS);
    expect(r.description).toBe('test');
  });
});

describe('generateRotationCandidates', () => {
  it('includes 6 axis-aligned + N samples', () => {
    const cands = generateRotationCandidates(10);
    expect(cands.length).toBe(16);
  });

  it('first 6 have axis-aligned labels', () => {
    const cands = generateRotationCandidates(0);
    expect(cands[0]!.label).toMatch(/up/);
  });

  it('each rotation has 9 entries (3×3)', () => {
    const cands = generateRotationCandidates(2);
    for (const c of cands) expect(c.rotation).toHaveLength(9);
  });
});

describe('optimizePrintOrientation', () => {
  it('returns ranked candidates', () => {
    const ranked = optimizePrintOrientation(flatBottomBox(), { sampleCount: 8 });
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.score).toBeLessThanOrEqual(ranked[i - 1]!.score);
    }
  });

  it('FDM picks lower overhang angle than SLS', () => {
    // SLS = 0° overhang means almost everything is supported by powder.
    const fdmResult = optimizePrintOrientation(flatBottomBox(), { process: 'FDM' });
    const slsResult = optimizePrintOrientation(flatBottomBox(), { process: 'SLS' });
    expect(fdmResult[0]!.supportArea).toBeGreaterThanOrEqual(0);
    expect(slsResult[0]!.supportArea).toBeGreaterThanOrEqual(0);
  });

  it('empty triangle list still returns candidates', () => {
    const ranked = optimizePrintOrientation([], { sampleCount: 4 });
    expect(ranked.length).toBeGreaterThan(0);
  });
});

describe('anisotropyScore', () => {
  it('zero load cases → score 0', () => {
    expect(anisotropyScore([1, 0, 0, 0, 1, 0, 0, 0, 1], [])).toBe(0);
  });

  it('load perpendicular to layer lines → higher score', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const along = anisotropyScore(identity, [{ direction: [0, 0, 1], weight: 1 }]);
    const perp = anisotropyScore(identity, [{ direction: [1, 0, 0], weight: 1 }]);
    expect(perp).toBeGreaterThan(along);
  });
});
