import { describe, it, expect } from 'vitest';
import {
  buildVariableChamfer,
  evaluateProfile,
  computeStats,
  constantProfile,
  linearGrowthProfile,
  bumpProfile,
  type EdgePolyline,
  type ChamferProfile,
} from './edgeChamferVariable';

function straightEdge(length: number, samples: number): EdgePolyline {
  const points: Array<[number, number, number]> = [];
  const outward: Array<[number, number, number]> = [];
  const second: Array<[number, number, number]> = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    points.push([t * length, 0, 0]);
    outward.push([0, 1, 0]);
    second.push([0, 0, 1]);
  }
  return { points, outwardNormals: outward, secondNormals: second };
}

describe('buildVariableChamfer', () => {
  it('returns empty for degenerate edge', () => {
    const r = buildVariableChamfer(
      { points: [[0, 0, 0]], outwardNormals: [[0, 1, 0]], secondNormals: [[0, 0, 1]] },
      constantProfile(1),
      10,
    );
    expect(r.edgeSamples).toEqual([]);
  });

  it('produces requested sample count', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), constantProfile(1), 20);
    expect(r.edgeSamples).toHaveLength(20);
    expect(r.widths).toHaveLength(20);
  });

  it('constant profile yields equal widths', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), constantProfile(2), 10);
    for (const w of r.widths) {
      expect(w).toBeCloseTo(2, 5);
    }
  });

  it('linear growth profile yields monotonic widths', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), linearGrowthProfile(1, 5), 10);
    expect(r.widths[0]).toBeCloseTo(1, 5);
    expect(r.widths[r.widths.length - 1]).toBeCloseTo(5, 5);
    for (let i = 1; i < r.widths.length; i++) {
      expect(r.widths[i]!).toBeGreaterThanOrEqual(r.widths[i - 1]!);
    }
  });

  it('bump profile peaks in middle', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), bumpProfile(3), 11);
    const middle = r.widths[5]!;
    expect(middle).toBeGreaterThan(r.widths[0]!);
    expect(middle).toBeGreaterThan(r.widths[10]!);
  });

  it('triangle indices = (sampleCount - 1) × 2', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), constantProfile(1), 10);
    expect(r.indices.length).toBe(9 * 6);
  });

  it('sideA offset is along outward normal', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), constantProfile(2), 2);
    expect(r.sideA[0]![1]).toBeCloseTo(2, 5);
  });

  it('sideB offset is along second normal', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), constantProfile(2), 2);
    expect(r.sideB[0]![2]).toBeCloseTo(2, 5);
  });

  it('throws on negative width', () => {
    const profile: ChamferProfile = {
      anchors: [{ t: 0, widthMm: -1 }, { t: 1, widthMm: 1 }],
      interpolation: 'linear',
    };
    expect(() => buildVariableChamfer(straightEdge(10, 2), profile, 5)).toThrow();
  });

  it('throws when first anchor not at 0', () => {
    const profile: ChamferProfile = {
      anchors: [{ t: 0.1, widthMm: 1 }, { t: 1, widthMm: 1 }],
      interpolation: 'linear',
    };
    expect(() => buildVariableChamfer(straightEdge(10, 2), profile, 5)).toThrow();
  });
});

describe('evaluateProfile', () => {
  it('linear interpolation between two anchors', () => {
    const v = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'linear', 0.5);
    expect(v).toBeCloseTo(5, 5);
  });

  it('smooth interpolation differs from linear', () => {
    const lin = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'linear', 0.5);
    const smo = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'smooth', 0.5);
    expect(lin).toBe(5);
    expect(smo).toBe(5); // smoothstep(0.5) = 0.5
    const lin25 = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'linear', 0.25);
    const smo25 = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'smooth', 0.25);
    expect(smo25).toBeLessThan(lin25);
  });

  it('clamps t outside [0,1]', () => {
    const v = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'linear', -5);
    expect(v).toBeCloseTo(0, 5);
  });

  it('uses last anchor when t > last', () => {
    const v = evaluateProfile([{ t: 0, widthMm: 0 }, { t: 1, widthMm: 10 }], 'linear', 5);
    expect(v).toBeCloseTo(10, 5);
  });
});

describe('built-in profiles', () => {
  it('constantProfile has same width at both ends', () => {
    const p = constantProfile(3);
    expect(p.anchors[0]!.widthMm).toBe(3);
    expect(p.anchors[1]!.widthMm).toBe(3);
  });

  it('linearGrowthProfile starts and ends correctly', () => {
    const p = linearGrowthProfile(1, 5);
    expect(p.anchors[0]!.widthMm).toBe(1);
    expect(p.anchors[1]!.widthMm).toBe(5);
  });

  it('bumpProfile has 3 anchors', () => {
    const p = bumpProfile(5);
    expect(p.anchors).toHaveLength(3);
    expect(p.anchors[0]!.widthMm).toBe(0);
    expect(p.anchors[1]!.widthMm).toBe(5);
    expect(p.anchors[2]!.widthMm).toBe(0);
  });
});

describe('computeStats', () => {
  it('zero on empty strip', () => {
    const s = computeStats({ edgeSamples: [], sideA: [], sideB: [], widths: [], indices: [] });
    expect(s.sampleCount).toBe(0);
    expect(s.edgeLengthMm).toBe(0);
  });

  it('reports correct stats for constant chamfer', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), constantProfile(2), 5);
    const s = computeStats(r);
    expect(s.sampleCount).toBe(5);
    expect(s.minWidthMm).toBeCloseTo(2, 5);
    expect(s.maxWidthMm).toBeCloseTo(2, 5);
    expect(s.averageWidthMm).toBeCloseTo(2, 5);
    expect(s.edgeLengthMm).toBeCloseTo(10, 2);
  });

  it('reports min<max for variable chamfer', () => {
    const r = buildVariableChamfer(straightEdge(10, 2), linearGrowthProfile(1, 5), 10);
    const s = computeStats(r);
    expect(s.minWidthMm).toBeLessThan(s.maxWidthMm);
  });
});
