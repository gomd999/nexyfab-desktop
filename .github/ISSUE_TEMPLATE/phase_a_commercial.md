---
name: "Phase A — 상용 출하 신뢰"
about: "CAD_COMMERCIAL_COMPLETION_ROADMAP Phase A (A1–A5) 추적"
title: "[Phase A] "
labels: commercial
---

## 근거 문서

- `docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md` — **§ Phase A**
- 자동 체크리스트 출력: `npm run phase-a:checklist` — 전 페이즈 순서: `npm run commercial:checklists`

## 체크 (복사해 `- [x]` 로 표시)

- [ ] **A1** — CI에서 `npm run verify` + 전체 Vitest (`npm run test`) green
- [ ] **A2** — `npm run test:step-roundtrip` (OCCT WASM) green
- [ ] **A3** — Playwright E2E green (로컬 `npm run test:e2e` 또는 `VERIFY_E2E=1` verify)
- [ ] **A4** — `route-security` Vitest (`src/app/api/__tests__/route-security.test.ts`, CI 단독 스텝) + `npm run security:smoke` (`verify`에 포함)
- [ ] **A5** — M1 교환 문서·`npm run release:checklist` 항목 동기
- [ ] **수동** — M0–M3 RELEASE_CHECKLIST A절 1회 이상

## 메모

<!-- 환경, 링크(CI run), 블로커 -->
