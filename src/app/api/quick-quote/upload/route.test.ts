import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authUser: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uploadPrivate: vi.fn(),
}));

vi.mock('@/lib/file-validation', () => ({
  validateUploadedFile: vi.fn().mockResolvedValue({ valid: true }),
  sanitizeFileName: (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_'),
}));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    uploadPrivate: mocks.uploadPrivate,
    delete: vi.fn(),
  }),
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.authUser }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({ queryOne: mocks.queryOne, execute: mocks.execute }),
}));
vi.mock('@/lib/rfq-partner-access', () => ({ getRfqAccessForUser: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/virus-scan', () => ({ scanBuffer: vi.fn().mockResolvedValue({ skipped: true, clean: true }) }));
vi.mock('@/lib/nexyfab-email', () => ({ getNexyfabAdminEmail: () => 'admin@example.com' }));

import { POST } from './route';

function requestWithClientGeometry() {
  const file = new File([Buffer.from('STEPDATA')], 'part.step', { type: 'application/step' });
  const form = new FormData();
  form.set('file', file);
  form.set('clientGeometries', JSON.stringify({
    'part.step': { volume_cm3: 10, surface_area_cm2: 20, bbox: { w: 30, h: 40, d: 50 } },
  }));
  return new NextRequest('https://nexyfab.com/api/quick-quote/upload', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authUser.mockResolvedValue(null);
  mocks.execute.mockResolvedValue({ changes: 1 });
  mocks.uploadPrivate.mockResolvedValue({ key: 'private/quick-quote/random/part.step', url: '', size: 8 });
});

describe('quick quote private upload policy', () => {
  it('analyzes an anonymous file without storing or exposing the original', async () => {
    const response = await POST(requestWithClientGeometry());
    const body = await response.json() as { fileUrl: string; fileUrls: string[]; savedFileIds?: string[] };

    expect(response.status).toBe(200);
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
    expect(body.fileUrl).toBe('');
    expect(body.fileUrls).toEqual([]);
    expect(body.savedFileIds).toBeUndefined();
  });

  it('stores authenticated uploads privately and exposes only the ACL download route', async () => {
    mocks.authUser.mockResolvedValue({ userId: 'user-1', email: 'user@example.com', role: 'user' });

    const response = await POST(requestWithClientGeometry());
    const body = await response.json() as { fileUrl: string; url: string; savedFileIds: string[] };

    expect(response.status).toBe(200);
    expect(mocks.uploadPrivate).toHaveBeenCalledWith(expect.any(Buffer), 'part.step', 'quick-quote');
    expect(body.savedFileIds).toHaveLength(1);
    expect(body.fileUrl).toBe(`/api/nexyfab/files/${body.savedFileIds[0]}/download`);
    expect(body.url).toBe(body.fileUrl);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO nf_files'),
      expect.any(String),
      'user-1',
      'private/quick-quote/random/part.step',
      'part.step',
      'application/step',
      8,
      'cad',
      null,
      null,
      expect.any(Number),
      null,
      expect.any(String),
      1,
      null,
    );
  });
});
