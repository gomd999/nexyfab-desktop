/**
 * Phase X #5 — Metric ISO fastener lookup tool.
 *
 * The data layer (`isoFasteners.ts`) was already covered; this suite
 * locks down the tool wire-up + output formatting that the agent reads.
 * Citation of the ISO standard reference must always appear so the
 * agent (and the user reading the summary) has an unambiguous source.
 */
import { describe, it, expect } from 'vitest';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';

function blankSession(): AgentSession {
  return {
    id: 's',
    scadSource: '',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history: [],
    render: { ok: null, errors: [] },
    geometry: {},
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

function tool(tools: ReturnType<typeof makeTools>, name: 'lookup_metric_fastener'): ToolExecutor {
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

describe('lookup_metric_fastener tool', () => {
  it('rejects missing size argument', async () => {
    const tools = makeTools(noopHost());
    const out = asErr(await tool(tools, 'lookup_metric_fastener')({}, blankSession()));
    expect(out.code).toBe('BAD_ARGS');
  });

  it('reports NOT_FOUND for sizes outside the M3-M16 catalog', async () => {
    const tools = makeTools(noopHost());
    const out = asErr(await tool(tools, 'lookup_metric_fastener')({ size: 'M99' }, blankSession()));
    expect(out.code).toBe('NOT_FOUND');
    expect(out.error).toMatch(/M3.*M16/);
  });

  it('returns ISO 261 dimensions for M8 + cites the standard', async () => {
    const tools = makeTools(noopHost());
    const out = asOk(await tool(tools, 'lookup_metric_fastener')({ size: 'M8' }, blankSession()));
    expect(out.output).toMatch(/M8.*ISO 261/);
    expect(out.output).toMatch(/pitch 1\.25 mm/);
    expect(out.output).toMatch(/Clearance hole.*Ø9 mm/);
    expect(out.output).toMatch(/Tap drill.*Ø6\.8 mm/);
    expect(out.output).toMatch(/Hex across-flats.*13 mm/);
    expect(out.output).toMatch(/Source:.*ISO 261/);
    expect(out.meta?.standard).toBe('ISO 261');
  });

  it('lowercase input still resolves (case-insensitive)', async () => {
    const tools = makeTools(noopHost());
    const out = asOk(await tool(tools, 'lookup_metric_fastener')({ size: 'm5' }, blankSession()));
    expect(out.output).toMatch(/M5.*pitch 0\.8/);
  });

  it('every supported size returns a complete record', async () => {
    const tools = makeTools(noopHost());
    const supported = ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M14', 'M16'];
    for (const size of supported) {
      const out = asOk(await tool(tools, 'lookup_metric_fastener')({ size }, blankSession()));
      expect(out.output).toMatch(/Clearance hole/);
      expect(out.output).toMatch(/Tap drill/);
      expect(out.output).toMatch(/Source:.*ISO 261/);
    }
  });
});
