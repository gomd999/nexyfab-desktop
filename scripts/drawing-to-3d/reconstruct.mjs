/**
 * 2D→3D — 결정론 재구성 (어휘 14종): intent JSON → OpenSCAD + 해석적 재투영.
 * AI 산출물은 기하 게이트 통과 후에만 형상화 — "LLM=이해, 결정론=형상·검증".
 *
 * 어휘확장 #3 (2026-07-14): spur_gear(인벌류트 스퍼기어) · hex_bolt(육각볼트, ISO 4017
 * 머리치수 표) · sheet_profile(다단 절곡 판금 — 세그먼트+각도 열로 Z/햇/채널 임의 단면).
 * 프로파일 생성기(gearPoly/hexPts/sheetPoly)는 export — assembly(STEP)·BOQ·프리셋 공용.
 */
// 공차 단일 소스 — 접촉 vs 관통 분류는 부품 간 간섭과 **같은 값**을 쓴다(260801d).
// ⚠ 이 모듈은 의존 그래프의 밑단이라 import 가 없었다. `geometry-tolerance.mjs` 도
//   import 가 없어 순환이 생기지 않는다 — 공차를 여기서 다시 적으면 단일 소스가 깨진다.
import { TOL_CONTACT } from './geometry-tolerance.mjs';

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
/**
 * `extrude_profile` 의 외곽 폴리곤 — **검증하고 돌려준다**.
 *
 * ⚠ 잘못된 입력을 조용히 넘기지 않는다. 점 3개 미만·비유한 좌표·면적 0 은 형상이 아니라
 * 입력 오류이고, 통과시키면 부피 0 인 부품이 "정상"으로 도면집에 들어간다
 * (이 세션에서 반복해 잡은 「없는 것을 있는 것처럼」의 형상판).
 * 자기교차는 검사하지 않는다 — 그 사실을 어휘 힌트에 적는다(모른다고 말하는 편이 낫다).
 */
export function extrudePoly(i) {
  return extrudeProfileGeom(i).pts;
}

/**
 * `extrude_profile` 의 외곽 폴리곤 + **필렛 적용 결과**를 함께 돌려준다 (260801).
 *
 * `filletR`(전 볼록 꼭짓점 균일) 또는 `fillets:[{i, r}]`(꼭짓점별)로 받는다.
 * 형상에 실제로 반영하므로 부피·표면적·SCAD·STEP·GA 가 **같은 형상**을 본다 —
 * 부피만 보정하고 형상은 그대로 두면 둘이 어긋난다.
 */
export function extrudeProfileGeom(i) {
  const base = extrudeProfileRaw(i);
  const uniform = Number(i?.filletR) || 0;
  const perVertex = Array.isArray(i?.fillets) ? new Map(i.fillets.map((f) => [Number(f.i), Number(f.r)])) : null;
  if (!(uniform > 0) && !(perVertex && perVertex.size)) return { pts: base, fillet: null };
  const r = filletPolygon(base, (k) => (perVertex?.has(k) ? perVertex.get(k) : uniform));
  return {
    pts: r.pts,
    fillet: r.applied ? { applied: r.applied, maxSagittaMm: r.maxSagittaMm, radiusMm: uniform || null } : null,
  };
}

function extrudeProfileRaw(i) {
  const raw = Array.isArray(i?.profile) ? i.profile : null;
  if (!raw || raw.length < 3) throw new Error('extrude_profile: profile 은 점 3개 이상의 닫힌 폴리라인이어야 한다(마지막 점≠첫 점 — 자동으로 닫는다)');
  const pts = raw.map((q) => [Number(q[0]), Number(q[1])]);
  if (!pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) throw new Error('extrude_profile: profile 좌표에 비유한 값이 있다');
  // 마지막 점이 첫 점과 같으면 중복이므로 제거(닫기는 소비부가 한다).
  const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9
    ? pts.slice(0, -1) : pts;
  if (closed.length < 3) throw new Error('extrude_profile: 중복점 제거 후 점이 3개 미만이다');
  if (!(Math.abs(polyArea(closed)) > 1e-9)) throw new Error('extrude_profile: profile 면적이 0 이다(일직선 또는 중복점)');
  if (!(Number(i.depth) > 0)) throw new Error('extrude_profile: depth(압출 깊이) > 0 필요');
  return closed;
}

/**
 * 홀 **패턴 전개** (260801) — `pattern` 선언을 구체 홀 목록으로 펼친다.
 *
 * ## 왜 필요한가
 * 참고 코퍼스 실측: 패턴 보유 **248파일**(원형 455 · 선형 175), 패턴에 속한 홀 **1,796개**.
 * 종전에는 홀을 하나씩 열거해야 했고, 그러면 **「패턴」이라는 정보 자체가 사라진다** —
 * 도면에 `4-M12 EQ.S.` 로 나가야 할 것이 좌표 4개로 나가고, BOQ 는 가공 회차를 알 수 없다.
 *
 * 그래서 전개된 홀에 `_pat`(패턴 출처)를 남긴다 — 형상은 구체 홀로, 표기는 패턴으로.
 *
 * 지원: `{kind:'linear', count, pitch, angleDeg?}` · `{kind:'circular', count, bcd, startDeg?}`
 * ⚠ 모르는 `kind` 는 **펼치지 않고 그대로 둔다**(게이트가 이름으로 거부한다). 임의로
 *   선형으로 가정하면 사용자가 준 뜻과 다른 형상이 나간다.
 */
/** 복합 부품의 하위 목록 — 검증하고 정규화한다(1단만). */
/**
 * OpenSCAD `rotate([rx,ry,rz])` 순서(X→Y→Z)로 점 회전 — `assembly.mjs` 의 규약과 **같다**.
 * ⚠ 두 곳에 있지만 `assembly.mjs` 를 import 하면 순환이 된다(assembly → reconstruct).
 *   순서가 갈리면 형상이 어긋나므로 주석으로 짝을 묶어 둔다.
 */
function rotateXYZ([x, y, z], rx, ry, rz) {
  let q = [x, y, z];
  if (rx) { const c = Math.cos(rx * RAD), s2 = Math.sin(rx * RAD); q = [q[0], q[1] * c - q[2] * s2, q[1] * s2 + q[2] * c]; }
  if (ry) { const c = Math.cos(ry * RAD), s2 = Math.sin(ry * RAD); q = [q[0] * c + q[2] * s2, q[1], -q[0] * s2 + q[2] * c]; }
  if (rz) { const c = Math.cos(rz * RAD), s2 = Math.sin(rz * RAD); q = [q[0] * c - q[1] * s2, q[0] * s2 + q[1] * c, q[2]]; }
  return q;
}

/**
 * 점이 폴리곤 내부인가 — ray casting (260801d).
 * 경계 위는 내부로 보지 않는다.
 */
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > py) !== (b[1] > py) && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** 점에서 폴리곤 경계까지의 최단거리. */
function distToPoly(px, py, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)));
  }
  return best;
}

/** 홀의 **외경**(카운터보어·싱크 머리 포함) — 판 밖으로 나가면 안 되는 지름. */
function holeOuterDia(h) {
  const d = Number(h.d);
  if (h.kind === 'cbore' && Number(h.cbDia) > d) return Number(h.cbDia);
  if (h.kind === 'csink' && Number(h.csDia) > d) return Number(h.csDia);
  return d;
}

/**
 * 배치된 하위 부품의 월드 AABB — `composite` 하위 검증용 (260801d).
 * `placedAabb`(assembly.mjs)와 같은 규약이지만 순환 import 를 피해 여기서 구한다.
 */
/**
 * ⚠ 260801k — `export` 한다. 부피 산출(`structural.mjs`)이 빼기 하위를 add 영역으로
 *   자를 때 **게이트와 같은 AABB 규약**을 써야 한다. 여기서 다시 구현하면
 *   「게이트는 통과인데 부피는 다른 형상을 본다」가 된다.
 */
export function subAabb(sb) {
  const b = partAabb({ type: sb.type, ...sb.params });
  const t = [Number(sb.at?.tx) || 0, Number(sb.at?.ty) || 0, Number(sb.at?.tz) || 0];
  const r = [Number(sb.at?.rx) || 0, Number(sb.at?.ry) || 0, Number(sb.at?.rz) || 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const cx of [b.min[0], b.max[0]]) {
    for (const cy of [b.min[1], b.max[1]]) {
      for (const cz of [b.min[2], b.max[2]]) {
        const q = rotateXYZ([cx, cy, cz], r[0], r[1], r[2]);
        for (const k of [0, 1, 2]) { lo[k] = Math.min(lo[k], q[k] + t[k]); hi[k] = Math.max(hi[k], q[k] + t[k]); }
      }
    }
  }
  return { min: lo, max: hi };
}

/** 두 AABB 의 축별 겹침(음수=떨어짐) — 최소값이 관통깊이다. */
export function aabbOverlap(a, b) {
  return [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
}

export function compositeSubs(i) {
  const subs = Array.isArray(i?.subs) ? i.subs : null;
  if (!subs || !subs.length) throw new Error('composite: subs 배열 필요([{type, params, at?, op?}])');
  if (subs.length > 24) throw new Error('composite: 하위 부품 24개 이하(그 이상은 어셈블리로 선언할 것)');
  return subs.map((sb, n) => {
    if (!sb || typeof sb.type !== 'string' || !PARAMS[sb.type]) throw new Error(`composite: subs[${n}].type 미등록`);
    if (sb.type === 'composite') throw new Error(`composite: subs[${n}] 중첩의 중첩 금지(1단만)`);
    if (!sb.params || typeof sb.params !== 'object') throw new Error(`composite: subs[${n}].params 필요`);
    const op = sb.op === 'subtract' ? 'subtract' : 'add';
    return { type: sb.type, params: sb.params, at: sb.at ?? {}, op };
  });
}

export function expandHoles(holes) {
  const out = [];
  for (const [n, h] of (holes ?? []).entries()) {
    const pat = h?.pattern;
    if (!pat || !(Number(pat.count) > 1)) { out.push(h); continue; }
    const cnt = Math.min(200, Math.round(Number(pat.count)));
    const tag = { index: n, kind: String(pat.kind), count: cnt };
    if (pat.kind === 'linear') {
      const pitch = Number(pat.pitch);
      if (!(pitch > 0)) { out.push(h); continue; }
      const a = ((Number(pat.angleDeg) || 0) * Math.PI) / 180;
      for (let k = 0; k < cnt; k++) {
        out.push({ ...h, pattern: undefined, x: h.x + pitch * k * Math.cos(a), y: h.y + pitch * k * Math.sin(a), _pat: { ...tag, seq: k + 1, pitch } });
      }
    } else if (pat.kind === 'circular') {
      const bcd = Number(pat.bcd);
      if (!(bcd > 0)) { out.push(h); continue; }
      const st = ((Number(pat.startDeg) || 0) * Math.PI) / 180;
      for (let k = 0; k < cnt; k++) {
        const t = st + (2 * Math.PI * k) / cnt;
        out.push({ ...h, pattern: undefined, x: h.x + (bcd / 2) * Math.cos(t), y: h.y + (bcd / 2) * Math.sin(t), _pat: { ...tag, seq: k + 1, bcd } });
      }
    } else out.push(h);   // 모르는 kind — 펼치지 않는다(게이트가 거부)
  }
  return out;
}

/**
 * 홀 1개가 **빼는 부피** — `holeFeature` 단일 소스 (260801).
 *
 * ⚠ 종전에는 이 식이 `plate_with_holes` 안에만 있었다. 그래서 `extrude_profile` 은
 *   같은 카운터보어를 줘도 **관통과 같은 부피**를 냈다(실측: 477,738 vs 475,024mm³ —
 *   cbore 를 통째로 무시). 어휘마다 다시 구현하면 언젠가 갈리므로 **한 곳**에 둔다.
 */
export function holeVolume(h, thickness) {
  const f = holeFeature(h, thickness);
  const A4 = Math.PI / 4;
  let v = A4 * f.drillD ** 2 * f.depthEff;                          // 주 구멍(하경·블라인드 반영)
  if (f.cb) v += A4 * (f.cb.dia ** 2 - f.drillD ** 2) * f.cb.depth;  // 카운터보어 링
  if (f.cs) {                                                        // 싱크 원뿔대 − 주 구멍 중복
    const D = f.cs.dia, d0 = h.d, hh = f.cs.depth;
    v += (Math.PI * hh / 12) * (D * D + D * d0 + d0 * d0) - A4 * d0 * d0 * hh;
  }
  return v;
}

/** 홀 1개의 **내벽 면적**(가공·도장 대상). 카운터보어/싱크의 추가 면도 센다. */
export function holeWallArea(h, thickness) {
  const f = holeFeature(h, thickness);
  const A4 = Math.PI / 4;
  let a = Math.PI * f.drillD * f.depthEff;                           // 주 구멍 원통면
  if (f.cb) {
    a += Math.PI * f.cb.dia * f.cb.depth;                            // 카운터보어 벽
    a += A4 * (f.cb.dia ** 2 - f.drillD ** 2) * 0 + Math.PI / 4 * 0; // 바닥 링은 아래에서
    a += (Math.PI / 4) * (f.cb.dia ** 2 - f.drillD ** 2);            // 카운터보어 바닥 링
  }
  if (f.cs) {
    const D = f.cs.dia, d0 = h.d, hh = f.cs.depth;
    a += Math.PI * ((D + d0) / 2) * Math.hypot((D - d0) / 2, hh);    // 원뿔대 측면
  }
  return a;
}

/**
 * 폐곡선 **필렛(모서리 라운드)** — 볼록 꼭짓점을 원호(현 분할)로 대체 (260801).
 *
 * ## 왜 형상에 반영하는가
 * 참고 코퍼스 실측: 필렛 보유 **157파일**, 반경 표본 **2,095개**(중앙값 1.43mm).
 * 기존 스키마의 `FilletFeature` 는 「record-only(OpenSCAD 에 진짜 필렛 엔진이 없다)」였다.
 * 그런데 **압출 프로파일의 필렛은 2D 문제**다 — 폴리곤 꼭짓점을 원호로 바꾸면 되고,
 * 그러면 부피·표면적·SCAD·STEP·GA 가 **전부 같은 형상**을 본다.
 * 부피만 보정하고 형상은 그대로 두면 둘이 어긋나므로, 그 길은 택하지 않았다.
 *
 * ⚠ 원호는 **현으로 근사**한다(임포터와 같은 규약). 최대 새그를 함께 돌려주고
 *   호출측이 「정확 복원 아님」으로 고지한다.
 * ⚠ **볼록 꼭짓점만** 라운드한다. 오목 모서리 필렛은 재료가 늘어나는 쪽이라 별개 문제고,
 *   여기서 같이 처리하면 어느 쪽인지 모른 채 부피가 바뀐다.
 * ⚠ 반경이 인접 변 절반을 넘으면 **줄이지 않고 거부**한다 — 조용히 줄이면 사용자가 준
 *   반경과 다른 형상이 나간다.
 */
const FILLET_CHORD_TOL = 0.05;
export function filletPolygon(pts, radiusOf) {
  const n = pts.length;
  const out = [];
  let maxSag = 0, applied = 0;
  // 폴리곤 방향(CCW=+) — 볼록 판정의 부호 기준.
  const ccw = polyArea(pts) > 0;
  for (let i = 0; i < n; i++) {
    const P0 = pts[(i - 1 + n) % n], P1 = pts[i], P2 = pts[(i + 1) % n];
    const r = Number(radiusOf(i)) || 0;
    const v1 = [P0[0] - P1[0], P0[1] - P1[1]];
    const v2 = [P2[0] - P1[0], P2[1] - P1[1]];
    const L1 = Math.hypot(v1[0], v1[1]), L2 = Math.hypot(v2[0], v2[1]);
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const convex = ccw ? cross < 0 : cross > 0;
    if (!(r > 0) || !convex || !(L1 > 1e-9) || !(L2 > 1e-9)) { out.push(P1); continue; }
    const u1 = [v1[0] / L1, v1[1] / L1], u2 = [v2[0] / L2, v2[1] / L2];
    const cosT = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const theta = Math.acos(cosT);                      // 내각
    if (!(theta > 1e-6 && theta < Math.PI - 1e-6)) { out.push(P1); continue; }
    const t = r / Math.tan(theta / 2);                  // 꼭짓점→접점 거리
    if (t > Math.min(L1, L2) / 2) throw new Error(`fillet r=${r} 가 꼭짓점 ${i} 의 인접 변(${Math.round(Math.min(L1, L2))}mm) 절반을 넘는다 — 반경을 줄이거나 형상을 바꿔야 한다`);
    const T1 = [P1[0] + u1[0] * t, P1[1] + u1[1] * t];
    const T2 = [P1[0] + u2[0] * t, P1[1] + u2[1] * t];
    // 원 중심 = 꼭짓점에서 이등분선 방향으로 r/sin(θ/2)
    const bis = [u1[0] + u2[0], u1[1] + u2[1]];
    const bl = Math.hypot(bis[0], bis[1]) || 1;
    const dC = r / Math.sin(theta / 2);
    const C = [P1[0] + (bis[0] / bl) * dC, P1[1] + (bis[1] / bl) * dC];
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    const a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const ratio = Math.max(-1, Math.min(1, 1 - FILLET_CHORD_TOL / r));
    const segs = Math.max(2, Math.min(48, Math.ceil(Math.abs(sweep) / (2 * Math.acos(ratio)))));
    for (let k = 0; k <= segs; k++) {
      const a = a1 + (sweep * k) / segs;
      out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]);
    }
    maxSag = Math.max(maxSag, r * (1 - Math.cos(Math.abs(sweep) / segs / 2)));
    applied += 1;
  }
  return { pts: out, applied, maxSagittaMm: +maxSag.toFixed(4) };
}

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

/**
 * 홀 **가공 상세 게이트** 단일 소스 (260801).
 *
 * ⚠ 종전에는 이 검증이 `plate_with_holes` 안에만 있었다. 그래서 다른 어휘는
 *   `kind:'cbore'` 를 줘도 아무 검증 없이 통과하고 **부피에도 반영되지 않았다**
 *   (실측: `extrude_profile` 이 카운터보어를 관통과 같게 셌다). 한 곳에 둔다.
 */
/**
 * 홀 **공차 등급** 표기 검증 (260801e).
 *
 * ⚠ 종전에는 사용자가 공차를 **줄 자리조차 없었다**(`holes[{x,y,d,kind,…}]` 에 필드 없음).
 *   판정 이전에 **받을 자리**가 먼저다 — 없으면 사용자는 의도를 표현할 방법이 없다.
 *
 * ⚠ 여기서는 **표기 형식만** 본다(H7·h6·JS9 형태). **틈새/조임 판정은 하지 않는다** —
 *   그건 짝이 되는 축이 선언돼야 가능하고(`fitClassLookup.evaluateFit`), 형상에 축이
 *   없는 판재에서는 판정할 대상이 없다. 형식만 보고 판정한 척하지 않는다.
 */
const TOL_CLASS_RE = /^(?:[A-Za-z]{1,2})(?:[5-9]|1[0-8])$/;
function holeToleranceGate(h, tag, e) {
  if (h.fit == null) return;
  if (typeof h.fit !== 'string' || !TOL_CLASS_RE.test(h.fit.trim())) {
    e.push(`${tag} fit 표기가 아니다(예: H7·h6·JS9) — 받은 값: ${JSON.stringify(h.fit)}`);
  }
}

function holeDetailGate(h, thk, tag, e) {
  holeToleranceGate(h, tag, e);
  if (h.kind === 'cbore') {
    if (!pos(h.cbDia) || h.cbDia <= h.d) e.push(`${tag} cbDia ≤ d`);
    if (!pos(h.cbDepth) || h.cbDepth >= thk) e.push(`${tag} cbDepth ≥ 두께`);
  } else if (h.kind === 'csink') {
    if (!pos(h.csDia) || h.csDia <= h.d) e.push(`${tag} csDia ≤ d`);
    else {
      const ang = pos(h.csAngleDeg) ? h.csAngleDeg : 90;
      const dep = (h.csDia - h.d) / 2 / Math.tan((ang / 2) * RAD);
      if (dep >= thk) e.push(`${tag} 싱크 깊이 ${Math.round(dep)} ≥ 두께 ${thk}`);
    }
  } else if (h.kind === 'tap') {
    if (!parseThread(h.thread)) e.push(`${tag} thread 미인식(M3~M36 표기 필요)`);
  }
  if (h.depth != null && !(pos(h.depth) && h.depth <= thk)) e.push(`${tag} depth 0<d≤두께`);
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
  /**
   * 원뿔대 — `dia2 = 0` 이면 뾰족한 원뿔이다(허용). 두 지름이 같으면 원기둥이라
   * `cylinder` 를 쓰라고 되돌린다(같은 형상을 두 어휘로 표현하면 BOQ·도면이 갈린다).
   */
  cone(i, e) {
    if (!pos(i.dia1) || i.dia1 > 5000) e.push('dia1 invalid');
    if (!(typeof i.dia2 === 'number' && Number.isFinite(i.dia2) && i.dia2 >= 0) || i.dia2 > 5000) e.push('dia2 invalid(≥0)');
    if (!pos(i.height) || i.height > 60000) e.push('height invalid (≤60m)');
    if (pos(i.dia1) && typeof i.dia2 === 'number' && Math.abs(i.dia1 - i.dia2) < 1e-9) {
      e.push('dia1 = dia2 — 원기둥이다. `cylinder` 를 쓸 것(같은 형상을 두 어휘로 쓰면 BOQ·도면이 갈린다)');
    }
  },
  /**
   * 원환(도넛) — `majorDia` 는 **중심원 지름**, `minorDia` 는 **관 지름**이다.
   * ⚠ `minorDia ≥ majorDia` 면 안쪽 구멍이 사라져 자기교차한다(형상이 성립하지 않는다).
   *   실측 없이 통과시키면 부피 공식 `2π²Rr²` 이 **실제보다 큰 값**을 낸다.
   */
  torus(i, e) {
    if (!pos(i.majorDia) || i.majorDia > 20000) e.push('majorDia invalid');
    if (!pos(i.minorDia) || i.minorDia > 5000) e.push('minorDia invalid');
    if (pos(i.majorDia) && pos(i.minorDia) && i.minorDia >= i.majorDia) {
      e.push('minorDia ≥ majorDia — 안쪽 구멍이 없어 자기교차한다(부피식 2π²Rr² 이 과대해진다)');
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
  /**
   * 슬래브 관통 개구부 (260729) — 계단·승강로·덕트 관통.
   *
   * 벽체(`wall_with_openings`)와 별도 어휘가 필요한 이유: 벽은 **수직면**이라 개구가
   * (x, sill) 로 나지만 슬래브는 **수평면**이라 개구가 평면 (x, y) 로 난다. 관통이므로
   * 두께 전체가 빠진다(블라인드 개념 없음).
   *
   * buildingSMART IFC 4.3 공식 커버리지 샘플의 `slab-openings` 가 짚은 자리다.
   * ⚠ 코퍼스 키워드 빈도로 고른 것이 아니다 — 그쪽은 상위 3개 기증자가 57% 라 편향된다.
   */
  slab_with_openings(i, e) {
    if (!pos(i.length) || i.length > 60000) e.push('length invalid');
    if (!pos(i.depth) || i.depth > 60000) e.push('depth invalid');
    if (!pos(i.thickness) || i.thickness > 2000) e.push('thickness invalid');
    for (const [n, o] of (i.openings ?? []).entries()) {
      if (!pos(o.w) || !pos(o.d)) { e.push(`opening[${n}] w/d invalid`); continue; }
      if (!(o.x >= 0 && o.x + o.w <= i.length)) e.push(`opening[${n}] x 범위 밖`);
      if (!(o.y >= 0 && o.y + o.d <= i.depth)) e.push(`opening[${n}] y 범위 밖`);
      if (o.w >= i.length && o.d >= i.depth) e.push(`opening[${n}] 개구가 슬래브 전체`);
    }
    // 평면 겹침 — 벽체는 X구간만 보면 되지만 슬래브는 **2D 사각 겹침**을 봐야 한다.
    const ops = i.openings ?? [];
    for (let a = 0; a < ops.length; a++) {
      for (let b = a + 1; b < ops.length; b++) {
        const A = ops[a], B = ops[b];
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.d, B.y + B.d) - Math.max(A.y, B.y);
        if (ox > 0 && oy > 0) e.push(`openings[${a}]·[${b}] 평면 겹침`);
      }
    }
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
  tapered_girder(i, e) {
    if (!pos(i.length) || i.length > 60000) e.push('length invalid (≤60m)');
    for (const k of ['topW', 'topT', 'webT', 'webH1', 'webH2', 'botW', 'botT']) if (!pos(i[k]) || i[k] > 4000) e.push(k + ' invalid');
    if (e.length) return;
    if (i.webT > Math.min(i.topW, i.botW)) e.push('webT > 플랜지 폭');
    if ((i.botT + Math.min(i.webH1, i.webH2) + i.topT) < 300) e.push('최소 거더 춤 < 300mm');
    // 물매 제한 = 모델의 한계를 그대로 옮긴 것이다. 상부 플랜지 두께가 **연직 측정**이라
    // 경사 θ 에서 실제 직교 두께는 topT·cosθ. 1/3(θ=18.4°)에서 5.1% 얇다 — 그 이상은
    // 「선언한 두께대로 만들어진다」가 거짓이 되므로 통과시키지 않는다.
    const slope = Math.abs(i.webH2 - i.webH1) / i.length;
    if (slope > 1 / 3) e.push(`웨브 물매 1:${(1 / slope).toFixed(1)} — 1:3 초과(플랜지 두께가 연직 측정이라 직교 두께가 ${(100 - 100 / Math.hypot(1, slope)).toFixed(1)}% 얇아진다)`);
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
  /**
   * 임의 폐곡선 압출(260801). 게이트가 **입력 오류를 형상으로 통과시키지 않는다** —
   * 게이트에 안 넣으면 `unsupported type` 으로 전 경로에서 부품이 조용히 사라진다
   * (실측으로 확인: 어휘·부피·BOQ 를 다 붙여도 게이트가 없으면 어셈블리에서 빠진다).
   */
  extrude_profile(i, e) {
    if (!pos(i.depth)) e.push('depth invalid(>0)');
    const prof = i.profile;
    if (!Array.isArray(prof) || prof.length < 3) { e.push('profile ≥3점 필요([[x,y]...])'); return; }
    for (const [n, q] of prof.entries()) {
      if (!Array.isArray(q) || q.length < 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) e.push(`profile[${n}] invalid([x,y] 수치)`);
    }
    try { extrudePoly(i); } catch (err) { e.push(String(err.message).replace(/^extrude_profile: /, '')); }
    // 패턴을 먼저 펼쳐서 **전개된 홀 전부**를 검사한다 — 선언만 보면 패턴 안쪽이 안 걸린다.
    for (const [n, h] of expandHoles(i.holes).entries()) {
      if (!pos(h?.d) || !Number.isFinite(h?.x) || !Number.isFinite(h?.y)) { e.push(`holes[${n}] invalid({x,y,d>0})`); continue; }
      if (h.pattern) e.push(`holes[${n}] pattern.kind 미지원(linear|circular) 또는 count/pitch/bcd 누락 — 펼치지 못했다`);
      holeDetailGate(h, i.depth, `holes[${n}]`, e);
    }
    /**
     * ⚠ 260801d — **홀이 판 안에 있는지 검사하지 않았다.**
     *
     * `plate_with_holes` 는 `hole[n] x outside` 로 거부하는데 여기는 통과시켰다.
     * 실측: 폭 200 판에 x=500 홀이 게이트를 통과했다 — **없는 홀의 부피가 빠져 질량이
     * 과소**해진다. 패턴은 더 위험하다(선언 1건이 판 밖으로 뻗는다: `count:6, pitch:60`
     * 이 x=320 까지 갔다). 카운터보어·싱크는 **머리 외경**으로 잰다(머리가 판 밖이면 가공 불가).
     *
     * 홀끼리 겹침도 검사한다 — 겹치면 부피가 **이중으로 빠진다**(실측: x=50·52 에 ⌀20 두 개
     * 가 통과했다). 접촉 여유는 공차 사다리(`TOL_CONTACT`)를 쓴다.
     */
    let poly = null;
    try { poly = extrudePoly(i); } catch { poly = null; }
    if (poly) {
      const hs = expandHoles(i.holes).filter((h) => pos(h?.d) && Number.isFinite(h?.x) && Number.isFinite(h?.y));
      for (const [n, h] of hs.entries()) {
        const R = holeOuterDia(h) / 2;
        if (!pointInPoly(h.x, h.y, poly)) {
          e.push(`holes[${n}] 중심(${Math.round(h.x)},${Math.round(h.y)})이 판 외곽 밖이다`);
          continue;
        }
        const dEdge = distToPoly(h.x, h.y, poly);
        if (dEdge < R) e.push(`holes[${n}] 이 판 외곽을 넘는다(경계까지 ${dEdge.toFixed(1)}mm < 반경 ${R.toFixed(1)}mm)`);
      }
      for (let x = 0; x < hs.length; x++) {
        for (let y = x + 1; y < hs.length; y++) {
          const need = (holeOuterDia(hs[x]) + holeOuterDia(hs[y])) / 2;
          const dist = Math.hypot(hs[x].x - hs[y].x, hs[x].y - hs[y].y);
          if (dist < need - TOL_CONTACT) {
            e.push(`holes[${x}]·holes[${y}] 가 겹친다(중심거리 ${dist.toFixed(1)}mm < 필요 ${need.toFixed(1)}mm) — 부피가 이중으로 빠진다`);
          }
        }
      }
    }
    for (const [n, f] of (i.fillets ?? []).entries()) {
      if (!Number.isInteger(Number(f?.i)) || !pos(f?.r)) e.push(`fillets[${n}] invalid({i:정수, r>0})`);
    }
    if (i.filletR != null && !pos(i.filletR)) e.push('filletR invalid(>0)');
  },
  composite(i, e) {
    let subs = null;
    try { subs = compositeSubs(i); } catch (err) { e.push(String(err.message).replace(/^composite: /, '')); return; }
    if (!subs.some((x) => x.op === 'add')) e.push('add 하위가 하나도 없다 — 빼기만으로는 형상이 없다');
    // 하위 각각을 **자기 게이트**로 검사한다 — 여기서 다시 구현하면 규칙이 갈린다.
    for (const [n, sb] of subs.entries()) {
      for (const msg of gate({ type: sb.type, ...sb.params })) e.push(`subs[${n}](${sb.type}) ${msg}`);
    }
    if (e.length) return;   // 하위가 성립하지 않으면 배치 검증은 의미가 없다
    /**
     * ⚠ 260801d — **하위 간 중첩을 검사하지 않았다.**
     *
     * 부피가 `Σ add − Σ subtract` 라 add 끼리 겹치면 **그만큼 과대**해진다.
     * 실측: 같은 자리 100³ 블록 2개 → 질량 15.7kg(실제 7.85kg, **2배**).
     * 어휘 힌트에 「겹침 미공제」라고 적어 뒀지만 **적어 두는 것과 검사하는 것은 다르다** —
     * 사용자는 질량이 2배로 나가는 것을 알 방법이 없었다. 이 세션 내내 막아 온
     * 「고지만 하고 검사가 없는」 형태를 내가 만든 것이었다.
     *
     * 부품 간 중첩과 **같은 규약**을 쓴다: 접촉(≤ `TOL_CONTACT`)은 정상, 그 이상은 관통.
     * 리브가 베이스판에 얹히는 것은 접촉이라 통과해야 한다.
     */
    let boxes = null;
    try { boxes = subs.map((sb) => ({ sb, bb: subAabb(sb) })); } catch { boxes = null; }
    if (!boxes) return;
    const adds = boxes.filter((x) => x.sb.op === 'add');
    for (let a = 0; a < adds.length; a++) {
      for (let b = a + 1; b < adds.length; b++) {
        const ov = aabbOverlap(adds[a].bb, adds[b].bb);
        const depth = Math.min(...ov);
        if (depth > TOL_CONTACT) {
          const vol = Math.round(ov[0] * ov[1] * ov[2]);
          e.push(`add 하위 ${subs.indexOf(adds[a].sb)}·${subs.indexOf(adds[b].sb)} 가 관통한다`
            + `(겹침 ${vol}mm³ · 깊이 ${depth.toFixed(1)}mm > 접촉 여유 ${TOL_CONTACT}mm)`
            + ' — 부피가 그만큼 과대해진다(겹침은 공제하지 않는다)');
        }
      }
    }
    /**
     * ⚠ **빼기 하위가 어느 add 와도 겹치지 않으면** 뺄 것이 없는데 부피에서는 빠진다.
     *   실측: 멀리 떨어진 ⌀20 원통이 0.157kg 을 **없는 자리에서** 뺐다(7.85 → 7.7kg).
     */
    for (const cut of boxes.filter((x) => x.sb.op === 'subtract')) {
      const hits = adds.some((ad) => aabbOverlap(ad.bb, cut.bb).every((v) => v > 0));
      if (!hits) {
        e.push(`subtract 하위 ${subs.indexOf(cut.sb)}(${cut.sb.type}) 가 어느 add 와도 겹치지 않는다`
          + ' — 뺄 것이 없는데 부피에서는 빠진다(배치를 확인할 것)');
      }
    }
  },
  masonry_block(i, e) {
    for (const k of ['length', 'thickness', 'height']) if (!pos(i[k])) e.push(`${k} invalid(>0)`);
    const n = Number(i.coreCount ?? 0);
    if (!(Number.isInteger(n) && n >= 0 && n <= 4)) { e.push('coreCount 0~4 정수'); return; }
    if (n > 0) {
      for (const k of ['coreW', 'coreD']) if (!pos(i[k])) e.push(`${k} invalid(>0 — coreCount>0 이면 필요)`);
      // 공동이 블록을 뚫고 나가면 형상이 아니다. 벽두께(리브)를 실제로 확인한다.
      const span = n * Number(i.coreW);
      if (span >= Number(i.length)) e.push(`공동 폭 합 ${span} ≥ 블록 길이 ${i.length} — 리브가 남지 않는다`);
      if (Number(i.coreD) >= Number(i.thickness)) e.push(`coreD ${i.coreD} ≥ thickness ${i.thickness} — 면판이 남지 않는다`);
    }
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

/**
 * 홀 1개의 **SCAD 절삭 형상** — 관통·블라인드·카운터보어·싱크·탭 (260801, 단일 소스).
 * 가공 기준은 **상면(z=두께)** 이다(종전 `plate_with_holes` 규약을 그대로 승계).
 *
 * ⚠ 종전에는 이 렌더가 `plate_with_holes` 안에만 있었고 다른 어휘는 단순 원통만 뚫었다.
 *   두 벌로 두면 언젠가 갈린다 — 한 곳에서 만들어 공유한다.
 */
function holeScad(h, thk) {
  const f = holeFeature(h, thk);
  const z0 = f.depth ? thk - f.depth : -1;
  const hh = f.depth ? f.depth + 1 : thk + 2;
  const out = ['translate([' + h.x + ', ' + h.y + ', ' + z0 + ']) cylinder(h=' + hh + ', d=' + f.drillD + ', $fn=64);'];
  if (f.cb) out.push('translate([' + h.x + ', ' + h.y + ', ' + (thk - f.cb.depth) + ']) cylinder(h=' + (f.cb.depth + 1) + ', d=' + f.cb.dia + ', $fn=64);');
  if (f.cs) {
    const ext = 0.5; // 상면 공면 회피 연장(원뿔 기울기 유지)
    const d2 = f.cs.dia + 2 * ext * Math.tan((f.cs.angleDeg / 2) * RAD);
    out.push('translate([' + h.x + ', ' + h.y + ', ' + (thk - f.cs.depth) + ']) cylinder(h=' + (f.cs.depth + ext) + ', d1=' + h.d + ', d2=' + d2 + ', $fn=64);');
  }
  return out.join(' ');
}

const SCAD = {
  plate_with_holes(i) {
    // T1(260719): through/blind + cbore/csink/tap — 상면(z=t) 기준(holeFeature 단일 소스)
    // 260801: 홀 렌더를 `holeScad` 로 뽑아 다른 어휘와 공유한다. 패턴도 여기서 펼친다.
    const cuts = expandHoles(i.holes).map((h) => '    ' + holeScad(h, i.thickness));
    return 'difference() {' + '\n  cube([' + i.width + ', ' + i.depth + ', ' + i.thickness + ']);\n'
      + cuts.join('\n') + '\n}';
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
  cone(i) {
    // OpenSCAD 는 원뿔대를 직접 지원한다(d1/d2). 다면체 근사라 부피는 $fn 에 달렸다 —
    // 우리가 내보내는 **부피·표면적은 정확식**이고, SCAD 는 표시용이다(고지 규약).
    return `cylinder(h=${i.height}, d1=${i.dia1}, d2=${i.dia2}, $fn=96);`;
  },
  torus(i) {
    const R = i.majorDia / 2, r = i.minorDia / 2;
    return `translate([0,0,${r}]) rotate_extrude($fn=128) translate([${R}, 0, 0]) circle(d=${i.minorDia}, $fn=64);`;
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
  /** 임의 폐곡선 압출(260801) — 원형 관통홀은 difference 로 뺀다. */
  composite(i) {
    const subs = compositeSubs(i);
    const body = (sb) => {
      const at = sb.at || {};
      const tr = [Number(at.tx) || 0, Number(at.ty) || 0, Number(at.tz) || 0];
      const ro = [Number(at.rx) || 0, Number(at.ry) || 0, Number(at.rz) || 0];
      const inner = scadBody({ type: sb.type, ...sb.params });
      const rot = ro.some(Boolean) ? 'rotate([' + ro.join(',') + ']) ' : '';
      return 'translate([' + tr.join(',') + ']) ' + rot + inner;
    };
    const adds = subs.filter((x) => x.op === 'add').map(body).join(' ');
    const cuts = subs.filter((x) => x.op === 'subtract').map(body).join(' ');
    return cuts ? 'difference() { union() { ' + adds + ' } ' + cuts + ' }' : 'union() { ' + adds + ' }';
  },
  masonry_block(i) {
    const n = Number(i.coreCount ?? 0);
    const solid = `cube([${i.length},${i.thickness},${i.height}]);`;
    if (!(n > 0)) return solid;
    // 공동은 길이방향 등간격 — 리브 두께 = (길이 − 공동폭합) / (n+1)
    const rib = (Number(i.length) - n * Number(i.coreW)) / (n + 1);
    const yy = (Number(i.thickness) - Number(i.coreD)) / 2;
    const cuts = Array.from({ length: n }, (_, k) => {
      const x = rib * (k + 1) + Number(i.coreW) * k;
      return `translate([${+x.toFixed(3)},${+yy.toFixed(3)},-1]) cube([${i.coreW},${i.coreD},${Number(i.height) + 2}]);`;
    }).join(' ');
    return `difference() { ${solid} ${cuts} }`;
  },
  extrude_profile(i) {
    const solid = `linear_extrude(height=${i.depth}) ${polyScad(extrudePoly(i))}`;
    const holes = expandHoles(i.holes);
    if (!holes.length) return solid;
    // 홀 가공 상세(관통·블라인드·카운터보어·싱크·탭)는 `holeScad` 단일 소스를 쓴다.
    const cuts = holes.map((h) => holeScad(h, Number(i.depth))).join(' ');
    return `difference() { ${solid} ${cuts} }`;
  },
  i_girder(i) {
    const W = Math.max(i.topW, i.botW);
    return `union() {
  translate([0, ${(W - i.botW) / 2}, 0]) cube([${i.length}, ${i.botW}, ${i.botT}]);
  translate([0, ${(W - i.webT) / 2}, ${i.botT}]) cube([${i.length}, ${i.webT}, ${i.webH}]);
  translate([0, ${(W - i.topW) / 2}, ${i.botT + i.webH}]) cube([${i.length}, ${i.topW}, ${i.topT}]);
}`;
  },
  tapered_girder(i) {
    const W = Math.max(i.topW, i.botW);
    const a1 = i.botT + i.webH1, a2 = i.botT + i.webH2;
    const poly = (pts) => `polygon(points=[${pts.map(([x, y]) => `[${x},${y}]`).join(',')}])`;
    return `union() {
  translate([0, 0, ${(W - i.botW) / 2}]) cube([${i.length}, ${i.botT}, ${i.botW}]);
  translate([0, 0, ${(W - i.webT) / 2}]) linear_extrude(height=${i.webT}) ${poly([[0, i.botT], [i.length, i.botT], [i.length, a2], [0, a1]])};
  translate([0, 0, ${(W - i.topW) / 2}]) linear_extrude(height=${i.topW}) ${poly([[0, a1], [i.length, a2], [i.length, a2 + i.topT], [0, a1 + i.topT]])};
}`;
  },
  slab_with_openings(i) {
    // 관통 — z 를 위아래 1mm 씩 넘겨 잘라 낸다(동일평면 부울 회피). 두께 전체가 빠지므로
    // 폐형(length·depth·thickness − Σ w·d·thickness)과 정확히 일치한다.
    const ops = (i.openings ?? []).map((o) => `    translate([${o.x}, ${o.y}, -1]) cube([${o.w}, ${o.d}, ${i.thickness + 2}]);`).join('\n');
    if (!ops) return `cube([${i.length}, ${i.depth}, ${i.thickness}]);`;
    return `difference() {\n  cube([${i.length}, ${i.depth}, ${i.thickness}]);\n${ops}\n}`;
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
    case 'tapered_girder': // ⚠ 축 순서가 i_girder 와 다르다: x=스팬 · y=춤 · z=폭
      return { min: [0, 0, 0], max: [i.length, i.botT + Math.max(i.webH1, i.webH2) + i.topT, Math.max(i.topW, i.botW)] };
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
    case 'cone': {
      // 원뿔대는 **큰 쪽 지름**이 경계를 정한다(위가 넓은 형상도 있다).
      const rc = Math.max(i.dia1, i.dia2) / 2;
      return { min: [-rc, -rc, 0], max: [rc, rc, i.height] };
    }
    case 'torus': {
      // 도넛을 XY 평면에 눕힌다 — 바깥 반경 R+r, 두께 2r.
      const Rt = i.majorDia / 2, rt = i.minorDia / 2;
      return { min: [-(Rt + rt), -(Rt + rt), 0], max: [Rt + rt, Rt + rt, 2 * rt] };
    }
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
    case 'slab_with_openings':
      return { min: [0, 0, 0], max: [i.length, i.depth, i.thickness] };
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
    case 'composite': {
      /**
       * 외곽은 **add 하위의 합집합**이다 — subtract 는 경계를 넓히지 않는다.
       *
       * ⚠ 260801b: 처음엔 평행이동만 더했다. 그러자 `motor_mount` 의 웨브(rx=90)가
       *   **회전 전 경계**로 계산돼 261×172×26 이 나왔다(실제 200×140×174).
       *   AABB 는 간섭·GA·지지 판정이 모두 쓰는 값이라, 회전을 빼먹으면 그 전부가 틀린다.
       *   8코너를 회전시켜 월드 경계를 낸다(`placedAabb` 와 같은 규약).
       */
      const subs = compositeSubs(i).filter((x) => x.op === 'add');
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const sb of subs) {
        const b = partAabb({ type: sb.type, ...sb.params });
        const t = [Number(sb.at.tx) || 0, Number(sb.at.ty) || 0, Number(sb.at.tz) || 0];
        const rr = [Number(sb.at.rx) || 0, Number(sb.at.ry) || 0, Number(sb.at.rz) || 0];
        for (const cx of [b.min[0], b.max[0]]) for (const cy of [b.min[1], b.max[1]]) for (const cz of [b.min[2], b.max[2]]) {
          const q = rotateXYZ([cx, cy, cz], rr[0], rr[1], rr[2]);
          for (const k of [0, 1, 2]) { lo[k] = Math.min(lo[k], q[k] + t[k]); hi[k] = Math.max(hi[k], q[k] + t[k]); }
        }
      }
      if (!lo.every(Number.isFinite)) throw new Error('composite: add 하위에서 경계를 못 얻었다');
      return { min: lo.map((v) => +v.toFixed(4)), max: hi.map((v) => +v.toFixed(4)) };
    }
    case 'masonry_block':
      return { min: [0, 0, 0], max: [i.length, i.thickness, i.height] };
    case 'extrude_profile': {
      const b = polyBbox(extrudePoly(i));
      return { min: [b.x0, b.y0, 0], max: [b.x1, b.y1, Number(i.depth)] };
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
  // 260801h — 솔리드 원뿔대·원환. `pipe_reducer`(원뿔 **셸**)·`pipe_elbow`(원환 셸)와
  // 구별된다: 이쪽은 **속이 찬** 형상이다. `revolve` 로도 흉내 낼 수 있지만 그건 다각형
  // 근사라 부피가 실제와 다르다 — 여기서는 부피·표면적이 **정확식**이다.
  cone: ['dia1', 'dia2', 'height'],
  torus: ['majorDia', 'minorDia'],
  gusset: ['legA', 'legB', 'thickness'],
  base_plate: ['width', 'depth', 'thickness', 'boltDia'],
  spur_gear: ['module', 'teeth', 'thickness', 'boreDia'],
  hex_bolt: ['threadDia', 'length'],
  sheet_profile: ['thickness', 'width'], // segments[]·angles[]는 배열 — 스키마 특례
  wall_with_openings: ['length', 'thickness', 'height'], // openings[]는 배열 — 스키마 특례
  slab_with_openings: ['length', 'depth', 'thickness'],  // openings[]는 배열 — 스키마 특례
  i_girder: ['length', 'topW', 'topT', 'webT', 'webH', 'botW', 'botT'],
  tapered_girder: ['length', 'topW', 'topT', 'webT', 'webH1', 'webH2', 'botW', 'botT'],
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
  /**
   * 임의 폐곡선 압출 (260801, 참고 코퍼스 실측 근거).
   *
   * ⚠ 왜 필요한가 — 코퍼스 IR 전수(1,071건)에서 압출 프로파일 10,508개를 집계했다:
   *   arbitrary_closed **67.6%** · rectangle 23.3% · derived 7.9% · circle 1.0% ·
   *   i_shape 0.2% · tshape 0.1%.
   *   기존 어휘 30종은 rectangle·circle·i/t 계열(=24.5%)만 표현할 수 있었다.
   *   **실물 압출의 3분의 2가 어휘에 없었다** — 어휘를 30→60종으로 늘려도 이 비율은
   *   바뀌지 않는다(임의 곡선은 열거로 못 덮는다). 그래서 어휘 1종으로 받는다.
   *
   * `profile`·`holes` 는 배열이라 스키마 특례(revolve·mesh 와 같은 취급).
   */
  extrude_profile: ['depth'],
  /**
   * 조적 블록 (260801, 참고 코퍼스 근거 + KS F 4002).
   *
   * ⚠ 코퍼스가 준 것과 주지 않은 것을 구별해 적는다:
   *   **준 것** — `cmu`·`brick` 이 부품명에 40회 등장한다(조적 벽체가 어휘에 통째로 없었다).
   *   **주지 않은 것** — 부품 단위 치수. IR 의 `extent.size` 는 **어셈블리 전체 bbox** 라
   *   조적 블록 한 장의 치수를 코퍼스에서 뽑을 수 없다(실측으로 확인: 3건 모두 건물 전체
   *   bbox 였다 — 13,619×17,120×9,989mm 등). **그래서 치수 기본값은 코퍼스가 아니라
   *   KS F 4002(콘크리트 기본블록 390×190×두께)에서 온다.** 코퍼스에서 나오지 않은 값을
   *   코퍼스 근거라고 적으면 그게 지어내기다.
   *
   * 속빈 공동(core)은 개수·치수를 받아 실제로 뺀다 — 중실로 두면 부피·질량이 과대해진다.
   */
  masonry_block: ['length', 'thickness', 'height', 'coreCount', 'coreW', 'coreD'],
  /**
   * 복합 부품(중첩) — 하위 부품의 합·차로 한 부품을 만든다 (260801).
   *
   * ⚠ 코퍼스 실측: 형상 aspect 가 `complex` 인 것이 **447/1071(42%)** 다. 프리미티브
   *   하나로 표현되지 않는 부품이 절반에 가까운데, 중첩을 지원하는 어휘는 `cavity_block`
   *   하나뿐이었다(금형 전용). 일반화한다.
   *
   * `subs: [{type, params, at?, op?}]` — `op:'subtract'` 는 빼고 나머지는 더한다.
   * ⚠ **겹침은 공제하지 않는다.** add 끼리 겹치면 부피가 과대해진다 — 그 사실을 어휘
   *   힌트와 BOQ 고지에 적는다(조용히 근사하면 물량이 틀린 채로 나간다).
   * ⚠ 중첩은 **1단**만 받는다(하위의 하위 금지) — 재귀 깊이를 열어 두면 부피·AABB·
   *   간섭·STEP 이 어디까지 정확한지 아무도 말할 수 없게 된다.
   */
  composite: [],   // subs 는 배열 — 스키마 특례
};
