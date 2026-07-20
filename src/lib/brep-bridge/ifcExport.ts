/**
 * ifcExport.ts — 폐다면체 메시 → IFC2X3 SPF(IfcFacetedBrep) 익스포트 (W5-H, 260721).
 *
 * 정직 경계(전부 명시):
 *  - 계층 = IfcProject→IfcSite→IfcBuilding→IfcBuildingStorey→IfcBuildingElementProxy
 *    최소 골격(스키마 IFC2X3). 형상 = IfcFacetedBrep(IfcClosedShell — 페이스별
 *    IfcPolyLoop, 정점 IfcCartesianPoint 공유). 단위 = IfcSIUnit MILLI METRE(mm).
 *  - IfcClosedShell 은 폐셸 의미론 — **개방/비매니폴드/비평면 메시는 사유와 함께
 *    거부**(satExport.validateClosedPolyMesh 와 동일 기준 — 겉핥기 방출 금지).
 *    연결 성분이 여럿이면 성분별 IfcFacetedBrep 로 분리(1 폐셸=1 성분).
 *  - GlobalId = **결정적 의사-GUID**(IFC base64 22자 형식 준수·RFC4122 유래 아님 — 명시).
 *  - 검증 = ①구조 자기검사 selfCheckIfc(필수 엔티티 존재·참조 무결성·정점 수 일치)
 *    ②기존 ifcImport.ifcToNexyfabAssembly 라운드트립(AABB — 임포터 방출이 0.1mm
 *    반올림이므로 그 정밀도 기준). 외부 BIM 툴 실수입은 미검증(주장하지 않음).
 */

import { validateClosedPolyMesh, type PolyMesh } from './satExport';

export interface IfcWriteStats {
  entities: number;
  breps: number;
  faces: number;
  /** IfcPolyLoop 가 참조하는 고유 IfcCartesianPoint 수(=융합 정점 수) */
  brepPoints: number;
}

export type IfcWriteResult =
  | { ok: true; text: string; stats: IfcWriteStats }
  | { ok: false; error: string };

/** STEP(ISO 10303-21) 실수 리터럴 — 소수점 필수·지수 E 표기 정규화 */
const freal = (v: number): string => {
  if (Object.is(v, -0)) v = 0;
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return `${v}.`;
  const s = String(v);
  if (s.includes('e') || s.includes('E')) {
    const [m, e] = s.split(/[eE]/);
    return `${m.includes('.') ? m : `${m}.`}E${e.replace('+', '')}`;
  }
  return s;
};

/** IFC GlobalId 알파벳(base64 변형) — 22자 */
const GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** 결정적 의사-GUID(FNV-1a 시드 확장) — 형식만 준수, RFC4122 유래 아님(파일 헤더에 명시) */
export function pseudoGuid(seed: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((seed.charCodeAt(i) << 8) | i & 0xff), 0x01000193) >>> 0;
  }
  let out = GUID_ALPHABET[h1 % 4]; // 선두 문자는 0..3(128bit 인코딩 관례)
  let a = h1, b = h2;
  for (let k = 0; k < 21; k++) {
    a = (Math.imul(a, 1103515245) + 12345 + b) >>> 0;
    b = (b ^ (a >>> 13)) >>> 0;
    out += GUID_ALPHABET[a % 64];
  }
  return out;
}

/**
 * 융합 폴리메시 → IFC2X3 SPF 텍스트. 폐다면체 검증 실패 = { ok:false, error }.
 * 내향 일관 방향 성분은 외향 정규화(satExport 와 동일 규약).
 */
export function writeIfcText(
  mesh: PolyMesh,
  { name = 'model' }: { name?: string } = {},
): IfcWriteResult {
  for (const v of mesh.verts) {
    if (v.length < 3 || v.some((c) => !Number.isFinite(c))) return { ok: false, error: '정점 좌표에 비유한값 — 방출 거부' };
  }
  const val = validateClosedPolyMesh(mesh);
  if ('error' in val) return { ok: false, error: `IfcFacetedBrep(폐셸) 요건 미달 — ${val.error}` };

  const safeName = name.replace(/['\\\r\n]/g, '_').slice(0, 60) || 'model';
  const lines: string[] = [];
  let nextId = 1;
  const add = (body: (id: number) => string): number => {
    const id = nextId++;
    lines.push(`#${id}=${body(id)};`);
    return id;
  };
  const guid = (tag: string) => pseudoGuid(`nexyfab-w5h:${safeName}:${tag}`);

  // ── 공통 골격 ──
  const person = add(() => `IFCPERSON($,$,'NexyFab',$,$,$,$,$)`);
  const org = add(() => `IFCORGANIZATION($,'Nexysys',$,$,$)`);
  const pao = add(() => `IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = add(() => `IFCAPPLICATION(#${org},'W5-H','NexyFab shape-generator','nexyfab')`);
  const hist = add(() => `IFCOWNERHISTORY(#${pao},#${app},$,.ADDED.,$,$,$,0)`);
  const uLen = add(() => `IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)`);
  const uArea = add(() => `IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const uVol = add(() => `IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
  const units = add(() => `IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol}))`);
  const origin = add(() => `IFCCARTESIANPOINT((0.,0.,0.))`);
  const dirZ = add(() => `IFCDIRECTION((0.,0.,1.))`);
  const dirX = add(() => `IFCDIRECTION((1.,0.,0.))`);
  const wcs = add(() => `IFCAXIS2PLACEMENT3D(#${origin},#${dirZ},#${dirX})`);
  const ctx = add(() => `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-6,#${wcs},$)`);
  const project = add(() => `IFCPROJECT('${guid('project')}',#${hist},'${safeName}',$,$,$,$,(#${ctx}),#${units})`);
  const sitePl = add(() => `IFCLOCALPLACEMENT($,#${wcs})`);
  const site = add(() => `IFCSITE('${guid('site')}',#${hist},'Site',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgPl = add(() => `IFCLOCALPLACEMENT(#${sitePl},#${wcs})`);
  const bldg = add(() => `IFCBUILDING('${guid('building')}',#${hist},'Building',$,$,#${bldgPl},$,$,.ELEMENT.,$,$,$)`);
  const storeyPl = add(() => `IFCLOCALPLACEMENT(#${bldgPl},#${wcs})`);
  const storey = add(() => `IFCBUILDINGSTOREY('${guid('storey')}',#${hist},'Storey',$,$,#${storeyPl},$,$,.ELEMENT.,0.)`);
  add(() => `IFCRELAGGREGATES('${guid('aggr-site')}',#${hist},$,$,#${project},(#${site}))`);
  add(() => `IFCRELAGGREGATES('${guid('aggr-bldg')}',#${hist},$,$,#${site},(#${bldg}))`);
  add(() => `IFCRELAGGREGATES('${guid('aggr-storey')}',#${hist},$,$,#${bldg},(#${storey}))`);

  // ── 형상: 정점 공유 IfcCartesianPoint + 성분별 IfcFacetedBrep ──
  const pointId = new Map<number, number>(); // mesh 정점 idx → 엔티티 id (폴리루프 참조 시 생성)
  const pid = (vi: number): number => {
    let id = pointId.get(vi);
    if (id === undefined) {
      const [x, y, z] = mesh.verts[vi];
      id = add(() => `IFCCARTESIANPOINT((${freal(x)},${freal(y)},${freal(z)}))`);
      pointId.set(vi, id);
    }
    return id;
  };
  // 성분별 부호부피 → 외향 정규화(방향 일관 뒤집힘만 교정 — 좌표 불변)
  const vol6Of = (faceIdxs: number[]): number => {
    let v6 = 0;
    for (const fi of faceIdxs) {
      const f = mesh.faces[fi];
      const a = mesh.verts[f[0]];
      for (let k = 1; k + 1 < f.length; k++) {
        const b = mesh.verts[f[k]], c = mesh.verts[f[k + 1]];
        v6 += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      }
    }
    return v6;
  };
  const brepIds: number[] = [];
  let faceCount = 0;
  for (const comp of val.components) {
    const flip = vol6Of(comp) < 0;
    const faceIds: number[] = [];
    for (const fi of comp) {
      const cycle = flip ? [...mesh.faces[fi]].reverse() : mesh.faces[fi];
      const loop = add(() => `IFCPOLYLOOP((${cycle.map((vi) => `#${pid(vi)}`).join(',')}))`);
      const bound = add(() => `IFCFACEOUTERBOUND(#${loop},.T.)`);
      faceIds.push(add(() => `IFCFACE((#${bound}))`));
      faceCount++;
    }
    const shell = add(() => `IFCCLOSEDSHELL((${faceIds.map((f) => `#${f}`).join(',')}))`);
    brepIds.push(add(() => `IFCFACETEDBREP(#${shell})`));
  }
  const shapeRep = add(() => `IFCSHAPEREPRESENTATION(#${ctx},'Body','Brep',(${brepIds.map((b) => `#${b}`).join(',')}))`);
  const pds = add(() => `IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);
  const proxyPl = add(() => `IFCLOCALPLACEMENT(#${storeyPl},#${wcs})`);
  const proxy = add(() => `IFCBUILDINGELEMENTPROXY('${guid('proxy')}',#${hist},'${safeName}',$,$,#${proxyPl},#${pds},$,$)`);
  add(() => `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid('contain')}',#${hist},$,$,(#${proxy}),#${storey})`);

  const now = new Date().toISOString().slice(0, 19);
  const text = [
    'ISO-10303-21;',
    'HEADER;',
    // 정직 선언: 메시 유래 파셋 B-rep + 결정적 의사-GUID
    `FILE_DESCRIPTION(('NexyFab W5-H mesh export: IfcFacetedBrep from welded planar mesh','GlobalIds are deterministic pseudo-GUIDs (format-compliant, not RFC4122)'),'2;1');`,
    `FILE_NAME('${safeName}.ifc','${now}',('NexyFab'),('Nexysys'),'nexyfab-ifc-export W5-H','NexyFab shape-generator','');`,
    `FILE_SCHEMA(('IFC2X3'));`,
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
  return {
    ok: true,
    text,
    stats: { entities: lines.length, breps: brepIds.length, faces: faceCount, brepPoints: pointId.size },
  };
}

// ── 구조 자기검사(파서 수준 — 의미론 검증이 아님을 명시) ─────────────────────

export interface IfcSelfCheckResult {
  ok: boolean;
  errors: string[];
  stats: {
    entities: number;
    /** IfcPolyLoop 가 참조하는 고유 point 엔티티 수 */
    loopPoints: number;
    faces: number;
    refsChecked: number;
  };
}

const REQUIRED_ENTITIES = [
  'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY',
  'IFCBUILDINGELEMENTPROXY', 'IFCFACETEDBREP', 'IFCCLOSEDSHELL',
  'IFCSHAPEREPRESENTATION', 'IFCPRODUCTDEFINITIONSHAPE', 'IFCSIUNIT',
  'IFCRELAGGREGATES', 'IFCRELCONTAINEDINSPATIALSTRUCTURE',
];

/**
 * IFC SPF 구조 자기검사: 스키마 헤더·필수 엔티티 존재·#참조 무결성·폴리루프
 * 정점 요건(≥3)·ClosedShell↔Face 카운트 정합·(옵션) 고유 루프 정점 수 일치.
 * ⚠파서 수준 검사 — IFC 의미론(스키마 적합성 전체)을 보증하지 않는다.
 */
export function selfCheckIfc(text: string, expected?: { brepPoints?: number }): IfcSelfCheckResult {
  const errors: string[] = [];
  if (!/FILE_SCHEMA\s*\(\s*\(\s*'IFC2X3'/i.test(text)) errors.push('FILE_SCHEMA IFC2X3 헤더 없음');
  const ents = new Map<number, { name: string; raw: string }>();
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = +m[1];
    if (ents.has(id)) errors.push(`엔티티 id 중복 #${id}`);
    ents.set(id, { name: m[2], raw: m[3] });
  }
  if (ents.size === 0) errors.push('엔티티 0건');
  for (const need of REQUIRED_ENTITIES) {
    if (![...ents.values()].some((e) => e.name === need)) errors.push(`필수 엔티티 부재: ${need}`);
  }
  // 참조 무결성(문자열 리터럴 내 #은 제외 — 작은따옴표 구간 마스킹)
  let refsChecked = 0;
  for (const [id, e] of ents) {
    const masked = e.raw.replace(/'(?:[^']|'')*'/g, "''");
    for (const r of masked.match(/#\d+/g) ?? []) {
      refsChecked++;
      if (!ents.has(+r.slice(1))) errors.push(`#${id}(${e.name}) → 미해석 참조 ${r}`);
    }
  }
  // 폴리루프·페이스·셸 정합
  const loopPointIds = new Set<number>();
  let faces = 0;
  for (const [id, e] of ents) {
    if (e.name === 'IFCPOLYLOOP') {
      const pts = (e.raw.match(/#\d+/g) ?? []).map((r) => +r.slice(1));
      if (pts.length < 3) errors.push(`IFCPOLYLOOP #${id} 정점 ${pts.length}개(<3)`);
      for (const p of pts) {
        const pe = ents.get(p);
        if (pe && pe.name !== 'IFCCARTESIANPOINT') errors.push(`IFCPOLYLOOP #${id} → #${p} 는 point 가 아님(${pe.name})`);
        loopPointIds.add(p);
      }
    } else if (e.name === 'IFCFACE') faces++;
    else if (e.name === 'IFCCLOSEDSHELL') {
      const shellFaces = (e.raw.match(/#\d+/g) ?? []).length;
      if (shellFaces < 4) errors.push(`IFCCLOSEDSHELL #${id} 페이스 ${shellFaces}개(<4) — 폐셸 불성립`);
    }
  }
  if (expected?.brepPoints !== undefined && loopPointIds.size !== expected.brepPoints) {
    errors.push(`루프 정점 수 불일치: 기대 ${expected.brepPoints} ≠ 실제 ${loopPointIds.size}`);
  }
  return { ok: errors.length === 0, errors, stats: { entities: ents.size, loopPoints: loopPointIds.size, faces, refsChecked } };
}
