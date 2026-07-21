/**
 * runner.test.ts — the generic domain-driver spine, validated with a reference
 * `DomainModule` (a toy 'widget' domain). This proves the orchestration + honesty
 * invariants are domain-agnostic: the SAME runner that drives mechanical will
 * drive civil / interior once they implement `DomainModule` (Batch 2).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '../index';
import type { DomainGateResult, DomainModule } from '../types';

interface WidgetBrief { text: string; sizeMm: number; weightG: number }
interface WidgetPlan { sizeMm: number; weightG: number }
interface WidgetArtifacts { measuredSizeMm: number; measuredWeightG: number }
interface WidgetPackage { sizeMm: number; weightG: number; verified: true }

/** A minimal reference domain exercising every stage + refusal path. */
const widgetModule: DomainModule<WidgetBrief, WidgetPlan, WidgetArtifacts, WidgetPackage> = {
  name: 'widget',
  plan(brief) {
    if (brief.text === 'unsupported') throw new Error('brief not expressible as a widget');
    return { sizeMm: brief.sizeMm, weightG: brief.weightG };
  },
  structuralError(plan) {
    return plan.sizeMm > 0 ? null : 'size must be positive';
  },
  build(plan) {
    if (plan.weightG < 0) throw new Error('negative weight cannot be built');
    // Deterministic "measurement" of the plan.
    return { measuredSizeMm: plan.sizeMm, measuredWeightG: plan.weightG };
  },
  gates(_plan, art): DomainGateResult[] {
    const size: DomainGateResult = {
      id: 'size:main',
      kind: 'size',
      pass: art.measuredSizeMm <= 100,
      metrics: { measuredSizeMm: art.measuredSizeMm, limitMm: 100 },
      notes: ['size ≤ 100 mm envelope (measured)'],
      ...(art.measuredSizeMm <= 100 ? {} : { reason: `size ${art.measuredSizeMm} mm exceeds 100 mm` }),
    };
    const weight: DomainGateResult = {
      id: 'weight:main',
      kind: 'weight',
      pass: art.measuredWeightG <= 500,
      metrics: { measuredWeightG: art.measuredWeightG, limitG: 500 },
      notes: ['weight ≤ 500 g (measured)'],
      ...(art.measuredWeightG <= 500 ? {} : { reason: `weight ${art.measuredWeightG} g exceeds 500 g` }),
    };
    return [size, weight];
  },
  package(plan, _art, _gates): WidgetPackage {
    return { sizeMm: plan.sizeMm, weightG: plan.weightG, verified: true };
  },
};

describe('domain-driver — generic spine honesty invariants', () => {
  it('all gates pass → package produced', async () => {
    const res = await runDomainDriver({ text: 'ok', sizeMm: 50, weightG: 200 }, widgetModule);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('widget');
    expect(res.gates).toHaveLength(2);
    expect(res.gates.every((g) => g.pass)).toBe(true);
    expect(res.package.verified).toBe(true);
    expect(res.package.sizeMm).toBe(50);
  });

  it('a failing gate ⇒ verify-stage refusal with the failed gate id (패키지 미산출)', async () => {
    const res = await runDomainDriver({ text: 'ok', sizeMm: 150, weightG: 200 }, widgetModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('size:main');
    expect(res.refusal.reason).toContain('exceeds 100');
    expect(res.gates).toHaveLength(2); // ALL gates still reported (rich refusal IR)
  });

  it('a planner throw ⇒ plan-stage refusal, no gates', async () => {
    const res = await runDomainDriver({ text: 'unsupported', sizeMm: 50, weightG: 200 }, widgetModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('refused');
    expect(res.gates).toHaveLength(0);
  });

  it('a structural error ⇒ plan-stage refusal before build', async () => {
    const res = await runDomainDriver({ text: 'ok', sizeMm: -5, weightG: 200 }, widgetModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('structurally invalid');
  });

  it('a build throw ⇒ verify-stage refusal, no gates (unbuildable ⇒ unverifiable)', async () => {
    const res = await runDomainDriver({ text: 'ok', sizeMm: 50, weightG: -1 }, widgetModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.reason).toContain('build failed');
    expect(res.gates).toHaveLength(0);
  });
});
