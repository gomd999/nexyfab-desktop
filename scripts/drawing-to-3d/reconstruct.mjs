/**
 * 2D→3D — 결정론 재구성 (어휘 14종): intent JSON → OpenSCAD + 해석적 재투영.
 * AI 산출물은 기하 게이트 통과 후에만 형상화 — "LLM=이해, 결정론=형상·검증".
 *
 * 어휘확장 #3 (2026-07-14): spur_gear(인벌류트 스퍼기어) · hex_bolt(육각볼트, ISO 4017
 * 머리치수 표) · sheet_profile(다단 절곡 판금 — 세그먼트+각도 열로 Z/햇/채널 임의 단면).
 * 프로파일 생성기(gearPoly/hexPts/sheetPoly)는 export — assembly(STEP)·BOQ·프리셋 공용.
 */
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const RAD = Math.PI / 180;

// ─── T1 구멍류 제조 피처(260719): 미터 보통나사 암나사 하경(KS B 0201/ISO 724 6H 근사) ──
// 탭홀 형상 = 하경 드릴 구멍(나사산 자체는 SCAD/STEP 미표현 — 구멍표·주기로 전달, 정직 명시)
export const TAP_MINOR = { 3: 2.459, 4: 3.242, 5: 4.134, 6: 4.917, 8: 6.647, 10: 8.376, 12: 10.106, 14: 11.835, 16: 13.835, 20: 17.294, 24: 20.752 };
/** 'M8' → { m:8, minor:6.647 } | null(비표준 — 정직 거부용) */
export function parseThread(s) {
  const m = /^M(\d+(?:\.\d+)?)$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const nom = Number(m[1]);
  return TAP_MINOR[nom] ? { m: nom, minor: TAP_MINOR[nom] } : null;
}
/**
 * 구멍 1개의 결정론 파생값(단일 소스 — 게이트·SCAD·STEP·체적·구멍표 공용).
 * kind: 'through'(기본)|'cbore'|'csink'|'tap'. 상면(z=thickness) 기준 가공(관례 명시).
 * @returns { kind, drillD(주 구멍 지름), depth(주 구멍 깊이|null=관통), cb?, cs?, thread?, label }
 */
export function holeFeature(h, thickness) {
  const kind = ['cbore', 'csink', 'tap'].includes(h.kind) ? h.kind : 'through';
  const out = { kind, drillD: h.d, depth: pos(h.depth) ? h.depth : null };
  if (kind === 'tap') {
    const th = parseThread(h.thread);
    if (th) { out.thread = th; out.drillD = th.minor; }
  } else if (kind === 'cbore') {
    out.cb = { dia: h.cbDia, depth: h.cbDepth };
  } else if (kind === 'csink') {
    const ang = pos(h.csAngleDeg) ? h.csAngleDeg : 90;
    out.cs = { dia: h.csDia, angleDeg: ang, depth: (h.csDia - h.d) / 2 / Math.tan((ang / 2) * RAD) };
  }
  const dEff = out.depth ?? thickness;
  out.label = kind === 'tap' && out.thread
    ? `M${out.thread.m}${out.depth ? `×${out.depth}` : ' 관통'}`
    : kind === 'cbore' ? `⌀${h.d} ⌴⌀${h.cbDia}×${h.cbDepth}`
      : kind === 'csink' ? `⌀${h.d} ⌵⌀${h.csDia}×${(h.csAngleDeg ?? 90)}°`
        : `⌀${h.d}${out.depth ? `×${out.depth}` : ' THRU'}`;
  out.depthEff = dEff;
  return out;
}

// ─── 공유 프로파일 생성기 (결정론 — SCAD·STEP·물량이 같은 폴리곤을 쓴다) ────────

/** 인벌류트 스퍼기어 외형 폴리곤 (CCW, 원점 중심). 표준 치형: ha=m, hf=1.25m. */
export function gearPoly({ module: m, teeth: z, pressureAngleDeg = 20 }) {
  const a = pressureAngleDeg * RAD;
  const rp = (m * z) / 2, rb = rp * Math.cos(a), ra = rp + m, rf = Math.max(rp - 1.25 * m, m * 0.2);
  const inv = (x) => Math.tan(x) - x;
  const beta = Math.PI / (2 * z) + inv(a); // rb에서의 플랭크 반각
  const psi = (r) => { const x = Math.acos(Math.min(1, rb / r)); return Math.tan(x) - x; };
  const r0 = Math.max(rb, rf);
  const N = 6;
  const flank = []; // [r, 중심으로부터의 각오프셋] — r 오름차순
  for (let k = 0; k <= N; k++) {
    const r = r0 + (ra - r0) * (k / N);
    flank.push([r, beta - psi(r)]);
  }
  const half = Math.PI / z;
  const pts = [];
  for (let j = 0; j < z; j++) {
    const A = ((2 * Math.PI) / z) * j;
    const P = (r, o) => pts.push([r * Math.cos(A + o), r * Math.sin(A + o)]);
    P(rf, -half);                                     // 스페이스 중앙(루트)
    if (rf < rb - 1e-9) P(rf, -beta);                 // 루트→플랭크 기저(radial)
    for (const [r, o] of flank) P(r, -o);             // 우측 플랭크 상승
    for (let k = flank.length - 1; k >= 0; k--) P(flank[k][0], flank[k][1]); // 팁 → 좌측 하강
    if (rf < rb - 1e-9) P(rf, beta);
  }
  return pts;
}

/** 정육각형 꼭짓점 6점 (across-flats 기준, 꼭짓점이 +X축). */
export function hexPts(acrossFlats) {
  const R = acrossFlats / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return [R * Math.cos(a), R * Math.sin(a)];
  });
}

/** ISO 4017/4014 육각볼트 표준 치수 (호칭경 → across-flats·머리높이·피치). */
export const BOLT_TABLE = {
  3: { af: 5.5, h: 2, p: 0.5 }, 4: { af: 7, h: 2.8, p: 0.7 }, 5: { af: 8, h: 3.5, p: 0.8 },
  6: { af: 10, h: 4, p: 1 }, 8: { af: 13, h: 5.3, p: 1.25 }, 10: { af: 16, h: 6.4, p: 1.5 },
  12: { af: 18, h: 7.5, p: 1.75 }, 16: { af: 24, h: 10, p: 2 }, 20: { af: 30, h: 12.5, p: 2.5 },
  24: { af: 36, h: 15, p: 3 }, 30: { af: 46, h: 18.7, p: 3.5 }, 36: { af: 55, h: 22.5, p: 4 },
};
/** 볼트 머리 치수 해석: 명시값 우선, 없으면 표준표. 없으면 null 필드. */
export function boltDims(i) {
  const std = BOLT_TABLE[i.threadDia];
  return { af: i.headFlats ?? std?.af ?? null, hh: i.headHeight ?? std?.h ?? null, pitch: i.pitch ?? std?.p ?? null };
}

/**
 * 다단 절곡 판금 단면 폴리곤 — 세그먼트 길이열 + 절곡각열(중심선)을 두께 t로
 * 마이터 오프셋(±t/2)해 닫힌 단면을 만든다. Z형·햇채널·복잡 브래킷 단면 임의 표현.
 * ⚠️ 치수는 중심선 기준(전개장과 일치) — 외형치수 필요 시 t/2 보정은 호출측.
 */
export function sheetPoly({ thickness: t, segments, angles = [] }) {
  const pts = [[0, 0]];
  const dirs = [];
  let ang = 0;
  for (let k = 0; k < segments.length; k++) {
    if (k) ang += (angles[k - 1] ?? 0) * RAD;
    dirs.push(ang);
    const p = pts[pts.length - 1];
    pts.push([p[0] + segments[k] * Math.cos(ang), p[1] + segments[k] * Math.sin(ang)]);
  }
  const left = [], right = [];
  for (let k = 0; k < pts.length; k++) {
    const dPrev = dirs[Math.max(0, k - 1)], dNext = dirs[Math.min(dirs.length - 1, k)];
    const bis = Math.atan2((Math.sin(dPrev) + Math.sin(dNext)) / 2, (Math.cos(dPrev) + Math.cos(dNext)) / 2);
    const halfTurn = (dNext - dPrev) / 2;
    const miter = (t / 2) / Math.max(0.35, Math.cos(halfTurn)); // 게이트가 |각|≤120° 보장(cos≥0.5)
    const nx = -Math.sin(bis), ny = Math.cos(bis);
    left.push([pts[k][0] + nx * miter, pts[k][1] + ny * miter]);
    right.push([pts[k][0] - nx * miter, pts[k][1] - ny * miter]);
  }
  return left.concat(right.reverse());
}

/** 폴리곤 면적(shoelace, 절대값) / 둘레. */
export function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
export function polyPerimeter(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
}
function polyBbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
// 단순(자기교차 없는) 폴리곤 검사 — compose.mjs 게이트와 동일 사상(로컬 사본, 순환의존 회피).
function segInt(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  const e = 1e-9; return t > e && t < 1 - e && u > e && u < 1 - e;
}
function polySimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
    if (segInt(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
  }
  return true;
}
const r4 = (n) => { const r = Math.round(n * 10000) / 10000; return Object.is(r, -0) ? 0 : r; };
const polyScad = (pts) => `polygon(points=[${pts.map((p) => `[${r4(p[0])},${r4(p[1])}]`).join(',')}]);`;

/** C2(260719b) 코일 스프링 헬릭스 폴리라인 — SCAD 세그먼트 근사 공유 소스(STEP=B-rep 스윕).
 *  중심선 반경=(coilDia−wireDia)/2, z 시작=wireDia/2(하단 접지 접선). 턴당 ≤24분할(총 ≤960). */
export function coilPoints(i) {
  const R = (i.coilDia - i.wireDia) / 2;
  const spt = Math.max(8, Math.min(24, Math.floor(960 / Math.max(1, i.turns))));
  const n = Math.max(6, Math.round(i.turns * spt));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * i.turns;
    const th = 2 * Math.PI * t;
    pts.push([R * Math.cos(th), R * Math.sin(th), i.wireDia / 2 + i.pitch * t]);
  }
  return pts;
}

const GATES = {
  plate_with_holes(i, e) {
    for (const k of ['width', 'depth', 'thickness']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
    if (i.thickness >= Math.min(i.width, i.depth)) e.push('thickness ≥ min(w,d) — 판재 아님');
    for (const [n, h] of (i.holes ?? []).entries()) {
      if (!pos(h.d) || h.d >= Math.min(i.width, i.depth)) e.push(`hole[${n}] d invalid`);
      if (!(h.x - h.d / 2 >= 0 && h.x + h.d / 2 <= i.width)) e.push(`hole[${n}] x outside`);
      if (!(h.y - h.d / 2 >= 0 && h.y + h.d / 2 <= i.depth)) e.push(`hole[${n}] y outside`);
      // T1 제조 피처 게이트(260719): cbore/csink/tap/blind — 상면 기준(관례 명시)
      if (h.kind === 'cbore') {
        if (!pos(h.cbDia) || h.cbDia <= h.d) e.push(`hole[${n}] cbDia ≤ d`);
        if (!pos(h.cbDepth) || h.cbDepth >= i.thickness) e.push(`hole[${n}] cbDepth ≥ thickness`);
      } else if (h.kind === 'csink') {
        if (!pos(h.csDia) || h.csDia <= h.d) e.push(`hole[${n}] csDia ≤ d`);
        else {
          const f = holeFeature(h, i.thickness);
          if (f.cs.depth >= i.thickness) e.push(`hole[${n}] 싱크 깊이 ≥ thickness`);
        }
        if (h.csAngleDeg != null && !(h.csAngleDeg >= 60 && h.csAngleDeg <= 120)) e.push(`hole[${n}] csAngleDeg 60~120`);
      } else if (h.kind === 'tap') {
        if (!parseThread(h.thread)) e.push(`hole[${n}] thread 비표준(M3~M24 보통나사만 — 목록 외=정직 거부)`);
      } else if (h.kind != null && h.kind !== 'through') {
        e.push(`hole[${n}] kind '${h.kind}' 미지원(through/cbore/csink/tap)`);
      }
      if (h.depth != null && (!pos(h.depth) || h.depth >= i.thickness) && h.kind !== 'tap') e.push(`hole[${n}] 블라인드 depth ≥ thickness`);
      if (h.kind === 'tap' && h.depth != null && (!pos(h.depth) || h.depth > i.thickness)) e.push(`hole[${n}] 탭 depth > thickness`);
    }
  },
  stepped_plate(i, e) {
    for (const k of ['width', 'depth', 'thickness', 'stepWidth', 'stepThickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.stepWidth >= i.width) e.push('stepWidth ≥ width');
    if (i.stepThickness >= i.thickness) e.push('stepThickness ≥ thickness');
  },
  l_bracket(i, e) {
    for (const k of ['legA', 'legB', 'width', 'thickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.thickness >= Math.min(i.legA, i.legB)) e.push('thickness ≥ min(legA,legB)');
  },
  flange(i, e) {
    for (const k of ['outerDia', 'boreDia', 'thickness', 'bcd', 'boltHoleD', 'boltCount']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.boreDia >= i.outerDia) e.push('bore ≥ OD');
    if (!(i.bcd > i.boreDia && i.bcd < i.outerDia)) e.push('BCD not between bore and OD');
    if (i.bcd + i.boltHoleD >= i.outerDia) e.push('bolt holes break OD rim');
    if (i.bcd - i.boltHoleD <= i.boreDia) e.push('bolt holes break bore rim');
    if (!Number.isInteger(i.boltCount) || i.boltCount < 2 || i.boltCount > 36) e.push('boltCount invalid');
  },
  bent_sheet(i, e) {
    for (const k of ['webWidth', 'flangeHeight', 'length', 'thickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (2 * i.thickness >= i.webWidth) e.push('2t ≥ webWidth');
    if (i.thickness >= i.flangeHeight) e.push('t ≥ flangeHeight');
  },
  tube(i, e) {
    for (const k of ['outerDia', 'innerDia', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.innerDia >= i.outerDia) e.push('innerDia ≥ outerDia — 중공 아님');
  },
  rect_tube(i, e) {
    for (const k of ['width', 'height', 'wallThk', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (2 * i.wallThk >= i.width) e.push('2·wallThk ≥ width');
    if (2 * i.wallThk >= i.height) e.push('2·wallThk ≥ height');
  },
  // §8-② 단면 라이브러리 v1(2026-07-16): H형강·C찬넬 — 실단면(플랜지+웨브)으로 형강 표현
  h_section(i, e) {
    for (const k of ['H', 'B', 'tw', 'tf', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.tw >= i.B) e.push('tw ≥ B');
    if (2 * i.tf >= i.H) e.push('2·tf ≥ H');
  },
  c_channel(i, e) {
    for (const k of ['H', 'B', 'tw', 'tf', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.tw >= i.B) e.push('tw ≥ B');
    if (2 * i.tf >= i.H) e.push('2·tf ≥ H');
  },
  box(i, e) {
    // 수평 상한 2km — 토목 선형(옹벽 연장·관로 등) 대축척 지원(260717). 높이는 200m(초고층 여유).
    for (const k of ['width', 'depth']) if (!pos(i[k]) || i[k] > 2_000_000) e.push(`${k} invalid`);
    if (!pos(i.height) || i.height > 200_000) e.push('height invalid');
  },
  cylinder(i, e) {
    // length 60m: 교량 행어·고층 입상관 스케일(i_girder 한계와 정합 — 260717 아치교 신설).
    // diameter 는 5m 유지(AI 헛값 방어 — 대구경 압력용기는 revolve 어휘).
    if (!pos(i.diameter) || i.diameter > 5000) e.push('diameter invalid');
    if (!pos(i.length) || i.length > 60000) e.push('length invalid (≤60m)');
    // T1(260719): 축 키홈(외면 +x측·z=0 시작 관례) · 오링 홈(외면 원환)
    if (i.keyway) {
      const k = i.keyway;
      if (!pos(k.w) || k.w >= i.diameter / 2) e.push('keyway.w invalid(< d/2)');
      if (!pos(k.depth) || k.depth >= i.diameter / 4) e.push('keyway.depth invalid(< d/4)');
      if (k.length != null && (!pos(k.length) || k.length > i.length)) e.push('keyway.length > 축장');
    }
    for (const [n, g] of (i.oringGrooves ?? []).entries()) {
      if (!pos(g.w) || !pos(g.depth) || g.depth >= i.diameter / 4) e.push(`oringGrooves[${n}] w/depth invalid`);
      if (!(g.z >= 0 && g.z + g.w <= i.length)) e.push(`oringGrooves[${n}] z 범위 밖`);
    }
  },
  gusset(i, e) {
    for (const k of ['legA', 'legB', 'thickness']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
  },
  base_plate(i, e) {
    for (const k of ['width', 'depth', 'thickness', 'boltDia']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
    if (i.boltDia >= Math.min(i.width, i.depth) / 2) e.push('boltDia too large');
  },
  spur_gear(i, e) {
    if (!pos(i.module) || i.module < 0.3 || i.module > 50) e.push('module invalid (0.3~50)');
    if (!Number.isInteger(i.teeth) || i.teeth < 6 || i.teeth > 200) e.push('teeth invalid (정수 6~200)');
    if (!pos(i.thickness) || i.thickness > 1000) e.push('thickness invalid');
    const pa = i.pressureAngleDeg ?? 20;
    if (!(pa >= 14 && pa <= 25)) e.push('pressureAngleDeg 14~25');
    if (i.boreDia !== undefined && i.boreDia !== 0 && !pos(i.boreDia)) e.push('boreDia invalid');
    if (e.length) return;
    const m = i.module, z = i.teeth, a = pa * RAD;
    const rp = (m * z) / 2, rb = rp * Math.cos(a), ra = rp + m, rf = rp - 1.25 * m;
    const inv = (x) => Math.tan(x) - x;
    const beta = Math.PI / (2 * z) + inv(a);
    const psiRa = inv(Math.acos(Math.min(1, rb / ra)));
    if (beta - psiRa <= 0.004) e.push('이끝 폭 소멸 — teeth 늘리거나 pressureAngle 조정');
    if (Math.PI / z - beta <= 0.004) e.push('이뿌리 갭 소멸 — 치형 성립 불가');
    if ((i.boreDia ?? 0) / 2 > rf - m) e.push('boreDia가 이뿌리 림 침범 (bore/2 ≤ rf − m)');
    if (i.helixDeg != null && !(i.helixDeg >= 0 && i.helixDeg <= 35)) e.push('helixDeg 0..35');
  },
  hex_bolt(i, e) {
    if (!pos(i.threadDia) || i.threadDia > 100) e.push('threadDia invalid');
    else {
      if (!pos(i.length) || i.length > 60 * i.threadDia) e.push('length invalid (≤60d)');
      const { af, hh } = boltDims(i);
      if (!pos(af) || !pos(hh)) e.push(`비표준 호칭 — headFlats·headHeight 명시 필요 (표준: M${Object.keys(BOLT_TABLE).join('/M')})`);
      else if (af <= i.threadDia) e.push('headFlats ≤ threadDia');
    }
  },
  wall_with_openings(i, e) {
    // 인테리어/건축 벽체 — X방향 길이·Y두께·Z높이, openings=[{x,w,h,sill}] (문 sill=0, 창 sill>0)
    if (!pos(i.length) || i.length > 30000) e.push('length invalid');
    if (!pos(i.thickness) || i.thickness > 600) e.push('thickness invalid');
    if (!pos(i.height) || i.height > 8000) e.push('height invalid');
    for (const [n, o] of (i.openings ?? []).entries()) {
      if (!pos(o.w) || !pos(o.h)) { e.push(`opening[${n}] w/h invalid`); continue; }
      const sill = o.sill ?? 0;
      if (!(o.x >= 0 && o.x + o.w <= i.length)) e.push(`opening[${n}] x 범위 밖`);
      if (!(sill >= 0 && sill + o.h <= i.height)) e.push(`opening[${n}] 높이 범위 밖`);
      if (o.w >= i.length) e.push(`opening[${n}] 폭 ≥ 벽 길이`);
    }
    // 개구 겹침 검사 (v1: X구간 겹침 금지)
    const ops = (i.openings ?? []).slice().sort((a, b) => a.x - b.x);
    for (let k = 1; k < ops.length; k++) if (ops[k].x < ops[k - 1].x + ops[k - 1].w) { e.push('openings X구간 겹침'); break; }
  },
  sheet_profile(i, e) {
    if (!pos(i.thickness) || i.thickness > 30) e.push('thickness invalid (판금 ≤30)');
    if (!pos(i.width) || i.width > 6000) e.push('width invalid');
    if (!Array.isArray(i.segments) || i.segments.length < 2 || i.segments.length > 12) { e.push('segments 2~12개 필요'); return; }
    if (i.segments.some((s) => !pos(s))) { e.push('segment 길이 invalid'); return; }
    const angles = i.angles ?? [];
    if (!Array.isArray(angles) || angles.length !== i.segments.length - 1) { e.push(`angles는 segments−1개(${i.segments.length - 1})`); return; }
    if (angles.some((a) => !Number.isFinite(a) || Math.abs(a) > 120)) { e.push('절곡각 |a| ≤ 120°'); return; }
    if (!e.length && i.segments.some((s) => s < 3 * i.thickness)) e.push('세그먼트 < 3t (최소 플랜지 폭)');
    if (!e.length && !polySimple(sheetPoly(i))) e.push('절곡 단면 자기교차 — 각도/길이 조정');
  },
  i_girder(i, e) {
    if (!pos(i.length) || i.length > 60000) e.push('length invalid (≤60m)');
    for (const k of ['topW', 'topT', 'webT', 'webH', 'botW', 'botT']) if (!pos(i[k]) || i[k] > 4000) e.push(k + ' invalid');
    if (!e.length && i.webT > Math.min(i.topW, i.botW)) e.push('webT > 플랜지 폭');
    if (!e.length && (i.botT + i.webH + i.topT) < 300) e.push('거더 춤 < 300mm');
  },
  // 표준 부품 확장(260718b)
  hex_nut(i, e) {
    for (const k of ['af', 'thickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.boreDia != null && !(i.boreDia >= 0 && i.boreDia < i.af / Math.sqrt(3) * 2)) e.push('boreDia ≥ 대각폭');
  },
  washer(i, e) {
    for (const k of ['outerDia', 'boreDia', 'thickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.boreDia >= i.outerDia) e.push('bore ≥ OD');
  },
  angle(i, e) {
    for (const k of ['legA', 'legB', 'thickness', 'length']) if (!pos(i[k]) || (k !== 'length' && i[k] > 4000)) e.push(`${k} invalid`);
    if (i.thickness >= Math.min(i.legA, i.legB)) e.push('thickness ≥ min(legA,legB)');
    if (i.length > 60000) e.push('length invalid (≤60m)');
  },
  tee_section(i, e) {
    for (const k of ['H', 'B', 'tw', 'tf', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.tf >= i.H) e.push('tf ≥ H');
    if (i.tw >= i.B) e.push('tw ≥ B');
    if (i.length > 60000) e.push('length invalid (≤60m)');
  },
  coil_spring(i, e) {
    for (const k of ['wireDia', 'coilDia', 'pitch', 'turns']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.wireDia >= i.coilDia / 2) e.push('wireDia ≥ coilDia/2');
    if (i.pitch < i.wireDia) e.push('pitch < wireDia(밀착 초과 — 코일 겹침)');
    if (i.turns > 60) e.push('turns > 60');
  },
  pillow_block(i, e) {
    for (const k of ['boreDia', 'width', 'height']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.boreDia >= Math.min(i.width, i.height * 2)) e.push('bore ≥ 하우징');
  },
  pipe_reducer(i, e) {
    for (const k of ['dia1', 'dia2', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.dia2 >= i.dia1) e.push('dia2 ≥ dia1 (리듀서는 dia1>dia2)');
    const t = i.wallThk ?? Math.max(2, i.dia1 * 0.03);
    if (2 * t >= i.dia2) e.push('벽두께 ≥ 소경 반경');
  },
  // 자유곡면 어휘(260718d)
  mesh(i, e) {
    if (!pos(i.volumeMm3)) e.push('volumeMm3 invalid(발산정리 산출값 필요)');
    if (!i.aabb?.min || !i.aabb?.max) e.push('aabb 필요');
    if (i.verts && (!Array.isArray(i.verts) || !Array.isArray(i.faces))) e.push('verts/faces 배열 필요');
    if (i.verts && i.verts.length > 20000) e.push('메시 정점 > 20k — 표시 예산 초과(volumeMm3/aabb 만 유지)');
  },
  // 파이프 엘보(R2-⑧): 벤드 반경 원환 부분각 — 체적=파푸스 폐형
  pipe_elbow(i, e) {
    for (const k of ['od', 'bendR']) if (!pos(i[k])) e.push(`${k} invalid`);
    const t = i.wallThk ?? Math.max(2, i.od * 0.05);
    if (2 * t >= i.od) e.push('벽두께 과대(보어 소멸)');
    if (i.bendR <= i.od / 2) e.push('bendR ≤ 반경 — 자기 교차');
    const a = i.angleDeg ?? 90;
    if (!(a > 0 && a <= 180)) e.push('angleDeg (0,180] — 90/180 관례');
  },
  // 파이프 티(R2-⑧, 260719): 본관+지관 융합체(부품 내 부울 — 어휘 단품이라 간섭검사 무관)
  pipe_tee(i, e) {
    for (const k of ['runOD', 'branchOD', 'runLen', 'branchLen']) if (!pos(i[k])) e.push(`${k} invalid`);
    const t = i.wallThk ?? Math.max(2, i.runOD * 0.05);
    if (2 * t >= Math.min(i.runOD, i.branchOD)) e.push('벽두께 과대(보어 소멸)');
    if (i.branchOD > i.runOD) e.push('지관 > 본관 — 미지원(정직)');
  },
  // 철근 어휘(R2-④, 260719 — IFC IFCREINFORCINGBAR/SWEPT_DISK 대응): 폴리라인 스윕 봉
  rebar(i, e) {
    if (!pos(i.dia)) e.push('dia invalid');
    const pts = i.points;
    if (!Array.isArray(pts) || pts.length < 2) { e.push('points ≥2 필요([[x,y,z]...])'); return; }
    for (const [n, q] of pts.entries()) {
      if (!Array.isArray(q) || q.length !== 3 || !q.every(Number.isFinite)) e.push(`points[${n}] invalid(3D 좌표)`);
    }
    if (pts.length > 200) e.push('points > 200 — 배근 분할 필요(표시 예산)');
  },
  revolve(i, e) {
    const prof = i.profile;
    if (!Array.isArray(prof) || prof.length < 3) { e.push('profile ≥3점 필요([[r,z]...])'); return; }
    for (const [n, q] of prof.entries()) {
      if (!Array.isArray(q) || q.length < 2 || !(q[0] >= 0) || !Number.isFinite(q[1])) e.push(`profile[${n}] invalid(r≥0)`);
    }
    if (i.angleDeg != null && !(i.angleDeg > 0 && i.angleDeg <= 360)) e.push('angleDeg (0,360]');
  },
  cavity_block(i, e) {
    for (const k of ['blockW', 'blockD', 'blockH']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (!i.cavity?.type || !i.cavity?.params) { e.push('cavity{type,params,at?} 필요'); return; }
    // 캐비티가 블록 안에 들어가는지(캐비티 AABB + 오프셋 ⊂ 블록·최소 벽두께 5)
    try {
      const cb = partAabb({ type: i.cavity.type, ...i.cavity.params });
      const off = i.cavity.at ?? { tx: 0, ty: 0, tz: 0 };
      const lo = [cb.min[0] + (off.tx ?? 0), cb.min[1] + (off.ty ?? 0), cb.min[2] + (off.tz ?? 0)];
      const hi = [cb.max[0] + (off.tx ?? 0), cb.max[1] + (off.ty ?? 0), cb.max[2] + (off.tz ?? 0)];
      const box = [i.blockW, i.blockD, i.blockH];
      for (let k = 0; k < 3; k++) {
        if (lo[k] < 5 || hi[k] > box[k] - (k === 2 ? -1 : 5)) { e.push(`캐비티가 블록 밖/벽두께<5 (축 ${'xyz'[k]}) — 상면 개방은 z만 허용`); break; }
      }
    } catch (err) { e.push('cavity 형상 검증 실패: ' + String(err.message).slice(0, 60)); }
  },
};

export function gate(intent) {
  const errs = [];
  const g = GATES[intent.type];
  if (!g) { errs.push(`unsupported type '${intent.type}'`); return errs; }
  g(intent, errs);
  return errs;
}

const SCAD = {
  plate_with_holes(i) {
    // T1(260719): through/blind + cbore/csink/tap — 상면(z=t) 기준 가공(holeFeature 단일 소스)
    const cuts = [];
    for (const h of (i.holes ?? [])) {
      const f = holeFeature(h, i.thickness);
      const z0 = f.depth ? i.thickness - f.depth : -1;
      const hh = f.depth ? f.depth + 1 : i.thickness + 2;
      cuts.push(`    translate([${h.x}, ${h.y}, ${z0}]) cylinder(h=${hh}, d=${f.drillD}, $fn=64);`);
      if (f.cb) cuts.push(`    translate([${h.x}, ${h.y}, ${i.thickness - f.cb.depth}]) cylinder(h=${f.cb.depth + 1}, d=${f.cb.dia}, $fn=64);`);
      if (f.cs) {
        const ext = 0.5; // 상면 공면 회피 연장(원뿔 기울기 유지)
        const d2 = f.cs.dia + 2 * ext * Math.tan((f.cs.angleDeg / 2) * RAD);
        cuts.push(`    translate([${h.x}, ${h.y}, ${i.thickness - f.cs.depth}]) cylinder(h=${f.cs.depth + ext}, d1=${h.d}, d2=${d2}, $fn=64);`);
      }
    }
    return `difference() {\n  cube([${i.width}, ${i.depth}, ${i.thickness}]);\n${cuts.join('\n')}\n}`;
  },
  stepped_plate(i) {
    return `union() {\n  cube([${i.stepWidth}, ${i.depth}, ${i.stepThickness}]);\n  translate([${i.stepWidth}, 0, 0]) cube([${i.width - i.stepWidth}, ${i.depth}, ${i.thickness}]);\n}`;
  },
  l_bracket(i) {
    return `union() {\n  cube([${i.legA}, ${i.width}, ${i.thickness}]);\n  cube([${i.thickness}, ${i.width}, ${i.legB}]);\n}`;
  },
  flange(i) {
    const bolts = Array.from({ length: i.boltCount }, (_, k) => {
      const a = (360 / i.boltCount) * k;
      return `    rotate([0,0,${a}]) translate([${i.bcd / 2}, 0, -1]) cylinder(h=${i.thickness + 2}, d=${i.boltHoleD}, $fn=48);`;
    }).join('\n');
    return `difference() {\n  cylinder(h=${i.thickness}, d=${i.outerDia}, $fn=128);\n  translate([0,0,-1]) cylinder(h=${i.thickness + 2}, d=${i.boreDia}, $fn=96);\n${bolts}\n}`;
  },
  bent_sheet(i) {
    return `union() {\n  cube([${i.length}, ${i.webWidth}, ${i.thickness}]);\n  cube([${i.length}, ${i.thickness}, ${i.flangeHeight}]);\n  translate([0, ${i.webWidth - i.thickness}, 0]) cube([${i.length}, ${i.thickness}, ${i.flangeHeight}]);\n}`;
  },
  tube(i) {
    return `difference() {\n  cylinder(h=${i.length}, d=${i.outerDia}, $fn=96);\n  translate([0,0,-1]) cylinder(h=${i.length + 2}, d=${i.innerDia}, $fn=96);\n}`;
  },
  rect_tube(i) {
    return `difference() {\n  cube([${i.length}, ${i.width}, ${i.height}]);\n  translate([-1, ${i.wallThk}, ${i.wallThk}]) cube([${i.length + 2}, ${i.width - 2 * i.wallThk}, ${i.height - 2 * i.wallThk}]);\n}`;
  },
  // H형강 — 하부 플랜지 + 웨브 + 상부 플랜지(길이=X). 실단면이라 질량·BOQ도 정확해진다.
  h_section(i) {
    return `union() {\n  cube([${i.length}, ${i.B}, ${i.tf}]);\n  translate([0, ${(i.B - i.tw) / 2}, ${i.tf}]) cube([${i.length}, ${i.tw}, ${i.H - 2 * i.tf}]);\n  translate([0, 0, ${i.H - i.tf}]) cube([${i.length}, ${i.B}, ${i.tf}]);\n}`;
  },
  // C찬넬 — 웨브(수직) + 상·하 플랜지 한쪽
  c_channel(i) {
    return `union() {\n  cube([${i.length}, ${i.tw}, ${i.H}]);\n  cube([${i.length}, ${i.B}, ${i.tf}]);\n  translate([0, 0, ${i.H - i.tf}]) cube([${i.length}, ${i.B}, ${i.tf}]);\n}`;
  },
  box(i) {
    return `cube([${i.width}, ${i.depth}, ${i.height}]);`;
  },
  cylinder(i) {
    const body = `cylinder(h=${i.length}, d=${i.diameter}, $fn=96);`;
    // T1(260719): 키홈(+x측 z=0 시작 관례)·오링 홈 — composeIntent(STEP)와 동일 수학
    const cuts = [];
    const r = i.diameter / 2;
    if (i.keyway) {
      const k = i.keyway;
      cuts.push(`  translate([${r - k.depth}, ${-k.w / 2}, 0]) cube([${k.depth + 1}, ${k.w}, ${k.length ?? i.length}]);`);
    }
    for (const g of i.oringGrooves ?? []) {
      cuts.push(`  translate([0, 0, ${g.z}]) difference() { cylinder(h=${g.w}, d=${i.diameter + 2}, $fn=96); translate([0,0,-1]) cylinder(h=${g.w + 2}, d=${i.diameter - 2 * g.depth}, $fn=96); }`);
    }
    return cuts.length ? `difference() {\n  ${body}\n${cuts.join('\n')}\n}` : body;
  },
  gusset(i) {
    return `linear_extrude(height=${i.thickness}) polygon(points=[[0,0],[${i.legA},0],[0,${i.legB}]]);`;
  },
  base_plate(i) {
    const m = i.edgeMargin ?? Math.max(12, i.boltDia * 1.5);
    const holes = [[m, m], [i.width - m, m], [m, i.depth - m], [i.width - m, i.depth - m]]
      .map(([x, y]) => `  translate([${x}, ${y}, -1]) cylinder(h=${i.thickness + 2}, d=${i.boltDia}, $fn=48);`).join('\n');
    return `difference() {\n  cube([${i.width}, ${i.depth}, ${i.thickness}]);\n${holes}\n}`;
  },
  spur_gear(i) {
    // helixDeg(260718f — 헬리컬 기어 옵션): twist=360·b·tanβ/(π·m·z) — 단면 수평투영 근사 명시
    const tw = i.helixDeg ? -((360 * i.thickness * Math.tan(i.helixDeg * RAD)) / (Math.PI * i.module * i.teeth)).toFixed(3) : 0;
    const body = `linear_extrude(height=${i.thickness}${tw ? `, twist=${tw}, slices=${Math.max(20, Math.round(i.thickness / 2))}` : ''}) ${polyScad(gearPoly(i))}`;
    if (!(i.boreDia > 0)) return body;
    return `difference() {\n  ${body}\n  translate([0,0,-1]) cylinder(h=${i.thickness + 2}, d=${i.boreDia}, $fn=64);\n}`;
  },
  hex_bolt(i) {
    const { af, hh } = boltDims(i);
    return `union() {\n  cylinder(h=${i.length}, d=${i.threadDia}, $fn=64);\n  translate([0,0,${i.length}]) linear_extrude(height=${hh}) ${polyScad(hexPts(af))}\n}`;
  },
  sheet_profile(i) {
    return `linear_extrude(height=${i.width}) ${polyScad(sheetPoly(i))}`;
  },
  i_girder(i) {
    const W = Math.max(i.topW, i.botW);
    return `union() {
  translate([0, ${(W - i.botW) / 2}, 0]) cube([${i.length}, ${i.botW}, ${i.botT}]);
  translate([0, ${(W - i.webT) / 2}, ${i.botT}]) cube([${i.length}, ${i.webT}, ${i.webH}]);
  translate([0, ${(W - i.topW) / 2}, ${i.botT + i.webH}]) cube([${i.length}, ${i.topW}, ${i.topT}]);
}`;
  },
  wall_with_openings(i) {
    const ops = (i.openings ?? []).map((o) => `    translate([${o.x}, -1, ${o.sill ?? 0}]) cube([${o.w}, ${i.thickness + 2}, ${o.h}]);`).join('\n');
    if (!ops) return `cube([${i.length}, ${i.thickness}, ${i.height}]);`;
    return `difference() {\n  cube([${i.length}, ${i.thickness}, ${i.height}]);\n${ops}\n}`;
  },
  // 표준 부품 확장(260718b)
  hex_nut(i) {
    const bore = i.boreDia > 0 ? `\n  translate([0,0,-1]) cylinder(h=${i.thickness + 2}, d=${i.boreDia}, $fn=64);` : '';
    return `difference() {\n  linear_extrude(height=${i.thickness}) ${polyScad(hexPts(i.af))}${bore}\n}`;
  },
  washer(i) {
    return `difference() {\n  cylinder(h=${i.thickness}, d=${i.outerDia}, $fn=96);\n  translate([0,0,-1]) cylinder(h=${i.thickness + 2}, d=${i.boreDia}, $fn=96);\n}`;
  },
  angle(i) {
    return `union() {\n  cube([${i.length}, ${i.legA}, ${i.thickness}]);\n  cube([${i.length}, ${i.thickness}, ${i.legB}]);\n}`;
  },
  tee_section(i) {
    return `union() {\n  translate([0, ${(i.B - i.tw) / 2}, 0]) cube([${i.length}, ${i.tw}, ${i.H - i.tf}]);\n  translate([0, 0, ${i.H - i.tf}]) cube([${i.length}, ${i.B}, ${i.tf}]);\n}`;
  },
  coil_spring(i) {
    // C2(260719b): 헬릭스 세그먼트 스윕(2점 실린더+절점 스피어 — rebar 와 동일 수학).
    // 종전 twist 압출은 수평 슬라이스 부피(A·H)라 실선재 부피(A·L_wire)의 ~1/11 — 프록시 해소.
    // 세그먼트 현 근사(턴당 ≤12분할 — 부피 −0.5% 급, 명시). STEP 도 동일 폴리라인.
    const pts = coilPoints(i);
    const segs = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [x1, y1, z1] = pts[k], [x2, y2, z2] = pts[k + 1];
      const L = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
      if (L < 1e-9) continue;
      const ay = (Math.acos((z2 - z1) / L) * 180) / Math.PI;
      const az = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      segs.push(`  translate([${r4(x1)}, ${r4(y1)}, ${r4(z1)}]) rotate([0, ${r4(ay)}, ${r4(az)}]) cylinder(h=${r4(L)}, d=${i.wireDia}, $fn=24);`);
      if (k > 0) segs.push(`  translate([${r4(x1)}, ${r4(y1)}, ${r4(z1)}]) sphere(d=${i.wireDia}, $fn=24);`);
    }
    return `union() {\n${segs.join('\n')}\n}`;
  },
  pillow_block(i) {
    const d2 = i.depth ?? Math.round(i.boreDia * 1.4);
    const bp = i.boltPitch ?? Math.round(i.width * 0.8);
    return `difference() {
  union() {
    cube([${i.width}, ${d2}, ${i.height * 0.55}]);
    translate([${i.width / 2}, ${d2 / 2}, ${i.height * 0.55}]) rotate([-90,0,0]) translate([0,0,${-d2 / 2}]) cylinder(h=${d2}, d=${Math.min(i.width * 0.9, i.height * 1.1)}, $fn=64);
  }
  translate([${i.width / 2}, ${-1}, ${i.height}]) rotate([-90,0,0]) cylinder(h=${d2 + 2}, d=${i.boreDia}, $fn=64);
  translate([${(i.width - bp) / 2}, ${d2 / 2}, -1]) cylinder(h=${i.height}, d=${Math.max(8, i.boreDia * 0.25)}, $fn=32);
  translate([${(i.width + bp) / 2}, ${d2 / 2}, -1]) cylinder(h=${i.height}, d=${Math.max(8, i.boreDia * 0.25)}, $fn=32);
}`;
  },
  pipe_elbow(i) { // 원환 부분각 — rotate_extrude(angle) difference(외/내 단면)
    const t = i.wallThk ?? Math.max(2, i.od * 0.05);
    const a = i.angleDeg ?? 90;
    return `rotate_extrude(angle=${a}, $fn=96) translate([${i.bendR},0]) difference() { circle(d=${i.od}, $fn=48); circle(d=${i.od - 2 * t}, $fn=48); }`;
  },
  pipe_tee(i) { // 본관(x)+지관(+z) 셸 융합 — difference(union(외피), union(보어))
    const t = i.wallThk ?? Math.max(2, i.runOD * 0.05);
    return `difference() {
  union() {
    rotate([0,90,0]) cylinder(h=${i.runLen}, d=${i.runOD}, $fn=96);
    translate([${i.runLen / 2},0,0]) cylinder(h=${i.branchLen}, d=${i.branchOD}, $fn=96);
  }
  rotate([0,90,0]) translate([0,0,-1]) cylinder(h=${i.runLen + 2}, d=${i.runOD - 2 * t}, $fn=96);
  translate([${i.runLen / 2},0,-1]) cylinder(h=${i.branchLen + 2}, d=${i.branchOD - 2 * t}, $fn=96);
}`;
  },
  rebar(i) { // 폴리라인 스윕 봉 — 세그먼트별 2점 실린더 + 절점 스피어(연속성)
    const out = [];
    const pts = i.points;
    for (let k = 0; k < pts.length - 1; k++) {
      const [x1, y1, z1] = pts[k], [x2, y2, z2] = pts[k + 1];
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-9) continue;
      const ay = (Math.acos(dz / L) * 180) / Math.PI;
      const az = (Math.atan2(dy, dx) * 180) / Math.PI;
      out.push(`translate([${x1},${y1},${z1}]) rotate([0,${ay.toFixed(4)},${az.toFixed(4)}]) cylinder(h=${L.toFixed(4)}, d=${i.dia}, $fn=24);`);
    }
    for (let k = 1; k < pts.length - 1; k++) out.push(`translate([${pts[k].join(',')}]) sphere(d=${i.dia}, $fn=24);`);
    return `union() {\n  ${out.join('\n  ')}\n}`;
  },
  pipe_reducer(i) {
    const t = i.wallThk ?? Math.max(2, i.dia1 * 0.03);
    // 원뿔대 셸(rotate_extrude 대신 conical cylinder r1/r2 사용 — OpenSCAD 지원)
    return `difference() {\n  cylinder(h=${i.length}, d1=${i.dia1}, d2=${i.dia2}, $fn=96);\n  translate([0,0,-1]) cylinder(h=${i.length + 2}, d1=${i.dia1 - 2 * t}, d2=${i.dia2 - 2 * t}, $fn=96);\n}`;
  },
  // 자유곡면 어휘(260718d)
  mesh(i) {
    if (i.verts && i.verts.length && i.verts.length <= 20000) {
      const pts = i.verts.map((v) => `[${v[0]},${v[1]},${v[2]}]`).join(',');
      const fcs = i.faces.map((f) => `[${f[0]},${f[1]},${f[2]}]`).join(',');
      return `polyhedron(points=[${pts}], faces=[${fcs}], convexity=10);`;
    }
    // 대형 메시=AABB 프록시 표시(체적·질량은 volumeMm3 정밀값 — 명시)
    const bb = i.aabb;
    return `// mesh proxy: 표시=AABB(정밀 메시 ${i.triCount ?? '?'}tris 는 표시 예산 밖 — 체적은 발산정리 정밀)\ntranslate([${bb.min[0]},${bb.min[1]},${bb.min[2]}]) cube([${bb.max[0] - bb.min[0]}, ${bb.max[1] - bb.min[1]}, ${bb.max[2] - bb.min[2]}]);`;
  },
  revolve(i) {
    const prof = i.profile.map((q) => `[${q[0]},${q[1]}]`).join(',');
    const ang = i.angleDeg && i.angleDeg < 360 ? `angle=${i.angleDeg}, ` : '';
    // rotate_extrude 는 XY 폴리곤을 Z축 회전 — 프로파일 (r,z)를 (x,y)로 그대로 사용
    return `rotate_extrude(${ang}$fn=96) polygon(points=[${prof}]);`;
  },
  cavity_block(i) {
    const off = i.cavity.at ?? {};
    const rot = (off.rx || off.ry || off.rz) ? `rotate([${off.rx ?? 0},${off.ry ?? 0},${off.rz ?? 0}]) ` : '';
    const inner = SCAD[i.cavity.type]({ ...i.cavity.params, type: i.cavity.type });
    return `difference() {\n  cube([${i.blockW}, ${i.blockD}, ${i.blockH}]);\n  translate([${off.tx ?? 0},${off.ty ?? 0},${(off.tz ?? 0) + 0.01}]) ${rot}${inner}\n}`;
  },
};

export function toOpenScad(intent) {
  const errs = gate(intent);
  if (errs.length) throw new Error('geometry gate: ' + errs.join('; '));
  return `// generated by drawing-to-3d v2 (deterministic reconstruction)\n// intent: ${JSON.stringify(intent)}\n${SCAD[intent.type](intent)}\n`;
}

/** 게이트 통과 후 부품 SCAD 본체만 반환(헤더 없음) — 어셈블리 배치용. */
export function scadBody(intent) {
  const errs = gate(intent);
  if (errs.length) throw new Error('geometry gate: ' + errs.join('; '));
  return SCAD[intent.type](intent);
}

/** 부품의 로컬 AABB(배치 전) — 어셈블리 간섭검사용. {min:[x,y,z], max:[x,y,z]} */
export function partAabb(i) {
  switch (i.type) {
    case 'plate_with_holes':
    case 'stepped_plate':
      return { min: [0, 0, 0], max: [i.width, i.depth, i.thickness] };
    case 'i_girder':
      return { min: [0, 0, 0], max: [i.length, Math.max(i.topW, i.botW), i.botT + i.webH + i.topT] };
    case 'l_bracket':
      return { min: [0, 0, 0], max: [i.legA, i.width, i.legB] };
    case 'flange':
      return { min: [-i.outerDia / 2, -i.outerDia / 2, 0], max: [i.outerDia / 2, i.outerDia / 2, i.thickness] };
    case 'bent_sheet':
      return { min: [0, 0, 0], max: [i.length, i.webWidth, i.flangeHeight] };
    case 'tube':
      return { min: [-i.outerDia / 2, -i.outerDia / 2, 0], max: [i.outerDia / 2, i.outerDia / 2, i.length] };
    case 'rect_tube':
      return { min: [0, 0, 0], max: [i.length, i.width, i.height] };
    case 'h_section':
    case 'c_channel':
      return { min: [0, 0, 0], max: [i.length, i.B, i.H] };
    case 'box':
      return { min: [0, 0, 0], max: [i.width, i.depth, i.height] };
    case 'cylinder':
      return { min: [-i.diameter / 2, -i.diameter / 2, 0], max: [i.diameter / 2, i.diameter / 2, i.length] };
    case 'gusset':
      return { min: [0, 0, 0], max: [i.legA, i.legB, i.thickness] };
    case 'base_plate':
      return { min: [0, 0, 0], max: [i.width, i.depth, i.thickness] };
    case 'spur_gear': {
      const ra = (i.module * (i.teeth + 2)) / 2;
      return { min: [-ra, -ra, 0], max: [ra, ra, i.thickness] };
    }
    case 'hex_bolt': {
      const { af, hh } = boltDims(i);
      const R = af / Math.sqrt(3);
      return { min: [-R, -af / 2, 0], max: [R, af / 2, i.length + hh] };
    }
    case 'sheet_profile': {
      const b = polyBbox(sheetPoly(i));
      return { min: [b.x0, b.y0, 0], max: [b.x1, b.y1, i.width] };
    }
    case 'wall_with_openings':
      return { min: [0, 0, 0], max: [i.length, i.thickness, i.height] };
    // 표준 부품 확장(260718b)
    case 'hex_nut': {
      const R = i.af / Math.sqrt(3); // 대각반경
      return { min: [-R, -i.af / 2, 0], max: [R, i.af / 2, i.thickness] };
    }
    case 'washer':
      return { min: [-i.outerDia / 2, -i.outerDia / 2, 0], max: [i.outerDia / 2, i.outerDia / 2, i.thickness] };
    case 'angle':
      return { min: [0, 0, 0], max: [i.length, i.legA, i.legB] };
    case 'tee_section':
      return { min: [0, 0, 0], max: [i.length, i.B, i.H] };
    case 'pipe_reducer':
      return { min: [-i.dia1 / 2, -i.dia1 / 2, 0], max: [i.dia1 / 2, i.dia1 / 2, i.length] };
    // 자유곡면 어휘(260718d)
    case 'mesh': {
      const bb = i.aabb;
      if (!bb) throw new Error('mesh: aabb 필요(빌드 시 산출)');
      return { min: [...bb.min], max: [...bb.max] };
    }
    case 'revolve': {
      const rMax = Math.max(...(i.profile ?? [[1, 0]]).map((q) => q[0]));
      const zs = (i.profile ?? [[0, 0]]).map((q) => q[1]);
      return { min: [-rMax, -rMax, Math.min(...zs)], max: [rMax, rMax, Math.max(...zs)] };
    }
    case 'pipe_tee': {
      // 본관 축=x(로컬), 지관=+z 상향, 원점=본관 시작(축심 y=0,z=0)
      const rr = i.runOD / 2, rb = i.branchOD / 2;
      return { min: [0, -rr, -rr], max: [i.runLen, rr, i.branchLen] };
    }
    case 'pipe_elbow': {
      // 부분각 원환 표면 파라메트릭 샘플(φ 1°×θ 15°) — 끝단면 축방향 과대마진 없는 정확 AABB
      const r = i.od / 2, R = i.bendR, a = i.angleDeg ?? 90;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let d = 0; d <= a; d++) {
        const cf = Math.cos((d * Math.PI) / 180), sf = Math.sin((d * Math.PI) / 180);
        for (let th = 0; th < 360; th += 15) {
          const rr = R + r * Math.cos((th * Math.PI) / 180);
          const x = rr * cf, y = rr * sf;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      return { min: [minX, minY, -r], max: [maxX, maxY, r] };
    }
    case 'rebar': {
      const r = i.dia / 2;
      const xs = i.points.map((q) => q[0]), ys = i.points.map((q) => q[1]), zs2 = i.points.map((q) => q[2]);
      return { min: [Math.min(...xs) - r, Math.min(...ys) - r, Math.min(...zs2) - r], max: [Math.max(...xs) + r, Math.max(...ys) + r, Math.max(...zs2) + r] };
    }
    case 'cavity_block':
      return { min: [0, 0, 0], max: [i.blockW, i.blockD, i.blockH] };
    case 'coil_spring': {
      const r = i.coilDia / 2;
      return { min: [-r, -r, 0], max: [r, r, i.turns * i.pitch + i.wireDia] };
    }
    case 'pillow_block': {
      const d2 = i.depth ?? Math.round(i.boreDia * 1.4);
      return { min: [0, 0, 0], max: [i.width, d2, i.height] };
    }
    default:
      throw new Error(`partAabb: unsupported type '${i.type}'`);
  }
}

/** 채점·재투영용 파라미터 목록 (타입별) */
export const PARAMS = {
  plate_with_holes: ['width', 'depth', 'thickness'],
  stepped_plate: ['width', 'depth', 'thickness', 'stepWidth', 'stepThickness'],
  l_bracket: ['legA', 'legB', 'width', 'thickness'],
  flange: ['outerDia', 'boreDia', 'thickness', 'bcd', 'boltHoleD', 'boltCount'],
  bent_sheet: ['webWidth', 'flangeHeight', 'length', 'thickness'],
  tube: ['outerDia', 'innerDia', 'length'],
  rect_tube: ['width', 'height', 'wallThk', 'length'],
  h_section: ['H', 'B', 'tw', 'tf', 'length'],
  c_channel: ['H', 'B', 'tw', 'tf', 'length'],
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'length'],
  gusset: ['legA', 'legB', 'thickness'],
  base_plate: ['width', 'depth', 'thickness', 'boltDia'],
  spur_gear: ['module', 'teeth', 'thickness', 'boreDia'],
  hex_bolt: ['threadDia', 'length'],
  sheet_profile: ['thickness', 'width'], // segments[]·angles[]는 배열 — 스키마 특례
  wall_with_openings: ['length', 'thickness', 'height'], // openings[]는 배열 — 스키마 특례
  i_girder: ['length', 'topW', 'topT', 'webT', 'webH', 'botW', 'botT'],
  hex_nut: ['af', 'thickness', 'boreDia'],
  washer: ['outerDia', 'boreDia', 'thickness'],
  angle: ['legA', 'legB', 'thickness', 'length'],
  tee_section: ['H', 'B', 'tw', 'tf', 'length'],
  pipe_reducer: ['dia1', 'dia2', 'length', 'wallThk'],
  mesh: ['volumeMm3'], // verts/faces/aabb 는 배열·객체 — 스키마 특례
  revolve: [], // profile 은 배열 — 스키마 특례
  rebar: ['dia'], // points 는 배열 — 스키마 특례(R2-④)
  pipe_tee: ['runOD', 'branchOD', 'runLen', 'branchLen', 'wallThk'],
  pipe_elbow: ['od', 'bendR', 'angleDeg', 'wallThk'],
  cavity_block: ['blockW', 'blockD', 'blockH'], // cavity 는 객체 — 스키마 특례
  coil_spring: ['wireDia', 'coilDia', 'pitch', 'turns'],
  pillow_block: ['boreDia', 'width', 'height', 'depth', 'boltPitch'],
};
