import { describe, expect, it, vi } from 'vitest';
import { argumentsHash } from './runState';
import { invokeAgentToolCall, invokeAiAgentTurn, isAgentBridgeInputSecretFree, type TauriInvoke } from './tauriBridge';

const invokeMock = vi.fn(async <T>(_command: string, _args: Record<string, unknown>) => ({
  ok: true,
  tool: 'build_assembly',
  scope: 'propose',
  profile: 'installer-core',
} as T));
const invoke = invokeMock as unknown as TauriInvoke;

describe('precision CAD agent Tauri bridge', () => {
  it('matches the native ai_agent_turn request and accepts no API keys', async () => {
    const request = {
      provider: 'openai' as const,
      model: 'model-test',
      instructions: 'Use bounded CAD tools.',
      input: [{ role: 'user' as const, content: 'Inspect the bracket.' }],
      tools: [{ name: 'analyze_dfm', description: 'Analyze DFM', parameters: { type: 'object' }, scope: 'read' as const }],
    };
    await invokeAiAgentTurn(request, invoke);
    expect(invokeMock).toHaveBeenCalledWith('ai_agent_turn', { request: {
      ...request,
      tools: [{ name: 'analyze_dfm', description: 'Analyze DFM', parameters: { type: 'object' } }],
    } });
    await expect(invokeAiAgentTurn({ ...request, apiKey: 'nope' } as never, invoke)).rejects.toThrow(/Secret-like/);
    expect(isAgentBridgeInputSecretFree({ request: 'ok' })).toBe(true);
    expect(isAgentBridgeInputSecretFree({ api_key: 'nope' })).toBe(false);
    expect(isAgentBridgeInputSecretFree({ access_token: 'nope' })).toBe(false);
    expect(isAgentBridgeInputSecretFree({ privateKey: 'nope' })).toBe(false);
  });

  it('loads the exact scoped tool catalog for a project root', async () => {
    invokeMock.mockResolvedValueOnce([
      { name: 'analyze_dfm', description: 'Analyze DFM', parameters: { type: 'object' }, scope: 'read' },
    ]);
    const { invokeAgentToolCatalog } = await import('./tauriBridge');
    await expect(invokeAgentToolCatalog('C:\\project', invoke)).resolves.toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith('agent_tool_catalog', { projectRoot: 'C:\\project' });
  });

  it('binds apply/export approval and maps the native argument contract', async () => {
    const call = { callId: 'c1', toolName: 'render_preview', arguments: { outDir: 'exports' }, scope: 'export' as const };
    const base = { runId: 'run-1', call, projectRoot: 'C:\\project', locale: 'ko' };
    await expect(invokeAgentToolCall(base, invoke)).rejects.toThrow(/matching approval token/);
    const approvalToken = `run-1:c1:${argumentsHash(call.arguments)}`;
    await invokeAgentToolCall({ ...base, approvalBinding: approvalToken }, invoke);
    expect(invokeMock).toHaveBeenCalledWith('agent_tool_call', {
      tool: 'render_preview',
      args: call.arguments,
      projectRoot: 'C:\\project',
      scope: 'export',
      approved: true,
      locale: 'ko',
    });
    expect(JSON.stringify(invokeMock.mock.calls)).not.toMatch(/api.?key|secret/i);
  });
});
