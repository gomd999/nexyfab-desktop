/**
 * xtImport.ts — Parasolid XT(x_t 텍스트 transmit) → NexyFab 어셈블리 (260718).
 *
 * 근거: 공개 Parasolid XT Format Reference(Siemens, 2006 — 13thmonkey 미러) +
 * 코퍼스 실파일 반복 검증(파이썬 프로토타입 → 본 포팅). 지원 범위(정직):
 *  - V14+ 임베디드 스키마(SCH_..._13006) 텍스트 transmit — 단품·단일 스트림 어셈블리
 *  - 비임베디드/V13 이전(SCH_30000·32001 등)·멀티파트 후속 스트림은 부분 파싱(≥70%
 *    소비 시 PARTIAL 명시) 또는 정직 거부(재내보내기 안내)
 * 형상 추출 = POINT(29) pvec 점군의 월드 AABB(단위=미터→mm ×1000) — B-rep 미재구성
 * (STEP/SAT/DWG 임포터와 동일한 "배치·전체 치수=정확, 형상=box 근사 명시" 규약).
 *
 * 스키마 테이블 유래(전부 실측 검증):
 *  - 스펙 예제 파일 토큰수 검증: body23·shell9·face14·loop5·edge10·fin10·region7·plane·circle
 *  - 임베디드 델타 역산: sp_curve tol=interval, vertex 'dpppppfp', chart hvec=pvec×3,
 *    transform=100, geometric_owner=141, b_curve=134, b_surface=124/59, nurbs 계열 125~128 등
 */

const BASE: Record<number, [string, string]> = {
  12: ['body', 'dppppppffpppupupppppppp'],
  13: ['shell', 'dpppppppp'],
  14: ['face', 'dpfpppppcppppp'],
  15: ['loop', 'dpppp'],
  16: ['edge', 'dpfppppppp'],
  17: ['fin', 'pppppppppc'],
  18: ['vertex', 'dpppppfp'],
  19: ['region', 'dpppppc'],
  29: ['point', 'dppppv'],
  30: ['line', 'dpppppcvv'],
  31: ['circle', 'dpppppcvvvf'],
  32: ['ellipse', 'dpppppcvvvff'],
  38: ['sp_curve', 'dpppppcpppip'],
  40: ['chart', 'ffdfff2H'],
  41: ['limit', 'cH'],
  45: ['bspline_vertices', 'F'],
  50: ['plane', 'dpppppcvvv'],
  51: ['cylinder', 'dpppppcvvfv'],
  52: ['cone', 'dpppppcvvfffv'],
  53: ['sphere', 'dpppppcvfvv'],
  54: ['torus', 'dpppppcvvffv'],
  56: ['blended_edge', 'dpppppccp2pf2f2p2pp'],
  59: ['b_surface', 'dpppppcpp'],
  66: ['swept_surf', 'dpppppcpvf'],
  67: ['spun_surf', 'dpppppcpvf'],
  70: ['list', 'dpppddddppdl'],
  74: ['pointer_lis_block', 'dpP'],
  79: ['att_def_id', 'C'],
  80: ['attrib_def', 'ppdu8pl14U'],
  81: ['attribute', 'dppppppP'],
  82: ['nodeid_values', 'D'],
  83: ['real_values', 'F'],
  84: ['char_values', 'C'],
  86: ['unicode_values', 'C'],
  98: ['unicode_values2', 'D'],
  10: ['assembly', 'dpppppppffpppupup'],
  11: ['instance', 'dpuppppppp'],
  100: ['transform', 'dpppf9vfdv'],
  124: ['b_surface2', 'dpppppcpp'],
  125: ['surface_data', 'd9c8f8'],
  126: ['nurbs_surf', 'lld8llld2p5'],
  127: ['knot_mult', 'N'],
  128: ['knot_set', 'F'],
  133: ['trimmed_curve', 'dpppppcpvvff'],
  134: ['b_curve', 'dpppppcpp'],
  135: ['curve_data', 'up'],
  136: ['nurbs_curve', 'ndndullluppp'],
  137: ['intersection', 'dpppppcp2pp'],
  141: ['geometric_owner', 'pppp'],
  // 204(INTERSECTION_DATA)는 기저 13006 에 없음 — 파일이 자체 선언(신규 타입 경로). BASE 에 넣으면 안 됨.
};

const NUM_RE = /[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/y;
const UNIT_RE = /[a-zA-Z]\d*/g;

class Reader {
  s: string;
  i = 0;
  n: number;
  constructor(text: string) {
    this.s = text.replace(/[\r\n]/g, '');
    this.n = this.s.length;
  }
  skipWs() {
    while (this.i < this.n && this.s.charCodeAt(this.i) === 32) this.i++;
  }
  peek(): string {
    this.skipWs();
    return this.i < this.n ? this.s[this.i] : '';
  }
  readChar(): string {
    this.skipWs();
    if (this.i >= this.n) throw new Error(`EOF@char ${this.i}`);
    return this.s[this.i++];
  }
  readNum(): number | null {
    this.skipWs();
    if (this.i < this.n && this.s[this.i] === '?') { this.i++; return null; }
    NUM_RE.lastIndex = this.i;
    const m = NUM_RE.exec(this.s);
    if (!m) throw new Error(`num expected@${this.i}`);
    this.i = NUM_RE.lastIndex;
    return parseFloat(m[0]);
  }
  readInt(): number | null {
    const p = this.i;
    const v = this.readNum();
    if (v === null) return null;
    if (!Number.isInteger(v)) throw new Error(`INT-DESYNC@${p}`); // 어긋남 검출(날조 방지 불변식)
    return v;
  }
  readSStr(): string {
    const ln = this.readInt();
    if (ln === null || ln < 0 || ln > 4096) throw new Error(`sstr len@${this.i}`);
    if (this.s[this.i] === ' ') this.i++;
    let raw = '';
    while (raw.length < ln) {
      const c = this.s[this.i++];
      if (c === undefined) throw new Error(`EOF@sstr ${this.i}`);
      if (c === '\\' && this.s[this.i] === '9') { this.i++; raw += '         '; }
      else raw += c;
    }
    return raw;
  }
}

function readDeltaField(r: Reader): string {
  r.readSStr(); // name
  const ptrClass = r.readInt() ?? 0;
  const nElts = r.readInt() ?? 0;
  let ftype = 'p';
  if (!ptrClass) ftype = (r.readSStr() || 'p')[0];
  let xmt = true;
  if (nElts === 1) xmt = r.readChar() === 'T';
  let code = ptrClass ? 'p' : ('dulcfvibhn'.includes(ftype) ? ftype : 'f');
  if (nElts === 1) code = code.toUpperCase();
  else if (nElts > 1) code = code + String(nElts);
  return xmt || code[0] === code[0].toUpperCase() ? code : '';
}

function applyDelta(r: Reader, baseFields: string): string {
  r.skipWs();
  const save = r.i;
  // 255 = base 일치
  if (r.s.startsWith('255', r.i) && (r.s[r.i + 3] === ' ' || r.s[r.i + 3] === undefined)) {
    r.i += 3;
    return baseFields;
  }
  r.i = save;
  r.readInt(); // nfields(검증용 — 소비만)
  const units = baseFields.match(UNIT_RE) ?? [];
  const cur: string[] = [];
  let bi = 0;
  for (;;) {
    const op = r.readChar();
    if (op === 'Z') break;
    if (op === 'C') { cur.push(units[bi] ?? 'p'); bi++; }
    else if (op === 'D') bi++;
    else if (op === 'I' || op === 'A') { const c = readDeltaField(r); if (c) cur.push(c); }
    else throw new Error(`delta op ${op}@${r.i}`);
  }
  return cur.join('');
}

function parseNewType(r: Reader): { name: string; fields: string } {
  const nf = r.readInt() ?? 0;
  const name = r.readSStr();
  r.readSStr(); // desc
  const fields: string[] = [];
  for (let k = 0; k < nf; k++) { const c = readDeltaField(r); if (c) fields.push(c); }
  return { name, fields: fields.join('') };
}

export interface XtParseResult {
  ok: boolean;
  error?: string;
  bodies?: number;
  points?: Array<[number, number, number]>;
  nodes?: number;
  partial?: boolean;
  schema?: string;
}

/** XT 텍스트 → POINT 점군(미터). 결정론 파서 — 어긋남 검출 시 정직 오류. */
export function parseXt(text: string): XtParseResult {
  const hi = text.indexOf('END_OF_HEADER');
  if (hi < 0 || !text.includes('PARASOLID')) return { ok: false, error: 'Parasolid XT 헤더가 아닙니다.' };
  const r = new Reader(text.slice(text.indexOf('\n', hi) + 1));
  let schemaName = '';
  try {
    if (r.readChar() !== 'T') throw new Error('T-프리앰블 없음');
    const tlen = r.readInt() ?? 0;
    r.readChar(); // ':'
    r.skipWs();
    r.i += tlen; // 'TRANSMIT FILE created by modeller version NNN'
    // 스키마명 — 뒤 정수가 공백 없이 붙음: ver 자릿수-2 = 스키마 자릿수 관례
    r.skipWs();
    const mm = /SCH_(\d+)_/.exec(r.s.slice(r.i, r.i + 40));
    if (!mm) throw new Error('SCH_ 없음');
    const ver = mm[1];
    const bodyStart = r.i + mm[0].length;
    const schLen = ver.length - 2;
    const after = r.s.slice(bodyStart + schLen);
    schemaName = `SCH_${ver}_${r.s.slice(bodyStart, bodyStart + schLen)}`;
    const embedded = after.startsWith('_13006');
    r.i = bodyStart + schLen + (embedded ? 6 : 0);
    if (!embedded) {
      return { ok: false, error: `비임베디드 Parasolid 스키마(${schemaName}) — 레이아웃 미상(정직 거부). V14+ XT 또는 STEP 으로 재내보내기하세요.`, schema: schemaName };
    }
    r.readInt(); // maxtypes
    const usfld = r.readInt() ?? 0;

    const schema = new Map<number, string>();
    const names = new Map<number, string>();
    for (const [k, [nm, fl]] of Object.entries(BASE)) { schema.set(+k, fl); names.set(+k, nm); }
    const seen = new Set<number>();
    const used = new Set<number>();
    const points: Array<[number, number, number]> = [];
    let bodies = 0;
    let count = 0;
    let partial = false;

    const readFields = (fields: string): Array<number | null | string | Array<number | null>> => {
      const vals: Array<number | null | string | Array<number | null>> = [];
      const units = fields.match(UNIT_RE) ?? [];
      for (const u of units) {
        const c = u[0];
        const cnt = u.length > 1 ? parseInt(u.slice(1), 10) : 1;
        for (let k = 0; k < cnt; k++) {
          if ('dpun'.includes(c)) vals.push(r.readInt());
          else if (c === 'l' || c === 'c') vals.push(r.readChar());
          else if (c === 'f') vals.push(r.readNum());
          else if (c === 'v') {
            if (r.peek() === '?') { r.readChar(); vals.push(null); }
            else vals.push([r.readNum(), r.readNum(), r.readNum()]);
          } else if (c === 'i') { if (r.peek() === '?') r.readChar(); else { r.readNum(); r.readNum(); } }
          else if (c === 'b') { if (r.peek() === '?') r.readChar(); else for (let q = 0; q < 6; q++) r.readNum(); }
          else throw new Error(`field code ${c}`);
        }
      }
      return vals;
    };

    for (;;) {
      r.skipWs();
      if (r.i >= r.n) { partial = true; break; }
      const t = r.readInt();
      if (t === 1) {
        const idx0 = r.readInt();
        if (idx0 === 0) break;
        if (r.i > r.n * 0.7) { partial = true; break; } // 멀티파트 후속 스트림 — 부분 파싱 명시
        throw new Error('스트림 경계 불일치(멀티파트/미지 구조)');
      }
      if (t === null || t <= 0 || t > 300) throw new Error(`노드 타입 어긋남(${t})`);
      const first = !seen.has(t);
      if (first) seen.add(t);
      if (!schema.has(t)) {
        if (!first) throw new Error(`미지 타입 ${t}`);
        const nt = parseNewType(r);
        schema.set(t, nt.fields);
        names.set(t, nt.name);
      } else if (first) {
        schema.set(t, applyDelta(r, schema.get(t)!));
      }
      const fl = schema.get(t)!;
      const hasVar = /[A-Z]/.test(fl);
      const varlen = hasVar ? (r.readInt() ?? 0) : 0;
      const idx = r.readInt();
      if (idx === null || idx <= 0 || used.has(idx)) throw new Error(`인덱스 불변식 위반(${idx})`);
      used.add(idx);
      const basePart = fl.replace(/[A-Z]\d*/g, '');
      const vals = readFields(basePart);
      for (const ch of fl) {
        if (ch >= 'A' && ch <= 'Z') {
          const ec = ch.toLowerCase();
          if (ec === 'c' || ec === 'l') { for (let k = 0; k < varlen; k++) r.readChar(); }
          else if ('dpun'.includes(ec)) { for (let k = 0; k < varlen; k++) r.readInt(); }
          else if (ec === 'f') { for (let k = 0; k < varlen; k++) r.readNum(); }
          else if (ec === 'h') { for (let k = 0; k < varlen * 3; k++) r.readNum(); } // hvec=pvec 3f
        }
      }
      if (usfld) for (let k = 0; k < usfld; k++) r.readInt();
      const nm = names.get(t);
      if (nm === 'point') {
        const v = vals[vals.length - 1];
        if (Array.isArray(v) && v.every((x) => typeof x === 'number')) points.push(v as [number, number, number]);
      } else if (nm === 'body') bodies++;
      if (++count > 5_000_000) throw new Error('노드 폭주');
    }
    if (!points.length) return { ok: false, error: `POINT 정점이 없습니다(노드 ${count} — 와이어/빈 파트).`, schema: schemaName };
    return { ok: true, bodies, points, nodes: count, partial, schema: schemaName };
  } catch (e) {
    return { ok: false, error: `XT 파싱 실패(${schemaName || '?'}): ${String(e instanceof Error ? e.message : e).slice(0, 100)} — 스키마 변형/멀티파트일 수 있음. STEP 재내보내기를 권합니다.`, schema: schemaName };
  }
}

export interface XtImportResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    /** 명시 충실도(W5-G): XT 는 B-rep 미재구성 — 항상 AABB 근사임을 기계가 읽을 수 있게 고정 */
    fidelity?: 'aabb-approximation';
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string; fidelity?: 'aabb-approximation' }>;
    note: string;
  };
  stats?: { nodes: number; bodies: number; points: number; partial?: boolean; schema?: string };
}

/** XT 텍스트 → NexyFab 어셈블리(전체 점군 월드 AABB box·m→mm). */
export function xtToNexyfabAssembly(text: string, { name = 'XT import' } = {}): XtImportResult {
  if (text.length > 100_000_000) return { ok: false, error: 'x_t 100MB 초과' };
  const rr = parseXt(text);
  if (!rr.ok || !rr.points) return { ok: false, error: rr.error };
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const [x, y, z] of rr.points) {
    if (x < mnx) mnx = x;
    if (x > mxx) mxx = x;
    if (y < mny) mny = y;
    if (y > mxy) mxy = y;
    if (z < mnz) mnz = z;
    if (z > mxz) mxz = z;
  }
  const S = 1000; // Parasolid 단위=미터 고정
  const part = {
    id: 'xt_model',
    type: 'box' as const,
    params: {
      width: +Math.max(0.5, (mxx - mnx) * S).toFixed(1),
      depth: +Math.max(0.5, (mxy - mny) * S).toFixed(1),
      height: +Math.max(0.5, (mxz - mnz) * S).toFixed(1),
    },
    at: { tx: +(mnx * S).toFixed(1), ty: +(mny * S).toFixed(1), tz: +(mnz * S).toFixed(1) },
    role: 'imported',
    material: 'steel',
    fidelity: 'aabb-approximation' as const,
  };
  return {
    ok: true,
    assembly: {
      name,
      domain: 'mech',
      importedApprox: true,
      fidelity: 'aabb-approximation',
      parts: [part],
      note: `Parasolid XT 임포트 근사(전체 모델=경계 정점 점군의 월드 AABB box 1개 — 곡면 극값·바디 분해 미포함) · 단위=m→mm · 질량/물량=AABB 체적 기준(과대측)${rr.partial ? ' · 멀티파트 후속 스트림 미포함(부분 파싱 명시)' : ''} · ${rr.schema ?? ''} 바디 ${rr.bodies}·정점 ${rr.points.length}`,
    },
    stats: { nodes: rr.nodes ?? 0, bodies: rr.bodies ?? 0, points: rr.points.length, ...(rr.partial ? { partial: true } : {}), schema: rr.schema },
  };
}
