/**
 * U — Sheet metal multi-bend unfold tests.
 */
import { describe, it, expect } from 'vitest';
import { makeTools } from '../tools';
import type { AgentSession } from '../types';

function blankSession(): AgentSession {
  return {
    id: 's',
    scadSource: '', modules: {}, composition: null, designPlan: null,
    checkpoints: [], brepEntries: [], sketches: {}, mates: [], gdtFrames: [], docRefs: [], history: [],
    render: { ok: null, errors: [] }, geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

function host() {
  return {
    render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

describe('sheet_metal_unfold', () => {
  it('rejects bad args', async () => {
    const tools = makeTools(host());
    const r = await tools.sheet_metal_unfold!({}, blankSession());
    expect(r.ok).toBe(false);
  });

  it('zero-bend strip flat length equals folded length', async () => {
    const tools = makeTools(host());
    const r = await tools.sheet_metal_unfold!({
      partLengthMm: 100, widthMm: 50, thicknessMm: 1.5, bends: [],
    }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta?.flatLengthMm).toBeCloseTo(100, 1);
    }
  });

  it('single 90° bend at midpoint adds bend allowance', async () => {
    const tools = makeTools(host());
    const r = await tools.sheet_metal_unfold!({
      partLengthMm: 100, widthMm: 50, thicknessMm: 2,
      bends: [{ positionMm: 50, angleDeg: 90, innerRadiusMm: 2 }],
    }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) {
      // BA = π × (R + k×t) × (90/180) = π × (2 + 0.44×2) × 0.5
      //    = π × 2.88 × 0.5 ≈ 4.524
      // Flat length ≈ 100 + 4.524 = 104.524
      expect(r.meta?.flatLengthMm as number).toBeCloseTo(104.524, 2);
      expect((r.meta?.perBend as Array<{ allowanceMm: number }>)[0].allowanceMm).toBeCloseTo(4.524, 2);
    }
  });

  it('multi-bend channel sums per-bend allowances', async () => {
    const tools = makeTools(host());
    const r = await tools.sheet_metal_unfold!({
      partLengthMm: 200, widthMm: 30, thicknessMm: 1,
      bends: [
        { positionMm: 50, angleDeg: 90 },
        { positionMm: 150, angleDeg: 90 },
      ],
    }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const perBend = r.meta?.perBend as Array<{ allowanceMm: number }>;
      expect(perBend.length).toBe(2);
      // Each 90° bend with R=t=1 → BA = π × (1 + 0.44) × 0.5 ≈ 2.262
      expect(perBend[0].allowanceMm).toBeCloseTo(2.262, 2);
      expect(perBend[1].allowanceMm).toBeCloseTo(2.262, 2);
      // Flat length = 200 + 2 × 2.262 ≈ 204.524
      expect(r.meta?.flatLengthMm as number).toBeCloseTo(204.524, 2);
    }
  });

  it('U-bend (180°) doubles the allowance per bend vs 90°', async () => {
    const tools = makeTools(host());
    const r90 = await tools.sheet_metal_unfold!({
      partLengthMm: 100, widthMm: 30, thicknessMm: 2,
      bends: [{ positionMm: 50, angleDeg: 90, innerRadiusMm: 2 }],
    }, blankSession());
    const r180 = await tools.sheet_metal_unfold!({
      partLengthMm: 100, widthMm: 30, thicknessMm: 2,
      bends: [{ positionMm: 50, angleDeg: 180, innerRadiusMm: 2 }],
    }, blankSession());
    if (r90.ok && r180.ok) {
      const ba90 = (r90.meta?.perBend as Array<{ allowanceMm: number }>)[0].allowanceMm;
      const ba180 = (r180.meta?.perBend as Array<{ allowanceMm: number }>)[0].allowanceMm;
      expect(ba180).toBeCloseTo(ba90 * 2, 3);
    }
  });

  it('custom k-factor changes the allowance', async () => {
    const tools = makeTools(host());
    const rDefault = await tools.sheet_metal_unfold!({
      partLengthMm: 100, widthMm: 30, thicknessMm: 2,
      bends: [{ positionMm: 50, angleDeg: 90, innerRadiusMm: 2 }],
    }, blankSession());
    const rTighter = await tools.sheet_metal_unfold!({
      partLengthMm: 100, widthMm: 30, thicknessMm: 2,
      bends: [{ positionMm: 50, angleDeg: 90, innerRadiusMm: 2 }],
      kFactor: 0.33,  // brass
    }, blankSession());
    if (rDefault.ok && rTighter.ok) {
      expect(rTighter.meta?.flatLengthMm as number).toBeLessThan(rDefault.meta?.flatLengthMm as number);
    }
  });
});
