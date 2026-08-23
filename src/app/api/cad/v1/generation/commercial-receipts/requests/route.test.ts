import { describe, expect, it } from 'vitest';
import { POST } from './route';

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) { return new Request('http://localhost/api/cad/v1/generation/commercial-receipts/requests', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
const base = { receiptId: 'receipt-1', projectId: 'project-1', revision: 1, modelContentHash: 'a'.repeat(64), evidenceIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] };

describe('public commercial verification request API', () => {
  it('never accepts caller registry, clock, mode, verifier URL, or raw evidence', async () => {
    const response = await POST(request({ ...base, registry: [] }) as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'PUBLIC_VERIFIER_INPUT_REJECTED', status: 'HOLD' });
  });

  it('requires stored IDs and binding metadata before authentication/work', async () => {
    const response = await POST(request({ receiptId: 'receipt-1', projectId: 'project-1', evidenceIds: [] }) as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'STORED_BINDING_AND_EVIDENCE_IDS_REQUIRED' });
  });
});
