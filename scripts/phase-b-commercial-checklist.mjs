#!/usr/bin/env node
/**
 * 상용 완성 — Phase B (CAD 코어 갭 축소) 수동·반자동 체크리스트 (콘솔 출력).
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase B
 *
 * 자동 회귀: npm run m2 && npm run m3, npm run test:e2e:m3 (로컬 서버 필요 시 test:e2e:m3:serve)
 */
const doc = 'docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md';
const m3 = 'docs/strategy/M3_ASSEMBLY.md';

const items = [
  `[B1] 메이트 솔버: ${m3} §1·§5 — solveMates vs solveAssembly; 매핑 진단 + 배치 적용 후 Solver 탭 자동 리싱크(runSolverSyncFromBom / solverResyncNonce)`,
  `[B2] 어셈블리: npm run m3 + npm run test:e2e:m3; 실파트 3종 수동 시나리오 → M3_RELEASE_CHECKLIST A절에 기록`,
  `[B3] 교환 한계: M1_EXCHANGE.md §STEP 교환 한계(요약표) 고객 공유 문구 검토`,
  `[B4] 모델링: 필드 Top N 실패 로그 → features/featureDiagnostics.ts classifyFeatureError 패턴 추가 + (선택) 골든`,
];

console.log('NexyFab — Phase B CAD 코어 갭 축소 체크리스트\n');
console.log(`  근거: ${doc}\n`);
for (const line of items) {
  console.log(`  ☐ ${line}`);
}
console.log('\n자동: npm run verify (또는 m2·m3 단독) · A→D 자동+B·C·D 맵: npm run commercial:through-d');
console.log('       Phase A와 병행 시 npm run phase-a:checklist\n');
