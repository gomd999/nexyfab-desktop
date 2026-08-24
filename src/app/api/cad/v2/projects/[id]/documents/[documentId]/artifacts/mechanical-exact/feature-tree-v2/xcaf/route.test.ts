import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), rate: vi.fn(), rateHeaders: vi.fn(),
  loadInspector: vi.fn(), read: vi.fn(), db: { backend: 'postgres' as const },
  inspector: { inspect: vi.fn() },
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => mocks.db }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: mocks.rate, rateLimitHeaders: mocks.rateHeaders,
}));
vi.mock('@/lib/occt/xcafHttpInspectionClient', () => ({
  loadXcafHttpInspectorFromEnvironment: mocks.loadInspector,
}));
vi.mock('@/app/[lang]/shape-generator/drawing/currentCanonicalMechanicalXcafV2Service', () => ({
  readCurrentCanonicalMechanicalXcafV2: mocks.read,
}));

import { dynamic, GET, maxDuration, runtime } from './route';

const URL = 'https://nexyfab.com/api/cad/v2/projects/project-1/documents/document-1/artifacts/mechanical-exact/feature-tree-v2/xcaf';
const request = () => new NextRequest(URL);
const context = () => ({ params: Promise.resolve({ id: 'project-1', documentId: 'document-1' }) });
const envelope = {
  schema: 'nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1',
  status: 'PASS_NATIVE_INVOCATION_BOUND',
  authority: 'SERVER_CURRENT_CANONICAL_HEAD',
  verification: 'XCAF_OCCURRENCE_IDENTITY_ONLY',
  geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
  release: 'HOLD',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ canEdit: false });
  mocks.rate.mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 });
  mocks.rateHeaders.mockReturnValue({ 'Retry-After': '1' });
  mocks.loadInspector.mockReturnValue({ ok: true, inspector: mocks.inspector });
  mocks.read.mockResolvedValue(envelope);
});

describe('current canonical FeatureTree v2 XCAF route', () => {
  it('uses configured worker evidence for only the authenticated v2 current head', async () => {
    const result = await GET(request(), context());
    expect({ runtime, dynamic, maxDuration }).toEqual({
      runtime: 'nodejs', dynamic: 'force-dynamic', maxDuration: 60,
    });
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    await expect(result.json()).resolves.toMatchObject({
      ok: true,
      status: 'PASS_NATIVE_INVOCATION_BOUND',
      geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
      release: 'HOLD',
      releaseReady: false,
      envelope,
    });
    expect(mocks.read).toHaveBeenCalledWith({
      db: mocks.db,
      projectId: 'project-1',
      documentId: 'document-1',
      inspector: mocks.inspector,
    });
  });

  it('fails before native work for auth, path, rate, access, and worker configuration failures', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(request(), context())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();

    expect((await GET(request(), {
      params: Promise.resolve({ id: '../bad', documentId: 'document-1' }),
    })).status).toBe(400);
    mocks.rate.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000 });
    expect((await GET(request(), context())).status).toBe(429);
    mocks.rate.mockResolvedValueOnce({
      allowed: false, unavailable: true, remaining: 0, resetAt: Date.now() + 1_000,
    });
    expect((await GET(request(), context())).status).toBe(503);
    mocks.rate.mockResolvedValueOnce({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 });
    mocks.access.mockResolvedValueOnce(null);
    expect((await GET(request(), context())).status).toBe(404);
    mocks.access.mockResolvedValueOnce({ canEdit: false });
    mocks.loadInspector.mockReturnValueOnce({ ok: false, reason: 'XCAF_SERVICE_CONFIG_HOLD' });
    expect((await GET(request(), context())).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('does not expose worker, database, geometry, or rights blocker details', async () => {
    mocks.read.mockResolvedValueOnce({
      schema: envelope.schema,
      status: 'HOLD',
      release: 'HOLD',
      blockers: ['CURRENT_XCAF_V2_SERVICE_HOLD'],
    });
    const held = await GET(request(), context());
    expect(held.status).toBe(422);
    await expect(held.json()).resolves.toEqual({
      ok: false,
      status: 'HOLD',
      code: 'CURRENT_CANONICAL_XCAF_V2_HOLD',
      release: 'HOLD',
    });
  });
});
