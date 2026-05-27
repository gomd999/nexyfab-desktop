import { describe, it, expect } from 'vitest';
import {
  recommendBendRelief,
  buildBendReliefGeometry,
  buildCornerGussetFootprint,
  reliefArea,
} from './gussetLibrary';

describe('recommendBendRelief', () => {
  it('picks round for thin sheet', () => {
    const r = recommendBendRelief(1.0, 1.0);
    expect(r.shape).toBe('round');
  });

  it('picks tear for thick sheet', () => {
    const r = recommendBendRelief(3.0, 2.0);
    expect(r.shape).toBe('tear');
  });

  it('honors user preference', () => {
    const r = recommendBendRelief(1.0, 1.0, 'square');
    expect(r.shape).toBe('square');
    expect(r.rationale).toMatch(/preference/);
  });

  it('depth scales with thickness + radius', () => {
    const thin = recommendBendRelief(1.0, 1.0);
    const thick = recommendBendRelief(3.0, 2.0);
    expect(thick.depthMm).toBeGreaterThan(thin.depthMm);
  });
});

describe('buildBendReliefGeometry', () => {
  it('square produces 4 corners', () => {
    const g = buildBendReliefGeometry({ shape: 'square', widthMm: 2, depthMm: 2 });
    expect(g.cutout).toHaveLength(4);
  });

  it('tear produces 3 points (V)', () => {
    const g = buildBendReliefGeometry({ shape: 'tear', widthMm: 2, depthMm: 2 });
    expect(g.cutout).toHaveLength(3);
  });

  it('round produces an arc with > 10 points', () => {
    const g = buildBendReliefGeometry({ shape: 'round', widthMm: 2, depthMm: 2 });
    expect(g.cutout.length).toBeGreaterThan(10);
  });
});

describe('buildCornerGussetFootprint', () => {
  it('returns a quad shape', () => {
    const f = buildCornerGussetFootprint({ legMm: 10, heightMm: 5, thicknessMm: 1 });
    expect(f).toHaveLength(4);
  });

  it('legs are placed at origin', () => {
    const f = buildCornerGussetFootprint({ legMm: 10, heightMm: 5, thicknessMm: 1 }, [5, 5]);
    expect(f[0]).toEqual([5, 5]);
    expect(f[1]).toEqual([15, 5]);
  });
});

describe('reliefArea', () => {
  it('square is width × depth', () => {
    expect(reliefArea({ shape: 'square', widthMm: 2, depthMm: 3 })).toBe(6);
  });

  it('tear is half of square (triangle)', () => {
    expect(reliefArea({ shape: 'tear', widthMm: 2, depthMm: 3 })).toBe(3);
  });

  it('round is positive', () => {
    expect(reliefArea({ shape: 'round', widthMm: 2, depthMm: 3 })).toBeGreaterThan(0);
  });
});
