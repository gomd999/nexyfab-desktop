import { describe, expect, it, vi } from 'vitest';
import {
  assertRemotePendingToolCall,
  executeRemoteAgentCall,
  hashRemoteInitialTurnRequest,
  makeRemoteApprovalToken,
  runRemoteAgentTurn,
  type RemoteToolDefinition,
} from './remoteAgentApi';

const aiMocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({
    text: JSON.stringify({ assistant_text: 'done', tool_calls: [] }),
    provider: 'openai',
  })),
}));
vi.mock('@/lib/ai', () => aiMocks);

const env = { NEXYFAB_AGENT_APPROVAL_SECRET: 'test-only-secret-at-least-32-characters' };
const catalog: readonly RemoteToolDefinition[] = [
  { name: 'list_domains', description: 'read', scope: 'read', parameters: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'blade_ring', description: 'edit', scope: 'apply', parameters: { type: 'object', required: ['params'], additionalProperties: false, properties: { params: { type: 'object' } } } },
];
const executor = vi.fn(async ({ tool }: { tool: string }) => ({ ok: true, tool }));

function withTransaction<T extends object>(db: T): T & { transaction: ReturnType<typeof vi.fn> } {
  return Object.assign(db, {
    transaction: vi.fn(async (fn: (tx: T) => Promise<unknown>) => fn(db)),
  });
}

describe('remote precision CAD agent contract', () => {
  it('auto-executes read and rejects path-like arguments before delegation', async () => {
    await expect(executeRemoteAgentCall({ projectId: 'p', revision: 2, userId: 'u', role: 'viewer', tool: 'list_domains', arguments: {}, catalog, executor })).resolves.toMatchObject({ ok: true, scope: 'read' });
    await expect(executeRemoteAgentCall({ projectId: 'p', revision: 2, userId: 'u', role: 'viewer', tool: 'list_domains', arguments: { outPath: 'C:\\tmp\\x.json' }, catalog, executor })).resolves.toEqual({ ok: false, error: { code: 'PATH_INPUT_FORBIDDEN' } });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('requires editor and an approval token bound to user/project/revision/arguments', async () => {
    const input = { projectId: 'p', revision: 2, userId: 'u', role: 'editor' as const, tool: 'blade_ring', arguments: { params: {} }, catalog, env, executor };
    await expect(executeRemoteAgentCall(input)).resolves.toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' }, approvalToken: expect.any(String) });
    const token = makeRemoteApprovalToken({ userId: 'u', projectId: 'p', revision: 2, tool: 'blade_ring', arguments: input.arguments }, env);
    await expect(executeRemoteAgentCall({ ...input, approved: true, approvalToken: token ?? '' })).resolves.toMatchObject({ ok: true, scope: 'apply' });
    await expect(executeRemoteAgentCall({ ...input, approved: true, approvalToken: token ?? '', arguments: { params: { changed: true } } })).resolves.toEqual({ ok: false, error: { code: 'INVALID_APPROVAL_TOKEN' } });
    await expect(executeRemoteAgentCall({ ...input, role: 'viewer', approved: true, approvalToken: token ?? '' })).resolves.toEqual({ ok: false, error: { code: 'EDITOR_REQUIRED' } });
  });

  it('fails closed for unknown tools, scope mismatch, invalid args, timeout, and result bounds', async () => {
    await expect(executeRemoteAgentCall({ projectId: 'p', revision: 1, userId: 'u', role: 'viewer', tool: 'unknown', arguments: {}, catalog })).resolves.toEqual({ ok: false, error: { code: 'TOOL_NOT_FOUND' } });
    await expect(executeRemoteAgentCall({ projectId: 'p', revision: 1, userId: 'u', role: 'viewer', tool: 'list_domains', arguments: {}, requestedScope: 'apply', catalog })).resolves.toEqual({ ok: false, error: { code: 'SCOPE_MISMATCH' } });
    await expect(executeRemoteAgentCall({ projectId: 'p', revision: 1, userId: 'u', role: 'viewer', tool: 'list_domains', arguments: { extra: true }, catalog })).resolves.toEqual({ ok: false, error: { code: 'INVALID_TOOL_ARGUMENTS' } });
    await expect(executeRemoteAgentCall({ projectId: 'p', revision: 1, userId: 'u', role: 'viewer', tool: 'list_domains', arguments: {}, catalog, executor: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return {}; } })).resolves.toEqual({ ok: true, tool: 'list_domains', scope: 'read', result: {}, auditId: expect.any(String) });
  });

  it('uses an exact provider/model allowlist', async () => {
    await expect(runRemoteAgentTurn({
      db: {} as never,
      userId: 'u',
      projectId: 'p',
      revision: 1,
      provider: 'openai',
      model: 'gpt-attacker-controlled',
      instructions: 'ignored by the server',
      items: [{ role: 'user', content: 'check' }],
      catalog,
    })).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('forwards request cancellation to the provider boundary', async () => {
    const db = withTransaction({
      execute: vi.fn(async () => ({ changes: 1 })),
      queryOne: vi.fn(async () => null),
    });
    const signal = new AbortController().signal;
    await expect(runRemoteAgentTurn({
      db: db as never,
      userId: 'u',
      projectId: 'p',
      revision: 1,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      instructions: 'check',
      items: [{ role: 'user', content: 'check' }],
      catalog,
      initialIdempotency: { key: 'signal-run', requestHash: 'a'.repeat(64) },
      signal,
    })).resolves.toMatchObject({ ok: true, finish_status: 'completed' });
    expect(aiMocks.chatCompletion).toHaveBeenCalledWith(expect.objectContaining({ signal }));
  });

  it('requires persistence-backed idempotency even when called below the HTTP route', async () => {
    const db = { execute: vi.fn(async () => ({ changes: 1 })), queryOne: vi.fn(async () => null) };
    aiMocks.chatCompletion.mockClear();
    await expect(runRemoteAgentTurn({
      db: db as never, userId: 'u', projectId: 'p', revision: 1, provider: 'openai',
      model: 'gpt-5.6-luna', instructions: 'check', items: [{ role: 'user', content: 'check' }], catalog,
    })).resolves.toEqual({ ok: false, error: { code: 'INITIAL_TURN_IDEMPOTENCY_KEY_REQUIRED' } });
    expect(aiMocks.chatCompletion).not.toHaveBeenCalled();
  });

  it('binds the request hash to the project updated-at CAS token', () => {
    const base = {
      runId: 'run-1', projectId: 'p', revision: 1, updatedAt: 100, userId: 'u',
      provider: 'openai' as const, model: 'gpt-5.6-luna', instructions: 'check',
      items: [{ role: 'user' as const, content: 'check' }],
    };
    expect(hashRemoteInitialTurnRequest(base)).not.toBe(hashRemoteInitialTurnRequest({ ...base, updatedAt: 101 }));
  });

  it('holds an expired in-flight claim for manual recovery instead of calling the provider twice', async () => {
    const marker = JSON.stringify([{ role: 'system', content: JSON.stringify({
      marker: 'nexyfab.remote.initial.v1', status: 'in_flight', requestHash: 'f'.repeat(64), createdAt: Date.now() - 120_000,
    }) }]);
    const db = {
      execute: vi.fn(async (sql: string) => ({ changes: sql.includes('INSERT INTO nf_remote_agent_states') ? 0 : 1 })),
      queryOne: vi.fn(async () => ({ user_id: 'u', project_id: 'p', revision: 4, provider: 'openai', model: 'gpt-5.6-luna', messages_json: marker, expires_at: Date.now() - 1 })),
    };
    aiMocks.chatCompletion.mockClear();
    await expect(runRemoteAgentTurn({
      db: db as never, userId: 'u', projectId: 'p', revision: 4, provider: 'openai', model: 'gpt-5.6-luna',
      instructions: 'check', items: [{ role: 'user', content: 'check' }], catalog,
      initialIdempotency: { key: 'expired-key', requestHash: 'f'.repeat(64) },
    })).resolves.toEqual({ ok: false, error: { code: 'INITIAL_TURN_RECOVERY_REQUIRED' } });
    expect(aiMocks.chatCompletion).not.toHaveBeenCalled();
  });

  it('claims the initial turn once and replays an identical request', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const db = withTransaction({
      execute: vi.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('INSERT INTO nf_remote_agent_states')) {
          const handle = String(params[0]);
          if (rows.has(handle)) return { changes: 0 };
          rows.set(handle, { handle, user_id: params[1], project_id: params[2], revision: params[3], provider: params[4], model: params[5], messages_json: params[6], created_at: params[7], updated_at: params[8], expires_at: params[9] });
          return { changes: 1 };
        }
        if (sql.startsWith('UPDATE nf_remote_agent_states SET messages_json')) {
          const handle = String(params[3]);
          const row = rows.get(handle);
          if (!row || row.messages_json !== params[9]) return { changes: 0 };
          row.messages_json = params[0]; row.updated_at = params[1]; row.expires_at = params[2];
          return { changes: 1 };
        }
        return { changes: 1 };
      }),
      queryOne: vi.fn(async (sql: string, ...params: unknown[]) => rows.get(String(params[0]))),
    });
    const request = {
      db: db as never, userId: 'u', projectId: 'p', revision: 4, provider: 'openai' as const,
      model: 'gpt-5.6-luna', instructions: 'check', items: [{ role: 'user' as const, content: 'check' }], catalog,
      initialIdempotency: { key: 'retry-key', requestHash: 'b'.repeat(64) },
    };
    aiMocks.chatCompletion.mockClear();
    const first = await runRemoteAgentTurn(request);
    const replay = await runRemoteAgentTurn(request);
    expect(first).toMatchObject({ ok: true, finish_status: 'completed' });
    expect(replay).toEqual(first);
    expect(aiMocks.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('rejects a different request under the same initial key and bounds in-flight duplicates', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const db = withTransaction({
      execute: vi.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('INSERT INTO nf_remote_agent_states')) {
          const handle = String(params[0]);
          if (rows.has(handle)) return { changes: 0 };
          rows.set(handle, { handle, user_id: params[1], project_id: params[2], revision: params[3], provider: params[4], model: params[5], messages_json: params[6], created_at: params[7], updated_at: params[8], expires_at: params[9] });
          return { changes: 1 };
        }
        if (sql.startsWith('UPDATE nf_remote_agent_states SET messages_json')) {
          const row = rows.get(String(params[3]));
          if (!row || row.messages_json !== params[9]) return { changes: 0 };
          row.messages_json = params[0]; return { changes: 1 };
        }
        return { changes: 1 };
      }),
      queryOne: vi.fn(async (_sql: string, ...params: unknown[]) => rows.get(String(params[0]))),
    });
    const release = vi.fn();
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    aiMocks.chatCompletion.mockImplementationOnce(async () => { await blocked; return { text: JSON.stringify({ assistant_text: 'done', tool_calls: [] }), provider: 'openai' }; });
    const request = {
      db: db as never, userId: 'u', projectId: 'p', revision: 4, provider: 'openai' as const,
      model: 'gpt-5.6-luna', instructions: 'check', items: [{ role: 'user' as const, content: 'check' }], catalog,
      initialIdempotency: { key: 'concurrent-key', requestHash: 'c'.repeat(64) },
    };
    const firstPromise = runRemoteAgentTurn(request);
    await vi.waitFor(() => expect(aiMocks.chatCompletion).toHaveBeenCalledTimes(1));
    await expect(runRemoteAgentTurn({ ...request, initialIdempotency: { key: 'concurrent-key', requestHash: 'd'.repeat(64) } })).resolves.toEqual({ ok: false, error: { code: 'INITIAL_TURN_REQUEST_CONFLICT' } });
    await expect(runRemoteAgentTurn(request)).resolves.toEqual({ ok: false, error: { code: 'INITIAL_TURN_IN_FLIGHT' } });
    unblock();
    await firstPromise;
    release();
  });

  it('records provider failure so a retry cannot silently invoke the provider again', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const db = {
      execute: vi.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('INSERT INTO nf_remote_agent_states')) {
          const handle = String(params[0]);
          if (rows.has(handle)) return { changes: 0 };
          rows.set(handle, { handle, user_id: params[1], project_id: params[2], revision: params[3], provider: params[4], model: params[5], messages_json: params[6], created_at: params[7], updated_at: params[8], expires_at: params[9] });
          return { changes: 1 };
        }
        if (sql.startsWith('UPDATE nf_remote_agent_states SET messages_json')) {
          const row = rows.get(String(params[3]));
          if (row) row.messages_json = params[0];
          return { changes: row ? 1 : 0 };
        }
        return { changes: 1 };
      }),
      queryOne: vi.fn(async (_sql: string, ...params: unknown[]) => rows.get(String(params[0]))),
    };
    aiMocks.chatCompletion.mockClear();
    aiMocks.chatCompletion.mockRejectedValueOnce(new Error('provider_cancelled'));
    const request = {
      db: db as never, userId: 'u', projectId: 'p', revision: 4, provider: 'openai' as const,
      model: 'gpt-5.6-luna', instructions: 'check', items: [{ role: 'user' as const, content: 'check' }], catalog,
      initialIdempotency: { key: 'failed-key', requestHash: 'e'.repeat(64) },
    };
    const first = await runRemoteAgentTurn(request);
    const replay = await runRemoteAgentTurn(request);
    expect(first).toEqual({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(replay).toEqual(first);
    expect(aiMocks.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('binds execution to the exact pending provider tool call', async () => {
    const argumentsValue = { assembly: { parts: [] } };
    const db = {
      execute: vi.fn(async () => ({ changes: 1 })),
      queryOne: vi.fn(async () => ({
        user_id: 'u',
        project_id: 'p',
        revision: 2,
        expires_at: Date.now() + 60_000,
        messages_json: JSON.stringify([{
          role: 'assistant',
          content: JSON.stringify({
            assistant_text: 'Ready to apply.',
            tool_calls: [{ call_id: 'call-1', name: 'build_assembly', arguments: argumentsValue }],
          }),
        }]),
      })),
    };
    const exact = { db: db as never, handle: '12345678-1234-1234-1234-123456789012', userId: 'u', projectId: 'p', revision: 2, callId: 'call-1', tool: 'build_assembly', arguments: argumentsValue };
    await expect(assertRemotePendingToolCall(exact)).resolves.toBeNull();
    await expect(assertRemotePendingToolCall({ ...exact, arguments: { assembly: { parts: [{ id: 'tampered' }] } } }))
      .resolves.toEqual({ ok: false, error: { code: 'STATE_INVALID' } });
  });
});
