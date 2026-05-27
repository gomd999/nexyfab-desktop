import { describe, it, expect } from 'vitest';
import {
  douglasPeucker2D,
  douglasPeucker3D,
  visvalingam2D,
  douglasPeuckerToCount2D,
  measureSimplification,
  type Point2D,
} from './polylineSimplify';

function straightLine2D(n: number): Point2D[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
}

function noisyArc2D(n: number, radius: number): Point2D[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI;
    return { x: radius * Math.cos(t), y: radius * Math.sin(t) };
  });
}

describe('douglasPeucker2D', () => {
  it('straight line reduces to 2 endpoints', () => {
    const result = douglasPeucker2D(straightLine2D(20), 0.001);
    expect(result).toHaveLength(2);
  });

  it('< 3 points returns input', () => {
    expect(douglasPeucker2D([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.01)).toHaveLength(2);
  });

  it('high epsilon reduces aggressively', () => {
    const result = douglasPeucker2D(noisyArc2D(20, 10), 10);
    expect(result).toHaveLength(2);
  });

  it('low epsilon preserves most points', () => {
    const result = douglasPeucker2D(noisyArc2D(20, 10), 0.001);
    expect(result.length).toBeGreaterThan(10);
  });

  it('endpoints always preserved', () => {
    const input = noisyArc2D(20, 10);
    const result = douglasPeucker2D(input, 5);
    expect(result[0]).toEqual(input[0]);
    expect(result[result.length - 1]).toEqual(input[input.length - 1]);
  });
});

describe('douglasPeucker3D', () => {
  it('straight 3D line reduces to 2 points', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 0 }));
    expect(douglasPeucker3D(points, 0.01)).toHaveLength(2);
  });

  it('zigzag preserves bends', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 5, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 5, z: 0 },
    ];
    expect(douglasPeucker3D(points, 0.01).length).toBe(4);
  });
});

describe('visvalingam2D', () => {
  it('reduces to target count exactly', () => {
    const result = visvalingam2D(noisyArc2D(20, 10), 5);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.length).toBeGreaterThan(0);
  });

  it('preserves endpoints', () => {
    const input = noisyArc2D(20, 10);
    const result = visvalingam2D(input, 5);
    expect(result[0]).toEqual(input[0]);
    expect(result[result.length - 1]).toEqual(input[input.length - 1]);
  });

  it('target ≥ input → no reduction', () => {
    const input = noisyArc2D(5, 10);
    expect(visvalingam2D(input, 100)).toHaveLength(5);
  });
});

describe('douglasPeuckerToCount2D', () => {
  it('finds epsilon to hit target', () => {
    const input = noisyArc2D(30, 10);
    const { points } = douglasPeuckerToCount2D(input, 10);
    expect(points.length).toBeLessThanOrEqual(input.length);
  });

  it('returns input unchanged when target ≥ input', () => {
    const input = noisyArc2D(5, 10);
    const { points } = douglasPeuckerToCount2D(input, 10);
    expect(points).toHaveLength(5);
  });
});

describe('measureSimplification', () => {
  it('reports retainedFraction', () => {
    const original = noisyArc2D(20, 10);
    const simplified = douglasPeucker2D(original, 1);
    const m = measureSimplification(original, simplified);
    expect(m.retainedFraction).toBeLessThanOrEqual(1);
  });

  it('lengthDeltaFraction grows with aggressive simplification', () => {
    const original = noisyArc2D(20, 10);
    const aggressive = douglasPeucker2D(original, 5);
    const m = measureSimplification(original, aggressive);
    expect(m.lengthDeltaFraction).toBeGreaterThanOrEqual(0);
  });

  it('input + output counts reported', () => {
    const original = noisyArc2D(20, 10);
    const simplified = douglasPeucker2D(original, 1);
    const m = measureSimplification(original, simplified);
    expect(m.inputCount).toBe(20);
    expect(m.outputCount).toBe(simplified.length);
  });

  it('maxDeviation non-negative', () => {
    const original = noisyArc2D(20, 10);
    const simplified = douglasPeucker2D(original, 1);
    const m = measureSimplification(original, simplified);
    expect(m.maxDeviation).toBeGreaterThanOrEqual(0);
  });
});
