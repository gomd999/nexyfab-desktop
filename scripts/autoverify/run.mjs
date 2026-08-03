/**
 * run.mjs — **고친 것이 실제로 풀렸는가** (260803, B4-2).
 *
 * `failures.mjs` 는 「무엇이 깨지는지」까지만 알려준다. 이 하네스가 **루프를 닫는다** —
 * 실패 케이스를 다시 태워 4축으로 채점하고, 회귀가 생기면 알린다.
 *
 * ```
 *   node scripts/autoverify/run.mjs                 # 결정론 케이스만(빠름·무료)
 *   node scripts/autoverify/run.mjs --llm           # LLM 케이스 포함(느림·과금)
 *   node scripts/autoverify/run.mjs --json          # 파이프용
 *   node scripts/autoverify/run.mjs --case desk-stand-partial
 * ```
 *
 * ## 4축 채점 — 한 축만 보면 틀린다
 * 이 세션에서 저자가 **`parts:7 · openscad:true` 를 보고 "성공"이라 보고했다가 정정**했다
 * (계획서 §0.8). 팬 블레이드가 빠졌는데도 G1·G2 는 통과였다. 그래서 축을 나눈다:
 * ```
 *   G1 형상   게이트 오류 0                    ← 부품이 성립하는가
 *   G2 조립   designOk (부유·간섭 없음)         ← 서로 닿는가
 *   G3 의도   케이스의 expect 와 대조           ← **요청한 것이 나왔는가** ← 저자가 빠뜨린 축
 *   G4 공학   structural 산출(질량·CG)          ← 검증이 붙는가
 * ```
 *
 * ## ⚠ 정직성 장치 두 개 — 없으면 루프가 스스로를 속인다
 *
 * **① `GATE_TRUE` 를 분모에서 뺀다.**
 * 게이트가 **진짜 설계 오류를 옳게 막은 것**을 실패로 세면
 * **게이트를 느슨하게 만드는 압력**이 생긴다. 케이스에 `expectFail: true` 를 달면
 * 「막히는 것이 정답」이고, 통과해 버리면 **그것이 실패**다. 점수 분모에서 빼고 따로 보고한다.
 *
 * **② 이 하네스는 코드를 고치지 않는다.**
 * 자동 수정을 여기 붙이면 게이트가 자기를 만족시키는 방향으로 침식된다.
 * 출력은 **분류된 실패 목록**이지 커밋이 아니다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, 'cases');
const D2D = join(HERE, '..', 'drawing-to-3d');
/**
 * ⚠ Windows 절대경로는 `import()` 에 그대로 못 넣는다(`ERR_UNSUPPORTED_ESM_URL_SCHEME` —
 * `c:` 를 프로토콜로 읽는다). 리포에 이미 기록된 함정이고 라우트들도 `pathToFileURL` 을 쓴다.
 */
const mod = (name) => import(pathToFileURL(join(D2D, name)).href);

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

/** 실패 유형 버킷 — `failures.mjs` 지문과 같은 어휘를 쓴다(두 벌이면 또 갈린다). */
export const BUCKETS = {
  HINT_MISSING: '어휘 힌트 부재로 오분류',
  VOCAB_MISSING: '표현할 어휘 자체가 없음',
  SCHEMA_DROP: '필수키 누락',
  TEMPLATE_MISS: '아키타입 없음',
  PLACEMENT: '배치 실패(부유·간섭)',
  KERNEL_FAIL: '부울/커널 실패',
  GATE_TRUE: '게이트가 옳게 막음 — 실패가 아니다',
  INTENT_MISS: '형상은 나왔으나 요청과 다름',
};

/** 오류 문구 → 버킷. 모르면 null 을 낸다 — **지어내지 않는다.** */
export function classify({ gateErrors = [], designOk, intentMiss = [], dropped = [] }) {
  const all = [...gateErrors, ...dropped.map((d) => d.errors?.[0] ?? '')].join(' ');
  if (intentMiss.length) return 'INTENT_MISS';
  if (/미등록|unknown kind|no gate/.test(all)) return 'VOCAB_MISSING';
  if (/없음 — |invalid\b|필수/.test(all)) return 'SCHEMA_DROP';
  if (/washer 로 바꿔라|slab_with_openings/.test(all)) return 'HINT_MISSING';
  if (/OCCT|부울|fillet|커널/.test(all)) return 'KERNEL_FAIL';
  if (designOk === false) return 'PLACEMENT';
  return null;
}

function loadCases() {
  let files = [];
  try { files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')); } catch { return []; }
  const only = flag('case', null);
  return files
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')) }))
    .filter((c) => !only || c.id === only);
}

/** 케이스 하나 채점. **LLM 을 부르지 않는 경로가 기본**이다. */
export async function scoreCase(c, mods) {
  const { resolveAssembly } = mods.autoFix;
  const { buildAssembly, autoPlaceCorrect } = mods.assembly;

  let assembly = c.input;
  let dropped = [];
  if (c.kind === 'text') {
    const r = await mods.fromText.textToAssembly(c.input);
    assembly = r.assembly; dropped = r.dropped ?? [];
  } else {
    const r = resolveAssembly(c.input, { drop: true });
    assembly = r.assembly; dropped = r.dropped;
  }
  const placed = autoPlaceCorrect(assembly);
  const built = buildAssembly(placed.assembly);
  const parts = assembly?.parts ?? [];

  // ── G3 의도: 케이스가 요구한 것이 실제로 나왔는가 ──────────────────────────
  const e = c.expect ?? {};
  const intentMiss = [];
  if (typeof e.minParts === 'number' && parts.length < e.minParts) {
    intentMiss.push(`부품 ${parts.length} < 요구 ${e.minParts}`);
  }
  for (const [type, n] of Object.entries(e.partTypes ?? {})) {
    const got = parts.filter((p) => p?.type === type).length;
    if (got < n) intentMiss.push(`${type} ${got}개 < 요구 ${n}개`);
  }
  for (const id of e.mustKeep ?? []) {
    if (!parts.some((p) => String(p?.id) === id)) intentMiss.push(`부품 '${id}' 가 사라짐`);
  }
  if (typeof e.maxDropped === 'number' && dropped.length > e.maxDropped) {
    intentMiss.push(`드롭 ${dropped.length} > 허용 ${e.maxDropped}`);
  }

  const g1 = (built.gateErrors ?? []).length === 0;
  const g2 = e.designOk === false ? true : built.designOk !== false;
  const g3 = intentMiss.length === 0;
  const g4 = Number.isFinite(built.structural?.totalMassKg);

  /**
   * ⚠ **정직성 장치 ①** — `expectFail` 케이스는 「막히는 것이 정답」이다.
   *   통과해 버리면 그것이 실패다(게이트가 느슨해졌다는 뜻).
   */
  if (c.expectFail) {
    const blocked = !g1 || dropped.length > 0;
    return {
      id: c.id, title: c.title, gateTrue: true,
      pass: blocked, bucket: blocked ? 'GATE_TRUE' : 'HINT_MISSING',
      detail: blocked ? '게이트가 옳게 막음' : '★막았어야 하는데 통과함 — 게이트가 느슨해졌다',
      axes: { g1, g2, g3, g4 },
    };
  }

  const pass = g1 && g2 && g3 && g4;
  return {
    id: c.id, title: c.title, gateTrue: false, pass,
    bucket: pass ? null : classify({ gateErrors: built.gateErrors ?? [], designOk: built.designOk, intentMiss, dropped }),
    axes: { g1, g2, g3, g4 },
    detail: [
      !g1 && `G1 게이트 ${(built.gateErrors ?? []).length}건`,
      !g2 && `G2 designOk=false (부유 ${built.support?.floating?.length ?? '?'} · 간섭 ${built.interferences?.length ?? '?'})`,
      !g3 && `G3 ${intentMiss.join(' · ')}`,
      !g4 && 'G4 질량 미산출',
    ].filter(Boolean).join(' | ') || 'ok',
    dropped: dropped.length,
  };
}

// ─── main ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('autoverify/run.mjs');
if (isMain) {
  const cases = loadCases().filter((c) => has('llm') || c.kind !== 'text');
  if (!cases.length) { console.log('케이스 없음 (--llm 없이는 text 케이스가 제외된다)'); process.exit(0); }

  const mods = {
    autoFix: await mod('auto-fix.mjs'),
    assembly: await mod('assembly.mjs'),
    fromText: has('llm') ? await mod('from-text.mjs') : null,
  };

  const results = [];
  for (const c of cases) {
    try { results.push(await scoreCase(c, mods)); }
    catch (err) { results.push({ id: c.id, title: c.title, pass: false, bucket: 'KERNEL_FAIL', detail: String(err.message).slice(0, 120), axes: {} }); }
  }

  if (has('json')) { console.log(JSON.stringify({ results }, null, 2)); process.exit(0); }

  // ⚠ 정직성 장치 ① — GATE_TRUE 는 **분모에서 뺀다.** 별도로 보고한다.
  const scored = results.filter((r) => !r.gateTrue);
  const guards = results.filter((r) => r.gateTrue);
  const passed = scored.filter((r) => r.pass).length;

  console.log('\n케이스 채점 [G1 형상 · G2 조립 · G3 의도 · G4 공학]\n');
  for (const r of results) {
    const ax = ['g1', 'g2', 'g3', 'g4'].map((k) => (r.axes?.[k] ? k.toUpperCase() : '··')).join(' ');
    console.log(`${r.pass ? '✔' : '✘'} ${String(r.id).padEnd(28)} ${ax}  ${r.detail}`);
  }
  console.log(`\n점수 ${passed}/${scored.length}  (게이트 가드 ${guards.filter((g) => g.pass).length}/${guards.length} — 분모 제외)`);

  const fails = scored.filter((r) => !r.pass);
  if (fails.length) {
    const byBucket = {};
    for (const f of fails) (byBucket[f.bucket ?? '미분류'] ??= []).push(f.id);
    console.log('\n실패 유형:');
    for (const [b, ids] of Object.entries(byBucket)) console.log(`  ${b.padEnd(16)} ${BUCKETS[b] ?? ''} — ${ids.join(', ')}`);
    console.log('\n⚠ 이 하네스는 코드를 고치지 않는다. 규칙으로 고칠 수 있으면 auto-fix.mjs RULES 에 사람이 추가한다.');
  }
  const brokenGuards = guards.filter((g) => !g.pass);
  if (brokenGuards.length) console.log(`\n★★ 게이트 가드 ${brokenGuards.length}건 붕괴 — 막았어야 할 것이 통과했다: ${brokenGuards.map((g) => g.id).join(', ')}`);
  process.exit(fails.length || brokenGuards.length ? 1 : 0);
}
