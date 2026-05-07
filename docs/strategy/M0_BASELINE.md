# M0 — 기준선 & 회귀

**목표:** 릴리스와 리팩터링 시 **최소 안전망** — 자동화 + 수동 스모크 + 정책 문서.

## 자동화

| 명령 | 내용 |
|------|------|
| `npm run m0` | `typecheck` + 골든 `.nfab` 파싱 테스트 (`src/test/m0/nfabGolden.test.ts`) |
| `npm run m1` | `typecheck` + M0 골든 + M1 exchange 테스트 — **M1 채택 시 권장 일일 게이트** |
| `npm run test` | 전체 Vitest (커버리지 정책은 `vitest.config.ts` 참고) |
| `npm run test:e2e` | Playwright (로컬은 `npm run dev` 후, CI는 `playwright.config`의 webServer) |

골든 파일: `tests/golden/m0-minimal.nfab.json` — 스키마 `parseProject` 호환 최소 프로젝트.

## 자동 저장·dirty 트래킹 (요약)

- **구현:** `useSceneAutoSaveWatchers` — 워크스페이스에서 선택/파라미터/피처/스케치/어셈블리/뷰 설정 등 변경 시 `scheduleSave` 디바운스, shape 전환·피처 개수 변화·스케치 프로필 클로즈 시 즉시 `autoSave`, 동시에 `.nfab` dirty 플래그.
- **상세:** 소스 `src/app/[lang]/shape-generator/hooks/useSceneAutoSaveWatchers.ts` 주석 참고.

데스크톱 앱에서의 로컬 자동 저장/복구는 Tauri·프리퍼런스와 결합 — `docs/env-setup.md` 및 데스크톱 온보딩 문서를 함께 본다.

## 수동 점검

릴리스 게이트: **[M0_RELEASE_CHECKLIST.md](./M0_RELEASE_CHECKLIST.md)**.

상용 전체 체크: `npm run release:checklist` (콘솔 출력) + 법무/결제/Tauri 등 팀 프로세스.

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | M0 자동화·문서 초안 |
