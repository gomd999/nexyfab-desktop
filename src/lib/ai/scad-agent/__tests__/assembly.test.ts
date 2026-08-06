/**
 * Stage 1 — multi-module assembly path tests.
 *
 * Covers:
 *   - effectiveScadSource composition (modules + composition order)
 *   - write_module / list_modules / compose_assembly tool semantics
 *   - emitPlacement (translate, rotate, count+spacing)
 *   - end-to-end agent run that builds a 4-wheel "toy car" via plan_design
 *     → write_module × 2 → compose_assembly with array → render
 */

import { describe, it, expect } from 'vitest';
import { effectiveScadSource } from '../composeSource';
import { makeTools } from '../tools';
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

function mockHost() {
  const r: RenderState = { ok: true, errors: [], stlBytes: 1024, triangles: 12 };
  return {
    render: async () => ({ ...r, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12, manifold: true }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
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

describe('effectiveScadSource', () => {
  it('falls back to scadSource when no modules / composition', () => {
    const s = blankSession();
    s.scadSource = 'cube(10);';
    expect(effectiveScadSource(s)).toBe('cube(10);');
  });

  it('emits modules + auto preview when composition is null', () => {
    const s = blankSession();
    s.modules.wheel = 'module wheel() { cylinder(h=5, r=10); }';
    s.modules.body = 'module body() { cube([60,30,15]); }';
    const out = effectiveScadSource(s);
    expect(out).toContain('module wheel()');
    expect(out).toContain('module body()');
    expect(out).toContain('// ── auto preview');
    expect(out).toContain('wheel();');
    expect(out).toContain('body();');
  });

  it('uses composition when set', () => {
    const s = blankSession();
    s.modules.wheel = 'module wheel() { cylinder(h=5, r=10); }';
    s.composition = 'translate([10, 0, 0]) wheel();';
    const out = effectiveScadSource(s);
    expect(out).toContain('module wheel()');
    expect(out).toContain('// ── composition ──');
    expect(out).toContain('translate([10, 0, 0]) wheel()');
    expect(out).not.toContain('// ── auto preview');
  });
});

describe('Stage 1 tools', () => {
  const tools = makeTools(mockHost());

  it('write_module rejects bad name', async () => {
    const s = blankSession();
    const r = await tools.write_module!({ name: '123badname', code: 'cube(1);' }, s);
    expect(r.ok).toBe(false);
  });

  it('write_module wraps body when no module declaration', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'wheel', code: 'cylinder(h=5, r=10);' }, s);
    expect(s.modules.wheel).toMatch(/^module wheel\(\) \{/);
    expect(s.modules.wheel).toContain('cylinder(h=5, r=10);');
  });

  it('write_module preserves explicit module declaration', async () => {
    const s = blankSession();
    const explicit = 'module wheel(r=10) { cylinder(h=5, r=r); }';
    await tools.write_module!({ name: 'wheel', code: explicit }, s);
    expect(s.modules.wheel).toBe(explicit);
  });

  it('list_modules reports roster + composition status', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'a', code: 'cube(1);' }, s);
    await tools.write_module!({ name: 'b', code: 'sphere(1);' }, s);
    const r = await tools.list_modules!({}, s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('2 module(s)');
      expect(r.output).toContain('NOT SET');
    }
  });

  it('compose_assembly rejects unknown module', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'wheel', code: 'cylinder(h=5, r=10);' }, s);
    const r = await tools.compose_assembly!({
      parts: [{ moduleName: 'doesnotexist' }],
    }, s);
    expect(r.ok).toBe(false);
  });

  it('compose_assembly emits translate + rotate + array', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'wheel', code: 'cylinder(h=5, r=10);' }, s);
    const r = await tools.compose_assembly!({
      includes: ['BOSL2/std.scad'],
      parts: [
        { moduleName: 'wheel', position: [-30, -20, 0], count: 4, spacing: [60, 0, 0] },
      ],
    }, s);
    expect(r.ok).toBe(true);
    expect(s.composition).toContain('include <BOSL2/std.scad>');
    // count=4 with spacing 60 → expect 4 placements at -30, 30, 90, 150 along X.
    expect(s.composition).toContain('translate([-30, -20, 0]) wheel();');
    expect(s.composition).toContain('translate([30, -20, 0]) wheel();');
    expect(s.composition).toContain('translate([90, -20, 0]) wheel();');
    expect(s.composition).toContain('translate([150, -20, 0]) wheel();');
  });

  it('compose_assembly: rotation only', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'arm', code: 'cube([20, 5, 5]);' }, s);
    const r = await tools.compose_assembly!({
      parts: [{ moduleName: 'arm', rotation: [0, 0, 90] }],
    }, s);
    expect(r.ok).toBe(true);
    expect(s.composition).toContain('rotate([0, 0, 90]) arm();');
    expect(s.composition).not.toContain('translate');
  });

  it('compose_assembly normalizes include wrappers and emits a 4x4 grid', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'bracket', code: 'cube([20,20,3]);' }, s);
    const r = await tools.compose_assembly!({
      includes: ['include <BOSL2/std.scad>', '<BOSL2/shapes3d.scad>'],
      parts: [{
        moduleName: 'bracket',
        gridCount: [4, 4, 1],
        gridSpacing: [50, 50, 0],
      }],
    }, s);
    expect(r.ok).toBe(true);
    expect(s.composition).toContain('include <BOSL2/std.scad>');
    expect(s.composition).not.toContain('include <include');
    expect((s.composition?.match(/bracket\(\);/g) ?? [])).toHaveLength(16);
    expect(s.composition).toContain('translate([150, 150, 0]) bracket();');
  });

  it('compose_assembly rejects ambiguous diagonal linear arrays', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'wheel', code: 'cylinder(d=14,h=6);' }, s);
    const r = await tools.compose_assembly!({
      parts: [{ moduleName: 'wheel', count: 4, position: [20, 18, 7], spacing: [-40, -36, 0] }],
    }, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/diagonal array/i);
  });

  it('compose_assembly adds the BOSL2 std prerequisite for gears', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'gear', code: 'spur_gear(teeth=20, mod=2, thickness=8);' }, s);
    const r = await tools.compose_assembly!({
      includes: ['BOSL2/gears.scad'],
      parts: [{ moduleName: 'gear' }],
    }, s);
    expect(r.ok).toBe(true);
    expect(s.composition).toContain('include <BOSL2/std.scad>\ninclude <BOSL2/gears.scad>');
  });

  it('plan_design records the plan on session', async () => {
    const s = blankSession();
    const r = await tools.plan_design!({ goal: 'Build motor mount + 4 screws' }, s);
    expect(r.ok).toBe(true);
    expect(s.designPlan).toBe('Build motor mount + 4 screws');
  });

  it('render uses effectiveScadSource (multi-module)', async () => {
    const s = blankSession();
    await tools.write_module!({ name: 'wheel', code: 'cylinder(h=5, r=10);' }, s);
    await tools.compose_assembly!({ parts: [{ moduleName: 'wheel' }] }, s);
    const r = await tools.render!({}, s);
    expect(r.ok).toBe(true);
  });
});

describe('End-to-end: 4-wheel toy car', () => {
  it('agent emits plan → 2 modules → compose 5-part assembly → render OK', async () => {
    // Build the tool-call text safely with JSON.stringify so embedded
    // brackets / quotes don't corrupt the wire format.
    const tc = (id: string, name: string, args: unknown) =>
      '```tool_call\n' + JSON.stringify({ id, name, args }) + '\n```';

    const ai = scriptedAi([
      // Turn 1: plan + write 2 modules
      [
        'Building a stylized toy car (body + 4 wheels).',
        tc('p1', 'plan_design', { goal: 'Body cuboid + 4 wheel cylinders' }),
        tc('m1', 'write_module', { name: 'body', code: 'cube([100, 50, 25], center=true);' }),
        tc('m2', 'write_module', { name: 'wheel', code: 'rotate([90,0,0]) cylinder(h=8, r=10, center=true);' }),
      ].join('\n'),
      // Turn 2: compose + render
      [
        tc('c1', 'compose_assembly', {
          parts: [
            { moduleName: 'body' },
            { moduleName: 'wheel', position: [-30, -25, -10], count: 2, spacing: [60, 0, 0] },
            { moduleName: 'wheel', position: [-30, 25, -10], count: 2, spacing: [60, 0, 0] },
          ],
        }),
        tc('r1', 'render', {}),
      ].join('\n'),
      // Turn 3: done
      'Toy car composed and rendered. 5-piece assembly.',
    ]);

    const { session } = await runScadAgent({
      userPrompt: '간단한 토이카 만들어줘',
      ai,
      tools: makeTools(mockHost()),
    });

    expect(session.status).toBe('done');
    expect(session.designPlan).toContain('Body');
    expect(Object.keys(session.modules).sort()).toEqual(['body', 'wheel']);
    expect(session.composition).toContain('body();');
    expect(session.composition).toContain('wheel();');
    // 4 wheels: 2 placements × count 2 = 4 instances
    const wheelOccurrences = (session.composition ?? '').match(/wheel\(\);/g) ?? [];
    expect(wheelOccurrences.length).toBe(4);
    expect(session.render.ok).toBe(true);
  });
});
