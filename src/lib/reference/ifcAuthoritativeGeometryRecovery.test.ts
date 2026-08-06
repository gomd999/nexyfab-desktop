import { describe, expect, it } from 'vitest';
import { recoverIfcGeometryWithAuthoritativeInputs } from './ifcAuthoritativeGeometryRecovery';

const guid = '0DAlDmbNb6ZhcaPbmdsMGX';
const wrap = (body: string) => `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;DATA;#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);#2=IFCCARTESIANPOINT((0.,0.,0.));#3=IFCAXIS2PLACEMENT3D(#2,$,$);#4=IFCLOCALPLACEMENT($,#3);${body}ENDSEC;END-ISO-10303-21;`;
const railing = wrap(`#10=IFCCARTESIANPOINT((0.,0.,0.));#11=IFCCARTESIANPOINT((0.,1000.,0.));#12=IFCCARTESIANPOINT((0.,1000.,900.));#13=IFCPOLYLOOP((#10,#11,#12));#14=IFCFACEOUTERBOUND(#13,.T.);#15=IFCFACE((#14));#16=IFCOPENSHELL((#15));#17=IFCSHELLBASEDSURFACEMODEL((#16));#18=IFCSHAPEREPRESENTATION($,'Body','SurfaceModel',(#17));#19=IFCPRODUCTDEFINITIONSHAPE($,$,(#18));#20=IFCRAILING('${guid}',$,'R',$,$,#4,#19,$,.NOTDEFINED.);`);

describe('authoritative IFC geometry recovery', () => {
  it('applies a width only to its requested occurrence and records evidence', () => {
    const result = recoverIfcGeometryWithAuthoritativeInputs(railing, [{ globalId: guid, physicalWidthMm: 50, provenance: 'operator measurement drawing A-12' }]);
    expect(result).toMatchObject({ ok: true, releaseReady: true, rejected: [], remainingRequests: [], applied: [{ globalId: guid, axis: 0, valueMm: 50, beforeDimensionsMm: [0, 1000, 900], afterDimensionsMm: [50, 1000, 900] }], stats: { imported: 1, authoritativeInputRecoveries: 1 } });
  });
  it.each([
    [[{ globalId: 'wrong', physicalWidthMm: 50, provenance: 'drawing' }], 'INVALID_GLOBAL_ID'],
    [[{ globalId: guid, physicalWidthMm: 0, provenance: 'drawing' }], 'INVALID_WIDTH'],
    [[{ globalId: guid, physicalWidthMm: 50, provenance: '' }], 'PROVENANCE_REQUIRED'],
  ] as const)('fails closed for invalid inputs', (inputs, code) => {
    const result = recoverIfcGeometryWithAuthoritativeInputs(railing, [...inputs]);
    expect(result).toMatchObject({ ok: false, releaseReady: false, rejected: [{ code }], remainingRequests: [{ globalId: guid }] });
  });
  it('cannot overwrite an occurrence whose geometry is already complete', () => {
    const complete = wrap(`#10=IFCBLOCK(#3,10.,20.,30.);#11=IFCCSGSOLID(#10);#12=IFCSHAPEREPRESENTATION($,'Body','CSG',(#11));#13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));#14=IFCBUILDINGELEMENTPROXY('${guid}',$,'B',$,$,#4,#13,$,$);`);
    expect(recoverIfcGeometryWithAuthoritativeInputs(complete, [{ globalId: guid, physicalWidthMm: 99, provenance: 'drawing' }])).toMatchObject({ ok: false, releaseReady: false, applied: [], rejected: [{ code: 'OCCURRENCE_NOT_REQUESTED' }] });
  });
});
