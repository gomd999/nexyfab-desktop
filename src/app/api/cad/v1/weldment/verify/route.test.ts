import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('CAD v1 weldment verify', () => {
  it('returns measured members and cut list mass without RFQ side effects', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/weldment/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: { sectionType: 0, sizeMm: 40, thicknessMm: 2, material: 'SS400', segments: [{ start: [0, 0, 0], end: [1000, 0, 0] }, { start: [1000, 0, 0], end: [1000, 500, 0] }], miter: true } }) }));
    const payload = await response.json();
    expect(payload.artifact.members).toHaveLength(2);
    expect(payload.artifact.totalStockMm).toBeGreaterThan(0);
    expect(payload.artifact.totalMassKg).toBeGreaterThan(0);
    expect(payload).toMatchObject({ releaseReady: false, releaseGate: { status: 'HOLD', releaseReady: false } });
    expect(payload.sideEffects).toEqual({ quoteCreated: false, rfqCreated: false });
  });
});
