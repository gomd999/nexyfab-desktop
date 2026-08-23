import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('stored commercial receipt API', () => {
  it('rejects caller trust/clock/mode and raw evidence controls', async () => {
    const response = await POST(new Request('http://localhost/api/cad/v1/generation/commercial-receipts', { method: 'POST', body: JSON.stringify({ receiptId: 'r1', projectId: 'p1', evidenceIds: ['e1'], registry: [] }), headers: { 'content-type': 'application/json' } }) as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'CALLER_TRUST_CLOCK_MODE_REJECTED', status: 'HOLD' });
  });

});
