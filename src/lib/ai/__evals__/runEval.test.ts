/**
 * AI eval harness end-to-end (S4) — verifies the orchestrator wires the
 * extractor → scorer → summary correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  runEval,
  makeOracleExtractor,
  makeNoiseExtractor,
  type IntentExtractor,
} from './runEval';
import { SCAD_INTENT_EVALSET } from './scad-intent-evalset';

describe('runEval (S4)', () => {
  it('oracle extractor → 100% pass rate', async () => {
    const summary = await runEval(makeOracleExtractor());
    expect(summary.passed).toBe(SCAD_INTENT_EVALSET.length);
    expect(summary.failed).toBe(0);
    expect(summary.passRate).toBe(1);
  });

  it('noise extractor → 0% pass rate', async () => {
    const summary = await runEval(makeNoiseExtractor());
    expect(summary.passed).toBe(0);
    expect(summary.passRate).toBe(0);
    expect(summary.failed).toBe(SCAD_INTENT_EVALSET.length);
  });

  it('throwing extractor → all failures with typed messages', async () => {
    const broken: IntentExtractor = async () => {
      throw new Error('LLM offline');
    };
    const summary = await runEval(broken);
    expect(summary.passed).toBe(0);
    for (const r of summary.cases) {
      expect(r.failures.some(f => /LLM offline/.test(f))).toBe(true);
    }
  });

  it('id filter narrows the run', async () => {
    const summary = await runEval(makeOracleExtractor(), {
      ids: ['ko_box_30mm', 'en_cylinder'],
    });
    expect(summary.total).toBe(2);
  });

  it('lang filter narrows to KO only', async () => {
    const summary = await runEval(makeOracleExtractor(), { lang: 'ko' });
    expect(summary.total).toBe(SCAD_INTENT_EVALSET.filter(c => c.lang === 'ko').length);
    expect(summary.byLang.en.total).toBe(0);
  });

  it('concurrency=4 produces same result as concurrency=1', async () => {
    const a = await runEval(makeOracleExtractor(), { concurrency: 1 });
    const b = await runEval(makeOracleExtractor(), { concurrency: 4 });
    expect(a.passed).toBe(b.passed);
    expect(a.passRate).toBe(b.passRate);
  });

  it('progress callback fires once per case', async () => {
    const seen: number[] = [];
    const summary = await runEval(makeOracleExtractor(), {
      ids: ['ko_box_30mm', 'ko_cylinder'],
      onProgress: (_, idx) => seen.push(idx),
    });
    expect(summary.total).toBe(2);
    expect(seen.sort()).toEqual([0, 1]);
  });

  it('mixed extractor (oracle for half, noise for half) gives ~50% pass', async () => {
    let i = 0;
    const oracle = makeOracleExtractor();
    const noise = makeNoiseExtractor();
    const mixed: IntentExtractor = async (p) => {
      i++;
      return i % 2 === 0 ? oracle(p) : noise(p);
    };
    const summary = await runEval(mixed);
    expect(summary.passRate).toBeGreaterThan(0.3);
    expect(summary.passRate).toBeLessThan(0.7);
  });
});
