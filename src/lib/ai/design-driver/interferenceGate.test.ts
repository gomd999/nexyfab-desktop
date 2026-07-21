/**
 * WB-4 interference gate — closes AI_COVERAGE_MATRIX ⑧ ("간섭 게이트 미포함
 * → 부품 관통도 통과 가능"). The solved assembly placement is collision-checked
 * (world AABB) before a package is emitted.
 *
 * Scenarios (계획 §3):
 *   (a) normal assembly (pin-block, seated / mated) → interference gate PASS,
 *       package emitted. The mated pin↔block pair overlaps in AABB (the solved
 *       pin flips through the block bbox) — proving the gate is NOT vacuous:
 *       the overlap is real, and it PASSES only because mated pairs are
 *       whitelisted (design-intended contact).
 *   (b) penetrating assembly (two NON-mated boxes overlapped) → gate FAIL with
 *       the measured penetration, and 패키지 미산출 (driver returns ok:false).
 *   (c) contact assembly (two NON-mated boxes face-touching, penetration 0)
 *       → gate PASS.
 */

import { describe, expect, it } from 'vitest';
import {
  buildInterferenceArtifact,
  buildPartGeometry,
  fixturePlanner,
  interferenceGate,
  pinBlockAssemblyPlan,
  runDesignDriver,
  solvePlanAssembly,
  type DesignPlan,
  type DesignPlanner,
  type DriverResult,
  type PartGeometry,
  type PlanPart,
} from './index';

// ─── helpers ───────────────────────────────────────────────────────────────

/** 20×20×20 square-prism part (extrude — measurable topo, passes geom+dfm). */
function boxPart(id: string, name: string): PlanPart {
  return {
    partId: id,
    name,
    material: 'AL6061',
    process: 'cnc',
    bodies: [
      {
        bodyId: 'main',
        feature: {
          kind: 'extrude',
          loop: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          depth: 20,
          direction: 'one_sided',
          mode: 'add',
        },
      },
    ],
    expectedVolume: { valueMm3: 8000, basis: 'exact prism 20×20 mm² × 20 mm — no tessellation' },
  };
}

/** Two fixed boxes, boxB translated by `bx` on +x, NO mate between them. */
function twoBoxPlan(bx: number): DesignPlan {
  return {
    planId: 'test-two-box',
    name: 'Two Box',
    parts: [boxPart('boxA', 'Box A'), boxPart('boxB', 'Box B')],
    assembly: {
      parts: [
        { partId: 'boxA', fixed: true, refs: { o: { kind: 'point', origin: { x: 0, y: 0, z: 0 } } } },
        { partId: 'boxB', fixed: true, position: { x: bx, y: 0, z: 0 }, refs: { o: { kind: 'point', origin: { x: 0, y: 0, z: 0 } } } },
      ],
      mates: [], // deliberately unmated — the gate must catch their collision
      tolerance: 1e-6,
    },
    drawing: {
      paperSize: 'A3',
      scale: 1,
      dimensions: [
        { id: 'a_w', partId: 'boxA', bodyId: 'main', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: 20 },
        { id: 'a_d', partId: 'boxA', bodyId: 'main', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: 20 },
        { id: 'b_w', partId: 'boxB', bodyId: 'main', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: 20 },
        { id: 'b_d', partId: 'boxB', bodyId: 'main', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: 20 },
      ],
    },
  };
}

function plannerFor(plan: DesignPlan): DesignPlanner {
  return { name: 'test', plan: () => plan };
}

function geometriesOf(plan: DesignPlan): Map<string, PartGeometry> {
  return new Map(plan.parts.map((p) => [p.partId, buildPartGeometry(p)]));
}

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`expected ok:true — refusal: ${res.refusal.reason}`);
}

// ─── (a) normal (mated) assembly — gate PASS, whitelist not vacuous ─────────

describe('WB-4 (a) normal pin-block assembly', () => {
  it('interference gate PASSES and a package is emitted (regression-safe)', async () => {
    const res = await runDesignDriver(
      { id: 'pin-block-assembly', text: 'fixture' },
      { planner: fixturePlanner },
    );
    expectOk(res);

    const gate = res.gates.find((g) => g.id === 'interference');
    expect(gate, 'interference gate present in chain').toBeDefined();
    expect(gate!.pass).toBe(true);
    expect(gate!.metrics.flaggedPairs).toBe(0);
    // package still produced (all gates green)
    expect(res.package.assembly).toBeDefined();
  });

  it('is NOT a vacuous pass — the mated pin↔block AABB overlap is real and whitelisted', () => {
    const plan = pinBlockAssemblyPlan();
    const geos = geometriesOf(plan);
    const art = solvePlanAssembly(plan.assembly!);
    const iart = buildInterferenceArtifact(plan, art, geos);

    // The solved pin genuinely overlaps the block bbox (>> contact tol) ...
    expect(iart.rawOverlaps).toHaveLength(1);
    expect(iart.rawOverlaps[0]!.penetration).toBeGreaterThan(1); // measured ≈ 10 mm
    // ... but it is a MATED pair → whitelisted → nothing flagged.
    expect(iart.whitelistedPairs).toEqual(['block::pin']);
    expect(iart.flagged).toHaveLength(0);
    expect(interferenceGate(plan, iart).pass).toBe(true);
  });
});

// ─── (b) penetrating assembly — gate FAIL, 패키지 미산출 ─────────────────────

describe('WB-4 (b) penetrating (non-mated) assembly', () => {
  it('gate FAILS with the measured penetration and blocks the package', async () => {
    const plan = twoBoxPlan(10); // boxB at x=10 → overlaps boxA[0..20] by 10 mm

    // gate-level: penetration measured, pair flagged
    const iart = buildInterferenceArtifact(plan, solvePlanAssembly(plan.assembly!), geometriesOf(plan));
    expect(iart.flagged).toHaveLength(1);
    expect(iart.flagged[0]!.penetration).toBeCloseTo(10, 9);
    const gate = interferenceGate(plan, iart);
    expect(gate.pass).toBe(false);
    expect(gate.metrics.flaggedPairs).toBe(1);
    expect(gate.metrics.maxPenetrationMm).toBeCloseTo(10, 9);
    expect(gate.reason).toContain('boxA');
    expect(gate.reason).toContain('boxB');

    // end-to-end: driver refuses, no package, interference is the sole blocker
    const res = await runDesignDriver({ id: 'b', text: 'penetrating' }, { planner: plannerFor(plan) });
    expect(res.ok).toBe(false);
    expect('package' in res).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('interference');
    for (const g of res.gates) {
      if (g.id !== 'interference') expect(g.pass, `${g.id} should pass`).toBe(true);
    }
  });
});

// ─── (c) contact assembly — gate PASS ───────────────────────────────────────

describe('WB-4 (c) contact (non-mated) assembly', () => {
  it('face-touching boxes (penetration 0) PASS the gate and package', async () => {
    const plan = twoBoxPlan(20); // boxB at x=20 → shares the x=20 face, no overlap

    const iart = buildInterferenceArtifact(plan, solvePlanAssembly(plan.assembly!), geometriesOf(plan));
    expect(iart.rawOverlaps).toHaveLength(0); // exact contact is not an overlap
    expect(iart.flagged).toHaveLength(0);
    const gate = interferenceGate(plan, iart);
    expect(gate.pass).toBe(true);
    expect(gate.metrics.maxPenetrationMm).toBe(0);

    const res = await runDesignDriver({ id: 'c', text: 'contact' }, { planner: plannerFor(plan) });
    expectOk(res);
    expect(res.gates.find((g) => g.id === 'interference')!.pass).toBe(true);
  });
});
