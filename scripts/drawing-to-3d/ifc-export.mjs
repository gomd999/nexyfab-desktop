/**
 * ifc-export.mjs — 어셈블리 → IFC4 (ISO 10303-21 SPF, 260717 실무화 후속)
 *
 * BIM 발주(조달청 BIM 의무화 확대) 대응: 부품을 role 별 IFC 엔티티로 방출.
 *   box → IfcExtrudedAreaSolid(IfcRectangleProfileDef), cylinder → IfcCircleProfileDef.
 *   role: column→IfcColumn · beam/girder/crossbeam→IfcBeam · slab/deck/floor→IfcSlab ·
 *         wall/stem→IfcWall · footing/base→IfcFooting · 기타→IfcBuildingElementProxy.
 * 정직 경계(명시): 회전은 rz(평면 회전)만 정확 반영 — rx/ry 부품은 **월드 AABB 근사**로
 *   방출하고 Description 에 'AABB approx' 표기(형상 날조 대신 근사 명시).
 *   재질·철근·접합 상세 미포함(형상+분류만) — LOD200 상당.
 * GlobalId = 결정론(sha1 기반, 재생성 시 동일) — Date/난수 사용 없음.
 */
import { createHash } from 'node:crypto';
import { placedAabb } from './assembly.mjs';

const IFC64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
/** 결정론 IFC GlobalId(22자) — 128bit(sha1 절단)를 IFC base64 로 압축. */
export function ifcGuid(seed) {
  const h = createHash('sha1').update(String(seed)).digest();
  const b = [0, ...h.subarray(0, 16)]; // 17바이트: 첫 문자는 2비트만 사용(선행 0)
  let out = '';
  // 22자 = 2비트 + 21×6비트 (표준 압축과 동일 골격)
  let acc = 0n;
  for (let i = 0; i < 17; i++) acc = (acc << 8n) | BigInt(b[i]);
  for (let i = 21; i >= 0; i--) {
    out = IFC64[Number(acc & 63n)] + out;
    acc >>= 6n;
  }
  return out;
}

const f = (v) => {
  const s = Number(v).toFixed(4).replace(/\.?0+$/, '');
  return s.includes('.') ? s : s + '.';
};
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");

const ROLE_IFC = [
  [/column|post|기둥/i, 'IFCCOLUMN'],
  [/girder|crossbeam|beam|보/i, 'IFCBEAM'],
  [/slab|deck|floor|바닥/i, 'IFCSLAB'],
  [/wall|stem|벽/i, 'IFCWALL'],
  [/footing|base|기초/i, 'IFCFOOTING'],
];

/** 어셈블리 → IFC4 문자열. parts 없으면 null. */
export function ifcExport(assembly, { name = 'nexyfab assembly', rev = '' } = {}) {
  const parts = assembly.parts ?? [];
  if (!parts.length) return null;
  const L = [];
  let n = 0;
  const add = (body) => { n++; L.push(`#${n}=${body};`); return n; };
  const G = (seed) => `'${ifcGuid(`${rev}|${seed}`)}'`;

  // 공통 골격
  const pt0 = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const dirZ = add('IFCDIRECTION((0.,0.,1.))');
  const dirX = add('IFCDIRECTION((1.,0.,0.))');
  const axisW = add(`IFCAXIS2PLACEMENT3D(#${pt0},#${dirZ},#${dirX})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${axisW},$)`);
  const uLen = add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const uArea = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const units = add(`IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol}))`);
  const proj = add(`IFCPROJECT(${G('project')},$,'${esc(name)}',$,$,$,$,(#${ctx}),#${units})`);
  const plSite = add(`IFCLOCALPLACEMENT($,#${axisW})`);
  const site = add(`IFCSITE(${G('site')},$,'Site',$,$,#${plSite},$,$,.ELEMENT.,$,$,$,$,$)`);
  const plBld = add(`IFCLOCALPLACEMENT(#${plSite},#${axisW})`);
  const bld = add(`IFCBUILDING(${G('building')},$,'Building',$,$,#${plBld},$,$,.ELEMENT.,$,$,$)`);
  const plSto = add(`IFCLOCALPLACEMENT(#${plBld},#${axisW})`);
  const sto = add(`IFCBUILDINGSTOREY(${G('storey')},$,'Level 0',$,$,#${plSto},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES(${G('ra1')},$,$,$,#${proj},(#${site}))`);
  add(`IFCRELAGGREGATES(${G('ra2')},$,$,$,#${site},(#${bld}))`);
  add(`IFCRELAGGREGATES(${G('ra3')},$,$,$,#${bld},(#${sto}))`);

  const elems = [];
  for (const [i, p] of parts.entries()) {
    const at = p.at ?? {};
    const rzOnly = !Number(at.rx) && !Number(at.ry);
    const rz = Number(at.rz) || 0;
    let profile, depth, px, py, pz, refDir = null, desc = '$';
    if (rzOnly && p.type === 'cylinder' && Number(p.params?.diameter) > 0) {
      const d = Number(p.params.diameter), len = Number(p.params.length) || d;
      const c2d = add('IFCCARTESIANPOINT((0.,0.))');
      const a2d = add(`IFCAXIS2PLACEMENT2D(#${c2d},$)`);
      profile = add(`IFCCIRCLEPROFILEDEF(.AREA.,$,#${a2d},${f(d / 2)})`);
      depth = len;
      px = Number(at.tx) || 0; py = Number(at.ty) || 0; pz = Number(at.tz) || 0;
      // 원기둥 로컬 원점=중심축 하단: tx/ty 는 AABB 좌하 관례 → 중심 이동
      px += d / 2; py += d / 2;
    } else if (rzOnly && p.type !== 'cylinder' && Number(p.params?.width) > 0 && Number(p.params?.height) > 0) {
      const w = Number(p.params.width), dpt = Number(p.params.depth) || w, h = Number(p.params.height);
      const c2d = add(`IFCCARTESIANPOINT((${f(w / 2)},${f(dpt / 2)}))`);
      const a2d = add(`IFCAXIS2PLACEMENT2D(#${c2d},$)`);
      profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${a2d},${f(w)},${f(dpt)})`);
      depth = h;
      px = Number(at.tx) || 0; py = Number(at.ty) || 0; pz = Number(at.tz) || 0;
      if (rz) refDir = add(`IFCDIRECTION((${f(Math.cos((rz * Math.PI) / 180))},${f(Math.sin((rz * Math.PI) / 180))},0.))`);
    } else {
      // 비 rz 회전·복합 어휘: 월드 AABB 근사(명시 — 형상 날조 대신 정직 근사)
      const b = placedAabb(p);
      if (!b || ![0, 1, 2].every((k) => Number.isFinite(b.min[k]) && Number.isFinite(b.max[k]))) continue;
      const w = b.max[0] - b.min[0], dpt = b.max[1] - b.min[1];
      const c2d = add(`IFCCARTESIANPOINT((${f(w / 2)},${f(dpt / 2)}))`);
      const a2d = add(`IFCAXIS2PLACEMENT2D(#${c2d},$)`);
      profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${a2d},${f(w)},${f(dpt)})`);
      depth = b.max[2] - b.min[2];
      px = b.min[0]; py = b.min[1]; pz = b.min[2];
      desc = "'AABB approx (non-rz rotation or composite vocab)'";
    }
    const org = add(`IFCCARTESIANPOINT((${f(px)},${f(py)},${f(pz)}))`);
    const ax = refDir ? add(`IFCAXIS2PLACEMENT3D(#${org},#${dirZ},#${refDir})`) : add(`IFCAXIS2PLACEMENT3D(#${org},$,$)`);
    const pl = add(`IFCLOCALPLACEMENT(#${plSto},#${ax})`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${axisW},#${dirZ},${f(depth)})`);
    const rep = add(`IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
    const hay = `${p.role ?? ''} ${p.id ?? ''}`;
    const cls = ROLE_IFC.find(([re]) => re.test(hay))?.[1] ?? 'IFCBUILDINGELEMENTPROXY';
    const tail = cls === 'IFCBUILDINGELEMENTPROXY' ? ',$' : cls === 'IFCSLAB' || cls === 'IFCWALL' || cls === 'IFCCOLUMN' || cls === 'IFCBEAM' || cls === 'IFCFOOTING' ? ',.NOTDEFINED.' : ',$';
    elems.push(add(`${cls}(${G(p.id ?? `part${i}`)},$,'${esc(p.id ?? p.type)}',${desc},$,#${pl},#${shape},$${tail})`));
  }
  if (!elems.length) return null;
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${G('contain')},$,$,$,(${elems.map((e) => `#${e}`).join(',')}),#${sto})`);

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('nexyfab drawing-to-3d deterministic export (LOD200: shape+class only; rebar/material/joints not included)'),'2;1');
FILE_NAME('assembly.ifc','',('nexyfab'),('nexysys'),'nexyfab drawing-to-3d','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${L.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
}

// ── self-test: 참조 무결(전 #ref 정의 존재)·GUID 결정론·클래스 매핑 ───────────
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('ifc-export.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  let pass = 0, fail = 0;
  const check = (nm, ok, note = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK' : 'FAIL'} ${nm}${note ? ' — ' + note : ''}`); };
  const asm = buildAssemblyTemplate('building', 'rc_frame', { floors: 2, baysX: 2, baysY: 1 });
  const ifc = ifcExport(asm, { name: 'RC2', rev: 'r1' });
  // 참조 무결: 사용된 #n 이 전부 정의됨
  const defined = new Set([...ifc.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  const used = [...ifc.matchAll(/#(\d+)[,)\s]/g)].map((m) => m[1]);
  const undef = [...new Set(used.filter((u) => !defined.has(u)))];
  check('참조 무결(미정의 0)', undef.length === 0, undef.slice(0, 3).join(','));
  check('스키마 IFC4 + END 마커', ifc.includes("FILE_SCHEMA(('IFC4'))") && ifc.trimEnd().endsWith('END-ISO-10303-21;'));
  check('클래스 매핑(기둥·보·슬래브)', ifc.includes('IFCCOLUMN(') && ifc.includes('IFCBEAM(') && ifc.includes('IFCSLAB('));
  const guids = [...ifc.matchAll(/'([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  check('GlobalId 22자 유일', new Set(guids).size === guids.length, `${guids.length}개`);
  const ifc2 = ifcExport(asm, { name: 'RC2', rev: 'r1' });
  check('결정론(동일 입력=동일 출력)', ifc === ifc2);
  const skid = ifcExport({ parts: [
    { id: 'tank', type: 'cylinder', params: { diameter: 600, length: 900 }, at: { tx: 0, ty: 0, tz: 100 }, role: 'tank' },
    { id: 'rot', type: 'box', params: { width: 100, depth: 50, height: 30 }, at: { rx: 90 }, role: 'frame' },
  ] }, { rev: 'r2' });
  check('원기둥=CircleProfile·비rz=AABB 근사 명시', skid.includes('IFCCIRCLEPROFILEDEF') && skid.includes('AABB approx'));
  console.log(`ifc self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
