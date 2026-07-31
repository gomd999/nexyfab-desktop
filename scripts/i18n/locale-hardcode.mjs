/**
 * locale-hardcode.mjs — **날짜·숫자가 언어를 따라가는가** (260802).
 *
 * ## 왜 별도 스캐너인가
 * 사전 커버리지(`lang-coverage.mjs`)로는 이게 안 잡힌다 — **사전이 아니기 때문**이다.
 * 실측: `toLocaleDateString('ko-KR')` 하드코딩 **135곳**, `isKo ? 'ko-KR' : 'en-US'` **24곳**.
 * 사이트가 6언어로 돌아도 **날짜와 숫자는 언제나 한국 형식**으로 나오고 있었다.
 *
 * 「번역이 끝났다」고 말하려면 사전만 봐서는 안 된다 — **무엇을 안 세고 있는지**를
 * 먼저 알아야 한다(이 세션에서 파트너 포털 17개를 통째로 못 본 것과 같은 교훈).
 *
 * ## ⚠ 전부가 결함은 아니다
 * 서버 로그·파일명·CSV 헤더처럼 **사용자 언어와 무관해야 하는 자리**도 있다.
 * 그래서 이 수를 「결함 수」라 부르지 않는다 — **「언어를 안 따라가는 자리 수」**다.
 * 판단은 사람이 하고, 이 목록은 **늘지 않게** 잠근다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SEP = String.fromCharCode(92);

/** 로케일을 박아 넣은 자리. */
const PATTERNS = [
  // toLocaleDateString('ko-KR') / toLocaleString("ja-JP") …
  /toLocale(?:Date|Time|)String\(\s*['"][a-z]{2}(?:-[A-Za-z]{2,4})?['"]/g,
  // new Intl.XxxFormat('ko-KR')
  /new\s+Intl\.\w+\(\s*['"][a-z]{2}(?:-[A-Za-z]{2,4})?['"]/g,
  // isKo ? 'ko-KR' : 'en-US'  ·  lang === 'ko' ? 'ko-KR' : 'en-US'
  /\?\s*['"][a-z]{2}-[A-Za-z]{2,4}['"]\s*:\s*['"][a-z]{2}-[A-Za-z]{2,4}['"]/g,
];

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

/** @returns `[{ file, hits }]` — `hits` 는 그 파일에서 잡힌 자리 수 */
export function findHardcodedLocales(root) {
  const rows = [];
  for (const f of listSourceFiles(root)) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    let hits = 0;
    for (const re of PATTERNS) hits += (src.match(re) ?? []).length;
    if (!hits) continue;
    rows.push({ file: f.slice(root.length + 1).split(SEP).join('/'), hits });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));
  return rows;
}
