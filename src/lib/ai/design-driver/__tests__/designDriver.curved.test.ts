/**
 * designDriver.curved.test.ts — WB-6 곡면(OCCT) 필렛 편입 acceptance.
 *
 * A curved housing part now flows through the whole driver: plan → build →
 * geometry gate (base box) → curved gate (REAL OCCT BRepFillet on every edge +
 * BRepGProp volume) → package with the filleted B-rep (STEP). Promotes coverage-
 * matrix category ③ (하우징) toward "A": the rounded surface is the KERNEL's
 * geometry, real-measured — not a mesh approximation.
 *
 * OCCT-dependent cases skip when the wasm is unavailable (like the sibling
 * nodeOcctBridge tests); the shell-refusal and non-extrude-refusal cases run
 * unconditionally (they fail before the kernel is loaded).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runDesignDriver } from '../index';
import { fixturePlanner, filletedBlockPlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import type { DriverResult } from '../types';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

let occtOk = false;
beforeAll(async () => {
  const r = await loadOcctNode();
  occtOk = r.ok;
  if (!r.ok) console.warn(`[WB-6 curved] OCCT unavailable — kernel cases skipped: ${r.reason}`);
});

describe('WB-6 driver integration — OCCT fillet flows end-to-end', () => {
  it('filleted-block fixture → all gates pass → package with real filleted B-rep', async () => {
    if (!occtOk) return; // needs the OCCT kernel
    const res = await runDesignDriver(
      { id: 'filleted-block', text: 'a rounded housing block', params: { fixture: 'filleted-block' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }

    const cg = res.gates.find((g) => g.id === 'curved:block');
    expect(cg, 'curved gate must be present').toBeTruthy();
    expect(cg!.kind).toBe('curved');
    // The kernel measured the base box (40×40×20 = 32000) and the filleted solid.
    expect(cg!.metrics.baseVolumeMm3).toBeCloseTo(32000, 3);
    expect(cg!.metrics.resultVolumeMm3).toBeLessThan(32000);   // fillet removed material
    expect(cg!.metrics.deltaVolumeMm3).toBeLessThan(0);

    const curved = res.package.parts[0]!.curved!;
    expect(curved.kind).toBe('fillet');
    expect(curved.resultVolumeMm3).toBeLessThan(curved.baseVolumeMm3);
    // STEP is best-effort but should normally be produced.
    if (curved.step) expect(curved.step.startsWith('ISO-10303-21')).toBe(true);
  });

  it('a radius too large for the edges is REFUSED (kernel IsDone=false → 패키지 미산출)', async () => {
    if (!occtOk) return;
    const plan = filletedBlockPlan();
    plan.parts[0]!.curved!.radiusMm = 25; // > half the 20 mm depth — kernel cannot build
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-curved-big', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('curved:block');
  });

  it('shell is REFUSED (OCCT thicken path not wired) — no fabrication, no kernel needed', async () => {
    const plan = filletedBlockPlan();
    plan.parts[0]!.curved = { kind: 'shell', wallMm: 2 };
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-shell', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('curved:block');
    expect(res.refusal.reason).toContain('shell');
  });
});
