import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub the DB so we can hand-feed prompt_call rows per test.
const userRows = new Map<string, Array<{ metadata: string; created_at?: number }>>();

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    async queryAll<T>(sql: string, ...args: unknown[]): Promise<T[]> {
      if (/FROM nf_usage_events/i.test(sql)) {
        const userId = String(args[0]);
        const rows = userRows.get(userId) ?? [];
        // Mock now provides created_at in addition to metadata.
        return rows.map(r => ({ created_at: r.created_at ?? Date.now(), metadata: r.metadata })) as unknown as T[];
      }
      return [];
    },
    async queryOne<T>(): Promise<T | null> { return null; },
    async execute(): Promise<void> {},
  }),
}));

import { checkUserBudget, _clearUserBudgetCacheForTests } from '../userBudget';

describe('checkUserBudget', () => {
  let savedLimit: string | undefined;

  beforeEach(() => {
    userRows.clear();
    _clearUserBudgetCacheForTests();
    savedLimit = process.env.COST_BUDGET_USD_PER_USER_DAILY;
    delete process.env.COST_BUDGET_USD_PER_USER_DAILY;
  });
  afterEach(() => {
    if (savedLimit === undefined) delete process.env.COST_BUDGET_USD_PER_USER_DAILY;
    else process.env.COST_BUDGET_USD_PER_USER_DAILY = savedLimit;
  });

  it('returns ok with no-limit source when env unset', async () => {
    const r = await checkUserBudget('u-1');
    expect(r.ok).toBe(true);
    expect(r.limitUsd).toBeNull();
    expect(r.source).toBe('no-limit');
  });

  it('returns ok when usage under limit', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5'; // $5 = 500c
    userRows.set('u-1', [
      { metadata: JSON.stringify({ costCents: 100 }) },
      { metadata: JSON.stringify({ costCents: 50 }) },
    ]);
    const r = await checkUserBudget('u-1');
    expect(r.ok).toBe(true);
    expect(r.usedCents).toBe(150);
    expect(r.limitUsd).toBe(5);
    expect(r.source).toBe('db');
  });

  it('returns not-ok when usage at or above limit', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '1'; // $1 = 100c
    userRows.set('u-2', [
      { metadata: JSON.stringify({ costCents: 60 }) },
      { metadata: JSON.stringify({ costCents: 50 }) },
    ]);
    const r = await checkUserBudget('u-2');
    expect(r.ok).toBe(false);
    expect(r.usedCents).toBe(110);
  });

  it('zero/missing costCents rows do not affect total', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '1';
    userRows.set('u-3', [
      { metadata: JSON.stringify({ costCents: 50 }) },
      { metadata: JSON.stringify({ costCents: 0 }) },
      { metadata: JSON.stringify({ /* no cost */ }) },
      { metadata: JSON.stringify({ costCents: -5 }) },
    ]);
    const r = await checkUserBudget('u-3');
    expect(r.usedCents).toBe(50);
    expect(r.ok).toBe(true);
  });

  it('caches reads — second call uses cache', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5';
    userRows.set('u-4', [{ metadata: JSON.stringify({ costCents: 50 }) }]);
    const a = await checkUserBudget('u-4');
    expect(a.source).toBe('db');

    // Mutate row data — cache must shield us from seeing it within TTL.
    userRows.set('u-4', [{ metadata: JSON.stringify({ costCents: 99999 }) }]);
    const b = await checkUserBudget('u-4');
    expect(b.source).toBe('cache');
    expect(b.usedCents).toBe(50);
  });

  it('different users have independent budgets', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '1';
    userRows.set('u-a', [{ metadata: JSON.stringify({ costCents: 200 }) }]);
    userRows.set('u-b', [{ metadata: JSON.stringify({ costCents: 50 }) }]);

    const a = await checkUserBudget('u-a');
    const b = await checkUserBudget('u-b');
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });

  it('zero or negative limit is treated as disabled', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '0';
    const r = await checkUserBudget('u-z');
    expect(r.ok).toBe(true);
    expect(r.source).toBe('no-limit');
  });

  it('non-numeric limit is treated as disabled', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = 'not-a-number';
    const r = await checkUserBudget('u-n');
    expect(r.ok).toBe(true);
    expect(r.source).toBe('no-limit');
  });

  it('returns resetAtMs when oldest event known', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5';
    const t1 = Date.now() - 12 * 60 * 60 * 1000;  // 12h ago
    const t2 = Date.now() - 6 * 60 * 60 * 1000;   // 6h ago
    userRows.set('u-r', [
      { created_at: t2, metadata: JSON.stringify({ costCents: 100 }) },
      { created_at: t1, metadata: JSON.stringify({ costCents: 100 }) },
    ]);
    const r = await checkUserBudget('u-r');
    // Oldest event (t1) plus 24h = expected reset.
    expect(r.resetAtMs).toBe(t1 + 24 * 60 * 60 * 1000);
  });

  it('resetAtMs is null when no billed events exist', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5';
    userRows.set('u-empty', []);
    const r = await checkUserBudget('u-empty');
    expect(r.resetAtMs).toBeNull();
  });

  it('resetAtMs is null when limit is unset', async () => {
    const r = await checkUserBudget('u-no-limit');
    expect(r.resetAtMs).toBeNull();
  });

  it('approaching=false at low usage', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5';
    userRows.set('u-low', [{ metadata: JSON.stringify({ costCents: 100 }) }]);
    const r = await checkUserBudget('u-low');
    expect(r.fraction).toBeCloseTo(0.2, 2);
    expect(r.approaching).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('approaching=true at ≥80% but ok=true', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5';
    userRows.set('u-warn', [{ metadata: JSON.stringify({ costCents: 420 }) }]);
    const r = await checkUserBudget('u-warn');
    expect(r.fraction).toBeGreaterThanOrEqual(0.8);
    expect(r.approaching).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('approaching=false once over the limit (ok=false instead)', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '5';
    userRows.set('u-over', [{ metadata: JSON.stringify({ costCents: 600 }) }]);
    const r = await checkUserBudget('u-over');
    expect(r.ok).toBe(false);
    expect(r.approaching).toBe(false);
    expect(r.fraction).toBe(1);
  });

  it('BUDGET_WARN_AT overrides default warn fraction', async () => {
    process.env.COST_BUDGET_USD_PER_USER_DAILY = '10';
    process.env.BUDGET_WARN_AT = '0.5';
    userRows.set('u-warn-50', [{ metadata: JSON.stringify({ costCents: 600 }) }]);
    const r = await checkUserBudget('u-warn-50');
    expect(r.approaching).toBe(true);
    delete process.env.BUDGET_WARN_AT;
  });
});
