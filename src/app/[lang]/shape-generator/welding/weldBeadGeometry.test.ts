import { describe, it, expect } from 'vitest';
import {
  beadCrossSection,
  crossSectionAreaMm2,
  generateBeadGeometry,
  hazWidthMm,
  suggestBeadOverlap,
} from './weldBeadGeometry';

describe('beadCrossSection', () => {
  it('fillet returns triangle with legs = size', () => {
    const v = beadCrossSection('fillet', { sizeMm: 5 });
    expect(v).toHaveLength(3);
    expect(v).toContainEqual([0, 0]);
    expect(v).toContainEqual([5, 0]);
    expect(v).toContainEqual([0, 5]);
  });

  it('v-groove is diamond', () => {
    const v = beadCrossSection('v-groove', { sizeMm: 6 });
    expect(v).toHaveLength(4);
  });

  it('plug is 8-gon', () => {
    const v = beadCrossSection('plug', { sizeMm: 4 });
    expect(v).toHaveLength(8);
  });

  it('surfacing is wide rectangle', () => {
    const v = beadCrossSection('surfacing', { sizeMm: 3 });
    expect(v).toHaveLength(4);
    // Width = 2·size = 6.
    const xs = v.map(p => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 5);
  });
});

describe('crossSectionAreaMm2', () => {
  it('fillet area = size²/2', () => {
    expect(crossSectionAreaMm2('fillet', { sizeMm: 5 })).toBeCloseTo(12.5, 6);
  });

  it('square-butt area ≈ size × (size/3 + reinf)', () => {
    const area = crossSectionAreaMm2('square-butt', { sizeMm: 6, reinforcementMm: 0 });
    expect(area).toBeCloseTo(6 * 2, 5); // 6 × 6/3 = 12
  });

  it('larger size → larger area', () => {
    expect(crossSectionAreaMm2('fillet', { sizeMm: 10 })).toBeGreaterThan(
      crossSectionAreaMm2('fillet', { sizeMm: 5 }),
    );
  });
});

describe('generateBeadGeometry', () => {
  it('returns empty for single-point path', () => {
    const r = generateBeadGeometry(
      { points: [[0, 0, 0]] },
      'fillet',
      { sizeMm: 5 },
    );
    expect(r.triangleCount).toBe(0);
  });

  it('triangle count = 2 × crossSection × (N-1) for fillet (3 verts)', () => {
    const r = generateBeadGeometry(
      { points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] },
      'fillet',
      { sizeMm: 5 },
    );
    // 3 cross-section verts × 2 quads/cs-edge × 2 strip-segments = 12 tris.
    expect(r.triangleCount).toBe(2 * 3 * 2);
  });

  it('volume = area × length', () => {
    const r = generateBeadGeometry(
      { points: [[0, 0, 0], [10, 0, 0]] },
      'fillet',
      { sizeMm: 4 },
    );
    // area = 8 mm², length = 10 mm → volume = 80 mm³.
    expect(r.volumeMm3).toBeCloseTo(80, 5);
  });

  it('every index references a valid vertex', () => {
    const r = generateBeadGeometry(
      { points: [[0, 0, 0], [5, 0, 0], [10, 0, 0]] },
      'plug',
      { sizeMm: 2 },
    );
    const vc = r.positions.length / 3;
    for (const i of r.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(vc);
    }
  });
});

describe('hazWidthMm', () => {
  it('grows with current', () => {
    const lo = hazWidthMm(100, 20, 5);
    const hi = hazWidthMm(300, 20, 5);
    expect(hi).toBeGreaterThan(lo);
  });

  it('shrinks with faster travel', () => {
    const slow = hazWidthMm(200, 20, 2);
    const fast = hazWidthMm(200, 20, 10);
    expect(fast).toBeLessThan(slow);
  });

  it('zero for zero travel speed (avoid div-zero)', () => {
    expect(hazWidthMm(200, 20, 0)).toBe(0);
  });
});

describe('suggestBeadOverlap', () => {
  it('30% for thin plate', () => {
    expect(suggestBeadOverlap(10, 3)).toBeCloseTo(3, 5);
  });

  it('50% for thick plate', () => {
    expect(suggestBeadOverlap(10, 12)).toBeCloseTo(5, 5);
  });
});
