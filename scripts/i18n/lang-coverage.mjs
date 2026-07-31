/**
 * lang-coverage.mjs — **6언어를 다 넣었는가**를 기계로 센다 (260802).
 *
 * ## 왜 리포에 두는가
 * `src/lib/i18n/normalize.ts` 에 규칙이 이미 적혀 있다:
 * > "Do not add user-visible strings for only English and Korean — ship every feature
 * >  with six entries or block the PR."
 *
 * 그런데 **지키는 장치가 없었다.** 실측(260802): `ko`+`en` 사전을 가진 파일 중 **95건**이
 * 6언어 미완이었고, 그중 정책 6페이지는 `es`·`ar` 이 `langMap` 에서 `'en'` 으로 고정돼
 * **개인정보·환불·보안 정책이 스페인어·아랍어 사용자에게 영어로 나가고 있었다**
 * (라이브 실측: es↔en 단어일치 72~80% · ar↔en 83~90% · 아랍 문자 비율 12~20%).
 *
 * 문서에만 있는 규칙은 매번 사람이 census 를 다시 돌려야 한다. **기준선을 박고 회귀로 잠근다.**
 *
 * ## ⚠ 이것은 휴리스틱이다 — 그 사실을 숨기지 않는다
 * 파일 안에 `ko:`/`en:` 같은 **키가 보이는지**로 사전을 판별한다. 그래서
 *  · 다른 방식으로 지역화하는 파일은 **안 잡힐 수 있고**(과소),
 *  · `ko` 라는 이름의 무관한 키가 있으면 **잘못 잡힐 수 있다**(과대).
 * 그러므로 이 수를 「미번역 화면 수」라고 부르지 않는다. **「규칙 밖에 있는 파일 수」**다.
 * 회귀도 절대값이 아니라 **목록 대비 증가**만 막는다 — 새 파일이 규칙을 어기는 것을 잡는 것이
 * 목적이고, 기존 부채를 언제 갚을지는 별도 결정이다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 6언어 — `SUPPORTED_LANGS`(라우트)와 `ROUTE_TO_ISO`(사전 키) 양쪽 표기를 허용한다. */
const NEEDED = [
  ['ko', 'kr'],
  ['en'],
  ['ja'],
  ['zh', 'cn'],
  ['es'],
  ['ar'],
];

/**
 * `{ ko: …` / `, en: …` 처럼 **객체 키로 쓰인 것**을 센다.
 *
 * ⚠ 260802 실측 — 사각지대가 있었다. `partner/_lib/dicts/*` 17개는 언어를 객체 키가 아니라
 *   **`const KO: LoginDict = {…}`** 형태로 둔다. 처음 스캐너는 이걸 못 봐서 파트너 구역
 *   **17개 사전이 통째로 측정 밖**에 있었고, 나는 「커버리지를 모른다」고 보고했다.
 *   직접 세어 보니 **17개 전부 6/6 완비**였다.
 *   못 본 것을 「없다」로 읽지 않으려면 **측정 도구의 사각지대를 먼저 의심해야 한다.**
 */
const hasKey = (src, key) => (
  new RegExp(`(^|[\\s{,])${key}\\s*:`).test(src)
  // `const KO: XDict = {` · `const AR = {` — 파트너 포털이 쓰는 방식
  || new RegExp(`\\bconst\\s+${key.toUpperCase()}\\s*[:=]`).test(src)
);
const hasAny = (src, keys) => keys.some((k) => hasKey(src, k));

/** `src` 아래 모든 `.ts`/`.tsx`(테스트 제외). */
export function listSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (e !== 'node_modules') walk(p); }
      else if (/\.tsx?$/.test(e) && !/\.test\./.test(e)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * 언어 사전을 가진 파일 중 **6언어 미완**인 것을 찾는다.
 *
 * @returns `[{ file, missing: ['es','ar'] }]` — `file` 은 `src/` 기준 상대경로(슬래시)
 */
export function findIncompleteLangFiles(root) {
  const rows = [];
  for (const f of listSourceFiles(root)) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    // 사전으로 보이지 않으면 대상이 아니다 — ko 와 en 이 둘 다 있어야 「사전」으로 본다.
    if (!hasAny(src, NEEDED[0]) || !hasAny(src, NEEDED[1])) continue;
    const missing = NEEDED.filter((keys) => !hasAny(src, keys)).map((keys) => keys[0]);
    if (!missing.length) continue;
    rows.push({ file: f.slice(root.length + 1).split(String.fromCharCode(92)).join('/'), missing });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));
  return rows;
}
