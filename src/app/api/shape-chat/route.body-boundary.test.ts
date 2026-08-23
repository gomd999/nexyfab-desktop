import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/cost-breaker', () => ({ getActiveBreaker: vi.fn(async () => false) }));

describe('shape-chat bounded JSON ingress', () => {
  it('rejects declared input beyond the prompt/history/context envelope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/shape-chat?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', outputLanguage: 'en' });
  });
});
