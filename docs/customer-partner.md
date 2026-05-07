# NexyFab 고객·파트너사 기능

> Last updated: 2026-04-23
> Scope: 바이어(고객) 풀 RFQ 워크플로우 + 공급사(파트너) 인박스·정산·매칭 엔진

---

# A. 고객 (Buyer) 기능

## A-1. 인증 (Auth)

`src/app/api/auth/`

| 라우트 | 역할 |
|--------|------|
| `login/` | 이메일·비밀번호 + 에러 트래킹 + 2FA 챌린지 |
| `signup/` | 계정 생성 + 가입 시 데모 데이터 자동 이관 (`tryClaimDemoOnAuth`) |
| `forgot-password/` · `reset-password/` | 토큰 기반 비밀번호 재설정 |
| `verify-email/` · `verify-email-change/` | 이메일 인증 코드 |
| `2fa/` | TOTP (otpauth) 기반 2FA 설정·검증 |
| `oauth/` | Google · GitHub SSO |
| `nexysys/` | HelpAllTech 생태계 크로스 로그인 |
| `change-email/` | 이메일 마이그레이션 |
| `export-data/` · `delete-account/` | GDPR 컴플라이언스 |
| `demo/` | 데모 모드 세션 진입 |

### 보안
- bcrypt cost 12 로 비밀번호 해싱
- 5회 실패 → 15분 계정 락
- IP 이상 탐지 + 자동 잠금 (`recordLoginAndCheck`)
- httpOnly + SameSite=Lax 쿠키 (access 15분 / refresh 30일)
- CSRF origin check 모든 변경 요청

---

## A-2. RFQ 워크플로우

### 페이지
`src/app/[lang]/nexyfab/rfq/page.tsx` (73KB) — RFQ 생성·응답 (데모 모드 활성)

### API
| 엔드포인트 | 동작 |
|------------|------|
| `POST /api/nexyfab/rfq/` | 3D 모델 + DFM 으로부터 RFQ 생성 (auth + demo) |
| `POST /api/nexyfab/rfq/parse/` | OCR / ML 로 벤더 견적 텍스트 파싱 |
| `POST /api/nexyfab/rfq/[id]/dispatch/` | 공급사 매칭 엔진 호출 |
| `POST /api/nexyfab/rfq/[id]/quotes/` | 공급사 응답 수집 |
| `POST /api/nexyfab/rfq/compare/` | 다중 견적 비교 테이블 |
| `POST /api/nexyfab/rfq/repeat/` | 동일 사양으로 신규 공급사에 재 RFQ |
| `rfq-writer/` | AI 어시스트 RFQ 작성 |
| `rfq-responder/` | 공급사 데이터로부터 견적 자동 채움 |

### 컴포넌트
- `QuoteNegotiatorPanel.tsx` (20KB) — 공급사 견적 협상 UI

---

## A-3. 데모 모드 (Phase D)

### 핵심 라이브러리
`src/lib/demo-session.ts`

| 함수 | 역할 |
|------|------|
| `getDemoSession(req)` | `nf_demo_session` httpOnly 쿠키 (7일 TTL) 읽기 |
| `ensureDemoSession(req, res)` | 없으면 생성 + 쿠키 설정 |
| `claimDemoSession(sid, userId)` | 가입 시 원자적 데이터 이관 (UPDATE WHERE session_id + user_id='demo-user') |
| `tryClaimDemoOnAuth(req, res, userId)` | 가입·로그인 라우트의 인라인 hook (멱등) |
| `clearDemoCookie(res)` | claim 후 쿠키 제거 |

### 격리 메커니즘
- `nf_sessions` 글로벌 테이블 — `session_id` FK 가 단일 진실의 소스
- 데모 데이터의 `user_id` 는 sentinel `'demo-user'` (NOT NULL FK 만족)
- 실 소유자 식별은 `session_id`
- 가입 시 `UPDATE ... WHERE session_id = ? AND user_id = 'demo-user'` 단일 트랜잭션

### 적용 범위
- ✅ `nf_dfm_check`
- ✅ `nf_rfqs`
- ✅ `nf_funnel_event`
- (admin 집계 쿼리는 `JOIN nf_sessions WHERE is_demo = false` 추가 필요 — 후속 작업)

### 진입 흐름
1. 랜딩 → "🎯 데모 모드 시작" 버튼
2. `POST /api/nexyfab/demo-session/` → 쿠키 발급
3. 곧장 RFQ 폼 진입 (회원가입 없이)
4. RFQ·DFM 데이터 임시 저장
5. 가입 시 `tryClaimDemoOnAuth` 자동 이관
6. DemoBadge 컴포넌트로 "이 데이터는 가입 전까지 임시" 안내

### 제한
- 데모 IP 당 일 5건 RFQ (auth 사용자와 별도)
- 7일 미가입 시 데이터 무효 (admin 노이즈 방지)
- 이메일 발송·결제·NexyFlow 트리거 모두 스킵

---

## A-4. 견적 비교·주문 흐름

`src/app/[lang]/nexyfab/`

| 경로 | 크기 | 역할 |
|------|------|------|
| `/dashboard/` | 109KB | 프로젝트·RFQ 히스토리 + KPI 요약 |
| `/orders/` | 75KB | 주문 타임라인, 배송 추적, 인보이스 다운로드 |
| `/billing/` | – | 구독·결제 히스토리 (Stripe / Airwallex) |
| `/projects/` | – | 디자인 프로젝트 관리 |
| `/files/` | – | CAD 파일 업로드·버전 관리 |
| `/settings/` | – | 계정 설정, 알림 환경 |
| `/team/` · `/teams/` | – | 조직·워크스페이스 관리 |

---

## A-5. 결제·인보이스

### 결제 게이트웨이
- **Stripe Checkout** — `/api/nexyfab/stripe/checkout/`
- **Airwallex** — 비 KRW 다중 통화 (`nf_aw_customers`, `nf_aw_invoices`, `nf_aw_payment_attempts`)
- **Toss Billing** — KRW (한국) 결제

### 세금
- `tax/quote/` — 국가 + 배송 주소별 실시간 세율 계산
- Stripe Tax API 대체 자체 엔진
- KR 부가세: `nf_tax_invoices_kr` 테이블 + `tax-invoice-kr.ts` PDF 생성기
- 국가별 인보이스 템플릿 (Phase 7-4a.5)

### 컴플라이언스
- OFAC 스크리닝
- GDPR DPA (`nf_dpa_consent`)
- CBAM 로깅 (`nf_cbam_log`)
- HS Code + Incoterms (Phase 7-4a.7)

---

## A-6. 이메일 알림

`src/lib/nexyfab-email.ts`

| 트리거 | 수신자 | 내용 |
|--------|--------|------|
| RFQ 제출 | 공급사 | 매칭 알림 + RFQ 디스패치 템플릿 |
| 견적 수신 | 고객 | 견적 도착 알림 + 비교 링크 |
| 주문 확정 | 고객 | 인보이스 + 추적 링크 |
| 배송 마일스톤 | 고객 | Stripe / FedEx 웹훅 연동 업데이트 |
| 견적 60일 정체 | 고객 | 재 RFQ 제안 (`nf_quote_remind_log`) |
| 결제 실패 | 고객 | 재시도 + 환불 상태 |
| 가입 환영 | 신규 회원 | `welcomeHtml(name, lang)` |

### 인프라
- **Resend API** — 1차
- **SendGrid** — 폴백
- **Nodemailer** — 직접 SMTP (백업)
- 발신 이메일: `nexyfab@nexysys.com`

---

## A-7. 대시보드·프로젝트 관리

- KPI 스파크라인: 주문량·지출·납기시간
- 프로젝트 상태 타임라인: submitted → matching → rfp_sent → quotes_received → confirmed → contracted
- 활동 로그: 100건 페이지네이션
- 파일 버전 히스토리 + 시각 diff (`ShapeVersionDiff.tsx`)
- 팀 협업: 실시간 세션 (`nf_collab_sessions`)

---

# B. 파트너 (Supplier) 기능

## B-1. 파트너 인증

`src/app/api/partner/`

| 라우트 | 역할 |
|--------|------|
| `auth/login/` | 공장·공급사 로그인 |
| `register/` | 공급사 온보딩 폼 |
| `profile/` | 능력·가격 시트 업로드 |
| `send-token/` | 팀원 초대 토큰 |

테이블: `nf_partner_sessions`, `nf_partner_tokens`, `nf_factories` (공급사 디렉토리)

---

## B-2. 공급사 대시보드·인박스

| 라우트 | 역할 |
|--------|------|
| `dashboard/` | RFQ 인박스, 견적 파이프라인, 정산 개요 |
| `orders/` | 이행 추적, 배송 업데이트, 반품 |
| `quotes/` | 견적 작성, 고객 협상 응답 |
| `notifications/` | RFQ 할당 / 견적 검토 마감 / 결제 처리 알림 |
| `metrics/` | 성과 KPI (응답 시간·이행률·평점) |
| `ai-history/` | 견적 패턴 학습 (비용 히스토리·납기 트렌드) |

---

## B-3. 가격·능력 관리

### 업로드
- `profile/` 업로드 — CSV / PDF 가격표 + 공정 능력 매트릭스
- `partner-pricebook.ts` — 가격 룰 파싱·캐시 (재료 × 공정 × 수량 단계)

### 노출
- `list/` — 공급사 발견 (B2B 마켓플레이스용 공개 프로필 카드)

---

## B-4. RFQ 매칭 엔진

`src/app/api/nexyfab/`

| 엔드포인트 | 역할 |
|------------|------|
| `supplier-matcher/` | 기하 적합도 + 능력 + 납기 + 비용으로 공급사 점수 산출 |
| `capacity-match/` | 제약 조건 솔버 (이 공장이 이 공정 가능?) |
| `process-router/` | 기하 → 최적 공정 (CNC / 사출 / 3D 프린트 / 판금) |
| `cert-filter/` | ISO·항공우주 인증 요구 필터링 |

매칭 점수는 `nf_stage_event.metadata` 에 감사 추적용 저장.

### 평가 차원 (단일 신용점수 ❌, 다차원 분리)
- 납기 준수율
- 품질 (불량률)
- 응답 속도
- 소통 능력
- 공정 적합도

---

## B-5. 정산·인보이스

| 엔드포인트·테이블 | 역할 |
|------------------|------|
| `settlements/` | 정기 정산 (일·주·월) |
| `settlement-pdf/` | 세금 인보이스 PDF 생성 |
| `commissions/` 테이블 | 플랫폼 수수료 계산 (5–15% 슬라이딩) |
| 다중 통화 | 공급사 자국 통화 인보이스 발행 |
| Wise / Remitly | 국제 송금 |

---

## B-6. 익명 매칭 (Privacy-First)

- 매칭 단계에서 고객사명 비공개
- `회사명 비공개 매칭` (NDA 대체 카피, Phase D-5 정정)
- 프로젝트 정보는 내부 검토 범위 내에서만 공유

---

# C. 데이터 모델 (Customer + Partner)

## C-1. 인증·세션
- `nf_users` — 사용자 (cross-service `services` JSON, `*_plan` 컬럼)
- `nf_refresh_tokens` — 30일 refresh, 동시 세션 무효화
- `nf_password_reset_tokens` · `nf_verification_codes`
- `nf_sso_config` · `nf_login_history` · `nf_security_alerts`
- `nf_sessions` — 데모 + 인증 세션 통합 (Phase D)

## C-2. 커머스
- `nf_rfqs` — RFQ (session_id FK 추가됨)
- `nf_quotes` — 견적
- `nf_orders` — 주문
- `nf_settlements` — 정산
- `nf_aw_invoices` · `nf_aw_payment_attempts` — Airwallex
- `nf_tax_invoices_kr` — 한국 세금 인보이스

## C-3. 퍼널·DFM
- `nf_dfm_check` — DFM 결과 (session_id FK)
- `nf_funnel_event` — 사용자 행동 (session_id FK)
- `nf_stage_event` — Stage 전환 outbox
- `nf_quote_remind_log` — 60일 정체 견적 알림

## C-4. 조직·팀
- `nf_orgs` · `nf_org_members` · `nf_org_invites`
- `nf_teams` · `nf_team_members` · `nf_teams_invites`

## C-5. 콘텐츠
- `nf_projects` · `nf_files` · `nf_shares`
- `nf_comments` · `nf_collab_sessions` · `nf_bundles`

## C-6. 파트너
- `nf_factories` — 공급사 디렉토리
- `nf_partner_sessions` · `nf_partner_tokens`

## C-7. 분석·컴플라이언스
- `nf_usage_events` · `nf_ai_history` · `nf_billing_analytics`
- `nf_audit_log` · `nf_cad_access_log`
- `nf_dpa_consent` · `nf_cbam_log`
- `nf_defects` · `nf_rma` · `nf_margin_breakdown`

---

# D. 핵심 라이브러리 (`src/lib/`)

| 파일 | 역할 |
|------|------|
| `stage-engine.ts` | 사용자 라이프사이클 A→F 전환 + high-water-mark |
| `stage-worker.ts` | 비동기 이벤트 처리 (`nf_stage_event` 폴링) |
| `stage-notifications.ts` | Stage 승격 업셀 이메일 템플릿 |
| `demo-session.ts` | nf_sessions 격리 + 세션→사용자 이관 |
| `dfm-rules.ts` | 10+ DFM 룰 |
| `nexyfab-email.ts` | 템플릿 로딩 + RFQ·주문·정산 이메일 디스패치 |
| `partner-pricebook.ts` | 공급사 가격 CSV 파싱 + 수량 단계 적용 |
| `partner-metrics.ts` | 공급사 KPI 집계 |
| `airwallex-client.ts` | 다중 통화 결제 + 웹훅 |
| `tax-engine.ts` | 세율 조회 + 인보이스 생성 |
| `tax-invoice-kr.ts` | 한국 세금 인보이스 (부가세) PDF |
| `job-queue.ts` | 비동기 작업 러너 (RFQ 디스패치·정산) |
| `rate-limit.ts` | IP + 사용자 throttling |
| `compliance.ts` | OFAC + CBAM + DPA |
| `shadow-logger.ts` | 비차단 이벤트 로깅 |
| `login-security.ts` | IP 이상 탐지 + 계정 자동 잠금 |
| `nexyfab-funnel-logger.ts` | 데모/auth 통합 퍼널 로거 |
