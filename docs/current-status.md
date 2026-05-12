# NexyFab 현재 현황 (Status Snapshot)

> Last updated: 2026-05-12
> Scope: Phase 진척도 + 라이브 기능 + 기술 부채 + GTM 단계

---

## 1. Phase 진척 요약

### Phase 7 — 공급사 상용화 (95% 완료, 5/6)

| Phase | 상태 | 핵심 |
|-------|------|------|
| 7-1 | ✅ Done | RFQ 인박스 + 견적 관리 UI |
| 7-2 | ✅ Done | 가격 시트 + 공정 능력 테이블 |
| 7-3 | ✅ Done | 주문 워크플로 + 자동 알림 (`nf_stage_event` 워커) |
| 7-4 | ✅ Done | 정산 + 인보이스 자동화 (일별 정산, 세금 인보이스) |
| 7-4a (다중 통화) | ✅ Done | FX 락인, Airwallex, 국가별 세금, 인보이스 PDF, OFAC + GDPR DPA, HS Code + Incoterms |
| **7-5** | 🔲 Pending | **신용 점수 + 공급사 평점 (사기 탐지·NPS)** |

### Phase BM — Stage State Machine (100% 완료)

| Phase | 상태 | 핵심 |
|-------|------|------|
| BM-1 | ✅ Done | Stage 필드 (A/B/C/D/E/F) + `nf_stage_event` outbox (v61 마이그레이션) |
| BM-2 | ✅ Done | `stage-engine.ts` (high-water mark, 트리거 기반 승격) |
| BM-3 | ✅ Done | `stage-worker.ts` (비동기 이벤트 처리, 알림, 재시도 로직) |

**Stage 임계값:**
- A (신규) → C (1차 주문) → D (2건 이상 또는 누적 ₩50M) → E (₩100M + 법인 또는 팀 2명+) → F (맞춤 계약 **또는** ERP 계약 **또는** E 자격 + 직전 3구간 발주 각 ≥ ₩100M)
- 메트릭: `cumulative_order_krw`, `order_count_success`, `quarterly_order_krw`, `quarterly_order_krw_history`, `org_size`, `account_type`/`business_reg_number`, `enterprise_contract`, `erp_integration_contract`

### Phase B — RFQ 컨텍스트 통합 (100% 완료)

| Phase | 상태 | 핵심 |
|-------|------|------|
| B-1 ext | ✅ Done | DFM check → RFQ 자동 채움 (벽 두께·구멍·공차·마감) |
| B-2 | ✅ Done | RFQ 컨텍스트 통합 (디자인 → 견적 → 주문 lineage) |

`src/lib/dfm-rules.ts` 에 10+ 보수적 룰. 결과는 `nf_dfm_check` 영속.

### Phase D — 데모 모드 풀 퍼널 (100% 완료)

| Phase | 상태 | 핵심 |
|-------|------|------|
| D-1 | ✅ Done | `nf_sessions` 테이블 (session_id FK, is_demo, claim 타임스탬프) |
| D-2 | ✅ Done | `demo-session.ts` lib + `DemoBadge` UI |
| D-3 | ✅ Done | RFQ 페이지 데모 진입 (랜딩 → 데모 → shape-gen 게이트) |
| D-4 | ✅ Done | 가입 시 데이터 이관 (`session_id` 단일 트랜잭션 UPDATE) |
| D-5 | ✅ Done | 랜딩 카피 정정 + 데모 CTA (6개 언어: KO·EN·JA·CN·ES·AR) |

**제한:**
- 데모 IP 당 일 5건 RFQ
- 7일 미가입 시 데이터 무효
- 이메일·결제·NexyFlow 트리거 모두 스킵

### 기타 완료

- ✅ 랜딩 카피 mock·허위 클레임 색출·정정 (Task #97)
- ✅ Phase 7-4a.1~7: 다중 통화 풀 스택 (KRW + 달러 + 유로 + 위안 등)

---

## 2. 라이브 기능 매트릭스

### 2.1 3D / CAD
- ✅ 파라메트릭 CAD (내장 형상 + 표준 부품 `std:*` 등 다수)
- ✅ 스케치 → 3D 변환
- ✅ FEA (선형 응력)
- ✅ 모달 분석 (고유 진동수)
- ✅ 열 FEA (정상상태 + 과도)
- ✅ 토폴로지 최적화 (SIMP)
- ✅ DFM 분석 (10+ 룰)
- ✅ 프린트 가능성 분석 (FDM)
- ✅ 어셈블리 (다중 파트)
- ✅ 핀 코멘트 협업
- ✅ IP 보호 공유 링크
- ⚙️ **피처 트리 + 파라미터 Yjs CRDT** (`ShapeGeneratorInner` ↔ `useCollabFeatureTree`): 배포/로컬에서 **`NEXT_PUBLIC_NEXYFAB_CRDT=1`** 일 때만 활성화됩니다. 미설정 시 기본 꺼짐이며, 코멘트·커서 등 다른 협업 채널과는 별개입니다.

### 2.2 고객 (Buyer)
- ✅ 이메일·OAuth·SSO 가입
- ✅ 2FA (TOTP)
- ✅ GDPR 데이터 export·삭제
- ✅ 데모 모드 진입 (회원가입 없이 RFQ)
- ✅ RFQ 작성·디스패치
- ✅ 다중 견적 비교
- ✅ 주문·배송·인보이스 추적
- ✅ 다중 통화 결제 (Stripe + Airwallex + Toss)
- ✅ 한국 부가세 세금 인보이스
- ✅ 팀·조직 워크스페이스
- ✅ 파일 버전 관리 + 시각 diff
- ✅ 실시간 협업 세션

### 2.3 파트너 (Supplier)
- ✅ 공급사 등록·온보딩
- ✅ RFQ 인박스
- ✅ 견적 작성·협상
- ✅ 가격 시트 + 공정 능력 업로드
- ✅ 자동 매칭 (기하·능력·납기·비용)
- ✅ 인증 필터 (ISO·항공우주)
- ✅ 정산 자동화 (일·주·월)
- ✅ 다중 통화 인보이스
- ✅ 다차원 KPI (응답·이행·평점)
- ✅ 익명 매칭 (회사명 비공개)
- 🔲 신용 점수 + 평판 (Phase 7-5 미완)

### 2.4 컴플라이언스·보안
- ✅ OFAC 스크리닝
- ✅ GDPR DPA 동의
- ✅ CBAM 로깅
- ✅ HS Code + Incoterms
- ✅ httpOnly 쿠키 + CSRF
- ✅ IP 이상 탐지 + 계정 락
- ✅ Rate limiting (IP + user)
- ✅ Audit log

---

## 3. 데이터베이스 (82개 핵심 테이블)

### 카테고리별 분포
| 카테고리 | 테이블 수 | 주요 테이블 |
|---------|----------|------------|
| Auth | 7 | nf_users, nf_refresh_tokens, nf_password_reset_tokens, nf_verification_codes, nf_sso_config, nf_login_history, nf_security_alerts |
| Commerce | 7 | nf_rfqs, nf_quotes, nf_orders, nf_settlements, nf_aw_invoices, nf_aw_payment_attempts, nf_tax_invoices_kr |
| Funnel | 5 | nf_dfm_check, nf_funnel_event, nf_sessions, nf_stage_event, nf_quote_remind_log |
| Org/Team | 6 | nf_orgs, nf_org_members, nf_org_invites, nf_teams, nf_team_members, nf_teams_invites |
| Content | 6 | nf_projects, nf_files, nf_shares, nf_comments, nf_collab_sessions, nf_bundles |
| Partner | 3 | nf_partner_sessions, nf_partner_tokens, nf_factories |
| Analytics | 5 | nf_usage_events, nf_ai_history, nf_billing_analytics, nf_audit_log, nf_cad_access_log |
| Compliance | 5 | nf_dpa_consent, nf_cbam_log, nf_defects, nf_rma, nf_margin_breakdown |

### 마이그레이션
- 현재 버전: **v66** (Phase D-1 nf_sessions 추가)
- SQLite (개발) + Postgres (Railway 프로덕션) 양쪽 동기화
- `src/lib/db.ts` + `src/lib/db-postgres-migrations.sql` 이중 관리

---

## 4. 인프라·배포

### 4.1 배포 토폴로지
- **NexyFab 프론트 + API** — Railway (Node.js + Postgres)
- **NexyFab 정적 자산** — Cloudflare R2
- **R2 버킷** — NexyFlow 와 공유 (S3 API, 4개 env vars)
- **이메일** — Resend (1차) + SendGrid (폴백)

### 4.2 환경 변수
- 모든 env 값 parent `.env` 통합
- `load-parent-env.cjs` 로 런타임 로드
- 핵심: NEXYSYS_AUTH_URL, DB_URL, RESEND_API_KEY, AIRWALLEX_*, STRIPE_*, TOSS_*

### 4.3 배포 절차 (`feedback_railway_deploy.md`)
- Railway CLI: `railway up`
- 빌드 실패 체크리스트 우선
- 패키지 제거 시 lockfile 동기화 주의

---

## 5. 기술 부채 / 알려진 이슈

### 5.1 코드
- **TS `no-explicit-any` 정리 (진행):** 배치 D·E(이전). **F-1:** `api/__tests__/route-security.test.ts` (`NextRequest` 기반 `makeReq`). **F-2:** `partner/settlement-pdf/route.ts`, `partner/orders/route.ts`, `contracts/[id]/pdf/route.ts`, `components/billing/CheckoutModal.tsx`. **F-3:** `features/occtEngine.ts` (STEP export·`ShellableShape`), `workers/stepWorker.ts` (`DfmStatsInput`·`postStepResultToMain`·`unknown` catch), `io/manufacturingPackage.ts` (`ManufacturingSidecarMeta.hasBom` + manifest 옵션). **F-4:** `panels/LeftPanel`·`CanvasGizmoOverlays`·`OnboardingDock`, `DFMWarningBadges`(`DFMResult[]`·`dfmAnalysis` 타입 정렬), `intake/IntakeWizard`·`intakeQuestions`. **F-5:** `intake/ComposeResultPanel`, 패널 도크(`ManufacturingPanelDock`·`FloatingAnalysisDock`·`SplitExportDock`·`VersionDiffDock`·`HelpCluster`), `hooks/useManufacturingFlow`·`useGenDesignIntegration`, `ExpressionInput`·`ScriptPanel`·`StepUploader`, `SketchCanvas`/`Sketch3DCanvas`, `RenderMode`, `SelectionInfoBadge`, `CommandPalette`, `io/RfqPanel` 등. **F-6:** `estimation/SupplierPanel`·`annotations/ThreadHoleCalloutPanel`(`ThreadFit`)·`copilot/cadCopilot`(`SketchProfile`/`SketchConfig`·원형 홀 세그먼트)·`analysis/drawingExport`(`jsPDF`)·`features/nurbsSurface`(`replicad` 타입·`Point2D`·`loft` 캐스트). **F-7:** `useGeometryGC`(`BufferGeometryWithBVH`)·`nexyflowQuoteAPI`(window URL)·`ChangeDetectorPanel`·`PathTracer`·`pdfExport`·`ModelViewer`·`NestingTool`·admin/`login`/`adminlink` `catch (unknown)`. **F-8:** `admin/contracts`·`inquiries` CSV·인덱스 시그니처, `[lang]/nexyfab/admin` 거절 버튼 스타일(`border`), `HomeClient`/랜딩 `dict` 타입, `src/types/browser-globals.d.ts`(reCAPTCHA·Tauri), reCAPTCHA 4페이지·`useAuth`, `lib/storage`(S3Client 타입)·`lib/matching`(`MatchInquiry`/`MatchPartner`)·`api/search`·`api/reviews` POST·`api/files/[contractId]`·admin `db.execute` 캐스트, `analytics` `gtag`/`fbq`, `scad-intent-from-nl`, `serverSolver` 동적 import, `textToSketch`(`Font.generateShapes`), 테스트(`sanitize`·`plan-guard`·`intentToScad`).
- **다음 배치:** `src` 기준 명시적 `any` 잔여는 주석 문구 외 없음 — 신규 코드는 `unknown`/좁히기 유지. vendor·스크립트·`scripts/`는 필요 시 별도 점검.
- **shape-generator 모놀리식:** `ShapeGeneratorInner`는 `ShapeGeneratorApp`에서 **동적 import(별도 번들 청크)**. **라우트:** `/shape-generator/sketch`, `/shape-generator/3d-edit`, `/shape-generator/analysis`는 각각 `ShapeGeneratorClientPage`로 진입·URL 유지; `ShapeGeneratorInner`가 pathname·`?entry=`로 워크스페이스 동기화. 진짜 코드 스플릿(탭별 lazy)은 후속.
- **이메일·3D CTA URL:** `welcomeHtml`·`rfqConfirmationHtml`·`rfqNotificationHtml`이 **`/nexyfab/shape-generator`** 또는 **`/ko/…`** 같이 라우트와 어긋나던 부분을 **`/{kr|en}/shape-generator`**, **`/{kr|en}/nexyfab/rfq/…`** 로 정합 (`nexyfab-email.ts`의 `nexyfabEmailLangPath`). 배포 점검 표는 `docs/3d-tools.md` §11.
- **이메일 로케일:** `NexyfabEmailContentLocale`(ko·en·ja·cn·es·ar) + `nexyfabEmailLocaleFromLanguageTag` / `nexyfabAppLangPathFromEmailLocale` — 환영·RFQ 확인·인증·드립 D+1/D+7 제목·본문(한·영·일·중, es/ar는 영문 본문+해당 `[lang]` 링크), 가입 `language`에 `es`·`ar` 허용, RFQ는 `nf_users.language` 우선.
- **서버사이드 B-Rep API 부재** — 모든 기하 작업 클라이언트 (Phase 4 미래)
- **admin 대시보드 부분 구현** — 이메일 템플릿, RFQ 매칭 미리보기만 있음 (공급사 온보딩 UX 미완)

### 5.2 데이터
- **데모 KPI 노이즈:** 다수 admin API는 `user_id <> 'demo-user'` 패턴으로 격리됨. `GET /api/admin/stage-overview`도 동일 기준으로 Stage 분포·24h 퍼널·DFM 집계에서 sentinel 제외 (2026-05-11).
- **세션 단위 추가 필터**가 필요하면 `nf_sessions.is_demo` 조인으로 코호트별 시리즈를 나눌 수 있음 — 미적용.
- **`dfm-check`:** 비로그인 데모는 `ensureDemoSession` + `nf_dfm_check.session_id` 로 영속화됨 (`/api/nexyfab/dfm-check`).

### 5.3 비즈니스
- **Phase 7-5 (공급사 신뢰·평가):** §6.4와 같이 **차원별** 지표(납기·품질·응답·소통·공정 적합도)로 진행. **스키마 메타 API:** `GET /api/nexyfab/partner-trust-dimensions`. **집계 API:** `GET /api/nexyfab/partner-trust-aggregates?email=&windowDays=` — `nf_partner_metric_events` + `nf_reviews` 보조 평균, 파트너 대시보드·관리자 파트너 목록(모달)에 표시. DB 전용 `nf_partner_*` 테이블·바이어 RFQ 카드 심화는 후속.
- **Phase 8 (마켓플레이스 자체 발견)** 미시작 — 현재 영업 주도 매칭

---

## 6. GTM (Go-To-Market) 단계

> 참조: `project_nexyfab_gtm.md`

### 6.1 전략
- **일괄 출시** — 풀 스코프 빌드 → 한 번에 광고로 고객 확보
- **MVP 반복 ❌** — 고가치 B2B 의사결정자는 "반쯤 만든" SaaS 못 받아들임
- **데모 모드** — 가입 마찰 제거 + 가치 즉시 체험

### 6.2 랜딩 카피 정책 (`feedback_landing_no_mock.md`)
- ✅ 미구현 기능 광고 금지
- ✅ 가치 상실은 데모 모드 진입 버튼으로 상쇄
- ✅ 6개 언어 동시 정정 (KO·EN·JA·CN·ES·AR)

### 6.3 정정된 카피 (Phase D-5)
| 변경 전 | 변경 후 |
|---------|---------|
| NDA 지원 | 익명 매칭 / Anonymous Matching |
| 언더컷·공차 | 벽두께·구멍·드래프트·필렛·종횡비 |
| 보안·NDA | 회사명 비공개 매칭 |
| 10,000+ 협력사 누적 프로젝트 | 6,000+ 검증 인증 보유 파트너 |
| BMS / AI 사례 | 데모 모드 체험 |
| BMS / AI 케이스 | CNC·판금 / 소량 다품종 시제품 |

### 6.4 평가 지표 정책
- 단일 신용점수 ❌
- 차원별 분리: 납기 / 품질 / 응답 속도 / 소통 / 공정 적합도

---

## 7. 다음 우선순위 (Recommended Next)

### 즉시 (1-2주)
1. **Phase 7-5 확장** — `partner-trust-dimensions` + **`partner-trust-aggregates`** 집계·파트너 대시보드·admin 파트너 UI 반영 완료. 후속: 주문/리뷰 이벤트 백필 강화, 바이어 RFQ 카드·파트너 포털 타 화면 확산, `nf_partner_*` 영속 스키마(선택).
2. **admin·BM 운영 보강** — `docs/bm-cron-runbook.md`에 데모 격리(Stage 아웃박스·롤링 분기·stale 스캔) 명시; `stage-worker`가 `demo-user` 이벤트를 알림 없이 소진, `rolling-quarterly-metrics`·`evaluateStaleUsers`에서 `demo-user` 제외. Stage 워커·집계는 `stage-overview`/admin KPI와 동일 sentinel 기준.

### 단기 (1개월)
3. **BM Phase 3 롤링 문서 유지** — 2026-05-12 롤링: `docs/strategy/stage-e-business-account-policy.md`(§4 배치·데모), `bm-logging-coverage.md`(Stage/7-5 행·앵커), `bm-ui-screen-map.md`(ID 20). 이후 갭은 동일 PR 규칙으로 유지.
4. **shape-generator 모놀리식 분리** — sketch / 3d-edit / analysis **3개 라우트(진입·URL·워크스페이스 초기화)** 반영; 번들 단위 탭 분리는 후속
5. **admin 공급사 온보딩 UX 완성** — 인증 검증, 프로필 승인 워크플로우
6. **데모 → 가입 전환 분석 대시보드** — `nf_sessions.claimed_at` 기반

### 중기 (3개월)
7. **Phase 8 마켓플레이스 자체 발견** — 공급사 검색·필터·즐겨찾기
8. **CAM 툴패스 시뮬레이션** — G-code 미리보기
9. **서버사이드 B-Rep 솔버 도입** — OpenCascade.js WASM 또는 자체 백엔드

---

## 8. 현재 작업중 / 블록 없음

작업 중인 활성 태스크: **없음** (Phase D-5 완료로 데모 모드 시리즈 마감)

다음 결정 필요: **Phase 7-5 (공급사 신용·평점)** 착수 시점 vs. shape-generator 분해 등 단기 기술부채.
