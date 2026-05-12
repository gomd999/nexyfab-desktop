/**
 * T2 — Scenario coverage tests.
 *
 * Validate that complete user scenarios (template → render → export)
 * still work after the Z + Σ additions. These are NOT browser E2E
 * (no real user interaction); they're agent-loop scenarios with a
 * scripted AI client driving the same tool sequence a model would.
 *
 * Pin which scenarios survive future refactors:
 *   - NEMA17 mount: primitive + boolean + render
 *   - PMI MBD package: GD&T + datum target + surface finish + export
 *   - CFD sim flow: brep + sim_cfd → result has Reynolds/regime
 *   - Feature-tree edit: tree_set_param marks downstream dirty
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runScadAgent } from '../runScadAgent';
import { makeTools, type BrepAdapter } from '../tools';
import {
  bootstrapMockSolvers,
  _resetMockSolversBoot,
} from '../simulationAdapters';
import { _resetSolvers } from '../simulationQueue';
import type { AiClient, ToolCall } from '../types';

beforeEach(() => {
  _resetSolvers();
  _resetMockSolversBoot();
  bootstrapMockSolvers();
  nextHandle = 0;  // reset per-test so handle ids ('mock:1', 'mock:2') stay stable
});

let nextHandle = 0;
const mockBrep = (): BrepAdapter => ({
  async ensureReady() { /* noop */ },
  async primitive(args: { shape: string }) {
    const handle = `mock:${++nextHandle}`;
    return { ok: true, handle, kind: `${args.shape}` };
  },
  async boolean(args: { op: string }) {
    return { ok: true, handle: `mock:${++nextHandle}`, kind: `boolean(${args.op})` };
  },
  async fillet(args: { radius: number }) {
    return { ok: true, handle: `mock:${++nextHandle}`, kind: `fillet(r=${args.radius})` };
  },
  async chamfer(_args: { distance: number }) {
    return { ok: true, handle: `mock:${++nextHandle}`, kind: `chamfer` };
  },
  async shell(args: { thickness: number }) {
    return { ok: true, handle: `mock:${++nextHandle}`, kind: `shell(t=${args.thickness})` };
  },
  async toMesh() {
    return { ok: true, triangleCount: 1000, bbox: { min: [0, 0, 0], max: [60, 60, 8] } };
  },
  async exportStep() {
    return { ok: true, bytes: 4096 };
  },
});

const okHost = () => ({
  render: async () => ({ ok: true as const, errors: [], stlBytes: 100, triangles: 1000, ts: Date.now() }),
  geometry: async () => ({}),
  dfm: async () => ({ summary: 'OK', issuesCount: 0 }),
  brep: mockBrep(),
});

/** Mini scripted AI client that emits a fixed sequence of tool_call blocks
 *  and then a "done" turn (no tool calls). Drives the agent through a
 *  scenario without needing a real model. */
function scriptedAi(turns: Array<{ text: string; toolCalls?: Array<Omit<ToolCall, 'id'> & { id?: string }> }>): AiClient {
  let i = 0;
  return {
    async complete() {
      const turn = turns[Math.min(i, turns.length - 1)];
      const callIdx = i;
      i++;
      const tcText = (turn.toolCalls ?? [])
        .map((tc, idx) => '```tool_call\n' + JSON.stringify({ id: tc.id ?? `c${callIdx}-${idx}`, name: tc.name, args: tc.args }) + '\n```')
        .join('\n');
      const text = `${turn.text}\n${tcText}`;
      return { text, promptTokens: 50, completionTokens: 50 };
    },
  };
}

describe('Scenario: NEMA17 mount (primitive → boolean → render)', () => {
  it('agent loop completes with brep entries + render OK', async () => {
    const ai = scriptedAi([
      {
        text: 'Building the plate.',
        toolCalls: [
          { name: 'brep_primitive', args: { shape: 'cube', params: { width: 60, height: 60, depth: 8 } } },
        ],
      },
      {
        text: 'Adding center hole.',
        toolCalls: [
          { name: 'brep_primitive', args: { shape: 'cylinder', params: { radius: 11, height: 10 } } },
          { name: 'brep_boolean', args: { op: 'subtract', hostHandle: 'mock:1', toolHandle: 'mock:2' } },
        ],
      },
      { text: 'Done.' },
    ]);

    const result = await runScadAgent({
      userPrompt: 'NEMA17 motor mount: 60×60×8 plate, 22mm center bore.',
      ai, tools: makeTools(okHost()),
      tokensCap: 100_000, turnsCap: 10, toolCallsCap: 20,
    });

    expect(result.session.status).toBe('done');
    expect(result.session.brepEntries.length).toBeGreaterThanOrEqual(2);
    expect(result.session.featureTree).toBeDefined();
    expect(Object.keys(result.session.featureTree!.nodes).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Scenario: PMI MBD package', () => {
  it('GD&T + datum target + surface finish + AP242 export all run', async () => {
    // Spread tools across one-per-turn turns so we don't depend on the
    // multi-block parse path. This keeps the contract test focused on
    // "did each tool execute and update session state" rather than on
    // tool_call block batching.
    const ai = scriptedAi([
      { text: 'Plate.', toolCalls: [
        { name: 'brep_primitive', args: { shape: 'cube', params: { width: 60, height: 60, depth: 8 } } },
      ] },
      { text: 'GD&T.', toolCalls: [
        { name: 'add_gdt_frame', args: { featureRef: 'mock:1', symbol: 'position', tolerance: 0.05, diameter: true, modifier: 'M', datums: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }] } },
      ] },
      { text: 'Datum target.', toolCalls: [
        { name: 'add_datum_target', args: { letter: 'A', index: 1, type: 'point', location: [0, 0, 8] } },
      ] },
      { text: 'Surface finish.', toolCalls: [
        { name: 'add_surface_finish', args: { featureRef: 'mock:1', roughnessRaUm: { upper: 1.6 } } },
      ] },
      { text: 'Dim.', toolCalls: [
        { name: 'add_annotated_dimension', args: { featureRef: 'mock:1', kind: 'basic', valueMm: 60 } },
      ] },
      { text: 'Export.', toolCalls: [
        { name: 'export_pmi_step_ap242', args: { partName: 'mount', brepHandle: 'mock:1' } },
      ] },
      { text: 'PMI exported.' },
    ]);

    const result = await runScadAgent({
      userPrompt: 'PMI MBD package for the mount.',
      ai, tools: makeTools(okHost()),
      tokensCap: 100_000, turnsCap: 10, toolCallsCap: 20,
    });

    expect(result.session.status).toBe('done');
    expect(result.session.gdtFrames.length).toBe(1);
    expect(result.session.datumTargets?.length).toBe(1);
    expect(result.session.surfaceFinishes?.length).toBe(1);
    expect(result.session.annotatedDimensions?.length).toBe(1);
    // The export tool's result should be in history.
    const exportResult = result.session.history.find(
      m => m.role === 'tool_result' && m.result.ok && (m.result.meta as Record<string, unknown> | undefined)?.companionJson,
    );
    expect(exportResult).toBeTruthy();
  });
});

describe('Scenario: Σ CFD simulation', () => {
  it('agent calls sim_cfd and gets a result with Reynolds + regime', async () => {
    const ai = scriptedAi([
      {
        text: 'Running CFD on the part.',
        toolCalls: [
          { name: 'sim_cfd', args: { brepHandle: 'mock:1', velocityMs: 10, fluid: 'air', referenceLengthMm: 50 } },
        ],
      },
      { text: 'Done.' },
    ]);

    const result = await runScadAgent({
      userPrompt: 'Run CFD for 10 m/s air over the part.',
      ai, tools: makeTools(okHost()),
      tokensCap: 100_000, turnsCap: 10, toolCallsCap: 20,
    });

    expect(result.session.status).toBe('done');
    const simResult = result.session.history.find(
      m => m.role === 'tool_result' && m.result.ok && (m.result.meta as Record<string, unknown> | undefined)?.result,
    );
    expect(simResult).toBeTruthy();
    if (simResult && simResult.role === 'tool_result' && simResult.result.ok) {
      const meta = simResult.result.meta as { result: { reynolds: number; regime: string } };
      expect(meta.result.reynolds).toBeGreaterThan(0);
      expect(['laminar', 'transitional', 'turbulent']).toContain(meta.result.regime);
    }
  });
});

describe('Scenario: Feature-tree edit propagation', () => {
  it('tree_set_param marks downstream nodes dirty', async () => {
    const ai = scriptedAi([
      {
        text: 'Building tree: primitive → fillet.',
        toolCalls: [
          { name: 'brep_primitive', args: { shape: 'cube', params: { width: 30, height: 30, depth: 30 } } },
          { name: 'brep_fillet', args: { hostHandle: 'mock:1', radius: 2 } },
        ],
      },
      {
        text: 'Now changing the cube width.',
        toolCalls: [
          { name: 'tree_set_param', args: { nodeId: 'mock:1', key: 'width', value: 50 } },
        ],
      },
      { text: 'Done.' },
    ]);

    const result = await runScadAgent({
      userPrompt: 'Make a cube with fillet, then change the cube width.',
      ai, tools: makeTools(okHost()),
      tokensCap: 100_000, turnsCap: 10, toolCallsCap: 20,
    });

    expect(result.session.status).toBe('done');
    expect(result.session.featureTree).toBeDefined();
    // The fillet (mock:2) should now be dirty because mock:1 changed.
    expect(result.session.featureTree!.nodes['mock:1'].dirty).toBe(true);
    expect(result.session.featureTree!.nodes['mock:2'].dirty).toBe(true);
  });
});

describe('Scenario: catalog query before design', () => {
  it('agent queries catalog then proceeds with informed choice', async () => {
    const ai = scriptedAi([
      {
        text: 'Looking up materials.',
        toolCalls: [
          { name: 'query_engineering_catalog', args: { topic: 'materials', query: 'aluminum frame', k: 1 } },
        ],
      },
      {
        text: 'Building based on catalog answer.',
        toolCalls: [
          { name: 'brep_primitive', args: { shape: 'cube', params: { width: 100, height: 50, depth: 5 } } },
        ],
      },
      { text: 'Done.' },
    ]);

    const result = await runScadAgent({
      userPrompt: 'Pick a material for an outdoor frame, then build a 100×50×5 plate.',
      ai, tools: makeTools(okHost()),
      tokensCap: 100_000, turnsCap: 10, toolCallsCap: 20,
    });

    expect(result.session.status).toBe('done');
    expect(result.session.brepEntries.length).toBe(1);
    const catalogResult = result.session.history.find(
      m => m.role === 'tool_result' && m.result.ok && /aluminum/i.test(m.result.output),
    );
    expect(catalogResult).toBeTruthy();
  });
});
