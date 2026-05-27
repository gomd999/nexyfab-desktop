import { describe, it, expect } from 'vitest';
import {
  evaluate,
  classifyForm,
  summarize,
  type SurfaceReading,
} from './totalRunoutEvaluator';

function perfectCylinder(radius: number, sections = 5, perSection = 8): SurfaceReading[] {
  const out: SurfaceReading[] = [];
  for (let s = 0; s < sections; s++) {
    for (let a = 0; a < perSection; a++) {
      out.push({ axialPositionMm: s * 10, angleDeg: (a * 360) / perSection, valueMm: radius });
    }
  }
  return out;
}

function taperedCylinder(r0: number, slope: number, sections = 5, perSection = 8): SurfaceReading[] {
  const out: SurfaceReading[] = [];
  for (let s = 0; s < sections; s++) {
    const z = s * 10;
    for (let a = 0; a < perSection; a++) {
      out.push({ axialPositionMm: z, angleDeg: (a * 360) / perSection, valueMm: r0 + slope * z });
    }
  }
  return out;
}

describe('evaluate', () => {
  it('perfect cylinder → zero total runout', () => {
    const r = evaluate({ readings: perfectCylinder(10), toleranceMm: 0.05 });
    expect(r.totalRunoutMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('tapered cylinder → runout = slope × span', () => {
    const r = evaluate({ readings: taperedCylinder(10, 0.01), toleranceMm: 1 });
    // span = 40 mm, slope 0.01 → range 0.4
    expect(r.totalRunoutMm).toBeCloseTo(0.4, 5);
  });

  it('exceeds tolerance → fail', () => {
    const r = evaluate({ readings: taperedCylinder(10, 0.05), toleranceMm: 0.5 });
    expect(r.passed).toBe(false);
  });

  it('taper slope recovered by least squares', () => {
    const r = evaluate({ readings: taperedCylinder(10, 0.02), toleranceMm: 5 });
    expect(r.taperMmPerMm).toBeCloseTo(0.02, 5);
  });

  it('high/low spots identified', () => {
    const r = evaluate({ readings: taperedCylinder(10, 0.01), toleranceMm: 5 });
    expect(r.highSpot!.valueMm).toBeGreaterThan(r.lowSpot!.valueMm);
  });

  it('empty readings → no crash, passes', () => {
    const r = evaluate({ readings: [], toleranceMm: 0.1 });
    expect(r.totalRunoutMm).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('face mode preserved in result', () => {
    const r = evaluate({ readings: perfectCylinder(10), toleranceMm: 0.05, mode: 'face' });
    expect(r.mode).toBe('face');
  });

  it('zero tolerance → warning', () => {
    const r = evaluate({ readings: perfectCylinder(10), toleranceMm: 0 });
    expect(r.warnings.some(w => w.toLowerCase().includes('tolerance'))).toBe(true);
  });
});

describe('classifyForm', () => {
  it('perfect → within-noise', () => {
    expect(classifyForm({ readings: perfectCylinder(10), toleranceMm: 0.05 })).toBe('within-noise');
  });

  it('strong taper → taper', () => {
    expect(classifyForm({ readings: taperedCylinder(10, 0.02), toleranceMm: 5 })).toBe('taper');
  });

  it('barrel (mid larger) detected', () => {
    const readings: SurfaceReading[] = [];
    for (let s = 0; s < 5; s++) {
      const z = s * 10;
      const frac = z / 40;
      const bulge = Math.sin(frac * Math.PI) * 0.2; // 0 at ends, max in mid
      for (let a = 0; a < 8; a++) {
        readings.push({ axialPositionMm: z, angleDeg: (a * 360) / 8, valueMm: 10 + bulge });
      }
    }
    expect(classifyForm({ readings, toleranceMm: 5 })).toBe('barrel');
  });

  it('hourglass (mid smaller) detected', () => {
    const readings: SurfaceReading[] = [];
    for (let s = 0; s < 5; s++) {
      const z = s * 10;
      const frac = z / 40;
      const pinch = Math.sin(frac * Math.PI) * 0.2;
      for (let a = 0; a < 8; a++) {
        readings.push({ axialPositionMm: z, angleDeg: (a * 360) / 8, valueMm: 10 - pinch });
      }
    }
    expect(classifyForm({ readings, toleranceMm: 5 })).toBe('hourglass');
  });

  it('eccentric (angular variation, no axial trend) detected', () => {
    const readings: SurfaceReading[] = [];
    for (let s = 0; s < 5; s++) {
      for (let a = 0; a < 12; a++) {
        const angle = (a * 360) / 12;
        const t = angle * Math.PI / 180;
        readings.push({ axialPositionMm: s * 10, angleDeg: angle, valueMm: 10 + 0.1 * Math.cos(t) });
      }
    }
    expect(classifyForm({ readings, toleranceMm: 5 })).toBe('eccentric');
  });
});

describe('summarize', () => {
  it('reports pass + runout + taper', () => {
    const r = evaluate({ readings: taperedCylinder(10, 0.01), toleranceMm: 1 });
    const s = summarize(r);
    expect(s.totalRunoutMm).toBe(r.totalRunoutMm);
    expect(s.taperMmPerMm).toBe(r.taperMmPerMm);
  });
});
