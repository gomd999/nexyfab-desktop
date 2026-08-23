import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  partner: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uploadPrivate: vi.fn(),
  download: vi.fn(),
  signedUrl: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }) }));
vi.mock('@/app/lib/errorLog', () => ({ logError: vi.fn() }));
vi.mock('@/lib/file-validation', () => ({
  validateUploadedFile: vi.fn().mockResolvedValue({ valid: true }),
  sanitizeFileName: (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_'),
  UPLOAD_CONFIGS: { image: {}, document: {} },
}));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    uploadPrivate: mocks.uploadPrivate,
    download: mocks.download,
    getSignedUrl: mocks.signedUrl,
    delete: mocks.delete,
  }),
}));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({ queryOne: mocks.queryOne, execute: mocks.execute }),
}));
vi.mock('@/lib/partner-auth', () => ({ getPartnerAuth: mocks.partner }));
vi.mock('@/lib/partner-factory-access', () => ({ normPartnerEmail: (value: string) => value.toLowerCase() }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/virus-scan', () => ({ scanBuffer: vi.fn().mockResolvedValue({ skipped: true, clean: true }) }));
vi.mock('@/lib/nexyfab-email', () => ({ getNexyfabAdminEmail: () => 'admin@example.com' }));

import { GET, POST } from './route';

const MAX_UPLOAD_MULTIPART_BODY_BYTES = 64 * 1024 * 1024;

const partner = { partnerId: 'partner-1', email: 'owner@example.com', company: 'Owner Co' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.partner.mockResolvedValue(partner);
  mocks.execute.mockResolvedValue({ changes: 1 });
  mocks.uploadPrivate.mockResolvedValue({
    key: 'private/contracts/C-1/random/part.step',
    url: '',
    size: 8,
  });
});

describe('partner contract attachment isolation', () => {
  it('does not reveal whether another partner contract exists', async () => {
    mocks.queryOne.mockResolvedValue(undefined);
    const response = await GET(new NextRequest('https://nexyfab.com/api/partner/upload?contractId=C-OTHER&id=ATT-1'));

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it('streams a private local attachment only after contract ownership lookup', async () => {
    mocks.queryOne.mockResolvedValue({
      attachments: JSON.stringify([{
        id: 'ATT-1',
        originalName: 'part.step',
        mimeType: 'application/step',
        storageKey: 'private/contracts/C-1/random/part.step',
      }]),
    });
    mocks.download.mockResolvedValue(Buffer.from('STEPDATA'));

    const response = await GET(new NextRequest('https://nexyfab.com/api/partner/upload?contractId=C-1&id=ATT-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.download).toHaveBeenCalledWith('private/contracts/C-1/random/part.step');
  });

  it('stores every new attachment privately and returns an authenticated route URL', async () => {
    mocks.queryOne.mockResolvedValue({ id: 'C-1', attachments: '[]' });
    const form = new FormData();
    form.set('contractId', 'C-1');
    form.set('file', new File([Buffer.from('STEPDATA')], 'part.step', { type: 'application/step' }));

    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/upload', { method: 'POST', body: form }));
    const body = await response.json() as { attachment: { url: string; storageKey: string } };

    expect(response.status).toBe(201);
    expect(mocks.uploadPrivate).toHaveBeenCalledWith(expect.any(Buffer), 'part.step', 'contracts/C-1');
    expect(body.attachment.storageKey).toMatch(/^private\//);
    expect(body.attachment.url).toMatch(/^\/api\/partner\/upload\?contractId=C-1&id=ATT-/);
  });

  it('cancels a declared oversized multipart body before DB or storage work', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_UPLOAD_MULTIPART_BODY_BYTES + 1) },
      body: stream,
      duplex: 'half',
    } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
  });

  it('preserves malformed multipart rejection without DB or storage work', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/upload', {
      method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: new Uint8Array([0xff]),
    }));
    expect(response.status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
  });
});
