# BM Matrix ↔ 코드·UI 갭 목록 (롤링)

**근거 스펙:** [bm-matrix.md](./bm-matrix.md)  
**엔진 구현:** `src/lib/stage-engine.ts` — `computeStage`, `evaluateStage`, `recordOrderCompletion`, `evaluateStaleUsers` · 분기 롤 `src/lib/quarterly-stage-job.ts` — `runQuarterlyStageHistoryRoll`  
**목표:** [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) Phase **D4** — 갭 0 또는 승인된 예외만.

이 파일은 **한 번에 닫히지 않는** 추적 표다. 분기마다 열을 갱신하고, 닫힌 행은 삭제하지 말고 날짜·PR로 strikethrough 또는 “완료”로 옮긴다.

---

## 1. Stage 계산 vs §1.1 정의

| ID | bm-matrix §1.1 | 코드 현황 | 상태 |
|----|------------------|------------|------|
| G-S1 | Stage **E**: 누적 ≥ 1억 + (법인 **또는** 팀원 ≥2) | `computeStage`·`evaluateStage`·`nf_stage_event.trigger_value` 모두 `isBusinessAccount` 동기화; DB 컬럼은 `nf_users.account_type`·`business_reg_number` | **부분** (법인은 제품 프록시만; 법적 실체 검증·ERP·E→F 분기 규칙은 별행) |
| G-S2 | Stage **E** exit → **F**: 분기 발주 ≥ 1억 **3구간 연속** 또는 ERP 계약 | `computeStage` + `quarterly-stage-roll` 잡이 `rollQuarterlyOrderKrwHistoryJson`·`evaluateStage('quarterly_volume')` 수행 | **부분** (`quarterly_order_krw` 일배치 `rolling_window_job` 스펙은 별도 구현·배포) |
| G-S3 | Stage **F**: 맞춤 계약 | `nf_users.enterprise_contract`·`evaluateStage` 반영; 관리자 `PATCH /api/admin/users` 로 토글 후 `evaluateStage` | **완료** (맞춤 계약의 법적 검토는 운영 프로세스) |
| G-S4 | Stage **B** (첫 거래 준비) | `computeStage`가 **B를 생산하지 않음** (주석: 결제 플로우에서 명시 설정) | **완료** — Vitest `stageEngine.test.ts` 에서 B 비생산 단언 |

---

## 2. §1.2 기능 노출 매트릭스 vs 제품 UI

| ID | 스펙 요지 | 코드 현황 | 상태 |
|----|-----------|------------|------|
| G-U1 | Stage별 UI 매트릭스 | §1.2 표 **32개 기능 번호**는 `bm-matrix-stage-ui.ts`와 lockstep(Vitest 고정). `mergePlanLimitsWithBmStage`·`useFreemiumGate`·`nexyfabStage`로 게이트. **개별 화면·업셀 카피**를 행마다 연결하는 작업은 제품 롤링 | **부분** (매트릭스 데이터·게이트 레이어는 구현됨; 화면 커버리지는 롤링) |
| G-U2 | Stage×플랜 UI 플래그 격리 | 엔지니어링 단일 매핑 `BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS` + `BM_MATRIX_PLAN_STAGE_GATE_REVISION` + `mergePlanLimitsWithBmStage` (+ `useFreemiumGate`). **별도 범용 Feature Flag 스토어**(예: 원격 스위치)는 미도입 | **부분** |
| G-U3 | Outbox 워커와 UI 동기 | 워커: 알림·메일(`stage-worker`). UI Stage: **세션/JWT `nexyfabStage`** (`/api/auth/session`, `refresh`) — 워커가 클라이언트 상태에 직접 쓰지 않는 것이 계약. 클라이언트: `NexyfabSessionHydrator`가 탭 포커스/가시화 시(90s 스로틀) 세션 재조회로 Stage 병합 | **부분** (경로 명시됨) |

---

## 3. 이벤트·메트릭

| ID | 스펙 | 코드 현황 | 상태 |
|----|------|------------|------|
| G-M1 | `quarterly_order_krw` 일배치 → Stage 평가 | 일 합산: `POST/GET /api/jobs/rolling-quarterly-metrics` · 분기 히스토리: `quarterly-stage-roll` (v72 체크포인트) | **부분** (크론 URL·순서는 배포별) |
| G-M2 | §4.4 로깅 의무 (결함·환불·CAD 접근 등) | 일부 테이블·API는 로드맵상 “신규” — [bm-matrix.md §4.4](./bm-matrix.md) 체크리스트와 DB 마이그레이션 대조 | 롤링 |

---

## 4. 운영 규칙

- **High-water mark:** `maxStage(current, computed)` — [stage-engine.ts](../../src/lib/stage-engine.ts) 상단 주석과 일치.
- 갭을 “허용됨”으로 바꿀 때는 본 표에 **예외 ID·승인자·만료 분기**를 한 줄 추가한다.

### 4.1 승인된 예외(롤링)

| 예외 ID | 원 갭 | 조건 | 재검토 |
|---------|--------|------|--------|
| *(종료)* **X-G-S3** | G-S3 `enterpriseContract` 고정 false | `nf_users.enterprise_contract`·관리 PATCH로 대체되어 예외 종료 | — |

---

## 5. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | 초안 — D4 추적용으로 `stage-engine`·UI 게이트 조사 반영 |
| 2026-05-03 | §4.1 예외 X-G-S3 기록(엔터프라이즈 계약 플래그 도입 전) |
| 2026-05-03 | G-S1: `stage-engine` 법인 프록시 + `evaluateStage`→`computeStage`의 `isBusinessAccount`·`trigger_value` 동기화 |
| 2026-04-30 | Stage·BM: v71·v72, 분기/일배치 잡, 관리자 PATCH, `bm-matrix-stage-ui`, `nexyfabStage`+`mergePlanLimitsWithBmStage`+`useFreemiumGate`, G-U2 리비전 상수 |
| 2026-05-06 | G-U1: §1.2 UI 게이트 **32행**·코드 정합; “42 전 화면”과 구분 |
| 2026-05-06 | G-U2·G-U3: `BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS`; 워커≠UI 푸시·세션 경유 명시 |
| 2026-05-06 | G-U3: `NexyfabSessionHydrator` 포커스/가시화 시 Stage 세션 재동기(스로틀) |
