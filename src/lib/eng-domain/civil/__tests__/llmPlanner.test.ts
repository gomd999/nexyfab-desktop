/**
 * civil/llmPlanner.test.ts — #2 LLM 플래너 (통합판: 엔진-입력 스키마).
 *
 * Free text → LLM → coerced CivilPlan (engine inputs) → the SAME engineering-core
 * engine verifies it. Malformed / unsupported / missing-input plans are REFUSED
 * (계획 날조 금지), never repaired. `complete` is a deterministic mock.
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
      kind: 'beam', id: 'B1', name: 'Beam B1',
      spanMm: 6000, yieldStrengthMPa: 355, sectionModulusMm3: 1_500_000, webShearAreaMm2: 3000, inertiaMm4: 300_000_000, udlKNpm: 20,
    },
  ],
});

describe('#2 civil LLM planner (통합) — free text → coerced plan → verified by the real engine', () => {
  it('a well-formed LLM plan drives end-to-end to a verified package', async () => {
    const planner = makeCivilLlmPlanner({ complete: async () => '```json\n' + VALID_BEAM_JSON + '\n```' });
    const plan = await planner({ id: 'llm', text: 'a simply supported 6 m steel floor beam under 20 kN/m' });
    const res = await runDomainDriver({ id: 'llm' }, { ...civilModule, plan: () => plan });
    expect(res.ok, res.ok ? '' : res.refusal.reason).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass)).toBe(true);
    const g = res.gates.find((x) => x.id === 'structural:B1')!;
    expect(Object.keys(g.metrics).some((k) => k.startsWith('shear'))).toBe(true); // engine completeness
  });

  it('coercion drops unknown fields but keeps a valid plan', () => {
    const plan = coerceCivilPlan({
      planId: 'p', name: 'n', bogusTopLevel: 42,
      members: [{ kind: 'slope', id: 'S1', name: 's', slopeDeg: 20, phiDeg: 30, depthM: 3, gammaKNm3: 18, fsRequired: 1.3, junk: 'x' }],
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
      coerceCivilPlan({ planId: 'p', name: 'n', members: [{ kind: 'beam', id: 'B', name: 'b', spanMm: 6000 }] }),
    ).toThrow('yieldStrengthMPa');
  });

  it('a non-JSON reply → stage:plan refusal through the driver', async () => {
    const planner = makeCivilLlmPlanner({ complete: async () => 'not json at all' });
    const res = await runDomainDriver({ id: 'bad' }, { ...civilModule, plan: (b) => planner(b) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
  });
});
