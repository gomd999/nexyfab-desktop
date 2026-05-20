import { describe, it, expect } from 'vitest';
import {
  curveDrivenPattern,
  sketchDrivenPattern,
  tableDrivenPattern,
  fillPattern,
  variablePattern,
  type CurvePoint,
  type SketchPoint,
  type FillRegion,
} from './patternVariants';

describe('curveDrivenPattern', () => {
  const curve: CurvePoint[] = [
    { position: [0, 0, 0], tangent: [1, 0, 0] },
    { position: [10, 0, 0], tangent: [1, 0, 0] },
    { position: [20, 0, 0], tangent: [1, 0, 0] },
  ];

  it('emits count instances', () => {
    const r = curveDrivenPattern(curve, { count: 3, alignToTangent: false });
    expect(r).toHaveLength(3);
  });

  it('first instance at curve start', () => {
    const r = curveDrivenPattern(curve, { count: 2, alignToTangent: false });
    expect(r[0]!.position).toEqual([0, 0, 0]);
  });

  it('alignToTangent sets rotation', () => {
    const r = curveDrivenPattern(curve, { count: 2, alignToTangent: true });
    expect(r[0]!.rotation).toBeDefined();
  });

  it('skipIndices removes instances', () => {
    const r = curveDrivenPattern(curve, { count: 4, alignToTangent: false, skipIndices: [1] });
    expect(r).toHaveLength(3);
  });

  it('spacingMm overrides count distribution', () => {
    const r = curveDrivenPattern(curve, { count: 100, alignToTangent: false, spacingMm: 5 });
    // Curve total length = 20mm, spacing 5mm → max 5 instances (0,5,10,15,20).
    expect(r.length).toBeLessThanOrEqual(5);
  });

  it('empty curve → empty pattern', () => {
    expect(curveDrivenPattern([], { count: 5, alignToTangent: false })).toHaveLength(0);
  });
});

describe('sketchDrivenPattern', () => {
  it('projects 2D points to 3D using sketch plane axes', () => {
    const plane = {
      origin: [10, 20, 30] as [number, number, number],
      xAxis: [1, 0, 0] as [number, number, number],
      yAxis: [0, 1, 0] as [number, number, number],
    };
    const r = sketchDrivenPattern([{ x: 1, y: 2 }, { x: 3, y: 4 }], plane);
    expect(r).toHaveLength(2);
    expect(r[0]!.position).toEqual([11, 22, 30]);
    expect(r[1]!.position).toEqual([13, 24, 30]);
  });
});

describe('tableDrivenPattern', () => {
  it('one instance per row', () => {
    const r = tableDrivenPattern([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(r).toHaveLength(3);
  });

  it('preserves z (default 0)', () => {
    const r = tableDrivenPattern([{ x: 1, y: 2 }]);
    expect(r[0]!.position).toEqual([1, 2, 0]);
  });

  it('emits rotation when given', () => {
    const r = tableDrivenPattern([{ x: 0, y: 0, rz: Math.PI / 4 }]);
    expect(r[0]!.rotation).toBeDefined();
    expect(r[0]!.rotation![2]).toBeCloseTo(Math.PI / 4, 5);
  });

  it('emits param overrides', () => {
    const r = tableDrivenPattern([{ x: 0, y: 0, params: { radius: 5 } }]);
    expect(r[0]!.paramOverrides?.radius).toBe(5);
  });
});

describe('fillPattern', () => {
  const region: FillRegion = {
    boundary: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
    plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
  };

  it('square tile fills region', () => {
    const r = fillPattern(region, { tile: 'square', spacingMm: 10 });
    expect(r.length).toBeGreaterThan(0);
  });

  it('hex tile denser than square at same spacing', () => {
    const sq = fillPattern(region, { tile: 'square', spacingMm: 10 });
    const hex = fillPattern(region, { tile: 'hex', spacingMm: 10 });
    expect(hex.length).toBeGreaterThanOrEqual(sq.length);
  });

  it('polar tile produces points around center', () => {
    const r = fillPattern(region, {
      tile: 'polar', spacingMm: 8, polarCenter: { x: 25, y: 25 },
    });
    expect(r.length).toBeGreaterThan(0);
  });

  it('perimeter tile follows boundary', () => {
    const r = fillPattern(region, { tile: 'perimeter', spacingMm: 10 });
    expect(r.length).toBeGreaterThan(0);
  });

  it('boundary fewer than 3 → empty', () => {
    expect(fillPattern({ boundary: [{ x: 0, y: 0 }], plane: region.plane }, {
      tile: 'square', spacingMm: 5,
    })).toHaveLength(0);
  });
});

describe('variablePattern', () => {
  const base = [
    { position: [0, 0, 0] as [number, number, number] },
    { position: [10, 0, 0] as [number, number, number] },
    { position: [20, 0, 0] as [number, number, number] },
  ];

  it('linear interpolation between start and end', () => {
    const r = variablePattern(base, [{
      paramName: 'radius', startValue: 1, endValue: 5,
    }]);
    expect(r[0]!.paramOverrides!.radius).toBe(1);
    expect(r[1]!.paramOverrides!.radius).toBeCloseTo(3, 5);
    expect(r[2]!.paramOverrides!.radius).toBe(5);
  });

  it('quadratic mode accelerates toward end', () => {
    const r = variablePattern(base, [{
      paramName: 'radius', startValue: 0, endValue: 1, interpolation: 'quadratic',
    }]);
    // Quadratic at t=0.5 → 0.25 (linear would be 0.5).
    expect(r[1]!.paramOverrides!.radius).toBeCloseTo(0.25, 5);
  });

  it('preserves existing position', () => {
    const r = variablePattern(base, [{
      paramName: 'radius', startValue: 1, endValue: 5,
    }]);
    expect(r[1]!.position).toEqual([10, 0, 0]);
  });

  it('empty base → empty result', () => {
    expect(variablePattern([], [{ paramName: 'x', startValue: 0, endValue: 1 }])).toHaveLength(0);
  });
});
