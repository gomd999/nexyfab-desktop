/**
 * M7: `assemblyLoadPolicy` 비유한·경계 입력 — 뷰포트/간섭 힌트가 예외 없이 수렴하는지.
 */
import { describe, it, expect } from 'vitest';
import {
  assemblyViewportLoadBand,
  assemblyViewportLoadTier,
  interferenceWorkloadBand,
  assemblyPairwiseComparisonCount,
  getAssemblyLoadGuidance,
} from '@/lib/assemblyLoadPolicy';

describe('M7 assemblyViewportLoadBand edge inputs', () => {
  it('treats non-finite and negative counts as normal', () => {
    for (const v of [NaN, Infinity, -Infinity, -1, -100]) {
      expect(assemblyViewportLoadBand(v)).toBe('normal');
    }
  });
});

describe('M7 assemblyViewportLoadTier edge inputs', () => {
  it('treats non-finite counts as normal', () => {
    expect(assemblyViewportLoadTier(NaN)).toBe('normal');
    expect(assemblyViewportLoadTier(Infinity)).toBe('normal');
  });
});

describe('M7 interferenceWorkloadBand fractional part counts', () => {
  it('floors fractional n before pair count', () => {
    expect(assemblyPairwiseComparisonCount(10.9)).toBe(45);
    expect(interferenceWorkloadBand(10.9)).toBe('moderate');
  });
});

describe('M7 getAssemblyLoadGuidance non-finite', () => {
  it('coerces NaN/Infinity to 0 parts (safe defaults)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const g = getAssemblyLoadGuidance(bad);
      expect(g.partCount).toBe(0);
      expect(g.pairwiseComparisons).toBe(0);
      expect(g.viewportBand).toBe('normal');
      expect(g.interferenceBand).toBe('trivial');
      expect(g.suggestAggressiveViewportLOD).toBe(false);
      expect(g.suggestInterferencePreambleToast).toBe(false);
      expect(g.suggestOpenPerfPanel).toBe(false);
    }
  });
});
