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
