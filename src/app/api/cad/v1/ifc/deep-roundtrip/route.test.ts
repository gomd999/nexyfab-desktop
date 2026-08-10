import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from './route';

const completeIfc = () => `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));#2=IFCAXIS2PLACEMENT3D(#1,$,$);#3=IFCLOCALPLACEMENT($,#2);
#10=IFCPROJECT('project',$,$,$,$,$,$,$,$);#11=IFCSITE('site',$,$,$,$,#3,$,$,$,$,$,$,$,$);#12=IFCWALL('wall',$,$,$,$,#3,$,$,$);
#13=IFCRELAGGREGATES('aggregate',$,$,$,#10,(#11));#14=IFCRELCONTAINEDINSPATIALSTRUCTURE('contain',$,$,$,(#12),#11);
#20=IFCPROPERTYSINGLEVALUE('Status',$,IFCLABEL('Approved'),$);#21=IFCPROPERTYSET('pset',$,'Pset_Wall',$,(#20));#22=IFCRELDEFINESBYPROPERTIES('pr',$,$,$,(#12),#21);
#30=IFCQUANTITYAREA('Area',$,$,10.);#31=IFCELEMENTQUANTITY('qset',$,'BaseQuantities',$,$,(#30));#32=IFCRELDEFINESBYPROPERTIES('qr',$,$,$,(#12),#31);
#40=IFCCLASSIFICATION('LH','1',$,'WBS',$,$,$);#41=IFCCLASSIFICATIONREFERENCE($,'A1','Earthwork',#40);#42=IFCRELASSOCIATESCLASSIFICATION('cr',$,$,$,(#12),#41);
#50=IFCPROJECTEDCRS('EPSG:5186',$,$,$,$,$,$);#51=IFCMAPCONVERSION(#52,#50,1.,2.,0.,1.,0.,1.);ENDSEC;END-ISO-10303-21;`;
const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/ifc/deep-roundtrip', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${Math.floor(Math.random() * 200) + 1}` }, body: JSON.stringify(body),
});

describe('IFC deep semantic roundtrip route', () => {
  it('returns strict release evidence without echoing IFC source', async () => {
    const response = await POST(request({ beforeIfc: completeIfc(), afterIfc: completeIfc() }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true, releaseReady: true, sourceReturned: false, sideEffects: false });
    expect(JSON.stringify(json)).not.toContain('ISO-10303-21');
  });

  it('blocks changed property values', async () => {
    const response = await POST(request({ beforeIfc: completeIfc(), afterIfc: completeIfc().replace("'Approved'", "'Draft'") }));
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, evidence: { errors: expect.arrayContaining(['PROPERTY_SET_CHANGED']) } });
  });

  it('does not permit clients to weaken the release profile or submit file paths', async () => {
    const response = await POST(request({ beforeIfc: completeIfc(), afterIfc: completeIfc(), requirements: { propertySets: false }, path: 'C:\\secret.ifc' }));
    expect(response.status).toBe(400);
  });
});
