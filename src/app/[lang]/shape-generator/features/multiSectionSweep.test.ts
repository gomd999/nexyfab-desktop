import { describe, it, expect } from 'vitest';
import {
  lofted,
  resampleSection,
  interpolateSection,
  analyzeCompatibility,
  type SectionProfile,
  type SweepSpine,
  type GuideCurve,
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

// ── Guide-curve reflection (multi-guide) ────────────────────────

const zSpine: SweepSpine = {
  samples: [
    { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
    { t: 1, position: { x: 0, y: 0, z: 50 }, tangent: { x: 0, y: 0, z: 1 } },
  ],
};

/** Max/min of a component across a single ring's vertices. */
function ringComponentRange(
  positions: Float32Array,
  ring: number,
  profileCount: number,
  comp: 0 | 1 | 2,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  const base = ring * profileCount * 3;
  for (let p = 0; p < profileCount; p++) {
    const v = positions[base + p * 3 + comp]!;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max };
}

describe('lofted — guide-curve reflection', () => {
  it('a single guide pulls each station toward the rail (in-plane translation)', () => {
    // Rail shares the spine Z (offset is purely in-plane +X), growing 0 → 40.
    const rail: GuideCurve = {
      id: 'rail',
      samples: [
        { t: 0, position: { x: 0, y: 0, z: 0 } },
        { t: 1, position: { x: 40, y: 0, z: 50 } },
      ],
    };
    const withGuide = lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [rail], { stationCount: 8 });
    const noGuide = lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [], { stationCount: 8 });

    const pc = withGuide.profilePointCount;
    const lastWith = ringComponentRange(withGuide.positions, withGuide.stationCount - 1, pc, 0);
    const lastNo = ringComponentRange(noGuide.positions, noGuide.stationCount - 1, pc, 0);
    // Section is a unit square, so without a guide the last ring spans X∈[-1,1];
    // with the rail it is shifted by ≈ +40 → X∈[39,41].
    expect(lastNo.max).toBeCloseTo(1, 5);
    expect(lastWith.min).toBeCloseTo(39, 4);
    expect(lastWith.max).toBeCloseTo(41, 4);
    // First ring (t=0, rail offset 0) is untouched.
    const firstWith = ringComponentRange(withGuide.positions, 0, pc, 0);
    expect(firstWith.max).toBeCloseTo(1, 5);
  });

  it('leaves geometry identical to the no-guide path when guides is empty', () => {
    const a = lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [], { stationCount: 8 });
    const b = lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, undefined, { stationCount: 8 });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it('a second guide drives a uniform section scale from the rail spacing ratio', () => {
    // guide0 coincides with the spine (no translation); guide1 spacing grows
    // 10 → 30, so the section scale runs 1 → 3.
    const g0: GuideCurve = {
      id: 'g0',
      samples: [{ t: 0, position: { x: 0, y: 0, z: 0 } }, { t: 1, position: { x: 0, y: 0, z: 50 } }],
    };
    const g1: GuideCurve = {
      id: 'g1',
      samples: [{ t: 0, position: { x: 10, y: 0, z: 0 } }, { t: 1, position: { x: 30, y: 0, z: 50 } }],
    };
    const r = lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [g0, g1], { stationCount: 8 });
    const pc = r.profilePointCount;
    const first = ringComponentRange(r.positions, 0, pc, 1);
    const last = ringComponentRange(r.positions, r.stationCount - 1, pc, 1);
    // Unit square in Y: first ring ×1 → [-1,1], last ring ×3 → [-3,3].
    expect(last.max).toBeCloseTo(3, 4);
    expect(first.max).toBeCloseTo(1, 4);
  });

  it('throws on a guide with fewer than 2 samples', () => {
    const bad: GuideCurve = { id: 'bad', samples: [{ t: 0, position: { x: 0, y: 0, z: 0 } }] };
    expect(() => lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [bad])).toThrow(/at least 2 samples/);
  });

  it('throws on a non-finite guide sample', () => {
    const bad: GuideCurve = {
      id: 'nan',
      samples: [{ t: 0, position: { x: 0, y: 0, z: 0 } }, { t: 1, position: { x: NaN, y: 0, z: 50 } }],
    };
    expect(() => lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [bad])).toThrow(/non-finite/);
  });

  it('throws when the first two guides coincide at t=0 (no scale reference)', () => {
    const g0: GuideCurve = {
      id: 'g0',
      samples: [{ t: 0, position: { x: 5, y: 0, z: 0 } }, { t: 1, position: { x: 5, y: 0, z: 50 } }],
    };
    const g1: GuideCurve = {
      id: 'g1',
      samples: [{ t: 0, position: { x: 5, y: 0, z: 0 } }, { t: 1, position: { x: 20, y: 0, z: 50 } }],
    };
    expect(() => lofted([squareSection('a', 0), squareSection('b', 1)], zSpine, [g0, g1])).toThrow(/coincide/);
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
