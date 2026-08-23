import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executions: [] as Array<{ sql: string; args: unknown[] }>,
  queries: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('./db-adapter', () => ({
  getDbAdapter: () => ({
    execute: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.executions.push({ sql, args });
      return { changes: 1 };
    }),
    queryAll: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.queries.push({ sql, args });
      return [];
    }),
  }),
}));

import { deleteReview, listReviews, saveReview } from './design-reviews';

beforeEach(() => {
  state.executions.length = 0;
  state.queries.length = 0;
});

describe('design review workspace isolation', () => {
  it('lists personal history without organization rows', async () => {
    await listReviews('user-a', 10, null);
    expect(state.queries[0]?.sql).toContain('user_id = ? AND org_id IS NULL');
    expect(state.queries[0]?.args).toEqual(['user-a', 10]);
  });

  it('lists an active organization independent of the acting member', async () => {
    await listReviews('user-a', 10, 'org-a');
    expect(state.queries[0]?.sql).toContain('org_id = ?');
    expect(state.queries[0]?.args).toEqual(['org-a', 10]);
  });

  it('stores and deletes with the exact organization context', async () => {
    await saveReview({
      id: 'review-a', userId: 'user-a', orgId: 'org-a', filename: 'part.step',
      material: '6061', process: 'cnc', metrics: {}, report: { ok: true },
    });
    await deleteReview('user-a', 'review-a', 'org-a');

    const insert = state.executions.find(row => row.sql.includes('INSERT INTO nf_design_reviews'));
    const remove = state.executions.find(row => row.sql.includes('DELETE FROM nf_design_reviews'));
    expect(insert?.args.slice(0, 3)).toEqual(['review-a', 'user-a', 'org-a']);
    expect(remove?.sql).toContain('org_id = ?');
    expect(remove?.args).toEqual(['review-a', 'org-a']);
  });
});
