import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('CAD v1 sheet metal verify', () => {
  it('returns measured flat pattern, bend table and DXF without RFQ side effects', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/sheet-metal/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: { thicknessMm: 1.5, material: 'mildSteel', baseWidthMm: 100, baseLengthMm: 200, ops: [{ kind: 'bend', angle: 90, radius: 2, position: 0.5 }] } }) }));
    const payload = await response.json();
    expect(payload.artifact.developedLengthMm).toBeGreaterThan(0);
    expect(payload.artifact.bendTable).toHaveLength(1);
    expect(payload.artifact.dxf).toContain('BEND');
    expect(payload.sideEffects).toEqual({ quoteCreated: false, rfqCreated: false });
  });
});
