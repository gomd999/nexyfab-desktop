/**
 * designDriver.fastener.test.ts — WB-8 나사산·규격품 편입 acceptance.
 *
 * A part carrying STANDARD ISO metric threads now flows through the whole
 * driver: plan → build → geometry gate (plate) → fastener gate (resolve against
 * the ISO 261 coarse-pitch table + ISO 68-1 derived dims + engagement screen) →
 * package with the thread schedule. Promotes coverage-matrix category ⑦
 * (체결/규격품) toward "A": the pitch is REAL standard data and the derived
 * dimensions come from published formulas — proven, not fabricated.
 */
import { describe, it, expect } from 'vitest';
import { runDesignDriver } from '../index';
import { fixturePlanner, tappedPlatePlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import type { DriverResult } from '../types';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

describe('WB-8 driver integration — standard fastener schedule flows end-to-end', () => {
  it('tapped-plate fixture → all gates pass → package with ISO thread schedule', async () => {
    const res = await runDesignDriver(
      { id: 'tapped-plate', text: 'an M8-tapped steel plate', params: { fixture: 'tapped-plate' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }

    const fg = res.gates.find((g) => g.id === 'fastener:plate');
    expect(fg, 'fastener gate must be present').toBeTruthy();
    expect(fg!.kind).toBe('fastener');
    expect(fg!.metrics.resolvedCount).toBe(2);
    expect(fg!.metrics.failureCount).toBe(0);

    const recs = res.package.parts[0]!.fasteners!;
    expect(recs).toHaveLength(2);
    // sorted by id: stud_m6 before tap_m8.
    const m6 = recs.find((r) => r.id === 'stud_m6')!;
    const m8 = recs.find((r) => r.id === 'tap_m8')!;

    // M8 coarse: pitch 1.25 (ISO 261); ISO 68-1 derived dims.
    expect(m8.callout).toBe('M8');
    expect(m8.pitchMm).toBeCloseTo(1.25, 9);
    expect(m8.coarse).toBe(true);
    expect(m8.pitchDiameterMm).toBeCloseTo(8 - 0.6495 * 1.25, 6);   // 7.188125
    expect(m8.minorDiameterMm).toBeCloseTo(8 - 1.08253 * 1.25, 6);  // internal
    expect(m8.tapDrillMm).toBeCloseTo(8 - 1.25, 9);                 // 6.75

    // M6 external stud: pitch 1.0; external minor formula; no tap drill.
    expect(m6.callout).toBe('M6');
    expect(m6.type).toBe('external');
    expect(m6.pitchMm).toBeCloseTo(1.0, 9);
    expect(m6.minorDiameterMm).toBeCloseTo(6 - 1.22687 * 1.0, 6);
    expect(m6.tapDrillMm).toBeUndefined();
  });

  it('a non-standard nominal (M7) is REFUSED (not in the ISO table → 패키지 미산출)', async () => {
    const plan = tappedPlatePlan();
    plan.parts[0]!.fasteners![0]!.nominalDiameterMm = 7; // M7 is not a preferred ISO size
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-fast-bad', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('fastener:plate');
    expect(res.refusal.reason).toContain('standard ISO');
  });

  it('an under-engaged thread is REFUSED (strip risk → gate fails)', async () => {
    const plan = tappedPlatePlan();
    plan.parts[0]!.fasteners![0]!.engagementMm = 3; // < 0.8×8 = 6.4 mm for steel
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-fast-strip', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('fastener:plate');
    expect(res.refusal.reason.toLowerCase()).toContain('engagement');
  });

  it('the LLM path coerces fasteners and resolves the schedule', async () => {
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(tappedPlatePlan()) });
    const res = await runDesignDriver({ id: 'llm-fast', text: 'a tapped plate' }, { planner: mockLlm });
    expectOk(res);
    expect(res.package.parts[0]!.fasteners).toHaveLength(2);
  });
});
