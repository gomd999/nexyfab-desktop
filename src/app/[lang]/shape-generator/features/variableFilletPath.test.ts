import { describe, it, expect } from 'vitest';
import {
  radiusAt,
  sampleRadiusPath,
  validateRadiusPath,
  computeFilletRails,
  type RadiusPath,
  type EdgeSample,
} from './variableFilletPath';

describe('radiusAt', () => {
  it('zero control points → 0', () => {
    expect(radiusAt({ controlPoints: [], mode: 'linear' }, 0.5)).toBe(0);
  });

  it('single control point → returns its radius for any t', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0.5, radiusMm: 3 }], mode: 'linear' };
    expect(radiusAt(path, 0)).toBe(3);
    expect(radiusAt(path, 1)).toBe(3);
  });

  it('clamps to first/last CP outside [first.t, last.t]', () => {
    const path: RadiusPath = {
      controlPoints: [{ t: 0.2, radiusMm: 1 }, { t: 0.8, radiusMm: 5 }],
      mode: 'linear',
    };
    expect(radiusAt(path, 0)).toBe(1);
    expect(radiusAt(path, 1)).toBe(5);
  });

  it('linear interpolation midpoint', () => {
    const path: RadiusPath = {
      controlPoints: [{ t: 0, radiusMm: 1 }, { t: 1, radiusMm: 5 }],
      mode: 'linear',
    };
    expect(radiusAt(path, 0.5)).toBe(3);
  });

  it('catmull-rom passes through control points', () => {
    const path: RadiusPath = {
      controlPoints: [
        { t: 0, radiusMm: 1 },
        { t: 0.5, radiusMm: 3 },
        { t: 1, radiusMm: 5 },
      ],
      mode: 'catmull-rom',
    };
    expect(radiusAt(path, 0.5)).toBeCloseTo(3, 6);
  });

  it('monotone-cubic passes through control points', () => {
    const path: RadiusPath = {
      controlPoints: [
        { t: 0, radiusMm: 1 },
        { t: 0.5, radiusMm: 3 },
        { t: 1, radiusMm: 5 },
      ],
      mode: 'monotone-cubic',
    };
    expect(radiusAt(path, 0)).toBeCloseTo(1, 5);
    expect(radiusAt(path, 0.5)).toBeCloseTo(3, 5);
    expect(radiusAt(path, 1)).toBeCloseTo(5, 5);
  });

  it('monotone-cubic preserves monotonicity (no overshoot)', () => {
    const path: RadiusPath = {
      controlPoints: [
        { t: 0, radiusMm: 0 },
        { t: 0.5, radiusMm: 10 },
        { t: 1, radiusMm: 10 },
      ],
      mode: 'monotone-cubic',
    };
    // Sample finely + check no value exceeds 10 or drops below 0.
    for (let i = 0; i <= 100; i++) {
      const r = radiusAt(path, i / 100);
      expect(r).toBeGreaterThanOrEqual(-1e-6);
      expect(r).toBeLessThanOrEqual(10 + 1e-6);
    }
  });
});

describe('sampleRadiusPath', () => {
  it('default sample count = 32', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0, radiusMm: 1 }, { t: 1, radiusMm: 5 }], mode: 'linear' };
    expect(sampleRadiusPath(path)).toHaveLength(32);
  });

  it('uniform t spacing', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0, radiusMm: 1 }, { t: 1, radiusMm: 5 }], mode: 'linear' };
    const samples = sampleRadiusPath(path, 5);
    expect(samples.map(s => s.t)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('validateRadiusPath', () => {
  it('flags negative radius CP', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0.5, radiusMm: -1 }], mode: 'linear' };
    const r = validateRadiusPath(path);
    expect(r.isValid).toBe(false);
  });

  it('flags out-of-range t', () => {
    const path: RadiusPath = { controlPoints: [{ t: 1.5, radiusMm: 2 }], mode: 'linear' };
    const r = validateRadiusPath(path);
    expect(r.warnings.some(w => w.includes('outside'))).toBe(true);
  });

  it('flags excessive radius', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0, radiusMm: 200 }], mode: 'linear' };
    const r = validateRadiusPath(path, 100);
    expect(r.warnings.some(w => w.includes('exceeds'))).toBe(true);
  });

  it('accepts a well-formed path', () => {
    const path: RadiusPath = {
      controlPoints: [{ t: 0, radiusMm: 1 }, { t: 0.5, radiusMm: 2 }, { t: 1, radiusMm: 3 }],
      mode: 'linear',
    };
    expect(validateRadiusPath(path).isValid).toBe(true);
  });
});

describe('computeFilletRails', () => {
  const samples: EdgeSample[] = [
    { position: [0, 0, 0], tangent: [1, 0, 0], normalA: [0, 0, 1], normalB: [0, 1, 0] },
    { position: [10, 0, 0], tangent: [1, 0, 0], normalA: [0, 0, 1], normalB: [0, 1, 0] },
    { position: [20, 0, 0], tangent: [1, 0, 0], normalA: [0, 0, 1], normalB: [0, 1, 0] },
  ];

  it('emits one point per edge sample', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0, radiusMm: 2 }, { t: 1, radiusMm: 2 }], mode: 'linear' };
    const r = computeFilletRails(samples, path);
    expect(r.railA).toHaveLength(3);
    expect(r.railB).toHaveLength(3);
    expect(r.radii).toHaveLength(3);
  });

  it('constant-radius path → all radii equal', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0, radiusMm: 4 }, { t: 1, radiusMm: 4 }], mode: 'linear' };
    const r = computeFilletRails(samples, path);
    for (const radius of r.radii) {
      expect(radius).toBe(4);
    }
  });

  it('rail A offset by -normalA × radius', () => {
    const path: RadiusPath = { controlPoints: [{ t: 0, radiusMm: 3 }], mode: 'linear' };
    const r = computeFilletRails(samples, path);
    // Sample 0: position (0,0,0), normalA = (0,0,1), r = 3 → railA = (0, 0, -3)
    expect(r.railA[0]).toEqual([0, 0, -3]);
  });
});
