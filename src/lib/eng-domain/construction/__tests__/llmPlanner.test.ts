/**
 * construction/llmPlanner.test.ts — 다분야 확장 #2 LLM 플래너 (WA-D pattern for construction).
 *
 * A free-text brief → LLM completion → JSON → coerced ConstructionPlan → the SAME
 * construction gates verify it. The LLM only plans; the deterministic engine still
 * REAL-computes every takeoff / schedule. Model output that is malformed / declares
 * an unsupported brief is REFUSED (물량 날조 금지), never repaired into a lie.
 *
 * `complete` is injected as a deterministic mock — no live LLM (비용·비결정 금지).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { constructionModule } from '../module';
import { coerceConstructionPlan, makeConstructionLlmPlanner } from '../llmPlanner';
import { bindConstructionPlan } from '../provenance';

// Mirrors the passing rc-frame fixture values: concrete Σ = 2·0.3·0.6·6 + 2·0.4·0.4·3 = 3.12 m³.
const VALID_RC_FRAME_JSON = JSON.stringify({
  planId: 'llm-rc-frame',
  name: 'LLM-Planned RC Frame Bay',
  concreteElements: [
    { tag: 'beam', count: 2, b_m: 0.3, h_m: 0.6, L_m: 6 },
    { tag: 'column', count: 2, b_m: 0.4, h_m: 0.4, L_m: 3 },
  ],
  claimedConcreteM3: 3.5,
  wasteFactor: 0.05,
  rebarGroups: [
    { tag: 'beam-main', nominalDia_mm: 16, length_m: 12, count: 8 },
    { tag: 'column-main', nominalDia_mm: 22, length_m: 3, count: 16 },
  ],
  claimedRebarKg: 295,
  rebarToleranceKg: 10,
  activities: [
    { id: 'excavate', duration_days: 5 },
    { id: 'pour', duration_days: 6, predecessors: ['excavate'] },
  ],
  deadlineDays: 15,
  formworkElements: [
    { type: 'beam', count: 2, b_m: 0.3, h_m: 0.6, L_m: 6 },
    { type: 'column', count: 2, b_m: 0.4, h_m: 0.4, L_m: 3 },
  ],
  claimedFormworkM2: 27.6,
  costLineItems: [
    { description: 'concrete m³', quantity: 3.5, unitRate: 150000 },
    { description: 'rebar kg', quantity: 295, unitRate: 1500 },
    { description: 'formwork m²', quantity: 27.6, unitRate: 60000 },
  ],
  budget: 3_500_000,
  contingencyFactor: 0.1,
  earthwork: { cutBankM3: 100, fillCompactedM3: 90, compactionFactor: 0.9 },
});

describe('#2 construction LLM planner — free text → coerced plan → verified by the same gates', () => {
  it('a well-formed LLM plan drives end-to-end to a verified package', async () => {
    const planner = makeConstructionLlmPlanner({ complete: async () => '```json\n' + VALID_RC_FRAME_JSON + '\n```' });
    const unboundPlan = await planner({ id: 'llm', text: 'RC frame bay: 2 beams 0.3×0.6×6 m + 2 columns 0.4×0.4×3 m' });
    unboundPlan.priceEvidence = { sourceId: 'fixture-price-sheet-llm', sourceSha256: '3'.repeat(64), authority: 'fixture' };
    unboundPlan.siteEvidence = { sourceId: 'fixture-site-balance-llm', sourceSha256: '4'.repeat(64), authority: 'fixture' };
    const plan = bindConstructionPlan(unboundPlan, { revisionId: 'llm-fixture:r1', revisionSha256: 'c'.repeat(64) });
    const res = await runDomainDriver({ id: 'llm' }, { ...constructionModule, plan: () => plan });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass)).toBe(true);
    expect(res.package.concreteVolumeM3).toBeCloseTo(3.12, 6); // engine re-computed, not the LLM
  });

  it('coercion drops unknown fields but keeps a valid plan', () => {
    const plan = coerceConstructionPlan({
      planId: 'p', name: 'n', bogusTopLevel: 42,
      concreteElements: [{ tag: 'c', b_m: 0.3, h_m: 0.6, L_m: 6, junk: 'x' }],
      claimedConcreteM3: 1.08,
      rebarGroups: [{ nominalDia_mm: 16, length_m: 12, bogus: true }],
      claimedRebarKg: 150,
      activities: [{ id: 'a', duration_days: 3, extra: 9 }],
    });
    expect(plan.concreteElements[0]!.tag).toBe('c');
    expect((plan.concreteElements[0]! as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect((plan as unknown as Record<string, unknown>).bogusTopLevel).toBeUndefined();
  });

  it('an unsupported-sentinel reply is REFUSED (not repaired)', async () => {
    const planner = makeConstructionLlmPlanner({ complete: async () => JSON.stringify({ error: 'unsupported', reason: 'no dimensions given' }) });
    await expect(planner({ id: 'x', text: 'take off something' })).rejects.toThrow('unsupported');
  });

  it('a missing required field is REFUSED', () => {
    expect(() =>
      coerceConstructionPlan({
        planId: 'p', name: 'n',
        concreteElements: [{ b_m: 0.3, h_m: 0.6 }], // missing L_m
        claimedConcreteM3: 1,
        rebarGroups: [{ nominalDia_mm: 16, length_m: 12 }],
        claimedRebarKg: 150,
        activities: [{ id: 'a', duration_days: 3 }],
      }),
    ).toThrow('L_m');
  });

  it('a plan-stage refusal flows through the driver as stage:plan (via a throwing planner)', async () => {
    const planner = makeConstructionLlmPlanner({ complete: async () => 'not json at all' });
    const res = await runDomainDriver({ id: 'bad' }, { ...constructionModule, plan: (b) => planner(b) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
  });
});
