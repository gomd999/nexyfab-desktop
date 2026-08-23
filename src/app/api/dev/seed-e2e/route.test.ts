import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  getDbAdapter: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: state.getDbAdapter }));
vi.mock('bcryptjs', () => ({ default: { hash: state.hash } }));

import { POST } from './route';

function request(seedKey = 'seed-key') {
  return new NextRequest('https://nexyfab.test/api/dev/seed-e2e', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-seed-key': seedKey },
    body: JSON.stringify({ email: 'e2e@example.test', password: 'password-123', plan: 'pro' }),
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('https://nexyfab.test/api/dev/seed-e2e', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-seed-key': 'seed-key', ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

beforeEach(() => {
  vi.stubEnv('DEV_SEED_KEY', 'seed-key');
  state.getDbAdapter.mockReset();
  state.hash.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/dev/seed-e2e environment boundary', () => {
  it('returns 404 in Railway production without touching bcrypt or the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(state.getDbAdapter).not.toHaveBeenCalled();
    expect(state.hash).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown deployment marker even with the correct key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'canary');

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(state.getDbAdapter).not.toHaveBeenCalled();
    expect(state.hash).not.toHaveBeenCalled();
  });

  it('continues to seed staging when the marker and key are correct', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging');
    const db = {
      execute: vi.fn().mockResolvedValue(undefined),
      queryOne: vi.fn().mockResolvedValue(null),
    };
    state.getDbAdapter.mockReturnValue(db);
    state.hash.mockResolvedValue('password-hash');

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, action: 'created', email: 'e2e@example.test' });
    expect(state.hash).toHaveBeenCalledWith('password-123', 12);
    expect(db.execute).toHaveBeenCalled();
  });

  it('keeps the environment/key gate ahead of bounded parsing and cancels authorized overflow before DB work', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    let productionCancelled = false;
    const productionBody = new ReadableStream<Uint8Array>({ cancel() { productionCancelled = true; } });
    expect((await POST(streamedRequest(productionBody, { 'content-length': '65537' }))).status).toBe(404);
    expect(productionCancelled).toBe(false);

    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging');
    let stagingCancelled = false;
    const stagingBody = new ReadableStream<Uint8Array>({ cancel() { stagingCancelled = true; } });
    expect((await POST(streamedRequest(stagingBody, { 'content-length': '65537' }))).status).toBe(413);
    expect(stagingCancelled).toBe(true);
    expect(state.getDbAdapter).not.toHaveBeenCalled();
    expect(state.hash).not.toHaveBeenCalled();
  });
});
