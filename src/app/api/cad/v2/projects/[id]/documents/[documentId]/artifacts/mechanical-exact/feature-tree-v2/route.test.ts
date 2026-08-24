import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), rate: vi.fn(), rateHeaders: vi.fn(),
  build: vi.fn(), db: { backend: 'postgres' as const },
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => mocks.db }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: mocks.rate,
  rateLimitHeaders: mocks.rateHeaders,
}));
vi.mock('@/app/[lang]/shape-generator/drawing/currentCanonicalMechanicalBundleV2', () => ({
  buildCurrentCanonicalMechanicalArtifactBundleV2: mocks.build,
}));

import { dynamic, GET, maxDuration, runtime } from './route';

const URL = 'https://nexyfab.com/api/cad/v2/projects/project-1/documents/document-1/artifacts/mechanical-exact/feature-tree-v2';
const request = () => new NextRequest(URL);
const context = () => ({ params: Promise.resolve({ id: 'project-1', documentId: 'document-1' }) });
const bundle = {
  schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2',
  status: 'EXACT_BUNDLE_V2_PASS',
  authority: 'SERVER_CURRENT_CANONICAL_HEAD',
  verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR',
  release: 'HOLD',
  manufacturingRelease: 'BLOCKED',
  artifactManifestSha256: 'a'.repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ canEdit: false });
  mocks.rate.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  mocks.rateHeaders.mockReturnValue({ 'Retry-After': '1' });
  mocks.build.mockResolvedValue(bundle);
});

describe('current canonical FeatureTree v2 exact artifact route', () => {
  it('awaits current Next params and returns a private release-HOLD v2 bundle', async () => {
    let awaited = false;
    const result = await GET(request(), {
      params: Promise.resolve().then(() => {
        awaited = true;
        return { id: 'project-1', documentId: 'document-1' };
      }),
    });
    expect({ runtime, dynamic, maxDuration }).toEqual({
      runtime: 'nodejs', dynamic: 'force-dynamic', maxDuration: 60,
    });
    expect(awaited).toBe(true);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    await expect(result.json()).resolves.toMatchObject({
      ok: true,
      status: 'EXACT_BUNDLE_V2_PASS',
      release: 'HOLD',
      releaseReady: false,
      manufacturingRelease: 'BLOCKED',
      bundle,
    });
    expect(mocks.build).toHaveBeenCalledWith({
      db: mocks.db, projectId: 'project-1', documentId: 'document-1',
    });
  });

  it('authenticates, validates ids, rate-limits, and hides inaccessible projects before OCCT', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(request(), context())).status).toBe(401);
    expect(mocks.build).not.toHaveBeenCalled();

    expect((await GET(request(), {
      params: Promise.resolve({ id: '../project', documentId: 'document-1' }),
    })).status).toBe(400);
    expect(mocks.access).not.toHaveBeenCalled();

    mocks.rate.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000 });
    expect((await GET(request(), context())).status).toBe(429);
    expect(mocks.build).not.toHaveBeenCalled();

    mocks.rate.mockResolvedValueOnce({
      allowed: false, remaining: 0, resetAt: Date.now() + 1_000, unavailable: true,
    });
    expect((await GET(request(), context())).status).toBe(503);
    expect(mocks.build).not.toHaveBeenCalled();

    mocks.rate.mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
    mocks.access.mockResolvedValueOnce(null);
    expect((await GET(request(), context())).status).toBe(404);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it('maps HOLD categories without exposing database, geometry, or rights details', async () => {
    mocks.build.mockResolvedValueOnce({
      status: 'HOLD',
      blockers: ['CURRENT_HEAD_MIGRATION_REQUIRED', 'secret native detail'],
      release: 'HOLD',
      manufacturingRelease: 'BLOCKED',
    });
    const unavailable = await GET(request(), context());
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      ok: false,
      status: 'HOLD',
      code: 'MECHANICAL_ARTIFACT_BUNDLE_V2_HOLD',
      release: 'HOLD',
      releaseReady: false,
    });

    mocks.build.mockResolvedValueOnce({
      status: 'HOLD',
      blockers: ['RIGHTS_PROVENANCE_MISMATCH'],
      release: 'HOLD',
      manufacturingRelease: 'BLOCKED',
    });
    const held = await GET(request(), context());
    expect(held.status).toBe(422);
    expect(JSON.stringify(await held.json())).not.toContain('RIGHTS_PROVENANCE_MISMATCH');
  });
});
