/**
 * 2D→3D STEP 출력 — 범용 조합 intent를 replicad/OCCT B-rep로 빌드해 진짜 STEP을
 * 방출한다(제조/CNC용). OpenSCAD(메시)와 달리 해석적 B-rep — 기록 커널(§6).
 *
 * 같은 intent를 두 커널로: OpenSCAD(드래프트/프리뷰·검증) ↔ OCCT(기록/STEP).
 * 프리미티브 매핑은 rotate_extrude(Z회전)·linear_extrude와 좌표 일치하도록 맞춤.
 *
 * usage: node to-step.mjs '<intent.json>' out.step
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gateComposite } from './compose.mjs';
import { profileFromSpec } from './loft.mjs';

const OCDIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'replicad-opencascadejs', 'src');

/**
 * OCCT wasm 위치. 프로덕션(Next standalone)에는 node_modules/replicad-opencascadejs의
 * .wasm이 트레이싱되지 않으므로, 앱이 이미 배포하는 `public/replicad_single.wasm`
 * (occtEngine과 동일 파일, Dockerfile이 public/ 복사)을 우선 사용한다. 없으면 node_modules.
 */
function wasmPath() {
  const pub = join(process.cwd(), 'public', 'replicad_single.wasm');
  if (existsSync(pub)) return pub;
  return join(OCDIR, 'replicad_single.wasm');
}

let RC = null;
export async function ensureReplicad() {
  if (RC) return RC;
  // Next 서버(ESM strict) 컨텍스트에서 emscripten glue가 CJS 자유변수(__dirname, require)에
  // 닿으면 ReferenceError가 난다. glue의 NODE 분기가 참조하는 전역을 미리 채워 우회한다.
  // (CLI에선 glue가 CJS로 로딩돼 로컬 __dirname/require가 이 전역을 가려 무해하다.)
  if (typeof globalThis.__dirname === 'undefined') globalThis.__dirname = OCDIR;
  if (typeof globalThis.require === 'undefined') globalThis.require = createRequire(import.meta.url);
  const ocModule = await import('replicad-opencascadejs/src/replicad_single.js');
  const ocFactory = ocModule.default ?? ocModule;
  const wasm = wasmPath();
  const oc = await ocFactory({ locateFile: (p) => (p.endsWith('.wasm') ? wasm : p) });
  const replicad = await import('replicad');
  replicad.setOC(oc);
  RC = replicad;
  return replicad;
}

// ── T1 브리지: 로프트/스윕 스펙 → 진짜 OCCT B-rep(loft/genericSweep) ──────────
// loft.mjs 의 mesh 백엔드와 같은 스펙(로프트=profile/stations/axis, 스윕=profile/path/scale)을
// 받아 삼각 메시가 아니라 OCCT ThruSections(loft)·MakePipeShell(genericSweep)로 B-rep 를
// 만든다(→ 진짜 STEP). profileFromSpec(loft.mjs)로 2D 닫힌 루프를 얻고, 스테이션/경로 프레임에
// 3D 임베드해 각 단면을 닫힌 Wire 로 만든 뒤 loft(단면들)·genericSweep(단면+스파인)을 부른다.
// 프로파일 Wire 는 profileFromSpec 이 준 n개 점을 직선분으로 이은 다각형 근사(스펙 점 충실
// 재현) — 곡선 에지가 아니라 n-각형 단면임을 정직 명시. loft/sweep 가 못 다루면 throw(무폴백).
const _v = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

/** 3D 링 점들(닫힘 가정·끝점 중복 없음) → replicad 닫힌 Wire(연속 선분). */
function ringToWire(rc, ring) {
  const edges = [];
  for (let i = 0; i < ring.length; i++) edges.push(rc.makeLine(ring[i], ring[(i + 1) % ring.length]));
  return rc.assembleWire(edges);
}

/** 2D 프로파일 [[u,v]] → loft.mjs loftAlongAxis 와 동일 임베드로 3D 링.
 *  station={at:[x,y,z], scale, rot(rad)}, axis='x'|'y'|'z'(프로파일 평면 법선). */
function embedStation(profile2d, st, axis) {
  const s = st.scale ?? 1, th = st.rot ?? 0, at = st.at;
  if (!Array.isArray(at) || at.length !== 3 || !at.every(Number.isFinite)) {
    throw new Error(`loft(step): station.at는 유한 [x,y,z] 필요 (받음 ${JSON.stringify(at)})`);
  }
  if (!(s > 0)) throw new Error(`loft(step): station.scale>0 필요 (받음 ${s})`);
  return profile2d.map(([u, v]) => {
    const ru = (u * Math.cos(th) - v * Math.sin(th)) * s;
    const rv = (u * Math.sin(th) + v * Math.cos(th)) * s;
    if (axis === 'z') return [at[0] + ru, at[1] + rv, at[2]];
    if (axis === 'x') return [at[0], at[1] + ru, at[2] + rv];
    return [at[0] + ru, at[1], at[2] + rv]; // 'y' → 평면 XZ
  });
}

/** 로프트 스펙 → OCCT Shape3D. spec={profile, stations:[{at,scale,rot}], axis, ruled?}. */
function loftSolid(rc, spec) {
  const profile2d = profileFromSpec(spec.profile);
  if (!Array.isArray(spec.stations) || spec.stations.length < 2) {
    throw new Error(`loft(step): 스테이션 ≥2개 필요 (받음 ${spec.stations?.length})`);
  }
  const axis = spec.axis ?? 'z';
  if (!['x', 'y', 'z'].includes(axis)) throw new Error(`loft(step): axis는 'x'|'y'|'z' (받음 '${axis}')`);
  const wires = spec.stations.map((st) => ringToWire(rc, embedStation(profile2d, st, axis)));
  // ruled=false: 단면 사이 매끈 전이(기본, 실 CAD 로프트) · true: 직선(룰드) 전이.
  let solid;
  try { solid = rc.loft(wires, { ruled: spec.ruled === true }); }
  catch (e) { throw new Error(`loft(step): OCCT ThruSections 실패 — ${String(e?.message ?? e).slice(0, 80)}`); }
  if (!solid || !solid.faces?.length) throw new Error('loft(step): 로프트 결과가 솔리드가 아님(퇴화/열림)');
  return solid;
}

/** 스윕 스펙 → OCCT Shape3D. spec={kind:'sweep', profile, path:[[x,y,z]...], scale?}. */
function sweepSolid(rc, spec) {
  const profile2d = profileFromSpec(spec.profile);
  const path = spec.path;
  if (!Array.isArray(path) || path.length < 2) throw new Error(`sweep(step): path 점 ≥2개 필요 (받음 ${path?.length})`);
  for (const p of path) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) {
      throw new Error(`sweep(step): path 점은 유한 [x,y,z] 필요 (받음 ${JSON.stringify(p)})`);
    }
  }
  const sc = spec.scale ?? 1;
  if (!(sc > 0)) throw new Error(`sweep(step): scale>0 필요 (받음 ${sc})`);
  // 스파인 = path 폴리라인 와이어(세그먼트별 직선).
  const spineEdges = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (_v.norm(_v.sub(path[i + 1], path[i])).every((c) => c === 0)) {
      throw new Error(`sweep(step): path 연속 중복점(${i}) — 세그먼트 길이 0`);
    }
    spineEdges.push(rc.makeLine(path[i], path[i + 1]));
  }
  const spine = rc.assembleWire(spineEdges);
  // 프로파일 = 스파인 시작 접선에 수직인 평면에 배치(sweepMesh 초기 프레임과 동일 수학).
  const T0 = _v.norm(_v.sub(path[1], path[0]));
  const ref = Math.abs(T0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let N0 = _v.norm(_v.cross(ref, T0));
  if (!(N0[0] || N0[1] || N0[2])) N0 = _v.norm(_v.cross([0, 1, 0], T0));
  const B0 = _v.norm(_v.cross(T0, N0));
  const ring0 = profile2d.map(([u, v]) => [
    path[0][0] + (u * N0[0] + v * B0[0]) * sc,
    path[0][1] + (u * N0[1] + v * B0[1]) * sc,
    path[0][2] + (u * N0[2] + v * B0[2]) * sc,
  ]);
  const profileWire = ringToWire(rc, ring0);
  let solid;
  // frenet=false → OCCT '보정 프레네' 프레임(비틀림 최소, sweepMesh RMF 취지와 동일).
  // transitionMode round → 폴리라인 꺾임에서 자기교차 대신 라운드 처리.
  try { solid = rc.genericSweep(profileWire, spine, { frenet: false, transitionMode: 'round' }); }
  catch (e) { throw new Error(`sweep(step): OCCT MakePipeShell 실패 — ${String(e?.message ?? e).slice(0, 80)}`); }
  if (!solid || !solid.faces?.length) throw new Error('sweep(step): 스윕 결과가 솔리드가 아님(열림/퇴화)');
  return solid;
}

/**
 * 로프트/스윕 스펙 하나 → 진짜 STEP(B-rep). loft.mjs bodyFromSpec(mesh)의 OCCT 대응 —
 * 두 지오메트리 세계를 잇는 브리지. 로프트={profile, stations, axis} · 스윕={kind:'sweep',
 * profile, path, scale}. 기존 blobSTEP() export 경로 그대로 사용(진짜 ISO-10303 방출).
 */
export async function bodySpecToStep(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('bodySpecToStep: spec 객체 필요');
  const rc = await ensureReplicad();
  const solid = spec.kind === 'sweep' ? sweepSolid(rc, spec) : loftSolid(rc, spec);
  const step = await solid.blobSTEP().text();
  return { step, entities: (step.match(/^#\d+/gm) ?? []).length };
}

/** 단일 피처 → replicad Solid (배치·패턴 전). */
function featSolid(rc, f) {
  switch (f.kind) {
    case 'loft':
      return loftSolid(rc, f);
    case 'sweep':
      return sweepSolid(rc, f);
    case 'revolve': {
      // profile [radius,height] — OpenSCAD rotate_extrude와 일치: XZ평면 스케치 후 Z축 회전.
      let pen = rc.draw([f.profile[0][0], f.profile[0][1]]);
      for (let i = 1; i < f.profile.length; i++) pen = pen.lineTo([f.profile[i][0], f.profile[i][1]]);
      // 부분각 회전(R2-⑧ — 엘보/U벤드): angle(도) 지원 실측(90° 부피 오차 0.04%)
      return f.angle > 0 && f.angle < 360
        ? pen.close().sketchOnPlane('XZ').revolve([0, 0, 1], { angle: f.angle })
        : pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]);
    }
    case 'extrude': {
      let pen = rc.draw([f.profile[0][0], f.profile[0][1]]);
      for (let i = 1; i < f.profile.length; i++) pen = pen.lineTo([f.profile[i][0], f.profile[i][1]]);
      return pen.close().sketchOnPlane('XY').extrude(f.height);
    }
    case 'cylinder': {
      const s = rc.drawCircle(f.diameter / 2).sketchOnPlane('XY').extrude(f.height);
      return f.centered ? s.translate([0, 0, -f.height / 2]) : s;
    }
    case 'cone': { // 원뿔대(260719) — 사다리꼴 프로파일 회전(진짜 원뿔면 B-rep)
      const r1 = Math.max(0, f.dia1 / 2), r2 = Math.max(0, f.dia2 / 2), h = f.height;
      const pts = [[0, 0], [Math.max(r1, 1e-6), 0], [Math.max(r2, 1e-6), h], [0, h]];
      let pen = rc.draw([pts[0][0], pts[0][1]]);
      for (let i = 1; i < pts.length; i++) pen = pen.lineTo([pts[i][0], pts[i][1]]);
      return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]);
    }
    /**
     * 원환(260801h) — **원 프로파일**을 회전시킨다(다각형 근사가 아니다).
     * ⚠ `revolve` 의 폴리라인으로 흉내 내면 STEP 부피가 우리가 선언한 정확식(2π²Rr²)과
     *   갈린다 — 「선언과 산출이 다르다」는 이 세션에서 반복해 잡은 형태다.
     */
    case 'torus': {
      const R = f.majorDia / 2, r = f.minorDia / 2;
      return rc.drawCircle(r).translate([R, 0]).sketchOnPlane('XZ').revolve([0, 0, 1]);
    }
    case 'box': {
      const [w, d, h] = f.size;
      const s = rc.drawRectangle(w, d).sketchOnPlane('XY').extrude(h);
      // replicad drawRectangle는 원점 중심 → OpenSCAD cube(원점 코너)와 맞추려 이동.
      return f.centered ? s.translate([0, 0, -h / 2]) : s.translate([w / 2, d / 2, 0]);
    }
    case 'sphere':
      return rc.makeSphere(f.diameter / 2);
    case 'coil': { // C2(260719b): 진짜 B-rep 헬릭스 스윕(sketchHelix+sweepSketch — 실측 오차 ~1.8%
      // = 곡률 단면 왜곡, 명시). SCAD 는 세그먼트 근사(compose 방출부) — 경로별 정직 표기.
      const R = (f.coilDia - f.wireDia) / 2;
      const helix = rc.sketchHelix(f.pitch, f.turns * f.pitch, R, [0, 0, f.wireDia / 2], [0, 0, 1]);
      return helix.sweepSketch((plane, origin) => rc.sketchCircle(f.wireDia / 2, { plane, origin }));
    }
    default:
      throw new Error(`to-step: unknown kind ${f.kind}`);
  }
}

function placeSolid(f, solid) {
  let s = solid;
  const rot = f.at?.rotate;
  if (rot) {
    const [rx = 0, ry = 0, rz = 0] = rot;
    if (rx) s = s.rotate(rx, [0, 0, 0], [1, 0, 0]);
    if (ry) s = s.rotate(ry, [0, 0, 0], [0, 1, 0]);
    if (rz) s = s.rotate(rz, [0, 0, 0], [0, 0, 1]);
  }
  if (f.at?.translate) s = s.translate(f.at.translate);
  return s;
}

/** 패턴 전개 → Solid 배열. */
function expand(f, base) {
  if (f.pattern?.type === 'circular' && f.pattern.count > 1) {
    const sweep = f.pattern.sweep ?? 360, step = sweep / f.pattern.count;
    const out = [];
    for (let k = 0; k < f.pattern.count; k++) out.push(placeSolid(f, base).rotate(step * k, [0, 0, 0], [0, 0, 1]));
    return out;
  }
  return [placeSolid(f, base)];
}

/**
 * OCCT fuse 견고화(위시빌더 실전 260717) — 대형 순차 fuse에서 관찰된 3함정:
 *  ① 동일지름 직교 실린더가 한 점에서 만나면 표면 탄젠트 특이점으로 abort
 *  ② 동일 솔리드 중복/정확 외접 스피어 → abort (compose.normalizeFeatures가 선제 제거)
 *  ③ 특정 피처 융합이 누적 형상을 "조용히 붕괴"(예외 없이 bbox가 쪼그라듦) — 최악.
 * 방어: bbox 가드(융합 결과가 피연산자 bbox union에서 0.5mm 이상 이탈=불량 판정) +
 * 미세 변형 재시도(이동/지름) + 2차 패스(다른 형상이 다 들어간 뒤 fuse 그래프가 달라져
 * 성공하는 경우) + 최종 실패는 드롭하되 report에 정직 기록(조용한 누락 금지).
 */
function fuseBounds(s) { return s.boundingBox.bounds; }
function fuseUnionBad(a, b, t) {
  for (let k = 0; k < 3; k++) {
    const mn = Math.min(a[0][k], b[0][k]), mx = Math.max(a[1][k], b[1][k]);
    if (t[0][k] > mn + 0.5 || t[1][k] < mx - 0.5) return true;
  }
  return false;
}
function fuseVariants(f) {
  const mk = (dt, dd) => {
    const c = JSON.parse(JSON.stringify(f));
    c.at = c.at || {}; c.at.translate = (c.at.translate || [0, 0, 0]).map((v) => v + dt);
    if (dd && c.diameter) c.diameter = Math.max(2, c.diameter + dd);
    if (dd && Array.isArray(c.size)) c.size = c.size.map((v) => Math.max(2, v + dd));
    return c;
  };
  return [f, mk(0.037), mk(0.31, -0.4), mk(-0.23, 0.3)];
}

/** intent → { solid, report } — bbox 가드 순차 융합. report.dropped는 정직 고지용. */
export async function buildSolidRobust(intent) {
  const errs = gateComposite(intent);
  if (errs.length) throw new Error('composite gate: ' + errs.join('; '));
  const rc = await ensureReplicad();
  const adds = [], subFeats = [];
  for (const f of intent.features) (f.op === 'subtract' ? subFeats : adds).push(f);
  const report = { total: intent.features.length, jittered: 0, dropped: [] };
  let acc = null;
  async function tryFuse(f) {
    for (const fv of fuseVariants(f)) {
      let solids;
      try { solids = expand(fv, featSolid(rc, fv)); } catch { continue; }
      let cur = acc, ok = true;
      for (const s of solids) {
        if (!cur) { cur = s; continue; }
        const A = fuseBounds(cur), B = fuseBounds(s);
        let t;
        try { t = cur.fuse(s); } catch { ok = false; break; }
        if (fuseUnionBad(A, B, fuseBounds(t))) { ok = false; break; }
        cur = t;
      }
      if (ok && cur) { if (fv !== f) report.jittered++; acc = cur; return true; }
    }
    return false;
  }
  const pending = [];
  for (const f of adds) { if (!(await tryFuse(f))) pending.push(f); }
  for (const f of pending) { if (!(await tryFuse(f))) report.dropped.push({ kind: f.kind, at: f.at?.translate ?? null, op: 'add' }); }
  if (!acc) throw new Error('to-step: add 피처 없음(또는 전부 융합 실패)');
  for (const f of subFeats) {
    let done = false;
    for (const fv of fuseVariants(f)) {
      try {
        let cur = acc;
        for (const s of expand(fv, featSolid(rc, fv))) cur = cur.cut(s);
        const bb = fuseBounds(cur);
        if (bb.every((c) => c.every(Number.isFinite))) { acc = cur; done = true; break; }
      } catch { /* 다음 변형 */ }
    }
    if (!done) report.dropped.push({ kind: f.kind, at: f.at?.translate ?? null, op: 'subtract' });
  }
  return { solid: acc, report };
}

/** intent → replicad Solid (게이트 통과분만). intentToStep/intentToRecordMeasure/치수감사 공용. */
export async function buildSolid(intent) {
  return (await buildSolidRobust(intent)).solid;
}


/**
 * 실물 STEP 파일 → 경계(mm). Phase5 혼합 어셈블리 게이트·import 프록시 박스용.
 *
 * ⚠️ 260729 실측(NIST-PMI 표준 시험 파일 32개): **`shape.boundingBox` 는 실 경계가 아니다.**
 * OCCT `Bnd_Box` 는 BSpline 면을 제어점 껍질로 감싸므로 **보증된 상위집합**이다 —
 * 32개 중 18개가 2% 이상, 최대 **+73%**(nist_ftc_09 축 3.038→5.252mm) ·
 * nist_ctc_01 은 800×450 → 1170×650(+46%/+44%)로 부풀었다.
 *
 * 이 함수의 값은 `importMerge` 에서 임포트 부품의 **프록시 박스 치수와 배치 오프셋**이
 * 된다. 46% 큰 박스는 간섭검사를 거짓 충돌시키고 질량을 부풀린다. 종전 주석은
 * 「OCCT 정확 경계」라고 적혀 있었는데, 근사를 정확이라 부른 것이라 고쳤다.
 *
 * 그래서 **테셀레이션 실측**(면 삼각화 정점의 min/max)을 값으로 쓴다. 실측에서
 * 깨끗한 공칭치(800·450·150·63.0…)로 떨어져 참값과 일치함을 확인했다. 대가는 메시 1회
 * 비용이고, 남는 오차는 테셀레이션 새그(tolerance 0.01mm)뿐이라 **안쪽으로** 치우친다.
 * 팽창률은 함께 돌려주어 호출측이 필요하면 보수측(Bnd_Box)을 쓸 수 있게 한다.
 */
export async function stepFileBounds(file) {
  const { importSTEP } = await ensureReplicad();
  const buf = readFileSync(file);
  const shp = await importSTEP(new Blob([buf]));
  const bb = shp.boundingBox;
  const [bxmin, bymin, bzmin] = bb.bounds[0] ?? bb.bounds.slice(0, 3);
  const [bxmax, bymax, bzmax] = bb.bounds[1] ?? bb.bounds.slice(3, 6);
  const occt = { min: [bxmin, bymin, bzmin], max: [bxmax, bymax, bzmax] };

  const m = shp.mesh({ tolerance: 0.01, angularTolerance: 10 });
  const v = m.vertices;
  if (!v || v.length < 3) return { ...occt, basis: 'occt_bndbox', note: '삼각화 실패 — Bnd_Box 상위집합(보수)' };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) { if (v[i + k] < min[k]) min[k] = v[i + k]; if (v[i + k] > max[k]) max[k] = v[i + k]; }
  }
  const inflate = [0, 1, 2].map((k) => {
    const d = max[k] - min[k];
    return d > 1e-9 ? +(((occt.max[k] - occt.min[k]) / d - 1) * 100).toFixed(1) : 0;
  });
  return {
    min, max, basis: 'mesh_measured', occt,
    ...(Math.max(...inflate) > 2 ? {
      occtInflatePct: inflate,
      note: `Bnd_Box 가 축별 ${inflate.join('/')}% 크다(BSpline 제어점 껍질) — 실측 경계를 쓴다`,
    } : {}),
  };
}
/**
 * 실물 STEP 텍스트 → 진짜 OCCT B-rep 삼각 메시(수프). importSTEP(Blob).mesh 로 실 커널
 * 테셀레이션(원뿔·구·토러스·BSPLINE·필렛 충실 — box 근사 아님). 소스 IR 충실 측정
 * (meshSoupToStepIr)과 게이트 패스스루 후보(실솔리드 라운드트립) 양쪽이 재사용하는
 * 인프로세스 메셔. importSTEP 실패(opencascade RetError 등)는 throw — 호출측이 'unavailable'.
 * 반환 soup = [[x,y,z],[x,y,z],[x,y,z]] 배열(meshAnalysis/gate TriangleSoup 계약과 동일).
 */
export async function stepTextToMesh(stepText, { tolerance = 0.05, angularTolerance = 15 } = {}) {
  if (typeof stepText !== 'string' || !stepText) throw new Error('stepTextToMesh: STEP 텍스트 필요');
  const { importSTEP } = await ensureReplicad();
  const buf = Buffer.from(stepText, 'latin1');
  const shp = await importSTEP(new Blob([buf]));
  const m = shp.mesh({ tolerance, angularTolerance });
  const v = m.vertices, tri = m.triangles;
  const soup = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] * 3, b = tri[i + 1] * 3, c = tri[i + 2] * 3;
    soup.push([
      [v[a], v[a + 1], v[a + 2]],
      [v[b], v[b + 1], v[b + 2]],
      [v[c], v[c + 1], v[c + 2]],
    ]);
  }
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (v[i] < mnx) mnx = v[i]; if (v[i] > mxx) mxx = v[i];
    if (v[i + 1] < mny) mny = v[i + 1]; if (v[i + 1] > mxy) mxy = v[i + 1];
    if (v[i + 2] < mnz) mnz = v[i + 2]; if (v[i + 2] > mxz) mxz = v[i + 2];
  }
  return {
    soup,
    vertices: v.length / 3,
    triangles: tri.length / 3,
    bbox: { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] },
  };
}


/** intent → STEP 문자열 (B-rep). fuseReport.dropped>0이면 호출측이 정직 고지할 것.
 * opts.imports(Phase5): [{file, offset:[x,y,z]}] — 실물 STEP 을 원기하 그대로 이동해
 * 컴파운드 병합(사용자 소유 파일 전제 — 게이트는 import-merge.resolveImportParts). */
export async function intentToStep(intent, { imports = [], filletMm = 0 } = {}) {
  let solid, report;
  // 부품 스코프(_pid, 260718t): 부품별 robust 빌드 → 컴파운드(실조립 STEP 관례).
  // 전역 subtract 가 타 부품을 깎던 번짐 수정 — 부품 실패는 드롭 보고(정직).
  const hasPid = (intent.features ?? []).some((f) => f._pid !== undefined);
  if (hasPid) {
    const pids = [...new Set(intent.features.map((f) => f._pid))];
    const shapes = [];
    report = { total: intent.features.length, jittered: 0, dropped: [] };
    for (const pid of pids) {
      const fl = intent.features.filter((f) => f._pid === pid);
      try {
        const r = await buildSolidRobust({ name: intent.name, features: fl });
        let s = r.solid;
        // 부품 단위 필렛(#7, _fillet=part.filletMm) — 실패=무필렛 드롭 보고(정직)
        /**
         * ★260802 — **면·선 기준 필렛/모따기**(`_edgeOps`).
         *
         * 부품 전체가 아니라 **지목한 엣지에만** 건다. 실무는 「이 모서리만 R5」인데
         * 종전에는 솔리드 전 에지를 둥글리는 것밖에 없었다.
         *
         * ## 배선 (260802 실측으로 확인)
         * `face-drag` 픽킹 → `topoNaming` 안정 이름 → **엣지 중점** → `containsPoint`.
         * 100×60×20 상자 부피 대조: 무필렛 120,000 · 전체 R3 118,421.7 ·
         * **중점 1개 지목 119,955.0**(정확히 한 엣지).
         *
         * ## ⚠ 위상 이름은 **여기로 넘어오지 않는다**
         * 이름 해석(`buildExtrudeTopo`)은 TS 계층에 있고, 커널로 오는 것은 **해석된 점**이다.
         * 여기서 이름을 다시 풀면 `topoNaming` 이 두 벌이 되고 언젠가 갈린다.
         *
         * ## ⚠ 엣지 단위를 **부품 단위보다 먼저** 건다
         * 전체 필렛을 먼저 걸면 지목한 엣지가 사라져 다음 연산이 못 찾는다.
         * ⚠ 찾지 못하면 **걸지 않고 드롭 보고**한다 — 엉뚱한 엣지에 거는 것이 안 거는 것보다 나쁘다.
         */
        for (const op of (fl.find((f) => Array.isArray(f._edgeOps))?._edgeOps ?? [])) {
          const at = op?.at;
          if (!Array.isArray(at) || at.length !== 3 || !(op?.size > 0)) {
            report.dropped.push({ pid, op: `edge-${op?.kind ?? '?'}`, err: 'at[3]·size 누락 — 참조를 잃었다' });
            continue;
          }
          try {
            s = op.kind === 'chamfer'
              ? s.chamfer(op.size, (e) => e.containsPoint(at))
              : s.fillet(op.size, (e) => e.containsPoint(at));
          } catch (e) {
            // 「no edge was selected」도 여기로 온다 — 참조를 잃은 것이므로 남긴다.
            report.dropped.push({ pid, op: `edge-${op.kind}`, err: String(e?.message ?? e).slice(0, 60) });
          }
        }
        const fr = fl.find((f) => f._fillet > 0)?._fillet;
        if (fr) {
          try { s = s.fillet(fr); }
          catch (e) { report.dropped.push({ pid, op: 'fillet', err: String(e?.message ?? e).slice(0, 50) }); }
        }
        /**
         * 부품 단위 **모따기**(260801l, `_chamfer`=part.chamferMm) — 필렛과 같은 규약이다.
         * ⚠ 실패하면 **무모따기로 드롭하고 보고한다.** 조용히 넘어가면 형상이 선언과 달라진다.
         * ⚠ 필렛 뒤에 적용한다 — 이미 둥근 모서리에 모따기를 걸면 커널이 거부하고, 그 거부가
         *   드롭 보고로 남아야 「둘 다 걸었다」는 잘못된 선언이 드러난다.
         */
        const cr = fl.find((f) => f._chamfer > 0)?._chamfer;
        if (cr) {
          try { s = s.chamfer(cr); }
          catch (e) { report.dropped.push({ pid, op: 'chamfer', err: String(e?.message ?? e).slice(0, 50) }); }
        }
        shapes.push(s);
        report.jittered += r.report.jittered;
        report.dropped.push(...r.report.dropped);
      } catch (e) {
        report.dropped.push({ pid, op: 'part', err: String(e?.message ?? e).slice(0, 60) });
      }
    }
    if (!shapes.length) throw new Error('to-step: 부품 솔리드 없음(전 부품 빌드 실패)');
    if (shapes.length === 1) solid = shapes[0];
    else { const { compoundShapes } = await ensureReplicad(); solid = compoundShapes(shapes); }
  } else {
    ({ solid, report } = await buildSolidRobust(intent));
  }
  let out = solid;
  const importNotes = [];
  // Phase6(260718): 선택 필렛 — 생성 솔리드 전체 에지에 반경 filletMm.
  // 복잡 융합 솔리드에서 OCCT 필렛은 실패할 수 있음 → 실패 시 무필렛 정직 폴백(노트).
  if (filletMm > 0) {
    try {
      out = out.fillet(filletMm);
      importNotes.push(`필렛 r${filletMm} 적용`);
    } catch (e) {
      importNotes.push(`필렛 실패(${String(e?.message ?? e).slice(0, 50)}) — 무필렛 폴백(정직)`);
    }
  }
  if (imports.length) {
    const { importSTEP, compoundShapes } = await ensureReplicad();
    const shapes = [out];
    for (const im of imports) {
      try {
        const buf = readFileSync(im.file);
        const shp = await importSTEP(new Blob([buf]));
        const [dx, dy, dz] = im.offset ?? [0, 0, 0];
        shapes.push(shp.translate(dx, dy, dz));
        importNotes.push(`${im.file.split(/[\/]/).pop()}: 병합(원기하 무손실)`);
      } catch (e) {
        importNotes.push(`${im.file.split(/[\/]/).pop()}: 병합 실패(${String(e?.message ?? e).slice(0, 60)}) — box 근사만 유지`);
      }
    }
    if (shapes.length > 1) out = compoundShapes(shapes);
  }
  const step = await out.blobSTEP().text();
  return { step, entities: (step.match(/^#\d+/gm) ?? []).length, fuseReport: report, importNotes };
}

/**
 * 스테이션 실루엣 프로파일(§12.4 위치 특정) — 각 축 N스테이션에서 단면 실루엣의
 * 수직 2방향 폭을 에지-평면 교차 샘플링으로 측정. 정점 비닝만 하면 긴 삼각형
 * (박스 옆면 등)을 놓치므로 반드시 에지 교차로 잰다. 결정론 — 클라(드래프트)와 동일 수학.
 * @param {Float32Array|number[]} v 정점(x,y,z…)
 * @param {Uint32Array|number[]|null} triIdx 삼각형 인덱스(null=비인덱스 9float/tri)
 */
export function stationProfiles(v, triIdx, N = 24) {
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let a = 0; a < 3; a++) { const x = v[i + a]; if (x < mins[a]) mins[a] = x; if (x > maxs[a]) maxs[a] = x; }
  }
  const out = [];
  for (const [A, U, W] of [[0, 1, 2], [1, 0, 2], [2, 0, 1]]) {
    const lo = mins[A], range = (maxs[A] - lo) || 1;
    const minU = new Array(N).fill(Infinity), maxU = new Array(N).fill(-Infinity);
    const minW = new Array(N).fill(Infinity), maxW = new Array(N).fill(-Infinity);
    const edge = (p, q) => {
      const a0 = v[p + A], a1 = v[q + A];
      const sLo = ((Math.min(a0, a1) - lo) / range) * N - 0.5, sHi = ((Math.max(a0, a1) - lo) / range) * N - 0.5;
      for (let s = Math.max(0, Math.ceil(sLo)); s <= Math.min(N - 1, Math.floor(sHi)); s++) {
        const station = lo + ((s + 0.5) / N) * range;
        const denom = a1 - a0;
        const t = Math.abs(denom) < 1e-12 ? 0 : (station - a0) / denom;
        if (t < -1e-9 || t > 1 + 1e-9) continue;
        const u = v[p + U] + t * (v[q + U] - v[p + U]);
        const w = v[p + W] + t * (v[q + W] - v[p + W]);
        if (u < minU[s]) minU[s] = u; if (u > maxU[s]) maxU[s] = u;
        if (w < minW[s]) minW[s] = w; if (w > maxW[s]) maxW[s] = w;
      }
    };
    if (triIdx) {
      for (let i = 0; i < triIdx.length; i += 3) {
        const a = triIdx[i] * 3, b = triIdx[i + 1] * 3, c = triIdx[i + 2] * 3;
        edge(a, b); edge(b, c); edge(c, a);
      }
    } else {
      for (let i = 0; i + 8 < v.length; i += 9) { edge(i, i + 3); edge(i + 3, i + 6); edge(i + 6, i); }
    }
    out.push({
      axis: 'xyz'[A],
      w1: minU.map((m, s) => (m === Infinity ? 0 : +(maxU[s] - m).toFixed(3))),
      w2: minW.map((m, s) => (m === Infinity ? 0 : +(maxW[s] - m).toFixed(3))),
    });
  }
  return out;
}

/**
 * 선언 치수 전수 감사(§7 치수 diff의 exact 절반, 2026-07-16) — intent의 모든 회전체
 * 치수(지름·개수·무회전 축위치)를 기록 B-rep의 면에서 실측 대조한다.
 * 실측 = replicad Face: geomType('CYLINDRE'/'SPHERE') + AABB(원통 면은 w=h=지름이
 * OCCT 정확값 — face-probe 실증 2026-07-16). 좌표 회전·원형 패턴 피처는 축위치 대조를
 * 생략하고 그렇다고 표기한다(정직). 평면 외형은 AABB 3축 대조(기존)가 담당.
 */
export function auditDims(intent, solid) {
  const TOL_D = 0.01, TOL_P = 0.01; // B-rep exact — 이탈은 방출 버그
  // ① 실측: 원통·구 면 수집
  const measured = [];
  for (const f of solid.faces) {
    try {
      const g = f.geomType;
      if (g !== 'CYLINDRE' && g !== 'SPHERE') continue;
      const bb = f.boundingBox;
      const w = Number(bb.width), h = Number(bb.height), dep = Number(bb.depth);
      const c = bb.center;
      const cx = Number(c[0] ?? c.x), cy = Number(c[1] ?? c.y);
      if (g === 'SPHERE') { measured.push({ kind: 'sph', d: Math.max(w, h, dep), cx, cy }); continue; }
      // 축 정렬 원통은 세 치수 중 같은 두 개 = 지름. 비정렬은 가까운 페어 평균(근사).
      const dims = [w, h, dep].sort((a, b) => a - b);
      const d = Math.abs(dims[0] - dims[1]) <= Math.abs(dims[1] - dims[2])
        ? (dims[0] + dims[1]) / 2 : (dims[1] + dims[2]) / 2;
      measured.push({ kind: 'cyl', d, cx, cy });
    } catch { /* 면 1개 실측 실패가 전체 감사를 막지 않음 */ }
  }
  // ② 선언: cylinder/sphere 피처(패턴 전개 반영 — 회전 인스턴스는 위치 대조 생략)
  const declared = [];
  for (const f of intent.features ?? []) {
    const n = f.pattern?.type === 'circular' && f.pattern.count > 1 ? f.pattern.count : 1;
    const rotated = !!(f.at?.rotate && f.at.rotate.some((r) => r)) || n > 1;
    if (f.kind === 'cylinder' && Number.isFinite(f.diameter)) {
      for (let k = 0; k < n; k++) {
        declared.push({
          kind: 'cyl', d: f.diameter, rotated,
          expect: !rotated ? { x: f.at?.translate?.[0] ?? 0, y: f.at?.translate?.[1] ?? 0 } : null,
          label: `Ø${f.diameter} ${f.op === 'subtract' ? (n > 1 ? `hole ${k + 1}/${n}` : 'hole') : 'boss'}`,
        });
      }
    } else if (f.kind === 'sphere' && Number.isFinite(f.diameter)) {
      for (let k = 0; k < n; k++) declared.push({ kind: 'sph', d: f.diameter, rotated, expect: null, label: `SØ${f.diameter}` });
    }
  }
  // ③ 그리디 매칭 — 지름(±0.01) 그리고 가능하면 축위치(±0.01)까지
  const used = new Set();
  const rows = [];
  for (const dec of declared) {
    let hit = -1;
    for (let i = 0; i < measured.length; i++) {
      if (used.has(i)) continue;
      const m = measured[i];
      if (m.kind !== dec.kind || Math.abs(m.d - dec.d) > TOL_D) continue;
      if (dec.expect && (Math.abs(m.cx - dec.expect.x) > TOL_P || Math.abs(m.cy - dec.expect.y) > TOL_P)) continue;
      hit = i; break;
    }
    if (hit >= 0) {
      used.add(hit);
      rows.push({ label: dec.label, declared: dec.d, measured: +measured[hit].d.toFixed(4), pos: dec.expect ? 'ok' : 'skipped(rot/pattern)', pass: true });
    } else {
      const dOnly = measured.findIndex((m, i) => !used.has(i) && m.kind === dec.kind && Math.abs(m.d - dec.d) <= TOL_D);
      rows.push({ label: dec.label, declared: dec.d, measured: dOnly >= 0 ? +measured[dOnly].d.toFixed(4) : null, pos: dOnly >= 0 ? 'POS-MISMATCH' : 'MISSING', pass: false });
    }
  }
  return {
    rows,
    declaredCount: declared.length,
    measuredCount: measured.length,
    extraFaces: measured.length - used.size, // 선언 외 회전체 면(불리언 파생 등) — 정보 표기
    note: '지름 ±0.01mm · 무회전 피처만 축위치 대조(회전·패턴은 지름·개수만) · 평면 외형은 AABB 3축이 담당',
  };
}

/**
 * intent → 기록 커널(OCCT) 실측 — §8-③ 역투영 diff 채점기의 '기록' 쪽 절반.
 * B-rep을 메시화해 AABB·부피·스테이션 프로파일 + 치수 전수 감사(auditDims)를 반환.
 * 드래프트(SCAD→WASM 메시, 클라 실측)와 같은 수학으로 재어 공정 비교가 되게 한다.
 */
/**
 * 메시 연결성 → 분리 덩어리(lump) 수. lumps>1 = 허공에 뜬 부품/미접합 배관 —
 * "실제 제작 불가능" 신호(부유 감지). 정점을 0.01mm 격자로 합치고 union-find.
 * ⚠️ 내부 공동(subtract로 파묻힌 보이드)의 표면도 별도 셸로 잡히므로, lump별
 * 부호 부피를 계산해 음수(공동)는 제외하고 양수 덩어리만 센다(위시빌더 실증 260717).
 */
export function meshLumps(v, triIdx) {
  const key = new Map(); const id = [];
  for (let i = 0; i < v.length; i += 3) {
    const k = `${Math.round(v[i] * 100)},${Math.round(v[i + 1] * 100)},${Math.round(v[i + 2] * 100)}`;
    let g = key.get(k);
    if (g === undefined) { g = key.size; key.set(k, g); }
    id.push(g);
  }
  const parent = Array.from({ length: key.size }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const tri = triIdx ?? Array.from({ length: id.length }, (_, i) => i);
  for (let i = 0; i < tri.length; i += 3) { uni(id[tri[i]], id[tri[i + 1]]); uni(id[tri[i + 1]], id[tri[i + 2]]); }
  const vol = new Map(); // root → 부호 부피 합(∑ v·(a×b)/6)
  const P = (idx) => { const j = tri[idx] * 3; return [v[j], v[j + 1], v[j + 2]]; };
  for (let i = 0; i < tri.length; i += 3) {
    const a = P(i), b = P(i + 1), c = P(i + 2);
    const s = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const r = find(id[tri[i]]);
    vol.set(r, (vol.get(r) ?? 0) + s / 6);
  }
  let n = 0;
  for (const s of vol.values()) if (s > 1) n++; // 양수(실체)만 — 음수=내부 공동
  return n;
}

export async function intentToRecordMeasure(intent) {
  const { solid, report } = await buildSolidRobust(intent);
  return measureFromSolid(intent, solid, report);
}

/**
 * 실측+STEP을 한 번의 B-rep 빌드로 — 같은 프로세스에서 buildSolidRobust를 두 번 돌리면
 * (실측→STEP) 대형 조립체에서 wasm 메모리 고갈로 STEP이 abort한다(위시빌더 253피처 실측).
 */
export async function intentToStepAndMeasure(intent) {
  const { solid, report } = await buildSolidRobust(intent);
  const measure = measureFromSolid(intent, solid, report);
  const step = await solid.blobSTEP().text();
  return { step, entities: (step.match(/^#\d+/gm) ?? []).length, fuseReport: report, measure };
}

function measureFromSolid(intent, result, fuseReport) {
  let dims = null;
  try { dims = auditDims(intent, result); } catch { /* 감사 실패는 다른 측정을 막지 않음(정직: null) */ }
  const m = result.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const v = m.vertices, tri = m.triangles;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (v[i] < minX) minX = v[i]; if (v[i] > maxX) maxX = v[i];
    if (v[i + 1] < minY) minY = v[i + 1]; if (v[i + 1] > maxY) maxY = v[i + 1];
    if (v[i + 2] < minZ) minZ = v[i + 2]; if (v[i + 2] > maxZ) maxZ = v[i + 2];
  }
  let vol6 = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] * 3, b = tri[i + 1] * 3, c = tri[i + 2] * 3;
    const ax = v[a], ay = v[a + 1], az = v[a + 2];
    const bx = v[b], by = v[b + 1], bz = v[b + 2];
    const cx = v[c], cy = v[c + 1], cz = v[c + 2];
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return {
    bbox: { x: +(maxX - minX).toFixed(3), y: +(maxY - minY).toFixed(3), z: +(maxZ - minZ).toFixed(3) },
    volume: +Math.abs(vol6 / 6).toFixed(1),
    triangles: tri.length / 3,
    profiles: stationProfiles(v, tri),
    dims,
    // 제작 가능성 신호: lumps>1 = 허공 부품/미접합(부유) · fuseReport.dropped = 융합 제외분(정직 고지)
    lumps: meshLumps(v, tri),
    fuseReport: { total: fuseReport.total, fused: fuseReport.total - fuseReport.dropped.length, jittered: fuseReport.jittered, dropped: fuseReport.dropped },
  };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('to-step.mjs');
if (isMain && process.argv[2]) {
  const intent = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const { step, entities } = await intentToStep(intent);
  const out = process.argv[3] ?? 'part.step';
  writeFileSync(out, step);
  console.log('written', out, (step.length / 1024).toFixed(1) + 'KB, entities', entities);
}
