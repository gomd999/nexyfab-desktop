/**
 * satImport.ts — ACIS SAT(텍스트) → NexyFab 어셈블리 (260718).
 *
 * SAT 텍스트는 공개 문서화된 레코드 스트림(`entity $ref ... #`)이다. 여기서는
 * B-rep 재구성을 주장하지 않고 — **바디별 토폴로지 그래프를 순회해 도달 가능한
 * point 레코드의 점군을 모아 월드 AABB box** 로 방출한다(STEP/DWG 3D 임포트와
 * 동일한 "배치·치수=정확, 형상=box 근사 명시" 규약). 근사·미해석은 전부 stats.
 *
 * 방언 2종 실측(코퍼스4): v400(ACIS 5.0, `-N entity ...` 인덱스 접두) ·
 * v700(ASM/Revit, 접두 없는 순차 인덱스). 3행 헤더의 첫 수 = 단위(mm/모델단위).
 *
 * attrib 레코드는 전역 체인($prev $next $owner)이 바디 경계를 넘으므로
 * 순회 화이트리스트(topo 타입)로 누수를 차단한다.
 */

const TOPO_TYPES = new Set([
  'body', 'lump', 'shell', 'subshell', 'face', 'loop', 'coedge', 'edge', 'vertex', 'wire', 'transform',
]);

interface SatRecord {
  type: string;
  refs: number[];
  nums: number[];
}

export interface SatBody {
  aabb: { min: [number, number, number]; max: [number, number, number] } | null;
  points: number;
}

export interface SatParseResult {
  ok: boolean;
  error?: string;
  bodies?: SatBody[];
  unitMm?: number;
  product?: string;
  stats?: { records: number; bodies: number; emptyBodies: number; points: number };
}

/** SAB(바이너리 ACIS) → 레코드 맵. 토큰 규약=공개 구현(ezdxf MIT) 대조 검증. */
export function parseSabRecords(bytes: Uint8Array): { records: Map<number, SatRecord>; unitMm: number; product: string } | { error: string } {
  const sigA = 'ACIS BinaryFile';
  const sigB = 'ASM BinaryFile4';
  const headStr = new TextDecoder('latin1').decode(bytes.slice(0, 15));
  if (headStr !== sigA && headStr !== sigB) return { error: 'SAB 시그니처가 아닙니다.' };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 15;
  const readInt = () => { const v = dv.getInt32(i, true); i += 4; return v; };
  const readDouble = () => { const v = dv.getFloat64(i, true); i += 8; return v; };
  const readStrN = (n: number) => { const s = new TextDecoder('latin1').decode(bytes.slice(i, i + n)); i += n; return s; };
  const readByte = () => bytes[i++];
  const expect = (tag: number, what: string) => { const t = readByte(); if (t !== tag) throw new Error(`SAB ${what} 태그 불일치(0x${t?.toString(16)})`); };
  let unitMm = 1;
  let product = '';
  try {
    readInt(); // version
    readInt(); // n_records
    readInt(); // n_entities
    readInt(); // flags
    expect(0x07, 'product'); product = readStrN(readByte()).slice(0, 60);
    expect(0x07, 'acisver'); readStrN(readByte());
    expect(0x07, 'date'); readStrN(readByte());
    expect(0x06, 'units'); unitMm = readDouble();
    expect(0x06, 'restol'); readDouble();
    expect(0x06, 'nortol'); readDouble();
  } catch (e) {
    return { error: `SAB 헤더 파싱 실패: ${String(e instanceof Error ? e.message : e).slice(0, 80)}` };
  }
  if (!(Number.isFinite(unitMm) && unitMm > 0)) unitMm = 1;

  const records = new Map<number, SatRecord>();
  let idx = 0;
  const N = bytes.length;
  try {
    let type = '';
    let typeParts: string[] = [];
    let refs: number[] = [];
    let nums: number[] = [];
    while (i < N) {
      const tag = readByte();
      switch (tag) {
        case 0x04: readInt(); break; // int — 치수 아님(카운트류), AABB 에 불필요
        case 0x15: readInt(); break; // enum
        case 0x06: nums.push(readDouble()); break;
        case 0x17: nums.push(readDouble()); break;
        case 0x07: readStrN(readByte()); break; // str
        case 0x12: readStrN(readInt()); break; // literal str
        case 0x0a: case 0x0b: break; // bool
        case 0x0c: { const r = readInt(); if (r >= 0) refs.push(r); break; } // pointer
        case 0x0d: { typeParts.push(readStrN(readByte())); if (!type) type = typeParts.join('-'); typeParts = []; break; }
        case 0x0e: typeParts.push(readStrN(readByte())); break;
        case 0x13: case 0x14: nums.push(readDouble(), readDouble(), readDouble()); break; // vec3
        case 0x0f: case 0x10: break; // subtype start/end
        case 0x11: { // record end
          records.set(idx++, { type: type || '?', refs, nums });
          type = ''; typeParts = []; refs = []; nums = [];
          break;
        }
        default:
          // 미지 태그 — 여기서 멈추고 지금까지의 레코드로 진행(정직: 부분 파싱 보고)
          i = N;
          break;
      }
    }
    if (type || refs.length || nums.length) records.set(idx++, { type: type || '?', refs, nums });
  } catch {
    /* 범위 밖 접근 — 지금까지 레코드로 진행 */
  }
  if (!records.size) return { error: 'SAB 레코드가 없습니다.' };
  return { records, unitMm, product };
}

/** SAT 텍스트 → 바디별 점군 AABB. 결정론 — AI 미사용. */
export function parseSatBodies(text: string, { maxBodies = 2000 }: { maxBodies?: number } = {}): SatParseResult {
  const head = text.slice(0, 2000);
  // 1행: 버전 등 정수 4개 — SAT 텍스트 시그니처
  if (!/^\s*\d{3,4}\s+\d+\s+\d+\s+\d+/.test(head)) {
    return { ok: false, error: 'SAT 텍스트 헤더가 아닙니다(바이너리 SAB 또는 다른 포맷 — SAB 는 미지원, SAT 텍스트로 재내보내기).' };
  }
  // 헤더 3행만 앞쪽 슬라이스에서 파싱(대용량 전체 split 회피)
  const headLines = head.split(/\r?\n/).map((l) => l.replace(/\r/g, ''));
  if (headLines.length < 4) return { ok: false, error: 'SAT 레코드가 없습니다.' };
  const unitMm = (() => {
    const v = parseFloat((headLines[2] ?? '').trim().split(/\s+/)[0] ?? '1');
    return Number.isFinite(v) && v > 0 ? v : 1;
  })();
  const product = (headLines[1] ?? '').replace(/^\d+\s+/, '').slice(0, 60).trim();

  // 레코드 스트림: 3행 이후. ⚠단순 '#' split 금지 — `@N ...` 문자열 리터럴이
  // '#' 를 포함할 수 있어 인덱스가 밀린다(man-zoeller 실측: '@5' 유령 레코드 1701건).
  // 문자열 인지 토큰 스캐너로 레코드를 경계 짓는다. v400=`-N type ...`, v700=순차.
  const headerEnd = (() => {
    let pos = 0;
    for (let ln = 0; ln < 3; ln++) {
      const nl = text.indexOf('\n', pos);
      if (nl < 0) return pos;
      pos = nl + 1;
    }
    return pos;
  })();
  const records = new Map<number, SatRecord>();
  {
    const N = text.length;
    let i = headerEnd;
    let seq = 0;
    let toks: string[] = [];
    const flush = () => {
      if (!toks.length) return;
      let idx: number;
      let ti = 0;
      if (/^-\d+$/.test(toks[0])) {
        idx = -parseInt(toks[0], 10); // `-12` → 인덱스 12
        ti = 1;
      } else {
        idx = seq;
      }
      seq = idx + 1;
      const typeTok = toks[ti] ?? '';
      const refs: number[] = [];
      const nums: number[] = [];
      for (let k = ti + 1; k < toks.length; k++) {
        const t = toks[k];
        if (t.charCodeAt(0) === 36 /* $ */) {
          const r = parseInt(t.slice(1), 10);
          if (Number.isFinite(r) && r >= 0) refs.push(r);
        } else if (t.charCodeAt(0) !== 64 /* @문자열은 수치 아님 */) {
          const v = parseFloat(t);
          if (Number.isFinite(v)) nums.push(v);
        }
      }
      records.set(idx, { type: typeTok, refs, nums });
      toks = [];
    };
    while (i < N) {
      const c = text.charCodeAt(i);
      if (c === 35 /* # */) { flush(); i++; continue; }
      if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
      if (c === 64 /* @ */) {
        // @N <N바이트 원문> — 내용에 '#'·공백 포함 가능, 통째로 건너뛴다
        let j = i + 1;
        while (j < N && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++;
        const len = parseInt(text.slice(i + 1, j), 10);
        if (Number.isFinite(len) && len >= 0 && j < N) {
          toks.push('@');
          i = j + 1 + len; // 구분 공백 1 + 내용 len
          continue;
        }
        i++;
        continue;
      }
      let j = i + 1;
      while (j < N) {
        const cj = text.charCodeAt(j);
        if (cj === 32 || cj === 9 || cj === 10 || cj === 13 || cj === 35) break;
        j++;
      }
      toks.push(text.slice(i, j));
      i = j;
    }
    flush();
  }
  if (!records.size) return { ok: false, error: 'SAT 레코드 파싱 실패.' };

  const b = bodiesFromRecords(records, maxBodies);
  if (!b.withGeom) return { ok: false, error: `body ${b.bodies.length}개 중 점군을 가진 바디가 없습니다(와이어/빈 바디 전용 파일).` };
  return { ok: true, bodies: b.bodies, unitMm, product, stats: { records: records.size, bodies: b.bodies.length, emptyBodies: b.emptyBodies, points: b.totalPoints } };
}

const baseTypeOf = (t: string) => (t.includes('-') ? t.split('-').pop()! : t);

/** 레코드 그래프 → 바디별 점군 AABB(BFS, topo 화이트리스트 — attrib 누수 차단). */
function bodiesFromRecords(records: Map<number, SatRecord>, maxBodies: number): { bodies: SatBody[]; totalPoints: number; emptyBodies: number; withGeom: number } {
  const baseType = baseTypeOf;
  const bodies: SatBody[] = [];
  let totalPoints = 0;
  let emptyBodies = 0;
  for (const [idx, rec] of records) {
    if (baseType(rec.type) !== 'body') continue;
    if (bodies.length >= maxBodies) break;
    // body 가 참조하는 transform(아핀 12수) — 있으면 점에 적용
    let xf: number[] | null = null;
    for (const r of rec.refs) {
      const rr = records.get(r);
      if (rr && baseType(rr.type) === 'transform' && rr.nums.length >= 12) { xf = rr.nums; break; }
    }
    const seen = new Set<number>([idx]);
    const queue = [...rec.refs];
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    let pts = 0;
    let guard = 0;
    while (queue.length && guard++ < 3_000_000) {
      const q = queue.pop()!;
      if (seen.has(q)) continue;
      seen.add(q);
      const r = records.get(q);
      if (!r) continue;
      const bt = baseType(r.type);
      if (bt === 'point') {
        const n = r.nums;
        if (n.length >= 3) {
          let [x, y, z] = [n[n.length - 3], n[n.length - 2], n[n.length - 1]];
          if (xf) {
            // ACIS transform: 행렬 3×3(행 우선 9수) + 이동 3수 (+스케일)
            const s = xf.length >= 13 && Number.isFinite(xf[12]) && xf[12] !== 0 ? xf[12] : 1;
            const [nx, ny, nz] = [
              (xf[0] * x + xf[3] * y + xf[6] * z) * s + xf[9],
              (xf[1] * x + xf[4] * y + xf[7] * z) * s + xf[10],
              (xf[2] * x + xf[5] * y + xf[8] * z) * s + xf[11],
            ];
            x = nx; y = ny; z = nz;
          }
          pts++;
          if (x < mnx) mnx = x;
          if (x > mxx) mxx = x;
          if (y < mny) mny = y;
          if (y > mxy) mxy = y;
          if (z < mnz) mnz = z;
          if (z > mxz) mxz = z;
        }
        continue; // point 는 말단
      }
      if (bt === 'vertex') {
        for (const r2 of r.refs) queue.push(r2); // vertex→point (+attrib 는 무해: point 만 수집)
        continue;
      }
      if (!TOPO_TYPES.has(bt)) continue; // attrib·surface·curve 등은 통과하지 않음(누수 차단)
      for (const r2 of r.refs) queue.push(r2);
    }
    totalPoints += pts;
    if (pts >= 2 && Number.isFinite(mnx)) {
      bodies.push({ aabb: { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] }, points: pts });
    } else {
      emptyBodies++;
      bodies.push({ aabb: null, points: pts });
    }
  }
  return { bodies, totalPoints, emptyBodies, withGeom: bodies.filter((b) => b.aabb).length };
}

/** SAB 바이너리 → 바디별 점군 AABB(레코드 파싱 후 공용 BFS). */
export function parseSabBodies(bytes: Uint8Array, { maxBodies = 2000 }: { maxBodies?: number } = {}): SatParseResult {
  const r = parseSabRecords(bytes);
  if ('error' in r) return { ok: false, error: r.error };
  const b = bodiesFromRecords(r.records, maxBodies);
  if (!b.withGeom) return { ok: false, error: `SAB body ${b.bodies.length}개 중 점군을 가진 바디가 없습니다.` };
  return { ok: true, bodies: b.bodies, unitMm: r.unitMm, product: r.product, stats: { records: r.records.size, bodies: b.bodies.length, emptyBodies: b.emptyBodies, points: b.totalPoints } };
}

export interface SatImportResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string; qty?: number }>;
    note: string;
  };
  stats?: { records: number; bodies: number; emptyBodies: number; points: number; parts: number; unitMm: number; representative?: boolean };
}

/** SAT 텍스트/SAB 바이너리 → NexyFab 어셈블리(바디별 월드 AABB box·mm 환산). */
export function satToNexyfabAssembly(input: string | Uint8Array, { name = 'SAT import' } = {}): SatImportResult {
  if (input.length > 300_000_000) return { ok: false, error: 'SAT 300MB 초과 — 파일 분할 또는 STEP 내보내기를 권합니다.' };
  let r: SatParseResult;
  if (typeof input !== 'string') {
    r = parseSabBodies(input);
  } else if (input.startsWith('ACIS BinaryFile') || input.startsWith('ASM BinaryFile4')) {
    // 바이너리 SAB 를 latin1 텍스트로 받은 경우 — 바이트로 복원
    const bytes = new Uint8Array(input.length);
    for (let k = 0; k < input.length; k++) bytes[k] = input.charCodeAt(k) & 0xff;
    r = parseSabBodies(bytes);
  } else {
    r = parseSatBodies(input);
  }
  if (!r.ok || !r.bodies) return { ok: false, error: r.error };
  const s = r.unitMm ?? 1;
  type P = { id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string; qty?: number };
  const parts: P[] = [];
  let i = 0;
  for (const b of r.bodies) {
    if (!b.aabb) continue;
    if (parts.length >= 600) break;
    i++;
    const [mnx, mny, mnz] = b.aabb.min;
    const [mxx, mxy, mxz] = b.aabb.max;
    parts.push({
      id: `sat_b${i}`,
      type: 'box',
      params: {
        width: +Math.max(0.5, (mxx - mnx) * s).toFixed(1),
        depth: +Math.max(0.5, (mxy - mny) * s).toFixed(1),
        height: +Math.max(0.5, (mxz - mnz) * s).toFixed(1),
      },
      at: { tx: +(mnx * s).toFixed(1), ty: +(mny * s).toFixed(1), tz: +(mnz * s).toFixed(1) },
      role: 'imported',
      material: 'steel',
    });
  }
  if (!parts.length) return { ok: false, error: '방출 가능한 바디가 없습니다.' };
  const withGeom = r.bodies.filter((b) => b.aabb).length;
  const representative = withGeom > 600;
  return {
    ok: true,
    assembly: {
      name,
      domain: 'mech',
      importedApprox: true,
      parts,
      note: `SAT(ACIS) 임포트 근사(바디=경계 정점 점군의 월드 AABB box — B-rep 곡면 미재구성) · 질량/물량=AABB 체적 기준(과대측) · 재질=미해석 기본값 · 단위=${s}mm/단위${r.product ? ` · 원본=${r.product}` : ''}${representative ? ` · 바디 600 예산 초과(전체 ${withGeom}) — 앞 600개만` : ''}`,
    },
    stats: { ...(r.stats ?? { records: 0, bodies: 0, emptyBodies: 0, points: 0 }), parts: parts.length, unitMm: s, ...(representative ? { representative: true } : {}) },
  };
}
