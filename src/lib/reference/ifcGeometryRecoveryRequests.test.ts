import { describe, expect, it } from 'vitest'; import { buildIfcGeometryRecoveryRequests } from './ifcGeometryRecoveryRequests';
const wrap = (body: string) => `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;DATA;#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);#2=IFCCARTESIANPOINT((0.,0.,0.));#3=IFCAXIS2PLACEMENT3D(#2,$,$);#4=IFCLOCALPLACEMENT($,#3);${body}ENDSEC;END-ISO-10303-21;`;
describe('IFC geometry recovery requests', () => {
  it('requests a railing profile/width for an open planar surface occurrence', () => {
    const report = buildIfcGeometryRecoveryRequests(wrap(`#10=IFCCARTESIANPOINT((0.,0.,0.));#11=IFCCARTESIANPOINT((0.,1000.,0.));#12=IFCCARTESIANPOINT((0.,1000.,900.));#13=IFCPOLYLOOP((#10,#11,#12));#14=IFCFACEOUTERBOUND(#13,.T.);#15=IFCFACE((#14));#16=IFCOPENSHELL((#15));#17=IFCSHELLBASEDSURFACEMODEL((#16));#18=IFCSHAPEREPRESENTATION($,'Body','SurfaceModel',(#17));#19=IFCPRODUCTDEFINITIONSHAPE($,$,(#18));#20=IFCRAILING('0DAlDmbNb6ZhcaPbmdsMGX',$,'R',$,$,#4,#19,$,.NOTDEFINED.);`));
    expect(report).toMatchObject({ releaseReady: false, elements: 1, imported: 0, requests: [{ entityId: 20, globalId: '0DAlDmbNb6ZhcaPbmdsMGX', action: 'request_authoritative_thickness', requiredInputs: ['profile_definition_or_physical_width_mm'], missingAxes: [0] }] });
  });
  it('returns release ready when every physical occurrence imports', () => {
    const report = buildIfcGeometryRecoveryRequests(wrap(`#10=IFCBLOCK(#3,10.,20.,30.);#11=IFCCSGSOLID(#10);#12=IFCSHAPEREPRESENTATION($,'Body','CSG',(#11));#13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));#14=IFCBUILDINGELEMENTPROXY('0DAlDmbNb6ZhcaPbmdsMGX',$,'B',$,$,#4,#13,$,$);`)); expect(report).toMatchObject({ releaseReady: true, requests: [] });
  });
});
