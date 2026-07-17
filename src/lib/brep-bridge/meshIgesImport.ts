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

/** STL(ascii/binary) → 단일 box 근사 어셈블리. */
export function stlToNexyfabAssembly(data: Buffer, { name = 'STL import', material = 'steel' } = {}): MeshImportResult {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let pts = 0;
  const feed = (x: number, y: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    pts++;
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
  };
  const head = data.subarray(0, 512).toString('latin1');
  const isAscii = /^\s*solid\b/.test(head) && /facet|endsolid/.test(data.subarray(0, 4096).toString('latin1'));
  let format: 'stl-ascii' | 'stl-binary';
  if (isAscii) {
    format = 'stl-ascii';
    for (const m of data.toString('latin1').matchAll(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g)) {
      feed(+m[1], +m[2], +m[3]);
    }
  } else {
    format = 'stl-binary';
    if (data.length < 84) return { ok: false, error: 'STL 파일이 너무 짧음(84바이트 미만)' };
    const n = data.readUInt32LE(80);
    if (data.length < 84 + n * 50) return { ok: false, error: `STL 삼각형 수(${n}) 대비 파일 크기 부족 — 손상 파일` };
    for (let i = 0; i < n; i++) {
      const off = 84 + i * 50 + 12; // normal 3float 건너뜀
      for (let v = 0; v < 3; v++) {
        feed(data.readFloatLE(off + v * 12), data.readFloatLE(off + v * 12 + 4), data.readFloatLE(off + v * 12 + 8));
      }
    }
  }
  if (pts < 3) return { ok: false, error: '정점 0건 — STL 형식 인식 실패' };
  return {
    ok: true,
    assembly: {
      name, domain: 'mech', importedApprox: true,
      parts: [boundsToPart(min, max, name.replace(/[^\w가-힣-]/g, '_').slice(0, 40) || 'stl_part', material)],
      note: 'STL 임포트 근사(정점 AABB 단일 box — 부품 구조·원기하 없음) · 질량=AABB 체적(과대측) · 단위=파일 기재값 그대로(mm 가정 명시)',
    },
    stats: { format, points: pts },
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
  const realsOf = (de: number): number[] => {
    const s = pByDe.get(de);
    if (!s) return [];
    // 첫 필드=엔티티 타입 반복 — 제거 후 콤마 분해(H-string 은 숫자 아님 → NaN 필터)
    return s.split(/[,;]/).slice(1).map((t) => parseFloat(t)).filter((v) => Number.isFinite(v));
  };
  // 124 변환행렬: R11..R13,T1,R21..,T2,R31..,T3 (12 reals)
  const xformOf = new Map<number, number[]>();
  for (const e of entries) {
    if (e.type === 124) {
      const r = realsOf(e.de);
      if (r.length >= 12) xformOf.set(e.de, r.slice(0, 12));
    }
  }
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
    const xf = e.xform > 0 ? xformOf.get(e.xform) : undefined;
    const r = realsOf(e.de);
    if (!r.length) continue;
    if (e.type === 116) { feed(r[0], r[1], r[2], xf); used++; }
    else if (e.type === 110) { feed(r[0], r[1], r[2], xf); feed(r[3], r[4], r[5], xf); used++; }
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
  if (pts < 4) return { ok: false, error: `IGES 좌표 추출 0건(지원 엔티티 116/110/502/126/128 없음 — 미반영 ${skippedEnt}종)`, stats: { format: 'iges', points: pts, entitiesUsed: used, entitiesSkipped: skippedEnt } };
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
