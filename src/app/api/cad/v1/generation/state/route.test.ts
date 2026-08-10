import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetGenerationStateStoreForTests } from '@/lib/ai/generationStateStore';
import { POST } from './route';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => null) }));

const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/generation/state', { method: 'POST', body: JSON.stringify(body) });

describe('CAD v1 server-owned generation state machine', () => {
  beforeEach(() => resetGenerationStateStoreForTests());

  it('initializes a server-owned run and refuses browser-authored stage results', async () => {
    const initialized = await (await POST(request({ action: 'initialize', runId: 'api-run' }))).json();
    expect(initialized.executionPlan).toMatchObject({ objective: 'complete_manufacturing_product', status: 'ai_building', activeStage: 'intent' });
    const response = await POST(request({ action: 'record', state: initialized.state, completion: { stage: 'intent', input: {}, output: {}, status: 'passed' } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SERVER_STAGE_EXECUTOR_REQUIRED' });
  });

  it('rejects a forged revision instead of trusting the supplied state', async () => {
    const initialized = await (await POST(request({ action: 'initialize', runId: 'forged-revision' }))).json();
    const forged = { ...initialized.state, revision: 99 };
    const response = await POST(request({ action: 'plan', state: forged }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_REVISION_CONFLICT' });
  });

  it('returns the adaptive plan from the stored state without mutation', async () => {
    const initialized = await (await POST(request({ action: 'initialize', runId: 'plan-only' }))).json();
    const response = await POST(request({ action: 'plan', state: initialized.state }));
    expect(await response.json()).toMatchObject({ ok: true, state: { revision: 0 }, executionPlan: { status: 'ai_building', nextAction: 'continue_ai_pipeline', externalCadInstallationRequired: false } });
  });
});
