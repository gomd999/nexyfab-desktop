import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));

describe('feature-tree mesh bounded JSON ingress', () => {
  it('rejects declared input beyond the feature-tree geometry envelope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/feature-tree-mesh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(16 * 1024 * 1024 + 1) },
      body: '{}',
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('preserves the handler BAD_REQUEST response for malformed JSON', async () => {
    const response = await POST(new NextRequest('http://localhost/api/feature-tree-mesh', { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });
});
