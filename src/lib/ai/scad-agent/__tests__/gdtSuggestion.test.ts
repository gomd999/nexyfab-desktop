/**
 * GD&T suggester tests — pure helper + tool wire-up.
 *
 * Helper tests cover the heuristic v1 mapping (hole → position,
 * thread → cylindricity, box top → flatness, cylinder → perpendicularity,
 * process/grade scaling). Tool tests cover the executor wire shape:
 * BAD_ARGS on missing intent, ok=true with meta.suggestions populated,
 * and the human-readable output includes each suggestion's reason.
 */

import { describe, it, expect } from 'vitest';
import { suggestGdtForIntent, formatSuggestions } from '../gdtSuggestion';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';
import type { IntentInput } from '../../../openscad-render/intentToScad';

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

function tool(
  tools: ReturnType<typeof makeTools>,
  name: 'suggest_gdt_for_intent',
): ToolExecutor {
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

describe('suggestGdtForIntent — helper heuristics', () => {
  it('box with no features → datum_seed + flatness on top face', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const s = suggestGdtForIntent(intent);
    expect(s).toHaveLength(2);
    expect(s[0]!.source).toBe('datum_seed');
    expect(s[1]!.source).toBe('flatness');
    expect(s[1]!.symbol).toBe('flatness');
    expect(s[1]!.featureRef).toBe('face_top');
    // cnc_mill default → 0.05 mm flatness
    expect(s[1]!.toleranceMm).toBeCloseTo(0.05);
  });

  it('cylinder with no features → datum_seed + flatness (end face) + perpendicularity', () => {
    const intent: IntentInput = { shapeId: 'cylinder', params: { diameter: 30, height: 60 } };
    const s = suggestGdtForIntent(intent);
    expect(s).toHaveLength(3);
    expect(s.map(x => x.source)).toEqual(['datum_seed', 'flatness', 'cylinder_axis']);
    const perp = s.find(x => x.source === 'cylinder_axis');
    expect(perp).toBeDefined();
    expect(perp!.symbol).toBe('perpendicularity');
    expect(perp!.datumRefs).toEqual(['A']);
    expect(perp!.toleranceMm).toBeCloseTo(0.03);
  });

  it('box with 1 hole → datum_seed + position (Ø 0.1 cnc) + flatness; single hole datum=[A]', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
    };
    const s = suggestGdtForIntent(intent);
    const hole = s.find(x => x.source === 'hole');
    expect(hole).toBeDefined();
    expect(hole!.symbol).toBe('position');
    expect(hole!.toleranceMm).toBeCloseTo(0.1);
    expect(hole!.datumRefs).toEqual(['A']);
    expect(s.some(x => x.source === 'flatness')).toBe(true);
    expect(s.some(x => x.source === 'datum_seed')).toBe(true);
  });

  it('box with 4 holes → 4 position frames with datum=[A, B] + parallelism on pattern axis', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 10 },
      features: [
        { type: 'hole', params: { x: 10, y: 10, diameter: 5 } },
        { type: 'hole', params: { x: -10, y: 10, diameter: 5 } },
        { type: 'hole', params: { x: 10, y: -10, diameter: 5 } },
        { type: 'hole', params: { x: -10, y: -10, diameter: 5 } },
      ],
    };
    const s = suggestGdtForIntent(intent);
    const holes = s.filter(x => x.source === 'hole');
    expect(holes).toHaveLength(4);
    for (const h of holes) {
      expect(h.symbol).toBe('position');
      expect(h.datumRefs).toEqual(['A', 'B']);
    }
    expect(s.some(x => x.source === 'parallelism')).toBe(true);
  });

  it('thread feature → adds cylindricity entry', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 10 },
      features: [{ type: 'thread', params: { diameter: 8, pitch: 1.25 } }],
    };
    const s = suggestGdtForIntent(intent);
    const thread = s.find(x => x.source === 'thread');
    expect(thread).toBeDefined();
    expect(thread!.symbol).toBe('cylindricity');
    expect(thread!.toleranceMm).toBeCloseTo(0.05);
    expect(thread!.reason).toMatch(/fastener engagement/);
  });

  it('process variation: fdm scales hole position tolerance to 0.3 mm', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
    };
    const s = suggestGdtForIntent(intent, { processForDfm: 'fdm' });
    const hole = s.find(x => x.source === 'hole');
    expect(hole!.toleranceMm).toBeCloseTo(0.3);
    const flat = s.find(x => x.source === 'flatness');
    expect(flat!.toleranceMm).toBeCloseTo(0.2);
  });

  it('grade=precision halves toleranceMm vs standard', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
    };
    const s = suggestGdtForIntent(intent, { grade: 'precision' });
    const hole = s.find(x => x.source === 'hole');
    expect(hole!.toleranceMm).toBeCloseTo(0.05);
    const flat = s.find(x => x.source === 'flatness');
    expect(flat!.toleranceMm).toBeCloseTo(0.025);
  });

  it('grade=rough doubles toleranceMm vs standard', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
    };
    const s = suggestGdtForIntent(intent, { grade: 'rough' });
    const hole = s.find(x => x.source === 'hole');
    expect(hole!.toleranceMm).toBeCloseTo(0.2);
    const flat = s.find(x => x.source === 'flatness');
    expect(flat!.toleranceMm).toBeCloseTo(0.1);
  });

  it('sphere with no features → datum_seed only, no flatness/perpendicularity', () => {
    const intent: IntentInput = { shapeId: 'sphere', params: { diameter: 30 } };
    const s = suggestGdtForIntent(intent);
    expect(s).toHaveLength(1);
    expect(s[0]!.source).toBe('datum_seed');
  });

  it('torus with no features → datum_seed only, no flatness', () => {
    const intent: IntentInput = { shapeId: 'torus', params: { majorDiameter: 60, tubeDiameter: 10 } };
    const s = suggestGdtForIntent(intent);
    expect(s).toHaveLength(1);
    expect(s[0]!.source).toBe('datum_seed');
  });

  it('formatSuggestions: empty list returns "no GD&T suggestions" sentence', () => {
    expect(formatSuggestions([])).toMatch(/No GD&T suggestions/);
  });

  it('formatSuggestions: every suggestion reason appears in the output', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 10 },
      features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
    };
    const s = suggestGdtForIntent(intent);
    const text = formatSuggestions(s);
    for (const sug of s) {
      expect(text).toContain(sug.reason);
    }
  });
});

describe('suggest_gdt_for_intent — tool executor wire', () => {
  it('tool returns ok with meta.suggestions array for a valid intent', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_gdt_for_intent')(
      {
        intent: {
          shapeId: 'box',
          params: { width: 50, height: 50, depth: 10 },
          features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
        },
      },
      session,
    ));
    expect(Array.isArray(res.meta?.suggestions)).toBe(true);
    const suggestions = res.meta!.suggestions as Array<{ source: string }>;
    expect(suggestions.length).toBeGreaterThan(0);
    // Pure helper — must NOT mutate session.gdtFrames.
    expect(session.gdtFrames).toHaveLength(0);
  });

  it('tool returns BAD_ARGS on missing intent', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'suggest_gdt_for_intent')({}, session));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool returns BAD_ARGS when intent is null', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'suggest_gdt_for_intent')({ intent: null }, session));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('tool output text mentions each suggestion reason', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_gdt_for_intent')(
      {
        intent: {
          shapeId: 'cylinder',
          params: { diameter: 20, height: 40 },
        },
      },
      session,
    ));
    const suggestions = res.meta!.suggestions as Array<{ reason: string }>;
    for (const sug of suggestions) {
      expect(res.output).toContain(sug.reason);
    }
  });

  it('tool honors processForDfm option (fdm scales hole position)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_gdt_for_intent')(
      {
        intent: {
          shapeId: 'box',
          params: { width: 50, height: 50, depth: 50 },
          features: [{ type: 'hole', params: { x: 0, y: 0, diameter: 5 } }],
        },
        processForDfm: 'fdm',
      },
      session,
    ));
    const suggestions = res.meta!.suggestions as Array<{ source: string; toleranceMm: number }>;
    const hole = suggestions.find(s => s.source === 'hole')!;
    expect(hole.toleranceMm).toBeCloseTo(0.3);
  });
});
