/**
 * failures.mjs — **코드 짜기 전에 이걸 먼저 본다** (260803).
 *
 * 라이브에서 무엇이 자주 깨지는지 지문별로 뽑는다. 다음에 고칠 것을 감이 아니라
 * **빈도**로 정하기 위한 도구다.
 *
 * ```
 *   node scripts/autoverify/failures.mjs                       # 최근 7일
 *   node scripts/autoverify/failures.mjs --days 30 --limit 60
 *   node scripts/autoverify/failures.mjs --json                # 파이프용
 *   NEXYFAB_BASE=https://nexyfab.com node scripts/autoverify/failures.mjs   # 프로덕션
 * ```
 *
 * ## 왜 이 도구가 필요한가
 * 이 세션에서 제품을 실제로 고친 것은 전부 **라이브 실패 한 건**에서 나왔다 —
 * 「와셔를 flange 로 분류 → 60건」 하나가 어휘 힌트 17종 결손을 드러냈다.
 * 그 건은 **우연히 스크린샷으로 전달됐기 때문에** 고쳐졌다. 자동으로 쌓였어야 했다.
 *
 * ## ⚠ 읽는 법
 * - **`distinct` 로 정렬돼 있다** — `hits`(총 발생)가 아니라 **서로 다른 입력 수**다.
 *   한 사람이 같은 입력을 20번 재시도한 것보다 20명이 각각 겪은 것이 훨씬 중요하다.
 * - 지문은 **PII 가 제거돼 있다**(숫자·부품 이름 정규화). 원문은 저장하지 않는다.
 * - 상위 지문이 곧 **`auto-fix.mjs` 규칙 후보**다(§11 자율 검증 루프).
 *
 * ⚠ 관리자 인증이 필요하다 — 실패 분포는 제품 약점 지도라 공개 엔드포인트가 아니다.
 *   쿠키를 `NEXYFAB_ADMIN_COOKIE` 로 넘긴다.
 */
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

const base = process.env.NEXYFAB_BASE || 'http://localhost:3000';
const days = Number(flag('days', 7));
const limit = Number(flag('limit', 40));
const url = `${base.replace(/\/+$/, '')}/api/nexyfab/admin/failures?days=${days}&limit=${limit}`;

const headers = {};
if (process.env.NEXYFAB_ADMIN_COOKIE) headers.cookie = process.env.NEXYFAB_ADMIN_COOKIE;

let res;
try {
  res = await fetch(url, { headers });
} catch (e) {
  console.error(`연결 실패: ${url}\n  ${e.message}\n  (서버가 떠 있는지 · NEXYFAB_BASE 가 맞는지 확인)`);
  process.exit(1);
}
if (!res.ok) {
  const body = await res.text().catch(() => '');
  console.error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
  if (res.status === 401 || res.status === 403) {
    console.error('  → 관리자 인증이 필요하다. NEXYFAB_ADMIN_COOKIE 에 로그인 쿠키를 넣어라.');
  }
  process.exit(1);
}

const data = await res.json();
if (has('json')) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const rows = data.rows ?? [];
if (!rows.length) {
  console.log(`최근 ${data.windowDays}일 실패 기록 없음.`);
  console.log('  (아직 배선 직후라 비어 있을 수 있다 — 실패가 나야 쌓인다)');
  process.exit(0);
}

console.log(`\n최근 ${data.windowDays}일 · 실패 지문 ${rows.length}종  [distinct=서로 다른 입력 수, 이 순으로 정렬]\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('distinct', 9) + pad('hits', 6) + pad('stage', 15) + '지문');
console.log('─'.repeat(100));
for (const r of rows) {
  console.log(pad(r.distinctInputs, 9) + pad(r.hits, 6) + pad(r.stage, 15) + r.signature.slice(0, 60));
  for (const e of r.sampleErrors.slice(0, 1)) console.log(' '.repeat(30) + '↳ ' + String(e).slice(0, 66));
}
console.log('\n★ 상위 지문 = 다음에 고칠 것. 결정론 규칙으로 고칠 수 있으면 auto-fix.mjs RULES 에 추가한다.');
