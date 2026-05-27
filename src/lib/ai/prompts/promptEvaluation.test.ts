import { describe, it, expect } from 'vitest';
import {
  evaluateVariant,
  compareVariants,
  aggregateRegistryEval,
  type GoldenCase,
} from './promptEvaluation';

interface ShapeIn { shape: string }
interface ShapeOut { ok: boolean; volume?: number }

const cases: Array<GoldenCase<ShapeIn, ShapeOut>> = [
  { id: 'c1', description: 'cube ok', input: { shape: 'cube' }, check: o => o.ok === true },
  { id: 'c2', description: 'sphere ok', input: { shape: 'sphere' }, check: o => o.ok === true },
  { id: 'c3', description: 'unknown rejected', input: { shape: 'kumquat' }, check: o => o.ok === false },
];

describe('evaluateVariant', () => {
  it('all-passing runner → passRate 1.0', async () => {
    const runner = async (i: ShapeIn): Promise<ShapeOut> => ({ ok: i.shape !== 'kumquat' });
    const r = await evaluateVariant('shape-test', 'baseline', runner, cases);
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.passRate).toBe(1);
  });

  it('records error case as errored', async () => {
    const runner = async (i: ShapeIn): Promise<ShapeOut> => {
      if (i.shape === 'sphere') throw new Error('boom');
      return { ok: i.shape !== 'kumquat' };
    };
    const r = await evaluateVariant('shape-test', 'bad', runner, cases);
    expect(r.errored).toBe(1);
    expect(r.passRate).toBeLessThan(1);
  });

  it('records mismatch as failed', async () => {
    const runner = async (): Promise<ShapeOut> => ({ ok: true });
    const r = await evaluateVariant('shape-test', 'broken', runner, cases);
    // c3 expected ok=false but got true → fail.
    expect(r.failed).toBe(1);
    expect(r.passed).toBe(2);
  });

  it('emits durationMs per case', async () => {
    const runner = async (i: ShapeIn): Promise<ShapeOut> => ({ ok: i.shape !== 'kumquat' });
    const r = await evaluateVariant('shape-test', 'baseline', runner, cases);
    for (const c of r.cases) {
      expect(typeof c.durationMs).toBe('number');
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('compareVariants', () => {
  it('throws when promptIds differ', async () => {
    const r = await evaluateVariant('A', 'b', async () => ({ ok: true }), cases);
    const r2 = await evaluateVariant('B', 'c', async () => ({ ok: true }), cases);
    expect(() => compareVariants(r, r2)).toThrow();
  });

  it('safe-to-rollout when no regressions + delta ≥ 0', async () => {
    const baseline = await evaluateVariant('p', 'base', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const candidate = await evaluateVariant('p', 'cand', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const r = compareVariants(baseline, candidate);
    expect(r.regressed).toHaveLength(0);
    expect(r.recommendation).toBe('safe-to-rollout');
  });

  it('do-not-rollout on regression', async () => {
    const baseline = await evaluateVariant('p', 'base', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    // Candidate breaks c1 (cube).
    const candidate = await evaluateVariant('p', 'cand', async (i: ShapeIn) => ({ ok: i.shape === 'sphere' || i.shape === 'kumquat' ? i.shape === 'sphere' : false }), cases);
    const r = compareVariants(baseline, candidate);
    expect(r.regressed.length).toBeGreaterThan(0);
    expect(r.recommendation).toBe('do-not-rollout');
  });

  it('reports improvements', async () => {
    // Baseline fails c1.
    const baseline = await evaluateVariant('p', 'base', async (i: ShapeIn) => ({ ok: i.shape === 'sphere' || (i.shape === 'kumquat' ? false : false) }), cases);
    // Candidate fixes c1.
    const candidate = await evaluateVariant('p', 'cand', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const r = compareVariants(baseline, candidate);
    expect(r.improved.length).toBeGreaterThan(0);
  });

  it('passRateDeltaPp computed correctly', async () => {
    const baseline = await evaluateVariant('p', 'base', async () => ({ ok: false }), cases);
    const candidate = await evaluateVariant('p', 'cand', async () => ({ ok: false }), cases);
    const r = compareVariants(baseline, candidate);
    expect(r.passRateDeltaPp).toBe(0);
  });
});

describe('aggregateRegistryEval', () => {
  it('allSafeToRollout false if any prompt is risky', async () => {
    const goodBase = await evaluateVariant('p1', 'base', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const goodCand = await evaluateVariant('p1', 'cand', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const badBase = await evaluateVariant('p2', 'base', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const badCand = await evaluateVariant('p2', 'cand', async () => ({ ok: true }), cases); // breaks c3
    const r = aggregateRegistryEval([
      { baseline: goodBase, variant: goodCand },
      { baseline: badBase, variant: badCand },
    ]);
    expect(r.allSafeToRollout).toBe(false);
  });

  it('weightedDeltaPp factors total case counts', async () => {
    const a = await evaluateVariant('a', 'base', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const aCand = await evaluateVariant('a', 'cand', async (i: ShapeIn) => ({ ok: i.shape !== 'kumquat' }), cases);
    const r = aggregateRegistryEval([{ baseline: a, variant: aCand }]);
    expect(r.weightedDeltaPp).toBe(0);
  });
});
