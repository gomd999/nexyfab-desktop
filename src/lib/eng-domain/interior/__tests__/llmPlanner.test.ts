/**
 * interior/llmPlanner.test.ts — 다분야 확장 #2 LLM 플래너 (WA-D pattern for interior).
 *
 * A free-text brief → LLM completion → JSON → coerced InteriorPlan → the SAME interior
 * building-code gates verify it. The LLM only plans; the deterministic engine still
 * REAL-checks every space (occupant load recomputed, egress/plumbing derived). Model
 * output that is malformed / declines is REFUSED (계획 날조 금지), never repaired into a lie.
 *
 * `complete` is injected as a deterministic mock — no live LLM (비용·비결정 금지).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { interiorModule } from '../module';
import { coerceInteriorPlan, makeInteriorLlmPlanner } from '../llmPlanner';

// A business office floor matching the passing office-floor fixture values (occ 36).
const VALID_OFFICE_JSON = JSON.stringify({
  planId: 'llm-office',
  name: 'LLM-Planned Office Floor',
  spaces: [
    {
      id: 'F1',
      name: 'Open Office F1',
      useGroup: 'business',
      floorAreaM2: 500,
      sprinklered: true,
      measuredTravelM: 40,
      providedEgressWidthMm: 1000,
      measuredCorridorWidthMm: 1200,
      providedWaterClosets: 3,
      measuredCeilingHeightMm: 2700,
      postedOccupantLimit: 50,
    },
  ],
});

describe('#2 interior LLM planner — free text → coerced plan → verified by the same gates', () => {
  it('a well-formed LLM plan drives end-to-end to a verified package', async () => {
    const planner = makeInteriorLlmPlanner({ complete: async () => '```json\n' + VALID_OFFICE_JSON + '\n```' });
    const plan = await planner({ id: 'llm', text: 'a 500 m² sprinklered open office floor' });
    const res = await runDomainDriver({ id: 'llm' }, { ...interiorModule, plan: () => plan });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass)).toBe(true);
    const occ = res.gates.find((g) => g.id === 'code:F1:occupancy-load')!;
    expect(occ.metrics.occupantLoad).toBe(36); // engine re-computed, not the LLM
  });

  it('coercion drops unknown fields but keeps a valid plan', () => {
    const plan = coerceInteriorPlan({
      planId: 'p',
      name: 'n',
      bogusTopLevel: 42,
      spaces: [
        {
          id: 'S1',
          name: 's',
          useGroup: 'business',
          floorAreaM2: 500,
          sprinklered: true,
          measuredTravelM: 40,
          providedEgressWidthMm: 1000,
          measuredCorridorWidthMm: 1200,
          providedWaterClosets: 3,
          measuredCeilingHeightMm: 2700,
          junk: 'x',
        },
      ],
    });
    expect(plan.spaces[0]!.useGroup).toBe('business');
    expect((plan.spaces[0]! as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect((plan as unknown as Record<string, unknown>).bogusTopLevel).toBeUndefined();
  });

  it('an unsupported-sentinel reply is REFUSED (not repaired)', async () => {
    const planner = makeInteriorLlmPlanner({ complete: async () => JSON.stringify({ error: 'unsupported', reason: 'no area given' }) });
    await expect(planner({ id: 'x', text: 'design a room' })).rejects.toThrow('unsupported');
  });

  it('a bad useGroup is REFUSED', () => {
    expect(() =>
      coerceInteriorPlan({
        planId: 'p',
        name: 'n',
        spaces: [
          {
            id: 'S1',
            name: 's',
            useGroup: 'nightclub',
            floorAreaM2: 500,
            sprinklered: true,
            measuredTravelM: 40,
            providedEgressWidthMm: 1000,
            measuredCorridorWidthMm: 1200,
            providedWaterClosets: 3,
            measuredCeilingHeightMm: 2700,
          },
        ],
      }),
    ).toThrow('invalid useGroup');
  });

  it('a missing required field is REFUSED', () => {
    expect(() =>
      coerceInteriorPlan({
        planId: 'p',
        name: 'n',
        spaces: [{ id: 'S1', name: 's', useGroup: 'business', floorAreaM2: 500 }],
      }),
    ).toThrow('sprinklered');
  });

  it('a plan-stage refusal flows through the driver as stage:plan (via a throwing planner)', async () => {
    const planner = makeInteriorLlmPlanner({ complete: async () => 'not json at all' });
    const res = await runDomainDriver({ id: 'bad' }, { ...interiorModule, plan: (b) => planner(b) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
  });
});
