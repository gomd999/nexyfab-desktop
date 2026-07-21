/**
 * interior/module.test.ts — Batch 2 인테리어 봉합 acceptance.
 *
 * The interior domain runs the full driver via the shared spine: brief → space
 * plan → occupancy build → building-code gate chain → verified compliance
 * package. The occupant load computed in build (500 m² business / 13.935 =
 * ceil = 36) feeds the egress-width + plumbing gates — a real derived-quantity
 * chain across the shared `runDomainDriver`.
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { interiorModule, officeFloorPlan } from '../module';

describe('Batch 2 — interior DomainModule runs end-to-end via the shared spine', () => {
  it('office-floor fixture → all code gates pass → verified compliance package', async () => {
    const res = await runDomainDriver(
      { id: 'office-floor', text: 'a 500 m² sprinklered office floor', params: { fixture: 'office-floor' } },
      interiorModule,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('interior');
    expect(res.gates.every((g) => g.pass)).toBe(true);
    expect(res.gates).toHaveLength(6); // occupancy, travel, egress-width, corridor, plumbing, ceiling

    const occ = res.gates.find((g) => g.id === 'code:F1:occupancy-load')!;
    expect(occ.metrics.occupantLoad).toBe(36); // ceil(500 / (150·0.092903))

    const space = res.package.spaces[0]!;
    expect(space.occupantLoad).toBe(36);
    expect(space.checks).toHaveLength(6);
    expect(space.checks.every((c) => c.pass)).toBe(true);
    expect(res.package.disclaimer).toContain('건축사');
  });

  it('an over-length egress path is REFUSED (travel > code limit → 패키지 미산출)', async () => {
    const plan = officeFloorPlan();
    plan.spaces[0]!.measuredTravelM = 120; // > business sprinklered 91.44 m
    const res = await runDomainDriver({ id: 'over-travel' }, { ...interiorModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('code:F1:egress-travel-distance');
  });

  it('insufficient egress width for the computed occupancy is REFUSED', async () => {
    const plan = officeFloorPlan();
    plan.spaces[0]!.providedEgressWidthMm = 100; // < 36 × 5.08 = 182.88 mm
    const res = await runDomainDriver({ id: 'narrow-egress' }, { ...interiorModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('code:F1:egress-width');
  });

  it('an unknown brief is REFUSED at the plan stage', async () => {
    const res = await runDomainDriver({ id: 'nope', params: { fixture: 'nonexistent' } }, interiorModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });
});
