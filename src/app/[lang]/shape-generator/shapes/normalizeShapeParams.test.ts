import { describe, it, expect } from 'vitest';
import { normalizeShapeParams, SHAPE_MAP } from './index';

describe('normalizeShapeParams', () => {
  it('fills defaults, merges known keys, reports unknown keys', () => {
    const box = SHAPE_MAP.box;
    const { params, unknownKeys } = normalizeShapeParams(box, {
      width: 12,
      radius: 99,
      garbage: 1,
    } as Record<string, number>);
    expect(unknownKeys.sort()).toEqual(['garbage', 'radius']);
    expect(params.width).toBe(12);
    expect(params.height).toBe(30);
    expect(params.depth).toBe(20);
  });

  it('clamps to min/max', () => {
    const box = SHAPE_MAP.box;
    const { params } = normalizeShapeParams(box, { width: 99999, height: 1, depth: 1 });
    expect(params.width).toBe(500);
    expect(params.height).toBe(1);
  });

  it('ignores non-finite numbers', () => {
    const box = SHAPE_MAP.box;
    const { params, unknownKeys } = normalizeShapeParams(box, {
      width: NaN,
      height: Number.POSITIVE_INFINITY,
    });
    expect(unknownKeys).toEqual([]);
    expect(params.width).toBe(50);
    expect(params.height).toBe(30);
  });
});
