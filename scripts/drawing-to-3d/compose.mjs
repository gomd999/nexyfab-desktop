/**
 * 2D→3D 범용 조합 — 고정 템플릿(어휘) 대신 AI가 범용 프리미티브를 자유 조합해
 * 임의 형상을 만든다. 방법론의 본래 설계(§12.1): AI는 구조화 intent(프리미티브
 * 그래프)까지만, 형상·검증은 결정론.
 *
 * 프리미티브(kind):
 *   revolve  { profile:[[x,y]…] (x≥0), angle? }   회전체 — 탱크·용기·축
 *   extrude  { profile:[[x,y]…], height }          압출 — 판·리브·프레임
 *   cylinder { diameter, height, centered? }        원통 — 축·노즐·구멍툴
 *   box      { size:[w,d,h] }                        직육면체
 *   sphere   { diameter }                            구·돔
 * 공통: at{ translate, rotate }, op:'add'|'subtract', pattern{ type:'circular', count, sweep? }
 *
 * 검증: 폴리곤 게이트(닫힘·단순·회전축≥0) + verify_3d(실렌더 manifold). 자유 조합의
 * 안전망은 템플릿과 같은 곳 — 결정론 게이트 + 실렌더. AI가 헛것을 내도 비-manifold/
 * 빈 형상으로 걸린다.
 *
 * usage: node compose.mjs "200L 원뿔바닥 수처리 탱크 …"   (텍스트→조합, Gemini)
 *        node compose.mjs '<intent.json>' --emit          (직접 intent→SCAD)
 */
import { readFileSync } from 'node:fs';
import { apiKey, repairJsonNumbers } from './extract.mjs';

// ─── 폴리곤 게이트 (intent 모듈 verify.ts의 .mjs 포트) ──────────────────────
function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
function segInt(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  const e = 1e-9; return t > e && t < 1 - e && u > e && u < 1 - e;
}
function isSimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
    if (segInt(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
  }
  return true;
}
function profileErrors(pts, { axisMin } = {}) {
  const e = [];
  if (!Array.isArray(pts) || pts.length < 3) return ['profile: <3 points'];
  if (pts.some((p) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) e.push('profile: bad point');
  if (Math.abs(signedArea(pts)) < 1e-6) e.push('profile: zero area');
  if (!isSimple(pts)) e.push('profile: self-intersecting');
  if (axisMin !== undefined && Math.min(...pts.map((p) => p[0])) < axisMin - 1e-9) e.push('profile: crosses revolve axis (x<0)');
  return e;
}

// ─── 정규화 — union 스키마 탓에 AI가 필드를 흔히 오배치한다(cylinder에 size 등).
//     결정론적으로 명백한 오배치만 교정(추측 최소화). 원본 의도를 안 바꾸는 매핑.
/**
 * 프로파일 표기 통일 (260801).
 *
 * ★ 같은 MCP 서버 안에서 **두 도구의 형식이 달랐다.**
 * ```
 *   reconstruct_3d 출력:  profile: { id, points: [{x,y}, …] }
 *   compose/export_step:  profile: [[x,y], …]
 * ```
 *   그래서 문서화된 체인 `extract_drawing → reconstruct_3d → export_step` 이
 *   **마지막 한 칸에서 끊겨 있었다** — OCCT B-rep 내보내기는 멀쩡한데 거기까지 못 갔다.
 *   (실측: 「profile: <3 points」로 거부. 점은 4개였다.)
 *
 * ⚠ 「관대하게 다 받기」가 아니다. **아는 두 표기만** 받고, 나머지는 그대로 두어
 *   기존 게이트가 정직하게 거부하게 한다 — 모르는 형태를 추측해 고치면 그때부터
 *   무엇이 들어왔는지 알 수 없게 된다.
 */
export function normalizeProfile(p) {
  if (Array.isArray(p)) {
    // [[x,y], …] — 이미 정본
    if (p.length === 0 || Array.isArray(p[0])) return p;
    // [{x,y}, …]
    if (p[0] && typeof p[0] === 'object' && Number.isFinite(p[0].x) && Number.isFinite(p[0].y)) {
      return p.map((q) => [q.x, q.y]);
    }
    return p;
  }
  // { points: [{x,y}|[x,y], …] }
  if (p && typeof p === 'object' && Array.isArray(p.points)) return normalizeProfile(p.points);
  return p;
}

export function normalizeFeatures(intent) {
  for (const f of intent.features ?? []) {
    // ★ 프로파일 표기를 먼저 통일한다 — 아래 검사·방출이 전부 [[x,y]] 를 전제한다.
    if (f.profile !== undefined) f.profile = normalizeProfile(f.profile);
    // 빈 profile이 cylinder/box/sphere에 붙으면 제거(혼동 방지)
    if (f.kind !== 'revolve' && f.kind !== 'extrude' && Array.isArray(f.profile) && f.profile.length === 0) delete f.profile;
    if (f.kind === 'cylinder' && !(f.diameter > 0) && Array.isArray(f.size) && f.size.length >= 2) {
      f.diameter = f.size[0]; f.height = f.size[f.size.length - 1]; delete f.size;
    }
    if (f.kind === 'box' && !Array.isArray(f.size)) {
      if (f.width && f.height) f.size = [f.width, f.depth ?? f.width, f.height];
    }
    if (f.kind === 'sphere' && !(f.diameter > 0) && Array.isArray(f.size) && f.size[0] > 0) f.diameter = f.size[0];
  }
  // ── OCCT 견고화(위시빌더 260717): ① 완전 동일 피처 dedup — 공유 waypoint 스피어 등
  // 동일 솔리드 자기융합은 OCCT abort. 기하 키만 비교(_col 등 표시속성 제외).
  if (Array.isArray(intent.features)) {
    const seen = new Set();
    intent.features = intent.features.filter((f) => {
      const k = JSON.stringify([f.kind, f.size, f.diameter, f.height, f.profile, f.at, f.op ?? 'add', f.pattern]);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    // ② 스피어 정확 외접(중심거리 = 반지름 합) → fuse 탄젠트 특이점. 뒤 스피어 지름 -1.4mm.
    const sph = intent.features.filter((f) => f.kind === 'sphere' && f.diameter > 0 && Array.isArray(f.at?.translate) && !f.pattern);
    for (let i = 1; i < sph.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = sph[i].at.translate, b = sph[j].at.translate;
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (Math.abs(dist - (sph[i].diameter + sph[j].diameter) / 2) < 0.6) sph[i].diameter = Math.max(2, sph[i].diameter - 1.4);
      }
    }
  }
  return intent;
}

// ─── 게이트 ──────────────────────────────────────────────────────────────────
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
export function gateComposite(intent) {
  normalizeFeatures(intent);
  const errs = [];
  if (!intent || !Array.isArray(intent.features) || intent.features.length === 0) return ['features[] 비어있음'];
  for (const [i, f] of intent.features.entries()) {
    const tag = f.id ?? `f${i}`;
    switch (f.kind) {
      case 'revolve': errs.push(...profileErrors(f.profile, { axisMin: 0 }).map((m) => `${tag}: ${m}`)); break;
      case 'extrude':
        errs.push(...profileErrors(f.profile).map((m) => `${tag}: ${m}`));
        if (!pos(f.height)) errs.push(`${tag}: height invalid`); break;
      case 'cylinder': if (!pos(f.diameter) || !pos(f.height)) errs.push(`${tag}: cylinder dims invalid`); break;
      case 'box': if (!Array.isArray(f.size) || !f.size.every(pos)) errs.push(`${tag}: box size invalid`); break;
      case 'sphere': if (!pos(f.diameter)) errs.push(`${tag}: sphere dia invalid`); break;
      case 'cone': // 원뿔대(260719 — pipe_reducer 실형상: 계단 근사 폐기)
        if (!pos(f.height) || !(f.dia1 >= 0) || !(f.dia2 >= 0) || (f.dia1 <= 0 && f.dia2 <= 0)) errs.push(`${tag}: cone dia1/dia2/height invalid`);
        break;
      case 'torus': // 원환(260801h) — STEP=진짜 원환면(원 프로파일 회전), SCAD=rotate_extrude
        if (!pos(f.majorDia) || !pos(f.minorDia)) errs.push(`${tag}: torus majorDia/minorDia invalid`);
        else if (f.minorDia >= f.majorDia) errs.push(`${tag}: minorDia ≥ majorDia — 자기교차`);
        break;
      case 'polyhedron': // 자유곡면(블레이드 로프트 등) — 정점/면 직접(260719, AI 생성 어휘 아님)
        if (!Array.isArray(f.verts) || f.verts.length < 4 || !Array.isArray(f.faces) || f.faces.length < 4) errs.push(`${tag}: polyhedron verts/faces invalid`);
        else if (f.verts.length > 20000) errs.push(`${tag}: polyhedron 정점 > 20k — 표시 예산 초과`);
        break;
      case 'coil': // C2(260719b) 헬릭스 — STEP=B-rep 스윕, SCAD=세그먼트 근사(방출부 명시)
        if (!pos(f.wireDia) || !pos(f.coilDia) || !pos(f.pitch) || !pos(f.turns)) errs.push(`${tag}: coil dims invalid`);
        else if (f.wireDia >= f.coilDia / 2) errs.push(`${tag}: wireDia ≥ coilDia/2`);
        break;
      default: errs.push(`${tag}: unknown kind '${f.kind}'`);
    }
    if (f.pattern && (!Number.isInteger(f.pattern.count) || f.pattern.count < 1 || f.pattern.count > 200)) errs.push(`${tag}: pattern count invalid`);
  }
  if (!intent.features.some((f) => f.op !== 'subtract')) errs.push('add 피처가 없음(전부 subtract)');
  return errs;
}

// ─── 결정론 방출 (범용 프리미티브 → OpenSCAD) ───────────────────────────────
const fmt = (n) => { const r = Math.round(n * 10000) / 10000; return Object.is(r, -0) ? '0' : String(r); };
function featBody(f) {
  switch (f.kind) {
    case 'revolve': return `rotate_extrude(angle=${fmt(f.angle ?? 360)}, $fn=96) polygon(points=[${f.profile.map((p) => `[${fmt(p[0])},${fmt(p[1])}]`).join(',')}]);`;
    case 'extrude': return `linear_extrude(height=${fmt(f.height)}) polygon(points=[${f.profile.map((p) => `[${fmt(p[0])},${fmt(p[1])}]`).join(',')}]);`;
    case 'cylinder': return `cylinder(h=${fmt(f.height)}, d=${fmt(f.diameter)}, center=${f.centered ? 'true' : 'false'}, $fn=96);`;
    case 'box': return `cube([${f.size.map(fmt).join(', ')}], center=${f.centered ? 'true' : 'false'});`;
    case 'sphere': return `sphere(d=${fmt(f.diameter)}, $fn=64);`;
    case 'cone': return `cylinder(h=${fmt(f.height)}, d1=${fmt(f.dia1)}, d2=${fmt(f.dia2)}, $fn=96);`;
    // ⚠ SCAD 는 `$fn` 다면체 근사라 STEP(원환면)보다 부피가 조금 작다 — 3열 대조가 그 차를 잰다.
    case 'torus': return `rotate_extrude($fn=128) translate([${fmt(f.majorDia / 2)}, 0, 0]) circle(d=${fmt(f.minorDia)}, $fn=64);`;
    case 'polyhedron': return `polyhedron(points=[${f.verts.map((v) => `[${v.map(fmt).join(',')}]`).join(',')}], faces=[${f.faces.map((q) => `[${q.join(',')}]`).join(',')}], convexity=10);`;
    case 'coil': { // C2(260719b): SCAD 는 세그먼트 스윕 근사(네이티브 스윕 없음 — STEP=B-rep 정확)
      const R = (f.coilDia - f.wireDia) / 2;
      const spt = Math.max(8, Math.min(24, Math.floor(960 / Math.max(1, f.turns)))); // 현 근사 −0.3%급
      const n = Math.max(6, Math.round(f.turns * spt));
      const segs = [];
      let prev = [R, 0, f.wireDia / 2];
      for (let k = 1; k <= n; k++) {
        const t = (k / n) * f.turns, th = 2 * Math.PI * t;
        const cur = [R * Math.cos(th), R * Math.sin(th), f.wireDia / 2 + f.pitch * t];
        const L = Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
        if (L > 1e-9) {
          const ay = (Math.acos((cur[2] - prev[2]) / L) * 180) / Math.PI;
          const az = (Math.atan2(cur[1] - prev[1], cur[0] - prev[0]) * 180) / Math.PI;
          segs.push(`translate([${fmt(prev[0])}, ${fmt(prev[1])}, ${fmt(prev[2])}]) rotate([0, ${fmt(ay)}, ${fmt(az)}]) cylinder(h=${fmt(L)}, d=${fmt(f.wireDia)}, $fn=24);`);
          if (k > 1) segs.push(`translate([${fmt(prev[0])}, ${fmt(prev[1])}, ${fmt(prev[2])}]) sphere(d=${fmt(f.wireDia)}, $fn=24);`);
        }
        prev = cur;
      }
      return `union() { ${segs.join(' ')} }`;
    }
    default: throw new Error(`emit: unknown kind ${f.kind}`);
  }
}
function place(f, body) {
  let out = body;
  if (f.at?.rotate) { const [rx = 0, ry = 0, rz = 0] = f.at.rotate; if (rx || ry || rz) out = `rotate([${fmt(rx)},${fmt(ry)},${fmt(rz)}]) ${out}`; }
  if (f.at?.translate) { const [x = 0, y = 0, z = 0] = f.at.translate; out = `translate([${fmt(x)},${fmt(y)},${fmt(z)}]) ${out}`; }
  return out;
}
function withPattern(f, body) {
  if (f.pattern?.type === 'circular' && f.pattern.count > 1) {
    const sweep = f.pattern.sweep ?? 360, step = sweep / f.pattern.count;
    return `for(a=[0:${fmt(step)}:${fmt(sweep - step)}]) rotate([0,0,a]) ${body}`;
  }
  return body;
}
export function emitComposite(intent) {
  const errs = gateComposite(intent);
  if (errs.length) throw new Error('composite gate: ' + errs.join('; '));
  const one = (f) => withPattern(f, place(f, featBody(f)));
  const adds = intent.features.filter((f) => f.op !== 'subtract').map(one);
  const subs = intent.features.filter((f) => f.op === 'subtract').map(one);
  const solid = `union() {\n  ${adds.join('\n  ')}\n}`;
  const scad = subs.length ? `difference() {\n${solid}\n${subs.map((s) => '  ' + s).join('\n')}\n}` : solid;
  return `// composite: ${intent.name ?? 'part'} — drawing-to-3d 범용조합 (deterministic)\n$fn=96;\n${scad}\n`;
}

// ─── AI: 텍스트 → 범용 조합 intent ──────────────────────────────────────────
const N = { type: 'NUMBER' };
const PT = { type: 'ARRAY', items: N, minItems: 2, maxItems: 2 };
const AT = { type: 'OBJECT', properties: { translate: { type: 'ARRAY', items: N }, rotate: { type: 'ARRAY', items: N } } };
const PAT = { type: 'OBJECT', properties: { type: { type: 'STRING', enum: ['circular'] }, count: N, sweep: N } };
export const COMPOSE_SCHEMA = {
  type: 'OBJECT', required: ['name', 'features'],
  properties: {
    name: { type: 'STRING' },
    features: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['kind'],
        properties: {
          id: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['revolve', 'extrude', 'cylinder', 'box', 'sphere'] },
          profile: { type: 'ARRAY', items: PT },
          height: N, diameter: N, centered: { type: 'BOOLEAN' },
          size: { type: 'ARRAY', items: N },
          angle: N, op: { type: 'STRING', enum: ['add', 'subtract'] }, at: AT, pattern: PAT,
        },
      },
    },
  },
};

const COMPOSE_PROMPT = (desc) => `기계/장비 부품 설명을 "범용 프리미티브 조합" JSON으로 설계하라. mm 단위, 좌표계 Z=높이.
프리미티브(kind):
- revolve: profile=[[x,y]…] (x=반경≥0, y=높이) 단면을 Z축 회전. 원뿔바닥 탱크·용기·축. 프로파일은 닫힌 단순 폴리곤(벽 두께 있으면 외곽-내곽 한 폴리곤).
- extrude: profile 단면을 height만큼 Z로 압출. 판·리브·배플.
- cylinder: diameter,height. 축·노즐·구멍툴.
- box: size=[w,d,h]. sphere: diameter. 돔.
공통: at{translate:[x,y,z], rotate:[rx,ry,rz]deg}, op:"add"|"subtract"(구멍/보어), pattern{type:"circular",count,sweep}.
규칙: 명시 치수 그대로. 회전체 벽은 두께 반영. 반복은 pattern. 겹침 접합은 미세 오버랩(0.1mm 이상).
**구멍 위치 필수**: box 는 center=false(원점~[w,d,h])다. 모든 구멍/보어(op:"subtract")는 반드시 at.translate 로 실제 위치에 놓아라 — 원점에 겹쳐두지 마라.
  · 모서리 구멍은 모서리에서 edge margin 만큼 안쪽 좌표. 예) 200×100 판, 모서리 15mm, ⌀8 구멍 4개:
    구멍 at.translate = [15,15,0] · [185,15,0] · [15,85,0] · [185,85,0] (각 cylinder h=판두께+2, z=-1 로 관통).
  · 원형 볼트배열은 pattern{type:"circular",count} + 반경만큼 at.translate.
설명: "${desc}"`;

export async function composeFromText(description, { models = ['gemini-2.5-pro', 'gemini-2.5-flash'] } = {}) {
  const body = JSON.stringify({ contents: [{ parts: [{ text: COMPOSE_PROMPT(description) }] }], generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: COMPOSE_SCHEMA, maxOutputTokens: 8192 } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastErr;
  for (const model of models) for (let a = 0; a < 3; a++) {
    let res; try { res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); } catch (e) { lastErr = e; await sleep(1000); continue; }
    if (!res.ok) { if (res.status === 503 || res.status === 429) { lastErr = new Error(`${model} ${res.status}`); await sleep(1500 * (a + 1)); continue; } lastErr = new Error(`${model} ${res.status}`); break; }
    const j = await res.json(); const text = j.candidates?.[0]?.content?.parts?.[0]?.text; const fin = j.candidates?.[0]?.finishReason;
    if (!text) { lastErr = new Error(`${model} empty(${fin})`); continue; }
    try { return { intent: JSON.parse(text), model }; }
    catch { try { const fx = repairJsonNumbers(text); if (fx !== text) return { intent: JSON.parse(fx), model }; } catch { /**/ } lastErr = new Error(`${model} bad JSON(${fin})`); if (fin === 'MAX_TOKENS') break; }
  }
  throw lastErr;
}

/**
 * 텍스트 → 조합 → 게이트 교정 루프 → 실렌더 검증. 게이트 실패 시 오류를 AI에
 * 되먹여 고친다(§12.7.1 correction loop). AI=계획/수정, 게이트·렌더=결정론 판정.
 * @returns { intent, scad, gatePassed, rounds, verify }
 */
export async function composeWithGate(description, { maxRounds = 2, models } = {}) {
  let { intent } = await composeFromText(description, models ? { models } : {});
  let errs = gateComposite(intent);
  let rounds = 1;
  while (errs.length && rounds <= maxRounds) {
    const fix = `아래 부품 조합 JSON이 기하 게이트에서 실패했다. 오류를 고쳐 같은 형식으로 다시 출력하라.\n오류: ${JSON.stringify(errs)}\n각 프리미티브 필수: revolve/extrude→profile(닫힌 단순 폴리곤, revolve는 x≥0), extrude→height, cylinder→diameter&height, box→size[3], sphere→diameter.\n현재 JSON: ${JSON.stringify(intent)}`;
    const body = JSON.stringify({ contents: [{ parts: [{ text: fix }] }], generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: COMPOSE_SCHEMA, maxOutputTokens: 8192 } });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (!res.ok) break;
    const j = await res.json(); const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
    try { intent = JSON.parse(t); } catch { try { intent = JSON.parse(repairJsonNumbers(t)); } catch { break; } }
    errs = gateComposite(intent);
    rounds++;
  }
  if (errs.length) return { intent, gatePassed: false, gateErrors: errs, rounds };
  const scad = emitComposite(intent);
  let verify = null;
  try {
    const { renderStl } = await import('./verify.mjs');
    const stl = await renderStl(scad);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength); const n = dv.getUint32(80, true);
    const edges = new Map(); const key = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; const ks = []; for (let jj = 0; jj < 3; jj++) ks.push(key(dv.getFloat32(o + jj * 12, true), dv.getFloat32(o + jj * 12 + 4, true), dv.getFloat32(o + jj * 12 + 8, true))); for (let jj = 0; jj < 3; jj++) { const e = [ks[jj], ks[(jj + 1) % 3]].sort().join('|'); edges.set(e, (edges.get(e) ?? 0) + 1); } }
    let bad = 0; for (const c of edges.values()) if (c !== 2) bad++;
    verify = { triangles: n, manifold: bad === 0, nonManifoldEdges: bad };
  } catch (e) { verify = { error: e.message }; }
  return { intent, scad, gatePassed: true, rounds, verify };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('compose.mjs');
if (isMain && process.argv[2]) {
  if (process.argv[3] === '--emit') {
    console.log(emitComposite(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
  } else {
    const r = await composeWithGate(process.argv[2]);
    console.log('gatePassed:', r.gatePassed, '| rounds:', r.rounds, '| features:', r.intent.features?.length);
    if (r.gatePassed) console.log('verify:', JSON.stringify(r.verify));
    else console.log('gateErrors:', JSON.stringify(r.gateErrors));
  }
}
