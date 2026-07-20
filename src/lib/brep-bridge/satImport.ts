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

/** 평면 페이스 다면체 실재구성 결과(W5-G, 260721) — 좌표=소스 그대로(모델 단위). */
export interface SatPoly {
  verts: Array<[number, number, number]>;
  /** 외향 일관 방향의 페이스 폴리곤(verts 인덱스 사이클) */
  faces: number[][];
  volume: number;
  area: number;
  cg: [number, number, number];
}

export interface SatBody {
  aabb: { min: [number, number, number]; max: [number, number, number] } | null;
  points: number;
  /** 전 페이스가 평면이고 폐다면체 재구성이 검증 통과한 경우에만 존재 */
  poly?: SatPoly;
  /** poly 부재 사유(곡면·비매니폴드 등) — 조용한 근사 금지, 하류에 명시 */
  fallbackReason?: string;
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

// ── W5-G(260721): 평면 페이스 다면체 실재구성 ─────────────────────────────
// SAT 레코드 그래프에 face→loop→coedge→edge→vertex→point + plane-surface 가 전부
// 있으므로, 전 페이스가 평면인 바디는 실제 정점·페이스·체적을 재구성한다.
// 곡면(cone/sphere/torus/spline…)·다중 루프·비매니폴드는 **사유와 함께** AABB 로
// 폴백(fallbackReason — 조용한 박스 대체 금지). 재구성은 좌표 날조 없이 소스
// point 좌표만 사용하며, Newell 법선 vs plane-surface 법선 교차검증을 통과해야 한다.

/** 표면 레코드 타입 판별: 'plane-surface'→'plane', 'cone-surface'→'cone', 구식 단독명 지원 */
const SURF_BARE = new Set(['plane', 'cone', 'sphere', 'torus', 'spline']);
function surfaceKindOf(t: string): string | null {
  const segs = t.split('-');
  if (segs.length > 1 && segs[segs.length - 1] === 'surface') return segs[0];
  if (segs.length === 1 && SURF_BARE.has(t)) return t;
  return null;
}

/** 폴리곤 Newell 벡터(=법선×2·면적) — 평면 비볼록 폴리곤에도 정확 */
function newellOf(cycle: number[], verts: Array<[number, number, number]>): [number, number, number] {
  const n: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < cycle.length; k++) {
    const p = verts[cycle[k]], q = verts[cycle[(k + 1) % cycle.length]];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return n;
}

/** loop 레코드 idx → 그 루프를 참조하는 coedge idx 목록(전 레코드 1패스) */
function buildLoopCoedges(records: Map<number, SatRecord>): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const [idx, rec] of records) {
    if (baseTypeOf(rec.type) !== 'coedge') continue;
    for (const r of rec.refs) {
      const rr = records.get(r);
      if (rr && baseTypeOf(rr.type) === 'loop') {
        const arr = m.get(r);
        if (arr) arr.push(idx);
        else m.set(r, [idx]);
        break; // 코엣지의 소속 루프는 1개
      }
    }
  }
  return m;
}

/** 바디 1개의 평면 다면체 재구성. 실패는 전부 { reason } — 값 날조 없음. */
function reconstructPlanarBody(
  records: Map<number, SatRecord>,
  faceIdxs: number[],
  loopCoedges: Map<number, number[]>,
  xf: number[] | null,
): { poly?: SatPoly; reason?: string } {
  if (!faceIdxs.length) return { reason: '페이스 레코드 없음(와이어/점 바디)' };
  if (faceIdxs.length > 5000) return { reason: `페이스 ${faceIdxs.length}개 — 재구성 예산(5000) 초과` };
  const xfPoint = (x: number, y: number, z: number): [number, number, number] => {
    if (!xf) return [x, y, z];
    const s = xf.length >= 13 && Number.isFinite(xf[12]) && xf[12] !== 0 ? xf[12] : 1;
    return [
      (xf[0] * x + xf[3] * y + xf[6] * z) * s + xf[9],
      (xf[1] * x + xf[4] * y + xf[7] * z) * s + xf[10],
      (xf[2] * x + xf[5] * y + xf[8] * z) * s + xf[11],
    ];
  };
  const xfUnitVec = (x: number, y: number, z: number): [number, number, number] => {
    if (xf) {
      const [nx, ny, nz] = [xf[0] * x + xf[3] * y + xf[6] * z, xf[1] * x + xf[4] * y + xf[7] * z, xf[2] * x + xf[5] * y + xf[8] * z];
      x = nx; y = ny; z = nz;
    }
    const m = Math.hypot(x, y, z) || 1;
    return [x / m, y / m, z / m];
  };
  // 1) 페이스 → (평면 파라미터, 루프). 곡면은 전수 수집 후 명시 사유로 중단.
  const curved = new Set<string>();
  const faceDefs: Array<{ loop: number; root: [number, number, number]; n: [number, number, number] }> = [];
  for (const fi of faceIdxs) {
    const f = records.get(fi)!;
    let surfKind: string | null = null;
    let surfRec: SatRecord | null = null;
    const loops: number[] = [];
    for (const r of f.refs) {
      const rr = records.get(r);
      if (!rr) continue;
      const k = surfaceKindOf(rr.type);
      if (k) { surfKind = k; surfRec = rr; }
      else if (baseTypeOf(rr.type) === 'loop') loops.push(r);
    }
    if (!surfKind || !surfRec) return { reason: '페이스 표면 참조 미해석(B-rep 재구성 불가)' };
    if (surfKind !== 'plane') { curved.add(surfKind); continue; }
    if (loops.length !== 1) return { reason: `페이스 루프 ${loops.length}개 — 다중 루프(홀 면) 미지원` };
    if (surfRec.nums.length < 9) return { reason: '평면 파라미터 9수 미만' };
    const n9 = surfRec.nums.slice(-9);
    faceDefs.push({ loop: loops[0], root: xfPoint(n9[0], n9[1], n9[2]), n: xfUnitVec(n9[3], n9[4], n9[5]) });
  }
  if (curved.size) return { reason: `곡면 페이스(${[...curved].sort().join('/')}) — 평면 다면체만 실재구성(곡면은 AABB 근사)` };
  if (faceDefs.length < 4) return { reason: `평면 페이스 ${faceDefs.length}개(<4) — 폐다면체 불성립` };
  // 2) 루프별 엣지→정점쌍 수집·사이클 복원
  const vertIdOf = new Map<number, number>(); // point 레코드 idx → 로컬 정점 idx
  const verts: Array<[number, number, number]> = [];
  const vertOf = (pIdx: number): number | null => {
    const got = vertIdOf.get(pIdx);
    if (got !== undefined) return got;
    const p = records.get(pIdx);
    if (!p || baseTypeOf(p.type) !== 'point' || p.nums.length < 3) return null;
    const n = p.nums;
    const i = verts.length;
    verts.push(xfPoint(n[n.length - 3], n[n.length - 2], n[n.length - 1]));
    vertIdOf.set(pIdx, i);
    return i;
  };
  const polys: number[][] = [];
  for (const fd of faceDefs) {
    if (verts.length > 20000) return { reason: '정점 20k 예산 초과' };
    const coedges = loopCoedges.get(fd.loop) ?? [];
    const edgeSet = new Set<number>();
    for (const ci of coedges) {
      const c = records.get(ci)!;
      let e = -1;
      for (const r of c.refs) { const rr = records.get(r); if (rr && baseTypeOf(rr.type) === 'edge') { e = r; break; } }
      if (e < 0) return { reason: '코엣지→엣지 참조 미해석' };
      edgeSet.add(e);
    }
    if (edgeSet.size < 3) return { reason: `루프 엣지 ${edgeSet.size}개(<3)` };
    const pairs: Array<[number, number]> = [];
    for (const ei of edgeSet) {
      const e = records.get(ei)!;
      const vs: number[] = [];
      for (const r of e.refs) {
        const rr = records.get(r);
        if (!rr || baseTypeOf(rr.type) !== 'vertex') continue;
        let pIdx = -1;
        for (const r2 of rr.refs) { const rr2 = records.get(r2); if (rr2 && baseTypeOf(rr2.type) === 'point') { pIdx = r2; break; } }
        if (pIdx < 0) return { reason: '정점→포인트 참조 미해석' };
        const v = vertOf(pIdx);
        if (v === null) return { reason: '포인트 좌표 미해석' };
        if (!vs.includes(v)) vs.push(v);
      }
      if (vs.length !== 2) return { reason: `엣지 정점 ${vs.length}개(≠2) — 원형/퇴화 엣지` };
      pairs.push([vs[0], vs[1]]);
    }
    const adj = new Map<number, [number, number] | [number]>();
    for (const [a, b] of pairs) {
      for (const [u, v] of [[a, b], [b, a]] as const) {
        const cur = adj.get(u);
        if (!cur) adj.set(u, [v]);
        else if (cur.length === 1) adj.set(u, [cur[0], v]);
        else return { reason: '루프 비단순(정점 차수>2)' };
      }
    }
    for (const [, ns] of adj) if (ns.length !== 2) return { reason: '루프 비단순(정점 차수≠2)' };
    const start = pairs[0][0];
    const cycle = [start];
    let prev = -1, cur = start;
    for (let g = 0; g < pairs.length; g++) {
      const [n1, n2] = adj.get(cur)! as [number, number];
      const nxt = n1 === prev ? n2 : n1;
      if (nxt === start) break;
      cycle.push(nxt);
      prev = cur; cur = nxt;
    }
    if (cycle.length !== pairs.length) return { reason: '루프 사이클 불일치(분리 서브루프)' };
    // 교차검증: Newell 법선 ∥ plane-surface 법선 + 평면성 — 불일치 시 재구성 신뢰 불가(정직 폴백)
    const nw = newellOf(cycle, verts);
    const nwm = Math.hypot(nw[0], nw[1], nw[2]);
    if (!(nwm > 0)) return { reason: '퇴화 페이스(면적 0)' };
    const dot = (nw[0] * fd.n[0] + nw[1] * fd.n[1] + nw[2] * fd.n[2]) / nwm;
    if (Math.abs(dot) < 1 - 1e-7) return { reason: '페이스 폴리곤/평면 법선 불일치 — 재구성 신뢰 불가' };
    let scaleRef = 1;
    for (const vi of cycle) for (const c of verts[vi]) scaleRef = Math.max(scaleRef, Math.abs(c));
    const tol = 1e-6 * scaleRef;
    for (const vi of cycle) {
      const v = verts[vi];
      const d = (v[0] - fd.root[0]) * fd.n[0] + (v[1] - fd.root[1]) * fd.n[1] + (v[2] - fd.root[2]) * fd.n[2];
      if (Math.abs(d) > tol) return { reason: '페이스 비평면(평면 이탈 검출)' };
    }
    polys.push(cycle);
  }
  // 3) 매니폴드 검사 + 방향 전파(공유 엣지는 서로 반대로 순회해야 일관)
  const eUse = new Map<string, Array<{ f: number; fwd: boolean }>>();
  polys.forEach((poly, f) => {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const arr = eUse.get(key);
      if (arr) arr.push({ f, fwd: a < b });
      else eUse.set(key, [{ f, fwd: a < b }]);
    }
  });
  const adjF: Array<Array<{ g: number; same: boolean }>> = polys.map(() => []);
  for (const [, us] of eUse) {
    if (us.length !== 2) return { reason: '비매니폴드/개방 엣지(공유 페이스≠2)' };
    const [u0, u1] = us;
    const same = u0.fwd === u1.fwd;
    adjF[u0.f].push({ g: u1.f, same });
    adjF[u1.f].push({ g: u0.f, same });
  }
  const flip = new Array<boolean>(polys.length).fill(false);
  const visited = new Array<boolean>(polys.length).fill(false);
  const queue = [0];
  visited[0] = true;
  while (queue.length) {
    const f = queue.pop()!;
    for (const { g, same } of adjF[f]) {
      const want = same ? !flip[f] : flip[f]; // 같은 방향 순회 = 한쪽 반전 필요
      if (!visited[g]) { visited[g] = true; flip[g] = want; queue.push(g); }
      else if (flip[g] !== want) return { reason: '페이스 방향 전파 모순(비가향 셸)' };
    }
  }
  if (visited.some((v) => !v)) return { reason: '다중 셸 컴포넌트 — 단일 폐셸만 재구성' };
  // 4) 체적·표면적·CG(발산정리 — 팬 삼각화는 평면 폴리곤에서 부호 상쇄로 정확)
  const outFaces = polys.map((p, f) => (flip[f] ? [...p].reverse() : p));
  let vol6 = 0, area2 = 0;
  const cgAcc = [0, 0, 0];
  for (const poly of outFaces) {
    const a = verts[poly[0]];
    for (let k = 1; k + 1 < poly.length; k++) {
      const b = verts[poly[k]], c = verts[poly[k + 1]];
      const cx = b[1] * c[2] - b[2] * c[1], cy = b[2] * c[0] - b[0] * c[2], cz = b[0] * c[1] - b[1] * c[0];
      const d6 = a[0] * cx + a[1] * cy + a[2] * cz;
      vol6 += d6;
      for (let t = 0; t < 3; t++) cgAcc[t] += d6 * (a[t] + b[t] + c[t]);
    }
    const nw = newellOf(poly, verts);
    area2 += Math.hypot(nw[0], nw[1], nw[2]);
  }
  if (!(Math.abs(vol6) > 0)) return { reason: '체적 0 — 폐다면체 아님' };
  const faces = vol6 < 0 ? outFaces.map((p) => [...p].reverse()) : outFaces;
  return {
    poly: {
      verts,
      faces,
      volume: Math.abs(vol6) / 6,
      area: area2 / 2,
      cg: [cgAcc[0] / (4 * vol6), cgAcc[1] / (4 * vol6), cgAcc[2] / (4 * vol6)],
    },
  };
}

/** 레코드 그래프 → 바디별 점군 AABB(BFS, topo 화이트리스트 — attrib 누수 차단). */
function bodiesFromRecords(records: Map<number, SatRecord>, maxBodies: number): { bodies: SatBody[]; totalPoints: number; emptyBodies: number; withGeom: number } {
  const baseType = baseTypeOf;
  const bodies: SatBody[] = [];
  let totalPoints = 0;
  let emptyBodies = 0;
  let loopCoedgesCache: Map<number, number[]> | null = null;
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
    const faceIdxs: number[] = [];
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
      if (bt === 'face') faceIdxs.push(q);
      for (const r2 of r.refs) queue.push(r2);
    }
    totalPoints += pts;
    // 평면 다면체 실재구성 시도(W5-G) — 실패 사유는 명시 보존
    let poly: SatPoly | undefined;
    let fallbackReason: string | undefined;
    if (faceIdxs.length) {
      if (!loopCoedgesCache) loopCoedgesCache = buildLoopCoedges(records);
      const rp = reconstructPlanarBody(records, faceIdxs, loopCoedgesCache, xf);
      poly = rp.poly;
      fallbackReason = rp.reason;
    } else {
      fallbackReason = '페이스 레코드 없음(점군만)';
    }
    if (pts >= 2 && Number.isFinite(mnx)) {
      bodies.push({ aabb: { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] }, points: pts, ...(poly ? { poly } : { fallbackReason }) });
    } else {
      emptyBodies++;
      bodies.push({ aabb: null, points: pts, ...(poly ? { poly } : { fallbackReason }) });
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

/** 부품별 충실도(W5-G): 실재구성 다면체 vs 명시 AABB 근사 — 하류가 반드시 판별 가능 */
export type SatPartFidelity = 'brep-polyhedron' | 'aabb-approximation';

export interface SatImportResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    /** 어셈블리 전체 충실도: 전부 다면체=brep-polyhedron · 전부 근사=aabb-approximation · 섞임=mixed */
    fidelity?: SatPartFidelity | 'mixed';
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string; qty?: number; fidelity?: SatPartFidelity }>;
    note: string;
  };
  stats?: { records: number; bodies: number; emptyBodies: number; points: number; parts: number; polyParts?: number; unitMm: number; representative?: boolean };
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
  type P = NonNullable<SatImportResult['assembly']>['parts'][number];
  const parts: P[] = [];
  const reasons = new Set<string>();
  const r6 = (v: number) => +v.toFixed(6);
  let i = 0;
  let polyParts = 0;
  for (const b of r.bodies) {
    if (!b.aabb && !b.poly) continue;
    if (parts.length >= 600) break;
    i++;
    if (b.poly) {
      // 실재구성 다면체 — 정점·페이스·체적=소스 좌표 기반(단위만 mm 환산)
      polyParts++;
      const sv = b.poly.verts.map(([x, y, z]) => [r6(x * s), r6(y * s), r6(z * s)]);
      const aabb = b.aabb
        ? { min: b.aabb.min.map((v) => r6(v * s)), max: b.aabb.max.map((v) => r6(v * s)) }
        : undefined;
      parts.push({
        id: `sat_b${i}`,
        type: 'mesh' as unknown as 'box', // STL 임포터와 동일 규약(SCAD polyhedron 표시 경로)
        params: {
          volumeMm3: r6(b.poly.volume * s * s * s),
          areaMm2: r6(b.poly.area * s * s),
          faceCount: b.poly.faces.length,
          ...(aabb ? { aabb } : {}),
          cg: b.poly.cg.map((v) => r6(v * s)),
          verts: sv,
          faces: b.poly.faces,
        } as unknown as { width: number; depth: number; height: number },
        at: { tx: 0, ty: 0, tz: 0 },
        role: 'imported',
        material: 'steel',
        fidelity: 'brep-polyhedron',
      });
      continue;
    }
    if (b.fallbackReason) reasons.add(b.fallbackReason);
    const [mnx, mny, mnz] = b.aabb!.min;
    const [mxx, mxy, mxz] = b.aabb!.max;
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
      fidelity: 'aabb-approximation',
    });
  }
  if (!parts.length) return { ok: false, error: '방출 가능한 바디가 없습니다.' };
  const boxParts = parts.length - polyParts;
  const fidelity: NonNullable<SatImportResult['assembly']>['fidelity'] =
    boxParts === 0 ? 'brep-polyhedron' : polyParts === 0 ? 'aabb-approximation' : 'mixed';
  const withGeom = r.bodies.filter((b) => b.aabb || b.poly).length;
  const representative = withGeom > 600;
  const reasonNote = reasons.size ? ` · box 근사 사유: ${[...reasons].slice(0, 3).join(' | ')}` : '';
  const note =
    boxParts === 0
      ? `SAT(ACIS) 실 B-rep 임포트 — 평면 페이스 다면체 ${polyParts}바디 재구성(정점·페이스·체적=소스 좌표, 법선 교차검증 통과) · 단위=${s}mm/단위${r.product ? ` · 원본=${r.product}` : ''}`
      : `SAT(ACIS) 임포트${polyParts ? ` — 다면체 실재구성 ${polyParts} + AABB box 근사 ${boxParts}` : ' 근사(바디=경계 정점 점군의 월드 AABB box — 실형상 미재구성)'}${reasonNote} · box 부품 질량/물량=AABB 체적 기준(과대측) · 재질=미해석 기본값 · 단위=${s}mm/단위${r.product ? ` · 원본=${r.product}` : ''}${representative ? ` · 바디 600 예산 초과(전체 ${withGeom}) — 앞 600개만` : ''}`;
  return {
    ok: true,
    assembly: {
      name,
      domain: 'mech',
      ...(boxParts > 0 ? { importedApprox: true } : {}),
      fidelity,
      parts,
      note,
    },
    stats: { ...(r.stats ?? { records: 0, bodies: 0, emptyBodies: 0, points: 0 }), parts: parts.length, polyParts, unitMm: s, ...(representative ? { representative: true } : {}) },
  };
}
