/**
 * designDriver.pattern.test.ts — WB-7 패턴·기어 사이징 편입 acceptance.
 *
 * A spur gear (circular tooth pattern) now flows through the whole driver: plan
 * → build → geometry gate (gear blank) → pattern gate (REAL instance layout +
 * gear sizing: pitch diameter, circular pitch, angular pitch, non-overlap) →
 * package with the layout. Promotes coverage-matrix category ⑥ (기어) to "부분":
 * gear SIZING is planned + verified; the involute tooth PROFILE is explicitly
 * excluded (stated, not faked).
 */
import { describe, it, expect } from 'vitest';
import { runDesignDriver } from '../index';
import { fixturePlanner, spurGearPlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import type { DriverResult } from '../types';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

const CIRCULAR_PITCH = Math.PI * 2; // module 2

describe('WB-7 driver integration — spur-gear pattern flows end-to-end', () => {
  it('spur-gear fixture → all gates pass → package with gear-sized tooth layout', async () => {
    const res = await runDesignDriver(
      { id: 'spur-gear', text: 'a module-2 20-tooth spur gear', params: { fixture: 'spur-gear' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) {
      expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);
    }

    const pg = res.gates.find((g) => g.id === 'pattern:gear');
    expect(pg, 'pattern gate must be present').toBeTruthy();
    expect(pg!.kind).toBe('pattern');
    expect(pg!.metrics.totalInstances).toBe(20);

    const rec = res.package.parts[0]!.patterns![0]!;
    expect(rec.kind).toBe('circular');
    expect(rec.instances).toHaveLength(20);
    expect(rec.angularPitchDeg).toBeCloseTo(18, 9);
    expect(rec.arcSpacingMm).toBeCloseTo(CIRCULAR_PITCH, 6); // pitch-circle arc = circular pitch
    expect(rec.gear!.pitchDiameterMm).toBeCloseTo(40, 9);
    expect(rec.gear!.circularPitchMm).toBeCloseTo(CIRCULAR_PITCH, 9);
    expect(rec.gear!.teeth).toBe(20);
  });

  it('overlapping teeth (seed > arc spacing) are REFUSED', async () => {
    const plan = spurGearPlan();
    plan.parts[0]!.patterns![0]!.seedSizeMm = 10; // > 6.283 mm arc spacing
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-gear-overlap', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('pattern:gear');
    expect(res.refusal.reason).toContain('overlap');
  });

  it('an inconsistent pitch radius vs module×teeth is REFUSED', async () => {
    const plan = spurGearPlan();
    plan.parts[0]!.patterns![0]!.radiusMm = 50; // ≠ pitch radius 20
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-gear-bad', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('pattern:gear');
    expect(res.refusal.reason).toContain('pitch radius');
  });

  it('the LLM path coerces a gear pattern and lays it out', async () => {
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(spurGearPlan()) });
    const res = await runDesignDriver({ id: 'llm-gear', text: 'a gear' }, { planner: mockLlm });
    expectOk(res);
    expect(res.package.parts[0]!.patterns![0]!.instances).toHaveLength(20);
  });
});
