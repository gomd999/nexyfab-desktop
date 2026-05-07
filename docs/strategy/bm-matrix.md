# NexyFab BM Matrix — Stage·Pricing·Data Monetization Spec

| Field | Value |
|---|---|
| Version | 1.0 (2026-04-23) |
| Scope | 제품 인벤토리·문맥상 다수 기능 범위 + Stage UI 매트릭스(**표준 번호 32개**, 코드 `bm-matrix-stage-ui.ts`) + 과금·데이터 로드맵 |
| Baseline | KRW 기준, 환 FX는 `captureFxQuote` 스냅샷 사용 |
| Status | 빌드는 풀스코프, 노출은 Stage 기반 (GTM 원칙: 일괄 출시) |

이 문서는 기획서가 아니라 **엔지니어링 스펙**이다. UI 가시성, DB 필드, ENUM, 이벤트 계약을 코드가 참조할 수 있도록 못 박아둔다.

---

## 1. Stage State Machine

### 1.1 Stage 정의

| Stage | 이름 | 진입 조건 | Exit 조건 (다음 Stage 진입) |
|-------|------|----------|---------------------------|
| **A** | 탐색자 | 가입 완료 + 주문 0건 | 결제 성공 1건 |
| **B** | 첫 거래 준비 | 견적 수락 + 결제 진행 중 | 결제 완료(→C) OR 타임아웃 180일(→A) |
| **C** | 첫 거래 완료 | 완료 주문 1건 + 누적 < 5천만 | 주문 2건↑ OR 누적 ≥ 5천만 |
| **D** | 반복 고객 | 완료 주문 ≥2건 OR 누적 ≥ 5천만 | 누적 ≥ 1억 + (법인 또는 팀원 ≥2) |
| **E** | 중견 고객 | 누적 ≥ 1억 + (법인 또는 팀원 ≥2) — 법인은 `account_type=business` 또는 사업자등록번호 존재로 프록시 | 분기 발주 ≥ 1억 지속 3개 분기 OR ERP 연동 계약 |
| **F** | 기업 락인 | 위 조건 + 맞춤 계약 체결 | — (최종) |

### 1.2 Stage별 UI 노출 매트릭스

아래 표는 **Stage 컬럼이 적용되는 기능 번호 32개**(행 수 = `BM_MATRIX_STAGE_UI_FEATURE_IDS.length`). 제품 전체 인벤토리·백엔드 전용 번호는 §1.2 하단·별도 목록 참고. **📌 = 항상 노출(Day 1)**, **🔓 = 해당 Stage 진입 시 해금**, **🔒 = 해금 안 됨(숨김 또는 업셀 프롬프트만)**. 코드 단일 출처: `src/lib/bm-matrix-stage-ui.ts`.

| 기능 | A | B | C | D | E | F |
|------|---|---|---|---|---|---|
| 1 DFM 자동 검증 | 📌 | 📌 | 📌 | 📌 | 📌 | 📌 |
| 2 Tooling BEP | 📌 | 📌 | 📌 | 📌 | 📌 | 📌 |
| 3 재료·공정 어드바이저 | 📌 | 📌 | 📌 | 📌 | 📌 | 📌 |
| 5 RFQ 자연어→구조화 | 📌 | 📌 | 📌 | 📌 | 📌 | 📌 |
| 7 AI 매칭 | 📌 | 📌 | 📌 | 📌 | 📌 | 📌 |
| 23 다품종 번들링 | 📌 | 📌 | 📌 | 📌 | 📌 | 📌 |
| 8 HS Code 추론 | 🔒 | 🔓 | 🔓 | 🔓 | 🔓 | 🔓 |
| 25 Escrow 플로우 | 🔒 | 🔓 | 🔓 | 🔓 | 🔓 | 🔓 |
| 12 단계별 프로젝트 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 | 🔓 |
| 21 마진 분해 | 🔒 | 🔒 | 🔓 티저 | 🔓 | 🔓 | 🔓 |
| 22 재주문 원클릭 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 | 🔓 |
| 13 FAI 워크플로우 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 14 FAI 체크리스트 자동생성 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 15 공정별 사진 체크포인트 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 17 파트너 PWA(사진 수신) | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 20 다차원 스코어카드 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 16 간트/WIP 대시보드 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 11 납기 리스크 예측 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 9 견적 비교 매트릭스 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 | 🔓 |
| 10 견적 요약 에이전트 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 | 🔓 |
| 18 결함 택소노미 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 19 RMA 워크플로우 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 27 CAD 워터마킹 뷰어 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 28 접근 로그 이상탐지 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 35 2FA + 장치 신뢰 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 36 사내 권한 매트릭스 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 37 전체 Audit log (뷰) | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 24 예측 재고 발주 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 | 🔓 |
| 38 Webhook/API | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 |
| 39 메신저 봇 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 |
| 40 데이터 내보내기 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 |
| 41 계약서 조항 추출 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔓 |

**백엔드에서만 작동(노출 없음, 숨겨진 무기)**: 26 해시체인 감사로그, 30 CBAM CO2e 로깅, 32 운임 Calculator, 41 계약서 조항(초기엔 내부용)

### 1.3 Stage 전환 예외 처리 및 롤백 정책

**기본 원칙: "High-Water Mark" — 한 번 올라간 Stage는 자동 강등되지 않는다.**

| 이벤트 | 처리 |
|-------|------|
| 환불 발생 → 누적액 감소 | `cumulative_order_krw` 필드는 정확히 차감. `stage`는 **유지**. |
| 주문 취소 | 동일하게 누적액 차감, Stage 유지. |
| 팀원 탈퇴 → org_size 감소 | Stage E 진입 조건이 깨져도 강등 없음. |
| 분기 발주액 급감 | Stage F 고객도 자동 강등 없음. SaaS 구독 계약 조항이 해지 근거. |
| 사기·컴플라이언스 위반 | **강제 강등 O** — 관리자 수동으로 Stage A로 리셋, `stage_event.trigger_type = 'manual_override'`. |
| 계정 장기 비활성 (18개월) | 자동 강등 대신 "휴면 전 고지" 플래그만. 재로그인 시 플래그 해제. |

**이유**:
1. 강등되는 순간 고객은 "플랫폼이 나를 평가한다"고 느껴 이탈. 서비스 신뢰 훼손.
2. 코드 단순성: 전환 조건을 만족하는 순간 `MAX(current_stage, computed_stage)`만 쓰면 됨. 역방향 로직 불필요.
3. 예외(사기)는 `manual_override` 한 경로만 존재 → 감사 가능.

**Stage 활성화 요건과 '등급 유지' 분리**:
- 등급(`users.stage`)은 high-water mark.
- 등급에 딸린 **혜택 일부**는 "활성 조건 유지 시에만" 적용. 예: Stage E의 "Escrow 수수료 면제"는 최근 6개월 발주가 있을 때만 적용.
- 이 구분을 `nf_stage_benefit_rules` 테이블로 표현.

### 1.4 Stage 계산 주기

| 필드 | 갱신 시점 | 주체 |
|------|----------|------|
| `cumulative_order_krw` | 이벤트 | `payment_succeeded`, `refund_processed` 핸들러 |
| `order_count_success` | 이벤트 | `order_delivered` 핸들러 |
| `quarterly_order_krw` | 일배치 (02:00 KST) | `POST /api/jobs/rolling-quarterly-metrics` — `rolling-quarterly-metrics.ts` 직전 90일 `nf_orders` 합산 |
| `quarterly_order_krw_history` | 분기(또는 배치가 확정한 구간) 종료 시 | JSON `[t-2,t-1,t]` KRW 합계. `POST /api/jobs/quarterly-stage-roll` → `rollQuarterlyOrderKrwHistoryJson` 로 갱신 후 §1.1 E→F 3구간 연속 1억+ 판정에 사용 |
| `last_quarterly_history_roll_period` | 위 잡이 처리한 **완료 분기 키** (`YYYY-Qn`, 서울 기준) | 동일 분기 재롤 방지(idempotent) |
| `enterprise_contract` | 관리·계약 API | `true`이면 Stage **F** (맞춤 계약 경로) |
| `erp_integration_contract` | 관리·계약 API | `true`이면 Stage **F** (ERP 연동 계약 경로) |
| `org_size` | 이벤트 | 팀원 가입/탈퇴 |
| `stage` | 이벤트 | 위 필드 변경 직후 `evaluateStage(userId)` 호출 |

모든 Stage 전환은 `nf_stage_event` Outbox에 쓰고, 별도 워커가 UI 플래그·업셀 이메일·알림을 트리거 (idempotency 보장).

---

## 2. Pricing Table

### 2.1 거래 수수료 (Transaction Fee) — Marginal Fee 구조

**구간별 차등 수수료**. 총액에 평균율이 아니라 구간별로 쪼개서 계산.

| 구간 (주문 1건 기준) | 한계 수수료율 |
|---------------------|---------------|
| 0 ~ 500만 | 5.0% |
| 500만 ~ 5,000만 | 4.0% |
| 5,000만 ~ 5억 | 3.0% |
| 5억 초과 | 2.0% |

**예시: 7,000만원 주문**
```
500만 × 5.0%   =  25만
4,500만 × 4.0% = 180만
2,000만 × 3.0% =  60만
합계:            265만 (실효 3.78%)
```

**이 구조의 의미**: 한 번의 큰 주문을 쪼개 여러 건으로 내도 총 수수료는 동일 → 행동 왜곡 없음.

### 2.2 성과 수수료 (Success Fee)

| 항목 | 요율 | 정산 기준 |
|------|------|----------|
| 번들링 절감액 공유 | 절감액의 **20%** (고객 환원 80%) | 번들 확정 시 |
| 재견적 최적화 보상 | 단가 10%↓ 달성 시 **절감액의 15%** | 재발주 완료 시 |
| 납기 단축 보너스 | 약정 대비 3일+ 단축 시 **건당 30만원** | 배송 완료 확인 시 |

### 2.3 서비스 수수료 (Service Fee)

| 서비스 | 요율/단가 | 활성 조건 |
|--------|----------|----------|
| 검수 대행 (QC 위탁) | 주문액의 **1%** | 옵션 |
| FAI 리포트 작성 | 건당 **30만원** | Stage D+ |
| 품질 보험 (Phase B) | 주문액의 **0.5~1%** (불량률 기반) | Stage E+, Month 12+ |
| Escrow 수수료 | 주문액의 **0.3%** (Stage E+ 면제) | Stage B+ |

### 2.4 SaaS 구독 (Enterprise) — Stage E/F 대상

| 플랜 | 월 구독료 | 포함 | 초과분 |
|------|----------|------|--------|
| Starter | 30만원 | 월 50건 RFQ, API 1,000회/일 | 건당 3만원, 호출당 50원 |
| Pro | 150만원 | 월 500건, ERP 연동 1개, 팀원 20명 | 건당 2만원, 연동 추가 건당 월 50만원 |
| Enterprise | 500만원~ | 맞춤 계약 | MFN 조항 적용 |

### 2.5 데이터 API (Phase B, Month 12+)

| API | 호출당 | 기본 포함 |
|-----|--------|----------|
| HS Code 추론 | 100원 | 월 1만 호출 (Pro 이상 무료) |
| CBAM CO2e 계산 | 500원 | 월 1천 호출 |
| 원가 벤치마크 쿼리 | 2,000원 | Enterprise 전용 |
| 결함률 벤치마크 | 3,000원 | Enterprise 전용 |

### 2.6 커스텀 견적 규칙 (Enterprise Negotiation)

**적용 대상**:
- 분기 발주 ≥ 5억 OR 연간 발주 ≥ 20억
- 다기관 공공 프로젝트 (방사청·한국전력 등)
- 전략 파트너십 (공동 브랜드, 독점 공급)

**협상 가능 조항**:
- **Tiered Volume Discount**: 표준 한계 수수료율을 연간 누적액 기준 추가 할인. 예: 연간 10억↑ 구간 전체에 2.5%, 20억↑ 2.0%.
- **Cap Pricing**: 월 수수료 총액 상한 (예: 월 5,000만원 cap).
- **MFN (Most Favored Nation) 조항**: "동일 규모 고객에게 더 좋은 조건을 제공하지 않음"을 계약서에 명시.
- **Exit Ramp**: 계약 해지 시 데이터 이관 비용·기간.

**내부 승인 라인**:
- 표준 요율 80% 이하: 영업 이사 승인
- 70% 이하: CEO 승인
- 무료 파일럿: CTO 공동 승인 (기술 리소스 소요)

---

## 3. Data Monetization Roadmap

### 3.1 숨겨진 무기별 숙성 → 상품화

| 자산 | M0-M6 | M6-M12 | M12-M18 | M18-M24 |
|------|-------|--------|---------|---------|
| **26 해시체인 감사로그** | 로깅만 | 내부 감사 대응 | IP 보호 SaaS 베타 | 제3자 공증 상품 |
| **30 CBAM CO2e** | 로깅만 | 수출 고객에 수동 리포트 | ESG 인증 대행 베타 | EU 바이어용 자동 리포트 판매 |
| **32 운임 데이터** | 로깅만 | 자체 견적 정확도 개선 | 물류사 제휴 레버리지 | 직접 물류 BM 검토 |
| **8 HS Code 추론** | 로깅+추론 | 정확도 지표 공개 | 관세 컨설팅 API 베타 | 외부 eCommerce 대상 API 상품 |
| **18 결함 택소노미** | 스키마 정규화 | 파트너별 히트맵 | 업계 평균 벤치마크 | **품질 보험 BM 런칭** |
| **19 RMA 로그** | 로깅만 | 분쟁 중재 내부 도구 | 보험 언더라이팅 데이터 | 재보험사 협업 |
| **21 마진 분해** | 로깅만 | 내부 파트너 관리 | 업계 원가 벤치마크 상품 | 공급망 컨설팅 |

### 3.2 상품화 발사 조건 (Launch Gate)

각 데이터 상품은 **발사 조건 3개**를 모두 충족할 때만 런칭:

1. **샘플 크기**: ≥ 1,000건의 독립 관측치
2. **다양성**: 최소 5개 공정, 3개 국가 커버
3. **정확도**: 내부 backtesting에서 예측 오차 ±15% 이내

조건 미충족 상태에서 상품화 금지 (데이터 품질 리스크 > 수익).

### 3.3 데이터 거버넌스

- **파트너 식별 정보는 집계·익명화**해서만 외부 판매. 개별 파트너의 단가·결함률을 식별 가능 형태로 판매 금지.
- **고객 CAD·BOM은 절대 상품화 금지** — 해시·메타데이터만 활용.
- **해시체인 로그 자체**는 공증 상품으로 판매 가능 (고객 동의 기반).

---

## 4. 엔지니어링 인터페이스

### 4.1 Stage 판정용 DB 필드

`nf_users`에 추가할 컬럼:

```sql
ALTER TABLE nf_users ADD COLUMN stage                 TEXT    NOT NULL DEFAULT 'A';
ALTER TABLE nf_users ADD COLUMN stage_since           BIGINT;
ALTER TABLE nf_users ADD COLUMN cumulative_order_krw  DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_users ADD COLUMN order_count_success   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nf_users ADD COLUMN quarterly_order_krw   DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_users ADD COLUMN quarterly_order_krw_history TEXT NOT NULL DEFAULT '[0,0,0]';
ALTER TABLE nf_users ADD COLUMN enterprise_contract   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE nf_users ADD COLUMN erp_integration_contract BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE nf_users ADD COLUMN last_quarterly_history_roll_period TEXT;
ALTER TABLE nf_users ADD COLUMN org_size              INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nf_users ADD COLUMN last_order_at         BIGINT;

-- Stage 판정 결과는 항상 MAX(current, computed) — 강등 방지
-- CHECK 제약으로 스테이지 문자열 도메인 고정
ALTER TABLE nf_users ADD CONSTRAINT stage_domain
  CHECK (stage IN ('A','B','C','D','E','F'));
```

### 4.2 Stage 이벤트 Outbox

```sql
CREATE TABLE nf_stage_event (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES nf_users(id),
  from_stage      TEXT    NOT NULL,
  to_stage        TEXT    NOT NULL,
  trigger_type    TEXT    NOT NULL, -- ENUM 아래 참조
  trigger_value   TEXT,             -- JSON: 트리거 당시 스냅샷
  occurred_at     BIGINT  NOT NULL,
  processed_at    BIGINT,           -- 워커가 UI/이메일 처리 완료 시 세팅
  CONSTRAINT stage_event_trigger_domain CHECK (
    trigger_type IN ('first_order','cumulative_krw','order_count',
                     'org_promotion','quarterly_volume','enterprise_contract',
                     'manual_override','compliance_demotion')
  )
);
CREATE INDEX idx_stage_event_unprocessed ON nf_stage_event(processed_at) WHERE processed_at IS NULL;
```

**UPDATE 금지** — 이 테이블은 append-only. 감사 가능성 유지.

### 4.3 로깅 스키마 가드레일 (핵심 보강)

**원칙**: ENUM 컬럼은 반드시 별도 lookup 테이블 FK로 구현. 문자열 자유 입력 금지. Phase 1에 동결, 확장은 migration으로만.

#### 4.3.1 ENUM 테이블 (Phase 1 동결)

```sql
CREATE TABLE nf_enum_defect_cause (
  code        TEXT PRIMARY KEY,
  label_ko    TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
-- 초기 값:
-- dimensional, surface, material, assembly, packaging, documentation, other

CREATE TABLE nf_enum_process_step (
  code        TEXT PRIMARY KEY,
  label_ko    TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
-- 초기 값:
-- cnc, injection, printing, finishing, qc, packaging, shipping

CREATE TABLE nf_enum_severity (
  code        TEXT PRIMARY KEY,
  label_ko    TEXT NOT NULL,
  weight      REAL NOT NULL  -- 스코어 계산용 가중치
);
-- 초기 값: critical(1.0), major(0.5), minor(0.15)
```

#### 4.3.2 결함·RMA 테이블 (18·19 지원)

```sql
CREATE TABLE nf_defects (
  id              TEXT    PRIMARY KEY,
  order_id        TEXT    NOT NULL REFERENCES nf_orders(id),
  cause_code      TEXT    NOT NULL REFERENCES nf_enum_defect_cause(code),
  process_step    TEXT    NOT NULL REFERENCES nf_enum_process_step(code),
  severity        TEXT    NOT NULL REFERENCES nf_enum_severity(code),
  quantity_affected INTEGER NOT NULL CHECK (quantity_affected > 0),
  reported_at     BIGINT  NOT NULL,
  reported_by     TEXT    NOT NULL, -- user_id or partner_email
  evidence_urls   TEXT,  -- JSON array
  resolved_at     BIGINT
);
CREATE INDEX idx_defects_order   ON nf_defects(order_id);
CREATE INDEX idx_defects_partner ON nf_defects(cause_code, process_step);

CREATE TABLE nf_rma (
  id              TEXT    PRIMARY KEY,
  order_id        TEXT    NOT NULL REFERENCES nf_orders(id),
  defect_id       TEXT    REFERENCES nf_defects(id),
  resolution      TEXT    NOT NULL
    CHECK (resolution IN ('refund','replace','repair','rejected','pending')),
  refund_krw      DECIMAL(18,2),
  created_at      BIGINT  NOT NULL,
  resolved_at     BIGINT
);
```

#### 4.3.3 마진 분해 (21 지원)

```sql
CREATE TABLE nf_margin_breakdown (
  order_id          TEXT PRIMARY KEY REFERENCES nf_orders(id),
  material_krw      DECIMAL(18,2) NOT NULL,
  labor_krw         DECIMAL(18,2) NOT NULL,
  machine_krw       DECIMAL(18,2) NOT NULL,
  overhead_krw      DECIMAL(18,2) NOT NULL,
  platform_fee_krw  DECIMAL(18,2) NOT NULL,
  partner_payout_krw DECIMAL(18,2) NOT NULL,
  total_krw         DECIMAL(18,2) NOT NULL,
  -- 총합 불일치 방지
  CONSTRAINT margin_sum_check CHECK (
    material_krw + labor_krw + machine_krw + overhead_krw
    + platform_fee_krw + partner_payout_krw = total_krw
  )
);
```

#### 4.3.4 번들링 (23 지원)

```sql
CREATE TABLE nf_bundles (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL,
  process_step  TEXT NOT NULL REFERENCES nf_enum_process_step(code),
  material_code TEXT NOT NULL,
  savings_krw   DECIMAL(18,2) NOT NULL CHECK (savings_krw >= 0),
  created_at    BIGINT NOT NULL
);

CREATE TABLE nf_bundle_orders (
  bundle_id   TEXT NOT NULL REFERENCES nf_bundles(id),
  order_id    TEXT NOT NULL REFERENCES nf_orders(id),
  PRIMARY KEY (bundle_id, order_id)
);
```

### 4.4 로깅 의무 필드 체크리스트 (Phase 1 빌드부터 수집)

| 이벤트 | 반드시 기록할 필드 | 대상 테이블 |
|--------|------------------|------------|
| 주문 결함 신고 | cause_code, process_step, severity, quantity_affected, evidence_urls | `nf_defects` |
| 견적 거부 | reject_reason_code(ENUM), alternative_suggested(bool) | `nf_quotes_reject_log` (신규) |
| 번들링 확정 | bundle_id, included_order_ids, savings_krw | `nf_bundles`, `nf_bundle_orders` |
| 환불 처리 | refund_type ∈ {quality, cancelled_buyer, cancelled_seller, compliance}, refund_krw | `nf_refunds` (기존 확장) |
| Stage 전환 | from_stage, to_stage, trigger_type, trigger_value(JSON) | `nf_stage_event` |
| CAD 접근 | user_id, file_id, access_type, ip, user_agent | `nf_cad_access_log` (신규) |
| CBAM 로깅 | material_kg, process_energy_kwh, co2e_kg | `nf_cbam_log` (신규) |

### 4.5 이벤트 계약 (Outbox Pattern)

모든 Stage 전환과 상태 변경은 **Outbox에 쓰고 워커가 처리**. 직접 UI/이메일/알림 호출 금지.

이유:
- Stage 롤백·재계산 시 이력으로 backfill 가능
- 업셀 이메일 중복 발송 방지 (idempotency)
- A/B 테스트(특정 전환 UI 변주) 프레임워크 재활용

구현 위치: `src/lib/stage-engine.ts` (신규) — `evaluateStage(userId)` → outbox insert 핸들러.

---

## 5. 검증·운영 체크리스트

Phase 1 빌드 중 수시로 확인:

- [ ] 모든 ENUM 컬럼이 lookup 테이블 FK를 가진다 (문자열 자유 입력 0건)
- [ ] `nf_stage_event`는 UPDATE 권한이 revoked (append-only)
- [ ] `evaluateStage`가 항상 `MAX(current, computed)` 규칙으로 등급 계산
- [ ] Stage×플랜 게이트가 `BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS` 단일 표로 유지·리비전 관리 (`planLimits.ts`)
- [ ] Margin sum CHECK 제약이 프로덕션에서 작동
- [ ] CBAM/HS/결함 로깅이 Stage A부터 즉시 활성 (상품화는 나중이어도 데이터는 지금부터)
- [ ] 가격 정책 변경은 effective_from 타임스탬프로 버전 관리 (과거 주문 재계산 방지)

---

## 6. 관련 문서

- **코드·UI ↔ 본 문서 갭 목록(롤링):** [BM_MATRIX_CODE_GAP.md](./BM_MATRIX_CODE_GAP.md)
- 기능 42개 원본: `docs/strategy/feature-inventory-2026-04.md` (작성 예정)
- Phase 7-4a 멀티통화·컴플라이언스 구현: `docs/database-migration.md` v58-v60
- 파트너 다차원 평가: memory `feedback_metric_design.md`
- GTM 원칙: memory `project_nexyfab_gtm.md`
