import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('internal external-verifier callback API', () => {
  it('fails closed without internal authorization and never exposes a public callback', async () => {
    vi.stubEnv('NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET', '');
    const response = await POST(new Request('http://localhost/api/internal/commercial-verifier/callback', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }) as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'INTERNAL_VERIFIER_UNAUTHORIZED', status: 'HOLD' });
  });
});
