/**
 * dwgImport.ts — DWG(바이너리) → ASCII DXF 변환 (GNU LibreDWG WASM, 2026-07-18).
 *
 * 정직 원칙: 독점 포맷 파서를 직접 "날조"하지 않는다 — 실제 파싱은 GNU LibreDWG
 * (GPLv3, WASM 포트 @mlightcad/libredwg-web)가 수행하고, 여기서는 그 결과
 * DwgDatabase 엔티티를 **결정론적으로** ASCII DXF(그룹코드 페어)로 다시 쓴다.
 * 하류(dxf-seed 씨앗 추출·수치지형 등고 인입·클라이언트 2D 압출)는 기존
 * DXF 경로를 그대로 재사용한다 — DWG 전용 하류 없음.
 *
 * 근사가 개입하는 지점은 전부 stats 로 보고한다(무단 근사 금지):
 *  - SPLINE → fitPoints/controlPoints 폴리라인 근사 (approximatedSplines)
 *  - ELLIPSE / 비등방 스케일 INSERT 하의 원·호 → 테셀레이션 (tessellated)
 *  - 미지원 엔티티(HATCH·IMAGE·3DSOLID 등)는 건너뛰고 집계 (skipped)
 *
 * 라이선스: LibreDWG=GPLv3. 서버 측 실행(배포·재배포 없음)으로 사용 —
 * 소스 공개 의무는 소프트웨어 "배포" 시에만 발생한다(서버 사용은 비배포).
 */

import { parseSabBodies } from './satImport';

interface Pt {
  x?: number;
  y?: number;
  z?: number;
}

interface DwgEnt {
  type: string;
  layer?: string;
  [k: string]: unknown;
}

interface BlockRecord {
  name?: string;
  basePoint?: Pt;
  entities?: DwgEnt[];
}

export interface DwgDb {
  entities?: DwgEnt[];
  tables?: { BLOCK_RECORD?: { entries?: BlockRecord[] } };
  header?: Record<string, unknown>;
}

export interface DwgConvertStats {
  emitted: number;
  entityCounts: Record<string, number>;
  skipped: Record<string, number>;
  approximatedSplines: number;
  tessellated: number;
  blockInserts: number;
  layers: string[];
  truncated: boolean;
  /** 모델 공간이 비어 블록 정의를 항등 배치로 방출한 수(시트 뷰·미삽입 블록 관례) */
  fallbackBlocks?: number;
}

/** 2D 아핀 변환: world = M · local  (M = [a b tx; c d ty]) */
interface Aff {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

const IDENT: Aff = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function affApply(m: Aff, x: number, y: number): [number, number] {
  return [m.a * x + m.b * y + m.tx, m.c * x + m.d * y + m.ty];
}

function affCompose(outer: Aff, inner: Aff): Aff {
  return {
    a: outer.a * inner.a + outer.b * inner.c,
    b: outer.a * inner.b + outer.b * inner.d,
    c: outer.c * inner.a + outer.d * inner.c,
    d: outer.c * inner.b + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.b * inner.ty + outer.tx,
    ty: outer.c * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

/** INSERT(삽입점·회전·스케일·블록 기준점) → 아핀. 회전은 라디안. */
function insertAff(ins: DwgEnt, base: Pt | undefined): Aff {
  const sx = num(ins.xScale, 1);
  const sy = num(ins.yScale, 1);
  const rot = num(ins.rotation, 0);
  const ip = (ins.insertionPoint ?? {}) as Pt;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  // world = T(ip) · R(rot) · S(sx,sy) · T(-base)
  const m: Aff = { a: cosR * sx, b: -sinR * sy, c: sinR * sx, d: cosR * sy, tx: num(ip.x, 0), ty: num(ip.y, 0) };
  const bx = num(base?.x, 0);
  const by = num(base?.y, 0);
  return affCompose(m, { ...IDENT, tx: -bx, ty: -by });
}

/** 아핀이 등방(회전+균일 스케일, 미러 없음)이면 원/호를 원/호로 보존 가능. */
function isConformal(m: Aff): boolean {
  const s1 = Math.hypot(m.a, m.c);
  const s2 = Math.hypot(m.b, m.d);
  const det = m.a * m.d - m.b * m.c;
  return det > 0 && Math.abs(s1 - s2) < 1e-9 * Math.max(1, s1);
}

function num(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
}

function fmt(n: number): string {
  return String(+n.toFixed(6));
}

/** MTEXT 인라인 서식 코드 제거({\f...;}, \P, \A1; 등) — 표시 텍스트만. */
export function stripMtextCodes(s: string): string {
  return s
    .replace(/\{\\[^;{}]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

const DEG = 180 / Math.PI;

/**
 * DwgDatabase → ASCII DXF(ENTITIES 섹션). 결정론 — AI 미사용.
 * 모델 공간 엔티티 + INSERT 블록 전개(깊이 ≤4, 행/열 배열 포함).
 */
export function dwgDatabaseToDxf(
  db: DwgDb,
  { maxEntities = 150_000 }: { maxEntities?: number } = {},
): { dxfText: string; stats: DwgConvertStats } {
  const stats: DwgConvertStats = {
    emitted: 0,
    entityCounts: {},
    skipped: {},
    approximatedSplines: 0,
    tessellated: 0,
    blockInserts: 0,
    layers: [],
    truncated: false,
  };
  const layers = new Set<string>();
  const blocks = new Map<string, BlockRecord>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (b?.name) blocks.set(b.name, b);
  }

  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const pair = (code: number, val: string | number) => {
    out.push(String(code), typeof val === 'number' ? fmt(val) : val);
  };

  const emitHeader = (type: string, e: DwgEnt) => {
    pair(0, type);
    const layer = typeof e.layer === 'string' && e.layer ? e.layer : '0';
    layers.add(layer);
    pair(8, layer);
    stats.emitted++;
    stats.entityCounts[type] = (stats.entityCounts[type] ?? 0) + 1;
  };

  const emitPolyline = (e: DwgEnt, pts: Array<[number, number]>, zs: number[], bulges?: number[]) => {
    if (pts.length < 2) return;
    const hasZ = zs.length === pts.length && zs.some((z) => Math.abs(z) > 1e-9);
    if (hasZ) {
      // 3D 폴리라인 — 수치지형 등고 인입(parseDxfContours)이 읽는 POLYLINE/VERTEX/SEQEND 형식
      emitHeader('POLYLINE', e);
      pair(66, 1);
      for (let i = 0; i < pts.length; i++) {
        pair(0, 'VERTEX');
        pair(8, typeof e.layer === 'string' && e.layer ? e.layer : '0');
        pair(10, pts[i][0]);
        pair(20, pts[i][1]);
        pair(30, zs[i]);
      }
      pair(0, 'SEQEND');
    } else {
      emitHeader('LWPOLYLINE', e);
      pair(90, pts.length);
      const elev = num(e.elevation, 0);
      if (Math.abs(elev) > 1e-9) pair(38, elev);
      if (num((e as { flag?: number }).flag, 0) & 512) pair(70, 1); // closed
      for (let i = 0; i < pts.length; i++) {
        pair(10, pts[i][0]);
        pair(20, pts[i][1]);
        if (bulges && Math.abs(bulges[i] ?? 0) > 1e-12) pair(42, bulges[i]);
      }
    }
  };

  /** 원/호를 폴리라인으로 테셀레이션(비등방 변환 하에서만 — 근사는 집계). */
  const tessellate = (e: DwgEnt, m: Aff, cx: number, cy: number, r: number, a0: number, a1: number) => {
    stats.tessellated++;
    const sweep = a1 > a0 ? a1 - a0 : a1 - a0 + 2 * Math.PI;
    const n = Math.max(8, Math.min(64, Math.ceil((sweep / (2 * Math.PI)) * 48)));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      pts.push(affApply(m, cx + r * Math.cos(t), cy + r * Math.sin(t)));
    }
    emitPolyline(e, pts, []);
  };

  const walk = (ents: DwgEnt[], m: Aff, depth: number) => {
    for (const e of ents) {
      if (stats.emitted >= maxEntities) {
        stats.truncated = true;
        return;
      }
      const t = e.type;
      if (t === 'LINE') {
        const p1 = (e.startPoint ?? {}) as Pt;
        const p2 = (e.endPoint ?? {}) as Pt;
        const [x1, y1] = affApply(m, num(p1.x, 0), num(p1.y, 0));
        const [x2, y2] = affApply(m, num(p2.x, 0), num(p2.y, 0));
        emitHeader('LINE', e);
        pair(10, x1);
        pair(20, y1);
        pair(30, num(p1.z, 0));
        pair(11, x2);
        pair(21, y2);
        pair(31, num(p2.z, 0));
      } else if (t === 'CIRCLE' || t === 'ARC') {
        const c = (e.center ?? {}) as Pt;
        const r0 = num(e.radius, 0);
        if (r0 <= 0) continue;
        const a0 = t === 'ARC' ? num(e.startAngle, 0) : 0;
        const a1 = t === 'ARC' ? num(e.endAngle, 2 * Math.PI) : 2 * Math.PI;
        if (isConformal(m)) {
          const s = Math.hypot(m.a, m.c);
          const rotM = Math.atan2(m.c, m.a);
          const [cx, cy] = affApply(m, num(c.x, 0), num(c.y, 0));
          emitHeader(t, e);
          pair(10, cx);
          pair(20, cy);
          pair(40, r0 * s);
          if (t === 'ARC') {
            pair(50, (a0 + rotM) * DEG);
            pair(51, (a1 + rotM) * DEG);
          }
        } else {
          tessellate(e, m, num(c.x, 0), num(c.y, 0), r0, a0, a1);
        }
      } else if (t === 'ELLIPSE') {
        // DXF ELLIPSE 재현 대신 폴리라인 테셀레이션(하류 파서 공통 지원 범위) — 근사 집계
        const c = (e.center ?? {}) as Pt;
        const mj = (e.majorAxisEndPoint ?? {}) as Pt;
        const ratio = num(e.axisRatio, 1);
        const mjx = num(mj.x, 0);
        const mjy = num(mj.y, 0);
        const a0 = num(e.startAngle, 0);
        const a1e = num(e.endAngle, 2 * Math.PI);
        stats.tessellated++;
        const sweep = a1e > a0 ? a1e - a0 : a1e - a0 + 2 * Math.PI;
        const n = Math.max(12, Math.min(64, Math.ceil((sweep / (2 * Math.PI)) * 48)));
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= n; i++) {
          const tt = a0 + (sweep * i) / n;
          const lx = num(c.x, 0) + mjx * Math.cos(tt) - mjy * ratio * Math.sin(tt);
          const ly = num(c.y, 0) + mjy * Math.cos(tt) + mjx * ratio * Math.sin(tt);
          pts.push(affApply(m, lx, ly));
        }
        emitPolyline(e, pts, []);
      } else if (t === 'LWPOLYLINE') {
        const vs = (e.vertices ?? []) as Array<Pt & { bulge?: number }>;
        const pts = vs.map((v) => affApply(m, num(v.x, 0), num(v.y, 0)));
        emitPolyline(e, pts, [], vs.map((v) => num(v.bulge, 0)));
      } else if (t === 'POLYLINE2D' || t === 'POLYLINE3D') {
        const vs = (e.vertices ?? []) as Pt[];
        const pts = vs.map((v) => affApply(m, num(v.x, 0), num(v.y, 0)));
        emitPolyline(e, pts, vs.map((v) => num(v.z, 0)));
      } else if (t === 'SPLINE') {
        const fit = (e.fitPoints ?? []) as Pt[];
        const ctrl = (e.controlPoints ?? []) as Pt[];
        const src = fit.length >= 2 ? fit : ctrl;
        if (src.length >= 2) {
          stats.approximatedSplines++;
          emitPolyline(e, src.map((v) => affApply(m, num(v.x, 0), num(v.y, 0))), []);
        }
      } else if (t === 'TEXT' || t === 'MTEXT') {
        const raw = typeof e.text === 'string' ? e.text : '';
        const txt = t === 'MTEXT' ? stripMtextCodes(raw) : raw.trim();
        if (txt) {
          const ip = ((e.insertionPoint ?? e.startPoint) ?? {}) as Pt;
          const [x, y] = affApply(m, num(ip.x, 0), num(ip.y, 0));
          emitHeader('TEXT', e);
          pair(1, txt.slice(0, 250));
          pair(10, x);
          pair(20, y);
          pair(40, num(e.textHeight, 0));
        }
      } else if (t === 'DIMENSION') {
        const meas = num(e.measurement, NaN);
        const dtext = typeof e.text === 'string' ? e.text.trim() : '';
        emitHeader('DIMENSION', e);
        if (Number.isFinite(meas) && meas > 0) pair(42, meas);
        if (dtext && dtext !== '<>') pair(1, dtext.slice(0, 80));
      } else if (t === 'INSERT') {
        const name = typeof e.name === 'string' ? e.name : '';
        const blk = blocks.get(name);
        if (!blk?.entities?.length || depth >= 4) {
          stats.skipped[t] = (stats.skipped[t] ?? 0) + 1;
          continue;
        }
        stats.blockInserts++;
        const cols = Math.max(1, Math.trunc(num(e.columnCount, 1)));
        const rows = Math.max(1, Math.trunc(num(e.rowCount, 1)));
        const colSp = num(e.columnSpacing, 0);
        const rowSp = num(e.rowSpacing, 0);
        const base = insertAff(e, blk.basePoint);
        for (let ci = 0; ci < Math.min(cols, 64); ci++) {
          for (let ri = 0; ri < Math.min(rows, 64); ri++) {
            const local = ci === 0 && ri === 0 ? base : affCompose(base, { ...IDENT, tx: ci * colSp, ty: ri * rowSp });
            walk(blk.entities, affCompose(m, local), depth + 1);
            if (stats.truncated) return;
          }
        }
      } else {
        stats.skipped[t] = (stats.skipped[t] ?? 0) + 1;
      }
    }
  };

  walk(db.entities ?? [], IDENT, 0);
  if (stats.emitted === 0) {
    // 모델 공간 무방출 폴백: 기하가 미삽입 블록/시트 뷰 블록에 있는 관례
    // (SolidWorks eDrawings 시트 익스포트=Assembly*_VIEW*, 렌더 전용 INSERT 등).
    // 루트 블록(다른 블록이 INSERT 로 참조하지 않는 것)만 항등 배치로 방출 —
    // 중첩 INSERT 는 기존 전개를 그대로 타므로 이중 방출이 없다.
    const referenced = new Set<string>();
    const collectRefs = (ents: DwgEnt[] | undefined) => {
      for (const e of ents ?? []) if (e.type === 'INSERT' && typeof e.name === 'string') referenced.add(e.name);
    };
    collectRefs(db.entities);
    for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) collectRefs(b.entities);
    let used = 0;
    for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
      if (!b?.entities?.length || b.name === '*Model_Space' || (b.name && referenced.has(b.name))) continue;
      const before = stats.emitted;
      walk(b.entities, IDENT, 1);
      if (stats.emitted > before) used++;
      if (stats.truncated) break;
    }
    if (used) stats.fallbackBlocks = used;
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  stats.layers = [...layers].slice(0, 40);
  return { dxfText: out.join('\n'), stats };
}

// ── WASM 로더(서버 전용) ────────────────────────────────────────────────────
// webpack 정적 분석 우회: Emscripten 글루는 번들 불가(planegcs 전례) —
// webpackIgnore 동적 import 로 런타임 Node 해석. standalone 배포 시
// node_modules/@mlightcad/libredwg-web 를 Dockerfile 에서 명시 COPY.
type LibredwgModule = {
  LibreDwg: { create(): Promise<LibredwgApi> };
  Dwg_File_Type: { DWG: number };
};
interface LibredwgApi {
  dwg_read_data(data: ArrayBuffer | string, type: number): unknown;
  convert(dwg: unknown): DwgDb;
  dwg_free(dwg: unknown): void;
}

let _libPromise: Promise<{ mod: LibredwgModule; api: LibredwgApi }> | null = null;
async function loadLibredwg(): Promise<{ mod: LibredwgModule; api: LibredwgApi }> {
  if (!_libPromise) {
    _libPromise = (async () => {
      const mod = (await import(/* webpackIgnore: true */ '@mlightcad/libredwg-web')) as unknown as LibredwgModule;
      const api = await mod.LibreDwg.create();
      return { mod, api };
    })();
  }
  return _libPromise;
}

export interface DwgReadResult {
  ok: boolean;
  dxfText?: string;
  stats?: DwgConvertStats;
  error?: string;
  /** 2D 요소는 없지만 3D 폴리페이스 메시가 감지됨 — 3D 임포트(import-step fmt=dwg) 경로 안내 */
  mesh3dLikely?: boolean;
}

/** DWG 바이너리 → DXF. 파싱 실패(미지원 버전 등)는 정직하게 오류 반환. */
export async function readDwgToDxf(buf: ArrayBuffer, opts: { maxEntities?: number } = {}): Promise<DwgReadResult> {
  let lib: { mod: LibredwgModule; api: LibredwgApi };
  try {
    lib = await loadLibredwg();
  } catch (e) {
    return { ok: false, error: `LibreDWG 모듈 로드 실패: ${String(e instanceof Error ? e.message : e).slice(0, 120)}` };
  }
  let dwg: unknown = null;
  try {
    dwg = lib.api.dwg_read_data(buf, lib.mod.Dwg_File_Type.DWG);
    if (!dwg) return { ok: false, error: 'DWG 파싱 실패 — 손상되었거나 LibreDWG 미지원 버전(예: 일부 2018+ 신형식)일 수 있습니다. AutoCAD/DWG TrueView에서 DXF(ASCII) 또는 2013 형식으로 저장 후 재시도하세요.' };
    const db = lib.api.convert(dwg);
    const { dxfText, stats } = dwgDatabaseToDxf(db, opts);
    if (!stats.emitted) {
      // 2D 요소 부재 — 원시 스캔으로 3D 형상(폴리페이스 메시·ACIS 솔리드) 감지
      const c3 = countRaw3d(lib.api, dwg);
      if (c3.pfaces > 0 || c3.solids > 0) return { ok: false, mesh3dLikely: true, error: `2D 도면 요소가 없고 3D 형상(폴리페이스 ${c3.pfaces}·솔리드 ${c3.solids})이 감지되었습니다 — 3D 임포트 경로로 전환하세요.` };
      return { ok: false, error: `지원 엔티티가 없습니다 — 발견된 유형: ${Object.keys(stats.skipped).join(', ') || '없음'}` };
    }
    return { ok: true, dxfText, stats };
  } catch (e) {
    return { ok: false, error: `DWG 변환 오류: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` };
  } finally {
    try {
      if (dwg) lib.api.dwg_free(dwg);
    } catch {
      /* free 실패는 무시(프로세스 수명 짧음) */
    }
  }
}

// ── 3D 폴리페이스 메시 → 어셈블리(부품별 월드 AABB box — STEP 임포트와 동일 근사 규약) ──
// Revit/스케치업 계열 DWG 익스포트는 형상을 POLYLINE_PFACE(정점 메시)로 담는다 —
// mlightcad 변환기가 이 유형을 건너뛰므로 LibreDWG 원시 API(소유 엔티티 순회)로 직접 추출.
// 면 인덱스(vertind)는 WASM dynapi 로 접근 불가 → 부품 형상은 정점 클라우드의 AABB box
// 근사로 방출(배치·치수=정확, 형상=box 근사 명시). 부피=AABB 기준 과대측 — note 에 명시.

interface RawApi {
  dwg_get_num_objects?: (dwg: unknown) => number;
  dwg_get_object?: (dwg: unknown, i: number) => unknown;
  dwg_object_get_dxfname?: (o: unknown) => string;
  dwg_object_to_object_tio?: (o: unknown) => unknown;
  dwg_object_to_entity_tio?: (o: unknown) => unknown;
  dwg_dynapi_entity_data?: (tio: unknown, field: string) => unknown;
  get_first_owned_entity?: (blk: unknown) => unknown;
  get_next_owned_entity?: (blk: unknown, e: unknown) => unknown;
  get_first_owned_subentity?: (e: unknown) => unknown;
  get_next_owned_subentity?: (e: unknown, s: unknown) => unknown;
  dwg_ptr_to_unsigned_char_array?: (ptr: number, len: number) => ArrayLike<number>;
}

/** 3DSOLID 원시 스캔 → SAB 바이트 배열 수집(version 2=SAB · acis_data 포인터+sab_size). */
function collectSolidSabs(api: LibredwgApi, dwg: unknown, maxSolids: number, maxTotalBytes: number): Uint8Array[] {
  const raw = api as unknown as RawApi;
  const out: Uint8Array[] = [];
  if (!raw.dwg_get_num_objects || !raw.dwg_get_object || !raw.dwg_object_get_dxfname || !raw.dwg_object_to_entity_tio || !raw.dwg_dynapi_entity_data || !raw.dwg_ptr_to_unsigned_char_array) return out;
  const n = raw.dwg_get_num_objects(dwg);
  let budget = maxTotalBytes;
  for (let i = 0; i < n && out.length < maxSolids && budget > 0; i++) {
    const o = raw.dwg_get_object(dwg, i);
    const dxfname = raw.dwg_object_get_dxfname(o);
    if (dxfname !== '3DSOLID' && dxfname !== 'REGION' && dxfname !== 'BODY') continue;
    const tio = raw.dwg_object_to_entity_tio(o);
    const ptr = Number(raw.dwg_dynapi_entity_data(tio, 'acis_data'));
    const size = Number(raw.dwg_dynapi_entity_data(tio, 'sab_size'));
    if (!Number.isFinite(ptr) || ptr <= 0 || !Number.isFinite(size) || size <= 20 || size > budget) continue;
    try {
      const arr = raw.dwg_ptr_to_unsigned_char_array(ptr, size);
      const bytes = Uint8Array.from(arr as ArrayLike<number>);
      const sig = String.fromCharCode(...bytes.slice(0, 15));
      if (sig === 'ACIS BinaryFile' || sig === 'ASM BinaryFile4') {
        out.push(bytes);
        budget -= size;
      }
    } catch {
      /* 포인터 접근 실패 — 건너뜀 */
    }
  }
  return out;
}

function countRaw3d(api: LibredwgApi, dwg: unknown): { pfaces: number; solids: number } {
  const raw = api as unknown as RawApi;
  const out = { pfaces: 0, solids: 0 };
  if (!raw.dwg_get_num_objects || !raw.dwg_get_object || !raw.dwg_object_get_dxfname) return out;
  const n = raw.dwg_get_num_objects(dwg);
  for (let i = 0; i < n; i++) {
    const t = raw.dwg_object_get_dxfname(raw.dwg_get_object(dwg, i));
    if (t === 'POLYLINE_PFACE') out.pfaces++;
    else if (t === '3DSOLID' || t === 'REGION' || t === 'BODY') out.solids++;
  }
  return out;
}

/** 블록명 → 폴리페이스 정점 클라우드 목록(원시 소유 순회). 정점 총량 캡=2M. */
function collectPfaceClouds(api: LibredwgApi, dwg: unknown): Map<string, number[][][]> {
  const raw = api as unknown as RawApi;
  const out = new Map<string, number[][][]>();
  if (!raw.dwg_get_num_objects || !raw.dwg_get_object || !raw.dwg_object_get_dxfname || !raw.dwg_object_to_object_tio || !raw.dwg_dynapi_entity_data || !raw.get_first_owned_entity || !raw.get_next_owned_entity || !raw.get_first_owned_subentity || !raw.get_next_owned_subentity) return out;
  const n = raw.dwg_get_num_objects(dwg);
  let vertBudget = 2_000_000;
  for (let i = 0; i < n && vertBudget > 0; i++) {
    const o = raw.dwg_get_object(dwg, i);
    if (raw.dwg_object_get_dxfname(o) !== 'BLOCK_HEADER') continue;
    const tio = raw.dwg_object_to_object_tio(o);
    const bname = String(raw.dwg_dynapi_entity_data(tio, 'name') ?? '');
    const clouds: number[][][] = [];
    let e = raw.get_first_owned_entity(o);
    let guard = 0;
    while (e && guard++ < 200_000 && vertBudget > 0) {
      if (raw.dwg_object_get_dxfname(e) === 'POLYLINE_PFACE') {
        const verts: number[][] = [];
        let s = raw.get_first_owned_subentity(e);
        let sg = 0;
        while (s && sg++ < 100_000 && vertBudget > 0) {
          if (raw.dwg_object_get_dxfname(s) === 'VERTEX_PFACE') {
            const st = raw.dwg_object_to_entity_tio?.(s);
            const p = raw.dwg_dynapi_entity_data(st, 'point') as Pt | undefined;
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
              verts.push([num(p.x, 0), num(p.y, 0), num(p.z, 0)]);
              vertBudget--;
            }
          }
          s = raw.get_next_owned_subentity(e, s);
        }
        if (verts.length >= 3) clouds.push(verts);
      }
      e = raw.get_next_owned_entity(o, e);
    }
    if (clouds.length) out.set(bname, clouds);
  }
  return out;
}

/** DWG $INSUNITS → mm 배율(0/미지=1 그대로, note 에 명시). */
function insunitsScale(v: unknown): { scale: number; label: string } {
  switch (num(v, 0)) {
    case 1: return { scale: 25.4, label: 'inch→mm' };
    case 2: return { scale: 304.8, label: 'ft→mm' };
    case 4: return { scale: 1, label: 'mm' };
    case 5: return { scale: 10, label: 'cm→mm' };
    case 6: return { scale: 1000, label: 'm→mm' };
    default: return { scale: 1, label: '단위 미선언(원값 유지)' };
  }
}

export interface DwgAssemblyResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string; qty?: number }>;
    note: string;
  };
  stats?: { pfaces: number; blocks: number; inserts: number; parts: number; skippedNestedInserts: number; unit: string; representative?: boolean };
}

/** ACIS 솔리드(SAB) 목록 → 어셈블리(바디별 AABB box — satImport 공용 파서). */
function solidsToAssembly(sabs: Uint8Array[], name: string): DwgAssemblyResult {
  type P = DwgAssemblyResult['assembly'] extends infer A ? (A extends { parts: Array<infer Q> } ? Q : never) : never;
  const parts: P[] = [];
  let bodiesTotal = 0;
  let failed = 0;
  let unit = 1;
  for (let si = 0; si < sabs.length; si++) {
    const r = parseSabBodies(sabs[si]);
    if (!r.ok || !r.bodies) { failed++; continue; }
    const s = r.unitMm && r.unitMm > 0 ? r.unitMm : 1;
    unit = s;
    for (const b of r.bodies) {
      if (!b.aabb) continue;
      bodiesTotal++;
      if (parts.length >= 600) continue;
      const [mnx, mny, mnz] = b.aabb.min;
      const [mxx, mxy, mxz] = b.aabb.max;
      parts.push({
        id: `sol${si + 1}_b${parts.length + 1}`,
        type: 'box',
        params: {
          width: +Math.max(0.5, (mxx - mnx) * s).toFixed(1),
          depth: +Math.max(0.5, (mxy - mny) * s).toFixed(1),
          height: +Math.max(0.5, (mxz - mnz) * s).toFixed(1),
        },
        at: { tx: +(mnx * s).toFixed(1), ty: +(mny * s).toFixed(1), tz: +(mnz * s).toFixed(1) },
        role: 'imported',
        material: 'steel',
      } as P);
    }
  }
  if (!parts.length) return { ok: false, error: `ACIS 솔리드 ${sabs.length}개에서 바디를 추출하지 못했습니다(SAB 부분 파싱 ${failed}건 실패).` };
  const representative = bodiesTotal > 600;
  return {
    ok: true,
    assembly: {
      name,
      domain: 'mech',
      importedApprox: true,
      parts,
      note: `DWG ACIS 솔리드 임포트 근사(바디=SAB 경계 정점 점군의 월드 AABB box — B-rep 곡면 미재구성) · 질량/물량=AABB 체적 기준(과대측) · 재질=미해석 기본값 · 단위=${unit}mm/단위${failed ? ` · SAB ${failed}건 파싱 실패(집계)` : ''}${representative ? ` · 바디 600 예산 초과(전체 ${bodiesTotal}) — 앞 600개만` : ''}`,
    },
    stats: { pfaces: 0, blocks: 0, inserts: 0, parts: parts.length, skippedNestedInserts: 0, unit: `${unit}mm/단위(SAB)`, ...(representative ? { representative: true } : {}) },
  };
}

/** 3D 메시 DWG(Revit 계열 익스포트) → NexyFab 어셈블리(부품별 월드 AABB box). */
export async function dwgToNexyfabAssembly(buf: ArrayBuffer, { name = 'DWG import' } = {}): Promise<DwgAssemblyResult> {
  let lib: { mod: LibredwgModule; api: LibredwgApi };
  try {
    lib = await loadLibredwg();
  } catch (e) {
    return { ok: false, error: `LibreDWG 모듈 로드 실패: ${String(e instanceof Error ? e.message : e).slice(0, 120)}` };
  }
  let dwg: unknown = null;
  try {
    dwg = lib.api.dwg_read_data(buf, lib.mod.Dwg_File_Type.DWG);
    if (!dwg) return { ok: false, error: 'DWG 파싱 실패 — LibreDWG 미지원 버전일 수 있습니다.' };
    const db = lib.api.convert(dwg);
    const clouds = collectPfaceClouds(lib.api, dwg);
    if (!clouds.size) {
      // 폴리페이스가 없으면 ACIS 솔리드(SAB) 경로 — 솔리드별 SAT/SAB 바디 AABB
      const sabs = collectSolidSabs(lib.api, dwg, 2000, 400_000_000);
      if (sabs.length) return solidsToAssembly(sabs, name);
      const c3 = countRaw3d(lib.api, dwg);
      if (c3.solids > 0) return { ok: false, error: `3DSOLID ${c3.solids}개가 있으나 ACIS 데이터가 비어 있습니다(acis_empty — 저장 시 스트림 제거 또는 LibreDWG 미지원 버전). 원본 CAD에서 STEP 재내보내기가 필요합니다.` };
      return { ok: false, error: '3D 폴리페이스 메시·ACIS 솔리드가 없습니다 — 2D 도면이면 dwg-convert(씨앗) 경로를 사용하세요.' };
    }
    const { scale, label } = insunitsScale((db.header as Record<string, unknown> | undefined)?.INSUNITS);

    type P = { id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string; qty?: number };
    const parts: P[] = [];
    let pfaceTotal = 0;
    let skippedNested = 0;
    const pushCloud = (verts: number[][], m: Aff | null, zOff: number, zScale: number, label2: string) => {
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (const [x, y, z] of verts) {
        const [wx, wy] = m ? affApply(m, x, y) : [x, y];
        const wz = z * zScale + zOff;
        if (wx < mnx) mnx = wx;
        if (wx > mxx) mxx = wx;
        if (wy < mny) mny = wy;
        if (wy > mxy) mxy = wy;
        if (wz < mnz) mnz = wz;
        if (wz > mxz) mxz = wz;
      }
      if (!Number.isFinite(mnx)) return;
      const w = Math.max(0.5, (mxx - mnx) * scale);
      const d = Math.max(0.5, (mxy - mny) * scale);
      const h = Math.max(0.5, (mxz - mnz) * scale);
      parts.push({
        id: `p${parts.length + 1}_${label2.replace(/[^A-Za-z0-9가-힣]+/g, '_').slice(0, 24) || 'pface'}`,
        type: 'box',
        params: { width: +w.toFixed(1), depth: +d.toFixed(1), height: +h.toFixed(1) },
        at: { tx: +(mnx * scale).toFixed(1), ty: +(mny * scale).toFixed(1), tz: +(mnz * scale).toFixed(1) },
        role: 'imported',
        material: 'steel',
      });
    };

    // ① 모델 공간 직접 폴리페이스(배치=항등)
    for (const [bname, cl] of clouds) {
      if (bname !== '*Model_Space') continue;
      for (const verts of cl) {
        pfaceTotal++;
        if (parts.length < 600) pushCloud(verts, null, 0, 1, 'model');
      }
    }
    // ② INSERT 배치 × 블록 폴리페이스(변환된 db 의 모델 공간 INSERT 사용 — 중첩 INSERT 는 집계만)
    const basePoints = new Map<string, Pt>();
    for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
      if (b?.name && b.basePoint) basePoints.set(b.name, b.basePoint);
    }
    let inserts = 0;
    for (const e of db.entities ?? []) {
      if (e.type !== 'INSERT') continue;
      const bname = typeof e.name === 'string' ? e.name : '';
      const cl = clouds.get(bname);
      if (!cl) { skippedNested++; continue; }
      inserts++;
      const m = insertAff(e, basePoints.get(bname));
      const ip = (e.insertionPoint ?? {}) as Pt;
      const zOff = num(ip.z, 0);
      const zScale = num(e.zScale, 1);
      for (const verts of cl) {
        pfaceTotal++;
        if (parts.length < 600) pushCloud(verts, m, zOff, zScale, bname);
      }
    }
    if (!parts.length) return { ok: false, error: '폴리페이스는 있으나 배치를 해석하지 못했습니다(중첩 INSERT 전용 구조).' };
    const representative = pfaceTotal > 600;
    return {
      ok: true,
      assembly: {
        name,
        domain: 'mech',
        importedApprox: true,
        parts,
        note: `DWG 3D 메시 임포트 근사(부품=폴리페이스 정점 클라우드의 월드 AABB box — 면 데이터는 WASM 접근 불가로 미사용) · 질량/물량=AABB 체적 기준(과대측) · 재질=미해석 기본값 · 단위=${label}${representative ? ` · 부품 600 예산 초과(전체 ${pfaceTotal}) — 앞 600개만` : ''}`,
      },
      stats: { pfaces: pfaceTotal, blocks: clouds.size, inserts, parts: parts.length, skippedNestedInserts: skippedNested, unit: label, ...(representative ? { representative: true } : {}) },
    };
  } catch (e) {
    return { ok: false, error: `DWG 3D 임포트 오류: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` };
  } finally {
    try {
      if (dwg) lib.api.dwg_free(dwg);
    } catch {
      /* ignore */
    }
  }
}
