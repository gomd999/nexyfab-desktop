import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

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

describe('CAD v1 active proxy security boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

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
