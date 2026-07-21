/**
 * landscape/llmPlanner.test.ts — 다분야 확장 #2 LLM 플래너 (WA-D pattern for landscape).
 *
 * A free-text brief → LLM completion → JSON → coerced LandscapePlan → the SAME
 * landscape gates verify it. The LLM only plans; the deterministic engine still
 * REAL-checks 관수·배수·식재·조경면적·객토. Model output that is malformed / uses
 * an unknown enum / fabricates an unsupported plan is REFUSED (계획 날조 금지),
 * never repaired into a lie.
 *
 * `complete` is injected as a deterministic mock — no live LLM (비용·비결정 금지).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { landscapeModule } from '../module';
import { coerceLandscapePlan, makeLandscapeLlmPlanner } from '../llmPlanner';

// Mirrors the passing park-plaza fixture values (greenRatio = 200/1000 = 0.20).
const VALID_PLAN_JSON = JSON.stringify({
  planId: 'llm-park-plaza',
  name: 'LLM-Planned Neighborhood Park Plaza',
  siteAreaM2: 1000,
  landscapedAreaM2: 200,
  greenMinRatioOverride: 0.15,
  irrigation: { headCount: 20, coverageRadiusM: 3, targetAreaM2: 300, overlapFactor: 0.55, requiredUniformity: 0.9 },
  drainage: { measuredGradePct: 1.5, surfaceType: 'paving' },
  planting: { plantCount: 30, areaM2: 300, category: '관목', minSpacingMOverride: 1.0 },
  soil: { category: '교목', providedDepthM: 1.2 },
});

describe('#2 landscape LLM planner — free text → coerced plan → verified by the same gates', () => {
  it('a well-formed LLM plan drives end-to-end to a verified package', async () => {
    const planner = makeLandscapeLlmPlanner({ complete: async () => '```json\n' + VALID_PLAN_JSON + '\n```' });
    const plan = await planner({ id: 'llm', text: 'a neighborhood park plaza, 1000 m² site with 200 m² landscaped' });
    const res = await runDomainDriver({ id: 'llm' }, { ...landscapeModule, plan: () => plan });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass)).toBe(true);
    expect(res.package.greenRatio).toBeCloseTo(0.2, 6); // engine re-measured, not the LLM
  });

  it('coercion drops unknown fields but keeps a valid plan', () => {
    const plan = coerceLandscapePlan({
      ...JSON.parse(VALID_PLAN_JSON),
      bogusTopLevel: 42,
      irrigation: { headCount: 20, coverageRadiusM: 3, targetAreaM2: 300, junk: 'x' },
    });
    expect(plan.soil.category).toBe('교목');
    expect(plan.irrigation.headCount).toBe(20);
    expect((plan as unknown as Record<string, unknown>).bogusTopLevel).toBeUndefined();
    expect((plan.irrigation as unknown as Record<string, unknown>).junk).toBeUndefined();
  });

  it('an unsupported-sentinel reply is REFUSED (not repaired)', async () => {
    const planner = makeLandscapeLlmPlanner({ complete: async () => JSON.stringify({ error: 'unsupported', reason: 'no site area given' }) });
    await expect(planner({ id: 'x', text: 'design a garden' })).rejects.toThrow('unsupported');
  });

  it('a bad enum value (soil.category) is REFUSED', () => {
    expect(() => coerceLandscapePlan({ ...JSON.parse(VALID_PLAN_JSON), soil: { category: '나무', providedDepthM: 1.2 } })).toThrow('invalid');
  });

  it('a missing required field is REFUSED', () => {
    const bad = JSON.parse(VALID_PLAN_JSON);
    delete bad.soil;
    expect(() => coerceLandscapePlan(bad)).toThrow('soil');
  });

  it('a plan-stage refusal flows through the driver as stage:plan (non-JSON reply)', async () => {
    const planner = makeLandscapeLlmPlanner({ complete: async () => 'not json at all' });
    const res = await runDomainDriver({ id: 'bad' }, { ...landscapeModule, plan: (b) => planner(b) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
  });
});
