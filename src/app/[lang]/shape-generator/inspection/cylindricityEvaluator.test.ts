import { describe, it, expect } from 'vitest';
import {
  evaluate,
  decompose,
  summarize,
  type Point3D,
} from './cylindricityEvaluator';

function perfectCylinder(radius: number, sections = 5, perSection = 12): Point3D[] {
  const pts: Point3D[] = [];
  for (let s = 0; s < sections; s++) {
    const z = s * 10;
    for (let a = 0; a < perSection; a++) {
      const t = (a * 2 * Math.PI) / perSection;
      pts.push({ x: radius * Math.cos(t), y: radius * Math.sin(t), z });
    }
  }
  return pts;
}

function taperedCylinder(r0: number, drPerZ: number, sections = 5, perSection = 12): Point3D[] {
  const pts: Point3D[] = [];
  for (let s = 0; s < sections; s++) {
    const z = s * 10;
    const r = r0 + drPerZ * z;
    for (let a = 0; a < perSection; a++) {
      const t = (a * 2 * Math.PI) / perSection;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t), z });
    }
  }
  return pts;
}

describe('evaluate', () => {
  it('perfect cylinder → near-zero cylindricity', () => {
    const r = evaluate({ points: perfectCylinder(10), toleranceMm: 0.05 });
    expect(r.cylindricityMm).toBeCloseTo(0, 5);
    expect(r.passed).toBe(true);
  });

  it('fitted radius ≈ nominal', () => {
    const r = evaluate({ points: perfectCylinder(10), toleranceMm: 0.05 });
    expect(r.fittedRadiusMm).toBeCloseTo(10, 4);
  });

  it('tapered cylinder → cylindricity = radius span', () => {
    const r = evaluate({ points: taperedCylinder(10, 0.01), toleranceMm: 1 });
    // z span 40, dr/dz 0.01 → 0.4
    expect(r.cylindricityMm).toBeCloseTo(0.4, 4);
  });

  it('exceeds tolerance → fail', () => {
    const r = evaluate({ points: taperedCylinder(10, 0.05), toleranceMm: 0.5 });
    expect(r.passed).toBe(false);
  });

  it('axis offset removed by centre-line fit', () => {
    // shift entire cylinder centre by (5, -3): still perfect cylinder
    const pts = perfectCylinder(10).map(p => ({ x: p.x + 5, y: p.y - 3, z: p.z }));
    const r = evaluate({ points: pts, toleranceMm: 0.05 });
    expect(r.cylindricityMm).toBeCloseTo(0, 4);
  });

  it('tilted axis recovered (low cylindricity)', () => {
    // tilt the centre-line: cx = 0.02·z
    const pts = perfectCylinder(10).map(p => ({ x: p.x + 0.02 * p.z, y: p.y, z: p.z }));
    const r = evaluate({ points: pts, toleranceMm: 0.05 });
    expect(r.axisTiltMmPerMm).toBeGreaterThan(0);
    expect(r.cylindricityMm).toBeCloseTo(0, 3);
  });

  it('too few points → warning', () => {
    const r = evaluate({ points: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], toleranceMm: 0.1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('empty points → zero, no crash', () => {
    const r = evaluate({ points: [], toleranceMm: 0.1 });
    expect(r.cylindricityMm).toBe(0);
  });
});

describe('decompose', () => {
  it('perfect cylinder → near-zero roundness + straightness', () => {
    const d = decompose({ points: perfectCylinder(10), toleranceMm: 0.05 }, 10);
    expect(d.roundnessMm).toBeCloseTo(0, 4);
    expect(d.straightnessMm).toBeCloseTo(0, 4);
  });

  it('bent axis → non-zero straightness', () => {
    // shift centres progressively with z (bow)
    const pts = perfectCylinder(10).map(p => ({ x: p.x + 0.1 * p.z, y: p.y, z: p.z }));
    const d = decompose({ points: pts, toleranceMm: 0.05 }, 10);
    expect(d.straightnessMm).toBeGreaterThan(0);
  });

  it('lobed section → non-zero roundness', () => {
    // add a 3-lobe perturbation
    const pts: Point3D[] = [];
    for (let s = 0; s < 5; s++) {
      const z = s * 10;
      for (let a = 0; a < 24; a++) {
        const t = (a * 2 * Math.PI) / 24;
        const r = 10 + 0.1 * Math.cos(3 * t);
        pts.push({ x: r * Math.cos(t), y: r * Math.sin(t), z });
      }
    }
    const d = decompose({ points: pts, toleranceMm: 0.05 }, 10);
    expect(d.roundnessMm).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports pass + cylindricity', () => {
    const r = evaluate({ points: perfectCylinder(10), toleranceMm: 0.05 });
    const s = summarize(r);
    expect(s.passed).toBe(true);
    expect(s.cylindricityMm).toBe(r.cylindricityMm);
  });
});
