/**
 * Cost estimation tests — pure helper + tool wire-up.
 *
 * Validates the math (density × volume material cost, machine-time
 * formulas, setup amortization), the confidence labeling rules, and
 * the tool wrapper (BAD_ARGS, output shape, meta presence).
 *
 * The numeric tolerances are deliberately loose — this is an order-of-
 * magnitude estimator, not a quote tool. We assert structure + rough
 * ordering (PLA cheaper than Al, qty-1000 IM cheaper per-part than
 * qty-1, etc.) rather than tight numbers.
 */

import { describe, it, expect } from 'vitest';
import { estimateCost, formatCostBreakdown } from '../costEstimation';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';

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

function noopHost(): ToolHostAdapters {
  return {
    render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

function tool(tools: ReturnType<typeof makeTools>, name: 'estimate_cost'): ToolExecutor {
  return tools[name]!;
}

function asOk(r: ToolResult): { ok: true; output: string; meta?: Record<string, unknown> } {
  if (!r.ok) throw new Error(`expected ok result, got: ${r.error}`);
  return r;
}
function asErr(r: ToolResult): { ok: false; error: string; code?: string } {
  if (r.ok) throw new Error('expected error result');
  return r;
}

describe('estimateCost — helper math', () => {
  it('1 cm³ aluminum = 2.7 g; at $5/kg → $0.0135 material', () => {
    const c = estimateCost({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      measuredVolumeMm3: 1000, // 1 cm³
    });
    expect(c.materialUsd).toBeCloseTo(0.0135, 4);
  });

  it('aluminum cube 50mm cnc → reasonable cost breakdown with all rows present', () => {
    const c = estimateCost({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      measuredVolumeMm3: 125_000, // 50³ mm³
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    expect(c.materialUsd).toBeGreaterThan(0);
    expect(c.materialUsd).toBeLessThan(5); // 125 cm³ × 2.7 × $5/1000 = ~$1.69
    expect(c.machineUsd).toBeGreaterThan(0); // 125 cm³ / 50 = 2.5 hr × $100 = $250
    expect(c.setupUsd).toBeGreaterThan(0);
    expect(c.totalUsd).toBe(c.materialUsd + c.machineUsd + c.setupUsd);
    expect(c.breakdown).toHaveLength(3);
    expect(c.confidence).toBe('medium');
  });

  it('small PLA part fdm: confidence medium, material+machine far cheaper than CNC steel equivalent', () => {
    // A small 20mm cube: 8 cm³ — within FDM's reasonable build time
    // (6.4 hr at our 0.8 hr/cm³ rate) and trivial mass.
    const pla = estimateCost({
      process: 'fdm',
      material: 'pla',
      measuredVolumeMm3: 8_000,
    });
    const steel = estimateCost({
      process: 'cnc_mill',
      material: 'steel_4140',
      measuredVolumeMm3: 8_000,
      bboxMm: { wMm: 20, hMm: 20, dMm: 20 },
    });
    // PLA: 6.4 hr × $3 + tiny material + $5 setup ≈ $24
    // Steel CNC: 0.16 hr × $100 + material + $30 setup ≈ $46
    expect(pla.totalUsd).toBeLessThan(steel.totalUsd);
    expect(pla.confidence).toBe('medium');
  });

  it('metal on fdm → incompatibility blocker with $0 cost + rough confidence', () => {
    const c = estimateCost({
      process: 'fdm',
      material: 'steel_4140',
      measuredVolumeMm3: 1000,
    });
    expect(c.totalUsd).toBe(0);
    expect(c.confidence).toBe('rough');
    expect(c.breakdown[0]!.label).toMatch(/INCOMPATIBLE/);
  });

  it('plastic on die_cast → incompatibility blocker', () => {
    const c = estimateCost({
      process: 'die_cast',
      material: 'abs',
      measuredVolumeMm3: 1000,
    });
    expect(c.totalUsd).toBe(0);
    expect(c.breakdown[0]!.label).toMatch(/INCOMPATIBLE/);
  });

  it('sheet metal returns rough confidence with placeholder machine cost', () => {
    const c = estimateCost({
      process: 'sheet',
      material: 'steel_a36',
      measuredVolumeMm3: 50_000,
      bboxMm: { wMm: 100, hMm: 100, dMm: 5 },
    });
    expect(c.confidence).toBe('rough');
    // Sheet has a fixed $5 machine placeholder regardless of size.
    expect(c.machineUsd).toBe(5);
  });

  it('IM quantity amortization: qty 1000 cheaper per-part than qty 1', () => {
    const one = estimateCost({
      process: 'injection_molding',
      material: 'abs',
      measuredVolumeMm3: 10_000,
      quantity: 1,
    });
    const many = estimateCost({
      process: 'injection_molding',
      material: 'abs',
      measuredVolumeMm3: 10_000,
      quantity: 1000,
    });
    expect(many.totalUsd).toBeLessThan(one.totalUsd);
    // Setup dominates qty=1 ($2000 ÷ 1 = $2000); qty=1000 ÷ 1000 = $2.
    expect(one.setupUsd).toBeCloseTo(2000, 0);
    expect(many.setupUsd).toBeCloseTo(2, 0);
  });

  it('CNC setup ($30) divides cleanly by quantity', () => {
    const c1 = estimateCost({
      process: 'cnc_mill', material: 'aluminum_6061',
      measuredVolumeMm3: 1000, bboxMm: { wMm: 10, hMm: 10, dMm: 10 }, quantity: 1,
    });
    const c100 = estimateCost({
      process: 'cnc_mill', material: 'aluminum_6061',
      measuredVolumeMm3: 1000, bboxMm: { wMm: 10, hMm: 10, dMm: 10 }, quantity: 100,
    });
    expect(c1.setupUsd).toBeCloseTo(30, 1);
    expect(c100.setupUsd).toBeCloseTo(0.30, 2);
  });

  it('confidence: bbox-only (no measured volume) on fdm → low', () => {
    const c = estimateCost({
      process: 'fdm',
      material: 'pla',
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    expect(c.confidence).toBe('low');
    expect(c.materialUsd).toBeGreaterThan(0);
  });

  it('confidence: measured volume on injection_molding → low (IM rules not volume-driven)', () => {
    const c = estimateCost({
      process: 'injection_molding',
      material: 'pla',
      measuredVolumeMm3: 10_000,
      quantity: 1000,
    });
    expect(c.confidence).toBe('low');
  });

  it('degenerate volume (≤0) still reports amortized setup floor', () => {
    const c = estimateCost({
      process: 'fdm',
      material: 'pla',
      measuredVolumeMm3: 0,
    });
    expect(c.materialUsd).toBe(0);
    expect(c.setupUsd).toBeGreaterThan(0);
    expect(c.confidence).toBe('rough');
  });

  it('unknown material throws (caller must validate)', () => {
    expect(() => estimateCost({
      process: 'fdm',
      // @ts-expect-error — intentional bad material to test runtime guard
      material: 'unobtainium',
      measuredVolumeMm3: 1000,
    })).toThrow(/unknown material/);
  });

  it('formatCostBreakdown includes every breakdown row label', () => {
    const opts = {
      process: 'fdm' as const,
      material: 'pla' as const,
      measuredVolumeMm3: 10_000,
    };
    const c = estimateCost(opts);
    const text = formatCostBreakdown(opts, c);
    for (const row of c.breakdown) {
      expect(text).toContain(row.label);
    }
    expect(text).toMatch(/TOTAL:/);
    expect(text).toMatch(/confidence:/);
  });

  it('formatCostBreakdown flags rough confidence as FOR REFERENCE ONLY', () => {
    const opts = {
      process: 'sheet' as const,
      material: 'steel_a36' as const,
      measuredVolumeMm3: 1000,
    };
    const c = estimateCost(opts);
    const text = formatCostBreakdown(opts, c);
    expect(text).toMatch(/FOR REFERENCE ONLY/);
  });
});

describe('estimate_cost — tool executor wire', () => {
  it('tool returns BAD_ARGS without process', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'estimate_cost')({ material: 'pla' }, session));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool returns BAD_ARGS without material', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'estimate_cost')({ process: 'fdm' }, session));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool returns ok with meta.cost populated and human-readable output', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'estimate_cost')(
      { process: 'fdm', material: 'pla', measuredVolumeMm3: 10_000 },
      session,
    ));
    expect(res.meta?.cost).toBeDefined();
    const cost = res.meta!.cost as { totalUsd: number; breakdown: unknown[]; confidence: string };
    expect(cost.totalUsd).toBeGreaterThan(0);
    expect(Array.isArray(cost.breakdown)).toBe(true);
    expect(res.output).toMatch(/TOTAL:/);
  });

  it('tool defaults quantity to 1 when omitted', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'estimate_cost')(
      { process: 'cnc_mill', material: 'aluminum_6061', measuredVolumeMm3: 1000, bboxMm: { wMm: 10, hMm: 10, dMm: 10 } },
      session,
    ));
    const cost = res.meta!.cost as { setupUsd: number };
    // CNC setup $30, qty=1 → $30 amortized.
    expect(cost.setupUsd).toBeCloseTo(30, 1);
  });
});
