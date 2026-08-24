import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1' } as { userId: string } | null,
  access: { role: 'owner' } as object | null,
  origin: true,
  allowed: true,
  create: vi.fn(async (_owner: string, state: unknown) => state),
  load: vi.fn(async () => ({ projectId: 'project-1', session: { sessionId: 'session-1' } })),
  save: vi.fn(async (_owner: string, state: unknown, _revision: number) => state),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => mocks.origin) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: mocks.allowed })) }));
vi.mock('@/lib/ai/aiDesignWorkspaceRuntimeStore', () => ({
  createServerAiDesignWorkspaceRuntime: mocks.create,
  loadServerAiDesignWorkspaceRuntime: mocks.load,
  saveServerAiDesignWorkspaceRuntime: mocks.save,
}));

import { GET, POST } from './route';

const url = 'http://localhost/api/nexyfab/ai-design/workspace-session';
const post = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.auth = { userId: 'user-1' };
  mocks.access = { role: 'owner' };
  mocks.origin = true;
  mocks.allowed = true;
  mocks.create.mockClear();
  mocks.load.mockClear();
  mocks.save.mockClear();
});

describe('AI Design workspace session route', () => {
  it('requires authentication, origin, rate allowance, and project access', async () => {
    mocks.auth = null;
    expect((await GET(new NextRequest(`${url}?projectId=project-1&sessionId=session-1`))).status).toBe(401);
    mocks.auth = { userId: 'user-1' };
    mocks.origin = false;
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', state: {} }))).status).toBe(403);
    mocks.origin = true;
    mocks.allowed = false;
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', state: {} }))).status).toBe(429);
    mocks.allowed = true;
    mocks.access = null;
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', state: {} }))).status).toBe(404);
  });

  it('loads only an authorized project-scoped session', async () => {
    const response = await GET(new NextRequest(`${url}?projectId=project-1&sessionId=session-1`));
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith('user-1:project-1', 'project-1', 'session-1');
  });

  it('rejects body/session identity mismatch before storage', async () => {
    const response = await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', state: { projectId: 'project-2', session: { sessionId: 'session-1' } } }));
    expect(response.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates and compare-and-swap saves through separate operations', async () => {
    const state = { projectId: 'project-1', session: { sessionId: 'session-1' } };
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', state }))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith('user-1:project-1', state);
    expect((await POST(post({ operation: 'save', projectId: 'project-1', sessionId: 'session-1', expectedRevision: 4, state }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('user-1:project-1', state, 4);
  });
});
