/**
 * alignment-geom.mjs — 선형(chainage) 단일 모듈 (linear-drawing-plan §0.3·§1-1).
 *
 * 요소열(직선|원호) 모델. 평면·종단·시트·구조물 배치·물량·DXF 는 전부 이 모듈만
 * 사용한다(재구현 금지) — 곡선이 들어와도 모든 소비자가 자동 정합.
 *
 * 원곡선(단곡선): IP 별 R 선택 입력. 폐형 —
 *   Δ = 정규화(brg₂−brg₁, (−180°,180°]) · TL = R·tan(|Δ|/2) · L = R·|Δ|(rad)
 * 사전 게이트(§1-1): |Δ|≤90° · TL 합+MIN_TANGENT ≤ IP 간 거리 · R ≥ 최소반경(호출측 전달).
 * 완화곡선(클로소이드)=명시 보류.
 */
import { EPS, minTangent, SAG_TOL_DEFAULT, CHORDS_PER_ARC_MAX } from './geometry-tolerance.mjs';

const norm180 = (d) => { let a = d % 360; if (a > 180) a -= 360; if (a <= -180) a += 360; return a; };
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

/**
 * IP 폴리라인(+선택 곡선) → 요소열.
 * @param ips [[x,y],...] mm
 * @param curves [{ip: <내부 IP 인덱스 1..n-2>, R}] — 지정 IP 에만 원곡선
 * @param opts { minR } — 최소 반경(내측 옵셋 자기교차 방지, 호출측=2·baseW 등)
 * @returns { ok, errors, elements, totalMm, curveTable }
 *   line: { type:'line', p0, p1, len, brgDeg, ch0 }
 *   arc:  { type:'arc', c, R, a0, a1, ccw, len, ch0, ip, deltaDeg, TL, BCmm, ECmm }
 */
export function buildElements(ips, curves = [], opts = {}) {
  const errors = [];
  if (!Array.isArray(ips) || ips.length < 2) return { ok: false, errors: ['ips: IP 2점 이상 필요'], elements: [], totalMm: 0, curveTable: [] };
  for (const [i, q] of ips.entries()) {
    if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) errors.push(`ips[${i}]: 좌표 invalid`);
  }
  if (errors.length) return { ok: false, errors, elements: [], totalMm: 0, curveTable: [] };
  // Δ=0(일직선) IP 는 자동 제거 — 곡선 지정이 있으면 오류(불능 지정)
  const P = [ips[0]];
  for (let i = 1; i < ips.length - 1; i++) {
    const b1 = Math.atan2(ips[i][1] - ips[i - 1][1], ips[i][0] - ips[i - 1][0]);
    const b2 = Math.atan2(ips[i + 1][1] - ips[i][1], ips[i + 1][0] - ips[i][0]);
    if (Math.abs(norm180(deg(b2 - b1))) < 1e-9) {
      if (curves.some((c) => c.ip === i)) errors.push(`curves[ip=${i}]: 교각 0° IP 에 곡선 지정 불가`);
      continue;
    }
    P.push(ips[i]);
  }
  P.push(ips[ips.length - 1]);
  const Rof = new Map();
  for (const c of curves ?? []) {
    if (!(Number(c.R) > 0)) { errors.push(`curves[ip=${c.ip}]: R invalid`); continue; }
    // 원본 ips 인덱스로 지정 → 제거되지 않은 IP 좌표로 매칭
    const idx = P.findIndex((q) => q === ips[c.ip]);
    if (idx <= 0 || idx >= P.length - 1) { if (!errors.some((e) => e.includes(`ip=${c.ip}`))) errors.push(`curves[ip=${c.ip}]: 내부 IP 아님`); continue; }
    Rof.set(idx, Number(c.R));
  }
  // IP별 Δ·TL 산출 + 게이트
  const legLen = (i) => Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
  const brg = (i) => Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]); // rad, leg i
  const TL = new Map(), DELTA = new Map();
  for (const [idx, R] of Rof) {
    const d = norm180(deg(brg(idx) - brg(idx - 1)));
    if (Math.abs(d) > 90 + EPS) errors.push(`IP${idx}: 교각 ${Math.abs(d).toFixed(1)}° > 90° — 선형 재설계 필요(정직 거부)`);
    if (opts.minR > 0 && R < opts.minR) errors.push(`IP${idx}: R ${R} < 최소 반경 ${opts.minR}(내측 자기교차 방지)`);
    DELTA.set(idx, d);
    TL.set(idx, R * Math.tan(rad(Math.abs(d)) / 2));
  }
  const mt = minTangent(opts.baseW);
  for (let i = 0; i < P.length - 1; i++) {
    const need = (TL.get(i) ?? 0) + (TL.get(i + 1) ?? 0) + ((TL.has(i) || TL.has(i + 1)) ? mt : 0);
    if (need > legLen(i) + EPS) errors.push(`IP${i}~IP${i + 1} 구간 ${Math.round(legLen(i))}mm < 접선장 합+여유 ${Math.round(need)}mm — R 축소 또는 IP 이동 필요`);
  }
  if (errors.length) return { ok: false, errors, elements: [], totalMm: 0, curveTable: [] };
  // 요소열 구성
  const elements = [];
  const curveTable = [];
  let ch = 0;
  let cursor = P[0];
  for (let i = 0; i < P.length - 1; i++) {
    const hasCurve = TL.has(i + 1); // leg 끝 IP(i+1)에 곡선
    const b = brg(i);
    const endT = hasCurve ? TL.get(i + 1) : 0;
    const L = legLen(i);
    // 직선부: cursor → (IP_{i+1} − endT 방향 후퇴)
    const ex = P[i + 1][0] - Math.cos(b) * endT, ey = P[i + 1][1] - Math.sin(b) * endT;
    const lineLen = Math.hypot(ex - cursor[0], ey - cursor[1]);
    if (lineLen > EPS) {
      elements.push({ type: 'line', p0: cursor, p1: [ex, ey], len: lineLen, brgDeg: deg(b), ch0: ch });
      ch += lineLen;
    }
    cursor = [ex, ey];
    if (hasCurve) {
      const R = Rof.get(i + 1);
      const d = DELTA.get(i + 1);
      const ccw = d > 0;
      // 곡선 중심: BC 에서 진행방향 좌(ccw)/우(cw) 법선으로 R
      const nx = ccw ? -Math.sin(b) : Math.sin(b);
      const ny = ccw ? Math.cos(b) : -Math.cos(b);
      const c = [cursor[0] + nx * R, cursor[1] + ny * R];
      const a0 = Math.atan2(cursor[1] - c[1], cursor[0] - c[0]);
      const arcLen = R * rad(Math.abs(d));
      const a1 = a0 + (ccw ? 1 : -1) * rad(Math.abs(d));
      const el = { type: 'arc', c, R, a0, a1, ccw, len: arcLen, ch0: ch, ip: i + 1, deltaDeg: d, TL: TL.get(i + 1), BCmm: ch, ECmm: ch + arcLen };
      elements.push(el);
      curveTable.push({ ip: i + 1, ipXY: [P[i + 1][0], P[i + 1][1]], deltaDeg: d, R, TLmm: TL.get(i + 1), Lmm: arcLen, BCmm: ch, ECmm: ch + arcLen });
      ch += arcLen;
      cursor = [c[0] + R * Math.cos(a1), c[1] + R * Math.sin(a1)]; // EC
    }
  }
  return { ok: true, errors: [], elements, totalMm: ch, curveTable };
}

/** 체이니지 s → { p:[x,y], dir:[ux,uy] } (요소열 기반 — 유일한 보간 함수). */
export function chainAt(elements, sMm) {
  if (!elements?.length) return { p: [0, 0], dir: [1, 0] };
  const total = elements[elements.length - 1].ch0 + elements[elements.length - 1].len;
  const s = Math.max(0, Math.min(total, sMm));
  const el = elements.find((e) => s <= e.ch0 + e.len + EPS) ?? elements[elements.length - 1];
  const t = s - el.ch0;
  if (el.type === 'line') {
    const ux = (el.p1[0] - el.p0[0]) / el.len, uy = (el.p1[1] - el.p0[1]) / el.len;
    return { p: [el.p0[0] + ux * t, el.p0[1] + uy * t], dir: [ux, uy] };
  }
  const a = el.a0 + (el.ccw ? 1 : -1) * (t / el.R);
  return {
    p: [el.c[0] + el.R * Math.cos(a), el.c[1] + el.R * Math.sin(a)],
    dir: el.ccw ? [-Math.sin(a), Math.cos(a)] : [Math.sin(a), -Math.cos(a)],
  };
}

/** 순수 폴리라인 편의(기존 chainPoint 호환) — 내부적으로 요소열 경유(단일 소스). */
export function chainPoint(ips, sMm) {
  const { elements } = buildElements(ips, []);
  const r = chainAt(elements, sMm);
  return { p: r.p, dir: r.dir };
}

/**
 * 선분 [a,b] × 선형 요소열 교차 — [{ sMm, x, y }] (chainage 순 정렬).
 * 폐형: 선분-선분 / 선분-원호(원·선분, 판별식 |D|<EPS=접점 1). 외삽 없음(§1-3).
 */
export function intersectSegment(elements, A, B) {
  const out = [];
  const dx = B[0] - A[0], dy = B[1] - A[1];
  for (const el of elements) {
    if (el.type === 'line') {
      const ex = el.p1[0] - el.p0[0], ey = el.p1[1] - el.p0[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue; // 평행(공선 겹침은 교차점 불특정 — 미산출 정직)
      const t = ((el.p0[0] - A[0]) * ey - (el.p0[1] - A[1]) * ex) / den;   // A→B 파라미터
      const u = ((el.p0[0] - A[0]) * dy - (el.p0[1] - A[1]) * dx) / den;   // 요소 파라미터
      if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
      out.push({ sMm: el.ch0 + u * el.len, x: A[0] + t * dx, y: A[1] + t * dy });
    } else {
      // 원(c,R) × 선분: |A + t·d − c|² = R²
      const fx = A[0] - el.c[0], fy = A[1] - el.c[1];
      const a = dx * dx + dy * dy;
      const b = 2 * (fx * dx + fy * dy);
      const cc = fx * fx + fy * fy - el.R * el.R;
      let D = b * b - 4 * a * cc;
      if (D < -EPS) continue;
      D = Math.max(0, D);
      const ts = D < EPS ? [-b / (2 * a)] : [(-b - Math.sqrt(D)) / (2 * a), (-b + Math.sqrt(D)) / (2 * a)];
      for (const t of ts) {
        if (t < -EPS || t > 1 + EPS) continue;
        const x = A[0] + t * dx, y = A[1] + t * dy;
        let ang = Math.atan2(y - el.c[1], x - el.c[0]);
        // 호 각도 범위 판정(ccw 방향 정규화)
        const sweep = el.a1 - el.a0;
        let rel = ang - el.a0;
        const TAU = 2 * Math.PI;
        rel = ((rel % TAU) + TAU) % TAU;
        const sw = ((sweep % TAU) + TAU) % TAU || (Math.abs(sweep) > EPS ? TAU : 0);
        const on = el.ccw ? rel <= sw + 1e-9 : (TAU - rel) % TAU <= ((TAU - sw) % TAU || sw) + 1e-9;
        // cw 판정 단순화: cw 호는 a0→a1 감소 — rel' = a0−ang 정규화
        let inArc;
        if (el.ccw) inArc = rel <= sw + 1e-9;
        else { let rel2 = el.a0 - ang; rel2 = ((rel2 % TAU) + TAU) % TAU; inArc = rel2 <= ((el.a0 - el.a1) % TAU + TAU) % TAU + 1e-9; }
        void on;
        if (!inArc) continue;
        const along = el.ccw ? rel * el.R : (((el.a0 - ang) % TAU + TAU) % TAU) * el.R;
        out.push({ sMm: el.ch0 + along, x, y });
      }
    }
  }
  return out.sort((p, q) => p.sMm - q.sMm);
}

/** 폴리라인 × 선형 교차(등고선용) — intersectSegment 합산. */
export function intersectPolyline(elements, pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(...intersectSegment(elements, pts[i], pts[i + 1]));
  return out.sort((p, q) => p.sMm - q.sMm);
}

/**
 * §1-3 등고→지반선 결정론 파생 — 교차점만 보간(외삽 금지), 데이터 모순=거부(평균 금지).
 * @param contours [{elevM, pts:[[x,y],...]}]
 * @returns { ground: [{staMm, elevMm}]|null, errors, note }
 */
export function groundFromContours(elements, contours) {
  const pts = [];
  for (const ct of contours ?? []) {
    if (!Array.isArray(ct.pts) || ct.pts.length < 2 || !Number.isFinite(Number(ct.elevM))) continue;
    for (const hit of intersectPolyline(elements, ct.pts)) pts.push({ staMm: hit.sMm, elevMm: Number(ct.elevM) * 1000 });
  }
  pts.sort((a, b) => a.staMm - b.staMm);
  const errors = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].staMm - pts[i - 1].staMm <= 500 && Math.abs(pts[i].elevMm - pts[i - 1].elevMm) > 1) {
      errors.push(`등고 데이터 모순: STA ${(pts[i].staMm / 1000).toFixed(1)}m 부근 표고 ${(pts[i - 1].elevMm / 1000).toFixed(2)} vs ${(pts[i].elevMm / 1000).toFixed(2)} m — 평균하지 않음(정직 거부)`);
    }
  }
  if (errors.length) return { ground: null, errors, note: null };
  if (pts.length < 2) return { ground: null, errors: [], note: '등고×선형 교차점 < 2 — 지반선 미생성(등고가 선형을 충분히 덮지 않음)' };
  const ground = [];
  for (const q of pts) { const l = ground[ground.length - 1]; if (l && q.staMm - l.staMm <= 500) continue; ground.push({ staMm: q.staMm, elevMm: q.elevMm }); }
  return {
    ground, errors: [],
    note: `지반선=등고 교차 ${ground.length}점 선형보간 파생(측량 성과 아님) · 유효구간 STA ${(ground[0].staMm / 1000).toFixed(0)}~${(ground[ground.length - 1].staMm / 1000).toFixed(0)}m 밖 외삽 없음`,
  };
}

/**
 * 요소열 → 현(chord) 폴리라인 (§1-1 3D 형상용). 새그 공차 기반 분할각
 * θc = 2·acos(1−SAG/R), 세그먼트당 상한 CHORDS_PER_ARC_MAX(초과 시 SAG 상향+정직 고지).
 * @returns { pts:[[x,y]...], notes:[] } — pts 는 요소 경계·호 분할점 포함(연속 폴리라인)
 */
export function chordPolyline(elements, { sagTol = SAG_TOL_DEFAULT } = {}) {
  const pts = [];
  const notes = [];
  const push = (p) => { const l = pts[pts.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > EPS) pts.push([p[0], p[1]]); };
  for (const el of elements) {
    if (el.type === 'line') { push(el.p0); push(el.p1); continue; }
    let thetaC = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - sagTol / el.R)));
    let n = Math.ceil(Math.abs(el.a1 - el.a0) / thetaC);
    if (n > CHORDS_PER_ARC_MAX) {
      n = CHORDS_PER_ARC_MAX;
      const sagUsed = el.R * (1 - Math.cos(Math.abs(el.a1 - el.a0) / n / 2));
      notes.push(`IP${el.ip}: 현 분할 상한 ${CHORDS_PER_ARC_MAX} — 새그 공차 ${Math.round(sagUsed)}mm 로 상향(성능 예산 §A)`);
    }
    for (let k = 0; k <= n; k++) {
      const a = el.a0 + ((el.a1 - el.a0) * k) / n;
      push([el.c[0] + el.R * Math.cos(a), el.c[1] + el.R * Math.sin(a)]);
    }
  }
  return { pts, notes };
}

/**
 * 체이니지 윈도 [s0,s1] 로 요소열 클리핑(§③ 시트 분할) — 부분 호는 각도 범위로 정확 절단.
 * @returns 서브 요소열(ch0 는 원 체이니지 유지)
 */
export function clipElements(elements, s0, s1) {
  const out = [];
  for (const el of elements) {
    const e0 = el.ch0, e1 = el.ch0 + el.len;
    if (e1 <= s0 + EPS || e0 >= s1 - EPS) continue;
    const t0 = Math.max(0, s0 - e0), t1 = Math.min(el.len, s1 - e0);
    if (el.type === 'line') {
      const ux = (el.p1[0] - el.p0[0]) / el.len, uy = (el.p1[1] - el.p0[1]) / el.len;
      out.push({ ...el, p0: [el.p0[0] + ux * t0, el.p0[1] + uy * t0], p1: [el.p0[0] + ux * t1, el.p0[1] + uy * t1], len: t1 - t0, ch0: e0 + t0 });
    } else {
      const sgn = el.ccw ? 1 : -1;
      out.push({ ...el, a0: el.a0 + sgn * (t0 / el.R), a1: el.a0 + sgn * (t1 / el.R), len: t1 - t0, ch0: e0 + t0 });
    }
  }
  return out;
}
