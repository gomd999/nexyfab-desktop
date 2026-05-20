import { describe, it, expect } from 'vitest';
import {
  compensateProbe,
  summarize,
  type MeasuredPoint,
} from './probeRadiusCompensation';

function planarPoints(): MeasuredPoint[] {
  const out: MeasuredPoint[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      out.push({
        id: `p${i}${j}`,
        center: { x: i, y: j, z: 3 }, // probe center 3mm above surface (z=0)
        surfaceNormal: { x: 0, y: 0, z: 1 },
      });
    }
  }
  return out;
}

describe('compensateProbe', () => {
  it('empty input → empty result', () => {
    const r = compensateProbe([]);
    expect(r.points).toEqual([]);
    expect(r.formErrorMm).toBe(0);
  });

  it('surface-normal mode shifts by probe radius', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 3 });
    for (const p of r.points) {
      expect(p.surfacePoint.z).toBeCloseTo(0, 5);
    }
  });

  it('zero probe radius → no shift', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 0 });
    for (const p of r.points) {
      expect(p.surfacePoint.z).toBeCloseTo(p.rawCenter.z, 5);
    }
  });

  it('records raw + compensated separately', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 3 });
    expect(r.points[0]!.rawCenter.z).toBe(3);
    expect(r.points[0]!.surfacePoint.z).toBeCloseTo(0, 5);
  });

  it('records applied normal', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 3 });
    expect(r.points[0]!.appliedNormal.z).toBeCloseTo(1, 5);
  });

  it('cluster-plane mode fits a plane', () => {
    const r = compensateProbe(planarPoints(), { mode: 'cluster-plane', probeRadiusMm: 3 });
    expect(r.fitPlane).toBeDefined();
  });

  it('cluster-plane mode without nominal normals works', () => {
    const noNormals = planarPoints().map(p => ({ ...p, surfaceNormal: undefined }));
    const r = compensateProbe(noNormals, { mode: 'cluster-plane', probeRadiusMm: 3 });
    expect(r.points).toHaveLength(25);
  });

  it('form error is non-negative', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 3 });
    expect(r.formErrorMm).toBeGreaterThanOrEqual(0);
  });

  it('flat input → near-zero form error', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 3 });
    expect(r.formErrorMm).toBeLessThan(0.001);
  });

  it('uneven cluster has nonzero form error', () => {
    const uneven: MeasuredPoint[] = [
      { id: 'a', center: { x: 0, y: 0, z: 3 }, surfaceNormal: { x: 0, y: 0, z: 1 } },
      { id: 'b', center: { x: 1, y: 0, z: 3.5 }, surfaceNormal: { x: 0, y: 0, z: 1 } },
      { id: 'c', center: { x: 0, y: 1, z: 2.5 }, surfaceNormal: { x: 0, y: 0, z: 1 } },
      { id: 'd', center: { x: 1, y: 1, z: 4 }, surfaceNormal: { x: 0, y: 0, z: 1 } },
    ];
    const r = compensateProbe(uneven, { probeRadiusMm: 3 });
    expect(r.formErrorMm).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = compensateProbe([]);
    const s = summarize(r, 3);
    expect(s.pointCount).toBe(0);
    expect(s.averageShiftMm).toBe(0);
  });

  it('average shift = probe radius for planar case', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 3 });
    const s = summarize(r, 3);
    expect(s.averageShiftMm).toBeCloseTo(3, 3);
  });

  it('reports probe radius', () => {
    const r = compensateProbe(planarPoints(), { probeRadiusMm: 2 });
    const s = summarize(r, 2);
    expect(s.probeRadiusMm).toBe(2);
  });
});
