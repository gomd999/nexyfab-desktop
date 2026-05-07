#!/usr/bin/env node
/**
 * 상용 완성 — Phase C (도면·MBD·제조 인터페이스) 수동·반자동 체크리스트 (콘솔 출력).
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C
 *
 * 자동: npm run m4, npm run m5 (엔지니어링 게이트) — 현장 실측·외부 뷰어는 아래 수동.
 */
const doc = 'docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md';
const m4 = 'docs/strategy/M4_DRAWING.md';
const m5fea = 'docs/strategy/M5_FEA_TUTORIAL.md';
const m5cam = 'docs/strategy/M5_CAM_EXPORT.md';

const items = [
  `[C1] 도면 v1: ${m4} §Phase C1 — 조립 도면 최소 1케이스·리비전·스케일 정책; 지문 회귀: src/test/m4/phaseC1GeometryFingerprint.test.ts`,
  `[C2] 치수·GD&T: ${m4} 수동 롤링 + PDF/DXF/SVG 일관성 회귀 확대 방향`,
  `[C3] M5 현장: ${m5fea} · ${m5cam} — FEA·G-code 실측 1건 이상 문서 서명`,
  `[자동] npm run m4 && npm run m5 (타입체크·해당 Vitest 포함)`,
  `[Phase C 종료] 대표 제품 1개 도면 패키지 외부 뷰어 + M5 수동 체크 서명 (${doc})`,
];

console.log('NexyFab — Phase C 도면·MBD·제조 인터페이스 체크리스트\n');
console.log(`  근거: ${doc}\n`);
for (const line of items) {
  console.log(`  ☐ ${line}`);
}
console.log('\n전 페이즈 자동 회귀 후 B·C·D만 보려면: npm run commercial:checklists-bcd · 통합: npm run commercial:through-d\n');
