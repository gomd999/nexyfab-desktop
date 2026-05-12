import { describe, it, expect, beforeEach, vi } from 'vitest';

const tables = new Map<string, Map<string, Record<string, unknown>>>();
function getOrCreateTable(name: string) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name)!;
}

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]): Promise<void> {
      if (/INSERT INTO nf_funnel_event/i.test(sql)) {
        const t = getOrCreateTable('nf_funnel_event');
        const [id, user_id, event_type, context_type, context_id, metadata, created_at, session_id] = args as [string, string, string, string | null, string | null, string | null, number, string | null];
        t.set(id, { id, user_id, event_type, context_type, context_id, metadata, created_at, session_id });
      }
    },
    async queryAll<T>(sql: string, ...args: unknown[]): Promise<T[]> {
      // signup_complete metadata query for getOnboardingFunnelBySource step 1.
      if (/SELECT\s+user_id,\s+metadata\s+FROM nf_funnel_event/i.test(sql)) {
        const t = getOrCreateTable('nf_funnel_event');
        const rows = Array.from(t.values()) as Array<{ user_id: string; event_type: string; metadata: string | null; created_at: number }>;
        const since = args[0] as number;
        const until = args[1] as number;
        return rows
          .filter(r => r.event_type === 'signup_complete' && r.created_at >= since && r.created_at <= until)
          .map(r => ({ user_id: r.user_id, metadata: r.metadata })) as unknown as T[];
      }
      // Aggregate query — used by both getOnboardingFunnel and the cohort
      // variant. The cohort variant adds `user_id IN (?,?,...)` after the
      // since/until args, so we sniff the SQL and apply that filter.
      if (/COUNT\(DISTINCT user_id\)/i.test(sql) && /FROM nf_funnel_event/i.test(sql)) {
        const t = getOrCreateTable('nf_funnel_event');
        const rows = Array.from(t.values()) as Array<{ user_id: string; event_type: string; created_at: number }>;
        const since = args[0] as number;
        const until = args[1] as number;
        const cohort = /user_id\s+IN\s*\(/i.test(sql)
          ? new Set((args.slice(2) as unknown[]).map(String))
          : null;
        const inWin = rows.filter(r =>
          r.created_at >= since && r.created_at <= until
          && (!cohort || cohort.has(r.user_id))
        );
        const byType = new Map<string, { unique: Set<string>; count: number }>();
        for (const r of inWin) {
          let v = byType.get(r.event_type);
          if (!v) { v = { unique: new Set(), count: 0 }; byType.set(r.event_type, v); }
          v.unique.add(r.user_id);
          v.count += 1;
        }
        return Array.from(byType.entries()).map(([event_type, v]) => ({
          event_type,
          unique_users: v.unique.size,
          total_events: v.count,
        })) as unknown as T[];
      }
      return [];
    },
    async queryOne<T>(): Promise<T | null> { return null; },
  }),
}));

import { logFunnelEvent, getOnboardingFunnel, getOnboardingFunnelBySource } from '../funnel-logger';

describe('funnel-logger onboarding', () => {
  beforeEach(() => { tables.clear(); });

  it('aggregates unique users + conversion across steps', async () => {
    // Three users hit signup, two of them open the generator, one creates a shape.
    await logFunnelEvent('u1', { eventType: 'signup_complete' });
    await logFunnelEvent('u2', { eventType: 'signup_complete' });
    await logFunnelEvent('u3', { eventType: 'signup_complete' });
    await logFunnelEvent('u1', { eventType: 'shape_generator_first_open' });
    await logFunnelEvent('u2', { eventType: 'shape_generator_first_open' });
    await logFunnelEvent('u1', { eventType: 'first_shape_created' });

    const steps = await getOnboardingFunnel({});
    const byType = new Map(steps.map(s => [s.eventType, s]));
    expect(byType.get('signup_complete')?.uniqueUsers).toBe(3);
    expect(byType.get('shape_generator_first_open')?.uniqueUsers).toBe(2);
    expect(byType.get('first_shape_created')?.uniqueUsers).toBe(1);

    // Conversion: 2/3 then 1/2.
    expect(byType.get('shape_generator_first_open')?.conversionFromPrev).toBeCloseTo(2 / 3, 3);
    expect(byType.get('first_shape_created')?.conversionFromPrev).toBeCloseTo(1 / 2, 3);
  });

  it('first step has null conversion (no previous to compare)', async () => {
    await logFunnelEvent('u1', { eventType: 'signup_complete' });
    const steps = await getOnboardingFunnel({});
    expect(steps[0].eventType).toBe('signup_complete');
    expect(steps[0].conversionFromPrev).toBeNull();
  });

  it('zero-user step keeps subsequent conversions at 0', async () => {
    // Nobody signed up — but we recorded a downstream event somehow.
    await logFunnelEvent('u1', { eventType: 'first_save' });
    const steps = await getOnboardingFunnel({});
    const byType = new Map(steps.map(s => [s.eventType, s]));
    expect(byType.get('signup_complete')?.uniqueUsers).toBe(0);
    // first_save gets a conversion-from-prev value, but the prev step had 0
    // users — division by zero is suppressed to 0 instead of NaN.
    expect(byType.get('first_save')?.conversionFromPrev).toBe(0);
  });

  it('empty funnel returns all-zero steps', async () => {
    const steps = await getOnboardingFunnel({});
    expect(steps).toHaveLength(7);
    expect(steps.every(s => s.uniqueUsers === 0)).toBe(true);
  });

  describe('getOnboardingFunnelBySource', () => {
    it('filters cohort to users whose signup_complete carried matching utm.source', async () => {
      // Two users from google ads, one from naver, one direct.
      await logFunnelEvent('u-g1', { eventType: 'signup_complete', metadata: { utm: { source: 'google' } } });
      await logFunnelEvent('u-g2', { eventType: 'signup_complete', metadata: { utm: { source: 'google' } } });
      await logFunnelEvent('u-n1', { eventType: 'signup_complete', metadata: { utm: { source: 'naver' } } });
      await logFunnelEvent('u-d1', { eventType: 'signup_complete' });
      // Activity events
      await logFunnelEvent('u-g1', { eventType: 'shape_generator_first_open' });
      await logFunnelEvent('u-n1', { eventType: 'shape_generator_first_open' });
      await logFunnelEvent('u-d1', { eventType: 'shape_generator_first_open' });

      const google = await getOnboardingFunnelBySource('google');
      const byType = new Map(google.map(s => [s.eventType, s]));
      expect(byType.get('signup_complete')?.uniqueUsers).toBe(2);
      // Only u-g1 (of the two google signups) opened the generator.
      expect(byType.get('shape_generator_first_open')?.uniqueUsers).toBe(1);
      expect(byType.get('shape_generator_first_open')?.conversionFromPrev).toBeCloseTo(0.5, 3);
    });

    it('"(direct)" matches signups without utm.source', async () => {
      await logFunnelEvent('u-d1', { eventType: 'signup_complete' });
      await logFunnelEvent('u-g1', { eventType: 'signup_complete', metadata: { utm: { source: 'google' } } });

      const direct = await getOnboardingFunnelBySource('(direct)');
      expect(direct[0].uniqueUsers).toBe(1);
    });

    it('returns zero-rows for an unknown source (no crash)', async () => {
      await logFunnelEvent('u1', { eventType: 'signup_complete', metadata: { utm: { source: 'google' } } });
      const naver = await getOnboardingFunnelBySource('naver');
      expect(naver).toHaveLength(7);
      expect(naver.every(s => s.uniqueUsers === 0)).toBe(true);
    });
  });

  it('window filter excludes events outside sinceMs/untilMs', async () => {
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    // Manually inject an old event to bypass logFunnelEvent's now() timestamp.
    getOrCreateTable('nf_funnel_event').set('old-1', {
      id: 'old-1', user_id: 'u1', event_type: 'signup_complete',
      context_type: null, context_id: null, metadata: null,
      created_at: old, session_id: null,
    });
    await logFunnelEvent('u2', { eventType: 'signup_complete' });

    const recent = await getOnboardingFunnel({ sinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000 });
    expect(recent[0].uniqueUsers).toBe(1);  // only u2 in last week

    const all = await getOnboardingFunnel({ sinceMs: 0 });
    expect(all[0].uniqueUsers).toBe(2);
  });
});
