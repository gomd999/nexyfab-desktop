// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrecisionCadAgentController } from './usePrecisionCadAgentController';
import type { TauriInvoke } from './tauriBridge';

const catalog = [
  { name: 'list_domains', description: 'List', parameters: { type: 'object' }, scope: 'read' as const },
  { name: 'build_assembly', description: 'Build', parameters: { type: 'object' }, scope: 'apply' as const },
  { name: 'analyze_dfm', description: 'Validate', parameters: { type: 'object' }, scope: 'read' as const },
  { name: 'fab_estimate', description: 'Estimate', parameters: { type: 'object' }, scope: 'propose' as const },
  { name: 'resolve_constraints', description: 'Resolve', parameters: { type: 'object' }, scope: 'propose' as const },
  { name: 'render_preview', description: 'Render', parameters: { type: 'object' }, scope: 'propose' as const },
  { name: 'blade_ring', description: 'Blade', parameters: { type: 'object' }, scope: 'apply' as const },
  { name: 'loft_part', description: 'Loft', parameters: { type: 'object' }, scope: 'apply' as const },
];

function output(name?: string, callId = 'call-1', args: Record<string, unknown> = {}) {
  return name
    ? { assistant_text: '', tool_calls: [{ call_id: callId, name, arguments: args }], finish_status: 'tool_calls' as const, provider_state: { handle: `native-${callId}` } }
    : { assistant_text: 'done', tool_calls: [], finish_status: 'completed' as const, provider_state: { handle: 'native-done' } };
}

async function load(result: { current: ReturnType<typeof usePrecisionCadAgentController> }) {
  await act(async () => { await result.current.loadCatalog(); });
}

function makeInvoke(turns: unknown[], catalogValue = catalog) {
  const queue = [...turns];
  return vi.fn(async <T>(command: string, _args: Record<string, unknown>) => {
    if (command === 'agent_tool_catalog') return catalogValue as T;
    if (command === 'agent_tool_call') return { runId: 'ignored', callId: 'ignored', ok: true, result: { pass: true } } as T;
    return (queue.shift() ?? output()) as T;
  }) as unknown as TauriInvoke & ReturnType<typeof vi.fn>;
}

const options = (invoke: TauriInvoke) => ({ projectRoot: 'C:\\project', provider: 'openai' as const, model: 'gpt-test', lang: 'en', invoke, autoLoadCatalog: false });

describe('usePrecisionCadAgentController', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('pauses apply calls and rejects a tampered approval token', async () => {
    const invoke = makeInvoke([output('build_assembly')]);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    await act(async () => { await result.current.start('edit bracket'); });
    expect(result.current.run.state).toBe('awaiting_approval');
    await act(async () => { await result.current.approve('tampered'); });
    expect(result.current.run.state).toBe('awaiting_approval');
    expect(result.current.error?.code).toBe('INVALID_APPROVAL_TOKEN');
    const token = result.current.run.pendingApproval!.token;
    await act(async () => { await result.current.approve(token); });
    expect(invoke).toHaveBeenCalledWith('agent_tool_call', expect.objectContaining({ approved: true, scope: 'apply' }));
  });

  it('auto-executes read calls and completes only after deterministic validation', async () => {
    const invoke = makeInvoke([output('analyze_dfm'), output()]);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    await act(async () => { await result.current.start('validate bracket'); });
    expect(result.current.run.state).toBe('completed');
    expect(result.current.error).toBeUndefined();
    expect(result.current.run.result).toMatchObject({
      validation: 'deterministic',
      assistantText: 'done',
      toolResult: { pass: true },
    });
    expect(invoke).toHaveBeenCalledWith('agent_tool_call', expect.objectContaining({ approved: false, scope: 'read' }));
  });

  it('uses stateless provider_state and appends a role tool continuation', async () => {
    const invoke = makeInvoke([output('list_domains'), output()]);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    await act(async () => { await result.current.start('inspect bracket'); });
    const turns = invoke.mock.calls.filter(([command]) => command === 'ai_agent_turn');
    expect(turns).toHaveLength(2);
    const secondRequest = (turns[1]![1] as { request: { prior_provider_state?: unknown; input: readonly { role: string; call_id?: string }[] } }).request;
    expect(secondRequest.prior_provider_state).toEqual({ handle: 'native-call-1' });
    expect(secondRequest.input).toEqual([expect.objectContaining({ role: 'tool', call_id: 'call-1' })]);
  });

  it('ignores stale provider completions after cancellation', async () => {
    let resolveTurn!: (value: unknown) => void;
    const deferred = new Promise((resolve) => { resolveTurn = resolve; });
    const invoke = vi.fn(async <T>(command: string) => {
      if (command === 'agent_tool_catalog') return catalog as T;
      if (command === 'ai_agent_turn') return deferred as T;
      return { runId: 'run', callId: 'call', ok: true, result: {} } as T;
    }) as unknown as TauriInvoke & ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    let started!: Promise<void>;
    await act(async () => { started = result.current.start('cancel me'); });
    act(() => result.current.cancel());
    resolveTurn(output('list_domains'));
    await act(async () => { await started; });
    expect(result.current.run.state).toBe('cancelled');
    expect(invoke).not.toHaveBeenCalledWith('agent_tool_call', expect.anything());
  });

  it('fails closed on completion without deterministic validation', async () => {
    const invoke = makeInvoke([output()]);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    await act(async () => { await result.current.start('just answer'); });
    expect(result.current.run.state).toBe('failed');
    expect(result.current.error?.code).toBe('VALIDATION_REQUIRED');
  });

  it('stops at the bounded tool-call budget', async () => {
    const turns = Array.from({ length: 26 }, (_, index) => output('list_domains', `call-${index}`));
    const invoke = makeInvoke(turns);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    await act(async () => { await result.current.start('bounded inspection'); });
    expect(result.current.run.state).toBe('failed');
    expect(result.current.error?.code).toBe('BOUNDS_EXCEEDED');
  });

  it('validates catalog arguments before invoking native tools', async () => {
    const constrainedCatalog = catalog.map((item) => item.name === 'list_domains'
      ? { ...item, parameters: { type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['box'] } } } }
      : item);
    const invoke = makeInvoke([output('list_domains')], constrainedCatalog);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    expect(invoke).toHaveBeenCalledWith('agent_tool_catalog', { projectRoot: 'C:\\project' });
    expect(result.current.catalog).toHaveLength(8);
    await act(async () => { await result.current.start('invalid args'); });
    expect(result.current.error?.code).toBe('INVALID_TOOL_ARGUMENTS');
    expect(result.current.run.state).toBe('failed');
    expect(invoke).not.toHaveBeenCalledWith('agent_tool_call', expect.anything());
  });

  it('maps render_preview with an output directory to export approval', async () => {
    const invoke = makeInvoke([output('render_preview', 'call-render', { outDir: 'exports' })]);
    const { result } = renderHook(() => usePrecisionCadAgentController(options(invoke)));
    await load(result);
    await act(async () => { await result.current.start('preview'); });
    expect(result.current.run.state).toBe('awaiting_approval');
  });

  it('stops continuation when a durable commercial execution owns the mutation', async () => {
    const executor = {
      catalog: vi.fn().mockResolvedValue(catalog),
      turn: vi.fn().mockResolvedValue(output('build_assembly')),
      tool: vi.fn().mockResolvedValue({ runId: 'run', callId: 'call-1', ok: true, result: {
        execution: { mode: 'durable_commercial_queue', status: 'queued', executionId: 'execution-1' },
        persistence: { ok: false, code: 'PENDING', releaseReady: false, artifacts: [] },
      } }),
    };
    const { result } = renderHook(() => usePrecisionCadAgentController({ ...options(makeInvoke([])), executor }));
    await load(result);
    await act(async () => { await result.current.start('commercial edit'); });
    const token = result.current.run.pendingApproval!.token;
    await act(async () => { await result.current.approve(token); });
    expect(result.current.run.state).toBe('queued');
    expect(result.current.run.result).toMatchObject({ execution: { executionId: 'execution-1' } });
    expect(executor.turn).toHaveBeenCalledTimes(1);
  });
});
