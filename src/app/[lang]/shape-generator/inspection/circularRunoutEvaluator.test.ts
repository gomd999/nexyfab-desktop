import { describe, it, expect } from 'vitest';
import {
  evaluate,
  fitEccentricity,
  summarize,
  type SectionMeasurements,
} from './circularRunoutEvaluator';

function perfectCircleSection(axial: number, radius: number, n: number = 12): SectionMeasurements {
  return {
    axialPositionMm: axial,
    readings: Array.from({ length: n }, (_, i) => ({
      angleDeg: (i * 360) / n,
      radiusMm: radius,
    })),
  };
}

function eccentricSection(axial: number, baseR: number, ecc: number, phaseDeg: number, n: number = 12): SectionMeasurements {
  return {
    axialPositionMm: axial,
    readings: Array.from({ length: n }, (_, i) => {
      const angleDeg = (i * 360) / n;
      const t = (angleDeg - phaseDeg) * Math.PI / 180;
      return { angleDeg, radiusMm: baseR + ecc * Math.cos(t) };
    }),
  };
}

describe('evaluate', () => {
  it('perfect circle → zero runout', () => {
    const r = evaluate({
      sections: [perfectCircleSection(0, 10)],
      toleranceMm: 0.05,
    });
    expect(r.worstRunoutMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('eccentric section → runout = 2 × eccentricity', () => {
    const r = evaluate({
      sections: [eccentricSection(0, 10, 0.05, 0)],
      toleranceMm: 0.2,
    });
    expect(r.worstRunoutMm).toBeCloseTo(0.1, 5);
    expect(r.passed).toBe(true);
  });

  it('exceeds tolerance → fail', () => {
    const r = evaluate({
      sections: [eccentricSection(0, 10, 0.5, 0)],
      toleranceMm: 0.5,
    });
    expect(r.passed).toBe(false);
  });

  it('worst section identified', () => {
    const r = evaluate({
      sections: [
        eccentricSection(0, 10, 0.01, 0),
        eccentricSection(50, 10, 0.5, 0),
        eccentricSection(100, 10, 0.01, 0),
      ],
      toleranceMm: 5.0,
    });
    expect(r.worstSectionAxialMm).toBe(50);
  });

  it('empty sections → warning', () => {
    const r = evaluate({ sections: [], toleranceMm: 0.1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('high spot angle ≈ phase', () => {
    const r = evaluate({
      sections: [eccentricSection(0, 10, 0.1, 90)],
      toleranceMm: 1,
    });
    expect(r.perSection[0]!.highSpotAngleDeg).toBeCloseTo(90, 0);
  });

  it('low spot angle 180° from high spot', () => {
    const r = evaluate({
      sections: [eccentricSection(0, 10, 0.1, 0, 24)],
      toleranceMm: 1,
    });
    const diff = Math.abs(r.perSection[0]!.highSpotAngleDeg - r.perSection[0]!.lowSpotAngleDeg);
    expect(diff).toBeCloseTo(180, 0);
  });

  it('empty readings produce zero runout (no crash)', () => {
    const r = evaluate({
      sections: [{ axialPositionMm: 0, readings: [] }],
      toleranceMm: 0.1,
    });
    expect(r.perSection[0]!.runoutMm).toBe(0);
  });
});

describe('fitEccentricity', () => {
  it('perfect circle → zero eccentricity', () => {
    const e = fitEccentricity(perfectCircleSection(0, 10));
    expect(e.eccentricityMm).toBeCloseTo(0, 6);
    expect(e.meanRadiusMm).toBeCloseTo(10, 6);
  });

  it('recovers known eccentricity', () => {
    const e = fitEccentricity(eccentricSection(0, 10, 0.05, 45, 24));
    expect(e.eccentricityMm).toBeCloseTo(0.05, 3);
    expect(e.phaseDeg).toBeCloseTo(45, 0);
  });

  it('empty readings → zero', () => {
    const e = fitEccentricity({ axialPositionMm: 0, readings: [] });
    expect(e.eccentricityMm).toBe(0);
  });
});

describe('summarize', () => {
  it('reports pass + worst + section count', () => {
    const r = evaluate({
      sections: [perfectCircleSection(0, 10), eccentricSection(50, 10, 0.05, 0)],
      toleranceMm: 0.2,
    });
    const s = summarize(r);
    expect(s.sectionCount).toBe(2);
    expect(s.worstRunoutMm).toBe(r.worstRunoutMm);
  });
});
