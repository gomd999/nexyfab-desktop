import { describe, it, expect } from 'vitest';
import {
  buildHelicalGear,
  buildStraightBevelGear,
  meshStats,
  pitchInfo,
} from './helicalBevelGears';

describe('buildHelicalGear', () => {
  it('produces non-empty mesh', () => {
    const m = buildHelicalGear({
      module: 2,
      teeth: 12,
      helixAngleDeg: 15,
      faceWidthMm: 10,
      axialSlices: 4,
      flankSamples: 4,
    });
    expect(m.positions.length).toBeGreaterThan(0);
    expect(m.indices.length).toBeGreaterThan(0);
  });

  it('positions divisible by 3', () => {
    const m = buildHelicalGear({
      module: 2, teeth: 12, helixAngleDeg: 15, faceWidthMm: 10, axialSlices: 4, flankSamples: 4,
    });
    expect(m.positions.length % 3).toBe(0);
  });

  it('indices divisible by 3', () => {
    const m = buildHelicalGear({
      module: 2, teeth: 12, helixAngleDeg: 15, faceWidthMm: 10, axialSlices: 4, flankSamples: 4,
    });
    expect(m.indices.length % 3).toBe(0);
  });

  it('helix angle 0 = spur (z spread equals face width)', () => {
    const m = buildHelicalGear({
      module: 2, teeth: 12, helixAngleDeg: 0, faceWidthMm: 10, axialSlices: 3, flankSamples: 3,
    });
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 2; i < m.positions.length; i += 3) {
      zMin = Math.min(zMin, m.positions[i]!);
      zMax = Math.max(zMax, m.positions[i]!);
    }
    expect(zMax - zMin).toBeCloseTo(10, 1);
  });

  it('more teeth → more vertices', () => {
    const a = buildHelicalGear({
      module: 2, teeth: 8, helixAngleDeg: 10, faceWidthMm: 10, axialSlices: 3, flankSamples: 3,
    });
    const b = buildHelicalGear({
      module: 2, teeth: 24, helixAngleDeg: 10, faceWidthMm: 10, axialSlices: 3, flankSamples: 3,
    });
    expect(b.positions.length).toBeGreaterThan(a.positions.length);
  });

  it('larger module → larger bbox', () => {
    const a = buildHelicalGear({
      module: 1, teeth: 12, helixAngleDeg: 10, faceWidthMm: 10, axialSlices: 3, flankSamples: 3,
    });
    const b = buildHelicalGear({
      module: 4, teeth: 12, helixAngleDeg: 10, faceWidthMm: 10, axialSlices: 3, flankSamples: 3,
    });
    const statsA = meshStats(a);
    const statsB = meshStats(b);
    expect(statsB.bbox.max[0]).toBeGreaterThan(statsA.bbox.max[0]);
  });
});

describe('buildStraightBevelGear', () => {
  it('produces non-empty mesh', () => {
    const m = buildStraightBevelGear({
      module: 2, teeth: 12, pitchConeAngleDeg: 45, faceWidthMm: 8, slices: 3, flankSamples: 3,
    });
    expect(m.positions.length).toBeGreaterThan(0);
  });

  it('positions divisible by 3', () => {
    const m = buildStraightBevelGear({
      module: 2, teeth: 12, pitchConeAngleDeg: 45, faceWidthMm: 8, slices: 3, flankSamples: 3,
    });
    expect(m.positions.length % 3).toBe(0);
  });

  it('larger cone angle yields more axial spread', () => {
    const a = buildStraightBevelGear({
      module: 2, teeth: 12, pitchConeAngleDeg: 20, faceWidthMm: 8, slices: 3, flankSamples: 3,
    });
    const b = buildStraightBevelGear({
      module: 2, teeth: 12, pitchConeAngleDeg: 70, faceWidthMm: 8, slices: 3, flankSamples: 3,
    });
    const sa = meshStats(a);
    const sb = meshStats(b);
    expect(sa.bbox.max[2] - sa.bbox.min[2]).toBeGreaterThan(sb.bbox.max[2] - sb.bbox.min[2]);
  });
});

describe('meshStats', () => {
  it('handles empty mesh', () => {
    const s = meshStats({ positions: [], indices: [] });
    expect(s.vertexCount).toBe(0);
    expect(s.triangleCount).toBe(0);
  });

  it('vertex count = positions / 3', () => {
    const s = meshStats({ positions: [1, 2, 3, 4, 5, 6], indices: [0, 1, 2] });
    expect(s.vertexCount).toBe(2);
    expect(s.triangleCount).toBe(1);
  });

  it('bbox computed correctly', () => {
    const s = meshStats({ positions: [0, 0, 0, 5, 7, 9, -1, -2, -3], indices: [] });
    expect(s.bbox.min).toEqual([-1, -2, -3]);
    expect(s.bbox.max).toEqual([5, 7, 9]);
  });
});

describe('pitchInfo', () => {
  it('pitch radius = module × teeth / 2', () => {
    const p = pitchInfo(2, 20);
    expect(p.pitchRadiusMm).toBe(20);
  });

  it('base radius = pitch × cos(α)', () => {
    const p = pitchInfo(2, 20, 20);
    expect(p.baseRadiusMm).toBeCloseTo(20 * Math.cos((20 * Math.PI) / 180), 5);
  });

  it('outer = pitch + module', () => {
    const p = pitchInfo(3, 16);
    expect(p.outerRadiusMm).toBe(p.pitchRadiusMm + 3);
  });

  it('root = pitch - 1.25 × module', () => {
    const p = pitchInfo(3, 16);
    expect(p.rootRadiusMm).toBeCloseTo(p.pitchRadiusMm - 1.25 * 3, 5);
  });

  it('circular pitch = π × module', () => {
    const p = pitchInfo(2, 20);
    expect(p.circularPitchMm).toBeCloseTo(Math.PI * 2, 5);
  });
});
