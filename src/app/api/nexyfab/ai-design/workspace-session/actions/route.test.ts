import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1', plan: 'free' } as { userId: string; plan: string } | null,
  origin: true, allowed: true,
  access: { canEdit: true } as { canEdit: boolean } | null,
  execute: vi.fn(async () => ({ ok: true, state: { runtimeRevision: 1 }, replayed: false, receipts: [], generationRequested: false })),
  advance: vi.fn(async () => ({ ok: true, state: { runtimeRevision: 2 }, replayed: false, receipts: [], generationRequested: true })),
  worker: vi.fn(() => vi.fn()),
  load: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => mocks.origin) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: mocks.allowed })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignWorkspaceActionService', () => ({ executeAiDesignWorkspaceClientCommand: mocks.execute, advanceServerAiDesignGeneration: mocks.advance }));
vi.mock('@/lib/ai/aiDesignServerGenerationWorker', () => ({ createAiDesignServerGenerationWorker: mocks.worker }));
vi.mock('@/lib/ai/aiDesignWorkspaceRuntimeStore', () => ({ loadServerAiDesignWorkspaceRuntime: mocks.load }));
vi.mock('@/lib/ai/aiDesignServerRuntimeArtifacts', () => ({ aiDesignServerRuntimeArtifacts: {} }));
vi.mock('@/lib/ai/aiDesignComplexEvaluationService', () => ({ evaluateAiDesignComplexCandidateSet: mocks.evaluate }));

import { POST } from './route';

const url = 'http://localhost/api/nexyfab/ai-design/workspace-session/actions';
const base = { schema: 'nexyfab.ai-design-workspace-command.v2', commandId: 'cmd-1', projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 0, issuedAt: new Date().toISOString() };
const post = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.auth = { userId: 'user-1', plan: 'free' }; mocks.origin = true; mocks.allowed = true; mocks.access = { canEdit: true };
  mocks.execute.mockClear(); mocks.advance.mockClear(); mocks.worker.mockClear();
  vi.stubEnv('GENERATION_EVIDENCE_SIGNING_SECRET', 'ai-design-server-evidence-secret-at-least-32-bytes');
});

describe('AI Design workspace action route', () => {
  it('enforces origin, auth, rate limit, project access, and editor role', async () => {
    mocks.origin = false; expect((await POST(post({}))).status).toBe(403);
    mocks.origin = true; mocks.auth = null; expect((await POST(post({}))).status).toBe(401);
    mocks.auth = { userId: 'user-1', plan: 'free' }; mocks.allowed = false; expect((await POST(post({}))).status).toBe(429);
    mocks.allowed = true; mocks.access = { canEdit: false };
    expect((await POST(post({ ...base, type: 'CANCEL', payload: {} }))).status).toBe(403);
  });

  it('rejects server completions and client-authored authority fields', async () => {
    expect((await POST(post({ ...base, type: 'GENERATION_STAGE_COMPLETED', payload: { outputDigest: 'a'.repeat(64), evidence: { status: 'PASS' } } }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('passes only parsed client requests with authenticated plan to the service', async () => {
    const response = await POST(post({ ...base, type: 'START_GENERATION_REQUEST', payload: { runId: 'run-1', modelSelection: { mode: 'auto' } } }));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith('user-1:project-1', 'free', expect.objectContaining({ type: 'START_GENERATION_REQUEST' }), expect.any(Object));
  });

  it('connects a stage-run request to the server worker entrypoint', async () => {
    const response = await POST(post({ ...base, type: 'RUN_GENERATION_STAGE_REQUEST', payload: {} }));
    expect(response.status).toBe(202);
    expect(mocks.worker).toHaveBeenCalledWith(expect.objectContaining({ plan: 'free', userId: 'user-1' }));
    expect(mocks.advance).toHaveBeenCalledWith('user-1:project-1', 'project-1', 'session-1', expect.objectContaining({ worker: expect.any(Function), evaluatePublishedConcepts: expect.any(Function) }), 0);
  });
});
