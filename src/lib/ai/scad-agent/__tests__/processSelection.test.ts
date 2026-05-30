/**
 * Process selection tests — pure helper + tool wire-up.
 *
 * Validates ranking behavior (metal favors CNC, plastic small-qty
 * favors print, high-qty plastic favors IM), blocker surfacing
 * (metal on FDM is blocked, sheet metal can't chamfer, thin wall
 * blocks rigid processes), and the tool wrapper shape.
 */

import { describe, it, expect } from 'vitest';
import { suggestProcessForPart, formatProcessScores, type ProcessScore } from '../processSelection';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';
import type { IntentInput } from '../../../openscad-render/intentToScad';
import type { ProcessForDfm } from '../specVerification';

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

function tool(tools: ReturnType<typeof makeTools>, name: 'suggest_process'): ToolExecutor {
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

/** Get the score row for a particular process from a result list. */
function find(scores: ProcessScore[], p: ProcessForDfm): ProcessScore | undefined {
  return scores.find(s => s.process === p);
}

describe('suggestProcessForPart — helper heuristics', () => {
  it('metal box → cnc_mill ranks highest; fdm/sla blocked (score=0)', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const scores = suggestProcessForPart({ intent, materialHint: 'metal', returnAll: true });
    expect(scores[0]!.process).toBe('cnc_mill');
    expect(find(scores, 'fdm')!.score).toBe(0);
    expect(find(scores, 'sla')!.score).toBe(0);
    expect(find(scores, 'fdm')!.blockers.length).toBeGreaterThan(0);
  });

  it('plastic small one-off → fdm/sla rank above IM', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'plastic',
      quantityHint: 1,
      returnAll: true,
    });
    const fdm = find(scores, 'fdm')!;
    const sla = find(scores, 'sla')!;
    const im = find(scores, 'injection_molding')!;
    expect(fdm.score).toBeGreaterThan(im.score);
    expect(sla.score).toBeGreaterThan(im.score);
  });

  it('high-quantity plastic → injection_molding ranks highest', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'plastic',
      quantityHint: 5000,
      returnAll: true,
    });
    expect(scores[0]!.process).toBe('injection_molding');
  });

  it('low-quantity IM gets a warning about setup cost dominating', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'plastic',
      quantityHint: 10,
      returnAll: true,
    });
    const im = find(scores, 'injection_molding')!;
    expect(im.warnings.some(w => /setup/i.test(w))).toBe(true);
  });

  it('thin wall (<0.6mm) blocks cnc_mill / IM / die_cast', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'any',
      measured: { minWallMm: 0.4 },
      returnAll: true,
    });
    expect(find(scores, 'cnc_mill')!.score).toBe(0);
    expect(find(scores, 'injection_molding')!.score).toBe(0);
    expect(find(scores, 'die_cast')!.score).toBe(0);
    expect(find(scores, 'cnc_mill')!.blockers.length).toBeGreaterThan(0);
  });

  it('sheet metal blocked when many chamfered edges are required', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 100, height: 100, depth: 3 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'metal',
      measured: { chamferEdgeCount: 100 },
      returnAll: true,
    });
    expect(find(scores, 'sheet')!.score).toBe(0);
    expect(find(scores, 'sheet')!.blockers[0]).toMatch(/chamfer/i);
  });

  it('large part (>200mm) penalizes sla', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 250, height: 250, depth: 50 } };
    const baseline = suggestProcessForPart({
      intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
      materialHint: 'plastic',
      returnAll: true,
    });
    const big = suggestProcessForPart({
      intent,
      materialHint: 'plastic',
      measured: { bboxMm: { wMm: 250, hMm: 250, dMm: 50 } },
      returnAll: true,
    });
    expect(find(big, 'sla')!.score).toBeLessThan(find(baseline, 'sla')!.score);
    expect(find(big, 'sla')!.warnings.some(w => /build volume/i.test(w))).toBe(true);
  });

  it('many holes penalizes injection_molding (mold complexity)', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 100, height: 100, depth: 10 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'plastic',
      quantityHint: 5000,
      measured: { holeCount: 30 },
      returnAll: true,
    });
    const im = find(scores, 'injection_molding')!;
    expect(im.warnings.some(w => /mold|tooling/i.test(w))).toBe(true);
  });

  it('returns top-3 by default; returnAll gives all 6', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } };
    const top3 = suggestProcessForPart({ intent });
    const all = suggestProcessForPart({ intent, returnAll: true });
    expect(top3).toHaveLength(3);
    expect(all).toHaveLength(6);
  });

  it('throws when called without intent (defensive)', () => {
    // @ts-expect-error — intentional bad call
    expect(() => suggestProcessForPart({})).toThrow();
  });

  it('formatProcessScores includes rank, process, blockers, warnings', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const scores = suggestProcessForPart({
      intent,
      materialHint: 'metal',
      measured: { chamferEdgeCount: 100 },
      returnAll: true,
    });
    const text = formatProcessScores(scores);
    expect(text).toMatch(/Process recommendations/);
    expect(text).toMatch(/BLOCKER:/);
  });
});

describe('suggest_process — tool executor wire', () => {
  it('tool returns BAD_ARGS without intent', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'suggest_process')({}, session));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool returns BAD_ARGS when intent.shapeId is missing', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'suggest_process')(
      { intent: { params: { width: 50 } } },
      session,
    ));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool returns ok with meta.scores populated and ranked output', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_process')(
      {
        intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        materialHint: 'metal',
        quantityHint: 1,
      },
      session,
    ));
    expect(Array.isArray(res.meta?.scores)).toBe(true);
    const scores = res.meta!.scores as Array<{ process: string; score: number }>;
    expect(scores.length).toBe(3); // top-3 default
    expect(res.output).toMatch(/Process recommendations/);
  });

  it('tool honors returnAll flag (returns all 6 scores)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_process')(
      {
        intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        returnAll: true,
      },
      session,
    ));
    const scores = res.meta!.scores as Array<unknown>;
    expect(scores).toHaveLength(6);
  });

  it('tool forwards measured stats into scoring (thin wall blocks cnc)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_process')(
      {
        intent: { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } },
        materialHint: 'any',
        measured: { minWallMm: 0.3 },
        returnAll: true,
      },
      session,
    ));
    const scores = res.meta!.scores as ProcessScore[];
    const cnc = scores.find(s => s.process === 'cnc_mill');
    expect(cnc!.score).toBe(0);
  });
});
