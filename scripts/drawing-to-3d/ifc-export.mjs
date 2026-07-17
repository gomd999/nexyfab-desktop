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
  // GIS 참조(260717 — buildingSMART placements-and-gis-referencing 샘플 앵커):
  // 모델 mm·CRS m·Scale=1000(m→mm) 관례 그대로. origin{E,N}=mm 규약(§F)→CRS 단위 m 로.
  // CRS 는 입력 우선(assembly.crs{epsg,name,datum,projection}) — 미입력 기본 EPSG:5186 은 '가정' 명시(날조 방지).
  if (Number(assembly.origin?.E) || Number(assembly.origin?.N)) {
    const crsIn = assembly.crs ?? {};
    const epsg = crsIn.epsg ?? 'EPSG:5186';
    const crsName = crsIn.name ?? (crsIn.epsg ? '' : 'Korea 2000 / Central Belt 2010 — assumed default (override: assembly.crs)');
    const uM = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
    const crs = add(`IFCPROJECTEDCRS('${esc(epsg)}','${esc(crsName)}','${esc(crsIn.datum ?? 'KGD2002')}',$,'${esc(crsIn.projection ?? 'Transverse Mercator')}',$,#${uM})`);
    add(`IFCMAPCONVERSION(#${ctx},#${crs},${f((Number(assembly.origin.E) || 0) / 1000)},${f((Number(assembly.origin.N) || 0) / 1000)},0.,1.,0.,1000.)`);
  }
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

/**
 * 토목 선형 → IFC4.3 IfcAlignment (인프라 BIM 발주 정식 경로 — 260717).
 * buildingSMART IFC4.3.x-sample-models 'linear-placement-of-signal' 구조 앵커:
 *   IfcAlignment ⊃(RelNests) [Horizontal ⊃(RelNests) segments..., Vertical ⊃ segments...]
 *   H 세그먼트 = IfcAlignmentHorizontalSegment(StartPoint(절대 E,N m)·StartDirection(rad)·
 *   반경쌍(LINE 0,0 / CLOTHOID 0↔±R / CIRCULARARC ±R,±R — ccw +, cw −)·길이).
 * 전 수치 = alignment 요소열 단일 소스(재계산 없음). 단위 m(선형 실무·LandXML 정합).
 * 기하 representation 생략(semantic alignment — 뷰어 시각화는 별도, Description 명시).
 */
export function ifcAlignment43(assembly, { name = 'ALIGN-1', rev = '' } = {}) {
  const al = assembly.alignment;
  if (!al?.elements?.length || !(al.totalMm > 0)) return null;
  const oE = (Number(assembly.origin?.E) || 0) / 1000; // m
  const oN = (Number(assembly.origin?.N) || 0) / 1000;
  const L = [];
  let n = 0;
  const add = (body) => { n++; L.push(`#${n}=${body};`); return n; };
  const G = (seed) => `'${ifcGuid(`43|${rev}|${seed}`)}'`;
  const pt0 = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const axisW = add(`IFCAXIS2PLACEMENT3D(#${pt0},$,$)`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${axisW},$)`);
  const uM = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const units = add(`IFCUNITASSIGNMENT((#${uM}))`);
  const proj = add(`IFCPROJECT(${G('project')},$,'${esc(name)}',$,$,$,$,(#${ctx}),#${units})`);
  if (oE || oN) {
    const crsIn = assembly.crs ?? {};
    const crs = add(`IFCPROJECTEDCRS('${esc(crsIn.epsg ?? 'EPSG:5186')}','${esc(crsIn.name ?? 'assumed default (override: assembly.crs)')}','${esc(crsIn.datum ?? 'KGD2002')}',$,'${esc(crsIn.projection ?? 'Transverse Mercator')}',$,#${uM})`);
    add(`IFCMAPCONVERSION(#${ctx},#${crs},${f(oE)},${f(oN)},0.,1.,0.,1.)`); // 모델=m·CRS=m → Scale 1
  }
  const plSite = add(`IFCLOCALPLACEMENT($,#${axisW})`);
  const site = add(`IFCSITE(${G('site')},$,'Site',$,$,#${plSite},$,$,.ELEMENT.,$,$,$,$,$)`);
  add(`IFCRELAGGREGATES(${G('ra')},$,$,$,#${proj},(#${site}))`);
  const plAl = add(`IFCLOCALPLACEMENT(#${plSite},#${axisW})`);
  const align = add(`IFCALIGNMENT(${G('align')},$,'${esc(name)}',` +
    `'semantic alignment (no geometric representation) - deterministic export from single-source chainage',$,#${plAl},$,.NOTDEFINED.)`);
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${G('contain')},$,$,$,(#${align}),#${site})`);
  // ── 수평 세그먼트(요소열 → LINE/CLOTHOID/CIRCULARARC) ──
  const segs = [];
  const mkSeg = (tag, startXY, dirRad, r0, r1, len, kind) => {
    const sp = add(`IFCCARTESIANPOINT((${f(startXY[0] / 1000 + oE)},${f(startXY[1] / 1000 + oN)}))`);
    const hp = add(`IFCALIGNMENTHORIZONTALSEGMENT($,$,#${sp},${f(dirRad)},${f(r0)},${f(r1)},${f(len / 1000)},$,.${kind}.)`);
    const pl = add(`IFCLOCALPLACEMENT(#${plAl},#${axisW})`);
    segs.push(add(`IFCALIGNMENTSEGMENT(${G(`hseg-${tag}`)},$,'${tag}',$,$,#${pl},$,#${hp})`));
  };
  const els = al.elements;
  let i = 0, tagN = 0;
  while (i < els.length) {
    const el = els[i];
    if (el.type === 'arc') {
      const p0 = [el.c[0] + el.R * Math.cos(el.a0), el.c[1] + el.R * Math.sin(el.a0)];
      const dir = el.a0 + (el.ccw ? Math.PI / 2 : -Math.PI / 2);
      const Rm = (el.ccw ? 1 : -1) * el.R / 1000;
      mkSeg(`h${++tagN}`, p0, dir, Rm, Rm, el.len, 'CIRCULARARC');
      i++;
      continue;
    }
    if (el.spiral != null) {
      const ip = el.spiral;
      let j = i;
      while (j < els.length && els[j].type === 'line' && els[j].spiral === ip) j++;
      const run = els.slice(i, j);
      const isEntry = j < els.length && els[j].type === 'arc';
      const arcNear = els[isEntry ? j : i - 1];
      const Rm = ((arcNear?.ccw ? 1 : -1) * (arcNear?.R ?? 0)) / 1000;
      const Ls = run.reduce((s, q) => s + q.len, 0);
      mkSeg(`h${++tagN}`, run[0].p0, (run[0].brgDeg * Math.PI) / 180, isEntry ? 0 : Rm, isEntry ? Rm : 0, Ls, 'CLOTHOID');
      i = j;
      continue;
    }
    mkSeg(`h${++tagN}`, el.p0, (el.brgDeg * Math.PI) / 180, 0, 0, el.len, 'LINE');
    i++;
  }
  const plH = add(`IFCLOCALPLACEMENT(#${plAl},#${axisW})`);
  const hAl = add(`IFCALIGNMENTHORIZONTAL(${G('halign')},$,'H1',$,$,#${plH},$)`);
  add(`IFCRELNESTS(${G('hnest')},$,'Linear Element Nesting',$,#${hAl},(${segs.map((s) => `#${s}`).join(',')}))`);
  // ── 수직(계획고 PVI → CONSTANTGRADIENT — profile.design 단일 소스) ──
  const nested = [`#${hAl}`];
  const dsg = assembly.profile?.design;
  if (Array.isArray(dsg) && dsg.length >= 2) {
    const vsegs = [];
    for (let k = 0; k < dsg.length - 1; k++) {
      const a = dsg[k], b = dsg[k + 1];
      const hl = (b.staMm - a.staMm) / 1000;
      if (!(hl > 0)) continue;
      const g2 = (b.elevMm - a.elevMm) / (b.staMm - a.staMm);
      const vp = add(`IFCALIGNMENTVERTICALSEGMENT($,$,${f(a.staMm / 1000)},${f(hl)},${f(a.elevMm / 1000)},${f(g2)},${f(g2)},$,.CONSTANTGRADIENT.)`);
      const pl = add(`IFCLOCALPLACEMENT(#${plAl},#${axisW})`);
      vsegs.push(add(`IFCALIGNMENTSEGMENT(${G(`vseg-${k}`)},$,'v${k + 1}',$,$,#${pl},$,#${vp})`));
    }
    if (vsegs.length) {
      const plV = add(`IFCLOCALPLACEMENT(#${plAl},#${axisW})`);
      const vAl = add(`IFCALIGNMENTVERTICAL(${G('valign')},$,'V1',$,$,#${plV},$)`);
      add(`IFCRELNESTS(${G('vnest')},$,'Linear Element Nesting',$,#${vAl},(${vsegs.map((s) => `#${s}`).join(',')}))`);
      nested.push(`#${vAl}`);
    }
  }
  add(`IFCRELNESTS(${G('anest')},$,'Alignment Nesting',$,#${align},(${nested.join(',')}))`);
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('nexyfab deterministic IFC4.3 alignment export (semantic; single-source chainage; units m)'),'2;1');
FILE_NAME('alignment43.ifc','',('nexyfab'),('nexysys'),'nexyfab drawing-to-3d','','');
FILE_SCHEMA(('IFC4X3_ADD2'));
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
  {
    // GIS 참조(origin→IfcMapConversion, buildingSMART 샘플 앵커 관례)
    const civ = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ips: [[0, 0], [200000, 0]] });
    civ.origin = { E: 200000000, N: 450000000 }; // mm
    const x = ifcExport(civ, { rev: 'g1' });
    check('IfcMapConversion(E/N=m·Scale 1000)', /IFCMAPCONVERSION\(#\d+,#\d+,200000\.,450000\.,0\.,1\.,0\.,1000\.\)/.test(x));
    check('IfcProjectedCRS 기본=가정 명시', x.includes('EPSG:5186') && x.includes('assumed default'));
    const y = ifcExport({ ...civ, crs: { epsg: 'EPSG:5187', name: 'Korea 2000 / East Belt 2010' } }, { rev: 'g2' });
    check('CRS 입력 우선(5187)', y.includes('EPSG:5187') && !y.includes('assumed default'));
  }
  {
    // IFC4.3 IfcAlignment — 직선+원곡선+클로소이드 혼합(요소열 매핑 무결·연장 폐형)
    const civ = buildAssemblyTemplate('civil', 'retaining_wall_alignment', {
      ips: [[0, 0], [400000, 0], [800000, 300000], [1300000, 300000]],
      curves: [{ ip: 1, R: 200000, Ls: 60000 }, { ip: 2, R: 150000 }],
    });
    civ.origin = { E: 200000000, N: 450000000 };
    const x = ifcAlignment43(civ, { name: 'AL', rev: 'a1' });
    const defined = new Set([...x.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
    const used = [...x.matchAll(/#(\d+)[,)\s]/g)].map((m) => m[1]);
    check('4.3 참조 무결', used.every((u) => defined.has(u)));
    const nLine = (x.match(/\.LINE\.\)/g) ?? []).length;
    const nArc = (x.match(/\.CIRCULARARC\.\)/g) ?? []).length;
    const nClo = (x.match(/\.CLOTHOID\.\)/g) ?? []).length;
    check('세그 매핑 L3/C2/S2', nLine === 3 && nArc === 2 && nClo === 2, `L${nLine}/C${nArc}/S${nClo}`);
    const lens = [...x.matchAll(/IFCALIGNMENTHORIZONTALSEGMENT\([^)]*?,([\d.]+),\$,\.\w+\.\)/g)].map((m) => +m[1]);
    const sum = lens.reduce((s, v) => s + v, 0);
    check('4.3 연장 폐형(세그 합=전체 m)', Math.abs(sum - civ.alignment.totalMm / 1000) < 0.002, sum.toFixed(3));
    check('클로소이드 반경쌍(0↔R 부호)', /,0\.,200\.,[\d.]+,\$,\.CLOTHOID\.\)/.test(x) && /,200\.,0\.,[\d.]+,\$,\.CLOTHOID\.\)/.test(x));
    check('절대좌표(m) 시점 E=200000', x.includes('IFCCARTESIANPOINT((200000.,450000.))'));
    check('IFC4X3_ADD2 스키마', x.includes("FILE_SCHEMA(('IFC4X3_ADD2'))"));
  }
  // ── ③ 실파일 회귀 하네스(로컬 코퍼스 존재 시만 — repo 미포함·미존재=스킵 정직 표기) ──
  {
    const fs = await import('node:fs');
    const CORPUS = 'C:/Users/gomd9/Downloads/IFC4.3.x-sample-models-main/IFC4.3.x-sample-models-main/models';
    const refCheck = (text) => { // SPF 참조 무결(공백 허용 — buildingSMART 서식 '#1 = ...')
      const defined = new Set([...text.matchAll(/^#(\d+)\s*=/gm)].map((m) => m[1]));
      const used = [...text.matchAll(/#(\d+)\s*[,)\s]/g)].map((m) => m[1]);
      return used.filter((u) => !defined.has(u));
    };
    if (fs.existsSync(CORPUS)) {
      const samples = [
        'placements-and-gis-referencing/geographic-referencing-gk/geographic-referencing-gk.ifc',
        'alignment-geometries-and-linear-positioning/linear-placement-of-signal/linear-placement-of-signal.ifc',
        'building-elements/beam-extruded-solid/beam-extruded-solid.ifc',
      ];
      let okN = 0;
      for (const s of samples) {
        const t = fs.readFileSync(`${CORPUS}/${s}`, 'utf8');
        if (refCheck(t).length === 0 && /FILE_SCHEMA/.test(t)) okN++;
      }
      check('코퍼스 하네스: 공식 샘플 3종 검사기 통과(검사기 자체 검증)', okN === 3, `${okN}/3`);
    } else console.log('SKIP 코퍼스 하네스 — buildingSMART 샘플 폴더 없음(로컬 전용 검사)');
  }
  // ── ④ EXPRESS 스키마 정적 검사(mondo IFC4.exp 존재 시 — 방출 엔티티 속성 수 폐형) ──
  {
    const fs = await import('node:fs');
    const EXP = 'C:/Users/gomd9/Downloads/mondo-openbim-benchmark-master/mondo-openbim-benchmark-master/eu.opensourceprojects.mondo.bencharks.openbim/doc/IFC4.exp';
    if (fs.existsSync(EXP)) {
      const exp = fs.readFileSync(EXP, 'utf8');
      // ENTITY 블록 → 명시 속성 수 + SUPERTYPE 체인 합
      const ents = {};
      for (const m of exp.matchAll(/ENTITY\s+(\w+)([\s\S]*?)END_ENTITY;/g)) {
        const [, nm, body] = m;
        const sup = body.match(/SUBTYPE\s+OF\s*\(\s*(\w+)\s*\)/)?.[1] ?? null;
        const head = body.split(/\n\s*(?:DERIVE|INVERSE|WHERE|UNIQUE)\b/)[0];
        const attrs = [...head.matchAll(/^\s*(\w+)\s*:\s*(?:OPTIONAL\s+)?[^;]+;/gm)].length;
        ents[nm.toUpperCase()] = { sup: sup?.toUpperCase() ?? null, own: attrs };
      }
      const totalAttrs = (nm) => { let t = 0, cur = nm; const seen = new Set(); while (cur && ents[cur] && !seen.has(cur)) { seen.add(cur); t += ents[cur].own; cur = ents[cur].sup; } return t; };
      // 우리 IFC4 방출물의 각 엔티티 라인 인자 수(문자열·괄호 인지 카운터) 대조
      const argCount = (s) => {
        let depth = 0, inStr = false, cnt = 1;
        for (let k = 0; k < s.length; k++) {
          const ch = s[k];
          if (inStr) { if (ch === "'" && s[k + 1] === "'") k++; else if (ch === "'") inStr = false; continue; }
          if (ch === "'") inStr = true;
          else if (ch === '(') depth++;
          else if (ch === ')') depth--;
          else if (ch === ',' && depth === 1) cnt++;
        }
        return cnt;
      };
      const asm2 = buildAssemblyTemplate('building', 'rc_frame', { floors: 1, baysX: 1, baysY: 1 });
      asm2.origin = { E: 1000000, N: 2000000 };
      const out = ifcExport(asm2, { rev: 'x1' });
      const badLines = [];
      for (const m of out.matchAll(/^#\d+=(\w+)\((.*)\);$/gm)) {
        const [, nm, args] = m;
        if (!ents[nm]) continue; // 스키마에 없는 이름은 별도 실패로 잡힘
        const want = totalAttrs(nm);
        const got = argCount(`(${args})`);
        if (got !== want) badLines.push(`${nm}: ${got} vs 스키마 ${want}`);
      }
      check('EXPRESS 속성 수 폐형(IFC4.exp 대조)', badLines.length === 0, [...new Set(badLines)].slice(0, 4).join(' · '));
      const unknown = [...new Set([...out.matchAll(/^#\d+=(\w+)\(/gm)].map((m) => m[1]).filter((nm) => !ents[nm]))];
      check('방출 엔티티 전부 IFC4 스키마 존재', unknown.length === 0, unknown.join(','));
    } else console.log('SKIP EXPRESS 검사 — mondo IFC4.exp 없음(로컬 전용 검사)');
  }
  console.log(`ifc self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
