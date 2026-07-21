// ⓒ 로프트(loft) 저작 기반 — nexyfab의 자유곡면 mesh 부품 백엔드.
//
// 지금까지 로프트 바디(NACA 프로펠러·스텔스기 동체·터보팬 블레이드)는 케이스별로
// 손코딩돼 있었다. 이 모듈은 그 nacaLoop/loft/meshPart 패턴을 **재사용 가능한 유틸리티**로
// 승격한 것이다. 인터랙티브 커브/로프트 UI는 별도 후속(이 파일은 순수 지오메트리 코어).
//
// mesh 부품 규약(도메인 전역 공용):
//   { type:'mesh', params:{ verts:[[x,y,z]...], faces:[[a,b,c]...],
//                           aabb:{min,max}, volumeMm3, triCount } }
//
// 정직성(최우선): 전 함수 결정론적. 링 점 개수 불일치·스테이션 <2·퇴화(체적 0)면 throw.
// 조용한 폴백 없음. 체적은 발산정리(닫힌 삼각 메시)로 산출 — 다면체 근사임을 명시.

const TAU = Math.PI * 2;
const EPS_AREA = 1e-9;   // 2D 폴리곤 퇴화 판정(단위²)
const EPS_VOL = 1e-6;    // 로프트 솔리드 퇴화 판정(단위³)

// ───────────────────────── 내부 헬퍼 ─────────────────────────

/** 2D 폐루프 면적(신발끈). 부호 유지 — 퇴화 판정엔 abs 사용. */
function shoelaceArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** 3D 폴리곤 면적(Newell 법선 크기/2) — 링 퇴화(점으로 수축) 판정용. */
function ringArea3d(ring) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0, z0] = ring[i];
    const [x1, y1, z1] = ring[(i + 1) % ring.length];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

/** 링 중심(캡 팬의 정점). */
function centroid3d(ring) {
  const c = [0, 0, 0];
  for (const v of ring) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  const n = ring.length;
  return [c[0] / n, c[1] / n, c[2] / n];
}

function isFinite3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));
}

// ───────────────────────── 프로파일 생성기 ─────────────────────────
// 각각 **닫힌 루프** 2D 점 배열 `[[u,v]...]`(끝점 중복 없음, 반시계 지향)을 반환.

/** 원 프로파일 — 반지름 r, n분할. 정확히 n개 점. */
export function circleProfile(r, n = 32) {
  if (!(r > 0)) throw new Error(`circleProfile: 반지름 r>0 필요 (받음 ${r})`);
  if (!Number.isInteger(n) || n < 3) throw new Error(`circleProfile: n(정수)≥3 필요 (받음 ${n})`);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/** 초타원(수퍼엘립스) 프로파일 — 반축 a,b, n분할, 지수 exp(2=타원, 클수록 사각에 근접).
 *  |x/a|^exp + |y/b|^exp = 1. 정확히 n개 점. */
export function superellipseProfile(a, b, n = 48, exp = 2.5) {
  if (!(a > 0) || !(b > 0)) throw new Error(`superellipseProfile: a,b>0 필요 (받음 ${a},${b})`);
  if (!Number.isInteger(n) || n < 3) throw new Error(`superellipseProfile: n(정수)≥3 필요 (받음 ${n})`);
  if (!(exp > 0)) throw new Error(`superellipseProfile: exp>0 필요 (받음 ${exp})`);
  const p = 2 / exp;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (TAU * i) / n;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([
      a * Math.sign(c) * Math.abs(c) ** p,
      b * Math.sign(s) * Math.abs(s) ** p,
    ]);
  }
  return pts;
}

/** 다각형 프로파일 — 사용자 점 배열 검증(≥3점, 비퇴화) 후 복사 반환. */
export function polygonProfile(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error(`polygonProfile: 점 ≥3개 필요 (받음 ${points?.length})`);
  }
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error(`polygonProfile: 각 점은 유한 [u,v] 필요 (받음 ${JSON.stringify(p)})`);
    }
  }
  const copy = points.map(([u, v]) => [u, v]);
  if (Math.abs(shoelaceArea(copy)) < EPS_AREA) {
    throw new Error('polygonProfile: 퇴화(면적 0) 폴리곤 — 공선/영역없음');
  }
  return copy;
}

/** NACA 4자리 에어포일 폐루프 — code(예 '4412'), n(점 개수, 짝수).
 *  앞전(x=0)→상면→뒷전(x=1)→하면→앞전. 정확히 n개 점(짝수만).
 *  공표식(원 기하) — 상/하면 각 n/2 구획. */
export function nacaProfile(code = '0012', n = 40) {
  const s = String(code);
  if (!/^\d{4}$/.test(s)) throw new Error(`nacaProfile: 4자리 숫자 코드 필요 (받음 '${code}')`);
  if (!Number.isInteger(n) || n < 6 || n % 2 !== 0) {
    throw new Error(`nacaProfile: n(짝수 정수)≥6 필요 (받음 ${n})`);
  }
  const mC = parseInt(s[0], 10) / 100;          // 최대 캠버
  const pC = (parseInt(s[1], 10) || 1) / 10;    // 캠버 위치(0 방지)
  const tC = parseInt(s.slice(2), 10) / 100;    // 최대 두께
  const yt = (x) => 5 * tC * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const cam = (x) => (x < pC
    ? (mC / (pC * pC)) * (2 * pC * x - x * x)
    : (mC / ((1 - pC) ** 2)) * (1 - 2 * pC + 2 * pC * x - x * x));
  const half = n / 2;
  const pts = [];
  for (let i = 0; i <= half; i++) { const x = i / half; pts.push([x, cam(x) + yt(x)]); }     // 상면 LE→TE (half+1점)
  for (let i = half - 1; i > 0; i--) { const x = i / half; pts.push([x, cam(x) - yt(x)]); }   // 하면 TE→LE (half-1점)
  return pts; // 총 2*half = n점
}

/** 라운드 사각 프로파일 — 폭 w, 높이 h, 코너 반경 r, n분할(둘레 등간격). 정확히 n개 점.
 *  중심 원점. r=0이면 직사각. */
export function roundedRectProfile(w, h, r = 0, n = 48) {
  if (!(w > 0) || !(h > 0)) throw new Error(`roundedRectProfile: w,h>0 필요 (받음 ${w},${h})`);
  if (r < 0 || r > Math.min(w, h) / 2 + 1e-9) {
    throw new Error(`roundedRectProfile: r는 0..min(w,h)/2 범위 필요 (받음 ${r})`);
  }
  if (!Number.isInteger(n) || n < 4) throw new Error(`roundedRectProfile: n(정수)≥4 필요 (받음 ${n})`);
  const hw = w / 2, hh = h / 2;
  const straightX = w - 2 * r, straightY = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  // 코너 원호 중심(우상·좌상·좌하·우하)
  const cc = [
    [hw - r, hh - r],
    [-(hw - r), hh - r],
    [-(hw - r), -(hh - r)],
    [hw - r, -(hh - r)],
  ];
  // 반시계 경로: 우변↑ → 우상호 → 상변← → 좌상호 → 좌변↓ → 좌하호 → 하변→ → 우하호
  const segs = [
    { len: straightY, fn: (u) => [hw, -straightY / 2 + u] },
    { len: arc, fn: (u) => { const a = (u / (arc || 1)) * (Math.PI / 2); return [cc[0][0] + r * Math.cos(a), cc[0][1] + r * Math.sin(a)]; } },
    { len: straightX, fn: (u) => [straightX / 2 - u, hh] },
    { len: arc, fn: (u) => { const a = Math.PI / 2 + (u / (arc || 1)) * (Math.PI / 2); return [cc[1][0] + r * Math.cos(a), cc[1][1] + r * Math.sin(a)]; } },
    { len: straightY, fn: (u) => [-hw, straightY / 2 - u] },
    { len: arc, fn: (u) => { const a = Math.PI + (u / (arc || 1)) * (Math.PI / 2); return [cc[2][0] + r * Math.cos(a), cc[2][1] + r * Math.sin(a)]; } },
    { len: straightX, fn: (u) => [-straightX / 2 + u, -hh] },
    { len: arc, fn: (u) => { const a = 3 * Math.PI / 2 + (u / (arc || 1)) * (Math.PI / 2); return [cc[3][0] + r * Math.cos(a), cc[3][1] + r * Math.sin(a)]; } },
  ];
  const total = segs.reduce((s, seg) => s + seg.len, 0);
  const pts = [];
  for (let i = 0; i < n; i++) {
    let d = (total * i) / n;
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      if (d <= seg.len || si === segs.length - 1) { pts.push(seg.fn(Math.min(d, seg.len))); break; }
      d -= seg.len;
    }
  }
  return pts;
}

// ───────────────────────── 로프트 코어 ─────────────────────────

/** rings(각 스테이션의 3D 점 링 배열)를 삼각 메시로 로프트.
 *  - 모든 링 점 개수 동일해야 함(아니면 throw).
 *  - 스테이션 <2 → throw.
 *  - 결과 체적 ≈0(퇴화) → throw.
 *  연속 링을 quad→2삼각형으로 잇고, 양단은 중심 팬 캡(caps=true).
 *  퇴화(점으로 수축) 끝링은 캡을 생략(측면 삼각형이 이미 수렴 — watertight 유지).
 *  반환: { verts, faces, aabb:{min,max}, volumeMm3, triCount }.
 *  volumeMm3 = 발산정리(닫힌 삼각 메시) — 다면체 근사(링 분할 유한). */
export function loftMesh(rings, { caps = true } = {}) {
  if (!Array.isArray(rings) || rings.length < 2) {
    throw new Error(`loftMesh: 스테이션(링) ≥2개 필요 (받음 ${rings?.length})`);
  }
  const M = rings[0].length;
  if (!(M >= 3)) throw new Error(`loftMesh: 링당 점 ≥3개 필요 (받음 ${M})`);
  for (let k = 0; k < rings.length; k++) {
    const ring = rings[k];
    if (!Array.isArray(ring) || ring.length !== M) {
      throw new Error(`loftMesh: 링 점 개수 불일치 — 링0=${M}, 링${k}=${ring?.length}`);
    }
    for (const v of ring) {
      if (!isFinite3(v)) throw new Error(`loftMesh: 링${k}에 비유한/비3D 점 (${JSON.stringify(v)})`);
    }
  }
  const verts = [];
  const faces = [];
  for (const ring of rings) for (const v of ring) verts.push([v[0], v[1], v[2]]);
  // 측면
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < M; i++) {
      const a = k * M + i;
      const b = k * M + ((i + 1) % M);
      const c = (k + 1) * M + ((i + 1) % M);
      const d = (k + 1) * M + i;
      faces.push([a, b, c], [a, c, d]);
    }
  }
  // 캡(퇴화 끝링은 생략)
  if (caps) {
    if (ringArea3d(rings[0]) > EPS_AREA) {
      const ci = verts.length; verts.push(centroid3d(rings[0]));
      for (let i = 0; i < M; i++) faces.push([ci, (i + 1) % M, i]); // 내향(하단) 와인딩
    }
    const lastBase = (rings.length - 1) * M;
    if (ringArea3d(rings[rings.length - 1]) > EPS_AREA) {
      const ci = verts.length; verts.push(centroid3d(rings[rings.length - 1]));
      for (let i = 0; i < M; i++) faces.push([ci, lastBase + i, lastBase + ((i + 1) % M)]); // 외향(상단) 와인딩
    }
  }
  // AABB + 발산정리 체적
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let j = 0; j < 3; j++) { if (v[j] < mn[j]) mn[j] = v[j]; if (v[j] > mx[j]) mx[j] = v[j]; }
  let vol6 = 0;
  for (const [a, b, c] of faces) {
    const A = verts[a], B = verts[b], C = verts[c];
    vol6 += A[0] * (B[1] * C[2] - B[2] * C[1]) + A[1] * (B[2] * C[0] - B[0] * C[2]) + A[2] * (B[0] * C[1] - B[1] * C[0]);
  }
  const volume = Math.abs(vol6 / 6);
  if (!(volume > EPS_VOL)) {
    throw new Error(`loftMesh: 퇴화 로프트 — 체적≈0 (${volume}). 링이 동일/공면/영역없음`);
  }
  return {
    verts: verts.map((v) => v.map((x) => +x.toFixed(4))),
    faces,
    aabb: { min: mn.map((v) => +v.toFixed(3)), max: mx.map((v) => +v.toFixed(3)) },
    volumeMm3: +volume.toFixed(2),
    triCount: faces.length,
  };
}

/** 완전한 mesh 부품 객체 반환 — { id, type:'mesh', material, role, at, params:{...} }. */
export function loftPart(id, rings, { material = 'composite', role = 'body', caps = true, at = { tx: 0, ty: 0, tz: 0 } } = {}) {
  if (!id) throw new Error('loftPart: id 필요');
  const geo = loftMesh(rings, { caps });
  return {
    id,
    type: 'mesh',
    material,
    role,
    at,
    params: {
      volumeMm3: geo.volumeMm3,
      triCount: geo.triCount,
      aabb: geo.aabb,
      verts: geo.verts,
      faces: geo.faces,
    },
  };
}

/** 축을 따라 2D 프로파일을 스테이션마다 배치·로프트하는 헬퍼.
 *  profile2d: 닫힌 2D 루프 [[u,v]...].
 *  stations: [{ at:[x,y,z], scale=1, rot=0 }...] — 프로파일 평면 내 회전 rot(rad), 등방 scale.
 *  opts.axis: 'z'(기본, 평면 XY) | 'x'(평면 YZ) | 'y'(평면 XZ) — 프로파일 평면의 법선 축.
 *  반환: loftMesh 결과 + { rings } (호출자가 loftPart(id, result.rings)로 재활용 가능). */
export function loftAlongAxis(profile2d, stations, opts = {}) {
  const { axis = 'z', caps = true } = opts;
  if (!Array.isArray(profile2d) || profile2d.length < 3) {
    throw new Error(`loftAlongAxis: profile2d 점 ≥3개 필요 (받음 ${profile2d?.length})`);
  }
  if (Math.abs(shoelaceArea(profile2d)) < EPS_AREA) {
    throw new Error('loftAlongAxis: 퇴화(면적 0) 프로파일');
  }
  if (!Array.isArray(stations) || stations.length < 2) {
    throw new Error(`loftAlongAxis: 스테이션 ≥2개 필요 (받음 ${stations?.length})`);
  }
  if (!['x', 'y', 'z'].includes(axis)) throw new Error(`loftAlongAxis: axis는 'x'|'y'|'z' (받음 '${axis}')`);
  const embed = (u, v, station) => {
    const s = station.scale ?? 1;
    const th = station.rot ?? 0;
    const at = station.at;
    if (!isFinite3(at)) throw new Error(`loftAlongAxis: station.at는 유한 [x,y,z] 필요 (받음 ${JSON.stringify(at)})`);
    if (!(s > 0)) throw new Error(`loftAlongAxis: station.scale>0 필요 (받음 ${s})`);
    const ru = (u * Math.cos(th) - v * Math.sin(th)) * s;
    const rv = (u * Math.sin(th) + v * Math.cos(th)) * s;
    if (axis === 'z') return [at[0] + ru, at[1] + rv, at[2]];
    if (axis === 'x') return [at[0], at[1] + ru, at[2] + rv];
    return [at[0] + ru, at[1], at[2] + rv]; // axis === 'y' (평면 XZ)
  };
  const rings = stations.map((st) => profile2d.map(([u, v]) => embed(u, v, st)));
  const mesh = loftMesh(rings, { caps });
  return { ...mesh, rings };
}

// ─────────────── 스펙 기반(JSON 저작: CLI/MCP/라우트에서 함수 없이 로프트) ───────────────

/** 프로파일 스펙(JSON) → 2D 프로파일. type: circle|superellipse|naca|roundedRect|polygon. */
export function profileFromSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('profile spec 객체 필요');
  switch (spec.type) {
    case 'circle': return circleProfile(spec.r ?? spec.radius, spec.n);
    case 'superellipse': return superellipseProfile(spec.a, spec.b, spec.n, spec.exp);
    case 'naca': return nacaProfile(spec.code, spec.n);
    case 'roundedRect': return roundedRectProfile(spec.w ?? spec.width, spec.h ?? spec.height, spec.r ?? 0, spec.n);
    case 'polygon': return polygonProfile(spec.points);
    default: throw new Error(`알 수 없는 profile type '${spec?.type}' (circle|superellipse|naca|roundedRect|polygon)`);
  }
}

/** 로프트 스펙(JSON) → mesh 부품. { id?, profile:<spec>, stations:[{at,scale,rot}], axis?, material?, role? }. */
export function loftPartFromSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('loft spec 객체 필요');
  const prof = profileFromSpec(spec.profile);
  const mesh = loftAlongAxis(prof, spec.stations, { axis: spec.axis ?? 'z', ...(spec.caps === false ? { caps: false } : {}) });
  return {
    id: spec.id ?? 'loft', type: 'mesh', material: spec.material ?? 'composite', role: spec.role ?? 'body',
    at: { tx: 0, ty: 0, tz: 0 },
    params: { verts: mesh.verts, faces: mesh.faces, aabb: mesh.aabb, volumeMm3: mesh.volumeMm3, triCount: mesh.triCount },
  };
}

// ───────────────────────── 데모 ─────────────────────────

/** 로프트 바디 하나(페어링 덕트 — 원형 흡입구가 라운드 사각 배기구로 매끈히 전이)로
 *  어셈블리 반환. 결정론적 — 성능해석 없음(형상 데모). */
export function demoLoftAssembly() {
  // 원 프로파일(정규화)을 축(z)따라 K스테이션 로프트: 흡입 원형 → 중앙 확장 → 배기 라운드사각.
  const N = 40;
  const inlet = circleProfile(1, N);                    // 정규화 원(반지름 1)
  const outlet = roundedRectProfile(2.2, 1.4, 0.4, N);  // 라운드 사각 배기(동일 점수 N)
  // 두 프로파일을 t로 선형 블렌딩(동일 점수) — 매끈한 형상 전이.
  const blend = (t) => inlet.map(([u0, v0], i) => {
    const [u1, v1] = outlet[i];
    return [u0 + (u1 - u0) * t, v0 + (v1 - v0) * t];
  });
  const K = 6;          // 스테이션(축방향 링)
  const length = 300;   // mm
  const scaleAt = (t) => 60 * (1 + 0.9 * Math.sin(Math.PI * t)); // 중앙 벌징(mm)
  const rings = [];
  for (let k = 0; k < K; k++) {
    const t = k / (K - 1);
    const z = length * t;
    const s = scaleAt(t);
    rings.push(blend(t).map(([u, v]) => [u * s, v * s, z]));
  }
  const part = loftPart('fairing_duct', rings, { material: 'composite', role: 'body' });
  return {
    name: '페어링 덕트 (로프트 곡면 · 형상 데모)',
    domain: 'mech',
    kind: 'assembly',
    parts: [part],
    note: '원형 흡입 → 중앙 벌징 → 라운드사각 배기로 매끈히 전이하는 단일 로프트 바디. '
      + '체적=발산정리(다면체 근사)·형상 데모 — 유동/구조 성능해석 미포함.',
  };
}
