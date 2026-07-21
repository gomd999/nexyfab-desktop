/**
 * civil/llmPlanner.test.ts — 다분야 확장 #2 LLM 플래너 (WA-D pattern for civil).
 *
 * A free-text brief → LLM completion → JSON → coerced CivilPlan → the SAME civil
 * gates verify it. The LLM only plans; the deterministic engine still REAL-checks
 * every member. Model output that is malformed / fabricates an unsupported member
 * is REFUSED (계획 날조 금지), never repaired into a lie.
 *
 * `complete` is injected as a deterministic mock — no live LLM (비용·비결정 금지).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { civilModule } from '../module';
import { coerceCivilPlan, makeCivilLlmPlanner } from '../llmPlanner';

const VALID_BEAM_JSON = JSON.stringify({
  planId: 'llm-beam',
  name: 'LLM-Planned Steel Beam',
  members: [
    {
      kind: 'beam', id: 'B1', name: 'Beam B1', material: 'steel',
      spanM: 6, load: { type: 'udl', w_kNpm: 20, span_m: 6 },
      sectionModulusMm3: 1_500_000, inertiaMm4: 300_000_000, allowableStressMPa: 160, deflectionLimitDenominator: 360,
    },
  ],
});

describe('#2 civil LLM planner — free text → coerced plan → verified by the same gates', () => {
  it('a well-formed LLM plan drives end-to-end to a verified package', async () => {
    const planner = makeCivilLlmPlanner({ complete: async () => '```json\n' + VALID_BEAM_JSON + '\n```' });
    const plan = await planner({ id: 'llm', text: 'a simply supported 6 m steel floor beam under 20 kN/m' });
    const res = await runDomainDriver({ id: 'llm' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass)).toBe(true);
    const bending = res.gates.find((g) => g.id === 'structural:B1:beam-bending-stress')!;
    expect(bending.metrics.bendingStress_MPa).toBeCloseTo(60, 3); // engine re-measured, not the LLM
  });

  it('coercion drops unknown fields but keeps a valid plan', () => {
    const plan = coerceCivilPlan({
      planId: 'p', name: 'n', bogusTopLevel: 42,
      members: [{ kind: 'slope', id: 'S1', name: 's', slopeDeg: 20, phiDeg: 30, depthM: 3, gammaKNm3: 18, requiredFS: 1.3, junk: 'x' }],
    });
    expect(plan.members[0]!.kind).toBe('slope');
    expect((plan as unknown as Record<string, unknown>).bogusTopLevel).toBeUndefined();
  });

  it('an unsupported-sentinel reply is REFUSED (not repaired)', async () => {
    const planner = makeCivilLlmPlanner({ complete: async () => JSON.stringify({ error: 'unsupported', reason: 'no section given' }) });
    await expect(planner({ id: 'x', text: 'design something' })).rejects.toThrow('unsupported');
  });

  it('a malformed member (unknown kind) is REFUSED', () => {
    expect(() => coerceCivilPlan({ planId: 'p', name: 'n', members: [{ kind: 'truss', id: 'T', name: 't' }] })).toThrow('invalid');
  });

  it('a missing required field is REFUSED', () => {
    expect(() =>
      coerceCivilPlan({ planId: 'p', name: 'n', members: [{ kind: 'beam', id: 'B', name: 'b', spanM: 6 }] }),
    ).toThrow('load');
  });

  it('a plan-stage refusal flows through the driver as stage:plan (via a throwing planner)', async () => {
    const planner = makeCivilLlmPlanner({ complete: async () => 'not json at all' });
    const res = await runDomainDriver({ id: 'bad' }, { ...civilModule, plan: (b) => planner(b) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
  });
});
