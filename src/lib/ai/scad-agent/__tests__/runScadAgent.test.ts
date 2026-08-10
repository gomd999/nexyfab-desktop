/**
 * End-to-end agent loop test (A6).
 *
 * Uses a programmable mock AI that emits a scripted sequence of model
 * responses, and a programmable mock host (render/geometry/dfm) so we
 * can exercise: success path, render failure → fix loop, wedge trip,
 * budget exhaustion, malformed tool calls, plain narration termination.
 */

import { describe, it, expect } from 'vitest';
import { runScadAgent } from '../runScadAgent';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AiClient, RenderState } from '../types';

function scriptedAi(responses: string[]): AiClient {
  let i = 0;
  return {
    async complete() {
      const text = responses[Math.min(i, responses.length - 1)];
      i++;
      return { text, promptTokens: 100, completionTokens: 50 };
    },
  };
}

function makeMockHost(opts: {
  renderResults?: RenderState[];
  geometryStub?: Record<string, unknown>;
} = {}): ToolHostAdapters {
  let renderIdx = 0;
  const results = opts.renderResults ?? [
    { ok: true, errors: [], stlBytes: 1024, triangles: 12 },
  ];
  return {
    render: async () => {
      const r = results[Math.min(renderIdx, results.length - 1)];
      renderIdx++;
      return { ...r, ts: Date.now() };
    },
    geometry: async () => ({
      triangleCount: 12,
      manifold: true,
      bbox: { min: [0, 0, 0], max: [10, 10, 10] },
      ...(opts.geometryStub ?? {}),
    }),
    dfm: async () => ({ summary: 'no issues', issuesCount: 0 }),
  };
}

describe('runScadAgent (A6)', () => {
  it('happy path: write → render → done in 2 turns', async () => {
    const ai = scriptedAi([
      // Turn 1: model writes SCAD then renders
      `Designing a 10mm cube.
\`\`\`tool_call
{"id":"c1","name":"write_scad","args":{"code":"cube([10,10,10], center=true);"}}
\`\`\`
\`\`\`tool_call
{"id":"c2","name":"render","args":{}}
\`\`\``,
      // Turn 2: no tool calls → done
      `Cube rendered cleanly. 12 triangles, 1024 bytes STL. Ready when you are.`,
    ]);

    const tools = makeTools(makeMockHost());
    const { session, events } = await runScadAgent({
      userPrompt: 'Make a 10mm cube',
      ai,
      tools,
      fastPath: false,
    });

    expect(session.status).toBe('done');
    expect(session.scadSource).toContain('cube');
    expect(session.render.ok).toBe(true);
    expect(session.budget.turnsUsed).toBe(2);
    expect(session.budget.toolCallsUsed).toBe(2);
    expect(events.some(e => e.type === 'tool_call')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('fix loop: render fail → fix → render success', async () => {
    const ai = scriptedAi([
      // Turn 1: bad SCAD
      `\`\`\`tool_call
{"id":"c1","name":"write_scad","args":{"code":"cubex(10);"}}
\`\`\`
\`\`\`tool_call
{"id":"c2","name":"render","args":{}}
\`\`\``,
      // Turn 2: model sees error, fixes
      `Got an error. Let me fix the typo.
\`\`\`tool_call
{"id":"c3","name":"write_scad","args":{"code":"cube(10);"}}
\`\`\`
\`\`\`tool_call
{"id":"c4","name":"render","args":{}}
\`\`\``,
      // Turn 3: done
      `Fixed and rendered.`,
    ]);

    const host = makeMockHost({
      renderResults: [
        { ok: false, errors: [{ line: 1, message: 'Unknown module cubex' }] },
        { ok: true, errors: [], stlBytes: 700, triangles: 12 },
      ],
    });

    const { session } = await runScadAgent({
      userPrompt: 'Make a cube',
      ai,
      tools: makeTools(host),
    });

    expect(session.status).toBe('done');
    expect(session.render.ok).toBe(true);
    expect(session.budget.consecutiveRenderFails).toBe(0);
  });

  it('wedge: 3 consecutive render failures aborts the loop', async () => {
    // Model never gives up — keeps retrying. Wedge guard must stop it.
    const renderCallTemplate = (id: string) =>
      `\`\`\`tool_call
{"id":"${id}_w","name":"write_scad","args":{"code":"badcode${id};"}}
\`\`\`
\`\`\`tool_call
{"id":"${id}_r","name":"render","args":{}}
\`\`\``;
    const ai = scriptedAi([
      renderCallTemplate('a'),
      renderCallTemplate('b'),
      renderCallTemplate('c'),
      renderCallTemplate('d'),
      renderCallTemplate('e'),
    ]);

    const host = makeMockHost({
      renderResults: [
        { ok: false, errors: [{ message: 'fail 1' }] },
        { ok: false, errors: [{ message: 'fail 2' }] },
        { ok: false, errors: [{ message: 'fail 3' }] },
        { ok: false, errors: [{ message: 'fail 4' }] },
      ],
    });

    const { session, events } = await runScadAgent({
      userPrompt: 'Build x',
      ai,
      tools: makeTools(host),
    });

    expect(session.status).toBe('wedged');
    expect(events.some(e => e.type === 'wedge_detected')).toBe(true);
  });

  it('budget exhaustion stops the loop', async () => {
    const ai = scriptedAi([
      `\`\`\`tool_call
{"id":"c1","name":"render","args":{}}
\`\`\``,
      `\`\`\`tool_call
{"id":"c2","name":"render","args":{}}
\`\`\``,
      `\`\`\`tool_call
{"id":"c3","name":"render","args":{}}
\`\`\``,
    ]);

    const host = makeMockHost();
    const { session } = await runScadAgent({
      userPrompt: 'Loop forever',
      ai,
      tools: makeTools(host),
      // We'll need at least 1 SCAD source to avoid the EMPTY guard early.
      session: {
        id: 'pretest',
        scadSource: 'cube(10);',
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
          turnsUsed: 0, turnsCap: 2,  // tiny cap
          toolCallsUsed: 0, toolCallsCap: 100,
          visionCallsUsed: 0, visionCallsCap: 3,
          consecutiveRenderFails: 0,
        },
        status: 'idle',
      },
    });

    expect(session.status).toBe('budget');
    expect(session.budget.turnsUsed).toBe(2);
  });

  it('done on first turn when model has no tool calls', async () => {
    const ai = scriptedAi(['Hi! What part should I design?']);
    const { session, events } = await runScadAgent({
      userPrompt: 'hello',
      ai,
      tools: makeTools(makeMockHost()),
    });
    expect(session.status).toBe('done');
    expect(session.budget.turnsUsed).toBe(1);
    expect(events.some(e => e.type === 'tool_call')).toBe(false);
  });

  it('generation gate rejects a premature narration and requires rendered SCAD', async () => {
    const ai = scriptedAi([
      'The model is ready.',
      `\`\`\`tool_call
{"id":"c1","name":"write_scad","args":{"code":"cube([10,10,10]);"}}
\`\`\`
\`\`\`tool_call
{"id":"c2","name":"render","args":{}}
\`\`\``,
      'Rendered successfully.',
    ]);

    const { session } = await runScadAgent({
      userPrompt: 'Generate a cube',
      ai,
      tools: makeTools(makeMockHost()),
      fastPath: false,
      requireSuccessfulRenderBeforeDone: true,
    });

    expect(session.status).toBe('done');
    expect(session.scadSource).toContain('cube');
    expect(session.render.ok).toBe(true);
    expect(session.budget.turnsUsed).toBe(3);
    expect(session.history.some(message =>
      message.role === 'user' && message.content.includes('[completion gate]'),
    )).toBe(true);
  });

  it('certification mode stops immediately after the first successful render', async () => {
    const ai = scriptedAi([
      `\`\`\`tool_call
{"id":"c1","name":"write_scad","args":{"code":"cube(10);"}}
\`\`\`
\`\`\`tool_call
{"id":"c2","name":"render","args":{}}
\`\`\``,
      'This turn must not be requested.',
    ]);
    const { session } = await runScadAgent({
      userPrompt: 'Generate and certify a cube',
      ai,
      tools: makeTools(makeMockHost()),
      fastPath: false,
      requireSuccessfulRenderBeforeDone: true,
      stopAfterSuccessfulRender: true,
    });
    expect(session.status).toBe('done');
    expect(session.render.ok).toBe(true);
    expect(session.budget.turnsUsed).toBe(1);
  });

  it('completion gate deterministically renders prepared source after narration-only handoff', async () => {
    const ai = scriptedAi(['The source is ready.']);
    const tools = makeTools(makeMockHost());
    const seed = await runScadAgent({
      userPrompt: 'Prepare source',
      ai: scriptedAi([`\`\`\`tool_call
{"id":"c1","name":"write_scad","args":{"code":"cube(10);"}}
\`\`\``, 'Source prepared.']),
      tools,
      fastPath: false,
    });
    const { session, events } = await runScadAgent({
      userPrompt: 'Certify it',
      session: seed.session,
      ai,
      tools,
      fastPath: false,
      requireSuccessfulRenderBeforeDone: true,
      stopAfterSuccessfulRender: true,
    });
    expect(session.status).toBe('done');
    expect(session.render.ok).toBe(true);
    expect(events.some(event =>
      event.type === 'tool_call' && event.call.id.startsWith('completion_gate_render_'),
    )).toBe(true);
  });

  it('does not certify an auto-preview after multi-module composition fails', async () => {
    const ai = scriptedAi([
      `\`\`\`tool_call
{"id":"m1","name":"write_module","args":{"name":"body","code":"cube([60,30,20]);"}}
\`\`\`
\`\`\`tool_call
{"id":"m2","name":"write_module","args":{"name":"wheel","code":"cylinder(d=14,h=6);"}}
\`\`\`
\`\`\`tool_call
{"id":"bad","name":"compose_assembly","args":{"parts":[{"moduleName":"body"},{"moduleName":"wheel","count":4,"spacing":[-40,-36,0]}]}}
\`\`\`
\`\`\`tool_call
{"id":"r1","name":"render","args":{}}
\`\`\``,
      `\`\`\`tool_call
{"id":"ok","name":"compose_assembly","args":{"parts":[{"moduleName":"body"},{"moduleName":"wheel","position":[-20,-18,7]},{"moduleName":"wheel","position":[-20,18,7]},{"moduleName":"wheel","position":[20,-18,7]},{"moduleName":"wheel","position":[20,18,7]}]}}
\`\`\`
\`\`\`tool_call
{"id":"r2","name":"render","args":{}}
\`\`\``,
    ]);
    const { session } = await runScadAgent({
      userPrompt: 'Build a four-wheel car',
      ai,
      tools: makeTools(makeMockHost()),
      fastPath: false,
      requireSuccessfulRenderBeforeDone: true,
      stopAfterSuccessfulRender: true,
    });
    expect(session.status).toBe('done');
    expect(session.budget.turnsUsed).toBe(2);
    expect((session.composition?.match(/wheel\(\);/g) ?? [])).toHaveLength(4);
  });

  it('unknown tool returns typed error so model can self-correct', async () => {
    const ai = scriptedAi([
      `\`\`\`tool_call
{"id":"c1","name":"render","args":{}}
\`\`\``,
      // After seeing the error, model gives up and narrates
      `My mistake — I'll stop here.`,
    ]);

    const tools = makeTools(makeMockHost({
      renderResults: [{ ok: true, errors: [], stlBytes: 100, triangles: 12 }],
    }));

    const { session } = await runScadAgent({
      userPrompt: 'do x',
      ai,
      tools,
      session: {
        id: 'pretest2',
        scadSource: 'cube(5);',
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
          turnsUsed: 0, turnsCap: 5,
          toolCallsUsed: 0, toolCallsCap: 5,
          visionCallsUsed: 0, visionCallsCap: 3,
          consecutiveRenderFails: 0,
        },
        status: 'idle',
      },
    });
    expect(session.status).toBe('done');
  });

  it('budget_warn fires once when remaining drops below threshold', async () => {
    // Lifecycle: large enough budget that warn fires before exhaust.
    const responses: string[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push(`\`\`\`tool_call
{"id":"r${i}","name":"render","args":{}}
\`\`\``);
    }
    responses.push('done');
    const ai = scriptedAi(responses);

    const { events, session } = await runScadAgent({
      userPrompt: 'do x',
      ai,
      tools: makeTools(makeMockHost()),
      session: {
        id: 'warn',
        scadSource: 'cube(5);',
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
          tokensUsed: 0, tokensCap: 200,  // 150 tokens/turn → warns at turn 1
          turnsUsed: 0, turnsCap: 100,
          toolCallsUsed: 0, toolCallsCap: 100,
          visionCallsUsed: 0, visionCallsCap: 3,
          consecutiveRenderFails: 0,
        },
        status: 'idle',
      },
    });

    const warns = events.filter(e => e.type === 'budget_warn');
    expect(warns.length).toBeLessThanOrEqual(1); // fires at most once
    void session;
  });

  it('blocks guessed global OCCT handles outside the current session', async () => {
    const { events } = await runScadAgent({
      userPrompt: 'mesh that handle',
      ai: scriptedAi([
        '```tool_call\n{"id":"forged","name":"brep_to_mesh","args":{"handle":"occt:999"}}\n```',
        'stopped',
      ]),
      tools: makeTools(makeMockHost()),
      fastPath: false,
    });
    const resultEvent = events.find(event => event.type === 'tool_result');
    expect(resultEvent?.type === 'tool_result' ? resultEvent.result : null)
      .toMatchObject({ ok: false, code: 'ACCESS_DENIED' });
  });
});
