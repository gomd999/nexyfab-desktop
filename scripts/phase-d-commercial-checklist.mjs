#!/usr/bin/env node
/**
 * 상용 완성 — Phase D (팀·대형·엔터프라이즈) 수동·반자동 체크리스트 (콘솔 출력).
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase D
 */
const doc = 'docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md';
const m6pdm = 'docs/strategy/M6_PDM_LITE.md';
const m6team = 'docs/strategy/M6_TEAM_MANUAL.md';
const m7scale = 'docs/strategy/M7_ASSEMBLY_SCALE.md';
const m7perf = 'docs/strategy/M7_PERFORMANCE_BUDGETS.md';
const m7sec = 'docs/strategy/M7_SECURITY_ENTERPRISE.md';
const bmGap = 'docs/strategy/BM_MATRIX_CODE_GAP.md';
const bm = 'docs/strategy/bm-matrix.md';

const items = [
  `[D1] PDM·협업: ${m6pdm} · ${m6team} — 2인 동시·409·권한 시나리오 정기 실행`,
  `[D2] 대형 어셈블리: ${m7scale} · ${m7perf} (M7_REFERENCE_BUDGETS_MS 실측·LOD·간섭 UX 한계)`,
  `[D3] 엔터프라이즈·보안: ${m7sec} + npm run security:smoke (+ 고객별 체크리스트)`,
  `[D4] 과금·스테이지: ${bm} ↔ 코드/UI — 갭 추적 ${bmGap} (분기 목표: 갭 0 또는 승인 예외만)`,
  `[자동] npm run m6 && npm run m7 (메타·스케일 정책 Vitest)`,
  `[Phase D 종료] SLA·지원 범위 문서 + bm-matrix 갭 0 (${doc})`,
];

console.log('NexyFab — Phase D 팀·대형·엔터프라이즈 체크리스트\n');
console.log(`  근거: ${doc}\n`);
for (const line of items) {
  console.log(`  ☐ ${line}`);
}
console.log('\n통합 실행(A 자동 + STEP in verify + B·C·D 맵): npm run commercial:through-d · 갭 표: docs/strategy/BM_MATRIX_CODE_GAP.md\n');
