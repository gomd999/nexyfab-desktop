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
  let prevSeg = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = axisOf(pts[i], pts[i + 1]);
    const { axis, len } = seg;
    if (len < 1e-6) { e.push(`seg${i}: 중복 waypoint`); continue; }
    if (axis < 0) { e.push(`seg${i}: 대각(비축정렬) 세그먼트 — 맨해튼 경로만 허용`); prevSeg = null; continue; }
    // 같은 축 역방향 연속(백트랙) = 자기 배관 관통 — 위시빌더 7차 "수동 route 우회" 함정
    if (prevSeg && prevSeg.axis === axis && prevSeg.sign !== seg.sign) e.push(`seg${i}: 역주행(백트랙) — 직전 세그먼트를 되돌아 관통`);
    // 내부 세그먼트는 양쪽 후퇴, 끝 세그먼트는 한쪽 — 후퇴 후 길이가 남아야 시공 가능
    const cut = (i > 0 ? ret : 0) + (i < pts.length - 2 ? ret : 0);
    if (len <= cut + 0.5) e.push(`seg${i}: 세그먼트 ${len.toFixed(1)}mm — 엘보 후퇴(${cut.toFixed(1)}mm) 불가, 경로 단순화 필요`);
    prevSeg = seg;
  }
  return e;
}

const AX_IDX = { x: 0, y: 1, z: 2 };

/**
 * 경로 정규화 — routeGate 를 우회하는 "수동 route" 함정(위시빌더 7차)의 코드화.
 * ① 중복 waypoint 제거 ② 같은 축·같은 방향 연속 세그먼트 병합
 * ③ 대각 세그먼트 → 축순차 분해(startAxis/endAxis 지정 시 첫/마지막 이동축을 스텁 축에 맞춤
 *    — "스텁 축방향 진입 엘보 필수" 규칙의 자동화). 남는 문제는 여전히 routeGate 가 거부.
 * @returns { pts, adjustments: string[] }
 */
export function normalizeRoute(pts, { startAxis, endAxis } = {}) {
  const adjustments = [];
  if (!Array.isArray(pts) || pts.length < 2) return { pts, adjustments };
  let P = pts.map((p) => [...p]);
  // ① dedupe
  const dd = [P[0]];
  for (let i = 1; i < P.length; i++) {
    if (Math.hypot(P[i][0] - dd[dd.length - 1][0], P[i][1] - dd[dd.length - 1][1], P[i][2] - dd[dd.length - 1][2]) < 1e-6) { adjustments.push(`pt${i}: 중복 waypoint 제거`); continue; }
    dd.push(P[i]);
  }
  P = dd;
  // ③ 대각 분해 — 세그먼트별로 다축 이동이면 축순차 waypoint 로 전개
  const out = [P[0]];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const deltas = [0, 1, 2].map((k) => b[k] - a[k]);
    const moved = [0, 1, 2].filter((k) => Math.abs(deltas[k]) > 1e-6);
    if (moved.length <= 1) { out.push(b); continue; }
    // 축 순서: |이동량| 내림차순 기본, 첫 세그먼트는 startAxis 우선·마지막 세그먼트는 endAxis 를 맨 뒤로
    let order = moved.slice().sort((p, q) => Math.abs(deltas[q]) - Math.abs(deltas[p]));
    const sIdx = startAxis ? AX_IDX[startAxis[0]] : -1;
    const eIdx = endAxis ? AX_IDX[endAxis[0]] : -1;
    if (i === 0 && sIdx >= 0 && order.includes(sIdx)) order = [sIdx, ...order.filter((k) => k !== sIdx)];
    if (i === P.length - 2 && eIdx >= 0 && order.includes(eIdx)) order = [...order.filter((k) => k !== eIdx), eIdx];
    let cur = [...a];
    for (const k of order) { cur = [...cur]; cur[k] = b[k]; out.push(cur); }
    adjustments.push(`seg${i}: 대각 세그먼트 → 축순차 ${order.map((k) => 'xyz'[k]).join('→')} 분해`);
  }
  // ② 같은 축·같은 방향 연속 병합
  const merged = [out[0]];
  for (let i = 1; i < out.length; i++) {
    if (merged.length >= 2) {
      const s1 = axisOf(merged[merged.length - 2], merged[merged.length - 1]);
      const s2 = axisOf(merged[merged.length - 1], out[i]);
      if (s1.axis >= 0 && s1.axis === s2.axis && s1.sign === s2.sign) { merged[merged.length - 1] = out[i]; continue; }
    }
    merged.push(out[i]);
  }
  if (merged.length !== out.length) adjustments.push(`동일축 연속 세그먼트 ${out.length - merged.length}건 병합`);
  return { pts: merged, adjustments };
}

/**
 * 맨해튼 경로 → 안전 배관 피처(실린더 세그먼트 + 큐브 엘보).
 * 기본으로 normalizeRoute(중복 제거·대각 축분해·병합)를 먼저 적용한 뒤 게이트 —
 * routeGate 미배선 수동 경로가 오렌더되는 우회로를 코드로 차단(위시빌더 7차).
 * @returns {{ features: object[], errors: string[], adjustments: string[] }}
 */
export function routeFeatures(pts, { d = 26, col, normalize = true, startAxis, endAxis } = {}) {
  let adjustments = [];
  if (normalize) { const n = normalizeRoute(pts, { startAxis, endAxis }); pts = n.pts; adjustments = n.adjustments; }
  const errors = routeGate(pts, { d });
  if (errors.length) return { features: [], errors, adjustments };
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
  return { features: F, errors: [], adjustments };
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
  if (ob.round === 'y') { // 다본 장비 부재별 장애물 일반화(#4) — y축 원통(rx=±90 배치)도 실린더로
    const cx = (ob.min[0] + ob.max[0]) / 2, cz = (ob.min[2] + ob.max[2]) / 2, r = (ob.max[0] - ob.min[0]) / 2;
    const dy = Math.min(s.max[1], ob.max[1]) - Math.max(s.min[1], ob.min[1]);
    if (dy <= 0) return -1;
    return Math.min(dy, r - Math.hypot(cx - _clamp(cx, s.min[0], s.max[0]), cz - _clamp(cz, s.min[2], s.max[2])));
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

/** 장비 AABB 면 중심 포트 — face ∈ x±|y±|z± → { p:[x,y,z], axis:'x+'… } */
export function portPoint(item, face = 'z+') {
  const c = [0, 1, 2].map((k) => (item.min[k] + item.max[k]) / 2);
  const i = AX_IDX[face[0]] ?? 2;
  const s = face[1] === '-' ? -1 : 1;
  const p = [...c];
  p[i] = s > 0 ? item.max[i] : item.min[i];
  return { p, axis: face };
}

// 배관 끝점 해석: 'partLabel.face' 문자열 | { part, face, offset } | [x,y,z] 원시좌표
function _resolveEnd(spec, byLabel) {
  if (Array.isArray(spec)) return { p: spec.slice(), axis: null, label: null };
  let part, face, offset;
  if (typeof spec === 'string') { const ix = spec.lastIndexOf('.'); part = ix > 0 ? spec.slice(0, ix) : spec; face = ix > 0 ? spec.slice(ix + 1) : 'z+'; }
  else if (spec && typeof spec === 'object') { part = spec.part; face = spec.face ?? 'z+'; offset = spec.offset; }
  const it = byLabel.get(part);
  if (!it) return { error: `끝점 부품 '${part}' 없음` };
  const pp = portPoint(it, face);
  if (Array.isArray(offset)) pp.p = pp.p.map((v, k) => v + (offset[k] ?? 0));
  return { p: pp.p, axis: pp.axis, label: part };
}

const _axStep = (p, axis, dist) => { if (!axis) return [...p]; const q = [...p]; q[AX_IDX[axis[0]]] += (axis[1] === '-' ? -1 : 1) * dist; return q; };

// 마주보는(동일 축) 포트 전용 — 축 중간분할 조그: A→(공유축 중간)→타 축 이동→B.
// 스텁 리드(L)가 서로를 지나치는 좁은 간격(간격<2L)에서 백트랙·초단 세그먼트 없이
// 시공 가능한 정공법 경로(260717 예시 배터리 mech-skid 가 검출한 라우팅 공백).
function _midJogPaths(A, B, k) {
  const others = [0, 1, 2].filter((i) => i !== k);
  const mid = (A[k] + B[k]) / 2;
  const paths = [];
  for (const ord of [[others[0], others[1]], [others[1], others[0]]]) {
    const pts = [[...A]];
    let cur = [...A];
    if (Math.abs(mid - cur[k]) > 1e-6) { cur = [...cur]; cur[k] = mid; pts.push([...cur]); }
    for (const i of ord) if (Math.abs(cur[i] - B[i]) > 1e-6) { cur = [...cur]; cur[i] = B[i]; pts.push([...cur]); }
    if (Math.abs(cur[k] - B[k]) > 1e-6) { cur = [...cur]; cur[k] = B[k]; pts.push([...cur]); }
    if (pts.length > 1) paths.push(pts);
  }
  return paths;
}

// S→E 후보 경로 생성 — 스텁 축방향 진입/이탈 리드(L) 강제 + 축순서 순열 + 오버헤드 코리도(높이×수평순서)
function _candidatePaths(S, E, sAx, eAx, corridorZs, L) {
  const out = [];
  const S1 = sAx ? _axStep(S, sAx, L) : S;
  const E1 = eAx ? _axStep(E, eAx, L) : E;
  const head = sAx ? [S, S1] : [S];
  const tail = eAx ? [E] : [];
  const manhattan = (from, to, order) => {
    const pts = [];
    let cur = [...from];
    for (const c of order) { const k = AX_IDX[c]; if (Math.abs(cur[k] - to[k]) > 1e-6) { cur = [...cur]; cur[k] = to[k]; pts.push([...cur]); } }
    return pts;
  };
  for (const o of ['xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx']) out.push([...head, ...manhattan(S1, E1, o), ...tail]);
  // 오버헤드 코리도: 리드 후 상승(기본) + 스텁 팁 직상승(리드 공간이 막힌 밀집 배치 폴백)
  for (const zc of corridorZs) for (const xy of ['xy', 'yx']) for (const useLead of [true, false]) {
    const start = useLead && sAx ? S1 : S;
    const pts = useLead ? [...head] : [S];
    let cur = [...start];
    if (Math.abs(cur[2] - zc) > 1e-6) { cur = [...cur]; cur[2] = zc; pts.push([...cur]); }
    pts.push(...manhattan(cur, [E1[0], E1[1], zc], xy));
    cur = pts[pts.length - 1];
    if (Math.abs(cur[2] - E1[2]) > 1e-6) { cur = [...cur]; cur[2] = E1[2]; pts.push([...cur]); }
    pts.push(...tail);
    out.push(pts);
  }
  return out;
}

/**
 * 배관 자동 라우터(#6, 위시빌더 skid 수동 코리도/레인 배치의 제품화) — 어셈블리 pipes[] 를
 * 결정론적으로 라우팅한다. 후보 경로(직결 순열 + 오버헤드 코리도 3높이×2순서)를 순서대로
 * 게이트(정규화→routeGate)·장비 관통(pipeObstacleCheck)·기라우팅 배관 교차(pipeCrossCheck)로
 * 검사해 첫 합격 경로를 채택 — 전 경로 불합격이면 정직하게 errors 보고(강행 렌더 없음).
 *
 * @param pipes [{ id, from, to, d?, service?, col?, stub?: boolean }]
 *   from/to = 'partLabel.face'('x±|y±|z±') | { part, face, offset:[dx,dy,dz] } | [x,y,z]
 * @param items 장애물 목록 [{ label, min, max, round?, passable? }] — obstaclesFromAssembly 산출.
 *   passable=true(벽·슬래브·바닥 등 건축 부재)는 관통 가능 — 후보 판정에서 제외(슬리브로 통과),
 *   호출측이 pipeObstacleCheck 결과에서 슬리브 명세로 분리한다(위반 아님·명세 산출, 정직).
 * @returns { routes, features, errors, notes }
 */
export function autoRoutePipes(pipes, items, { clearance = 80, stubLen = 40 } = {}) {
  const byLabel = new Map(items.map((i) => [i.label, i]));
  const passable = new Set(items.filter((i) => i.passable).map((i) => i.label));
  const zTop = items.length ? Math.max(...items.map((i) => i.max[2])) : 0;
  const routes = [], features = [], errors = [], notes = [];
  for (const [pi, pipe] of (pipes ?? []).entries()) {
    const id = pipe.id ?? `pipe${pi + 1}`;
    const d = pipe.d ?? 26;
    const from = _resolveEnd(pipe.from, byLabel);
    const to = _resolveEnd(pipe.to, byLabel);
    if (from.error || to.error) { errors.push(`${id}: ${from.error ?? to.error}`); continue; }
    const col = pipe.col;
    const wantStub = pipe.stub !== false;
    // 장비 접속이면 노즐 스텁 + 스텁 끝(팁)에서 라우팅 시작
    const S = from.axis && wantStub ? _axStep(from.p, from.axis, stubLen) : from.p;
    const E = to.axis && wantStub ? _axStep(to.p, to.axis, stubLen) : to.p;
    const L = Math.max(20, d / 2 + RETREAT_PAD + 5);
    const corridorZs = [zTop + clearance, zTop + clearance + 2 * (d + 10), zTop + clearance + 4 * (d + 10)];
    const cands = _candidatePaths(S, E, from.axis, to.axis, corridorZs, L).map((pts) => ({ pts, noStub: false }));
    // 마주보는(동일 축) 포트: 스텁 팁 리드가 서로를 지나치는 배치 폴백 —
    // 면(face)에서 직접 중간분할 조그(경로가 면까지 닿으므로 별도 스텁 생략)
    if (from.axis && to.axis && AX_IDX[from.axis[0]] === AX_IDX[to.axis[0]]) {
      cands.push(..._midJogPaths(from.p, to.p, AX_IDX[from.axis[0]]).map((pts) => ({ pts, noStub: true })));
    }
    let chosen = null, chosenNoStub = false;
    const reasons = [];
    /**
     * ⚠ 260801 — **중력 배수관은 올라갈 수 없다.**
     *
     * 종전에는 게이트를 통과한 **첫 후보**를 그대로 골랐다. 그래서 `drain` 배관이
     * 천장 코리도(z=2,780mm)로 올라갔다 내려오는 경로를 받았다 — 실측:
     * `cafe_room/drain_toilet` 이 210 → 2,780 → 210 으로 라우팅됐다.
     * 구배 검사는 그것을 「상승 구간이 있어 중력 배수로 판정할 수 없다」로 정직하게
     * 거부했지만, **거부의 원인이 라우터였다.** 검사를 고칠 일이 아니라 경로를 고칠 일이다.
     *
     * `service:'drain'` 이면 **하강 단조 후보를 먼저** 고른다. 그런 후보가 없으면
     * 종전 동작으로 돌아가되 **그 사실을 note 로 남긴다** — 조용히 상승 경로를 주면
     * 왜 판정이 안 되는지 사용자가 알 수 없다.
     */
    const RISE_EPS = 1e-6;
    const risesUp = (pts) => {
      for (let i = 1; i < pts.length; i++) if (pts[i][2] - pts[i - 1][2] > RISE_EPS) return true;
      return false;
    };
    const isDrain = String(pipe.service ?? '') === 'drain';
    const tryPick = (requireDescend) => {
      for (const cand of cands) {
        const n = normalizeRoute(cand.pts, { startAxis: from.axis, endAxis: to.axis });
        if (requireDescend && risesUp(n.pts)) { reasons.push('중력 배수 상승 구간'); continue; }
        const ge = routeGate(n.pts, { d });
        if (ge.length) { reasons.push(ge[0]); continue; }
        const rt = { label: id, pts: n.pts, d, allow: pipe.allow };
        if (pipeObstacleCheck([rt], items).some((v) => !passable.has(v.obstacle))) { reasons.push('장비 관통'); continue; }
        if (pipeCrossCheck([...routes, rt]).some((v) => v.a === id || v.b === id)) { reasons.push('기라우팅 배관 교차'); continue; }
        return { pts: n.pts, noStub: cand.noStub };
      }
      return null;
    };
    let pick = isDrain ? tryPick(true) : null;
    if (pick) { chosen = pick.pts; chosenNoStub = pick.noStub; }
    else {
      if (isDrain) notes.push(`${id}: 하강 단조 경로가 없어 상승 구간을 포함한 경로를 택했다 — `
        + '**중력 배수로는 성립하지 않는다**(펌프 배수이거나 기구·입상관 위치 재검토 대상). 구배 검사가 판정을 보류한다.');
      pick = tryPick(false);
      if (pick) { chosen = pick.pts; chosenNoStub = pick.noStub; }
    }
    if (!chosen) { errors.push(`${id}: 자동 라우팅 실패(후보 ${cands.length} 전부 불합격 — ${[...new Set(reasons)].slice(0, 3).join(' · ')})`); continue; }
    routes.push({ label: id, pts: chosen, d, service: pipe.service, col });
    if (from.axis && wantStub && !chosenNoStub) features.push(...stubFeatures(from.p, from.axis, d, { col }));
    if (to.axis && wantStub && !chosenNoStub) features.push(...stubFeatures(to.p, to.axis, d, { col }));
    const rf = routeFeatures(chosen, { d, col, normalize: false });
    if (rf.errors.length) { errors.push(`${id}: 피처 생성 실패 — ${rf.errors[0]}`); continue; }
    features.push(...rf.features);
    if (chosen.length > 2) notes.push(`${id}: ${chosen.length - 1}세그먼트(엘보 ${chosen.length - 2})`);
  }
  return { routes, features, errors, notes };
}
