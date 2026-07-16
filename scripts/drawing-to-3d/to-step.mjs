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

/** intent → replicad Solid (게이트 통과분만). intentToStep/intentToRecordMeasure 공용. */
async function buildSolid(intent) {
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
 * intent → 기록 커널(OCCT) 실측 — §8-③ 역투영 diff 채점기의 '기록' 쪽 절반.
 * B-rep을 메시화해 AABB·부피를 결정론으로 측정한다(부호 사면체 합).
 * 드래프트(SCAD→WASM 메시, 클라 실측)와 같은 수학으로 재어 공정 비교가 되게 한다.
 */
export async function intentToRecordMeasure(intent) {
  const result = await buildSolid(intent);
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
