/**
 * WB-5 acceptance — GD&T 자동 제안 + 검증 게이트.
 *
 * 정직 검증 (생성≠검증):
 *   ① 유효 선언 GD&T (실제 face + 실제 관계) → 실측 검증 통과 → 패키지 report.gdt 편입
 *   ② 자동 제안(flatness on datum 등) → 실측 검증 → 자문 콜아웃도 report.gdt 편입(proposed:true)
 *   ③ 미해석 콜아웃(존재하지 않는 face) → 게이트 fail, 패키지 미산출, 값 날조 없음
 *   ④ 거짓 콜아웃(기하가 위배: 평행면에 수직도 선언) → 게이트 fail, 실측 actual > 존
 */

import { describe, expect, it } from 'vitest';
import {
  lBracketPlan,
  runDesignDriver,
  staticPlanner,
  type DesignPlan,
  type DriverResult,
  type PlanGdtSpec,
} from '../index';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`expected ok:true — refusal: ${res.refusal.reason}`);
}
function expectRefused(res: DriverResult): asserts res is Extract<DriverResult, { ok: false }> {
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error('unreachable');
  expect('package' in res).toBe(false);
}

function planWithGdt(specs: PlanGdtSpec[]): DesignPlan {
  const plan: DesignPlan = structuredClone(lBracketPlan());
  plan.drawing.gdt = specs;
  return plan;
}

async function run(plan: DesignPlan, id = 'gdt-test'): Promise<DriverResult> {
  return runDesignDriver({ id, text: `GD&T ${id}` }, { planner: staticPlanner(plan) });
}

describe('WB-5 GD&T gate — valid declared callouts verify + land in package', () => {
  it('flatness + perpendicularity + parallelism on REAL faces pass, packaged with measured actuals', async () => {
    // L-bracket extrude faces: caps ±Z, side normals in XY.
    //   f.cap.top ⟂ any f.side.*  (±Z vs XY)      → perpendicularity nominal 90
    //   f.side.0 ∥ f.side.2       (both ±Y)        → parallelism nominal 0
    const specs: PlanGdtSpec[] = [
      { id: 'g_flat_top', partId: 'bracket', bodyId: 'main', characteristic: 'flatness', feature: 'f.cap.top', toleranceMm: 0.05 },
      { id: 'g_perp', partId: 'bracket', bodyId: 'main', characteristic: 'perpendicularity', feature: 'f.cap.top', datums: ['f.side.0'], toleranceMm: 0.05 },
      { id: 'g_par', partId: 'bracket', bodyId: 'main', characteristic: 'parallelism', feature: 'f.side.2', datums: ['f.side.0'], toleranceMm: 0.05 },
    ];
    const res = await run(planWithGdt(specs));
    expectOk(res);

    // the GD&T gate ran, passed, backed by numbers
    const gate = res.gates.find((g) => g.id === 'gdt')!;
    expect(gate).toBeDefined();
    expect(gate.kind).toBe('gdt');
    expect(gate.pass).toBe(true);
    expect(gate.metrics.declaredFailureCount).toBe(0);
    expect(gate.metrics.declaredCount).toBe(3);

    // every gate still green ⇒ package produced
    for (const g of res.gates) expect(g.pass).toBe(true);

    const gdt = res.package.report.gdt;
    expect(gdt).toBeDefined();
    const byId = new Map(gdt!.map((r) => [r.id, r]));

    // declared callouts landed, REAL-measured within their zone, marked enforced
    for (const s of specs) {
      const rec = byId.get(s.id);
      expect(rec, s.id).toBeDefined();
      expect(rec!.proposed).toBe(false);
      expect(rec!.actualMm).toBeLessThanOrEqual(s.toleranceMm);
      // clean prism ⇒ the controlled quantity measures ~0
      expect(rec!.actualMm).toBeLessThan(1e-6);
      expect(rec!.basis).toMatch(/실측/);
    }
    // orientation records carry a measured angular deviation (~0)
    expect(byId.get('g_perp')!.angularDeviationDeg).toBeLessThan(1e-6);
    expect(byId.get('g_par')!.angularDeviationDeg).toBeLessThan(1e-6);
  });

  it('auto-proposes advisory callouts from real topology (flatness on datums) and packages them', async () => {
    // no declared specs — the gate still auto-proposes + verifies (verify-or-drop)
    const res = await run(structuredClone(lBracketPlan()), 'auto');
    expectOk(res);
    const gate = res.gates.find((g) => g.id === 'gdt')!;
    expect(gate.pass).toBe(true);
    expect(gate.metrics.proposedCount).toBeGreaterThan(0);
    expect(gate.metrics.declaredCount).toBe(0);

    const gdt = res.package.report.gdt!;
    const proposed = gdt.filter((r) => r.proposed);
    expect(proposed.length).toBeGreaterThan(0);
    // at least one flatness proposal on a datum plane, REAL-measured ~0
    const flat = proposed.find((r) => r.characteristic === 'flatness');
    expect(flat).toBeDefined();
    expect(flat!.actualMm).toBeLessThan(1e-6);
    // every emitted callout is within its zone (no fabricated over-tolerance value)
    for (const r of gdt) expect(r.actualMm).toBeLessThanOrEqual(r.toleranceMm + 1e-9);
  });

  it('is deterministic: same plan ⇒ identical report.gdt', async () => {
    const a = await run(structuredClone(lBracketPlan()), 'det');
    const b = await run(structuredClone(lBracketPlan()), 'det');
    expectOk(a);
    expectOk(b);
    expect(JSON.stringify(a.package.report.gdt)).toBe(JSON.stringify(b.package.report.gdt));
  });
});

describe('WB-5 GD&T gate — false / unresolvable callouts are refused (no fabrication)', () => {
  it('③ unresolvable feature (non-existent face) → gate fail, no package, explicit reason', async () => {
    const specs: PlanGdtSpec[] = [
      { id: 'g_ghost', partId: 'bracket', bodyId: 'main', characteristic: 'flatness', feature: 'f.side.99', toleranceMm: 0.05 },
    ];
    const res = await run(planWithGdt(specs), 'ghost');
    expectRefused(res);
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('gdt');
    const gate = res.gates.find((g) => g.id === 'gdt')!;
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('g_ghost');
    expect(gate.reason).toContain('does not resolve');
    // no fabricated value anywhere; the drawing gate still ran green (rich refusal IR)
    expect(res.gates.find((g) => g.id === 'drawing')!.pass).toBe(true);
  });

  it('④ false relation (perpendicularity claimed on two PARALLEL faces) → gate fail, measured actual > zone', async () => {
    // f.cap.top ∥ f.cap.bottom (both ±Z). Asserting ⟂ between them is geometrically
    // false; the gate must REAL-measure the violation, not rubber-stamp it.
    const specs: PlanGdtSpec[] = [
      { id: 'g_false', partId: 'bracket', bodyId: 'main', characteristic: 'perpendicularity', feature: 'f.cap.top', datums: ['f.cap.bottom'], toleranceMm: 0.05 },
    ];
    const res = await run(planWithGdt(specs), 'false');
    expectRefused(res);
    expect(res.refusal.failedGateIds).toContain('gdt');
    const gate = res.gates.find((g) => g.id === 'gdt')!;
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('g_false');
    expect(gate.reason).toContain('exceeds tolerance zone');
    // the measured actual (span·sin(90°)) is large and real — not a fabricated pass
    expect(gate.metrics.declaredFailureCount).toBe(1);
  });
});
