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
  it('rc-frame fixture → concrete/rebar/schedule/formwork/cost/earthwork gates pass → verified package', async () => {
    const res = await runDomainDriver(
      { id: 'rc-frame', text: 'a 2-beam 2-column RC bay', params: { fixture: 'rc-frame' } },
      constructionModule,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('construction');
    expect(res.gates.every((g) => g.pass), res.gates.filter((g) => !g.pass).map((g) => g.id).join(',')).toBe(true);
    expect(res.gates).toHaveLength(6); // 어휘 확장: + formwork, cost, earthwork

    expect(res.package.concreteVolumeM3).toBeCloseTo(3.12, 6);
    expect(res.package.criticalPathDays).toBe(11);
    expect(res.package.rebarWeightKg).toBeGreaterThan(0);
    // formwork = beams 9×2 + columns 4.8×2 = 27.6 m²
    expect(res.gates.find((g) => g.id === 'quantity:formwork')!.metrics.computedArea_m2).toBeCloseTo(27.6, 4);
    expect(res.gates.find((g) => g.id === 'earthwork:cut-fill')!.pass).toBe(true);
    expect(res.package.disclaimer).toContain('구조기술사');
  });

  it('an over-budget cost rollup is REFUSED (어휘 확장)', async () => {
    const plan = rcFramePlan();
    plan.budget = 1_000_000; // total ≈ 2.89M > 1.0M
    const res = await runDomainDriver({ id: 'over-budget' }, { ...constructionModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('cost:rollup');
  });

  it('under-ordered concrete is AUTO-RECONCILED to the takeoff (Step ② — 검토 플래그 동반)', async () => {
    // BEHAVIOR CHANGE (Step ②): an under-ORDERED quantity is not a design flaw — the
    // geometry-derived takeoff is authoritative, so the driver computes the correct
    // order and re-verifies, surfacing the change as a reviewable adjustment (형상 불변).
    const plan = rcFramePlan();
    plan.claimedConcreteM3 = 2.0; // < required 3.276
    const res = await runDomainDriver({ id: 'short-order' }, { ...constructionModule, plan: () => plan });
    expect(res.ok, res.ok ? '' : res.refusal.reason).toBe(true);
    if (!res.ok) return;
    // the package is produced BUT carries the reconcile adjustment for human review
    expect(res.adjustments?.length).toBe(1);
    const adj = res.adjustments![0]!;
    expect(adj.target).toBe('claimedConcreteM3');
    expect(adj.from).toBe(2.0);
    expect(adj.to).toBeGreaterThanOrEqual(3.276); // rounded UP to cover the takeoff
    expect(adj.kind).toBe('reconcile');
  });

  it('a MATCH-checksum mismatch (rebar) is still REFUSED, NOT auto-overwritten (정직)', async () => {
    // A pure |computed − claimed| divergence is a possible data-entry error a human
    // must see — auto-fix deliberately does NOT silently overwrite it.
    const plan = rcFramePlan();
    plan.claimedRebarKg = 100; // ≠ computed (~295), well beyond tolerance
    const res = await runDomainDriver({ id: 'rebar-mismatch' }, { ...constructionModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.failedGateIds).toContain('quantity:rebar');
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
