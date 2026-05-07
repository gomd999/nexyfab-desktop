import { describe, it, expect } from 'vitest';
import {
  assemblyViewportLoadBand,
  interferenceWorkloadBand,
  assemblyPairwiseComparisonCount,
} from '@/lib/assemblyLoadPolicy';

/**
 * M7 — 정책 함수는 O(1)이어야 하며, 대량 호출에서도 ms 단위로 끝난다(로컬 CPU 스모크).
 * 실제 프레임·간섭 워커 시간은 [M7_PERFORMANCE_BUDGETS.md] 절차로 별도 측정.
 */
describe('M7 assemblyLoadPolicy timing smoke', () => {
  it('runs 40k band classifications quickly', () => {
    const t0 = performance.now();
    for (let i = 0; i < 40_000; i++) {
      const n = i % 200;
      assemblyViewportLoadBand(n);
      interferenceWorkloadBand(n);
      assemblyPairwiseComparisonCount(n);
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(900);
  });
});
