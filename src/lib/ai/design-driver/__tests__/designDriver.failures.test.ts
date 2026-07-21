/**
 * WA-A acceptance — failure injection: 한 게이트라도 fail이면 패키지
 * 미산출 + 이유 IR (계획 문서 §2 WA-A "게이트 실패 주입 시 패키지
 * 미산출 + 사유 IR").
 *
 *   ① 미해석 치수 ref  → drawing 게이트 fail (unresolved-ref)
 *   ② mate 미수렴 구성 → assembly 게이트 fail (residual 수치 포함)
 *   ③ 퇴화 형상        → geometry 게이트 fail (부피 0)
 *   ④ 미지 브리프      → 플래너 거부 (stage:'plan', 날조 금지)
 */

import { describe, expect, it } from 'vitest';
import {
  fixturePlanner,
  lBracketPlan,
  pinBlockAssemblyPlan,
  runDesignDriver,
  staticPlanner,
  type DesignPlan,
  type DriverResult,
} from '../index';

function expectRefused(res: DriverResult): asserts res is Extract<DriverResult, { ok: false }> {
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error('unreachable');
  // 패키지 미산출 — the refusal branch has no package field at all.
  expect('package' in res).toBe(false);
}

describe('WA-A failure injection', () => {
  it('① unresolved dimension ref → drawing gate fail, no package, explicit reason', async () => {
    const plan: DesignPlan = structuredClone(lBracketPlan());
    plan.drawing.dimensions[0].refs = ['e.vert.99', 'e.vert.0']; // e.vert.99 does not exist
    const res = await runDesignDriver(
      { id: 'bad-ref', text: 'bracket with a broken ref' },
      { planner: staticPlanner(plan) },
    );
    expectRefused(res);
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('drawing');
    const gate = res.gates.find((g) => g.id === 'drawing')!;
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('unresolved-ref');
    expect(gate.reason).toContain('e.vert.99');
    // the other gates still ran and reported numbers (rich refusal IR)
    expect(res.gates.find((g) => g.id === 'geometry:bracket')!.pass).toBe(true);
  });

  it('② contradictory mates → assembly gate fail with measured residual', async () => {
    const plan: DesignPlan = structuredClone(pinBlockAssemblyPlan());
    plan.assembly!.mates = [
      // pin.origin must equal block.origin AND be 50 mm away from it.
      { id: 'm_touch', kind: 'coincident', a: { partId: 'pin', refId: 'origin' }, b: { partId: 'block', refId: 'origin' } },
      { id: 'm_apart', kind: 'distance', value: 50, a: { partId: 'pin', refId: 'origin' }, b: { partId: 'block', refId: 'origin' } },
    ];
    const res = await runDesignDriver(
      { id: 'bad-mates', text: 'contradictory mates' },
      { planner: staticPlanner(plan) },
    );
    expectRefused(res);
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('assembly');
    const gate = res.gates.find((g) => g.id === 'assembly')!;
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('did not converge');
    // the verdict is backed by an executed solve: residual number present
    expect(gate.metrics.finalMaxResidual).toBeGreaterThan(gate.metrics.tolerance);
    expect(gate.metrics.iterations).toBeGreaterThan(0);
  });

  it('③ degenerate geometry (collinear profile) → geometry gate fail', async () => {
    const plan: DesignPlan = structuredClone(lBracketPlan());
    plan.parts[0].bodies[0].feature = {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 60, y: 0 },
      ], // collinear → zero-area profile → zero-volume prism
      depth: 20,
      direction: 'one_sided',
      mode: 'add',
    };
    delete plan.parts[0].expectedVolume;
    plan.drawing.dimensions = []; // isolate: the geometry gate must fail on its own
    const res = await runDesignDriver(
      { id: 'degenerate', text: 'flat bracket' },
      { planner: staticPlanner(plan) },
    );
    expectRefused(res);
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('geometry:bracket');
    const gate = res.gates.find((g) => g.id === 'geometry:bracket')!;
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('degenerate');
    expect(gate.metrics.minBodyVolumeMm3).toBeLessThanOrEqual(1e-9);
  });

  it('④ unknown brief → planner refusal (stage plan), no gates, no package', async () => {
    const res = await runDesignDriver(
      { id: 'warp-drive', text: 'design me a warp drive' },
      { planner: fixturePlanner },
    );
    expectRefused(res);
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
    expect(res.gates).toHaveLength(0);
  });
});
