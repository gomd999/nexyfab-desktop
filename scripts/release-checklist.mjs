#!/usr/bin/env node
/**
 * 상용 릴리스 전 수동 점검 목록 (콘솔 출력). CI에서 `node scripts/release-checklist.mjs` 로 확인.
 */
const items = [
  '[법무] 이용약관·개인정보처리방침이 실제 수집·제3자(Sentry, PostHog, GA, Stripe, R2)와 일치',
  '[Sentry] NEXT_PUBLIC_SENTRY_DSN·NEXT_PUBLIC_RELEASE·샘플링 env 설정',
  '[Tauri] TAURI_UPDATER_PUBKEY + 코드 서명(Windows/macOS) + 업데이트 API 동작',
  '[결제] Stripe/Toss 웹훅 시크릿·라이브 키·환불 정책 문구',
  '[코드 게이트] npm run verify — typecheck 후 M0→M7 + security:smoke (scripts/verify-milestones.mjs) · CI .github/workflows/ci.yml의 test 잡과 동일 선상이면 npm run commercial:gate-a',
  '[상용 Phase A→D] CAD_COMMERCIAL_COMPLETION_ROADMAP.md — phase-a:checklist / commercial:sequential(A자동+A→D목록) / commercial:through-d(verify+STEP+B·C·D맵)',
  '[M0] 수동: docs/strategy/M0_RELEASE_CHECKLIST.md (자동 단독: npm run m0)',
  '[M1] 수동: docs/strategy/M1_RELEASE_CHECKLIST.md + M1_EXCHANGE.md STEP(AP242/박스 AP214) 동기 확인 (자동 단독: npm run m1)',
  '[M2/M3] 수동: 클라우드 동시 편집 — PATCH 409 시 서버 최신본 리로드 UX (자동: Vitest useCloudSaveFlow409)',
  '[제품] docs/strategy/bm-matrix.md Stage·기능 노출과 UI/백엔드 게이트 정합',
  '[빌드] npm run test (전체 Vitest) + npm run test:e2e (스테이징·CI는 playwright.config)',
  '[E2E 스모크 일괄] E2E_BASE_URL 또는 CI에서 npm run verify:e2e (상용·shape-generator·M3 어셈블리 3종)',
  '[데스크톱] tauri:build:release 산출물 설치 스모크·자동 업데이트 스테이징',
];

console.log('NexyFab release checklist\n');
for (const line of items) {
  console.log(`  ☐ ${line}`);
}
console.log('\n완료 항목은 팀 프로세스에 맞게 체크하세요.\n');
