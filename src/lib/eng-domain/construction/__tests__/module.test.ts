/**
 * construction/module.test.ts — Batch 3 건설 봉합 acceptance.
 *
 * The construction domain runs the full driver via the shared spine: brief →
 * project plan → quantity/schedule build → takeoff + CPM gates → verified
 * quantity package. 건설 단계 1 → 2~3 (first project class).
 *
 * Cross-check (RC frame): concrete = 2·(0.3·0.6·6) + 2·(0.4·0.4·3) = 2.16 + 0.96
 * = 3.12 m³; critical path = 5 + 6 = 11 days.
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { constructionModule, rcFramePlan } from '../module';

describe('Batch 3 — construction DomainModule runs end-to-end via the shared spine', () => {
  it('rc-frame fixture → all quantity/schedule gates pass → verified package', async () => {
    const res = await runDomainDriver(
      { id: 'rc-frame', text: 'a 2-beam 2-column RC bay', params: { fixture: 'rc-frame' } },
      constructionModule,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('construction');
    expect(res.gates.every((g) => g.pass)).toBe(true);
    expect(res.gates).toHaveLength(3);

    expect(res.package.concreteVolumeM3).toBeCloseTo(3.12, 6);
    expect(res.package.criticalPathDays).toBe(11);
    expect(res.package.rebarWeightKg).toBeGreaterThan(0);
    expect(res.package.disclaimer).toContain('구조기술사');
  });

  it('under-ordered concrete is REFUSED (ordered < computed × waste → 패키지 미산출)', async () => {
    const plan = rcFramePlan();
    plan.claimedConcreteM3 = 2.0; // < required 3.276
    const res = await runDomainDriver({ id: 'short-order' }, { ...constructionModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('quantity:concrete');
  });

  it('a schedule exceeding the deadline is REFUSED', async () => {
    const plan = rcFramePlan();
    plan.deadlineDays = 8; // critical path 11 > 8
    const res = await runDomainDriver({ id: 'late' }, { ...constructionModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('schedule:critical-path');
  });

  it('an unknown brief is REFUSED at the plan stage', async () => {
    const res = await runDomainDriver({ id: 'nope', params: { fixture: 'nonexistent' } }, constructionModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });
});
