import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SPATIAL_CAD_COMMAND_SCHEMA, createSpatialCadDocument } from '@/lib/cad/spatialCadCommand';
import { POST } from './route';

const url = 'https://nexyfab.com/api/cad/v1/spatial/command/';

describe('spatial semantic command API', () => {
  it('replays the typed command but reports persistence and release checks as NOT_RUN', async () => {
    const document = createSpatialCadDocument('civil', { lengthM: 120, epsg: 0 });
    const response = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document, command: { schema: SPATIAL_CAD_COMMAND_SCHEMA, commandId: 'civil-length-1', domain: 'civil', baseRevision: 0, actor: 'human', operation: { kind: 'set_parameter', key: 'lengthM', value: 135 } } }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, transaction: { document: { revision: 1, parameters: { lengthM: 135 } } }, persistence: 'NOT_RUN', releaseVerification: 'NOT_RUN' });
  });

  it('returns a conflict for stale revision replay', async () => {
    const document = createSpatialCadDocument('landscape', { widthM: 30 });
    const response = await POST(new NextRequest(url, {
      method: 'POST', body: JSON.stringify({ document, command: { schema: SPATIAL_CAD_COMMAND_SCHEMA, commandId: 'stale-1', domain: 'landscape', baseRevision: 2, actor: 'human', operation: { kind: 'set_parameter', key: 'widthM', value: 35 } } }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, transaction: { issues: ['stale_base_revision'] }, persistence: 'NOT_RUN' });
  });

  it('preserves byte-cap and invalid JSON codes for streamed input', async () => {
    const oversized = await POST(new NextRequest(url, { method: 'POST', headers: { 'content-length': String(256 * 1024 + 1) }, body: '{}' }));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
    const invalidUtf8 = await POST(new NextRequest(url, { method: 'POST', body: new Uint8Array([0xff]) }));
    expect(invalidUtf8.status).toBe(400);
    await expect(invalidUtf8.json()).resolves.toEqual({ ok: false, code: 'INVALID_JSON' });
  });
});
