import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getAuthUser } from './lib/auth-middleware';
import { proxy } from './proxy';

vi.mock('./lib/auth-middleware', () => ({ getAuthUser: vi.fn() }));

const TEST_SECRET = process.env.JWT_SECRET ?? 'nexyfab-dev-secret-change-in-production';

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(emailVerified: boolean): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: 'cad-test-user',
    email: 'cad@example.test',
    plan: 'pro',
    emailVerified,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = createHmac('sha256', TEST_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function request(
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
): NextRequest {
  return new NextRequest(`https://nexyfab.test${path}`, init);
}

const EXPECTED_WRITE_SCOPE_PATHS = [
  '/api/cad/v1/feature-tree-mesh',
  '/api/cad/v1/part-step',
  '/api/cad/v1/ifc/recover-geometry',
  '/api/cad/v1/assembly/animation/command',
  '/api/cad/v1/brep/push-pull',
  '/api/cad/v1/architecture/daylight/package',
  '/api/cad/v1/architecture/daylight/status',
  '/api/cad/v1/architecture/interior/edit',
  '/api/cad/v1/architecture/service-openings/sync',
  '/api/cad/v1/generation/refine',
  '/api/cad/v1/generation/state',
  '/api/cad/v1/generation/advance',
  '/api/cad/v1/generation/finalize',
  '/api/cad/v1/generation/commercial-receipts/requests',
  '/api/cad/v1/interior/layout/edit',
  '/api/cad/v1/robot/integration/apply',
  '/api/cad/v1/robot/generate',
  '/api/cad/v1/robot/release/work-packet',
  '/api/cad/v1/spatial/command',
] as const;

describe('CAD v1 active proxy security boundary', () => {
  beforeEach(() => {
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: 'cad-test-user', email: 'cad@example.test', plan: 'pro',
      globalRole: 'user', roles: [], orgIds: [], emailVerified: false,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects unauthenticated CAD compute', async () => {
    const response = await proxy(request('/api/cad/v1/part-step', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('keeps only GET capability discovery public', async () => {
    const publicResponse = await proxy(request('/api/cad/v1/capabilities'));
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('x-middleware-next')).toBe('1');

    const trailingSlashResponse = await proxy(request('/api/cad/v1/capabilities/'));
    expect(trailingSlashResponse.status).toBe(200);
    expect(trailingSlashResponse.headers.get('x-middleware-next')).toBe('1');

    const alternateMethod = await proxy(
      request('/api/cad/v1/capabilities', { method: 'POST' }),
    );
    expect(alternateMethod.status).toBe(401);
  });

  it('preserves CAD access for an existing unverified Closed Beta account', async () => {
    const response = await proxy(
      request('/api/cad/v1/generation/finalize', {
        method: 'POST',
        headers: { authorization: `Bearer ${token(false)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('cad-test-user');
  });

  it('forwards verified identity to the route handler', async () => {
    const response = await proxy(
      request('/api/cad/v1/generation/finalize', {
        method: 'POST',
        headers: { authorization: `Bearer ${token(true)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('cad-test-user');
    expect(response.headers.get('x-middleware-request-x-cad-request-id')).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(response.headers.get('x-ratelimit-limit')).toBe('60');
    expect(response.headers.get('authorization')).toBeNull();
  });

  it('accepts an account-backed API key and forwards only its non-secret id', async () => {
    vi.mocked(getAuthUser).mockResolvedValueOnce({
      userId: 'api-key-user', email: 'key@example.test', plan: 'pro',
      globalRole: 'user', roles: [], orgIds: [], emailVerified: true,
      apiKey: { id: 'ak-safe-id', scopes: ['read:projects'] },
    });
    const rawKey = `nf_live_${'a'.repeat(64)}`;
    const response = await proxy(request('/api/cad/v1/system/verify', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('api-key-user');
    expect(response.headers.get('x-middleware-request-x-api-key-id')).toBe('ak-safe-id');
    expect(JSON.stringify([...response.headers])).not.toContain(rawKey);
  });

  it('enforces read/write API-key scopes at the active CAD proxy boundary', async () => {
    const rawKey = `nf_live_${'b'.repeat(64)}`;
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: 'read-key-user', email: 'read@example.test', plan: 'pro',
      globalRole: 'user', roles: [], orgIds: [], emailVerified: true,
      apiKey: { id: 'ak-read-only', scopes: ['read:projects'] },
    });

    const readable = await proxy(request('/api/cad/v1/system/verify', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(readable.status).toBe(200);

    const exportDenied = await proxy(request('/api/cad/v1/part-step', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(exportDenied.status).toBe(403);
    expect(await exportDenied.json()).toMatchObject({
      code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'write:projects',
    });

    const durableAdvanceDenied = await proxy(request('/api/cad/v1/generation/advance', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(durableAdvanceDenied.status).toBe(403);

    const refinementDenied = await proxy(request('/api/cad/v1/generation/refine', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(refinementDenied.status).toBe(403);

    const heldReceiptRequestDenied = await proxy(request('/api/cad/v1/generation/commercial-receipts/requests', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(heldReceiptRequestDenied.status).toBe(403);
    expect(await heldReceiptRequestDenied.json()).toMatchObject({
      code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'write:projects',
    });

    vi.mocked(getAuthUser).mockResolvedValue({
      userId: 'write-key-user', email: 'write@example.test', plan: 'pro',
      globalRole: 'user', roles: [], orgIds: [], emailVerified: true,
      apiKey: { id: 'ak-write', scopes: ['write:projects'] },
    });
    const exportAllowed = await proxy(request('/api/cad/v1/part-step', {
      method: 'POST', headers: { authorization: `Bearer ${rawKey}` },
    }));
    expect(exportAllowed.status).toBe(200);
  });

  it('keeps the complete CAD write-scope path set fail-closed for a read-only key', async () => {
    const rawKey = `nf_live_${'c'.repeat(64)}`;
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: 'read-key-user', email: 'read@example.test', plan: 'pro',
      globalRole: 'user', roles: [], orgIds: [], emailVerified: true,
      apiKey: { id: 'ak-read-only', scopes: ['read:projects'] },
    });

    for (const path of EXPECTED_WRITE_SCOPE_PATHS) {
      const method = path.endsWith('/daylight/status') ? 'GET' : 'POST';
      const response = await proxy(request(path, {
        method,
        headers: { authorization: `Bearer ${rawKey}` },
      }));
      expect(response.status, path).toBe(403);
      expect(await response.json(), path).toMatchObject({
        code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'write:projects',
      });
    }
  });

  it('rejects a credential that the account-backed verifier does not accept', async () => {
    vi.mocked(getAuthUser).mockResolvedValueOnce(null);
    const response = await proxy(request('/api/cad/v1/system/verify', {
      method: 'POST', headers: { authorization: 'Bearer invalid' },
    }));
    expect(response.status).toBe(401);
  });

  it('fails closed when commercial mode lacks distributed quota storage', async () => {
    vi.stubEnv('NEXYFAB_CAD_INDEPENDENT_MODE', '1');
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const response = await proxy(
      request('/api/cad/v1/part-step', {
        method: 'POST',
        headers: { authorization: `Bearer ${token(true)}` },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'CAD_QUOTA_UNAVAILABLE' });
  });
});
