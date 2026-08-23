import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authUser: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uploadPrivate: vi.fn(),
  guestQuota: vi.fn(),
  visionCompletion: vi.fn(),
  studioAiGuard: vi.fn(),
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
vi.mock('@/lib/ai/engineeringChatGuestQuota', () => ({
  GUEST_ENGINEERING_CHAT_DAILY_LIMIT: 3,
  consumeEngineeringChatGuestQuota: mocks.guestQuota,
}));
vi.mock('@/lib/ai/vision', () => ({ visionCompletion: mocks.visionCompletion }));
vi.mock('@/lib/studio-ai-guard', () => ({ guardStudioAi: mocks.studioAiGuard }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/virus-scan', () => ({ scanBuffer: vi.fn().mockResolvedValue({ skipped: true, clean: true }) }));
vi.mock('@/lib/nexyfab-email', () => ({ getNexyfabAdminEmail: () => 'admin@example.com' }));

import { POST } from './route';

const MAX_AUTHENTICATED_MULTIPART_BODY_BYTES = 64 * 1024 * 1024;

function requestWithClientGeometry(geometry = { volume_cm3: 10, surface_area_cm2: 20, bbox: { w: 30, h: 40, d: 50 } }) {
  const file = new File([Buffer.from('STEPDATA')], 'part.step', { type: 'application/step' });
  const form = new FormData();
  form.set('file', file);
  form.set('clientGeometries', JSON.stringify({
    'part.step': geometry,
  }));
  return new NextRequest('https://nexyfab.com/api/quick-quote/upload', { method: 'POST', body: form });
}

function requestWithImage() {
  const file = new File([Buffer.from('PNGDATA')], 'part.png', { type: 'image/png' });
  const form = new FormData();
  form.set('file', file);
  return new NextRequest('https://nexyfab.com/api/quick-quote/upload', { method: 'POST', body: form });
}

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('https://nexyfab.com/api/quick-quote/upload', {
    method: 'POST', body, headers: { 'content-type': 'multipart/form-data; boundary=test', ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authUser.mockResolvedValue(null);
  mocks.guestQuota.mockResolvedValue({ allowed: true, remaining: 2, resetAt: Date.now() + 60_000 });
  mocks.visionCompletion.mockResolvedValue({ text: '{"part_type":"bracket","process":"cnc","complexity":5,"features":[],"materials":[]}' });
  mocks.studioAiGuard.mockResolvedValue(null);
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

  it('rejects oversized client geometry before processing', async () => {
    const response = await POST(requestWithClientGeometry({
      volume_cm3: 1_000_000_001,
      surface_area_cm2: 20,
      bbox: { w: 30, h: 40, d: 50 },
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'part.step: invalid or oversized geometry' });
  });

  it('blocks anonymous paid vision before calling the provider when the shared guest budget is spent', async () => {
    mocks.guestQuota.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1_234 });

    const response = await POST(requestWithImage());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ code: 'GUEST_CHAT_QUOTA', limit: 3, resetAtMs: 1_234 });
    expect(mocks.guestQuota).toHaveBeenCalledOnce();
    expect(mocks.studioAiGuard).toHaveBeenCalledOnce();
    expect(mocks.visionCompletion).not.toHaveBeenCalled();
  });

  it('uses the shared guest budget before anonymous vision when allowed', async () => {
    const response = await POST(requestWithImage());

    expect(response.status).toBe(200);
    expect(mocks.guestQuota).toHaveBeenCalledOnce();
    expect(mocks.studioAiGuard).toHaveBeenCalledOnce();
    expect(mocks.visionCompletion).toHaveBeenCalledOnce();
  });

  it('does not apply the guest quota to authenticated vision uploads', async () => {
    mocks.authUser.mockResolvedValue({ userId: 'user-1', email: 'user@example.com', role: 'user' });
    mocks.guestQuota.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1_234 });

    const response = await POST(requestWithImage());

    expect(response.status).toBe(200);
    expect(mocks.guestQuota).not.toHaveBeenCalled();
    expect(mocks.studioAiGuard).toHaveBeenCalledOnce();
    expect(mocks.visionCompletion).toHaveBeenCalledOnce();
  });

  it('cancels declared and measured oversized anonymous uploads before storage or vision', async () => {
    let declaredCancelled = false;
    const declared = new ReadableStream<Uint8Array>({ cancel() { declaredCancelled = true; } });
    const declaredResponse = await POST(streamedRequest(declared, { 'content-length': String(51 * 1024 * 1024 + 1) }));
    expect(declaredResponse.status).toBe(413);
    expect(declaredCancelled).toBe(true);

    let measuredCancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const measured = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x2d]));
        for (let i = 0; i < 51; i++) controller.enqueue(chunk);
      },
      cancel() { measuredCancelled = true; },
    });
    const measuredResponse = await POST(streamedRequest(measured, { 'content-length': '1' }));
    expect(measuredResponse.status).toBe(413);
    expect(measuredCancelled).toBe(true);
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
    expect(mocks.visionCompletion).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('aligns authenticated aggregate uploads with the 64 MiB proxy ceiling', async () => {
    mocks.authUser.mockResolvedValue({ userId: 'user-1', email: 'user@example.com', role: 'user' });
    let cancelled = false;
    const response = await POST(streamedRequest(
      new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
      { 'content-length': String(MAX_AUTHENTICATED_MULTIPART_BODY_BYTES + 1) },
    ));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
  });

  it('preserves the malformed multipart failure contract without storage mutation', async () => {
    const response = await POST(streamedRequest(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.close(); },
    }), {}));
    expect(response.status).toBe(500);
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
