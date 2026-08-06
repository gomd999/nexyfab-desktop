import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from './route';

const ifc = (guid = 'site', east = 1) => `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCSITE('${guid}',$,$,$,$,$,$,$,$,$,$,$,$,$);#2=IFCPROJECTEDCRS('EPSG:5179',$,$,$,$,$,$);#3=IFCMAPCONVERSION(#4,#2,${east}.,2.,0.,1.,0.,1.);ENDSEC;END-ISO-10303-21;`;
const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/ifc/semantic-roundtrip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('IFC semantic roundtrip route', () => {
  it('returns release evidence without echoing source', async () => {
    const response = await POST(request({ beforeIfc: ifc(), afterIfc: ifc() }));
    const json = await response.json();
    expect(response.status).toBe(200); expect(json).toMatchObject({ ok: true, releaseReady: true, sourceReturned: false, quoteOrRfqSideEffects: false });
    expect(JSON.stringify(json)).not.toContain('ISO-10303-21');
  });
  it('returns a fail-closed semantic verdict for changed identity and CRS transform', async () => {
    const response = await POST(request({ beforeIfc: ifc(), afterIfc: ifc('changed', 9) }));
    await expect(response.json()).resolves.toMatchObject({ ok: true, releaseReady: false, evidence: { passed: false, georeferencePreserved: false } });
  });
  it('rejects paths and undeclared fields', async () => {
    const response = await POST(request({ beforeIfc: ifc(), afterIfc: ifc(), path: 'C:\\secret.ifc' })); expect(response.status).toBe(400);
  });
});
