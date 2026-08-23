import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/studio-ai-guard', () => ({ guardStudioAi: vi.fn(async () => null) }));

describe('product decomposition bounded JSON ingress', () => {
  it('rejects declared input beyond the prompt envelope before AI work', async () => {
    const response = await POST(new NextRequest('http://localhost/api/product-decomposition?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE', outputLanguage: 'en' });
  });

  it('preserves BAD_REQUEST for malformed JSON', async () => {
    const response = await POST(new NextRequest('http://localhost/api/product-decomposition?lang=en', { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST', outputLanguage: 'en' });
  });
});
