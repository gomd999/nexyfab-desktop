import { describe, expect, it, vi } from 'vitest';
import {
  createRemotePrecisionCadExecutor,
  RemotePrecisionCadError,
} from './remoteBridge';

const context = { binding: { projectId: 'project-1', revision: 4, updatedAt: 1_700_000_000_000 }, locale: 'en', runId: 'run-1', continuationId: 'state-1' };
const catalog = [
  ['list_domains', 'read'], ['build_assembly', 'apply'], ['analyze_dfm', 'read'],
  ['fab_estimate', 'propose'], ['resolve_constraints', 'propose'], ['render_preview', 'propose'],
  ['blade_ring', 'apply'], ['loft_part', 'apply'],
].map(([name, scope]) => ({ name, description: `${name} tool`, parameters: { type: 'object' }, scope }));

describe('remote precision CAD executor', () => {
  it('posts cloud identity and returns a bounded catalog', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      expect(String(input)).toContain('/api/nexyfab/projects/project-1/precision-cad-agent/catalog?');
      expect(String(input)).toContain('contractVersion=nexyfab.remote-precision-cad.v1');
      expect(String(input)).toContain('revision=4');
      expect(String(input)).toContain('updatedAt=1700000000000');
      return new Response(JSON.stringify({ ok: true, tools: catalog }), { status: 200 });
    });
    await expect(createRemotePrecisionCadExecutor(fetcher).catalog(context)).resolves.toEqual(catalog);
  });

  it('uses the server turn envelope and authoritative run binding', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.contractVersion).toBe('nexyfab.remote-precision-cad.v1');
      expect(body.runId).toBe('run-1');
      expect(body.idempotencyKey).toBe('run-1');
      expect(body.binding).toEqual(context.binding);
      expect(body.input).toEqual([{ role: 'user', content: 'check' }]);
      return new Response(JSON.stringify({
        ok: true,
        assistant_text: 'done',
        tool_calls: [],
        provider_state: { handle: 'opaque' },
        finish_status: 'completed',
      }), { status: 200 });
    });
    await expect(createRemotePrecisionCadExecutor(fetcher).turn({
      provider: 'openai', model: 'gpt-5.6-luna', instructions: 'Use one tool.',
      input: [{ role: 'user', content: 'check' }], tools: [],
    }, context)).resolves.toMatchObject({ assistant_text: 'done', finish_status: 'completed' });
  });

  it('omits the initial key for a continuation turn', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.idempotencyKey).toBeUndefined();
      expect(body.prior_provider_state).toEqual({ handle: 'state-1' });
      return new Response(JSON.stringify({
        ok: true,
        assistant_text: 'continued',
        tool_calls: [],
        provider_state: { handle: 'state-2' },
        finish_status: 'completed',
      }), { status: 200 });
    });
    await expect(createRemotePrecisionCadExecutor(fetcher).turn({
      provider: 'openai', model: 'gpt-5.6-luna', instructions: 'Use one tool.',
      input: [{ role: 'tool', content: '{}', call_id: 'call-1', name: 'list_domains' }],
      tools: [], prior_provider_state: { handle: 'state-1' },
    }, context)).resolves.toMatchObject({ assistant_text: 'continued' });
  });

  it('sends tool calls without a local path and rejects secret-like input', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.projectRoot).toBeUndefined();
      expect(body.call.name).toBe('analyze_dfm');
      expect(body.continuationId).toBe('state-1');
      return new Response(JSON.stringify({ ok: true, tool: 'analyze_dfm', scope: 'read', result: { pass: true } }), { status: 200 });
    });
    const executor = createRemotePrecisionCadExecutor(fetcher);
    await expect(executor.tool({
      runId: 'r',
      call: { callId: 'c', toolName: 'analyze_dfm', arguments: {}, scope: 'read' },
      projectRoot: '',
      locale: 'en',
    }, context)).resolves.toMatchObject({ ok: true });
    await expect(executor.tool({
      runId: 'r',
      call: { callId: 'c', toolName: 'analyze_dfm', arguments: { apiKey: 'x' }, scope: 'read' },
      projectRoot: '',
      locale: 'en',
    }, context)).rejects.toMatchObject({ code: 'REMOTE_INPUT_REJECTED' });
  });

  it('redeems a server-bound approval challenge only after local approval', async () => {
    const approvalChallenge = { challengeId: 'challenge-1', nonce: 'nonce-value-1', mac: 'A'.repeat(43) };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.approved !== true) {
        expect(body.approvalChallenge).toBeUndefined();
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'APPROVAL_REQUIRED' },
          approvalChallenge,
        }), { status: 409 });
      }
      expect(body.approvalChallenge).toEqual(approvalChallenge);
      return new Response(JSON.stringify({
        ok: true,
        tool: 'build_assembly',
        scope: 'apply',
        result: { applied: true },
      }), { status: 200 });
    });
    const executor = createRemotePrecisionCadExecutor(fetcher);
    const call = {
      runId: 'r',
      call: { callId: 'c', toolName: 'build_assembly', arguments: {}, scope: 'apply' as const },
      projectRoot: '',
      locale: 'en',
    };
    await expect(executor.tool({ ...call, approvalBinding: 'local-approval' }, context))
      .resolves.toMatchObject({ ok: true, result: { applied: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(executor.tool(call, context)).rejects.toMatchObject({ code: 'REMOTE_INPUT_REJECTED' });
  });

  it('carries a verified generation id and preserves the server hold code', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationRunId).toBe('generation-1');
      return new Response(JSON.stringify({ ok: false, status: 'HOLD', error: { code: 'VERIFIED_GENERATION_BINDING_REQUIRED' } }), { status: 409 });
    });
    await expect(createRemotePrecisionCadExecutor(fetcher).tool({
      runId: 'r', call: { callId: 'c', toolName: 'build_assembly', arguments: {}, scope: 'apply' }, projectRoot: '', locale: 'en', approvalBinding: 'local-approval',
    }, { ...context, generationRunId: 'generation-1' })).rejects.toMatchObject({ code: 'REMOTE_REVISION_CONFLICT', serverCode: 'VERIFIED_GENERATION_BINDING_REQUIRED' });
  });

  it('maps revision conflicts to a stable error', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 409 }));
    await expect(createRemotePrecisionCadExecutor(fetcher).catalog(context)).rejects.toEqual(expect.objectContaining({
      code: 'REMOTE_REVISION_CONFLICT',
    } satisfies Partial<RemotePrecisionCadError>));
  });
});
