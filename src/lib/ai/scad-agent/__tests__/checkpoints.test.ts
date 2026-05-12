/**
 * B2 — Checkpoint capture + revert tests.
 */

import { describe, it, expect } from 'vitest';
import { runScadAgent } from '../runScadAgent';
import { makeTools } from '../tools';
import type { AgentSession, AiClient, RenderState } from '../types';

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

function mockHost(opts: { renderOk?: boolean } = {}) {
  const ok = opts.renderOk ?? true;
  const r: RenderState = ok
    ? { ok: true, errors: [], stlBytes: 100, triangles: 12 }
    : { ok: false, errors: [{ message: 'fail' }] };
  return {
    render: async () => ({ ...r, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12, manifold: true }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

describe('Checkpoint auto-capture', () => {
  it('a successful render adds a checkpoint', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    session.scadSource = 'cube(10);';
    expect(session.checkpoints.length).toBe(0);

    await tools.render!({}, session);
    expect(session.checkpoints.length).toBe(1);
    expect(session.checkpoints[0].index).toBe(1);
    expect(session.checkpoints[0].scadSource).toBe('cube(10);');
  });

  it('a failed render does NOT add a checkpoint', async () => {
    const tools = makeTools(mockHost({ renderOk: false }));
    const session = blankSession();
    session.scadSource = 'cubex(10);';

    await tools.render!({}, session);
    expect(session.checkpoints.length).toBe(0);
  });

  it('caps at 8 checkpoints with FIFO eviction', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    for (let i = 1; i <= 12; i++) {
      session.scadSource = `cube(${i});`;
      await tools.render!({}, session);
    }
    expect(session.checkpoints.length).toBe(8);
    // Last checkpoint should hold the latest source.
    expect(session.checkpoints[session.checkpoints.length - 1].scadSource).toBe('cube(12);');
    // Indices keep growing across the eviction (so users can refer by index).
    expect(session.checkpoints[session.checkpoints.length - 1].index).toBe(12);
    expect(session.checkpoints[0].index).toBe(5);  // 1..4 evicted
  });

  it('checkpoint label reflects modules vs single-file', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    session.modules.body = 'module body() { cube(10); }';
    session.composition = 'body();';
    await tools.render!({}, session);
    expect(session.checkpoints[0].label).toContain('module:body');
  });
});

describe('list_checkpoints + revert_to_checkpoint', () => {
  it('list_checkpoints reports the roster', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    session.scadSource = 'cube(10);';
    await tools.render!({}, session);
    session.scadSource = 'sphere(5);';
    await tools.render!({}, session);

    const r = await tools.list_checkpoints!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('2 checkpoint(s)');
      expect(r.output).toContain('#1');
      expect(r.output).toContain('#2');
    }
  });

  it('revert_to_checkpoint restores state + invalidates render', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    session.scadSource = 'cube(10);';
    await tools.render!({}, session);  // checkpoint #1

    session.scadSource = 'sphere(5);';
    session.modules.extra = 'module extra() {}';
    await tools.render!({}, session);  // checkpoint #2

    const r = await tools.revert_to_checkpoint!({ index: 1 }, session);
    expect(r.ok).toBe(true);
    expect(session.scadSource).toBe('cube(10);');
    expect(Object.keys(session.modules)).toEqual([]);  // restored to pre-extra state
    expect(session.render.ok).toBeNull();  // invalidated; user must re-render
  });

  it('revert with bad index returns NOT_FOUND', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    session.scadSource = 'cube(10);';
    await tools.render!({}, session);

    const r = await tools.revert_to_checkpoint!({ index: 99 }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('revert with bad args returns BAD_ARGS', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    const r = await tools.revert_to_checkpoint!({}, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ARGS');
  });

  it('list_checkpoints on empty session is ok with friendly message', async () => {
    const tools = makeTools(mockHost());
    const session = blankSession();
    const r = await tools.list_checkpoints!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toMatch(/No checkpoints/i);
  });
});

describe('Agent integration: revert mid-flow', () => {
  it('agent renders v1, builds v2, reverts to v1, renders again', async () => {
    const tc = (id: string, name: string, args: unknown) =>
      '```tool_call\n' + JSON.stringify({ id, name, args }) + '\n```';
    let i = 0;
    const responses = [
      // Turn 1: write v1 + render
      [tc('w1', 'write_scad', { code: 'cube(10);' }), tc('r1', 'render', {})].join('\n'),
      // Turn 2: write v2 + render
      [tc('w2', 'write_scad', { code: 'sphere(5);' }), tc('r2', 'render', {})].join('\n'),
      // Turn 3: revert to v1 + render
      [tc('rv', 'revert_to_checkpoint', { index: 1 }), tc('r3', 'render', {})].join('\n'),
      // Turn 4: done
      'Reverted and re-rendered.',
    ];
    const ai: AiClient = {
      async complete() {
        const text = responses[Math.min(i, responses.length - 1)];
        i++;
        return { text, promptTokens: 50, completionTokens: 30 };
      },
    };

    const { session } = await runScadAgent({
      userPrompt: 'try two designs and pick the cube',
      ai,
      tools: makeTools(mockHost()),
    });
    expect(session.status).toBe('done');
    expect(session.scadSource).toBe('cube(10);');
    // After 3 successful renders we expect 3 checkpoints (or however many
    // the FIFO retains — well under the cap here).
    expect(session.checkpoints.length).toBeGreaterThanOrEqual(2);
  });
});
