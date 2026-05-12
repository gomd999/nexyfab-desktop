import { describe, it, expect } from 'vitest';
import { SHAPE_MAP, computeSceneParamApply } from '../shapes';

describe('computeSceneParamApply', () => {
  it('normalizes known shape params and builds expression literals', () => {
    const box = SHAPE_MAP.box;
    expect(box).toBeDefined();
    const { params, paramExpressions, unknownKeys } = computeSceneParamApply(box, {
      width: 12,
      junk: 99,
    });
    expect(unknownKeys).toContain('junk');
    expect(params.width).toBe(12);
    expect(paramExpressions.width).toBe('12');
  });

  it('mergeExpressionsFrom preserves extra keys and overwrites merged numeric keys', () => {
    const box = SHAPE_MAP.box;
    expect(box).toBeDefined();
    const { paramExpressions } = computeSceneParamApply(
      box,
      { width: 20 },
      { mergeExpressionsFrom: { width: '10', customFormula: 'sin(t)' } },
    );
    expect(paramExpressions.width).toBe('20');
    expect(paramExpressions.customFormula).toBe('sin(t)');
  });

  it('mergeExpressionsFrom keeps unrelated formula strings when patching numeric keys', () => {
    const box = SHAPE_MAP.box;
    expect(box).toBeDefined();
    const { paramExpressions } = computeSceneParamApply(box, { width: 5 }, {
      mergeExpressionsFrom: { width: '99', zFormula: 'cos(u)' },
    });
    expect(paramExpressions.width).toBe('5');
    expect(paramExpressions.zFormula).toBe('cos(u)');
  });

  it('treats null/invalid raw as empty object', () => {
    const box = SHAPE_MAP.box;
    expect(box).toBeDefined();
    const { params, unknownKeys } = computeSceneParamApply(
      box,
      // Simulates corrupt JSON / invalid caller at runtime
      null as unknown as Record<string, number>,
    );
    expect(unknownKeys).toEqual([]);
    expect(params.width).toBe(box.params.find((p) => p.key === 'width')!.default);
  });

  it('unknown shape def keeps finite numbers and syncs expressions', () => {
    const { params, paramExpressions, unknownKeys } = computeSceneParamApply(undefined, {
      a: 1,
      b: NaN,
      c: Number.POSITIVE_INFINITY,
    });
    expect(unknownKeys).toEqual([]);
    expect(params).toEqual({ a: 1 });
    expect(paramExpressions.a).toBe('1');
    expect(paramExpressions.b).toBeUndefined();
  });
});
