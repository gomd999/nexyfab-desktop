/**
 * ifcImport 폐형 테스트(260718e): 합성 IFC2X3 — 압출 사각 벽=정확 box·배치 합성·단위 스케일.
 */
import { describe, it, expect } from 'vitest';
import { ifcToNexyfabAssembly } from './ifcImport';

const wrap = (data: string, unit = '.MILLI.') => `ISO-10303-21;
HEADER;FILE_DESCRIPTION((''),'2;1');FILE_NAME('','',(''),(''),'','','');FILE_SCHEMA(('IFC2X3'));ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,${unit === 'M' ? '$' : unit},.METRE.);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCDIRECTION((0.,0.,1.));
#12=IFCDIRECTION((1.,0.,0.));
#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);
#14=IFCLOCALPLACEMENT($,#13);
${data}
ENDSEC;
END-ISO-10303-21;
`;

const WALL = (place: string, prof = '#32') => `#30=IFCCARTESIANPOINT((0.,0.));
#31=IFCAXIS2PLACEMENT2D(#30,$);
#32=IFCRECTANGLEPROFILEDEF(.AREA.,$,#31,6000.,200.);
#33=IFCDIRECTION((0.,0.,1.));
#34=IFCEXTRUDEDAREASOLID(${prof},#13,#33,2700.);
#35=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#34));
#36=IFCPRODUCTDEFINITIONSHAPE($,$,(#35));
#40=IFCWALLSTANDARDCASE('guid',$,'Wall-1',$,$,${place},#36,$);`;

describe('ifcToNexyfabAssembly — 폐형', () => {
  it('압출 사각 벽 = 정확 box(치수·배치 합성 폐형)', () => {
    const src = wrap(`#20=IFCCARTESIANPOINT((1000.,2000.,0.));
#21=IFCAXIS2PLACEMENT3D(#20,#11,#12);
#22=IFCLOCALPLACEMENT(#14,#21);
${WALL('#22')}`);
    const r = ifcToNexyfabAssembly(src, { name: 't' });
    expect(r.ok).toBe(true);
    expect(r.stats?.exact).toBe(1);
    const w = r.assembly!.parts[0];
    expect(w.params).toEqual({ width: 6000, depth: 200, height: 2700 });
    expect(w.at.tx).toBeCloseTo(-2000, 0); // 1000 − 6000/2
    expect(w.at.ty).toBeCloseTo(1900, 0);  // 2000 − 200/2
  });
  it('m 단위 파일 = ×1000 스케일', () => {
    const src = wrap(`#20=IFCCARTESIANPOINT((1.,2.,0.));
#21=IFCAXIS2PLACEMENT3D(#20,#11,#12);
#22=IFCLOCALPLACEMENT(#14,#21);
#30=IFCCARTESIANPOINT((0.,0.));
#31=IFCAXIS2PLACEMENT2D(#30,$);
#32=IFCRECTANGLEPROFILEDEF(.AREA.,$,#31,6.,0.2);
#33=IFCDIRECTION((0.,0.,1.));
#34=IFCEXTRUDEDAREASOLID(#32,#13,#33,2.7);
#35=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#34));
#36=IFCPRODUCTDEFINITIONSHAPE($,$,(#35));
#40=IFCWALLSTANDARDCASE('guid',$,'Wall-1',$,$,#22,#36,$);`, 'M');
    const r = ifcToNexyfabAssembly(src, { name: 't' });
    expect(r.ok).toBe(true);
    expect(r.stats?.unitScale).toBe(1000);
    // 260729c: 삼각 메시 경로가 생겨 params 가 유니온이다 — box 임을 먼저 고정한다.
    expect(r.assembly!.parts[0].type).toBe('box');
    expect((r.assembly!.parts[0].params as { width: number }).width).toBeCloseTo(6000, 0);
  });
  it('z-회전 배치 = rz 보존 box', () => {
    const src = wrap(`#20=IFCCARTESIANPOINT((0.,0.,0.));
#25=IFCDIRECTION((0.,1.,0.));
#21=IFCAXIS2PLACEMENT3D(#20,#11,#25);
#22=IFCLOCALPLACEMENT(#14,#21);
${WALL('#22')}`);
    const r = ifcToNexyfabAssembly(src, { name: 't' });
    expect(r.ok).toBe(true);
    expect(Math.abs((r.assembly!.parts[0].at.rz ?? 0) - 90)).toBeLessThan(0.1);
  });
  it('스키마 아님 = 정직 거부', () => {
    expect(ifcToNexyfabAssembly('hello world').ok).toBe(false);
  });
  it('후속 보조 변환용 length SI unit이 첫 프로젝트 길이 단위를 덮어쓰지 않는다', () => {
    const src = wrap(`${WALL('#14')}#90=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);
    const result = ifcToNexyfabAssembly(src); expect(result.stats?.unitScale).toBe(1); expect(result.assembly?.parts[0]?.params).toMatchObject({ width: 6000, depth: 200, height: 2700 });
  });
  it('occurrence representation이 없으면 IfcRelDefinesByType의 RepresentationMaps를 복원한다', () => {
    const src = wrap(`#30=IFCCARTESIANPOINT((0.,0.));
#31=IFCAXIS2PLACEMENT2D(#30,$);
#32=IFCRECTANGLEPROFILEDEF(.AREA.,$,#31,1000.,200.);
#33=IFCDIRECTION((0.,0.,1.));
#34=IFCEXTRUDEDAREASOLID(#32,#13,#33,2000.);
#35=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#34));
#50=IFCREPRESENTATIONMAP(#13,#35);
#60=IFCWALLTYPE('type',$,'WallType',$,$,$,(#50),$,$,.NOTDEFINED.);
#70=IFCWALL('occ',$,'TypedWall',$,$,#14,$,$);
#71=IFCRELDEFINESBYTYPE('rel',$,$,$,(#70),#60);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ elements: 1, imported: 1 });
  });
  it('평면 wall occurrence의 누락 축을 type에 연결된 명시적 material layer 합계로만 복원한다', () => {
    const src = wrap(`#30=IFCCARTESIANPOINT((0.,0.,0.));#31=IFCCARTESIANPOINT((0.,6000.,2700.));
#32=IFCPOLYLINE((#30,#31));#33=IFCSHAPEREPRESENTATION($,'Body','Curve3D',(#32));#34=IFCPRODUCTDEFINITIONSHAPE($,$,(#33));
#40=IFCWALL('wall',$,'LayerWall',$,$,#14,#34,$);#50=IFCWALLTYPE('type',$,'LayerType',$,$,$,$,$,$,.NOTDEFINED.);
#51=IFCRELDEFINESBYTYPE('rel',$,$,$,(#40),#50);#60=IFCMATERIAL('Core');#61=IFCMATERIALLAYER(#60,100.,$,$,$,$,$);
#62=IFCMATERIAL('Finish');#63=IFCMATERIALLAYER(#62,50.,$,$,$,$,$);#64=IFCMATERIALLAYERSET((#61,#63),'Wall Layers',$);
#65=IFCMATERIALLAYERSETUSAGE(#64,.AXIS2.,.POSITIVE.,0.);#66=IFCRELASSOCIATESMATERIAL('mat',$,$,$,(#50),#65);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true); expect(result.stats).toMatchObject({ elements: 1, imported: 1, authoritativeThicknessRecoveries: 1 });
    const params = result.assembly?.parts[0]?.params as { width: number; depth: number; height: number };
    expect([params.width, params.depth, params.height].sort((a, b) => a - b)).toEqual([150, 2700, 6000]);
  });
  it('평면 door의 누락 깊이를 occurrence-linked volume/area 유일 비율로 복원한다', () => {
    const src = wrap(`#30=IFCCARTESIANPOINT((0.,0.,0.));#31=IFCCARTESIANPOINT((1500.,0.,2100.));
#32=IFCPOLYLINE((#30,#31));#33=IFCSHAPEREPRESENTATION($,'Body','Curve3D',(#32));#34=IFCPRODUCTDEFINITIONSHAPE($,$,(#33));
#40=IFCDOOR('door',$,'QuantityDoor',$,$,#14,#34,$,2100.,1500.);#50=IFCQUANTITYAREA('PlanArea',$,$,3.15);
#51=IFCQUANTITYVOLUME('Volume',$,$,0.945);#52=IFCELEMENTQUANTITY('eq',$,'Q',$,(#50,#51));
#53=IFCRELDEFINESBYPROPERTIES('rel',$,$,$,(#40),#52);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true); expect(result.stats).toMatchObject({ elements: 1, imported: 1, authoritativeThicknessRecoveries: 1 });
    const params = result.assembly?.parts[0]?.params as { width: number; depth: number; height: number };
    expect([params.width, params.depth, params.height].sort((a, b) => a - b)).toEqual([300, 1500, 2100]);
  });
  it('상충하는 door 수량 비율은 두께로 추정하지 않고 fail-closed로 남긴다', () => {
    const src = wrap(`#30=IFCCARTESIANPOINT((0.,0.,0.));#31=IFCCARTESIANPOINT((1500.,0.,2100.));#32=IFCPOLYLINE((#30,#31));#33=IFCSHAPEREPRESENTATION($,'Body','Curve3D',(#32));#34=IFCPRODUCTDEFINITIONSHAPE($,$,(#33));#40=IFCDOOR('door',$,'AmbiguousDoor',$,$,#14,#34,$,2100.,1500.);#50=IFCQUANTITYAREA('AreaA',$,$,3.15);#51=IFCQUANTITYAREA('AreaB',$,$,6.3);#52=IFCQUANTITYVOLUME('Volume',$,$,0.945);#53=IFCELEMENTQUANTITY('eq',$,'Q',$,(#50,#51,#52));#54=IFCRELDEFINESBYPROPERTIES('rel',$,$,$,(#40),#53);`);
    const result = ifcToNexyfabAssembly(src); expect(result.ok).toBe(false); expect(result.stats).toMatchObject({ elements: 1, imported: 0, authoritativeThicknessRecoveries: 0, skipByClass: { 'IFCDOOR:dims': 1 } });
  });
  it('자식 부재를 가진 무형 분해 부모는 누락 형상으로 세지 않는다', () => {
    const src = wrap(`${WALL('#14')}
#70=IFCROOF('roof',$,'RoofAssembly',$,$,#14,$,$,.NOTDEFINED.);
#71=IFCRELAGGREGATES('rel',$,$,$,#70,(#40));`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ elements: 1, imported: 1 });
    expect(result.stats?.skipByClass?.['IFCROOF:aggregate']).toBe(1);
  });
  it('Axis 표현이 있는 분해 부모도 자식 solid와 중복된 물리 부품으로 세지 않는다', () => {
    const src = wrap(`${WALL('#14')}
#50=IFCPOLYLINE((#10,#10));#51=IFCSHAPEREPRESENTATION($,'Axis','Curve2D',(#50));#52=IFCPRODUCTDEFINITIONSHAPE($,$,(#51));
#70=IFCWALL('parent',$,'ParentWall',$,$,#14,#52,$);#71=IFCRELAGGREGATES('rel',$,$,$,#70,(#40));`);
    const result = ifcToNexyfabAssembly(src); expect(result.ok).toBe(true); expect(result.stats).toMatchObject({ elements: 1, imported: 1 }); expect(result.stats?.skipByClass?.['IFCWALL:aggregate']).toBe(1);
  });
  it('Group# 무형 proxy만 비기하 placeholder로 구분한다', () => {
    const src = wrap(`${WALL('#14')}
#70=IFCBUILDINGELEMENTPROXY('group',$,'Group#18',$,$,#14,$,$,$);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.stats).toMatchObject({ elements: 1, imported: 1 });
    expect(result.stats?.skipByClass?.['IFCBUILDINGELEMENTPROXY:placeholder']).toBe(1);
  });
  it.each(['IFCSANITARYTERMINAL', 'IFCREINFORCINGBAR', 'IFCBUILTELEMENT'])('%s 물리 occurrence를 부품으로 가져온다', (ifcClass) => {
    const src = wrap(WALL('#14').replace('IFCWALLSTANDARDCASE', ifcClass));
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ elements: 1, imported: 1 });
  });
  it('IfcBlock CSG primitive의 명시 치수와 배치를 경계로 복원한다', () => {
    const src = wrap(`#30=IFCBLOCK(#13,1000.,2000.,3000.);
#31=IFCCSGSOLID(#30);
#32=IFCSHAPEREPRESENTATION($,'Body','CSG',(#31));
#33=IFCPRODUCTDEFINITIONSHAPE($,$,(#32));
#40=IFCBUILDINGELEMENTPROXY('proxy',$,'Block',$,$,#14,#33,$,$);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ elements: 1, imported: 1 });
    expect(result.assembly?.parts[0]?.params).toMatchObject({ width: 1000, depth: 2000, height: 3000 });
  });
  it('occurrence 없는 IfcTypeProduct 형상을 definition-only로 구분한다', () => {
    const src = wrap(`#30=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(10.,0.,0.),(0.,20.,0.),(0.,0.,30.)));
#31=IFCTRIANGULATEDFACESET(#30,$,.T.,((1,2,3),(1,4,2),(2,4,3),(3,4,1)),$);
#32=IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#31));
#33=IFCREPRESENTATIONMAP(#13,#32);
#40=IFCBOILERTYPE('type',$,'Boiler',$,$,$,(#33),$,$,.NOTDEFINED.);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.assembly).toMatchObject({ domain: 'building_definition', definitionOnly: true });
    expect(result.assembly?.parts).toHaveLength(1);
  });
  it.each(['IFCFIXEDREFERENCESWEPTAREASOLID', 'IFCSECTIONEDSOLIDHORIZONTAL'])('%s의 단면 반경을 경로 경계에 보수적으로 합성한다', (solidClass) => {
    const solid = solidClass === 'IFCFIXEDREFERENCESWEPTAREASOLID' ? `${solidClass}(#32,$,#36,$,$,$)` : `${solidClass}(#36,(#32,#32),(#13,#13))`;
    const src = wrap(`#30=IFCCARTESIANPOINT((0.,0.)); #31=IFCAXIS2PLACEMENT2D(#30,$); #32=IFCRECTANGLEPROFILEDEF(.AREA.,$,#31,10.,20.);
#34=IFCCARTESIANPOINT((0.,0.,0.)); #35=IFCCARTESIANPOINT((100.,0.,0.)); #36=IFCPOLYLINE((#34,#35));
#37=${solid}; #38=IFCSHAPEREPRESENTATION($,'Body','AdvancedSweptSolid',(#37)); #39=IFCPRODUCTDEFINITIONSHAPE($,$,(#38));
#40=IFCBUILTELEMENT('built',$,'Swept',$,$,#14,#39,$);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    const params = result.assembly?.parts[0]?.params as { width: number; depth: number; height: number };
    expect(params.width).toBeGreaterThan(100);
    expect(params.depth).toBeGreaterThan(0);
    expect(params.height).toBeGreaterThan(0);
  });
  it('Axis Curve2D 전용 product를 물리 솔리드 분모에서 분리한다', () => {
    const src = wrap(`${WALL('#14')}
#50=IFCPOLYLINE((#10,#10)); #51=IFCSHAPEREPRESENTATION($,'Axis','Curve2D',(#50)); #52=IFCPRODUCTDEFINITIONSHAPE($,$,(#51));
#60=IFCBUILTELEMENT('axis',$,'Footprint',$,$,#14,#52,$);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.stats).toMatchObject({ elements: 1, imported: 1 });
    expect(result.stats?.skipByClass?.['IFCBUILTELEMENT:reference']).toBe(1);
  });
  it('IfcLinearPlacement의 명시 CartesianPosition을 상위 배치와 합성한다', () => {
    const src = wrap(`#20=IFCCARTESIANPOINT((100.,200.,3.)); #21=IFCAXIS2PLACEMENT3D(#20,#11,#12); #22=IFCLINEARPLACEMENT(#14,#999,#21);
${WALL('#22')}`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.assembly?.parts[0]?.at).toMatchObject({ tx: -2900, ty: 100, tz: 3 });
  });
  it('IfcCircle 기반 임의 프로파일 압출을 보수 경계의 approx로 가져온다', () => {
    const src = wrap(`#30=IFCAXIS2PLACEMENT2D(#10,$); #31=IFCCIRCLE(#30,50.); #32=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Circle',#31);
#33=IFCEXTRUDEDAREASOLID(#32,$,#11,2000.); #34=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#33)); #35=IFCPRODUCTDEFINITIONSHAPE($,$,(#34));
#40=IFCCOLUMN('column',$,'Column',$,$,#14,#35,$,$);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ exact: 0, approx: 1, imported: 1 });
    expect(result.assembly?.parts[0]?.params).toMatchObject({ width: 100, depth: 100, height: 2000 });
  });
  it('IfcFacetedBrep 닫힌 shell의 방향 면으로 사면체 부피를 계산한다', () => {
    const src = wrap(`#20=IFCCARTESIANPOINT((0.,0.,0.)); #21=IFCCARTESIANPOINT((10.,0.,0.)); #22=IFCCARTESIANPOINT((0.,10.,0.)); #23=IFCCARTESIANPOINT((0.,0.,10.));
#30=IFCPOLYLOOP((#21,#22,#23)); #31=IFCFACEOUTERBOUND(#30,.T.); #32=IFCFACE((#31));
#33=IFCPOLYLOOP((#20,#22,#21)); #34=IFCFACEOUTERBOUND(#33,.T.); #35=IFCFACE((#34));
#36=IFCPOLYLOOP((#20,#21,#23)); #37=IFCFACEOUTERBOUND(#36,.T.); #38=IFCFACE((#37));
#39=IFCPOLYLOOP((#20,#23,#22)); #40=IFCFACEOUTERBOUND(#39,.T.); #41=IFCFACE((#40));
#42=IFCCLOSEDSHELL((#32,#35,#38,#41)); #43=IFCFACETEDBREP(#42); #44=IFCSHAPEREPRESENTATION($,'Body','Brep',(#43)); #45=IFCPRODUCTDEFINITIONSHAPE($,$,(#44));
#50=IFCBUILDINGELEMENTPROXY('tetra',$,'Tetra',$,$,#14,#45,$,$);`);
    const result = ifcToNexyfabAssembly(src);
    expect(result.ok).toBe(true);
    expect(result.assembly?.parts[0]).toMatchObject({ type: 'mesh', geometryEvidence: 'exact_surface_mesh', meshVolumeExact: true });
    expect((result.assembly?.parts[0]?.params as { verts: number[][]; faces: number[][] })).toMatchObject({ verts: expect.any(Array), faces: expect.any(Array) });
    expect((result.assembly?.parts[0]?.params as { volumeMm3: number }).volumeMm3).toBeCloseTo(1000 / 6, 1);
  });
});
