/**
 * Stage 2 — view_render tool + vision adapter tests.
 *
 * No real LLM is called: a mock VisionAdapter returns scripted analysis.
 * Verifies:
 *   - view_render fails cleanly when vision is unconfigured (NO_VISION)
 *   - view_render fails cleanly when render hasn't been done (NO_RENDER)
 *   - view_render passes the SCAD source + prompt + view picks to adapter
 *   - End-to-end: agent renders, calls view_render, reads critique,
 *     fixes the SCAD, renders again, declares done
 */

import { describe, it, expect, vi } from 'vitest';
import { makeTools, type VisionAdapter } from '../tools';
import { runScadAgent } from '../runScadAgent';
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

function mockHost(opts: { vision?: VisionAdapter; renderOk?: boolean } = {}) {
  const ok = opts.renderOk ?? true;
  const r: RenderState = ok
    ? { ok: true, errors: [], stlBytes: 1024, triangles: 12 }
    : { ok: false, errors: [{ message: 'fail' }] };
  return {
    render: async () => ({ ...r, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12, manifold: true }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
    vision: opts.vision,
  };
}

function scriptedAi(responses: string[]): AiClient {
  let i = 0;
  return {
    async complete() {
      const text = responses[Math.min(i, responses.length - 1)];
      i++;
      return { text, promptTokens: 100, completionTokens: 80 };
    },
  };
}

describe('view_render tool', () => {
  it('returns NO_VISION when adapter is missing', async () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    s.render = { ok: true, errors: [] };
    const tools = makeTools(mockHost());  // no vision
    const r = await tools.view_render!({}, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_VISION');
  });

  it('returns NO_RENDER when nothing has been rendered yet', async () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    const visionStub: VisionAdapter = vi.fn(async () => ({ ok: false as const, reason: 'should not be called' }));
    const tools = makeTools(mockHost({ vision: visionStub }));
    const r = await tools.view_render!({}, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_RENDER');
    expect(visionStub).not.toHaveBeenCalled();
  });

  it('calls vision adapter with the effective SCAD source', async () => {
    const s = blankSession();
    s.modules.body = 'module body() { cube([10,10,10]); }';
    s.composition = 'body();';
    s.render = { ok: true, errors: [], stlBytes: 100, triangles: 12 };

    const visionStub: VisionAdapter = vi.fn(async () => ({
      ok: true as const,
      analysis: 'Looks correct.',
      provider: 'mock',
      model: 'mock-vision',
      tokens: 200,
      pngBytes: 65536,
      viewCount: 3,
    }));

    const tools = makeTools(mockHost({ vision: visionStub }));
    const r = await tools.view_render!({ prompt: 'Are wheels symmetric?' }, s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('Looks correct');
      expect(r.output).toContain('vision: mock');
    }
    expect(visionStub).toHaveBeenCalledTimes(1);
    const [scadArg, promptArg] = (visionStub as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(scadArg as string).toContain('module body()');
    expect(scadArg as string).toContain('body();');  // composition
    expect(promptArg as string).toBe('Are wheels symmetric?');
  });

  it('caps view selection at 4 and dedupes labels', async () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    s.render = { ok: true, errors: [] };
    let receivedViews: { label: string }[] | undefined;
    const visionStub: VisionAdapter = async (_scad, _prompt, opts) => {
      receivedViews = opts?.views;
      return { ok: true, analysis: 'ok', provider: 'm', model: 'm', tokens: 1, pngBytes: 1, viewCount: opts?.views?.length ?? 0 };
    };
    const tools = makeTools(mockHost({ vision: visionStub }));
    await tools.view_render!({
      views: ['iso', 'front', 'right', 'left', 'top', 'back', 'iso', 'front'],
    }, s);
    expect(receivedViews).toBeDefined();
    expect(receivedViews!.length).toBe(4);
    // Dedup preserved order.
    expect(receivedViews!.map(v => v.label)).toEqual(['Isometric', 'Front', 'Right side', 'Left side']);
  });

  it('blocks call once visionCallsCap is reached', async () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    s.render = { ok: true, errors: [] };
    s.budget.visionCallsUsed = 3;  // already at cap
    s.budget.visionCallsCap = 3;
    let stubFired = false;
    const visionStub: VisionAdapter = async () => {
      stubFired = true;
      return { ok: true as const, analysis: 'ok', provider: 'm', model: 'm', tokens: 1, pngBytes: 1, viewCount: 1 };
    };
    const tools = makeTools(mockHost({ vision: visionStub }));
    const r = await tools.view_render!({}, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BUDGET_VISION');
    expect(stubFired).toBe(false);
  });

  it('charges vision budget on success only (not on failure)', async () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    s.render = { ok: true, errors: [] };
    const failStub: VisionAdapter = async () => ({ ok: false as const, reason: 'API down' });
    let tools = makeTools(mockHost({ vision: failStub }));
    await tools.view_render!({}, s);
    expect(s.budget.visionCallsUsed).toBe(0);  // failed call doesn't charge

    const okStub: VisionAdapter = async () => ({
      ok: true as const, analysis: 'ok', provider: 'm', model: 'm', tokens: 1, pngBytes: 1, viewCount: 1,
    });
    tools = makeTools(mockHost({ vision: okStub }));
    await tools.view_render!({}, s);
    expect(s.budget.visionCallsUsed).toBe(1);  // success charges
  });

  it('passes through vision adapter failure as VISION_FAILED', async () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    s.render = { ok: true, errors: [] };
    const visionStub: VisionAdapter = async () => ({ ok: false, reason: 'rate limited' });
    const tools = makeTools(mockHost({ vision: visionStub }));
    const r = await tools.view_render!({}, s);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VISION_FAILED');
      expect(r.error).toContain('rate limited');
    }
  });
});

describe('Vision-feedback loop end-to-end', () => {
  it('agent renders → view_render → fixes per critique → renders → done', async () => {
    const tc = (id: string, name: string, args: unknown) =>
      '```tool_call\n' + JSON.stringify({ id, name, args }) + '\n```';

    const ai = scriptedAi([
      // Turn 1 — write + render
      [
        'Drafting a toy car.',
        tc('w1', 'write_scad', { code: 'cube([100,50,25]);' }),
        tc('r1', 'render', {}),
      ].join('\n'),
      // Turn 2 — visual check
      [
        'Let me verify proportions.',
        tc('v1', 'view_render', { prompt: 'Does this look like a toy car?' }),
      ].join('\n'),
      // Turn 3 — saw the critique, applies fix + renders
      [
        'The vision feedback noted no wheels. Adding 4 wheel cylinders.',
        tc('w2', 'write_scad', { code: 'difference() { cube([100,50,25]); /* wheels stub */ } translate([20,-10,0]) cylinder(h=8, r=10); translate([80,-10,0]) cylinder(h=8, r=10);' }),
        tc('r2', 'render', {}),
      ].join('\n'),
      // Turn 4 — narrate done
      'Done. Stylized toy car with body + 2 wheels.',
    ]);

    let visionCalls = 0;
    const visionStub: VisionAdapter = async () => {
      visionCalls++;
      return {
        ok: true,
        analysis: 'The body proportions look reasonable but the model lacks wheels — add four cylinder wheels at the corners.',
        provider: 'mock', model: 'mock-vision',
        tokens: 250, pngBytes: 100_000, viewCount: 3,
      };
    };

    const { session } = await runScadAgent({
      userPrompt: '간단한 토이카 만들어줘',
      ai,
      tools: makeTools(mockHost({ vision: visionStub })),
    });

    expect(session.status).toBe('done');
    expect(visionCalls).toBe(1);
    // Final SCAD source includes the wheels added after the vision feedback.
    expect(session.scadSource).toContain('cylinder');
  });
});
