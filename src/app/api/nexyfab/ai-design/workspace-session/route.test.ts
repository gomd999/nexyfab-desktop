import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1' } as { userId: string } | null,
  access: { role: 'owner', canEdit: true } as { role: string; canEdit: boolean } | null,
  origin: true,
  allowed: true,
  create: vi.fn(async (_owner: string, state: unknown) => state),
  load: vi.fn(async () => ({ projectId: 'project-1', session: { sessionId: 'session-1' } })),
  make: vi.fn(() => ({ ok: true, state: { projectId: 'project-1', session: { sessionId: 'session-1' } } })),
  sourceBinding: vi.fn(async () => true),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => mocks.origin) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: mocks.allowed })) }));
vi.mock('@/lib/ai/aiDesignWorkspaceRuntimeStore', () => ({
  createServerAiDesignWorkspaceRuntime: mocks.create,
  loadServerAiDesignWorkspaceRuntime: mocks.load,
}));
vi.mock('@/lib/ai/aiDesignWorkspaceRuntime', () => ({ createAiDesignWorkspaceRuntime: mocks.make }));
vi.mock('@/lib/ai/aiDesignSourceArtifactStore', () => ({ verifyAiDesignSourceBinding: mocks.sourceBinding }));

import { GET, POST } from './route';

const url = 'http://localhost/api/nexyfab/ai-design/workspace-session';
const post = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.auth = { userId: 'user-1' };
  mocks.access = { role: 'owner', canEdit: true };
  mocks.origin = true;
  mocks.allowed = true;
  mocks.create.mockClear();
  mocks.load.mockClear();
  mocks.make.mockClear();
  mocks.sourceBinding.mockClear();
  mocks.sourceBinding.mockResolvedValue(true);
});

describe('AI Design workspace session route', () => {
  it('requires authentication, origin, rate allowance, and project access', async () => {
    mocks.auth = null;
    expect((await GET(new NextRequest(`${url}?projectId=project-1&sessionId=session-1`))).status).toBe(401);
    mocks.auth = { userId: 'user-1' };
    mocks.origin = false;
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: [{}] }))).status).toBe(403);
    mocks.origin = true;
    mocks.allowed = false;
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: [{}] }))).status).toBe(429);
    mocks.allowed = true;
    mocks.access = null;
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: [{}] }))).status).toBe(404);
  });

  it('loads only an authorized project-scoped session', async () => {
    const response = await GET(new NextRequest(`${url}?projectId=project-1&sessionId=session-1`));
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith('user-1:project-1', 'project-1', 'session-1');
  });

  it('rejects client-authored runtime snapshots and legacy save operations', async () => {
    const response = await POST(post({ operation: 'save', projectId: 'project-1', sessionId: 'session-1', expectedRevision: 4, state: { workflow: { status: 'VERIFIED' } } }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates only from server-validated intake inputs', async () => {
    const request = { operation: 'create', projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: [{ kind: 'text' }] };
    expect((await POST(post(request))).status).toBe(201);
    expect(mocks.make).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: request.inputs }));
    expect(mocks.create).toHaveBeenCalledWith('user-1:project-1', { projectId: 'project-1', session: { sessionId: 'session-1' } });
  });

  it('requires a matching private server artifact for raster inputs', async () => {
    const raster = { kind: 'drawing_2d', sourceId: 'ai-source:1', sourceHash: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 100 };
    mocks.sourceBinding.mockResolvedValueOnce(false);
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: [raster] }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.sourceBinding.mockResolvedValueOnce(true);
    expect((await POST(post({ operation: 'create', projectId: 'project-1', sessionId: 'session-1', revisionToken: 'rev-0', inputs: [raster] }))).status).toBe(201);
    expect(mocks.sourceBinding).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ artifactId: 'ai-source:1', sessionId: 'session-1' }));
  });
});
