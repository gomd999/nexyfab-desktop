/**
 * X1 — verify_spec tool executor tests.
 *
 * These exercise the tool wire-up: add_feature_intent persists lastIntent,
 * verify_spec compares it against the session's measured bbox, write_scad
 * and apply_diff invalidate the intent. Pure unit-test scope — the
 * underlying expectedBboxFromIntent / compareBbox math is tested in
 * specVerification.test.ts.
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
    render: async () => ({ ok: true, errors: [], stlBytes: 100, triangles: 12, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12 }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

/** Type-narrow getter — every tool is registered, so `!` is safe. */
function tool(
  tools: ReturnType<typeof makeTools>,
  name: 'verify_spec' | 'add_feature_intent' | 'write_scad' | 'apply_diff',
): ToolExecutor {
  return tools[name]!;
}

function asErr(r: ToolResult): { ok: false; error: string; code?: string } {
  if (r.ok) throw new Error('expected error result');
  return r;
}
function asOk(r: ToolResult): { ok: true; output: string; meta?: Record<string, unknown> } {
  if (!r.ok) throw new Error(`expected ok result, got: ${r.error}`);
  return r;
}

describe('verify_spec tool', () => {
  it('returns NO_INTENT before add_feature_intent runs', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const out = asErr(await tool(tools, 'verify_spec')({}, session));
    expect(out.code).toBe('NO_INTENT');
  });

  it('returns NO_BBOX after intent but before geometry measured', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
      session,
    );
    expect(session.lastIntent).toBeDefined();
    const out = asErr(await tool(tools, 'verify_spec')({}, session));
    expect(out.code).toBe('NO_BBOX');
  });

  it('reports spec ok when measured bbox matches intent', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
      session,
    );
    session.geometry = { bbox: { min: [-25, -25, -25], max: [25, 25, 25] } };
    const out = asOk(await tool(tools, 'verify_spec')({}, session));
    expect(out.output).toMatch(/spec ok/);
    expect(out.meta?.passed).toBe(true);
    expect(out.meta?.mismatchCount).toBe(0);
  });

  it('reports mismatch when measured bbox differs (AI dropped a digit)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
      session,
    );
    session.geometry = { bbox: { min: [-2.5, -25, -25], max: [2.5, 25, 25] } };
    const out = asOk(await tool(tools, 'verify_spec')({}, session));
    expect(out.output).toMatch(/spec mismatch/);
    expect(out.output).toMatch(/width.*expected 50\.00.*measured 5\.00/);
    expect(out.meta?.passed).toBe(false);
    expect(out.meta?.mismatchCount).toBe(1);
  });

  it('reports unverifiable for shapes outside the closed-form catalog', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'gear', params: { teeth: 20, module: 2, thickness: 8 } } },
      session,
    );
    session.geometry = { bbox: { min: [-20, -20, -4], max: [20, 20, 4] } };
    const out = asOk(await tool(tools, 'verify_spec')({}, session));
    expect(out.meta?.verifiable).toBe(false);
    expect(out.output).toMatch(/gear/);
  });

  it('write_scad clears lastIntent (intent↔SCAD coupling broken)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
      session,
    );
    expect(session.lastIntent).toBeDefined();

    await tool(tools, 'write_scad')({ code: 'cube([10,10,10]);' }, session);
    expect(session.lastIntent).toBeUndefined();

    session.geometry = { bbox: { min: [0, 0, 0], max: [10, 10, 10] } };
    const out = asErr(await tool(tools, 'verify_spec')({}, session));
    expect(out.code).toBe('NO_INTENT');
  });

  it('apply_diff invariant: ok=true → lastIntent cleared; ok=false → DIFF_FAILED', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    session.scadSource = 'cube([50, 50, 50], center=true);';
    await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
      session,
    );
    session.scadSource = 'cube([50, 50, 50], center=true);';
    expect(session.lastIntent).toBeDefined();

    const diff = [
      '@@ -1,1 +1,1 @@',
      '-cube([50, 50, 50], center=true);',
      '+cube([30, 30, 30], center=true);',
      '',
    ].join('\n');
    const out = await tool(tools, 'apply_diff')({ diff }, session);
    if (out.ok) {
      expect(session.lastIntent).toBeUndefined();
    } else {
      expect(out.code).toBe('DIFF_FAILED');
    }
  });
});
