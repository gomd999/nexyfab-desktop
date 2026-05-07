# NexyFab — 상용 완성 로드맵 (재정리)

**버전:** 1.0 · **기준일:** 2026-04-30  
**상위 참조:** [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) (M0–M7 정의·자동 게이트)  
**목적:** `npm run verify` 통과만으로는 부족한 **현장 상용 기준**을 단계별로 닫는다.

---

## 0. 용어 정리

| 구분 | 의미 |
|------|------|
| **엔지니어링 완료** | M0–M7 스크립트 + 핵심 Vitest + 문서화된 DoD ([M2_MODELING](./M2_MODELING.md) §5 등) |
| **상용 완성** | 엔지니어링 완료 + **필드 검증** + **릴리스·운영·제품 게이트**(E2E, STEP 라운드트립 CI, 솔버/도면 갭, bm-matrix 정합) |

본 문서는 **상용 완성**을 향한 재편성 로드맵이다. M0–M7 번호는 유지하되, **우선순위는 “고객이 돈을 내고 쓸 수 있는 스토리”**로 재배열한다.

---

## 1. 북극성 (한 문장)

**3D 단일 진실 소스**에서 파트·어셈블리·교환·도면·검증·협업이 **끊기지 않고** 재현 가능해야 하며, 대형·팀·보안은 **예측 가능한 한계** 안에서 동작한다.

---

## 2. 현재 스냅샷 (요약)

| 축 | 상태 | 비고 |
|----|------|------|
| M0 회귀·골든 | 엔지니어링 기준선 | 수동: [M0_RELEASE_CHECKLIST](./M0_RELEASE_CHECKLIST.md) |
| M1 교환 | v1 기준선 | STEP 가져오기=메시; 박스보내기 AP214 B-rep 경로 추가됨 — **문서(M1)와 동기화** 롤링 |
| M2 모델링 | v1 완료 정의 닫힘 | 피처 커버리지는 `FEATURE_DEFS`가 진실 |
| M3 어셈블리 | P0–P2·자동 게이트 통과 | **솔버 이원화·selection↔face** — [M3_ASSEMBLY](./M3_ASSEMBLY.md) §1 롤링 |
| M4 도면 | v0 스모크 | PDF/DXF·불일치 배너 — **GD&T·조립 도면·템플릿**은 후속 |
| M5 FEA/DFM/CAM | v0 브리지 | 실기계·실해석 검증은 수동 필수 |
| M6 PDM-lite | v0 | 팀·409·감사 — **릴리스 체크리스트·bm-matrix**와 정합 |
| M7 스케일·보안 | 정책·스모크 | `M7_REFERENCE_BUDGETS_MS` 등 **수치 SLA**는 제품이 채움 |

---

## 3. 재편성 로드맵 (페이즈)

분기 숫자는 **가이드**이며, 팀 속도에 맞춰 슬라이드한다.

### Phase A — 출하 신뢰 (4–8주)

**목표:** “배포해도 된다”는 **재현 가능한 증거**를 기본으로 깐다.

| # | 작업 | 산출·완료 기준 |
|---|------|----------------|
| A1 | CI를 `verify`와 동일 선상에 | PR에서 `typecheck` + `npm run verify` (또는 동등 분할); 실패 시 머지 금지 — [.github/workflows/ci.yml](../../.github/workflows/ci.yml) |
| A2 | STEP OCCT 라운드트립 | `npm run test:step-roundtrip`; 마일스톤 일괄 시 `VERIFY_STEP_ROUNDTRIP=1 npm run verify` 또는 **`npm run verify:full`**(본 플래그 포함) |
| A3 | E2E 스모크 상시 | `VERIFY_E2E=1` + `E2E_BASE_URL` 또는 CI — [verify-milestones.mjs](../../scripts/verify-milestones.mjs)에 나열된 스펙 전부 green |
| A4 | API·보안 회귀 | `route-security` Vitest + `npm run security:smoke` |
| A5 | 문서·코드 동기 | M1 STEP보내기 설명(박스 AP214 vs 일반 AP242) 반영; `npm run release:checklist` 주기 점검 |
| — | 체크리스트 출력 | `npm run phase-a:checklist` — 일괄: `npm run commercial:checklists` — **순차:** `npm run commercial:sequential`(Phase A 자동 게이트 후 A→D 목록 출력) — GitHub 이슈: **Phase A — 상용 출하 신뢰** 템플릿 |

**Phase A 종료:** 위 표 5항 모두 만족 + [M0–M3 RELEASE_CHECKLIST](./M0_RELEASE_CHECKLIST.md) A절 샘플 1회 이상 통과 기록.

---

### Phase B — “CAD 코어” 상용 갭 축소 (8–16주)

**목표:** 기계 CAD로서 **설계·어셈블리 루프**가 경쟁 제품 대비 설명 가능한 수준.

| # | 작업 | 산출·완료 기준 |
|---|------|----------------|
| B1 | 메이트 솔버 통합 로드맵 실행 | [M3_ASSEMBLY](./M3_ASSEMBLY.md) §1·§5: `solveMates` vs `solveAssembly` — 매핑 확장 또는 단일 경로 결정 문서 + 회귀 테스트 |
| B2 | 간섭·배치·저장 일관성 | 기존 `npm run m3` + E2E `m3-assembly-load` 유지; **실파트 3종** 수동 시나리오 (체크리스트에 기록) |
| B3 | 교환 심화 | STEP 대용량·비박스 solid·조립 STEP **한계표** 고객용 1p; 필요 시 OCCT 업그레이드 이슈 트래킹 |
| B4 | 모델링 시나리오 확대 | 필드 Top N 실패 → `classifyFeatureError` 패턴 + (선택) 골든 시나리오 추가 |
| — | 체크리스트 출력 | `npm run phase-b:checklist` — GitHub 이슈: **Phase B — CAD 코어 갭 축소** 템플릿 |

**Phase B 종료:** M3 문서의 “롤링” 갭 중 **솔버 관련 1안**이 제품에 반영되고, 어셈블리 수동 A절 + E2E가 한 사이클 이상 green.

---

### Phase C — 도면·MBD·제조 인터페이스 (12–24주, B와 부분 병행 가능)

**목표:** 공장·검사와 말할 수 있는 **2D/MBD 출구**를 v0에서 v1로 끌어올린다.

| # | 작업 | 산출·완료 기준 |
|---|------|----------------|
| C1 | 도면 v1 | [M4_DRAWING](./M4_DRAWING.md) 수동 항목 정량화: 조립 도면 최소 1케이스, 리비전 블록·스케일 정책 고정 |
| C2 | 치수·GD&T | 모델 연동 방향 명시(단방향 export → 양방향은 하위 단계); PDF/DXF/SVG 일관성 회귀 확대 |
| C3 | M5 현장 검증 | FEA·G-code **실측 1건 이상** 문서화 ([M5_FEA_TUTORIAL](./M5_FEA_TUTORIAL.md), [M5_CAM_EXPORT](./M5_CAM_EXPORT.md)) |
| — | 체크리스트 출력 | `npm run phase-c:checklist` — 일괄: `npm run commercial:checklists` |

**Phase C 종료:** 대표 제품 1개에 대해 **도면 패키지**가 외부 뷰어에서 열리고, M5 수동 항목이 체크리스트에 서명 가능.

---

### Phase D — 팀·대형·엔터프라이즈 (지속, C와 병행)

**목표:** 돈 내는 팀/기업이 **한계 안에서** 쓸 수 있다.

| # | 작업 | 산출·완료 기준 |
|---|------|----------------|
| D1 | PDM·협업 | [M6_PDM_LITE](./M6_PDM_LITE.md), [M6_TEAM_MANUAL](./M6_TEAM_MANUAL.md) — 2인 동시 편집·409·권한 시나리오 정기 실행 |
| D2 | 대형 어셈블리 | [M7_ASSEMBLY_SCALE](./M7_ASSEMBLY_SCALE.md) + `M7_REFERENCE_BUDGETS_MS`를 **실측**으로 교정; LOD·간섭 UX 한계 고지 |
| D3 | 엔터프라이즈·보안 | [M7_SECURITY_ENTERPRISE](./M7_SECURITY_ENTERPRISE.md), `security:smoke` + 고객별 체크리스트 |
| D4 | 제품·과금 정합 | [bm-matrix.md](./bm-matrix.md) Stage·기능 노출 ↔ 코드/UI 게이트 **갭 리스트 0건**을 분기 목표로 (허용 시 명시적 예외 문서) |
| — | 체크리스트 출력 | `npm run phase-d:checklist` — 갭 표: [BM_MATRIX_CODE_GAP.md](./BM_MATRIX_CODE_GAP.md) — 일괄: `npm run commercial:checklists` |

**Phase D 종료:** 분기별로 정의한 **SLA·지원 범위** 문서 + bm-matrix 갭 0 (또는 승인된 예외만).

---

### 페이즈 A→D 통합 (자동 회귀 + 수동 맵 B·C·D)

**마일스톤 전체**(`verify`)·전체 Vitest·STEP은 기본적으로 **integration-smoke 한 번**(동일 세션에서 verify가 STEP 플래그를 중복 실행하지 않음 — `commercial-gate-phase-a`). 이후 **Phase B·C·D 체크리스트** 출력:

```bash
npm run commercial:through-d
```

환경변수: `commercial-progress-through-d.mjs`·`commercial-gate-phase-a.mjs` 주석(`SKIP_INTEGRATION_SMOKE`, `SKIP_FULL_VITEST`, `SKIP_VERIFY_STEP_ROUNDTRIP`, `FORCE_VERIFY_STEP_ROUNDTRIP`). Phase A만·전 체크리스트 A→D는 `npm run commercial:sequential`.

---

## 4. M0–M7과의 매핑 (참고)

```
Phase A  → M0, M1, 검증 인프라, 릴리스 체크리스트
Phase B  → M2, M3 (+ M1 교환 심화)
Phase C  → M4, M5
Phase D  → M6, M7, bm-matrix·운영
```

기존 [CAD_FULLSTACK_MILESTONES](./CAD_FULLSTACK_MILESTONES.md)의 **의존 순서**(M1→M2→M3…)는 깨지지 않는다. 본 로드맵은 **병렬 가능한 작업**(예: A와 D4 문서)을 드러내기 위한 것이다.

---

## 5. 분기 운영 규칙 (짧게)

1. **한 분기에 “진행 중” 북극성 페이즈는 1개** (A→B→C→D)를 권장한다.  
2. 스프린트 종료 시: **완료 / 미완료 이유 / 다음 분기 슬라이드**를 본 파일 하단 변경 이력에 3줄로 남긴다.  
3. 자동 게이트 실패는 **항상 P0**; bm-matrix 갭은 **릴리스 전 P1** unless 명시적 완화.

---

## 6. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | 상용 완성 관점 페이즈 로드맵 초안 (M0–M7·M3/M4/M5 문서와 정렬) |
| 2026-04-30 | Phase A: `phase-a:checklist` 스크립트·ISSUE_TEMPLATE·`VERIFY_STEP_ROUNDTRIP`·CI `test:step-roundtrip` |
| 2026-04-30 | Phase B: `phase-b:checklist`·ISSUE_TEMPLATE·M1 STEP 한계 요약표 |
| 2026-05-03 | Phase C/D: `phase-c:checklist`·`phase-d:checklist`·`commercial:checklists`; CI에 `route-security` Vitest 단계 명시 |
| 2026-05-03 | 출하 자동 일괄: `stepImporter` `webpackIgnore`로 `next build` 복구; M4 Phase C1 지문 Vitest; BM_MATRIX 예외 X-G-S3; M3 체크리스트에 lint/test/build+E2E 절차 |
| 2026-05-03 | 병렬 통합 스모크: `npm run verify:integration-smoke` (typecheck ∥ route-security ∥ STEP 라운드트립) + 주간 `integration-smoke.yml`; 선택 `VERIFY_INTEGRATION_E2E=1` |
| 2026-05-03 | CI `test` 잡: 병렬 스모크를 `verify` 앞에 배치·route-security/step 단계 중복 제거; E2E 잡에 `CI: true` 명시 |
| 2026-05-03 | CI `build` 잡: `CSP_OMIT_UPGRADE_INSECURE=1` 로 빌드 시 CSP를 Playwright standalone HTTP와 정합 |
| 2026-05-03 | CI `build` 잡: Google reCAPTCHA **테스트** site/secret 키 주입(CI 아티팩트·로컬 standalone 스모크와 Playwright webServer 정합) |
| 2026-05-03 | 로컬 CI build 재현: `npm run ci:replicate-build` (package.json; verify-milestones·phase-a 체크리스트 안내) |
| 2026-05-06 | `commercial:through-d`·`checklists-bcd`; gate-a에서 스모크 후 verify 내 STEP 중복 제거(FORCE_VERIFY_STEP_ROUNDTRIP); bm-matrix §1.2 **32행**·`BM_MATRIX_STAGE_UI_FEATURE_IDS` |
