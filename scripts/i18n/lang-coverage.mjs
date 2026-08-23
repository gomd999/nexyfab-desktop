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
 *
 * ## ⚠ 이 수는 **하한**이다 — 안 세는 부채 형태가 있다
 * 260802 2차 실측에서 이런 것들이 나왔다:
 * ```
 * function t(lang, ko: string, en: string) { return lang === 'ko' ? ko : en; }   // quotePrinter
 * const T = (ko: string, en: string) => (isKo ? ko : en);                        // StudioSidebar
 * ```
 * **사전이 아니라 2언어 분기 헬퍼**다. 그 자체가 「ko/en 만 지원」이라는 부채인데
 * 사전 스캐너로는 잡히지 않는다(잡으면 타입 선언까지 딸려 온다).
 * 그래서 이 목록은 **총량이 아니라 하한**으로 읽어야 한다.
 * 회귀도 절대값이 아니라 **목록 대비 증가**만 막는다 — 새 파일이 규칙을 어기는 것을 잡는 것이
 * 목적이고, 기존 부채를 언제 갚을지는 별도 결정이다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

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
  // ⚠ 260802 2차 — **값이 문자열인지까지 본다.** 처음엔 `ko:` 만 보고 셌더니
  //   `const byLang = { ko: { passed: 0, total: 0 }, en: {…} }` 같은 **카운터**가
  //   사전으로 잡혔다(`__evals__/scad-intent-evalset.ts` 117키). 부채 목록에 가짜가
  //   섞이면 그 수는 계획의 근거가 못 된다.
  new RegExp(`(^|[\\s{,])${key}\\s*:\\s*['"\`]`).test(src)
  // 배열 사전(`ko: ['프로젝트 3개', …]`) — 첫 원소가 문자열이어야 한다.
  //   ⚠ 이걸 빠뜨렸다가 `NexyfabLandingClient.tsx`(171키) 같은 **진짜 사전을 놓쳤다.**
  //   오탐을 줄이려다 누락을 만들면 부채가 있는데 없다고 읽힌다 — 더 나쁘다.
  || new RegExp(`(^|[\\s{,])${key}\\s*:\\s*\\[\\s*['"\`]`).test(src)
  // 중첩 사전(`ko: { title: '…' }`) — 여는 괄호 뒤에 **따옴표 값**이 있어야 사전이다.
  || new RegExp(`(^|[\\s{,])${key}\\s*:\\s*\\{[^}]{0,400}?:\\s*['"\`]`, 's').test(src)
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
/**
 * 부채가 **아닌** 것 — 이유와 함께 적어 둔다.
 *
 * ⚠ 오탐을 부채 목록에 남겨 두면 그 수가 계획의 근거가 못 된다. 그렇다고 스캐너에서
 *   조용히 빼면 「왜 안 세는지」가 사라진다. 그래서 **파일에 이유를 적고** 제외한다.
 */
function loadExceptions() {
  try {
    const raw = readFileSync(new URL('./lang-coverage-exceptions.json', import.meta.url), 'utf8');
    return new Set(JSON.parse(raw).map((x) => String(x.file)));
  } catch { return new Set(); }
}

export function findIncompleteLangFiles(root) {
  const skip = loadExceptions();
  const rows = [];
  for (const f of listSourceFiles(root)) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    // Commercial pages can keep ko/en source pairs while resolving ja/zh/es/ar
    // from the checked-in, runtime-network-free catalog. That path is verified
    // by commercial-catalog.test.ts, including placeholder and legacy-branch checks.
    if (/@\/lib\/i18n\/(?:commercial|studio)Localizer/.test(src)) continue;
    // 사전으로 보이지 않으면 대상이 아니다 — ko 와 en 이 둘 다 있어야 「사전」으로 본다.
    if (!hasAny(src, NEEDED[0]) || !hasAny(src, NEEDED[1])) continue;
    const missing = NEEDED.filter((keys) => !hasAny(src, keys)).map((keys) => keys[0]);
    if (!missing.length) continue;
    const rel = f.slice(root.length + 1).split(String.fromCharCode(92)).join('/');
    if (skip.has(rel)) continue;
    rows.push({ file: f.slice(root.length + 1).split(String.fromCharCode(92)).join('/'), missing });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));
  return rows;
}

/**
 * ko/en 전용 삼항 분기를 찾는다. 사전 키만 보던 기존 스캐너가 JSX fragment와
 * `const T = (ko, en) => isKo ? ko : en` 헬퍼를 놓친 사각지대를 보완한다.
 * 숫자·스타일·데이터 분기는 제외하고, 양쪽에 문자열/JSX 문구 또는 ko/en 인자가
 * 있는 경우만 사용자 언어 분기 후보로 보고한다.
 */
export function findBinaryLocaleBranches(root) {
  const rows = [];
  for (const file of listSourceFiles(root)) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isConditionalExpression(node)) {
        const condition = node.condition.getText(ast).replaceAll(/\s+/g, ' ');
        const localeCondition = /^!?\s*(?:isKo|ko)\s*$/.test(condition)
          || /\bisKorean\s*\(/.test(condition)
          || /\b(?:lang|locale|language|resolvedLang|normalizedLang|strLang|iso|fam|l|c)\b[^?]{0,80}(?:===|==|!==|!=)[^?]{0,30}['"](?:ko|kr)['"]/.test(condition)
          || /accept-language[^?]{0,80}(?:startsWith|includes)\(\s*['"]ko/.test(condition);
        if (localeCondition) {
          const yes = node.whenTrue.getText(ast);
          const no = node.whenFalse.getText(ast);
          const hasLiteralText = /[가-힣]/.test(`${yes}${no}`)
            || (/['"`][^'"`]*[A-Za-z][^'"`]*['"`]/.test(yes)
              && /['"`][^'"`]*[A-Za-z][^'"`]*['"`]/.test(no));
          const isBinaryHelper = /^(?:\(?\s*)?ko\s*\)?$/.test(yes.trim())
            && /^(?:\(?\s*)?en\s*\)?$/.test(no.trim());
          const aliasNormalization = /^['"]ko['"]$/.test(yes.trim())
            && /\blang\b/.test(no)
            && !/[가-힣]/.test(no);
          const multiLocaleChain = /\b(?:ja|zh|cn|es|ar)\b\s*\?/.test(no)
            || (/\?/.test(no) && /['"](?:ja|zh|cn|es|ar)['"]/.test(no));
          const businessCodePair = /^['"](?:KRW|USD)['"]$/.test(yes.trim())
            && /^['"](?:KRW|USD)['"]$/.test(no.trim());
          if (!aliasNormalization && !multiLocaleChain && !businessCodePair && (hasLiteralText || isBinaryHelper)) {
            rows.push({
              file: file.slice(root.length + 1).split(String.fromCharCode(92)).join('/'),
              line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
              condition,
              whenTrue: yes.length > 240 ? `${yes.slice(0, 237)}...` : yes,
              whenFalse: no.length > 240 ? `${no.slice(0, 237)}...` : no,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** JSX에 직접 박힌 한국어 문구를 찾는다. `loc()`/사전 밖의 단일언어 UI가
 * 이진 분기조차 없이 누락되는 경우를 별도로 잡기 위한 보수적 검사다. */
export function findDirectKoreanJsx(root) {
  const rows = [];
  for (const file of listSourceFiles(root).filter((f) => f.endsWith('.tsx'))) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const add = (node, text) => rows.push({
      file: file.slice(root.length + 1).split(String.fromCharCode(92)).join('/'),
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      text: text.trim().replaceAll(/\s+/g, ' ').slice(0, 180),
    });
    const belongsToKoreanDictionary = (node) => {
      for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
        if (ts.isJsxSelfClosingElement(current) && current.tagName.getText(ast) === 'AdminText') {
          const hasEnglishPair = current.attributes.properties.some((attribute) => (
            ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'en' && attribute.initializer
          ));
          if (hasEnglishPair) return true;
        }
        if (ts.isJsxElement(current)
          && current.openingElement.tagName.getText(ast) === 'option'
          && current.openingElement.attributes.properties.some((attribute) => (
            ts.isJsxAttribute(attribute)
            && attribute.name.getText(ast) === 'value'
            && attribute.initializer
            && ts.isStringLiteral(attribute.initializer)
            && ['ko', 'kr'].includes(attribute.initializer.text)
          ))) return true;
        if (ts.isPropertyAssignment(current)) {
          const name = current.name && (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name))
            ? current.name.text
            : '';
          if (name === 'ko' || name === 'kr') return true;
        }
        if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)
          && /^(?:KO|KR)$/.test(current.name.text)) return true;
      }
      return false;
    };
    const visit = (node) => {
      if (belongsToKoreanDictionary(node)) return;
      if (ts.isJsxText(node) && /[가-힣]/.test(node.text)) add(node, node.text);
      if (ts.isJsxAttribute(node) && !/Ko$/.test(node.name.getText(ast))
        && node.initializer && ts.isStringLiteral(node.initializer)
        && /[가-힣]/.test(node.initializer.text)) add(node, node.initializer.text);
      if (ts.isJsxExpression(node) && node.expression) {
        const e = node.expression;
        if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && /[가-힣]/.test(e.text)) add(node, e.text);
        if (ts.isTemplateExpression(e) && /[가-힣]/.test(e.getText(ast))
          && !/\b(?:loc|L|designPair)\s*\(/.test(e.getText(ast))) add(node, e.getText(ast));
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** URL-encoding Korean UI copy hides it from the AST hardcoding scan and can also
 * make a Korean value masquerade as an English fallback. User-facing source must
 * keep copy as readable literals so the catalog extractor and reviewers can audit it. */
export function findEncodedKoreanLiterals(root) {
  const rows = [];
  for (const file of listSourceFiles(root)) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = file.slice(root.length + 1).split(String.fromCharCode(92)).join('/');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'decodeURIComponent'
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        let decoded = '';
        try { decoded = decodeURIComponent(node.arguments[0].text); } catch { /* invalid input is not this guard's concern */ }
        if (/[가-힣]/.test(decoded)) {
          rows.push({
            file: rel,
            line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
            text: decoded.trim().replaceAll(/\s+/g, ' ').slice(0, 180),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Find Korean string/template literals outside JSX that are likely to reach UI state,
 * toasts, dialogs, labels, or client-side errors. Explicit Korean dictionary entries and
 * arguments already wrapped by a locale resolver are excluded. API prompts are audited by
 * the server-output pass rather than this UI-oriented check. */
export function findUnlocalizedKoreanLiterals(root) {
  const rows = [];
  const localizerNames = new Set(['L', 'T', 'loc', 'localized', 'designPair']);
  for (const file of listSourceFiles(root)) {
    const rel = file.slice(root.length + 1).split(String.fromCharCode(92)).join('/');
    if (rel.startsWith('app/api/')) continue;
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const propertyName = (node) => node?.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
      ? node.name.text
      : '';
    const isCovered = (node) => {
      for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
        if (ts.isJsxElement(current) || ts.isJsxFragment(current) || ts.isJsxAttribute(current)
          || ts.isJsxExpression(current) || ts.isJsxText(current)) return true;
        if (ts.isPropertyAssignment(current)) {
          const name = propertyName(current);
          if (name === 'ko' || name === 'kr' || /Ko$/.test(name)) return true;
        }
        if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)
          && /^(?:KO|KR)$/.test(current.name.text)) return true;
        if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
          && localizerNames.has(current.expression.text)) return true;
      }
      return false;
    };
    const visit = (node) => {
      const isLiteral = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateExpression(node);
      if (isLiteral && /[가-힣]/.test(node.getText(ast)) && !isCovered(node)) {
        if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
          || (ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
          ts.forEachChild(node, visit);
          return;
        }
        rows.push({
          file: rel,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          text: node.getText(ast).trim().replaceAll(/\s+/g, ' ').slice(0, 180),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
