/**
 * Material recommendation tests — pure helper + tool wire-up.
 *
 * Validates the heuristic rules (default workshop ranking, process gates,
 * environment gates, loading/budget modifiers) and the tool wrapper shape
 * (BAD_ARGS on bad opts, meta.scores populated on ok).
 *
 * Mirrors processSelection.test.ts in style — same blankSession / noopHost
 * scaffolding, same find/asOk/asErr helpers so the agent test suite reads
 * uniformly across recommendation families.
 */

import { describe, it, expect } from 'vitest';
import { suggestMaterialForPart, formatMaterialScores, type MaterialScore } from '../materialRecommendation';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';
import type { Material } from '../costEstimation';

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

function tool(tools: ReturnType<typeof makeTools>, name: 'suggest_material'): ToolExecutor {
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

/** Find a material's score row by name. */
function find(scores: MaterialScore[], m: Material): MaterialScore | undefined {
  return scores.find(s => s.material === m);
}

describe('suggestMaterialForPart — heuristic rules', () => {
  it('default (no options) returns all 6 materials with aluminum_6061 ranked first', () => {
    const scores = suggestMaterialForPart({});
    expect(scores).toHaveLength(6);
    expect(scores[0]!.material).toBe('aluminum_6061');
    // Every material has its priceUsdPerKg populated for UI display.
    for (const s of scores) expect(s.pricePerKgUsd).toBeGreaterThan(0);
  });

  it('process="fdm" blocks all metal materials (score=0, blocker text)', () => {
    const scores = suggestMaterialForPart({ process: 'fdm' });
    expect(find(scores, 'aluminum_6061')!.score).toBe(0);
    expect(find(scores, 'steel_a36')!.score).toBe(0);
    expect(find(scores, 'steel_4140')!.score).toBe(0);
    expect(find(scores, 'stainless_304')!.score).toBe(0);
    expect(find(scores, 'aluminum_6061')!.blockers.length).toBeGreaterThan(0);
    // PLA / ABS remain in the running.
    expect(find(scores, 'pla')!.score).toBeGreaterThan(0);
    expect(find(scores, 'abs')!.score).toBeGreaterThan(0);
  });

  it('environment="outdoor" ranks 304SS top; A36 and PLA flagged with warnings', () => {
    const scores = suggestMaterialForPart({ environment: 'outdoor' });
    expect(scores[0]!.material).toBe('stainless_304');
    expect(find(scores, 'steel_a36')!.warnings.some(w => /rust|galvanize|paint/i.test(w))).toBe(true);
    expect(find(scores, 'pla')!.warnings.some(w => /UV|sun|degrade/i.test(w))).toBe(true);
  });

  it('environment="food" blocks non-food-safe materials; 304SS ranks first', () => {
    const scores = suggestMaterialForPart({ environment: 'food' });
    // 304SS, PLA, ABS are food-safe — others must be blocked.
    expect(find(scores, 'aluminum_6061')!.score).toBe(0);
    expect(find(scores, 'steel_a36')!.score).toBe(0);
    expect(find(scores, 'steel_4140')!.score).toBe(0);
    expect(find(scores, 'stainless_304')!.score).toBeGreaterThan(0);
    expect(find(scores, 'pla')!.score).toBeGreaterThan(0);
    expect(find(scores, 'abs')!.score).toBeGreaterThan(0);
    expect(scores[0]!.material).toBe('stainless_304');
  });

  it('environment="high_temp" blocks PLA (Tg 60°C) and warns ABS', () => {
    const scores = suggestMaterialForPart({ environment: 'high_temp' });
    expect(find(scores, 'pla')!.score).toBe(0);
    expect(find(scores, 'pla')!.blockers[0]).toMatch(/PLA|softens|60/i);
    const abs = find(scores, 'abs')!;
    expect(abs.warnings.some(w => /Tg|105|temp/i.test(w))).toBe(true);
  });

  it('loading="structural" + process="fdm" surfaces the plastic-for-structural warning', () => {
    const scores = suggestMaterialForPart({ process: 'fdm', loading: 'structural' });
    const pla = find(scores, 'pla')!;
    const abs = find(scores, 'abs')!;
    // FDM metals are blocked → plastics are the only candidates, both flagged.
    expect(pla.warnings.some(w => /structural|creep|fatigue|design review/i.test(w))).toBe(true);
    expect(abs.warnings.some(w => /structural|creep|fatigue|design review/i.test(w))).toBe(true);
  });

  it('budget="cheap" boosts A36 and PLA above 4140/304SS', () => {
    const scores = suggestMaterialForPart({ budget: 'cheap' });
    const a36 = find(scores, 'steel_a36')!;
    const pla = find(scores, 'pla')!;
    const ss = find(scores, 'stainless_304')!;
    const t4140 = find(scores, 'steel_4140')!;
    expect(a36.score).toBeGreaterThan(ss.score);
    expect(pla.score).toBeGreaterThan(t4140.score);
  });

  it('budget="premium" boosts 4140 and 304SS', () => {
    const cheap = suggestMaterialForPart({ budget: 'cheap' });
    const premium = suggestMaterialForPart({ budget: 'premium' });
    expect(find(premium, 'stainless_304')!.score).toBeGreaterThan(find(cheap, 'stainless_304')!.score);
    expect(find(premium, 'steel_4140')!.score).toBeGreaterThan(find(cheap, 'steel_4140')!.score);
  });

  it('quantityHint ≥ 1000 penalizes 4140 / 304SS (lead time + raw cost)', () => {
    const small = suggestMaterialForPart({ quantityHint: 1 });
    const bulk = suggestMaterialForPart({ quantityHint: 5000 });
    expect(find(bulk, 'steel_4140')!.score).toBeLessThan(find(small, 'steel_4140')!.score);
    expect(find(bulk, 'stainless_304')!.score).toBeLessThan(find(small, 'stainless_304')!.score);
  });

  it('blocked materials sort to the bottom of the list', () => {
    const scores = suggestMaterialForPart({ process: 'fdm' });
    // The 4 blocked metals must all sit after the 2 surviving plastics.
    const lastTwo = scores.slice(-4).map(s => s.material).sort();
    expect(lastTwo).toEqual(['aluminum_6061', 'stainless_304', 'steel_4140', 'steel_a36'].sort());
  });

  it('formatMaterialScores includes rank, material, blockers, warnings, price', () => {
    const scores = suggestMaterialForPart({ environment: 'food' });
    const text = formatMaterialScores(scores);
    expect(text).toMatch(/Material recommendations/);
    expect(text).toMatch(/BLOCKER:/);
    expect(text).toMatch(/\$\d+(\.\d+)?\/kg/);
  });
});

describe('suggest_material — tool executor wire', () => {
  it('tool returns ok with full 6-material ranking on empty args', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_material')({}, session));
    const scores = res.meta!.scores as MaterialScore[];
    expect(scores).toHaveLength(6);
    expect(scores[0]!.material).toBe('aluminum_6061');
    expect(res.output).toMatch(/Material recommendations/);
  });

  it('tool returns BAD_ARGS when args is non-object', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    // @ts-expect-error — intentional bad call
    const res = asErr(await tool(tools, 'suggest_material')('nope', session));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool forwards environment="food" into scoring (304SS first)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_material')(
      { environment: 'food' },
      session,
    ));
    const scores = res.meta!.scores as MaterialScore[];
    expect(scores[0]!.material).toBe('stainless_304');
  });
});
