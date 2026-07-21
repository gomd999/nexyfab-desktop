/**
 * designDriver.weldment.test.ts — WB-3 웰드먼트 편입 acceptance.
 *
 * A welded structural frame now flows through the whole driver: plan → build →
 * geometry gate (representative stock member) → weldment gate (REAL miter + cut
 * list: per-member stock cut length + 45° end miters from the miterFrame engine)
 * → package with the cut list. This promotes coverage-matrix category ⑤ (웰드먼트)
 * toward "A": the cut lengths are MEASURED off the mitred solids and cross-
 * checked against the geometry of an orthogonal 45° corner — proven, not asserted.
 *
 * Cross-check (derived, not black-box): a 40×40 rect-tube member on the 300×300
 * square frame is mitred 45° at both ends. The longest fibre extends by the full
 * half-section (20 mm) at EACH end → cut length = 300 + 2×20 = 340 mm; four
 * members ⇒ total raw stock = 1360 mm.
 */
import { describe, it, expect } from 'vitest';
import { runDesignDriver } from '../index';
import { fixturePlanner, weldmentFramePlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import type { DriverResult } from '../types';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

const MEMBER_CUT_LEN = 340; // 300 axis + 2×20 (half-section) miter extension
const TOTAL_STOCK = 4 * MEMBER_CUT_LEN; // 1360

describe('WB-3 driver integration — weldment cut list flows end-to-end', () => {
  it('weldment-frame fixture → all gates pass → package with real-mitred cut list', async () => {
    const res = await runDesignDriver(
      { id: 'weldment-frame', text: 'a 300×300 steel portal frame', params: { fixture: 'weldment-frame' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }

    const wg = res.gates.find((g) => g.id === 'weldment:frame');
    expect(wg, 'weldment gate must be present').toBeTruthy();
    expect(wg!.kind).toBe('weldment');
    expect(wg!.metrics.memberCount).toBe(4);
    expect(wg!.metrics.totalStockMm).toBeCloseTo(TOTAL_STOCK, 6);
    expect(wg!.metrics.minCutLengthMm).toBeCloseTo(MEMBER_CUT_LEN, 6);

    const part = res.package.parts[0]!;
    expect(part.weldment).toBeTruthy();
    expect(part.weldment!.members).toHaveLength(4);
    expect(part.weldment!.totalStockMm).toBeCloseTo(TOTAL_STOCK, 6);
    expect(part.weldment!.totalMassKg).toBeGreaterThan(0);
    for (const m of part.weldment!.members) {
      expect(m.cutLengthMm).toBeCloseTo(MEMBER_CUT_LEN, 6);
      expect(m.axisLengthMm).toBeCloseTo(300, 6);
      expect(m.startMiterDeg).toBeCloseTo(45, 6);
      expect(m.endMiterDeg).toBeCloseTo(45, 6);
      expect(m.profile).toContain('RECT-TUBE');
    }
  });

  it('a wrong expectedTotalStock hand-calc is REFUSED (cross-check fails → 패키지 미산출)', async () => {
    const plan = weldmentFramePlan();
    plan.parts[0]!.weldment!.expectedTotalStockMm = 9999; // deliberately wrong
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-weld-bad', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('weldment:frame');
    expect(res.refusal.reason).toContain('total stock');
  });

  it('a degenerate (zero-length) member is REFUSED (invalid frame → gate fails)', async () => {
    const plan = weldmentFramePlan();
    plan.parts[0]!.weldment!.segments[0]!.end = [0, 0, 0]; // collapse member 0
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-weld-degen', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('weldment:frame');
  });

  it('the LLM path coerces a weldment spec and mitres it', async () => {
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(weldmentFramePlan()) });
    const res = await runDesignDriver({ id: 'llm-weld', text: 'a frame' }, { planner: mockLlm });
    expectOk(res);
    expect(res.package.parts[0]!.weldment!.totalStockMm).toBeCloseTo(TOTAL_STOCK, 6);
  });
});
