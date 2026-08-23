import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ consume: vi.fn(), origin: vi.fn(() => true), apiKeyScopes: null as string[] | null }));

vi.mock('@/lib/plan-guard', () => ({
  checkPlan: vi.fn(async () => ({
    ok: true, userId: 'user-1', orgId: 'org-1', plan: 'free',
    ...(mocks.apiKeyScopes ? { apiKey: { id: 'ak-test', scopes: mocks.apiKeyScopes } } : {}),
  })),
  consumeMonthlyMetricSlot: mocks.consume,
}));
vi.mock('@/lib/ai/userBudget', () => ({ checkUserBudget: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.8') }));
vi.mock('@/lib/ai/telemetry', () => ({ recordPromptCall: vi.fn() }));
vi.mock('@/lib/enterprise-cad-audit', () => ({ CadAuditAction: { SCAD_AGENT_RUN: 'SCAD_AGENT_RUN' }, logCadPipelineAudit: vi.fn() }));
vi.mock('@/lib/error-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/ai/scad-agent/tools', () => ({ makeTools: vi.fn() }));
vi.mock('@/lib/ai/scad-agent/serverAdapters', () => ({ SERVER_HOST_ADAPTERS: {}, makeServerVisionAdapter: vi.fn() }));
vi.mock('@/lib/ai/scad-agent/repairLoop', () => ({
  runRepairLoop: vi.fn(), makeServerAiFamilies: vi.fn(), makeSpecGateEvaluator: vi.fn(), makeVisionCritic: vi.fn(),
}));
vi.mock('@/lib/ai/scad-agent/sessionIntegrity', () => ({ signAgentSession: vi.fn(), verifyAgentSession: vi.fn() }));
vi.mock('@/lib/ai/codegenModelRuntime', () => ({ resolveRuntimeCodegenModel: vi.fn() }));
vi.mock('@/lib/ai/lunaDesignSidecars', () => ({ runLunaDesignPreflight: vi.fn() }));
vi.mock('@/lib/ai/vision', () => ({ resolveVisionSelection: vi.fn() }));
vi.mock('@/lib/ai/precisionCadAgentTask', () => ({ validatePrecisionCadAgentTask: vi.fn() }));
vi.mock('@/lib/ai/cadToolAuthorization', () => ({ createCadToolCallAuthorizer: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));

import { POST } from './route';

const url = 'https://nexyfab.test/api/nexyfab/scad-agent';

beforeEach(() => { vi.clearAllMocks(); mocks.origin.mockReturnValue(true); mocks.apiKeyScopes = null; });

describe('SCAD agent streaming JSON body boundary', () => {
  it('rejects a cross-origin mutation before plan/budget consumption', async () => {
    mocks.origin.mockReturnValue(false);
    const response = await POST(new NextRequest(url, { method: 'POST', body: '{}' }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden', code: 'INVALID_ORIGIN' });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('requires write scope when the Agent is invoked with a bearer API key', async () => {
    mocks.apiKeyScopes = ['read:projects'];
    const response = await POST(new NextRequest(url, { method: 'POST', body: '{}' }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INSUFFICIENT_API_KEY_SCOPE',
      requiredScope: 'write:projects',
    });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('measures and cancels an oversized chunked body despite a falsely small Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200_000));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    });
    const init = {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' }, body, duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const response = await POST(new NextRequest(url, init as never));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'request body too large' });
    expect(cancelled).toBe(true);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('preserves the malformed-JSON response contract', async () => {
    const response = await POST(new NextRequest(url, { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid JSON body' });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 through the same sanitized response contract', async () => {
    const response = await POST(new NextRequest(url, { method: 'POST', body: new Uint8Array([0xff]) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid JSON body' });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('fails closed before quota when precision mode has no signed project binding', async () => {
    const response = await POST(new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify({ userPrompt: 'edit the selected part', executionMode: 'precision_cad' }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CAD_PROJECT_BINDING_REQUIRED',
    });
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
