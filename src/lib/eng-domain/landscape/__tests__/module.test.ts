/**
 * landscape/module.test.ts — Batch 3 조경 봉합 acceptance.
 *
 * The landscape domain runs the full driver via the shared spine: brief → site
 * plan → derived build → design-code gates (irrigation/drainage/planting/green-
 * area/soil) → verified landscape package. 조경(전문가) 단계 0 → 3~4.
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { landscapeModule, parkPlazaPlan } from '../module';

describe('Batch 3 — landscape DomainModule runs end-to-end via the shared spine', () => {
  it('park-plaza fixture → all landscape gates pass → verified package', async () => {
    const res = await runDomainDriver(
      { id: 'park-plaza', text: 'a neighborhood park plaza', params: { fixture: 'park-plaza' } },
      landscapeModule,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('landscape');
    expect(res.gates.every((g) => g.pass)).toBe(true);
    expect(res.gates).toHaveLength(5); // green-area, irrigation, drainage, planting, soil

    expect(res.package.greenRatio).toBeCloseTo(0.2, 6);
    const soil = res.gates.find((g) => g.id === 'landscape:soil:soil-depth')!;
    expect(soil.pass).toBe(true);
    expect(res.package.checks).toHaveLength(5);
    expect(res.package.disclaimer).toContain('조례');
  });

  it('insufficient irrigation coverage is REFUSED (ratio < uniformity → 패키지 미산출)', async () => {
    const plan = parkPlazaPlan();
    plan.irrigation.headCount = 5; // effective ≈ 77.7 m² / 300 = 0.26 < 0.9
    const res = await runDomainDriver({ id: 'dry' }, { ...landscapeModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('landscape:irrigation:irrigation-coverage');
  });

  it('shallow planting soil is REFUSED (교목 depth < 1.0 m 표 3.1-1)', async () => {
    const plan = parkPlazaPlan();
    plan.soil.providedDepthM = 0.5; // < 1.0 m for 교목
    const res = await runDomainDriver({ id: 'shallow' }, { ...landscapeModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('landscape:soil:soil-depth');
  });

  it('an unknown brief is REFUSED at the plan stage', async () => {
    const res = await runDomainDriver({ id: 'nope', params: { fixture: 'nonexistent' } }, landscapeModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });
});
