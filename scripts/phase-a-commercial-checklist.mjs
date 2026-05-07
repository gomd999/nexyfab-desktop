#!/usr/bin/env node
/**
 * 상용 완성 — Phase A (출하 신뢰) 수동·반자동 체크리스트 (콘솔 출력).
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase A
 *
 * 자동: `npm run verify` (= 이 저장소 CI `test` 잡과 동일 선상).
 * STEP 라운드트립: PR CI에서 `npm run test:step-roundtrip` 별도 스텝 권장(또는 VERIFY_STEP_ROUNDTRIP=1 로 verify).
 */
const doc = 'docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md';

const items = [
  `[A1] CI = 코드 게이트: PR에서 npm run verify + npm run test (이 저장소 .github/workflows/ci.yml) · 로컬 순차 동일 선상: npm run commercial:gate-a 또는 한 번에 A자동+A→D목록: npm run commercial:sequential`,
  `[로컬] CI build 잡과 동일 env로 빌드: npm run ci:replicate-build (이후 E2E는 CI=true npx playwright test 또는 test:e2e:m3:serve + E2E_BASE_URL)`,
  `[병렬 스모크] PR: ci.yml test 잡 선행 / 주간·수동: integration-smoke.yml — npm run verify:integration-smoke (typecheck ∥ route-security ∥ STEP; 선택 VERIFY_INTEGRATION_E2E=1)`,
  `[A2] STEP OCCT 라운드트립: npm run test:step-roundtrip (또는 VERIFY_STEP_ROUNDTRIP=1 npm run verify)`,
  `[A3] E2E: 로컬 npm run test:e2e 또는 CI Playwright; 마일스톤 일괄은 VERIFY_E2E=1 (+ E2E_BASE_URL 또는 CI) — standalone은 npm run build 시 postbuild로 .next/static이 standalone/.next/static에 복사됨(청크 404 방지)`,
  `[A4] API·보안: src/app/api/__tests__/route-security.test.ts (CI: vitest 단독 스텝) + npm run security:smoke (verify에 포함)`,
  `[A5] 문서·코드 동기: M1_EXCHANGE.md STEP보내기(박스 AP214 vs 일반 AP242) + npm run release:checklist (법무·Sentry·결제·bm-matrix 등 릴리스 수동 목록)`,
  `[수동] M0–M3 RELEASE_CHECKLIST A절 샘플 1회 이상 (${doc} Phase A 종료 기준)`,
];

console.log('NexyFab — Phase A 상용 출하 신뢰 체크리스트\n');
console.log(`  근거: ${doc}\n`);
for (const line of items) {
  console.log(`  ☐ ${line}`);
}
console.log('\n완료 항목은 이슈·릴리스 노트에 링크해 두면 Phase A 종료 추적이 쉽습니다.\n');
