/**
 * civil/module.test.ts — Batch 2 토목 봉합 + 어휘 확장 acceptance.
 *
 * The civil domain runs the full driver via the shared `runDomainDriver` spine,
 * now over FOUR member classes (beam · column · retaining-wall · slope) — each
 * its own measured code-check gate. Proves the DomainModule carries a real,
 * WIDENING domain, and that the honesty invariants (measured gates, refusal IR)
 * hold across every member kind.
 *
 * Beam cross-check (W6.0 UDL20, Z=1.5e6, I=3e8, E=200 GPa):
 *   bending σ = 90e6/1.5e6 = 60 MPa; deflection δ = 5·20·6000⁴/(384·200000·3e8) = 5.625 mm.
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { civilModule, steelBeamPlan, mixedStructurePlan, type CivilBeamMember } from '../module';

describe('Batch 2 + 어휘확장 — civil DomainModule runs end-to-end via the shared spine', () => {
  it('steel-beam fixture → bending + deflection gates pass → verified package', async () => {
    const res = await runDomainDriver(
      { id: 'steel-beam', params: { fixture: 'steel-beam' } },
      civilModule,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('civil');
    expect(res.gates.every((g) => g.pass)).toBe(true);

    const bending = res.gates.find((g) => g.id === 'structural:B1:beam-bending-stress')!;
    const deflection = res.gates.find((g) => g.id === 'structural:B1:beam-deflection')!;
    expect(bending.metrics.bendingStress_MPa).toBeCloseTo(60, 3);
    expect(bending.metrics.moment_kNm).toBeCloseTo(90, 3);
    expect(deflection.metrics.deflection_mm).toBeCloseTo(5.625, 3);

    const m = res.package.members[0]!;
    expect(m.kind).toBe('beam');
    expect(m.checks).toHaveLength(2);
    expect(res.package.disclaimer).toContain('면허');
  });

  it('mixed-structure fixture → beam + column + wall + slope all pass (어휘 확장)', async () => {
    const res = await runDomainDriver({ id: 'mixed-structure', params: { fixture: 'mixed-structure' } }, civilModule);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass), res.gates.filter((g) => !g.pass).map((g) => g.id).join(',')).toBe(true);
    // 2 (beam) + 1 (column) + 1 (wall) + 1 (slope) = 5 gates.
    expect(res.gates).toHaveLength(5);
    expect(res.gates.find((g) => g.id === 'structural:C1:column-buckling-euler')!.pass).toBe(true);
    expect(res.gates.find((g) => g.id === 'structural:W1:retaining-wall-overturning')!.pass).toBe(true);
    expect(res.gates.find((g) => g.id === 'structural:S1:slope-infinite-stability')!.pass).toBe(true);
    expect(res.package.members.map((m) => m.kind)).toEqual(['beam', 'column', 'retaining-wall', 'slope']);
  });

  it('an over-stressed beam is REFUSED (bending demand > allowable)', async () => {
    const plan = steelBeamPlan();
    (plan.members[0] as CivilBeamMember).load = { type: 'udl', w_kNpm: 60, span_m: 6 }; // M=270 → σ=180>160
    const res = await runDomainDriver({ id: 'over-stress' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.failedGateIds).toContain('structural:B1:beam-bending-stress');
  });

  it('an over-slender column is REFUSED (KL/r > 200)', async () => {
    const plan = mixedStructurePlan();
    const col = plan.members.find((m) => m.kind === 'column')!;
    if (col.kind === 'column') col.radiusOfGyrationMm = 10; // KL/r = 3000/10 = 300 > 200
    const res = await runDomainDriver({ id: 'slender' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('structural:C1:column-buckling-euler');
  });

  it('an unknown brief is REFUSED at the plan stage', async () => {
    const res = await runDomainDriver({ id: 'nope', params: { fixture: 'nonexistent' } }, civilModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });
});
