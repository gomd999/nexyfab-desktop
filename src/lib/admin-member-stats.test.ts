import { describe, expect, it } from 'vitest';
import { normalizeAdminMemberPlanStats, summarizeAdminMembers } from './admin-member-stats';

describe('admin member stats', () => {
  it('normalizes PostgreSQL COUNT strings before summing them', () => {
    const summary = summarizeAdminMembers([
      { plan: 'free', count: '14' },
      { plan: 'pro', count: '2' },
      { plan: 'team', count: '1' },
    ]);

    expect(summary).toMatchObject({ total: 17, paid: 3, free: 14 });
    expect(summary.conversionRate).toBeCloseTo(17.647, 3);
  });

  it('uses safe numeric values for malformed database results', () => {
    expect(normalizeAdminMemberPlanStats([
      { plan: null, count: 'not-a-number' },
      { plan: 'pro', count: -2 },
    ])).toEqual([
      { plan: 'free', count: 0 },
      { plan: 'pro', count: 0 },
    ]);
  });
});
