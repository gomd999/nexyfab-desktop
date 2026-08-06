import { describe, expect, it } from 'vitest';
import {
  CAD_TOLERANCE_POLICY_VERSION,
  characteristicLengthMm,
  createCadTolerancePolicy,
} from './cadTolerancePolicy';

const cube = (side: number) => ({ min: [0, 0, 0] as const, max: [side, side, side] as const });

describe('CAD tolerance policy v1', () => {
  it('uses an overflow-resistant bbox diagonal as characteristic length', () => {
    expect(characteristicLengthMm({ min: [0, 0, 0], max: [3, 4, 0] })).toBe(5);
    expect(characteristicLengthMm(cube(1e-9))).toBeCloseTo(Math.sqrt(3) * 1e-9, 20);
    expect(characteristicLengthMm(cube(1e150))).toBeCloseTo(Math.sqrt(3) * 1e150, 12);
  });

  it('produces distinct deterministic tolerances for a normal mm model', () => {
    const first = createCadTolerancePolicy({ bbox: cube(100), lengthUnit: { kind: 'mm' } });
    const second = createCadTolerancePolicy({ bbox: cube(100), lengthUnit: { kind: 'mm' } });
    expect(first).toEqual(second);
    expect(first.version).toBe(CAD_TOLERANCE_POLICY_VERSION);
    expect(first.linearMm.boolean).not.toBe(first.linearMm.importSewing);
    expect(first.linearMm.topologyMatch).toBeGreaterThan(first.linearMm.boolean);
    expect(first.linearMm.metricComparison).toBeGreaterThan(first.linearMm.topologyMatch);
    expect(first.angular.radians).toBeGreaterThan(0);
    expect(first.angular.degrees).toBeCloseTo(first.angular.radians * 180 / Math.PI);
  });

  it('applies safe floors to microscopic models and ceilings to plant-scale models', () => {
    const micro = createCadTolerancePolicy({ bbox: cube(1e-9), lengthUnit: { kind: 'mm' } });
    expect(micro.linearMm).toEqual({
      importSewing: 1e-7,
      boolean: 1e-7,
      topologyMatch: 1e-6,
      metricComparison: 1e-6,
    });

    const plant = createCadTolerancePolicy({ bbox: cube(1e9), lengthUnit: { kind: 'mm' } });
    expect(plant.linearMm).toEqual({
      importSewing: 5e-2,
      boolean: 2e-2,
      topologyMatch: 2e-1,
      metricComparison: 5e-1,
    });
  });

  it('converts source units before deriving absolute tolerances', () => {
    const metres = createCadTolerancePolicy({
      bbox: cube(1),
      lengthUnit: { kind: 'scale-to-mm', scaleToMm: 1000, label: 'm' },
    });
    const millimetres = createCadTolerancePolicy({ bbox: cube(1000), lengthUnit: { kind: 'mm' } });
    expect(metres.characteristicLengthMm).toBe(millimetres.characteristicLengthMm);
    expect(metres.linearMm).toEqual(millimetres.linearMm);
  });

  it('records lower and upper source-tolerance clamps', () => {
    const low = createCadTolerancePolicy({
      bbox: cube(10), lengthUnit: { kind: 'mm' }, declaredSourceTolerance: { value: 1e-12 },
    });
    expect(low.declaredSourceTolerance).toMatchObject({
      declaredMm: 1e-12, effectiveMm: 1e-7, clamped: true, direction: 'raised-to-minimum',
    });
    expect(low.declaredSourceTolerance?.reason).toMatch(/kernel-safe/);

    const high = createCadTolerancePolicy({
      bbox: cube(10), lengthUnit: { kind: 'mm' }, declaredSourceTolerance: { value: 2 },
    });
    expect(high.declaredSourceTolerance).toMatchObject({
      declaredMm: 2, effectiveMm: 5e-2, clamped: true, direction: 'lowered-to-maximum',
    });
    expect(high.linearMm.importSewing).toBe(5e-2);
  });

  it('records an in-range declaration without claiming a clamp', () => {
    const policy = createCadTolerancePolicy({
      bbox: cube(10), lengthUnit: { kind: 'mm' }, declaredSourceTolerance: { value: 0.001 },
    });
    expect(policy.declaredSourceTolerance).toEqual({
      declaredMm: 0.001,
      effectiveMm: 0.001,
      minimumMm: 1e-7,
      maximumMm: 5e-2,
      clamped: false,
      direction: 'none',
      reason: null,
    });
    expect(policy.linearMm.importSewing).toBe(0.001);
  });

  it.each([
    [{ min: [0, 0, 0], max: [Number.NaN, 1, 1] }, 'INVALID_BBOX'],
    [{ min: [2, 0, 0], max: [1, 1, 1] }, 'INVALID_BBOX'],
    [{ min: [1, 1, 1], max: [1, 1, 1] }, 'DEGENERATE_BBOX'],
  ] as const)('rejects invalid bbox %#', (bbox, code) => {
    expect(() => createCadTolerancePolicy({ bbox, lengthUnit: { kind: 'mm' } })).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('rejects unit ambiguity instead of inventing absolute millimetres', () => {
    expect(() => createCadTolerancePolicy({
      bbox: cube(10), lengthUnit: { kind: 'unknown', label: 'unitless STL' },
    })).toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_UNITS' }));
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid unit scale %s', (scaleToMm) => {
    expect(() => createCadTolerancePolicy({
      bbox: cube(10), lengthUnit: { kind: 'scale-to-mm', scaleToMm },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_UNIT_SCALE' }));
  });

  it.each([0, -0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid source tolerance %s', (value) => {
    expect(() => createCadTolerancePolicy({
      bbox: cube(10), lengthUnit: { kind: 'mm' }, declaredSourceTolerance: { value },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_SOURCE_TOLERANCE' }));
  });
});
