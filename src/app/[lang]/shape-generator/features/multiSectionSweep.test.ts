import { describe, it, expect } from 'vitest';
import {
  lofted,
  resampleSection,
  interpolateSection,
  analyzeCompatibility,
  type SectionProfile,
  type SweepSpine,
} from './multiSectionSweep';

function squareSection(id: string, spineParam: number, size = 1): SectionProfile {
  return {
    id, spineParam,
    points2D: [
      { x: -size, y: -size }, { x: size, y: -size },
      { x: size, y: size }, { x: -size, y: size },
    ],
  };
}

function circleSection(id: string, spineParam: number, n = 8, r = 1): SectionProfile {
  const points2D = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    points2D.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return { id, spineParam, points2D };
}

describe('lofted', () => {
  it('warns when fewer than 2 sections', () => {
    const r = lofted([squareSection('a', 0)], null);
    expect(r.warnings.some(w => w.includes('at least 2'))).toBe(true);
    expect(r.positions.length).toBe(0);
  });

  it('2 sections → produces a mesh', () => {
    const r = lofted([squareSection('a', 0), squareSection('b', 1)], null);
    expect(r.positions.length).toBeGreaterThan(0);
    expect(r.indices.length).toBeGreaterThan(0);
    expect(r.stationCount).toBeGreaterThan(0);
  });

  it('default 32 stations', () => {
    const r = lofted([squareSection('a', 0), squareSection('b', 1)], null);
    expect(r.stationCount).toBe(32);
  });

  it('custom stationCount honored', () => {
    const r = lofted([squareSection('a', 0), squareSection('b', 1)], null, [], { stationCount: 16 });
    expect(r.stationCount).toBe(16);
  });

  it('profilePointCount = max input section count', () => {
    const r = lofted([circleSection('a', 0, 6), circleSection('b', 1, 12)], null);
    expect(r.profilePointCount).toBe(12);
  });

  it('endcap geometry adds extra triangles when enabled', () => {
    const open = lofted([squareSection('a', 0), squareSection('b', 1)], null, [], { capEnds: false });
    const closed = lofted([squareSection('a', 0), squareSection('b', 1)], null, [], { capEnds: true });
    expect(closed.indices.length).toBeGreaterThan(open.indices.length);
  });

  it('spine-driven sweep uses spine sample positions', () => {
    const spine: SweepSpine = {
      samples: [
        { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
        { t: 1, position: { x: 0, y: 0, z: 50 }, tangent: { x: 0, y: 0, z: 1 } },
      ],
    };
    const r = lofted([squareSection('a', 0), squareSection('b', 1)], spine);
    expect(r.positions.length).toBeGreaterThan(0);
    // First ring should have z ≈ 0, last ring z ≈ 50.
    const profileCount = r.profilePointCount;
    const lastRingFirst = (r.stationCount - 1) * profileCount;
    expect(r.positions[lastRingFirst * 3 + 2]).toBeCloseTo(50, 0);
  });
});

describe('resampleSection', () => {
  it('returns same count when already matching', () => {
    const s = squareSection('a', 0);
    const r = resampleSection(s, 4);
    expect(r.points2D).toHaveLength(4);
  });

  it('upsamples to higher count', () => {
    const s = squareSection('a', 0);
    const r = resampleSection(s, 16);
    expect(r.points2D).toHaveLength(16);
  });

  it('applies twist when present', () => {
    const s: SectionProfile = {
      id: 'a', spineParam: 0,
      points2D: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
      twistRad: Math.PI / 2,
    };
    const r = resampleSection(s, 4);
    // First point (1, 0) rotated 90° → (0, 1).
    expect(r.points2D[0]!.x).toBeCloseTo(0, 5);
    expect(r.points2D[0]!.y).toBeCloseTo(1, 5);
  });

  it('applies scale when present', () => {
    const s: SectionProfile = {
      id: 'a', spineParam: 0,
      points2D: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
      scale: 2,
    };
    const r = resampleSection(s, 4);
    expect(Math.hypot(r.points2D[0]!.x, r.points2D[0]!.y)).toBeCloseTo(2, 5);
  });
});

describe('interpolateSection', () => {
  it('returns first section when t=0', () => {
    const sections = [squareSection('a', 0), squareSection('b', 1, 5)];
    const r = interpolateSection(sections, 0, 'linear');
    expect(r[0]!.x).toBe(-1);
  });

  it('returns second section at t=1', () => {
    const sections = [squareSection('a', 0, 1), squareSection('b', 1, 5)];
    const r = interpolateSection(sections, 1, 'linear');
    expect(r[0]!.x).toBe(-5);
  });

  it('midpoint = average of two at t=0.5', () => {
    const sections = [squareSection('a', 0, 1), squareSection('b', 1, 3)];
    const r = interpolateSection(sections, 0.5, 'linear');
    expect(Math.abs(r[0]!.x)).toBeCloseTo(2, 5);
  });

  it('single section returns its points', () => {
    const sections = [squareSection('a', 0)];
    const r = interpolateSection(sections, 0.5, 'linear');
    expect(r).toHaveLength(4);
  });
});

describe('analyzeCompatibility', () => {
  it('detects matching vertex counts', () => {
    const r = analyzeCompatibility([squareSection('a', 0), squareSection('b', 1)]);
    expect(r.sameVertexCount).toBe(true);
  });

  it('detects mismatched vertex counts', () => {
    const r = analyzeCompatibility([squareSection('a', 0), circleSection('b', 1, 12)]);
    expect(r.sameVertexCount).toBe(false);
    expect(r.suggestedCount).toBe(12);
  });

  it('flags wildly-different perimeter', () => {
    const tiny = squareSection('tiny', 0, 0.01);
    const huge = squareSection('huge', 1, 1000);
    const r = analyzeCompatibility([tiny, huge]);
    expect(r.wildlyDifferentSections.length).toBeGreaterThan(0);
  });
});
