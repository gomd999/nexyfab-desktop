/**
 * meshIgesImport — STL·IGES → NexyFab 어셈블리 브리지 (260718, 참고파일들2 대응).
 *
 * 정직 경계(전부 명시):
 *  - STL: 부품 구조가 없는 삼각 메시 → **단일 box(정점 AABB)**. ascii/binary 자동 판별.
 *  - IGES: 개방 ISO 텍스트(5.x). 좌표 추출 대상 = 116 POINT · 110 LINE · 502 VERTEX LIST ·
 *    126/128 NURBS 제어점. DE 7필드 변환(124 행렬) 1단계 적용. 그 외 엔티티(원호 평면
 *    좌표계 등)는 bounds 에 미반영 — **경계 근사**이지 원기하 아님(note 명시).
 *  - 질량/물량 = AABB 체적 기준(과대측) · 재질 = 기본값.
 */

export interface MeshImportResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string }>;
    note: string;
  };
  stats?: { format: 'stl-ascii' | 'stl-binary' | 'iges'; points: number; entitiesUsed?: number; entitiesSkipped?: number };
}

function boundsToPart(min: number[], max: number[], id: string, material: string) {
  return {
    id,
    type: 'box' as const,
    params: { width: +(max[0] - min[0]).toFixed(2), depth: +(max[1] - min[1]).toFixed(2), height: +(max[2] - min[2]).toFixed(2) },
    at: { tx: +min[0].toFixed(2), ty: +min[1].toFixed(2), tz: +min[2].toFixed(2) },
    role: 'imported',
    material,
  };
}

/** STL(ascii/binary) → **메시 실체적** 어셈블리(260718d): 발산정리 정밀 체적/CG/표면적 +
 *  워터타이트(엣지 짝맞춤) 검사. ≤20k 정점=SCAD polyhedron 정밀 표시, 초과=AABB 프록시 표시
 *  (질량·물량은 어느 쪽이든 정밀값 — "근사 box" 아님). */
export function stlToNexyfabAssembly(data: Buffer, { name = 'STL import', material = 'steel' } = {}): MeshImportResult {
  const tris: number[][][] = [];
  const head = data.subarray(0, 512).toString('latin1');
  const isAscii = /^\s*solid\b/.test(head) && /facet|endsolid/.test(data.subarray(0, 4096).toString('latin1'));
  let format: 'stl-ascii' | 'stl-binary';
  if (isAscii) {
    format = 'stl-ascii';
    const vs = [...data.toString('latin1').matchAll(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g)]
      .map((m) => [+m[1], +m[2], +m[3]]);
    for (let i = 0; i + 2 < vs.length; i += 3) tris.push([vs[i], vs[i + 1], vs[i + 2]]);
  } else {
    format = 'stl-binary';
    if (data.length < 84) return { ok: false, error: 'STL 파일이 너무 짧음(84바이트 미만)' };
    const n = data.readUInt32LE(80);
    if (data.length < 84 + n * 50) return { ok: false, error: `STL 삼각형 수(${n}) 대비 파일 크기 부족 — 손상 파일` };
    for (let i = 0; i < n; i++) {
      const off = 84 + i * 50 + 12;
      const t: number[][] = [];
      for (let v = 0; v < 3; v++) t.push([data.readFloatLE(off + v * 12), data.readFloatLE(off + v * 12 + 4), data.readFloatLE(off + v * 12 + 8)]);
      tris.push(t);
    }
  }
  if (tris.length < 4) return { ok: false, error: '삼각형 4개 미만 — STL 형식 인식 실패' };
  // 발산정리: V = Σ v0·(v1×v2)/6 · CG = Σ 사면체 도심 가중 / V · A = Σ|cross|/2
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vol6 = 0, area2 = 0;
  const cgAcc = [0, 0, 0];
  for (const [a, b, c] of tris) {
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    const cx = b[1] * c[2] - b[2] * c[1], cy = b[2] * c[0] - b[0] * c[2], cz = b[0] * c[1] - b[1] * c[0];
    const d6 = a[0] * cx + a[1] * cy + a[2] * cz;
    vol6 += d6;
    for (let k = 0; k < 3; k++) cgAcc[k] += d6 * (a[k] + b[k] + c[k]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area2 += Math.hypot(nx, ny, nz);
  }
  const volume = Math.abs(vol6) / 6;
  const cg = vol6 !== 0 ? cgAcc.map((v) => v / (4 * vol6)) : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  // 워터타이트: 정점 융합(1e-4 그리드) 후 무방향 엣지 사용 횟수 전부 2 — 아니면 열린 메시(체적 신뢰 불가 명시)
  const vidx = new Map<string, number>();
  const verts: number[][] = [];
  const vid = (p: number[]) => {
    const k = `${Math.round(p[0] * 1e4)}_${Math.round(p[1] * 1e4)}_${Math.round(p[2] * 1e4)}`;
    let i = vidx.get(k);
    if (i === undefined) { i = verts.length; verts.push(p); vidx.set(k, i); }
    return i;
  };
  const faces: number[][] = tris.map(([a, b, c]) => [vid(a), vid(b), vid(c)]);
  const edgeUse = new Map<string, number>();
  for (const [i0, i1, i2] of faces) {
    for (const [e0, e1] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = e0 < e1 ? `${e0}_${e1}` : `${e1}_${e0}`;
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  for (const c of edgeUse.values()) if (c !== 2) openEdges++;
  const watertight = openEdges === 0;
  const id = name.replace(/[^\w가-힣-]/g, '_').slice(0, 40) || 'stl_part';
  const embed = verts.length <= 20000;
  const part = {
    id,
    type: 'mesh' as unknown as 'box',
    params: {
      volumeMm3: +volume.toFixed(2), areaMm2: +(area2 / 2).toFixed(2), triCount: tris.length,
      aabb: { min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) },
      cg: cg.map((v) => +v.toFixed(3)),
      ...(embed ? { verts: verts.map((v) => v.map((x) => +x.toFixed(3))), faces } : {}),
    } as unknown as { width: number; depth: number; height: number },
    at: { tx: 0, ty: 0, tz: 0 },
    role: 'imported',
    material,
  };
  return {
    ok: true,
    assembly: {
      name, domain: 'mech', importedApprox: true,
      parts: [part],
      note: `STL 메시 실체적 임포트(발산정리 — 체적·CG·표면적 정밀${watertight ? '' : ` · ⚠열린 메시(경계 엣지 ${openEdges}) — 체적은 참고값`}) · ${embed ? 'SCAD=polyhedron 정밀' : `표시=AABB 프록시(${tris.length}tris > 표시 예산 — 질량은 정밀 유지)`} · 단위=파일 기재값 그대로(mm 가정 명시)`,
    },
    stats: { format, points: tris.length * 3 },
  };
}

/** IGES 5.x → box 근사 어셈블리(엔티티별 좌표 추출 + 124 변환 1단계). */
export function igesToNexyfabAssembly(source: string, { name = 'IGES import', material = 'steel' } = {}): MeshImportResult {
  // 80-col 고정: 73열 섹션 문자(S/G/D/P/T), 74~80 시퀀스.
  const dLines: string[] = [];
  const pLines: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (raw.length < 73) continue;
    const sec = raw[72];
    if (sec === 'D') dLines.push(raw);
    else if (sec === 'P') pLines.push(raw);
  }
  if (dLines.length < 2 || pLines.length === 0) return { ok: false, error: 'IGES D/P 섹션 없음 — 형식 인식 실패' };
  // P 섹션: 65~72열 = DE back-pointer. DE 번호별 파라미터 문자열 조립.
  const pByDe = new Map<number, string>();
  for (const ln of pLines) {
    const de = parseInt(ln.slice(64, 72), 10);
    if (!Number.isFinite(de)) continue;
    pByDe.set(de, (pByDe.get(de) ?? '') + ln.slice(0, 64));
  }
  // D 섹션: 2줄 1엔트리. 필드 8칸 — [0]=type, [1]=param ptr, [6]=transform DE ptr.
  interface DE { type: number; de: number; xform: number }
  const entries: DE[] = [];
  for (let i = 0; i + 1 < dLines.length; i += 2) {
    const l1 = dLines[i];
    const type = parseInt(l1.slice(0, 8), 10);
    const de = parseInt(l1.slice(72, 80), 10) || (i + 1);
    const xform = parseInt(l1.slice(48, 56), 10) || 0;
    if (Number.isFinite(type)) entries.push({ type, de, xform });
  }
  // ⚠십진 콤마 수출 버그(caster IGS 실측, 260718): 실수를 `정수부,소수부.` 로 쓰는
  // 로케일 파손본(1e23 좌표 발산). `,정수12+자리.` 패턴이 다수(>50)인 파일에서만
  // 병합 휴리스틱 활성 — 정상 파일 오병합(날조) 방지 게이트.
  const decimalCommaBroken = (() => {
    let hits = 0;
    for (const v of pByDe.values()) {
      const m = v.match(/,\d{12,}\./g);
      if (m) hits += m.length;
      if (hits > 50) return true;
    }
    return false;
  })();
  const realsOf = (de: number): number[] => {
    const s = pByDe.get(de);
    if (!s) return [];
    // 첫 필드=엔티티 타입 반복 — 제거 후 콤마 분해(H-string 은 숫자 아님 → NaN 필터)
    const toks = s.split(/[,;]/).slice(1);
    if (!decimalCommaBroken) return toks.map((t) => parseFloat(t)).filter((v) => Number.isFinite(v));
    const out: number[] = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k].trim();
      const nxt = toks[k + 1]?.trim();
      if (/^-?\d+$/.test(t) && nxt && /^\d{7,}\.$/.test(nxt)) {
        const v = parseFloat(`${t}.${nxt.slice(0, -1)}`);
        if (Number.isFinite(v)) { out.push(v); k++; continue; }
      }
      const v = parseFloat(t);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  };
  // 124 변환행렬: R11..R13,T1,R21..,T2,R31..,T3 (12 reals)
  const xformOf = new Map<number, number[]>();
  const xformParent = new Map<number, number>(); // 중첩 변환(124가 또 다른 124를 참조)
  for (const e of entries) {
    if (e.type === 124) {
      const r = realsOf(e.de);
      if (r.length >= 12) xformOf.set(e.de, r.slice(0, 12));
      if (e.xform > 0) xformParent.set(e.de, e.xform);
    }
  }
  // 12-real 행렬 합성 A∘B(먼저 B, 그다음 A): R=A.R·B.R, T=A.R·B.T+A.T
  const compose = (A: number[], B: number[]): number[] => {
    const rIdx = [0, 1, 2, 4, 5, 6, 8, 9, 10];
    const out = new Array(12).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[rIdx[i * 3 + k]] * B[rIdx[k * 3 + j]];
      out[i * 4 + j] = s;
    }
    for (let i = 0; i < 3; i++) {
      out[i * 4 + 3] = A[rIdx[i * 3]] * B[3] + A[rIdx[i * 3 + 1]] * B[7] + A[rIdx[i * 3 + 2]] * B[11] + A[i * 4 + 3];
    }
    return out;
  };
  // 중첩 변환 해소(부모 체인 합성 — 순환 가드 8)
  const resolvedXform = new Map<number, number[]>();
  const resolveXf = (de: number): number[] | undefined => {
    if (resolvedXform.has(de)) return resolvedXform.get(de);
    let m = xformOf.get(de);
    if (!m) return undefined;
    let parent = xformParent.get(de), guard = 0;
    while (parent && guard++ < 8) {
      const pm = xformOf.get(parent);
      if (!pm) break;
      m = compose(pm, m);
      parent = xformParent.get(parent);
    }
    resolvedXform.set(de, m);
    return m;
  };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let pts = 0, used = 0, skippedEnt = 0;
  const feed = (x: number, y: number, z: number, xf?: number[]) => {
    if (xf) {
      const nx = xf[0] * x + xf[1] * y + xf[2] * z + xf[3];
      const ny = xf[4] * x + xf[5] * y + xf[6] * z + xf[7];
      const nz = xf[8] * x + xf[9] * y + xf[10] * z + xf[11];
      x = nx; y = ny; z = nz;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    pts++;
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
  };
  for (const e of entries) {
    const xf = e.xform > 0 ? resolveXf(e.xform) : undefined;
    const r = realsOf(e.de);
    if (!r.length) continue;
    if (e.type === 116) { feed(r[0], r[1], r[2], xf); used++; }
    else if (e.type === 110) { feed(r[0], r[1], r[2], xf); feed(r[3], r[4], r[5], xf); used++; }
    else if (e.type === 100) {
      // 원호(Circular Arc): ZT, Xc,Yc(중심), X1,Y1(시점), X2,Y2(종점). 평면 z=ZT.
      // 경계 근사=외접 원(중심±R 4방위)+시·종점 — 원호 실범위 과대측(안전 명시).
      const zt = r[0], xc = r[1], yc = r[2], x1 = r[3], y1 = r[4], x2 = r[5], y2 = r[6];
      const rad = Math.hypot(x1 - xc, y1 - yc);
      feed(x1, y1, zt, xf); feed(x2, y2, zt, xf);
      for (const [dx, dy] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) feed(xc + dx, yc + dy, zt, xf);
      used++;
    } else if (e.type === 106) {
      // Copious Data: r[0]=IP(1=2D공통z, 2=3D, 3=3D+법선), r[1]=N, 이후 좌표.
      const ip = Math.round(r[0]), n = Math.round(r[1]);
      if (ip === 1) { const z = r[2]; for (let k = 0; k < n && 3 + k * 2 + 1 < r.length; k++) feed(r[3 + k * 2], r[3 + k * 2 + 1], z, xf); }
      else { const stride = ip === 3 ? 6 : 3; for (let k = 0; k < n && 2 + k * stride + 2 < r.length; k++) feed(r[2 + k * stride], r[2 + k * stride + 1], r[2 + k * stride + 2], xf); }
      used++;
    }
    else if (e.type === 502) {
      // VERTEX LIST: N, then N×(x,y,z)
      const n = Math.round(r[0]);
      for (let k = 0; k < n && 1 + k * 3 + 2 < r.length; k++) feed(r[1 + k * 3], r[2 + k * 3], r[3 + k * 3], xf);
      used++;
    } else if (e.type === 126) {
      // NURBS curve: K,M,P1..P4, knots(K+M+2), weights(K+1), ctrl pts 3(K+1)
      const K = Math.round(r[0]), M = Math.round(r[1]);
      const iCtrl = 6 + (K + M + 2) + (K + 1);
      for (let k = 0; k <= K && iCtrl + k * 3 + 2 < r.length; k++) feed(r[iCtrl + k * 3], r[iCtrl + k * 3 + 1], r[iCtrl + k * 3 + 2], xf);
      used++;
    } else if (e.type === 128) {
      // NURBS surface: K1,K2,M1,M2,P1..P5, knots(K1+M1+2)+(K2+M2+2), weights((K1+1)(K2+1)), ctrl pts ×3
      const K1 = Math.round(r[0]), K2 = Math.round(r[1]), M1 = Math.round(r[2]), M2 = Math.round(r[3]);
      const nw = (K1 + 1) * (K2 + 1);
      const iCtrl = 9 + (K1 + M1 + 2) + (K2 + M2 + 2) + nw;
      for (let k = 0; k < nw && iCtrl + k * 3 + 2 < r.length; k++) feed(r[iCtrl + k * 3], r[iCtrl + k * 3 + 1], r[iCtrl + k * 3 + 2], xf);
      used++;
    } else if (e.type !== 124) skippedEnt++;
  }
  if (pts < 4) return { ok: false, error: `IGES 좌표 추출 0건(지원 엔티티 100/106/110/116/502/126/128 없음 — 미반영 ${skippedEnt}종)`, stats: { format: 'iges', points: pts, entitiesUsed: used, entitiesSkipped: skippedEnt } };
  return {
    ok: true,
    assembly: {
      name, domain: 'mech', importedApprox: true,
      parts: [boundsToPart(min, max, name.replace(/[^\w가-힣-]/g, '_').slice(0, 40) || 'iges_part', material)],
      note: `IGES 임포트 근사(지원 엔티티 좌표 AABB 단일 box — 원기하 아님) · 미반영 엔티티 ${skippedEnt}종(원호 평면좌표계 등 — 경계 과소 가능 명시) · 질량=AABB 체적(과대측)`,
    },
    stats: { format: 'iges', points: pts, entitiesUsed: used, entitiesSkipped: skippedEnt },
  };
}
