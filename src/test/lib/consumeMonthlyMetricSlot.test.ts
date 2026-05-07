import { describe, it, expect, vi, beforeEach } from 'vitest';

const txQueryOne = vi.fn();
const txExecute = vi.fn();
const transaction = vi.fn(async (fn: (db: { queryOne: typeof txQueryOne; execute: typeof txExecute }) => Promise<unknown>) =>
  fn({ queryOne: txQueryOne, execute: txExecute }));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({ transaction }),
}));

import { consumeMonthlyMetricSlot } from '@/lib/plan-guard';

describe('consumeMonthlyMetricSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts one row when under free-tier brep limit', async () => {
    txQueryOne.mockResolvedValueOnce({ c: 0 });
    const r = await consumeMonthlyMetricSlot('u1', 'free', 'brep_step_import', { mode: 'async' });
    expect(r.ok).toBe(true);
    expect(r.used).toBe(1);
    expect(txExecute).toHaveBeenCalled();
  });

  it('does not insert when at limit', async () => {
    txQueryOne.mockResolvedValueOnce({ c: 40 });
    const r = await consumeMonthlyMetricSlot('u1', 'free', 'brep_step_import', {});
    expect(r.ok).toBe(false);
    expect(r.limit).toBe(40);
    expect(txExecute).not.toHaveBeenCalled();
  });

  it('is no-op for unlimited plan metrics', async () => {
    const r = await consumeMonthlyMetricSlot('u1', 'pro', 'brep_step_import', {});
    expect(r.ok).toBe(true);
    expect(txExecute).not.toHaveBeenCalled();
  });
});
