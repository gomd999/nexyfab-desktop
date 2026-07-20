/**
 * satExport.ts — 평면 다면체 메시 → ACIS SAT(텍스트) 익스포트 (W5-H, 260721).
 *
 * 정직 경계(전부 명시):
 *  - 입력 = **평면 페이스·폐(閉)·매니폴드** 다면체만. 곡면 표현(cone/sphere/spline)은
 *    생성하지 않는다 — 삼각/폴리곤 페이스를 plane-surface 페이스로 1:1 방출.
 *  - 비평면·개방·비매니폴드 입력은 **사유와 함께 거부**(조용한 근사 방출 금지).
 *  - 방언 = ACIS v700 텍스트(코퍼스 실측 dialect — satImport.ts 와 동일 규약):
 *    body/lump/shell/face/loop/coedge(파트너·sense 포함)/edge(+straight-curve)/vertex/point.
 *  - 결정적 검증 = 라운드트립: 본 출력 → satImport.parseSatBodies(실 B-rep 재구성) →
 *    정점·부피·CG 1e-6 일치 (satExport.test.ts).
 *  - 외부 CAD 호환은 **미검증**(자기 임포터 라운드트립만 실행 근거) — 레코드 형태는
 *    코퍼스 v700 실측 방언을 따르나 외부 커널 수입 성공을 주장하지 않는다.
 */

export interface PolyMesh {
  /** 융합(weld)된 정점 좌표 — 모델 단위 */
  verts: Array<[number, number, number]>;
  /** 페이스 = 정점 인덱스 사이클(≥3, 평면, 외향/내향 일관 — 내향이면 자동 반전) */
  faces: number[][];
}

export interface SatWriteStats {
  bodies: number;
  faces: number;
  edges: number;
  verts: number;
  records: number;
  /** 전 바디 부호부피 합(방출 좌표계·모델 단위) — 검증용 */
  volume: number;
}

export type SatWriteResult =
  | { ok: true; text: string; stats: SatWriteStats }
  | { ok: false; error: string };

/** 삼각형 수프(pos 9k)→융합 메시. 융합 격자=tol(기본 1e-6). 퇴화 삼각형은 드랍·집계. */
export function weldTriangleSoup(
  positions: ArrayLike<number>,
  tol = 1e-6,
): { mesh: PolyMesh; droppedDegenerate: number } {
  const inv = 1 / tol;
  const key = (x: number, y: number, z: number) => `${Math.round(x * inv)}_${Math.round(y * inv)}_${Math.round(z * inv)}`;
  const idx = new Map<string, number>();
  const verts: Array<[number, number, number]> = [];
  const vid = (x: number, y: number, z: number): number => {
    const k = key(x, y, z);
    let i = idx.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push([x, y, z]);
      idx.set(k, i);
    }
    return i;
  };
  const faces: number[][] = [];
  let dropped = 0;
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = vid(positions[i], positions[i + 1], positions[i + 2]);
    const b = vid(positions[i + 3], positions[i + 4], positions[i + 5]);
    const c = vid(positions[i + 6], positions[i + 7], positions[i + 8]);
    // 융합 후 정점 중복 = 면적 0 슬리버 — 엣지 짝수성 보존되므로 드랍(집계 명시)
    if (a === b || b === c || c === a) {
      dropped++;
      continue;
    }
    faces.push([a, b, c]);
  }
  return { mesh: { verts, faces }, droppedDegenerate: dropped };
}

/** 폴리곤 Newell 벡터(법선×2·면적) — satImport 와 동일 정의(교차검증 통과 보장) */
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

/** 부호부피×6(발산정리) — 페이스 팬 삼각화(평면 폴리곤에서 정확) */
function signedVol6(faces: number[][], verts: Array<[number, number, number]>): number {
  let v6 = 0;
  for (const f of faces) {
    const a = verts[f[0]];
    for (let k = 1; k + 1 < f.length; k++) {
      const b = verts[f[k]], c = verts[f[k + 1]];
      v6 += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
  }
  return v6;
}

interface Validated {
  /** 연결 성분별 페이스 인덱스 목록(성분=SAT body 1개) */
  components: number[][];
}

/**
 * 폐다면체 검증 — 실패는 전부 { error }(정직 거부, 근사 방출 없음).
 * 기준은 satImport.reconstructPlanarBody 수용 조건의 상위집합:
 * 인덱스 범위·페이스≥3정점·비퇴화·평면성(1e-6 상대)·유향 엣지 유일(=일관 방향)·
 * 무향 엣지 공유 정확히 2(폐·매니폴드).
 */
export function validateClosedPolyMesh(mesh: PolyMesh): Validated | { error: string } {
  const { verts, faces } = mesh;
  if (faces.length < 4) return { error: `페이스 ${faces.length}개(<4) — 폐다면체 불성립` };
  if (verts.length < 4) return { error: `정점 ${verts.length}개(<4) — 폐다면체 불성립` };
  const dirEdges = new Set<string>();
  const undirUse = new Map<string, number>();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    if (f.length < 3) return { error: `face[${fi}] 정점 ${f.length}개(<3)` };
    const seen = new Set<number>();
    for (const v of f) {
      if (!Number.isInteger(v) || v < 0 || v >= verts.length) return { error: `face[${fi}] 정점 인덱스 범위 밖(${v})` };
      if (seen.has(v)) return { error: `face[${fi}] 정점 중복(${v}) — 비단순 루프` };
      seen.add(v);
    }
    // 비퇴화 + 평면성(임포터와 동일한 1e-6 상대 허용오차 — 라운드트립 수용 보장)
    const nw = newellOf(f, verts);
    const nm = Math.hypot(nw[0], nw[1], nw[2]);
    if (!(nm > 0)) return { error: `face[${fi}] 면적 0 — 퇴화 페이스` };
    const n = [nw[0] / nm, nw[1] / nm, nw[2] / nm];
    let scaleRef = 1;
    for (const vi of f) for (const c of verts[vi]) scaleRef = Math.max(scaleRef, Math.abs(c));
    const tol = 1e-6 * scaleRef;
    const p0 = verts[f[0]];
    for (const vi of f) {
      const v = verts[vi];
      const d = (v[0] - p0[0]) * n[0] + (v[1] - p0[1]) * n[1] + (v[2] - p0[2]) * n[2];
      if (Math.abs(d) > tol) return { error: `face[${fi}] 비평면(평면 이탈 ${Math.abs(d).toExponential(2)} > tol ${tol.toExponential(2)}) — 곡면은 SAT plane-surface 로 표현 불가(정직 거부: 삼각화 후 재시도)` };
    }
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const dk = `${a}>${b}`;
      if (dirEdges.has(dk)) return { error: `유향 엣지 ${a}→${b} 중복 — 방향 비일관/비매니폴드` };
      dirEdges.add(dk);
      const uk = a < b ? `${a}_${b}` : `${b}_${a}`;
      undirUse.set(uk, (undirUse.get(uk) ?? 0) + 1);
    }
  }
  let open = 0, over = 0;
  for (const c of undirUse.values()) {
    if (c === 1) open++;
    else if (c > 2) over++;
  }
  if (open || over) return { error: `폐다면체 아님 — 개방 엣지 ${open}·과공유 엣지 ${over}(매니폴드 위반). SAT 는 폐셸만 방출(정직 거부)` };
  // 연결 성분(무향 엣지 공유 기준) — 성분마다 별도 body 로 방출
  const edgeFaces = new Map<string, number[]>();
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const uk = a < b ? `${a}_${b}` : `${b}_${a}`;
      const arr = edgeFaces.get(uk);
      if (arr) arr.push(fi);
      else edgeFaces.set(uk, [fi]);
    }
  });
  const comp = new Array<number>(faces.length).fill(-1);
  const components: number[][] = [];
  for (let s = 0; s < faces.length; s++) {
    if (comp[s] >= 0) continue;
    const cid = components.length;
    const group: number[] = [];
    const stack = [s];
    comp[s] = cid;
    while (stack.length) {
      const f = stack.pop()!;
      group.push(f);
      for (let k = 0; k < faces[f].length; k++) {
        const a = faces[f][k], b = faces[f][(k + 1) % faces[f].length];
        const uk = a < b ? `${a}_${b}` : `${b}_${a}`;
        for (const g of edgeFaces.get(uk)!) {
          if (comp[g] < 0) {
            comp[g] = cid;
            stack.push(g);
          }
        }
      }
    }
    components.push(group);
  }
  return { components };
}

/** SAT 수치 직렬화 — JS 배정도 왕복 보존(String(x) ↔ parseFloat 무손실), -0 정규화 */
const fnum = (v: number): string => (Object.is(v, -0) ? '0' : String(v));

/**
 * 융합 폴리메시 → SAT v700 텍스트. 검증 실패 = { ok:false, error }(값 날조 없음).
 * 내향 일관 방향(부호부피<0) 성분은 외향으로 자동 반전(형상 불변·방향 정규화).
 */
export function writeSatText(
  mesh: PolyMesh,
  { unitMm = 1, product = 'NexyFab shape-generator' }: { unitMm?: number; product?: string } = {},
): SatWriteResult {
  if (!(Number.isFinite(unitMm) && unitMm > 0)) return { ok: false, error: `unitMm=${unitMm} — 양수 단위만 허용` };
  for (const v of mesh.verts) {
    if (v.length < 3 || v.some((c) => !Number.isFinite(c))) return { ok: false, error: '정점 좌표에 비유한값 — 방출 거부' };
  }
  const val = validateClosedPolyMesh(mesh);
  if ('error' in val) return { ok: false, error: val.error };

  const records: string[] = [];
  let totalEdges = 0;
  let totalVol6 = 0;
  const nBodies = val.components.length;
  // 성분(=body)별 레코드 블록 — 전역 순차 인덱스(v700 방언, 접두 없음)
  for (let ci = 0; ci < nBodies; ci++) {
    const compFaceIdx = val.components[ci];
    // 성분 로컬 정점 재색인
    const vmap = new Map<number, number>();
    const lv: Array<[number, number, number]> = [];
    const faces: number[][] = compFaceIdx.map((fi) =>
      mesh.faces[fi].map((v) => {
        let m = vmap.get(v);
        if (m === undefined) {
          m = lv.length;
          lv.push(mesh.verts[v]);
          vmap.set(v, m);
        }
        return m;
      }),
    );
    // 방향 정규화: 부호부피<0(내향 일관) → 전 페이스 반전
    let v6 = signedVol6(faces, lv);
    if (v6 < 0) {
      for (const f of faces) f.reverse();
      v6 = -v6;
    }
    if (!(v6 > 0)) return { ok: false, error: `body[${ci}] 부호부피 0 — 폐다면체 아님(방출 거부)` };
    totalVol6 += v6;

    const nf = faces.length, nv = lv.length;
    // 무향 엣지 등록(최초 등장 방향 = edge start→end)
    const eKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeIdx = new Map<string, number>();
    const edgeDir: Array<[number, number]> = [];
    for (const f of faces) {
      for (let k = 0; k < f.length; k++) {
        const a = f[k], b = f[(k + 1) % f.length];
        const key = eKey(a, b);
        if (!edgeIdx.has(key)) {
          edgeIdx.set(key, edgeIdx.size);
          edgeDir.push([a, b]);
        }
      }
    }
    const ne = edgeIdx.size;
    const nc = faces.reduce((s, f) => s + f.length, 0);
    totalEdges += ne;

    // 인덱스 배치(성분 오프셋 B): body,lump,shell → face×nf → loop×nf → plane-surface×nf
    // → coedge×nc → edge×ne → straight-curve×ne → vertex×nv → point×nv
    const B = records.length;
    const F = (i: number) => B + 3 + i;
    const L = (i: number) => B + 3 + nf + i;
    const S = (i: number) => B + 3 + 2 * nf + i;
    const C0 = B + 3 + 3 * nf;
    const E0 = C0 + nc;
    const G0 = E0 + ne;
    const V0 = G0 + ne;
    const P0 = V0 + nv;

    const cIdx: number[][] = [];
    {
      let cj = 0;
      for (const f of faces) cIdx.push(f.map(() => C0 + cj++));
    }
    // 유향 엣지 → 코엣지(파트너 해석) / 정점·엣지 최초 소속(vertex→edge 백참조)
    const coedgeOfDir = new Map<string, number>();
    faces.forEach((f, i) => f.forEach((a, k) => coedgeOfDir.set(`${a}>${f[(k + 1) % f.length]}`, cIdx[i][k])));
    const firstCoedgeOfEdge = new Map<number, number>();
    const firstEdgeOfVert = new Map<number, number>();
    faces.forEach((f, i) =>
      f.forEach((a, k) => {
        const b = f[(k + 1) % f.length];
        const e = E0 + edgeIdx.get(eKey(a, b))!;
        if (!firstCoedgeOfEdge.has(e)) firstCoedgeOfEdge.set(e, cIdx[i][k]);
        if (!firstEdgeOfVert.has(a)) firstEdgeOfVert.set(a, e);
        if (!firstEdgeOfVert.has(b)) firstEdgeOfVert.set(b, e);
      }),
    );

    records.push(`body $-1 -1 $-1 $${B + 1} $-1 $-1 #`);
    records.push(`lump $-1 -1 $-1 $-1 $${B + 2} $${B} #`);
    records.push(`shell $-1 -1 $-1 $-1 $-1 $${F(0)} $-1 $${B + 1} #`);
    for (let i = 0; i < nf; i++) {
      records.push(`face $-1 -1 $-1 $${i + 1 < nf ? F(i + 1) : -1} $${L(i)} $${B + 2} $-1 $${S(i)} forward single #`);
    }
    for (let i = 0; i < nf; i++) records.push(`loop $-1 -1 $-1 $-1 $${cIdx[i][0]} $${F(i)} #`);
    for (let i = 0; i < nf; i++) {
      const f = faces[i];
      const nw = newellOf(f, lv);
      const m = Math.hypot(nw[0], nw[1], nw[2]);
      const n = [nw[0] / m, nw[1] / m, nw[2] / m];
      const p0 = lv[f[0]], p1 = lv[f[1]];
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const um = Math.hypot(u[0], u[1], u[2]);
      records.push(
        `plane-surface $-1 -1 $-1 ${p0.map(fnum).join(' ')} ${n.map(fnum).join(' ')} ${u.map((x) => fnum(x / um)).join(' ')} forward_v I I I I #`,
      );
    }
    faces.forEach((f, i) =>
      f.forEach((a, k) => {
        const b = f[(k + 1) % f.length];
        const next = cIdx[i][(k + 1) % f.length];
        const prev = cIdx[i][(k - 1 + f.length) % f.length];
        const partner = coedgeOfDir.get(`${b}>${a}`)!; // 폐매니폴드 검증 통과 = 파트너 항상 존재
        const eLocal = edgeIdx.get(eKey(a, b))!;
        const sense = edgeDir[eLocal][0] === a ? 'forward' : 'reversed';
        records.push(`coedge $-1 -1 $-1 $${next} $${prev} $${partner} $${E0 + eLocal} ${sense} $${L(i)} $-1 #`);
      }),
    );
    for (let k = 0; k < ne; k++) {
      const [a, b] = edgeDir[k];
      const pa = lv[a], pb = lv[b];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      records.push(
        `edge $-1 -1 $-1 $${V0 + a} 0 $${V0 + b} ${fnum(len)} $${firstCoedgeOfEdge.get(E0 + k)} $${G0 + k} forward @7 unknown #`,
      );
    }
    for (let k = 0; k < ne; k++) {
      const [a, b] = edgeDir[k];
      const pa = lv[a], pb = lv[b];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) || 1;
      const d = [(pb[0] - pa[0]) / len, (pb[1] - pa[1]) / len, (pb[2] - pa[2]) / len];
      records.push(`straight-curve $-1 -1 $-1 ${pa.map(fnum).join(' ')} ${d.map(fnum).join(' ')} I I #`);
    }
    for (let a = 0; a < nv; a++) records.push(`vertex $-1 -1 $-1 $${firstEdgeOfVert.get(a)} $${P0 + a} #`);
    for (let a = 0; a < nv; a++) records.push(`point $-1 -1 $-1 ${lv[a].map(fnum).join(' ')} #`);
  }

  const now = new Date();
  // 24자 고정 날짜 문자열(ACIS 헤더 관례 — 내용은 정보성, 임포터 미사용)
  const date = now.toDateString().padEnd(24).slice(0, 24);
  const header = [
    `700 ${records.length} ${nBodies} 0 `,
    `${product.length} ${product} 19 nexyfab-sat-export ${date.length} ${date} `,
    `${fnum(unitMm)} 9.9999999999999995e-007 1e-010 `,
  ];
  const text = [...header, ...records, 'End-of-ACIS-data', ''].join('\n');
  return {
    ok: true,
    text,
    stats: {
      bodies: nBodies,
      faces: mesh.faces.length,
      edges: totalEdges,
      verts: mesh.verts.length,
      records: records.length,
      volume: totalVol6 / 6,
    },
  };
}
