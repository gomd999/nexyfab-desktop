import { describe, it, expect } from 'vitest';
import {
  sampleCurveFromPolyline,
  generateCurvatureComb,
  generatePorcupineQuills,
  findInflectionPoints,
  evaluateZebraStripes,
  auditCurveJunction,
  computeCurvatureStats,
  type Point3D,
  type CurveSample,
} from './surfaceCurvature';

function arc(cx: number, cy: number, r: number, samples: number): Point3D[] {
  const pts: Point3D[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / (samples - 1)) * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: 0 });
  }
  return pts;
}

function line(p0: Point3D, p1: Point3D, n: number): Point3D[] {
  const pts: Point3D[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t });
  }
  return pts;
}

describe('sampleCurveFromPolyline', () => {
  it('produces 1 sample per input point', () => {
    const r = sampleCurveFromPolyline(arc(0, 0, 10, 20));
    expect(r).toHaveLength(20);
  });

  it('straight line → curvature ≈ 0', () => {
    const r = sampleCurveFromPolyline(line({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 5));
    for (const s of r) {
      expect(Math.abs(s.curvature)).toBeLessThan(1e-6);
    }
  });

  it('circle arc → curvature ≈ 1/R', () => {
    const r = sampleCurveFromPolyline(arc(0, 0, 10, 50));
    // Interior samples (not first/last where we use forward/backward FD)
    // should average near 1/10 = 0.1.
    const interior = r.slice(5, -5);
    const avg = interior.reduce((s, x) => s + Math.abs(x.curvature), 0) / interior.length;
    expect(avg).toBeCloseTo(0.1, 1);
  });

  it('parameter t monotonically grows 0 → 1', () => {
    const r = sampleCurveFromPolyline(arc(0, 0, 5, 10));
    expect(r[0]!.t).toBe(0);
    expect(r[r.length - 1]!.t).toBeCloseTo(1, 5);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.t).toBeGreaterThanOrEqual(r[i - 1]!.t);
    }
  });

  it('empty input → empty output', () => {
    expect(sampleCurveFromPolyline([])).toEqual([]);
  });

  it('circle: the normal is the in-plane principal normal toward the centre', () => {
    // Half-circle centred at the origin. At each interior sample the unit
    // normal must lie in the curve plane (z≈0) and point radially inward — NOT
    // the binormal (±Z), which the old code returned.
    const r = sampleCurveFromPolyline(arc(0, 0, 10, 50));
    for (const s of r.slice(5, -5)) {
      expect(Math.abs(s.normal.z)).toBeLessThan(1e-6);             // in the plane
      const radial = -(s.position.x * s.normal.x + s.position.y * s.normal.y);
      expect(radial).toBeGreaterThan(0.99 * 10);                   // points to centre
    }
  });

  it('S-curve: the sampler produces a genuine curvature SIGN change', () => {
    // y = sin(x) over [0, 2π] inflects at x = π. The Menger magnitude is
    // unsigned, so the sampler must sign it (via the reference binormal) or
    // findInflectionPoints can never fire on real data.
    const pts: Point3D[] = [];
    for (let i = 0; i <= 60; i++) { const x = (i / 60) * 2 * Math.PI; pts.push({ x, y: Math.sin(x), z: 0 }); }
    const s = sampleCurveFromPolyline(pts);
    const signs = new Set(s.slice(1, -1).map(p => Math.sign(p.curvature)).filter(v => v !== 0));
    expect(signs.has(1) && signs.has(-1)).toBe(true);              // both signs occur
    const infl = findInflectionPoints(s);
    expect(infl.length).toBeGreaterThanOrEqual(1);
    expect(infl.some(p => Math.abs(p.t - 0.5) < 0.1)).toBe(true);  // near x=π
  });
});

describe('generateCurvatureComb', () => {
  it('returns one comb segment per sample', () => {
    const samples = sampleCurveFromPolyline(arc(0, 0, 10, 20));
    const comb = generateCurvatureComb(samples);
    expect(comb).toHaveLength(20);
  });

  it('comb length proportional to curvature', () => {
    const samples = sampleCurveFromPolyline(arc(0, 0, 10, 50));
    const comb = generateCurvatureComb(samples, { scaleFactor: 100, maxLengthMm: 1000 });
    const interior = comb.slice(5, -5);
    for (const c of interior) {
      const len = Math.hypot(c.tip.x - c.base.x, c.tip.y - c.base.y, c.tip.z - c.base.z);
      expect(len).toBeCloseTo(Math.abs(c.curvature) * 100, 1);
    }
  });

  it('respects maxLengthMm', () => {
    const samples = sampleCurveFromPolyline(arc(0, 0, 0.1, 50)); // tiny radius → huge curvature
    const comb = generateCurvatureComb(samples, { scaleFactor: 1000, maxLengthMm: 5 });
    for (const c of comb) {
      const len = Math.hypot(c.tip.x - c.base.x, c.tip.y - c.base.y, c.tip.z - c.base.z);
      expect(len).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
});

describe('generatePorcupineQuills', () => {
  it('returns one quill per sample', () => {
    const samples = sampleCurveFromPolyline(arc(0, 0, 10, 12));
    expect(generatePorcupineQuills(samples)).toHaveLength(12);
  });

  it('intensity is clamped 0..1', () => {
    const samples = sampleCurveFromPolyline(arc(0, 0, 0.001, 20));
    const quills = generatePorcupineQuills(samples);
    for (const q of quills) {
      expect(q.intensity).toBeGreaterThanOrEqual(0);
      expect(q.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe('findInflectionPoints', () => {
  it('S-curve (sign change) gets an inflection', () => {
    const samples: CurveSample[] = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0.5 },
      { t: 0.5, position: { x: 1, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0.5 },
      { t: 1, position: { x: 2, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: -0.5 },
    ];
    expect(findInflectionPoints(samples)).toHaveLength(1);
  });

  it('monotone curvature → no inflection', () => {
    const samples: CurveSample[] = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0.5 },
      { t: 1, position: { x: 1, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0.6 },
    ];
    expect(findInflectionPoints(samples)).toHaveLength(0);
  });
});

describe('evaluateZebraStripes', () => {
  const positions: Point3D[] = [
    { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  ];

  it('emits one stripe sample per position', () => {
    const normals: Point3D[] = positions.map(() => ({ x: 0, y: 0, z: 1 }));
    const r = evaluateZebraStripes(positions, normals);
    expect(r).toHaveLength(3);
  });

  it('stripeValue is 0 or 1', () => {
    const normals: Point3D[] = [
      { x: 0, y: 0, z: 1 },
      { x: 0.05, y: 0, z: 1 },
      { x: 0.10, y: 0, z: 1 },
    ];
    const r = evaluateZebraStripes(positions, normals);
    for (const s of r) {
      expect([0, 1]).toContain(s.stripeValue);
    }
  });

  it('throws when lengths mismatch', () => {
    expect(() => evaluateZebraStripes(positions, [])).toThrow();
  });
});

describe('auditCurveJunction', () => {
  it('joined curves with no gap → G1+', () => {
    const a: CurveSample[] = [
      { t: 1, position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0.5 },
    ];
    const b: CurveSample[] = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0.5 },
    ];
    const r = auditCurveJunction(a, b);
    expect(r.positionGapMm).toBeCloseTo(0, 6);
    // Position + tangent + equal curvature → G2 exactly. The audit must NOT
    // overclaim G3 (curvature-derivative continuity is not assessable here).
    expect(r.achievedLevel).toBe('G2');
  });

  it('never returns G3 — even with an exact curvature match', () => {
    const mk = (t: number, k: number): CurveSample => ({
      t, position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: k,
    });
    // Identical curvature (ratio exactly 1) used to be mislabelled G3.
    const r = auditCurveJunction([mk(1, 0.5)], [mk(0, 0.5)]);
    expect(r.curvatureRatio).toBeCloseTo(1, 6);
    expect(r.achievedLevel).toBe('G2');
  });

  it('big gap → G0', () => {
    const a: CurveSample[] = [
      { t: 1, position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0 },
    ];
    const b: CurveSample[] = [
      { t: 0, position: { x: 5, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, curvature: 0 },
    ];
    expect(auditCurveJunction(a, b).achievedLevel).toBe('G0');
  });

  it('empty curves → infinite gap', () => {
    expect(auditCurveJunction([], []).positionGapMm).toBe(Infinity);
  });
});

describe('computeCurvatureStats', () => {
  it('arc radius matches expected min radius', () => {
    const samples = sampleCurveFromPolyline(arc(0, 0, 10, 50));
    const stats = computeCurvatureStats(samples);
    expect(stats.minRadiusMm).toBeGreaterThan(5);
    expect(stats.minRadiusMm).toBeLessThan(50);
  });

  it('empty samples → infinity radius', () => {
    const stats = computeCurvatureStats([]);
    expect(stats.minRadiusMm).toBe(Infinity);
    expect(stats.maxAbsCurvature).toBe(0);
  });

  it('inflectionCount populated', () => {
    const samples = sampleCurveFromPolyline([
      { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: -1, z: 0 }, { x: 4, y: 0, z: 0 },
    ]);
    const stats = computeCurvatureStats(samples);
    expect(stats.inflectionCount).toBeGreaterThanOrEqual(0);
  });
});
