/**
 * 배관 어휘 — 노즐 스텁 · 맨해튼 라우팅 · 큐브 엘보 (위시빌더 스키드 실전 260717 교훈).
 *
 * OCCT 안전 규칙 내장(생성 시 자동 적용):
 *  - 세그먼트를 엘보 큐브 안쪽으로 후퇴(d/2+2mm) — 동일지름 직교 실린더가 waypoint에서
 *    만나면 표면 탄젠트 특이점으로 fuse가 abort하는 것 방지
 *  - 경로 양끝 2mm 연장 — 노즐 스텁 단면과의 동일평면(coincident face) 접촉 방지
 *  - 엘보 = 축정렬 큐브(스피어는 인접 스피어와 정확 외접 시 특이점 → 사용 안 함)
 *
 * 설계 타당성(시공 불가능 경로 거부):
 *  - routeGate: 비축정렬(대각) 세그먼트·중복 waypoint·엘보 후퇴가 불가능한 초단 세그먼트 거부
 *  - pipeObstacleCheck: 배관이 장비 엔벨로프를 관통하는지 AABB 검사(시작/끝 장비는 allow)
 *
 * 좌표·피처 규약은 compose.mjs 범용 intent와 동일(box/cylinder + at.translate/rotate).
 */

const EXT = 2;          // 끝단 연장(스텁 내부로)
const RETREAT_PAD = 2;  // 엘보 후퇴 여유(d/2 + PAD)
const fin = (n) => typeof n === 'number' && Number.isFinite(n);

function axisOf(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const nz = d.map((v, i) => [Math.abs(v), i]).filter(([v]) => v > 1e-6);
  if (nz.length !== 1) return { axis: -1, len: Math.hypot(...d) };
  return { axis: nz[0][1], len: nz[0][0], sign: Math.sign(d[nz[0][1]]) };
}

/** 경로 타당성 게이트 — 시공 불가능/OCCT 불가 경로를 생성 전에 거부. errors[] 반환. */
export function routeGate(pts, { d = 26 } = {}) {
  const e = [];
  if (!Array.isArray(pts) || pts.length < 2) return ['waypoint 2개 이상 필요'];
  if (!(d > 0)) e.push('배관 지름 invalid');
  for (const [i, p] of pts.entries()) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(fin)) e.push(`pt${i}: 좌표 invalid`);
  }
  if (e.length) return e;
  const ret = d / 2 + RETREAT_PAD;
  for (let i = 0; i < pts.length - 1; i++) {
    const { axis, len } = axisOf(pts[i], pts[i + 1]);
    if (len < 1e-6) { e.push(`seg${i}: 중복 waypoint`); continue; }
    if (axis < 0) { e.push(`seg${i}: 대각(비축정렬) 세그먼트 — 맨해튼 경로만 허용`); continue; }
    // 내부 세그먼트는 양쪽 후퇴, 끝 세그먼트는 한쪽 — 후퇴 후 길이가 남아야 시공 가능
    const cut = (i > 0 ? ret : 0) + (i < pts.length - 2 ? ret : 0);
    if (len <= cut + 0.5) e.push(`seg${i}: 세그먼트 ${len.toFixed(1)}mm — 엘보 후퇴(${cut.toFixed(1)}mm) 불가, 경로 단순화 필요`);
  }
  return e;
}

/**
 * 맨해튼 경로 → 안전 배관 피처(실린더 세그먼트 + 큐브 엘보).
 * @returns {{ features: object[], errors: string[] }}
 */
export function routeFeatures(pts, { d = 26, col } = {}) {
  const errors = routeGate(pts, { d });
  if (errors.length) return { features: [], errors };
  const P = pts.map((p) => [...p]);
  const ext = (a, b) => { // a를 b 반대 방향으로 EXT만큼 밀기
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    a[0] += EXT * dx / L; a[1] += EXT * dy / L; a[2] += EXT * dz / L;
  };
  ext(P[0], P[1]); ext(P[P.length - 1], P[P.length - 2]);
  const mv = (a, b, dist) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    return [a[0] + dist * dx / L, a[1] + dist * dy / L, a[2] + dist * dz / L];
  };
  const ret = d / 2 + RETREAT_PAD;
  const F = [];
  const cyl = (a, b) => {
    const [ax, ay, az] = a, [bx, by, bz] = b;
    if (Math.abs(bx - ax) > 1e-6) F.push({ kind: 'cylinder', diameter: d, height: Math.abs(bx - ax), op: 'add', at: { translate: [Math.min(ax, bx), ay, az], rotate: [0, 90, 0] }, ...(col ? { _col: col } : {}) });
    else if (Math.abs(by - ay) > 1e-6) F.push({ kind: 'cylinder', diameter: d, height: Math.abs(by - ay), op: 'add', at: { translate: [ax, Math.min(ay, by), az], rotate: [-90, 0, 0] }, ...(col ? { _col: col } : {}) });
    else F.push({ kind: 'cylinder', diameter: d, height: Math.abs(bz - az), op: 'add', at: { translate: [ax, ay, Math.min(az, bz)] }, ...(col ? { _col: col } : {}) });
  };
  for (let i = 0; i < P.length - 1; i++) {
    const a = i > 0 ? mv(P[i], P[i + 1], ret) : P[i];
    const b = i < P.length - 2 ? mv(P[i + 1], P[i], ret) : P[i + 1];
    cyl(a, b);
    if (i > 0) {
      const e = d + 6;
      F.push({ kind: 'box', size: [e, e, e], op: 'add', at: { translate: [P[i][0] - e / 2, P[i][1] - e / 2, P[i][2] - e / 2] }, ...(col ? { _col: col } : {}) });
    }
  }
  return { features: F, errors: [] };
}

/** 노즐 스텁(관 + 플랜지) 피처. axis ∈ x±|y±|z± */
export function stubFeatures([x, y, z], axis, d, { len = 40, flange = true, col } = {}) {
  const F = [];
  const C = col ? { _col: col } : {};
  const push = (dd, h, at) => F.push({ kind: 'cylinder', diameter: dd, height: h, op: 'add', at, ...C });
  const rot = { x: [0, 90, 0], y: [-90, 0, 0], z: undefined };
  const a = axis[0], s = axis[1] === '-' ? -1 : 1;
  if (a === 'z') { push(d, len, { translate: [x, y, s > 0 ? z : z - len] }); if (flange) push(d + 16, 8, { translate: [x, y, s > 0 ? z + len : z - len] }); }
  else if (a === 'y') { push(d, len, { translate: [x, s > 0 ? y : y - len, z], rotate: rot.y }); if (flange) push(d + 16, 8, { translate: [x, s > 0 ? y + len : y - len, z], rotate: rot.y }); }
  else { push(d, len, { translate: [s > 0 ? x : x - len, y, z], rotate: rot.x }); if (flange) push(d + 16, 8, { translate: [s > 0 ? x + len : x - len, y, z], rotate: rot.x }); }
  return F;
}

/** 세그먼트별 AABB(반지름 인플레이트) — 관통 검사용. */
export function segmentAabbs(pts, d) {
  const r = d / 2, out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push({
      seg: i,
      min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
      max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
    });
  }
  return out;
}

/**
 * 배관 ↔ 장비 엔벨로프 관통 검사(설계 타당성 그물).
 * - 원통 장비(round:'z'|'x')는 실린더로 취급 — AABB 모서리 스침 오탐 제거(위시빌더 실증)
 * - 접속 끝점 자동 허용: 경로의 시작/끝이 장비 근방(pad 60mm)이면 그 장비는 관통 아님
 * @param routes  [{ label, pts, d, allow?: string[] }] — allow=추가 수동 허용 라벨(선택)
 * @param obstacles [{ label, min:[x,y,z], max:[x,y,z], round?: 'z'|'x' }]
 * @param margin 허용 침투(mm, 기본 3 — 접속 여유)
 * @returns violations [{ route, seg, obstacle, depthMm }]
 */
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function _obPen(s, ob) {
  if (ob.round === 'z') {
    const cx = (ob.min[0] + ob.max[0]) / 2, cy = (ob.min[1] + ob.max[1]) / 2, r = (ob.max[0] - ob.min[0]) / 2;
    const dz = Math.min(s.max[2], ob.max[2]) - Math.max(s.min[2], ob.min[2]);
    if (dz <= 0) return -1;
    return Math.min(dz, r - Math.hypot(cx - _clamp(cx, s.min[0], s.max[0]), cy - _clamp(cy, s.min[1], s.max[1])));
  }
  if (ob.round === 'x') {
    const cy = (ob.min[1] + ob.max[1]) / 2, cz = (ob.min[2] + ob.max[2]) / 2, r = (ob.max[1] - ob.min[1]) / 2;
    const dx = Math.min(s.max[0], ob.max[0]) - Math.max(s.min[0], ob.min[0]);
    if (dx <= 0) return -1;
    return Math.min(dx, r - Math.hypot(cy - _clamp(cy, s.min[1], s.max[1]), cz - _clamp(cz, s.min[2], s.max[2])));
  }
  return Math.min(...[0, 1, 2].map((k) => Math.min(s.max[k], ob.max[k]) - Math.max(s.min[k], ob.min[k])));
}
// pad 25: 끝점은 장비 표면(stub 기부)에 놓이므로 소패드로 충분 — 60이면 인접 장비 출구가
// 큰 env를 통째 면제시키는 오탐(위시빌더 ct라인→RO 관통 미검출 사례)
const _nearOb = (p, ob, pad = 25) =>
  p[0] > ob.min[0] - pad && p[0] < ob.max[0] + pad &&
  p[1] > ob.min[1] - pad && p[1] < ob.max[1] + pad &&
  p[2] > ob.min[2] - pad && p[2] < ob.max[2] + pad;
export function pipeObstacleCheck(routes, obstacles, { margin = 3 } = {}) {
  const out = [];
  for (const rt of routes) {
    const allow = new Set(rt.allow ?? []);
    const ends = [rt.pts[0], rt.pts[rt.pts.length - 1]];
    for (const ob of obstacles) {
      if (allow.has(ob.label)) continue;
      if (ends.some((p) => _nearOb(p, ob))) continue; // 접속 장비 자동 허용
      for (const s of segmentAabbs(rt.pts, rt.d ?? 26)) {
        const pen = _obPen(s, ob);
        if (pen > margin) out.push({ route: rt.label ?? '?', seg: s.seg, obstacle: ob.label, depthMm: +pen.toFixed(1) });
      }
    }
  }
  return out;
}

/**
 * 배관 상호 교차 검사 — 서로 다른 라인이 관통(크로스 커넥션/시공 불가)하는지.
 * 의도된 티(라이저 끝→헤더 접속)는 끝점 패드로 자동 허용: 최근접점이 어느 한
 * 경로의 끝점에서 (d1+d2) 이내면 접속으로 본다.
 * @param routes [{ label, pts, d }]
 * @returns violations [{ a, b, segA, segB, gapMm }]  (gap<0 = 관통 깊이)
 */
function _segDist(p1, q1, p2, q2) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return { dist: Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), mid: [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2, (c1[2] + c2[2]) / 2] };
}
export function pipeCrossCheck(routes, { tol = 0.5 } = {}) {
  const out = [];
  const endsOf = (rt) => [rt.pts[0], rt.pts[rt.pts.length - 1]];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i; j < routes.length; j++) {
      const A = routes[i], B = routes[j];
      const pad = (A.d ?? 26) + (B.d ?? 26);
      const ends = [...endsOf(A), ...endsOf(B)];
      for (let ia = 0; ia < A.pts.length - 1; ia++) {
        const jb0 = i === j ? ia + 2 : 0; // 같은 경로면 인접(엘보 공유) 세그먼트 제외
        for (let ib = jb0; ib < B.pts.length - 1; ib++) {
          const { dist, mid } = _segDist(A.pts[ia], A.pts[ia + 1], B.pts[ib], B.pts[ib + 1]);
          const need = (A.d ?? 26) / 2 + (B.d ?? 26) / 2 - tol;
          if (dist >= need) continue;
          if (ends.some((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) <= pad)) continue; // 의도된 티
          out.push({ a: A.label ?? 'r' + i, b: B.label ?? 'r' + j, segA: ia, segB: ib, gapMm: +(dist - need - tol).toFixed(1) });
        }
      }
    }
  }
  return out;
}
