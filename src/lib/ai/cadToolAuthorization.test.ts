import { describe, expect, it, vi } from 'vitest';
import { createCadToolCallAuthorizer, selectionFromCadToolCall } from './cadToolAuthorization';
import { makeTools, type ToolHostAdapters } from './scad-agent/tools';
import type { AgentSession } from './scad-agent/types';
import { runScadAgent } from './scad-agent/runScadAgent';

function host(overrides: Partial<ToolHostAdapters> = {}): ToolHostAdapters {
  return {
    render: vi.fn(),
    geometry: vi.fn(),
    dfm: vi.fn(),
    ...overrides,
  } as ToolHostAdapters;
}

const session = {} as AgentSession;

describe('CAD tool-call authorization', () => {
  it('leaves non-capability utility tools to their own schema guards', () => {
    const adapters = host();
    const authorize = createCadToolCallAuthorizer({ hostAdapters: adapters, tools: makeTools(adapters), mode: 'new-design' });
    expect(authorize({ id: '1', name: 'write_scad', args: { code: 'cube(1);' } }, session)).toBeNull();
  });

  it('blocks the server DFM stub from being treated as verified DFM', () => {
    const adapters = host();
    const authorize = createCadToolCallAuthorizer({
      hostAdapters: adapters,
      tools: makeTools(adapters),
      mode: 'new-design',
      mockAdapters: ['dfm'],
    });
    expect(authorize({ id: '1', name: 'read_dfm', args: {} }, session)).toMatchObject({
      ok: false,
      code: 'CAD_CAPABILITY_MOCK_ONLY',
    });
  });

  it('blocks FEA when no production solver adapter is connected', () => {
    const adapters = host();
    const authorize = createCadToolCallAuthorizer({ hostAdapters: adapters, tools: makeTools(adapters), mode: 'new-design' });
    expect(authorize({ id: '1', name: 'fea_setup', args: { hostHandle: 'occt:1' } }, session)).toMatchObject({
      ok: false,
      code: 'CAD_CAPABILITY_BLOCKED',
    });
  });

  it('allows an available B-rep primitive and derives selection evidence', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({ hostAdapters: adapters, tools: makeTools(adapters), mode: 'new-design' });
    expect(authorize({ id: '1', name: 'brep_primitive', args: { kind: 'box' } }, session)).toBeNull();
    expect(selectionFromCadToolCall({ id: '2', name: 'brep_fillet', args: { hostHandle: 'occt:1', edges: 'all' } })).toMatchObject({
      bodyIds: ['occt:1'],
      edgeIds: ['all'],
    });
  });

  it('requires a declared mutation scope for precision modifications', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({ hostAdapters: adapters, tools: makeTools(adapters), mode: 'scoped-modification' });
    expect(authorize({ id: '1', name: 'brep_fillet', args: { hostHandle: 'occt:1', edges: 'all' } }, session)).toMatchObject({
      ok: false,
      code: 'CAD_TARGET_OWNERSHIP_REQUIRED',
    });
  });

  it('does not let a scoped repair create an unrelated primitive', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({
      hostAdapters: adapters,
      tools: makeTools(adapters),
      mode: 'scoped-modification',
      scope: { partIds: ['arm'] },
    });
    expect(authorize({ id: '1', name: 'brep_primitive', args: { kind: 'box' } }, session)).toMatchObject({
      ok: false,
      code: 'CAD_ACTION_NOT_ALLOWED',
    });
  });

  it('prevents a blocked executor from running inside the model tool loop', async () => {
    const dfm = vi.fn().mockResolvedValue({ summary: 'false pass', issuesCount: 0 });
    const adapters = host({ dfm });
    const tools = makeTools(adapters);
    const authorizeToolCall = createCadToolCallAuthorizer({
      hostAdapters: adapters,
      tools,
      mode: 'new-design',
      mockAdapters: ['dfm'],
    });
    let turn = 0;
    const result = await runScadAgent({
      userPrompt: 'Check DFM',
      fastPath: false,
      tools,
      authorizeToolCall,
      ai: {
        async complete() {
          turn += 1;
          return { text: turn === 1
            ? '```tool_call\n{"id":"dfm-1","name":"read_dfm","args":{}}\n```'
            : 'DFM is unavailable; no verified pass is claimed.' };
        },
      },
    });
    expect(dfm).not.toHaveBeenCalled();
    expect(result.events.find(event => event.type === 'tool_result')).toMatchObject({
      result: { ok: false, code: 'CAD_CAPABILITY_MOCK_ONLY' },
    });
  });

  it('lets real server screening run but preserves its non-release result', async () => {
    const dfm = vi.fn().mockResolvedValue({
      summary: 'Screening only; not manufacturing release evidence.',
      issuesCount: 1,
      meta: { screeningAvailable: true, releaseEvidence: false },
    });
    const adapters = host({
      render: vi.fn().mockResolvedValue({ ok: true, errors: [], triangles: 12, stlBytes: 684 }),
      dfm,
    });
    const tools = makeTools(adapters);
    const authorizeToolCall = createCadToolCallAuthorizer({ hostAdapters: adapters, tools, mode: 'new-design' });
    let turn = 0;
    const result = await runScadAgent({
      userPrompt: 'Create and screen a cube',
      fastPath: false,
      tools,
      authorizeToolCall,
      ai: {
        async complete() {
          turn += 1;
          if (turn === 1) return { text: [
            '```tool_call', '{"id":"write-1","name":"write_scad","args":{"code":"cube(10);"}}', '```',
            '```tool_call', '{"id":"render-1","name":"render","args":{}}', '```',
          ].join('\n') };
          if (turn === 2) return { text: '```tool_call\n{"id":"dfm-1","name":"read_dfm","args":{"processes":["fdm"]}}\n```' };
          return { text: 'The screening found an issue; no manufacturing release pass is claimed.' };
        },
      },
    });
    expect(dfm).toHaveBeenCalledTimes(1);
    expect(result.events.filter(event => event.type === 'tool_result').at(-1)).toMatchObject({
      result: { ok: false, code: 'DFM_SCREENING_ONLY' },
    });
  });

  const ownership = {
    schema: 'nexyfab.cad-session-ownership.v1' as const,
    partIds: ['arm', 'housing'],
    brepHandles: { 'occt:arm': 'arm', 'occt:housing': 'housing' },
    edgeIds: { 'edge:arm:1': 'arm', 'edge:housing:1': 'housing' },
  };

  it('fails closed when a governed handle has no server-bound ownership', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({
      hostAdapters: adapters, tools: makeTools(adapters), mode: 'scoped-modification', scope: { partIds: ['arm'] },
    });
    const unowned = { brepEntries: [{ handle: 'occt:arm', kind: 'box', ts: Date.now() }] } as AgentSession;
    expect(authorize({ id: 'owned-unknown', name: 'brep_fillet', args: { hostHandle: 'occt:arm', edges: 'edge:arm:1' } }, unowned)).toMatchObject({
      ok: false, code: 'CAD_TARGET_OWNERSHIP_REQUIRED',
    });
  });

  it('allows a target whose exact handle and edge map to the scoped part', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({
      hostAdapters: adapters, tools: makeTools(adapters), mode: 'scoped-modification', scope: { partIds: ['arm'] },
    });
    const owned = { cadOwnership: ownership, brepEntries: [], sketches: {}, mates: [] } as unknown as AgentSession;
    expect(authorize({ id: 'owned', name: 'brep_fillet', args: { hostHandle: 'occt:arm', edges: 'edge:arm:1' } }, owned)).toBeNull();
  });

  it('rejects an exact target owned by a different canonical part', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({
      hostAdapters: adapters, tools: makeTools(adapters), mode: 'scoped-modification', scope: { partIds: ['arm'] },
    });
    const owned = { cadOwnership: ownership, brepEntries: [], sketches: {}, mates: [] } as unknown as AgentSession;
    expect(authorize({ id: 'outside', name: 'brep_fillet', args: { hostHandle: 'occt:housing', edges: 'edge:housing:1' } }, owned)).toMatchObject({
      ok: false, code: 'CAD_TARGET_OUT_OF_SCOPE',
    });
  });

  it('rejects a cross-part B-rep boolean even when both handles are known', () => {
    const adapters = host({ brep: {} as ToolHostAdapters['brep'] });
    const authorize = createCadToolCallAuthorizer({
      hostAdapters: adapters, tools: makeTools(adapters), mode: 'scoped-modification', scope: { partIds: ['arm', 'housing'] },
    });
    const owned = { cadOwnership: ownership, brepEntries: [], sketches: {}, mates: [] } as unknown as AgentSession;
    expect(authorize({ id: 'cross', name: 'brep_boolean', args: { op: 'union', hostHandle: 'occt:arm', toolHandle: 'occt:housing' } }, owned)).toMatchObject({
      ok: false, code: 'CAD_CROSS_PART_OPERATION',
    });
  });
});
