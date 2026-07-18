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
    expect(r.assembly!.parts[0].params.width).toBeCloseTo(6000, 0);
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
});
