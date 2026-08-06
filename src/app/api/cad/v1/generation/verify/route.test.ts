import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('CAD v1 staged generation verification', () => {
  it('fails closed when downstream evidence has not been produced', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/generation/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        intent: { unresolved: [], conflicts: [] }, decomposition: { valid: true, independentPartCount: 1, errors: [] },
        parts: [{ instanceId: 'p1', manufacturingPassed: true, errors: [] }],
      }),
    }));
    const payload = await response.json();
    expect(payload.releaseReady).toBe(false);
    expect(payload.decision.stage).toBe('assembly_solve');
    expect(payload.quoteOrRfqSideEffects).toBe(false);
  });
});
