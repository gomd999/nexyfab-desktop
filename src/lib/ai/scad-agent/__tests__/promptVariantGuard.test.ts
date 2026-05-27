import { describe, it, expect } from 'vitest';
import { judgeVariants, actionableVerdicts, type EvalSnapshot } from '../promptVariantGuard';

const baselineSnap = (passRate: number, totalCases = 50, ts = 100): EvalSnapshot => ({
  promptId: 'shape-chat',
  passRate,
  totalCases,
  timestamp: ts,
});

const variantSnap = (passRate: number, totalCases = 50, ts = 200): EvalSnapshot => ({
  promptId: 'shape-chat:terse-v2',
  passRate,
  totalCases,
  timestamp: ts,
});

describe('judgeVariants · decision matrix', () => {
  it('returns ok when variant matches baseline within tolerance', () => {
    const v = judgeVariants([baselineSnap(0.85), variantSnap(0.84)]);
    expect(v).toHaveLength(1);
    expect(v[0].decision).toBe('ok');
  });

  it('returns warn when variant drops 5–15 pp below baseline', () => {
    const v = judgeVariants([baselineSnap(0.90), variantSnap(0.80)]);
    expect(v[0].decision).toBe('warn');
    expect(v[0].reason).toContain('10.0 pp');
  });

  it('returns disable when variant drops ≥ 15 pp', () => {
    const v = judgeVariants([baselineSnap(0.90), variantSnap(0.70)]);
    expect(v[0].decision).toBe('disable');
    expect(v[0].reason).toContain('20.0 pp');
  });

  it('returns insufficient_data when below minCases', () => {
    const v = judgeVariants([baselineSnap(0.90, 5), variantSnap(0.50, 8)]);
    expect(v[0].decision).toBe('insufficient_data');
  });

  it('returns insufficient_data when baseline snapshot is missing', () => {
    const v = judgeVariants([variantSnap(0.80, 50)]);
    expect(v[0].decision).toBe('insufficient_data');
    expect(v[0].reason).toContain('no baseline snapshot');
  });

  it('skips baseline-only snapshots (no variants present)', () => {
    expect(judgeVariants([baselineSnap(0.90)])).toHaveLength(0);
  });

  it('uses the most recent snapshot per promptId when multiple supplied', () => {
    // Two snapshots for the same variant — newer one wins.
    const v = judgeVariants([
      baselineSnap(0.90),
      { ...variantSnap(0.50), timestamp: 100 },
      { ...variantSnap(0.85), timestamp: 300 }, // most recent
    ]);
    expect(v[0].variantPassRate).toBe(0.85);
    expect(v[0].decision).toBe('ok');
  });

  it('respects custom thresholds', () => {
    // With tighter thresholds, a 3 pp drop should trigger warn.
    const v = judgeVariants(
      [baselineSnap(0.90), variantSnap(0.87)],
      { warnDropThreshold: 0.02, disableDropThreshold: 0.05 },
    );
    expect(v[0].decision).toBe('warn');
  });
});

describe('actionableVerdicts', () => {
  it('filters to disable + warn', () => {
    const verdicts = judgeVariants([
      baselineSnap(0.90),
      variantSnap(0.85),                                    // ok
      { ...variantSnap(0.70), promptId: 'shape-chat:bad' }, // disable
      { ...variantSnap(0.83), promptId: 'shape-chat:mid' }, // warn
    ]);
    const action = actionableVerdicts(verdicts);
    expect(action.length).toBe(2);
    expect(action.map(a => a.decision).sort()).toEqual(['disable', 'warn']);
  });

  it('returns empty array when nothing actionable', () => {
    const verdicts = judgeVariants([baselineSnap(0.90), variantSnap(0.89)]);
    expect(actionableVerdicts(verdicts)).toEqual([]);
  });
});
