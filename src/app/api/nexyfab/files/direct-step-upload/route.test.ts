import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createPrivateUploadUrl: vi.fn(), stat: vi.fn(), deleteObject: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => ({ userId: 'u1', plan: 'pro' })) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({
  createPrivateUploadUrl: mocks.createPrivateUploadUrl,
  stat: mocks.stat,
  delete: mocks.deleteObject,
}) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ queryOne: mocks.queryOne, execute: mocks.execute }) }));

import { POST } from './route';

const MB = 1024 * 1024;
function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/nexyfab/files/direct-step-upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('direct large STEP upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPrivateUploadUrl.mockResolvedValue({
      key: 'private/files/u1/id/loader.step', uploadUrl: 'https://r2.example/put?sig=short',
    });
    mocks.stat.mockResolvedValue({ size: 417 * MB });
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.queryOne.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue(undefined);
  });

  it('issues a five-minute private PUT without receiving source bytes', async () => {
    const response = await POST(request({ action: 'intent', filename: 'loader.step', sizeBytes: 417 * MB }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ method: 'PUT', expiresInSeconds: 300, contentType: 'application/step' });
    expect(mocks.createPrivateUploadUrl).toHaveBeenCalledWith('loader.step', 'files/u1', 'application/step', 300);
  });

  it('verifies authoritative object size before inserting metadata', async () => {
    mocks.stat.mockResolvedValue({ size: 416 * MB });
    const response = await POST(request({
      action: 'complete', filename: 'loader.step', sizeBytes: 417 * MB,
      key: 'private/files/u1/id/loader.step',
    }));
    expect(response.status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.deleteObject).toHaveBeenCalledWith('private/files/u1/id/loader.step');
  });

  it('commits a new immutable CAD file record only after size and ownership match', async () => {
    const response = await POST(request({
      action: 'complete', filename: 'loader.step', sizeBytes: 417 * MB,
      key: 'private/files/u1/id/loader.step',
    }));
    expect(response.status).toBe(201);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const args = mocks.execute.mock.calls[0];
    expect(args?.[0]).toContain('INSERT INTO nf_files');
    expect(args).toContain('private/files/u1/id/loader.step');
    expect(args).toContain(417 * MB);
  });
});
