import { describe, it, expect } from 'vitest';
import {
  ASSEMBLY_VIEW_THRESHOLDS,
  ASSEMBLY_INTERFERENCE_THRESHOLDS,
  M7_REFERENCE_BUDGETS_MS,
  ASSEMBLY_VIEW_WARN_MIN_PARTS,
  ASSEMBLY_VIEW_HEAVY_MIN_PARTS,
  INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT,
  assemblyPairwiseComparisonCount,
  assemblyViewportLoadBand,
  assemblyViewportLoadTier,
  interferenceWorkloadBand,
  getAssemblyLoadGuidance,
  recommendedMaxTriPairsForPartCount,
} from '@/lib/assemblyLoadPolicy';

describe('INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT', () => {
  it('matches InterferenceDetection sweep broad-phase threshold', () => {
    expect(INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT).toBe(18);
  });
});

describe('M7_REFERENCE_BUDGETS_MS', () => {
  it('exposes positive reference budgets', () => {
    expect(M7_REFERENCE_BUDGETS_MS.interferencePass12Parts).toBeGreaterThan(0);
    expect(M7_REFERENCE_BUDGETS_MS.snapshotHydrateOnce).toBeGreaterThan(0);
  });
});

describe('assemblyPairwiseComparisonCount', () => {
  it('is 0 for n<2', () => {
    expect(assemblyPairwiseComparisonCount(0)).toBe(0);
    expect(assemblyPairwiseComparisonCount(1)).toBe(0);
  });
  it('is n(n-1)/2 for n>=2', () => {
    expect(assemblyPairwiseComparisonCount(2)).toBe(1);
    expect(assemblyPairwiseComparisonCount(10)).toBe(45);
    expect(assemblyPairwiseComparisonCount(25)).toBe(300);
    expect(assemblyPairwiseComparisonCount(26)).toBe(325);
  });
});

describe('assemblyViewportLoadBand (5단계)', () => {
  it('normal below light', () => {
    expect(assemblyViewportLoadBand(0)).toBe('normal');
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.light - 1)).toBe('normal');
  });
  it('light in [light, warn)', () => {
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.light)).toBe('light');
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.warn - 1)).toBe('light');
  });
  it('warn in [warn, heavy)', () => {
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.warn)).toBe('warn');
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.heavy - 1)).toBe('warn');
  });
  it('heavy in [heavy, extreme)', () => {
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.heavy)).toBe('heavy');
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.extreme - 1)).toBe('heavy');
  });
  it('extreme at extreme+', () => {
    expect(assemblyViewportLoadBand(ASSEMBLY_VIEW_THRESHOLDS.extreme)).toBe('extreme');
    expect(assemblyViewportLoadBand(500)).toBe('extreme');
  });
});

describe('assemblyViewportLoadTier (3단계 호환)', () => {
  it('matches legacy 24/48 boundaries', () => {
    expect(ASSEMBLY_VIEW_WARN_MIN_PARTS).toBe(24);
    expect(ASSEMBLY_VIEW_HEAVY_MIN_PARTS).toBe(48);
    expect(assemblyViewportLoadTier(23)).toBe('normal');
    expect(assemblyViewportLoadTier(24)).toBe('warn');
    expect(assemblyViewportLoadTier(47)).toBe('warn');
    expect(assemblyViewportLoadTier(48)).toBe('heavy');
  });
});

describe('interferenceWorkloadBand (쌍 수 기준)', () => {
  it('trivial for n<2', () => {
    expect(interferenceWorkloadBand(0)).toBe('trivial');
    expect(interferenceWorkloadBand(1)).toBe('trivial');
  });
  it('light for small n', () => {
    expect(interferenceWorkloadBand(2)).toBe('light'); // 1 pair
    expect(interferenceWorkloadBand(6)).toBe('light'); // 15 pairs
  });
  it('moderate up to moderateMaxPairs', () => {
    expect(interferenceWorkloadBand(7)).toBe('moderate'); // 21 pairs
    expect(interferenceWorkloadBand(10)).toBe('moderate'); // 45 pairs
  });
  it('heavy above moderate until heavyMaxPairs', () => {
    expect(interferenceWorkloadBand(11)).toBe('heavy'); // 55 pairs
    expect(interferenceWorkloadBand(25)).toBe('heavy'); // 300 pairs
  });
  it('extreme above heavyMaxPairs', () => {
    expect(interferenceWorkloadBand(26)).toBe('extreme');
  });
});

describe('getAssemblyLoadGuidance', () => {
  it('small assembly: no aggressive flags', () => {
    const g = getAssemblyLoadGuidance(4);
    expect(g.viewportBand).toBe('normal');
    expect(g.interferenceBand).toBe('light');
    expect(g.suggestAggressiveViewportLOD).toBe(false);
    expect(g.suggestInterferencePreambleToast).toBe(false);
    expect(g.suggestOpenPerfPanel).toBe(false);
  });

  it('n=30: viewport warn, interference extreme, toasts+LOD', () => {
    const g = getAssemblyLoadGuidance(30);
    expect(g.viewportBand).toBe('warn');
    expect(g.pairwiseComparisons).toBe(435);
    expect(g.interferenceBand).toBe('extreme');
    expect(g.suggestAggressiveViewportLOD).toBe(true);
    expect(g.suggestInterferencePreambleToast).toBe(true);
    expect(g.suggestOpenPerfPanel).toBe(true);
  });

  it('n=20: light viewport, heavy interference', () => {
    const g = getAssemblyLoadGuidance(20);
    expect(g.viewportBand).toBe('light');
    expect(g.interferenceBand).toBe('heavy');
    expect(g.suggestAggressiveViewportLOD).toBe(false);
    expect(g.suggestInterferencePreambleToast).toBe(true);
  });

  it('constants object is frozen shape', () => {
    expect(ASSEMBLY_INTERFERENCE_THRESHOLDS.heavyMaxPairs).toBe(300);
  });
});

describe('recommendedMaxTriPairsForPartCount', () => {
  it('raises budget for very small assemblies (quality)', () => {
    expect(recommendedMaxTriPairsForPartCount(2)).toBeGreaterThanOrEqual(100_000);
    expect(recommendedMaxTriPairsForPartCount(3)).toBeGreaterThan(recommendedMaxTriPairsForPartCount(20));
  });

  it('never goes below default floor for large n', () => {
    expect(recommendedMaxTriPairsForPartCount(200)).toBe(50_000);
  });
});
