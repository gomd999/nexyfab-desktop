import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('CAD v1 manufacturing verify', () => {
  it('fails closed without evidence and performs no external side effect', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/manufacturing/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    const payload = await response.json();
    expect(payload.report.gates.every((gate: { status: string }) => gate.status === 'not_run')).toBe(true);
    expect(payload.designOk).toBe(false);
    expect(payload.sideEffects).toEqual({ quoteCreated: false, rfqCreated: false, artifactReleased: false });
  });
});
