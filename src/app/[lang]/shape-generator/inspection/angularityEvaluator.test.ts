import { describe, it, expect } from 'vitest';
import {
  evaluate,
  actualAngleDeg,
  summarize,
  type MeasuredPoint,
} from './angularityEvaluator';

// Datum = XY plane (normal +Z). Controlled surface at 30° to datum,
// rotation about X axis. Points generated on the ideal 30° plane should
// give near-zero angularity.
function pointsOnAngledPlane(angleDeg: number, n = 9): MeasuredPoint[] {
  const t = angleDeg * Math.PI / 180;
  const pts: MeasuredPoint[] = [];
  // Plane contains X axis, tilted by t about X: points (x, y, y·tan(t)).
  for (let i = 0; i < n; i++) {
    const x = (i % 3) * 10;
    const y = Math.floor(i / 3) * 10;
    pts.push({ x, y, z: y * Math.tan(t) });
  }
  return pts;
}

const datumNormal = { x: 0, y: 0, z: 1 };
const rotationAxis = { x: 1, y: 0, z: 0 };

describe('evaluate', () => {
  it('points on ideal angled plane → near-zero angularity', () => {
    const r = evaluate({
      points: pointsOnAngledPlane(30),
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 0.05,
    });
    expect(r.angularityMm).toBeCloseTo(0, 4);
    expect(r.passed).toBe(true);
  });

  it('points off-angle → nonzero angularity', () => {
    const r = evaluate({
      points: pointsOnAngledPlane(35), // measured at 35° but checked against 30°
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 0.05,
    });
    expect(r.angularityMm).toBeGreaterThan(0.05);
    expect(r.passed).toBe(false);
  });

  it('nominal normal is unit length', () => {
    const r = evaluate({
      points: pointsOnAngledPlane(30),
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 0.05,
    });
    const len = Math.hypot(r.nominalNormal.x, r.nominalNormal.y, r.nominalNormal.z);
    expect(len).toBeCloseTo(1, 6);
  });

  it('angularity = max − min deviation', () => {
    const r = evaluate({
      points: pointsOnAngledPlane(31),
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 1,
    });
    expect(r.angularityMm).toBeCloseTo(r.maxDeviationMm - r.minDeviationMm, 6);
  });

  it('too few points → warning', () => {
    const r = evaluate({
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 0.05,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero tolerance → warning', () => {
    const r = evaluate({
      points: pointsOnAngledPlane(30),
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 0,
    });
    expect(r.warnings.some(w => w.toLowerCase().includes('tolerance'))).toBe(true);
  });
});

describe('actualAngleDeg', () => {
  it('plane parallel to datum → 0°', () => {
    expect(actualAngleDeg({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(0, 4);
  });

  it('plane perpendicular to datum → 90°', () => {
    expect(actualAngleDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(90, 4);
  });

  it('45° plane', () => {
    expect(actualAngleDeg({ x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(45, 4);
  });
});

describe('summarize', () => {
  it('reports pass + angularity', () => {
    const r = evaluate({
      points: pointsOnAngledPlane(30),
      datumNormal,
      basicAngleDeg: 30,
      rotationAxis,
      toleranceMm: 0.05,
    });
    const s = summarize(r);
    expect(s.passed).toBe(r.passed);
    expect(s.angularityMm).toBe(r.angularityMm);
  });
});
