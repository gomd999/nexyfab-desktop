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

/** intent → STEP 문자열 (B-rep). 게이트 통과분만. */
export async function intentToStep(intent) {
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
  const step = await result.blobSTEP().text();
  return { step, entities: (step.match(/^#\d+/gm) ?? []).length };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('to-step.mjs');
if (isMain && process.argv[2]) {
  const intent = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const { step, entities } = await intentToStep(intent);
  const out = process.argv[3] ?? 'part.step';
  writeFileSync(out, step);
  console.log('written', out, (step.length / 1024).toFixed(1) + 'KB, entities', entities);
}
