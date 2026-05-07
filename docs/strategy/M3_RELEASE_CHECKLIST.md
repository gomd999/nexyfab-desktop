# M3 릴리스 체크리스트 (어셈블리 파이프)

**상태:** 자동 게이트(P0–P2)는 코드 기준 통과. 아래 A절은 출시·베타 전 **수동 스모크**용.

**일괄 자동(M0–M7 코드 게이트 일부):** `npm run verify` (= `m2` → `m3` → `m4` → `m7`). E2E까지: `E2E_BASE_URL` 또는 `CI=true` 후 `npm run verify:e2e`.

**자동 게이트(M3만):** `npm run m3` (타입체크 + `src/test/m3/*.test.ts` + 골든 `m3-assembly-minimal.nfab.json`의 `parseProject`) — 실패 시 M3 관련 릴리스 보류  

**브라우저 E2E(선택·릴리스 직전 권장):** `npm run test:e2e:m3` — `E2E_BASE_URL`이 가리키는 서버에서 실행. 기본 개발 서버(Turbopack)가 shape-generator에서 500이면 **`npm run build && npx next start -H 127.0.0.1 -p 3334`** 후 `E2E_BASE_URL=http://127.0.0.1:3334 npm run test:e2e:m3`. CI: `CI=true npm run test:e2e:m3`(빌드+**127.0.0.1:3333** `next start`).  
**권장 회귀:** `npm run m2` (파트 파이프), `npm run m1` / `npm run m0` (교환·기준선)

**자동 일괄(출하 전 참고):** `npm run lint`(에러 0) → `npm run test` → `npm run build` → `JWT_SECRET`(≥32자)·`NEXYFAB_DB_PATH` 등과 함께 `next start`, 다른 터미널에서 `E2E_BASE_URL=http://127.0.0.1:<포트> npm run test:e2e:m3`. CI는 `CI=true`일 때 Playwright가 서버를 기동함(포트 3333).

**참고:** 설계 맵·갭·P0–P3 순서는 [M3_ASSEMBLY.md](./M3_ASSEMBLY.md).

---

## A. 릴리스 게이트 (필수)

1. **어셈블리 저장·재로드**  
   라이브러리 파트 2개 이상 배치 → `.nfab` 저장(또는 프로젝트 저장 경로) → 새로고침·재열기 → **동일 파트 수·이름·대략적 위치**가 복원되는지.

2. **메이트 정의 유지**  
   `coincident`(또는 사용 중인 메이트 타입) 1건 이상 정의 후 저장 → 재로드 후 메이트 행이 남아 있는지(`partA` / `partB` 이름이 배치 이름과 일치).

3. **메이트 → 배치 적용**  
   「메이트를 배치에 적용」실행 후 파트가 움직이는지 → **저장 → 재로드** 후에도 적용된 배치(위치·회전)가 유지되는지.

4. **간섭 검사**  
   (3) 이후 간섭 검사 실행 → 결과(간섭 있음/없음)가 **뷰에 보이는 겹침**과 말이 되는지. 메이트 적용 전 상태와 혼동되지 않는지(적용 후에만 겹치면 간섭이 뜨는지) 한 번 확인.

5. **자동 테스트**  
   로컬/CI에서 `npm run m3` 녹색 확인.

6. **실파트 3종 (Phase B2 권장)** — 아래 각각 **한 번 이상** 기록(날짜·담당·PASS/FAIL).  
   - **부품 A:** (예: 갤러리 실린더 / 자사 샘플 STEP 재배치) — 저장·재로드·간섭.  
   - **부품 B:** (예: 얇벽 브래킷) — 메이트 2건 이상·배치 적용 후 Solver 탭과 뷰 일치.  
   - **부품 C:** (예: 멀티 바디 BOM 2행 이상) — `solverBomParts` 경로로 솔버 동기화.  
   **E2E:** `npm run test:e2e:m3` (로컬은 `E2E_BASE_URL` + `npm run test:e2e:m3:serve` 등 [§A 상단](./M3_RELEASE_CHECKLIST.md) 참고).

---

## B. 운영·품질 (배포 후 첫 주 권장)

7. **스키마 경고**  
   브라우저 콘솔에 `normalizeAssemblySnapshot` 관련 경고가 과도하게 쌓이지 않는지(샘플 프로젝트 1건).

8. **대용량**  
   파트 10개 미만 어셈블리에서 간섭 검사가 **응답 없음**으로 이어지지 않는지(타임아웃 60s 내 완료 또는 취소 가능).

---

## C. 지속 (M3 롤링)

- [M3_ASSEMBLY.md](./M3_ASSEMBLY.md) §1·§2 갱신 — 멀티 바디(`bodies`)와 간섭 입력 연동, `matesSolver` 단일화 등 후속 과제.  
- 저장 E2E를 자동화할 때 Vitest/Playwright 후보는 `NfabAssemblySnapshotV1` round-trip 확장으로 정리.

---

## D. 자동 테스트·스크립트와의 대응 (CI·`npm run m3`가 덮는 범위)

| 체크리스트 | 자동/반자동 |
|------------|-------------|
| **A.5** `npm run m3` | `scripts/m3-assembly.mjs` — 타입체크 + `src/test/m3/*` + 골든 `m3-assembly-minimal.nfab` `parseProject` |
| **A.1** 저장·재로드(웹) | E2E `e2e/m3-assembly-load.spec.ts` — Ctrl+O 골든·재열기·Ctrl+S 다운로드 round-trip (`npm run test:e2e:m3`) |
| **A.6** 실파트 3종·E2E | 수동 기록 + `npm run test:e2e:m3` (CI/로컬 `E2E_BASE_URL`) |
| **간섭 성능·취소** | Vitest `interferenceBroadPhase.test.ts` 등; UI 취소·타임라인은 구현 완료 — **A.4·B.7·B.8**은 여전히 눈으로 한 번 확인 권장 |
| **일괄** | `npm run verify` → `m2`·`m3`·`m4`·`m7` (문서: [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md)) |
