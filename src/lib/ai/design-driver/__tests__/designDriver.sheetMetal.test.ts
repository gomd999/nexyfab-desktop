/**
 * designDriver.sheetMetal.test.ts — WB-2 판금 전개 편입 acceptance.
 *
 * A sheet-metal part now flows through the whole driver: plan → build → geometry
 * gate (flat base panel) → flat-pattern gate (REAL unfold: developed length +
 * bend schedule from the material K-factor tables) → package with a laser-ready
 * flat DXF. This promotes coverage-matrix category ④ (판금) toward "A": the
 * developed length is MEASURED by the real engine and cross-checked against the
 * same public bend-allowance formula — proven, not asserted.
 */
import { describe, it, expect } from 'vitest';
import { runDesignDriver } from '../index';
import { fixturePlanner, sheetUChannelPlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import type { DriverResult } from '../types';
import { getKFactor, bendAllowance } from '@/app/[lang]/shape-generator/features/sheetMetalTables';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

// Independent hand-calc of the U-channel developed length: base 120 + 2 flange
// legs (height 30 − radius 3 = 27 each) + 2 bend allowances. This is the SAME
// public formula the engine uses, so equality proves the gate wires the real
// unfold rather than echoing a plan number.
const K = getKFactor('mildSteel', 3, 2);
const BA = bendAllowance(90, 3, 2, K);
const EXPECTED_DEV_LEN = 120 + 2 * 27 + 2 * BA;

describe('WB-2 driver integration — sheet-metal flat pattern flows end-to-end', () => {
  it('sheet-uchannel fixture → all gates pass → package with real-unfolded flat pattern', async () => {
    const res = await runDesignDriver(
      { id: 'sheet-uchannel', text: 'a mild-steel U-channel', params: { fixture: 'sheet-uchannel' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }

    // The flat-pattern gate ran and MEASURED the developed length.
    const fp = res.gates.find((g) => g.id === 'flat-pattern:channel');
    expect(fp, 'flat-pattern gate must be present').toBeTruthy();
    expect(fp!.kind).toBe('flat-pattern');
    expect(fp!.metrics.bendCount).toBe(2);
    expect(fp!.metrics.developedLengthMm).toBeCloseTo(EXPECTED_DEV_LEN, 6);

    // Package carries the flat pattern with a laser-ready DXF.
    const part = res.package.parts[0]!;
    expect(part.sheetMetal).toBeTruthy();
    expect(part.sheetMetal!.developedLengthMm).toBeCloseTo(EXPECTED_DEV_LEN, 6);
    expect(part.sheetMetal!.blankWidthMm).toBeCloseTo(60, 6);
    expect(part.sheetMetal!.bendTable).toHaveLength(2);
    expect(part.sheetMetal!.dxf).toContain('CUT');
    expect(part.sheetMetal!.dxf).toContain('BEND');
    // Every bend row carries a real (positive) bend allowance from the K tables.
    for (const row of part.sheetMetal!.bendTable) {
      expect(row.bendAllowanceMm).toBeGreaterThan(0);
      expect(row.kFactor).toBeGreaterThan(0);
    }
  });

  it('a wrong expectedDevelopedLength hand-calc is REFUSED (cross-check fails → 패키지 미산출)', async () => {
    const plan = sheetUChannelPlan();
    plan.parts[0]!.sheetMetal!.expectedDevelopedLengthMm = 999; // deliberately wrong
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-sheet-bad', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('flat-pattern:channel');
    expect(res.refusal.reason).toContain('developed length');
  });

  it('a below-minimum bend radius is REFUSED (crack risk → gate fails)', async () => {
    const plan = sheetUChannelPlan();
    // mildSteel min inner radius = 1.0 × t(2) = 2.0 mm; 0.5 mm would crack.
    for (const op of plan.parts[0]!.sheetMetal!.ops) op.radius = 0.5;
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-sheet-crack', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('flat-pattern:channel');
    expect(res.refusal.reason.toLowerCase()).toContain('radius');
  });

  it('the LLM path coerces a sheetMetal spec and unfolds it', async () => {
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(sheetUChannelPlan()) });
    const res = await runDesignDriver({ id: 'llm-sheet', text: 'a channel' }, { planner: mockLlm });
    expectOk(res);
    expect(res.package.parts[0]!.sheetMetal!.developedLengthMm).toBeCloseTo(EXPECTED_DEV_LEN, 6);
  });
});
