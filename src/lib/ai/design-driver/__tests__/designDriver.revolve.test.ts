/**
 * designDriver.revolve.test.ts — WB-1 driver integration.
 *
 * A TRUE revolve body (not a tessellated-extrude workaround) now flows through
 * the whole driver: plan → build → geometry gate → drawing gate that REAL-
 * measures ⌀/axial-length off the revolve rim faces `f.lat.{i}`
 * (buildRevolveMeasureTopo). This is what promotes coverage-matrix category ②
 * (축/샤프트) from "부분" toward "A" — the preflight no longer refuses revolve
 * dimensions, and the measurement is verified, not asserted.
 */
import { describe, it, expect } from 'vitest';
import { runDesignDriver, fixturePlanner } from '../index';
import { revolveBushingPlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import type { DriverResult } from '../types';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

describe('WB-1 driver integration — revolve dimensions flow end-to-end', () => {
  it('revolve-bushing fixture → all gates pass → package with measured ⌀50 / L60', async () => {
    const res = await runDesignDriver(
      { id: 'revolve-bushing', text: 'a ⌀50×60 bushing' },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }
    // The drawing gate measured the revolve rims (not a fabricated number).
    const drawing = res.gates.find((g) => g.id === 'drawing')!;
    expect(drawing.pass).toBe(true);
    expect(drawing.metrics?.measuredOkCount).toBe(2);
    expect((drawing.metrics?.maxExpectedDeviation ?? 1) as number).toBeLessThanOrEqual(1e-6);
    // Package carries the DXF with the measured diameter label.
    const part = res.package.parts[0]!;
    expect(part.dxf).toContain('%%c50'); // ⌀50
  });

  it('preflight now ACCEPTS a revolve plan with f.lat refs (LLM path)', async () => {
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(revolveBushingPlan()) });
    const res = await runDesignDriver({ id: 'llm-revolve', text: 'a bushing' }, { planner: mockLlm });
    expectOk(res);
    expect(res.plan.planId).toBe('fixture-revolve-bushing');
  });

  it('preflight still REFUSES a bad revolve ref (not f.lat namespace)', async () => {
    const plan = revolveBushingPlan();
    plan.drawing.dimensions[0]!.refs = ['f.cap.top']; // extrude name on a revolve body
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-bad-revolve', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('f.lat');
  });

  it('loft/sweep dimensions are STILL refused (WB backlog unchanged)', async () => {
    const plan = revolveBushingPlan();
    // Swap the body to a STRUCTURALLY VALID sweep feature (measurement builder
    // still absent for this kind) — a kind-only swap no longer reaches the
    // preflight backlog-refusal, since coerceFeature now validates the full
    // per-kind shape (profile/path/mode) before preflight ever runs.
    plan.parts[0]!.bodies[0]!.feature = {
      kind: 'sweep',
      profile: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }],
      mode: 'add',
    } as unknown as typeof plan.parts[0]['bodies'][0]['feature'];
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-sweep', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('sweep');
  });
});
