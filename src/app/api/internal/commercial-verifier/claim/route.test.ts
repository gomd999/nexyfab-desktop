import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('internal external-verifier claim API', () => {
  it('fails closed when the private worker secret is absent', async () => {
    vi.stubEnv('NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET', '');
    const response = await POST(new Request('http://localhost/api/internal/commercial-verifier/claim', { method: 'POST', body: JSON.stringify({ requestId: 'request-1' }), headers: { 'content-type': 'application/json' } }) as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'INTERNAL_VERIFIER_UNAUTHORIZED', status: 'HOLD' });
  });
});
