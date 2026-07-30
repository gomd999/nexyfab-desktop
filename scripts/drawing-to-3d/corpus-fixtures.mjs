/**
 * corpus-fixtures.mjs — 표준 시험 파일을 **검증 픽스처**로 쓰는 로컬 전용 하네스 (260729).
 *
 * ⚠️ 코퍼스는 **로컬 전용·라이선스 제한**이다. 이 파일은 경로를 읽을 뿐 **어떤 파일도
 *    저장소로 복사하지 않는다.** 리포에 남는 것은 「무엇을 대조했는가」와 결과 수치뿐이다.
 *    코퍼스가 없으면 **정직하게 skip** 한다 — 「통과」가 아니다.
 *
 * 왜 이 두 묶음인가:
 *   - NIST-PMI(33) = 미국 NIST 의 CAD 상호운용 **표준 시험 파일**. 같은 부품이
 *     AP203(기하만) · AP203+PMI · AP242 세 형식으로 들어 있다.
 *   - Sample-Test-Files(23) = buildingSMART **import-certification** 세트. PCERT 씬 9종이
 *     IFC 4.0.2.1 과 IFC 4.3.2.0 **양쪽에 같은 이름**으로 들어 있다.
 *
 * 핵심: 두 묶음 다 **정답 수치를 지어낼 필요가 없다.** 같은 대상의 다른 표현끼리
 * 대조하면 되기 때문이다(교차형식 일치). 이것이 코퍼스를 「템플릿 재료」가 아니라
 * 「검증 픽스처」로 써야 하는 이유다 — 빈도 편향(상위 3개 기증자 57.4%)과 무관하다.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ROOT = 'C:/Users/gomd9/Downloads/참고파일들/참고파일들';

/** 코퍼스 루트 — 없으면 null(호출측이 skip). 환경변수로 재지정 가능. */
export function corpusRoot() {
  const r = process.env.NEXYFAB_CAD_CORPUS || DEFAULT_ROOT;
  return existsSync(r) ? r : null;
}

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(name)) out.push(p);
  }
  return out;
}

/**
 * NIST-PMI 파일을 **부품 단위**로 묶는다.
 * 파일명 규약: nist_<ctc|ftc|stc>_<NN>_asme1_<변형>.stp — 앞 3토막이 같으면 같은 부품이다.
 */
export function nistParts(root = corpusRoot()) {
  if (!root) return null;
  const files = walk(join(root, 'NIST-PMI'), (n) => /\.(stp|step)$/i.test(n));
  const byPart = new Map();
  for (const f of files) {
    const base = f.replaceAll('\\', '/').split('/').pop();
    const m = base.match(/^(nist_[a-z]{3}_\d{2})_/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!byPart.has(key)) byPart.set(key, []);
    byPart.get(key).push(f);
  }
  return byPart;
}

/** buildingSMART PCERT 씬 — 스키마 버전별로 같은 이름의 파일을 짝짓는다. */
export function pcertScenes(root = corpusRoot()) {
  if (!root) return null;
  const files = walk(join(root, 'Sample-Test-Files'), (n) => /\.ifc$/i.test(n));
  const byScene = new Map();
  for (const f of files) {
    const norm = f.replaceAll('\\', '/');
    if (!norm.includes('PCERT-Sample-Scene')) continue;
    const scene = norm.split('/').pop().replace(/\.ifc$/i, '');
    const ver = /4\.3\.2\.0|IFC4X3/i.test(norm) ? 'ifc4x3' : 'ifc4';
    if (!byScene.has(scene)) byScene.set(scene, {});
    byScene.get(scene)[ver] = f;
  }
  return byScene;
}

/** ISO Spec ReferenceView 개별 파일(형상 표현 커버리지) — 짝이 없는 단독 픽스처. */
export function refViewFiles(root = corpusRoot()) {
  if (!root) return null;
  return walk(join(root, 'Sample-Test-Files'), (n) => /\.ifc$/i.test(n))
    .filter((f) => f.replaceAll('\\', '/').includes('ReferenceView'));
}

/**
 * STEP 파일 1개 → 실측치. importSTEP 실패는 그대로 던진다(호출측이 이름과 함께 기록).
 *
 * 부피는 **OCCT B-rep 정확값**(`measureVolume` = GProp_VolumeProperties)이다.
 * 처음엔 메시 발산정리로 쟀는데, 그러면 테셀레이션 밀도가 값에 섞여 들어가
 * 「형식 간 차이」와 「메시 밀도 차이」를 구분할 수 없다 — 대조의 의미가 사라진다.
 * 삼각형 수는 참고로만 남긴다.
 */
export async function measureStepFile(file, ensureReplicad, readFileSync) {
  const rc = await ensureReplicad();
  const shp = await rc.importSTEP(new Blob([readFileSync(file)]));
  const bb = shp.boundingBox;
  const [mn, mx] = [bb.bounds[0] ?? bb.bounds.slice(0, 3), bb.bounds[1] ?? bb.bounds.slice(3, 6)];
  const m = shp.mesh({ tolerance: 0.05, angularTolerance: 15 });
  return {
    volumeMm3: Math.abs(rc.measureVolume(shp)),
    size: [0, 1, 2].map((k) => +(mx[k] - mn[k]).toFixed(3)),
    faces: shp.faces?.length ?? null,
    triangles: m.triangles.length / 3,
  };
}

/**
 * STEP 분류기 커버리지 측정 (260801) — **측정도 코드다.**
 *
 * ## 왜 리포에 두는가
 * 「부품 어휘를 늘리면 임포트가 나아지는가」를 물었고, 답은 **아니오**였다. 임시 스크립트로
 * 한 번 재고 버리면 다음 세션이 같은 착각을 반복한다(`domain-audit.mjs` 를 만든 이유와 같다).
 *
 * ## 260801 실측 결과 — 축 제약은 병목이 아니었다
 * 코퍼스 STEP 35건(8MB 미만) 전수:
 *   · 바디 있음 **0** · 없음 35
 *   · 미지원 사유 1위 **`non-linear edge (CIRCLE)` 61건** — 면의 엣지가 원호다
 *     (필렛·모서리 라운드·원형 개구). 2위 `no FACE_OUTER_BOUND` 9 · 3위 `B_SPLINE` 6.
 *   · 축 제약(±Z 캡만 허용)에 걸린 것은 **1건**뿐이었다.
 *
 * → 프리즘 검출기를 3축으로 넓힌 것은 **옳은 수정이지만 코퍼스 커버리지를 바꾸지 않는다.**
 *   다음 이득은 **원호 엣지**에 있다(선형 근사 + 근사 사실 고지, 또는 OCCT 경로).
 *   이 사실을 적어 두지 않으면 「어휘를 더 늘리자」로 돌아가게 된다.
 *
 * @param {(s:string)=>{nodes?:unknown[],unsupported?:string[]}} importStep 임포터
 * @param {(p:string,e?:string)=>string} readFileSync
 * @param {{root?:string,limit?:number,maxBytes?:number}} [opt]
 * @returns {{files:number,measured:number,withBodies:number,noBodies:number,bodies:number,reasons:Array<[string,number]>}|null}
 *   코퍼스가 없으면 **null** — 「측정하지 않았다」이고 「통과」가 아니다.
 */
export function measureClassifierCoverage(importStep, readFileSync, opt = {}) {
  const root = opt.root ?? corpusRoot();
  if (!root) return null;
  const { readdirSync, statSync } = require$fs();
  const maxBytes = opt.maxBytes ?? 8_000_000;
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let ents = [];
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const p = `${dir}/${e}`;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/\.(stp|step)$/i.test(e) && st.size < maxBytes) files.push(p);
    }
  };
  walk(root, 0);
  const measured = files.slice(0, opt.limit ?? 400);
  let withBodies = 0, noBodies = 0, bodies = 0;
  const reasons = {};
  for (const f of measured) {
    let txt = ''; try { txt = readFileSync(f, 'latin1'); } catch { continue; }
    let r = null;
    try { r = importStep(txt); } catch { noBodies++; continue; }
    /**
     * ⚠ 260801c — **이 측정이 틀려 있었다.** `importStep` 은 `{ tree: { nodes }, … }` 를
     *   돌려주는데 `r.nodes` 를 읽어서 **항상 0** 이 나왔다. 그 결과 「코퍼스 바디 0」이라는
     *   보고가 여러 번 나갔고, 원호 근사·프리즘 3축 확장의 효과를 「없다」로 읽었다.
     *   측정 도구를 리포에 고정한 이유가 「기준이 흔들리지 않게」였는데, **고정된 기준이
     *   틀려 있으면 더 나쁘다** — 틀린 값을 계속 같은 방식으로 재게 된다.
     *   교훈: 측정 도구도 **한 번은 반대 방향으로 검증**해야 한다(0 이 나오면 0 이 맞는지).
     */
    const n = r?.tree?.nodes?.length ?? 0;
    if (n > 0) { withBodies++; bodies += n; } else noBodies++;
    for (const u of r?.unsupported ?? []) {
      // 숫자(엔티티 id·면 수)를 N 으로 정규화 — 사유의 **종류**를 센다.
      const key = String(u).replace(/^#\d+:\s*/, '').replace(/\d+/g, 'N').slice(0, 70);
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
  }
  return {
    files: files.length, measured: measured.length, withBodies, noBodies, bodies,
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
  };
}

/** node:fs 를 지연 로드 — 이 모듈은 브라우저 번들에 들어가지 않지만 규약을 지킨다. */
function require$fs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  return { readdirSync: fsMod().readdirSync, statSync: fsMod().statSync };
}
let _fs = null;
function fsMod() {
  if (!_fs) _fs = globalThis.process?.getBuiltinModule?.('node:fs') ?? null;
  if (!_fs) throw new Error('node:fs 를 사용할 수 없다 — 이 측정은 Node 환경 전용이다');
  return _fs;
}
