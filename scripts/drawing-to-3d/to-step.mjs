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
async function ensureReplicad() {
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

/** 단일 피처 → replicad Solid (배치·패턴 전). */
function featSolid(rc, f) {
  switch (f.kind) {
    case 'revolve': {
      // profile [radius,height] — OpenSCAD rotate_extrude와 일치: XZ평면 스케치 후 Z축 회전.
      let pen = rc.draw([f.profile[0][0], f.profile[0][1]]);
      for (let i = 1; i < f.profile.length; i++) pen = pen.lineTo([f.profile[i][0], f.profile[i][1]]);
      return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]);
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
    case 'box': {
      const [w, d, h] = f.size;
      const s = rc.drawRectangle(w, d).sketchOnPlane('XY').extrude(h);
      // replicad drawRectangle는 원점 중심 → OpenSCAD cube(원점 코너)와 맞추려 이동.
      return f.centered ? s.translate([0, 0, -h / 2]) : s.translate([w / 2, d / 2, 0]);
    }
    case 'sphere':
      return rc.makeSphere(f.diameter / 2);
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

/** intent → replicad Solid (게이트 통과분만). intentToStep/intentToRecordMeasure/치수감사 공용. */
export async function buildSolid(intent) {
  const errs = gateComposite(intent);
  if (errs.length) throw new Error('composite gate: ' + errs.join('; '));
  const rc = await ensureReplicad();
  let result = null;
  const subs = [];
  for (const f of intent.features) {
    for (const solid of expand(f, featSolid(rc, f))) {
      if (f.op === 'subtract') subs.push(solid);
      else result = result ? result.fuse(solid) : solid;
    }
  }
  if (!result) throw new Error('to-step: add 피처 없음');
  for (const s of subs) result = result.cut(s);
  return result;
}

/** intent → STEP 문자열 (B-rep). */
export async function intentToStep(intent) {
  const result = await buildSolid(intent);
  const step = await result.blobSTEP().text();
  return { step, entities: (step.match(/^#\d+/gm) ?? []).length };
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
export async function intentToRecordMeasure(intent) {
  const result = await buildSolid(intent);
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
