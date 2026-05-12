# Stage E — 법인·조직 조건 운영 정책 (G-S1)

**목적:** `bm-matrix.md` §1.1에서 Stage **E** 진입에 쓰는 “법인 또는 팀원 ≥2”를 **제품 자동 판정**과 **운영·컴플라이언스**로 나누어 정의한다.  
**코드 기준:** `src/lib/stage-engine.ts` — `UserStageMetrics.isBusinessAccount`, `orgSize`; DB `nf_users.account_type`, `business_reg_number`, `org_size` 등.

---

## 1. 제품(자동)에서의 “법인” 프록시

엔진은 **문서 검증을 하지 않는다.** 다음은 **휴리스틱**이며, Stage 승급용 신호로만 쓴다.

| 신호 | 해석 |
|------|------|
| `account_type = 'business'` | 사용자가 사업자/법인 계정으로 분류됨(가입·설정 경로에서 설정). |
| `business_reg_number` 비어 있지 않음 | 사업자등록번호 문자열 존재 — **형식·진위 검증은 별도**. |
| `org_size >= 2` | 팀·조직 멤버 수 조건(스펙의 “팀원 ≥2”와 정렬). |

`computeStage`에서 E 후보는 대략  
`누적 ≥ 1억` **그리고** `(org_size ≥ 2 또는 isBusinessAccount)` .

---

## 2. 운영에서 정할 것 (문서·프로세스)

| 질문 | 권장 |
|------|------|
| 사업자번호를 **누가·언제** 검증하는가? | 세금계산서 발행·오프라인 KYC 등 **기존 결제/세무 프로세스**에 맡기고, 제품 플래그는 “자가 신고 + 제한된 혜택”으로 라벨링. |
| 스테이지 E **혜택**(수수료·지원)을 **위 조건 만족** 시 자동 개시할지, **계약서 1회** 후인지? | `bm-matrix.md` §1.3 “혜택은 활성 조건”과 맞춰 `nf_stage_benefit_rules` 수준에서 정의(미구현 시 수동 운영 규칙으로 대체). |
| ERP·맞춤 계약(E→F) | `enterprise_contract` / `erp_integration_contract` — **법적 검토는 항상 오프라인**. |

---

## 3. 감사·분쟁 시

- Stage 이력은 `nf_stage_event`에 `trigger_type`, `trigger_value` JSON으로 남는다.  
- “법인 아닌데 E였다” 분쟁 시 **원본 증빙은 운영 보관 문서**가 단일 진실원천이 되도록 한다.

---

## 4. 관련 운영(Stage 배치·데모)

- Stage **승급 판정 자체**는 본 문서 §1의 `isBusinessAccount` / `org_size` 휴리스틱을 따른다.  
- **배치·크론**(`rolling-quarterly-metrics`, `evaluateStaleUsers`, `stage-worker`)은 `nf_users.id = 'demo-user'` sentinel을 **집계·알림 대상에서 제외**하거나, 아웃박스만 무알림 소진한다 — 법인 판정과는 별개로 운영 KPI·메일 노이즈를 줄이기 위함이다. 상세는 `docs/bm-cron-runbook.md` §관측.

---

## 5. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-11 | Phase 3 — G-S1 운영 경계 명문화 (코드 변경 없음) |
| 2026-05-12 | §4 추가 — Stage 배치·데모 sentinel과 본 정책 문서의 역할 분리 |
