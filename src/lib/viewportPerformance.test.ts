import { describe, expect, it } from 'vitest';
import { classifyViewportComplexity, evaluateViewportPerformance, percentile95 } from './viewportPerformance';

describe('viewport performance budgets', () => {
  it('classifies fixed S/M/L/XL fixtures by rendered triangle count', () => {
    expect(classifyViewportComplexity(12_000)).toBe('S');
    expect(classifyViewportComplexity(200_000)).toBe('M');
    expect(classifyViewportComplexity(900_000)).toBe('L');
    expect(classifyViewportComplexity(1_500_000)).toBe('XL');
  });

  it('uses a deterministic nearest-rank p95', () => {
    expect(percentile95([])).toBe(0);
    expect(percentile95([1, 2, 3, 4, 100])).toBe(100);
    expect(percentile95(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95);
  });

  it('fails a fixture that misses frame and draw-call budgets', () => {
    expect(evaluateViewportPerformance({
      sampledAt: 1,
      fps: 20,
      frameTimeP95Ms: 60,
      triangles: 200_000,
      drawCalls: 800,
      geometries: 100,
      textures: 5,
    })).toMatchObject({
      tier: 'M',
      passed: false,
      violations: expect.arrayContaining([
        'FPS_BELOW_BUDGET:20<45',
        'FRAME_P95_OVER_BUDGET:60>28',
        'DRAW_CALLS_OVER_BUDGET:800>350',
      ]),
    });
  });
});
