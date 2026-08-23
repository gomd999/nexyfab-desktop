import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('generation refine public request contract', () => {
  it('rejects caller-authored retry policy before any generation work', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/generation/refine', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `refine-contract-${Math.random()}` },
      body: JSON.stringify({
        state: { runId: 'run', revision: 0 },
        context: { request: 'PT100 skid', stage: 'intent', attempt: 1, priorOutputs: {}, priorCheckpointHashes: {}, feedback: [], immutableEvidenceRefs: [] },
        maxAttempts: 1,
      }),
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: 'INVALID_REFINEMENT_REQUEST' });
  });
});
