import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('CAD release decision API', () => {
  it('rejects incomplete release inputs', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/release/decision', {
      method: 'POST', body: JSON.stringify({ workflowStatus: 'expert_approved' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });

  it('fails closed when a client claims final approval without evidence', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/release/decision', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'nexyfab.cad-deliverable-release-input.v2',
        workflowStatus: 'manufacturing_or_construction_approved',
        purpose: 'manufacturing_or_construction', domain: 'mechanical',
        revisionId: 'r-1', revisionSha256: 'a'.repeat(64), roundtrips: [],
      }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: false, quoteOrRfqSideEffects: false, decision: { status: 'blocked' } });
    expect(payload.decision.blockers).toEqual(expect.arrayContaining(['review:packet_missing', 'roundtrip:step:missing', 'roundtrip:bom:missing', 'roundtrip:drawing:missing']));
    expect(payload.decision.blockers).not.toContain('roundtrip:ifc:missing');
  });

  it('rejects legacy v1 release inputs at the API boundary', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/release/decision', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'nexyfab.cad-deliverable-release-input.v1',
        workflowStatus: 'manufacturing_or_construction_approved',
        purpose: 'manufacturing_or_construction', domain: 'mechanical',
        revisionId: 'r-legacy', revisionSha256: 'a'.repeat(64), roundtrips: [],
      }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
  });
});
