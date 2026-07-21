/**
 * civil/module.test.ts — Batch 2 토목 봉합 acceptance.
 *
 * The FIRST non-mechanical domain runs the full driver end-to-end through the
 * shared `runDomainDriver` spine: civil brief → structural plan → demand build →
 * code-check gates (eng-domain/civil) → verified structural package. Proves the
 * DomainModule abstraction (S1) carries a real second domain, not just a toy —
 * and that the honesty invariants (measured gates, refusal IR) hold across it.
 *
 * Cross-check (hand-calc, W6.0 UDL20 beam, Z=1.5e6 mm³, I=3e8 mm⁴, E=200 GPa):
 *   bending: M = 20·6²/8 = 90 kN·m → σ = 90e6/1.5e6 = 60 MPa (≤ 160, pass).
 *   deflection: δ = 5·20·6000⁴/(384·200000·3e8) = 5.625 mm (≤ 6000/360 = 16.67, pass).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { civilModule, steelBeamPlan } from '../module';

describe('Batch 2 — civil DomainModule runs end-to-end via the shared spine', () => {
  it('steel-beam fixture → all structural gates pass → verified calc package', async () => {
    const res = await runDomainDriver(
      { id: 'steel-beam', text: 'a 6 m floor beam under 20 kN/m', params: { fixture: 'steel-beam' } },
      civilModule,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('civil');
    expect(res.gates.every((g) => g.pass)).toBe(true);

    // Two gates on the one member: bending + deflection.
    const bending = res.gates.find((g) => g.id === 'structural:B1:beam-bending-stress')!;
    const deflection = res.gates.find((g) => g.id === 'structural:B1:beam-deflection')!;
    expect(bending.metrics.bendingStress_MPa).toBeCloseTo(60, 3);
    expect(bending.metrics.moment_kNm).toBeCloseTo(90, 3);
    expect(deflection.metrics.deflection_mm).toBeCloseTo(5.625, 3);
    expect(deflection.metrics.deflectionLimit_mm).toBeCloseTo(16.667, 2);

    // Package = a real structural calc report with the disclosure.
    const m = res.package.members[0]!;
    expect(m.id).toBe('B1');
    expect(m.demandMomentKNm).toBeCloseTo(90, 3);
    expect(m.checks).toHaveLength(2);
    expect(m.checks.every((c) => c.pass)).toBe(true);
    expect(res.package.disclaimer).toContain('면허');
  });

  it('an over-stressed beam is REFUSED (bending demand > allowable → 패키지 미산출)', async () => {
    const plan = steelBeamPlan();
    (plan.members[0]!.load as { type: 'udl'; w_kNpm: number; span_m: number }).w_kNpm = 60; // M=270 → σ=180>160
    const res = await runDomainDriver({ id: 'over-stress' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('structural:B1:beam-bending-stress');
  });

  it('an over-deflected beam is REFUSED (δ > L/360, bending still ok)', async () => {
    const plan = steelBeamPlan();
    plan.members[0]!.inertiaMm4 = 1e8; // δ = 16.875 mm > 16.667; Z unchanged → bending passes
    const res = await runDomainDriver({ id: 'over-defl' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('structural:B1:beam-deflection');
    expect(res.refusal.failedGateIds).not.toContain('structural:B1:beam-bending-stress');
  });

  it('an unknown brief is REFUSED at the plan stage (계획 날조 금지)', async () => {
    const res = await runDomainDriver({ id: 'nope', params: { fixture: 'nonexistent' } }, civilModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });
});
