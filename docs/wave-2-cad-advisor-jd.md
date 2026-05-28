# Senior CAD/CAM Advisor (Part-time / Consultant)

**NexyFab — Wave 2 (2026 Q3 ~ 2027 Q2) CAD Domain Advisor Job Description**

문서 버전: v1.0 (2026-05-28)
작성: NexyFab 1인 개발팀 (Founder)
대상: 한국 또는 해외 거주 senior CAD/CAM engineer

---

## 0. TL;DR (요약)

> **NexyFab은 12개월 안에 Onshape 수준의 클라우드 CAD를 ship 하려는 1인 개발 스타트업입니다. 매월 1-2회 1시간 미팅 + Slack ad-hoc 응답으로 도메인을 검증해 줄 senior CAD/CAM advisor 1명을 찾습니다. 보상은 연 $5-15K (월 retainer $400-1,200) 또는 시간당 $100-200. 6개월 trial → 분기별 갱신.**

> **NexyFab is a solo-founder startup building Onshape-parity cloud CAD within 12 months. We're looking for one senior CAD/CAM advisor to validate the domain via 1-2 hours/month of video meetings + ad-hoc Slack responses. Compensation: $5-15K/year ($400-1,200/month retainer) or $100-200/hour. 6-month trial → quarterly renewal.**

---

## 1. 회사 소개 / About NexyFab

### 한국어

NexyFab은 한국 제조업을 위한 **클라우드 CAD/CAM 통합 플랫폼**입니다. 두 축으로 운영됩니다.

1. **B2B Marketplace** — 발주처 (제조 기업) ↔ 가공업체 (CNC / 판금 / 사출 / 3D 프린팅) 매칭 및 RFQ/견적/품질관리 워크플로우
2. **Cloud CAD/CAM** — 브라우저에서 모델링 → 도면화 → DFM 분석 → 가공업체 자동 견적 → CAM 후처리까지 endless integration

기술 스택:
- Frontend: Next.js + replicad (OpenCascade WASM) + Three.js
- Backend: Node.js + PostgreSQL (Railway) + Cloudflare R2/Workers
- AI 레이어: DeepSeek / Anthropic / OpenAI multi-provider chain
- Kernel: replicad (OpenCascade.js) — STEP/IGES interop

현재 상태 (2026-05 기준):
- Wave 1 (CAD focus 17주) 진행 중 — OCCT geometry/topology core 안정화
- Burn-in 결과: OCCT 11/11 PASS, STEP round-trip stable
- Wave 2 진입 시점 (2026-08~) 부터 도메인 깊이 강화 필요

### English

NexyFab is a **cloud CAD/CAM integration platform** for the Korean manufacturing industry, operating on two axes:

1. **B2B Marketplace** — Buyer (manufacturers) ↔ Supplier (CNC / sheet metal / injection molding / 3D printing) matching, RFQ, quoting, and quality management workflows.
2. **Cloud CAD/CAM** — End-to-end integration in the browser: modeling → drawing → DFM analysis → automatic supplier quoting → CAM post-processing.

Tech stack:
- Frontend: Next.js + replicad (OpenCascade WASM) + Three.js
- Backend: Node.js + PostgreSQL (Railway) + Cloudflare R2/Workers
- AI layer: DeepSeek / Anthropic / OpenAI multi-provider chain
- Kernel: replicad (OpenCascade.js) — STEP/IGES interop

Current status (as of 2026-05):
- Wave 1 (17-week CAD focus sprint) in progress — OCCT geometry/topology core hardening
- Burn-in results: OCCT 11/11 PASS, STEP round-trip stable
- Wave 2 (starting ~2026-08) requires deeper domain expertise

---

## 2. 왜 advisor가 필요한가 / Why we need an advisor

### 한국어

Founder 1인이 Claude (Anthropic LLM)를 max parallel로 사용해 12개월 내 Onshape parity ship을 목표합니다. 코드 작성/리팩터링 속도는 충분하지만, **CAD 도메인의 "맞다/틀리다" 판정**은 LLM 만으로 보장이 어렵습니다. 특히:

- **Sheet metal bend allowance** — K-factor / Y-factor / 실측 vs 표 공차 → 가공업체가 실제로 굽힐 수 있는 도면 vs 책상 위 도면의 차이
- **GD&T (ASME Y14.5 / ISO 1101 / ISO GPS)** — 데이터 텀, MMC/LMC, profile tolerance, runout, 자유도 매트릭스 등 표준의 미묘한 정합
- **CAM post-processor** — controller (Fanuc / Heidenhain / Mazak / Siemens 840D) 별 G-code dialect, retract strategy, work offset 처리
- **FEA boundary condition** — 메쉬 분할, 접촉 조건, 비선형 vs 선형 해석 결과의 해석 가능성

이런 판정을 reviewer 없이 LLM에 위임하면 "코드는 컴파일되지만 실 가공업체가 "이건 못 만든다" 하는 도면"이 양산됩니다. Advisor는 **분기별 architectural review + 월간 issue 점검 + ad-hoc 질의응답** 으로 이 risk를 차단합니다.

### English

The founder builds with Claude (Anthropic LLM) in max-parallel mode, targeting Onshape parity in 12 months. Code velocity is sufficient, but **CAD domain "right vs wrong" judgment** cannot be reliably outsourced to LLMs alone. Specifically:

- **Sheet metal bend allowance** — K-factor / Y-factor / empirical vs tabulated tolerances → the gap between a drawing a real fabricator can bend and one that only exists on paper
- **GD&T (ASME Y14.5 / ISO 1101 / ISO GPS)** — datum references, MMC/LMC, profile tolerance, runout, degree-of-freedom matrices, and the subtle correctness of standards application
- **CAM post-processor** — controller-specific G-code dialects (Fanuc / Heidenhain / Mazak / Siemens 840D), retract strategies, work offset handling
- **FEA boundary conditions** — mesh partitioning, contact conditions, interpretability of nonlinear vs linear results

Delegating these judgments to an LLM without a human reviewer produces "drawings that compile but real fabricators reject as unmanufacturable." The advisor mitigates this risk through **quarterly architectural review + monthly issue check-ins + ad-hoc Q&A**.

---

## 3. 역할 / Role

### 3.1 정기 미팅 / Regular Meetings

| 빈도 / Frequency | 형식 / Format | 시간 / Duration | 안건 / Agenda |
|---|---|---|---|
| 월 1-2회 / 1-2x per month | Zoom 화상 / Video call | 1시간 / 1 hour | 현재 sprint의 CAD 결정사항 리뷰, 다음 2주 risk identification |
| 분기 1회 / Quarterly | Zoom 화상 / Video call | 2시간 / 2 hours | Architectural review — geometry kernel 선택, 표준 채택 (GD&T scheme 등), CAM strategy |
| 비정기 / Ad-hoc | Slack / Email | 24h 내 응답 / Reply within 24h | 코드 PR 리뷰가 아닌 도메인 판정 ("이 bend relief 식이 맞나?", "이 데이텀 표시 ISO 호환?") |
| 선택 / Optional | Zoom 동석 / Joint Zoom | 30-60분 / 30-60 min | 외부 사용자 인터뷰 동석, paying customer 설계 리뷰 시 |

### 3.2 결과물 / Deliverables

월간:
- 미팅 후 24h 내 1-page meeting note (decisions, action items, open questions)
- Slack #cad-advisor 채널 ad-hoc 응답

분기:
- Architectural review memo (Notion 또는 Markdown, 2-3 페이지)
- 다음 분기 risk list

### 3.3 권한 / Authority

Advisor는 **자문 권한 (advisory authority)** 만 가지며, 코드 commit/배포 권한은 없습니다. 다만 founder는 advisor가 "이건 ship 하면 안 된다" 라고 분기 리뷰에서 명시한 항목은 **다음 sprint cycle 내 해결 또는 명시적 거부 사유 기록** 을 약속합니다.

The advisor holds **advisory authority** only — no code commit/deploy rights. However, the founder commits that any item the advisor flags as "ship-blocking" in quarterly review will be either **resolved within the next sprint cycle or have an explicit documented dissent reason**.

---

## 4. 필요 expertise / Required Expertise (Must-have)

### 한국어

1. **상용 CAD 5년+ 실 사용** — SolidWorks, Fusion 360, Onshape, CATIA, Inventor, NX, Creo 중 **3개 이상** 을 실 프로젝트에서 사용한 경험
2. **Sheet metal design 실무 경험**
   - Flange / bend allowance / bend deduction 직접 계산 가능
   - K-factor 실측 vs 표준값 차이 인지 (재질별, 두께별)
   - Bend relief, jog, corner relief 설계
   - 굽힘 순서 (bend sequence) 가공 가능성 판정
3. **Drawing 표준 실 사용**
   - ASME Y14.5 (-2009 또는 -2018) 또는 ISO 1101 / ISO GPS 실무 적용
   - Datum reference frame, feature control frame 작성
   - 1st angle / 3rd angle projection
   - 표면거칠기 (Ra, Rz, Rmax) 표기
4. **CAD interop format 이해**
   - STEP AP203/AP214/AP242 차이 인지
   - IGES vs STEP trade-off
   - Parasolid / ACIS / OpenCascade kernel 차이의 상위 수준 이해 (커널 내부 구현은 아니어도 됨)
   - Round-trip 손실 (mesh vs B-rep, tangent edge, color/PMI carry-through) 인지
5. **언어** — 한국어 또는 영어 비즈니스 fluent (한쪽만 가능해도 OK)

### English

1. **5+ years of commercial CAD usage** — Hands-on project experience with **3 or more** of: SolidWorks, Fusion 360, Onshape, CATIA, Inventor, NX, Creo
2. **Sheet metal design practice**
   - Flange / bend allowance / bend deduction calculation
   - Awareness of K-factor empirical vs tabulated discrepancies (material & thickness dependent)
   - Bend relief, jog, corner relief design
   - Manufacturability judgment on bend sequence
3. **Drawing standards practice**
   - ASME Y14.5 (2009 or 2018) or ISO 1101 / ISO GPS in real work
   - Datum reference frame, feature control frame authoring
   - 1st angle / 3rd angle projection
   - Surface finish (Ra, Rz, Rmax) notation
4. **CAD interop format understanding**
   - STEP AP203/AP214/AP242 differences
   - IGES vs STEP trade-offs
   - High-level understanding of Parasolid / ACIS / OpenCascade kernel differences (internal implementation knowledge not required)
   - Round-trip loss awareness (mesh vs B-rep, tangent edges, color/PMI carry-through)
5. **Language** — Business fluent in Korean OR English (either one is fine)

---

## 5. 있으면 좋음 / Nice-to-have

### 5.1 CAM 경험
- Fusion CAM, Mastercam, NX CAM, Esprit, GibbsCAM 등 1개 이상
- 3-axis / 4-axis / 5-axis tool path 차이 판정
- Post-processor 작성 또는 수정 경험
- Controller (Fanuc, Heidenhain, Mazak, Siemens 840D, Haas) 별 G-code dialect

### 5.2 FEA 경험
- ANSYS, Abaqus, Inventor Nastran, SolidWorks Simulation, COMSOL 중 1개
- Mesh independence study 경험
- Static / modal / nonlinear / transient 해석 구분
- 결과 해석 + 보고서 작성

### 5.3 Kernel-level 이해
- replicad / OpenCascade / Parasolid / ACIS / Solid Modeling Solutions kernel
- B-rep topology (face, edge, vertex, loop) 이해
- Boolean robustness 이슈 경험 (tangent face, sliver face)
- STEP exporter/importer 내부 동작 이해

### 5.4 제조업 운영 경험
- 가공업체 (CNC shop / 판금 / 사출) 운영 또는 근무
- 현장 가공 (CNC 조작, 굽힘 작업) 직접 수행
- Tolerance stack-up 실무
- 자재/공구 cost 감각

### 5.5 AI/LLM 통합 경험
- ChatGPT / Claude / Copilot 등 LLM을 CAD workflow에 활용
- LLM hallucination 식별 능력
- Prompt 설계 경험

---

## 6. 명시적으로 불필요 / Explicitly NOT required

명시적으로 다음은 advisor에게 요구하지 않습니다 (오해 방지):

| 항목 / Item | 이유 / Reason |
|---|---|
| **풀타임 코딩** / Full-time coding | Advisor 역할이지 개발 채용이 아닙니다. JavaScript/TypeScript 작성 불필요. PR 코드 리뷰 불필요. |
| **영업/마케팅** / Sales/Marketing | 영업은 founder가 직접. Advisor는 도메인 검증만. |
| **UX/UI 디자인** / UX/UI design | UX consultant 별도 영입 예정. CAD 도메인 advisor는 UX 판단 불필요. |
| **풀타임 commitment** / Full-time commitment | 월 5-10시간 수준. 본업이 있는 senior engineer를 환영. |
| **NDA 없는 외부 공개** / Public commentary | 정 반대: NDA가 기본. 사례 발표는 NexyFab launch 후 mutually agreed. |
| **펀딩/투자 자문** / Fundraising advisory | Founder는 부트스트랩 중. 투자 조언 불필요. |

---

## 7. 보상 / Compensation

### 7.1 두 가지 옵션 / Two options

**옵션 A — 월 retainer / Monthly retainer**

| Tier | 월 보상 / Monthly | 연 환산 / Annualized | 포함 시간 / Hours included |
|---|---|---|---|
| Junior advisor (5-8년 경력) | $400 / 50만원 | $4,800 / 600만원 | 월 5시간까지 |
| Mid advisor (8-12년 경력) | $700 / 90만원 | $8,400 / 1,080만원 | 월 7시간까지 |
| Senior advisor (12년+ 경력) | $1,200 / 150만원 | $14,400 / 1,800만원 | 월 10시간까지 |

초과 시간은 시간당 $100-200 별도 청구.

**옵션 B — 시간당 / Hourly**

| 경력 / Experience | 시간당 / Per hour |
|---|---|
| Junior (5-8y) | $100 / 13만원 |
| Mid (8-12y) | $150 / 20만원 |
| Senior (12y+) | $200 / 27만원 |

미팅 시간 + Slack 응답 시간 (15분 단위 round-up) 합산.

### 7.2 Equity 옵션 / Equity option

NexyFab은 현재 부트스트랩 단계라 standard equity grant는 없습니다. 다만 다음 조건 충족 시 **founder discretionary equity** 가능:
- 12개월 이상 advisor 유지
- Documented impact (구체적 ship-blocking 이슈 발견 3건 이상)
- 향후 funding round 시 founder가 직접 carve-out

NexyFab is currently bootstrapping, so no standard equity grant. However, **founder-discretionary equity** is possible upon:
- 12+ months of advisor tenure
- Documented impact (3+ ship-blocking issues identified)
- Founder-carved allocation in a future funding round

### 7.3 비용 / Expenses

- Zoom / Slack 등 도구 비용은 NexyFab이 부담
- 한국 거주 advisor가 founder와 오프라인 미팅 시 카페/식사 비용은 NexyFab 부담 (분기 1회 제한)
- 출장은 발생하지 않음

---

## 8. 계약 조건 / Contract Terms

### 8.1 기간 / Duration

- **Trial period**: 6개월 (2026-08 ~ 2027-01 예상)
- **Renewal**: 매 분기 mutual review → 1분기 자동 갱신 or 종료
- **종료 통지**: 양측 30일 사전 통지

- **Trial period**: 6 months (estimated 2026-08 ~ 2027-01)
- **Renewal**: Quarterly mutual review → 1 quarter auto-renewal or termination
- **Termination notice**: 30 days advance notice by either party

### 8.2 NDA / 비공개

- 표준 mutual NDA 체결 (2년)
- NexyFab의 source code, business plan, customer list 비공개
- Advisor의 영업 비밀 / 기존 고용주 정보 보호

- Standard mutual NDA (2 years)
- Confidentiality of NexyFab source code, business plan, customer list
- Protection of advisor's trade secrets / prior employer information

### 8.3 IP / 지적재산권

- Advisor가 미팅 중 제안한 **일반적 도메인 지식** (예: "K-factor는 보통 0.33-0.5") 은 NexyFab이 자유 사용 가능
- Advisor가 **특정 알고리즘 / 코드 / 도면 템플릿** 을 직접 제공한 경우 별도 IP assignment 협의
- Advisor의 prior work / portfolio 는 advisor 소유 유지

### 8.4 Conflict of interest

다음은 conflict 로 간주하여 사전 disclosure 필요:
- 직접 경쟁사 (Onshape, Autodesk, Dassault, PTC, Siemens PLM) 정규직 재직
- 한국 내 동종 cloud CAD 스타트업 advisor 겸직

다음은 OK:
- 가공업체 운영 (NexyFab 의 잠재 customer)
- 무관한 산업 (자동차 OEM, 항공, 의료기기) 정규직
- 학계 / 강의 / 컨설팅 (CAD 외 도메인)

---

## 9. 채용 채널 / Recruiting Channels

우선순위 (priority) 기준:

### 우선순위 1 / Priority 1 — LinkedIn

- **Why**: senior engineer 풀이 가장 깊고, NexyFab founder가 직접 outreach 가능
- **검색 쿼리**: "Senior Mechanical Engineer + SolidWorks + sheet metal + Korea" / "CAD engineer + Onshape + 10 years"
- **Outreach 템플릿**: 별첨 (`docs/wave-2-cad-advisor-outreach-template.md` 작성 예정)
- **예상 응답률**: cold message 5-10%, warm intro 30%+

### 우선순위 2 / Priority 2 — 원티드 (Wanted.co.kr) Senior CAD 풀

- **Why**: 한국어 fluent senior 엔지니어 풀, 본업 + 사이드 advisor 수용 문화 존재
- **포지션 등록**: "Part-time Advisor" 카테고리, 명시적으로 "본업 유지 가능" 표기
- **비용**: 등록 무료 또는 promoted listing ~30만원
- **예상 응답**: 한국 거주 5-8년 경력 mid-level 다수 / 12년+ senior 소수

### 우선순위 3 / Priority 3 — 한국기계학회 (KSME) + 가공 커뮤니티

- **Why**: 표준 (KS B / KS A / GD&T 한국어 적용) 깊이 있는 인재가 모이는 곳
- **채널**:
  - 한국기계학회 회원 게시판 / 메일링
  - 네이버 카페: "CNC 가공 정보방", "판금 가공", "SolidWorks Korea"
  - 다음 카페: "기계설계 동호회"
- **접근법**: 직접 채용 공고보다는 founder가 글 작성 / 질의응답 활동으로 평판 쌓은 뒤 outreach

### 우선순위 4 / Priority 4 — Reddit r/cad, r/SolidWorks, r/CNC, r/MachinePorn

- **Why**: 영어권 senior, 글로벌 advisor 후보 (시차 대응 가능 시)
- **접근법**: 직접 공고 게시 (subreddit rules 확인) + DM outreach
- **예상**: 미국/유럽 mid-senior 응답 가능, 한국 시차 (-13~16h) 협의 필요

### 우선순위 5 / Priority 5 — 잡플래닛 / 사람인 senior 풀

- **Why**: 후순위. 정규직 풀이라 part-time advisor 후보 적음. 다만 "이직 고려중" 시그널 있는 senior 발굴 가능
- **접근법**: 헤드헌터 통하지 말고 직접 메시지

### 우선순위 6 / Priority 6 — Twitter/X CAD 커뮤니티 + LinkedIn CAD groups

- **Why**: replicad / OpenCascade / KiCad 등 OSS CAD 활동가 풀. AI/LLM + CAD 교차 인재
- **계정 follow**: @replicad_io, Onshape 직원, Fusion 360 evangelist
- **접근법**: founder가 NexyFab progress 공유 → 자연스러운 inbound 유도

---

## 10. 선발 절차 / Selection Process

총 3-4주 소요 예상.

### Step 1 — 30분 스크리닝 / 30-min Screening (Week 1)

- **목적**: 기본 fit 확인 (경력, 가용 시간, 보상 기대치)
- **형식**: Zoom 30분
- **체크리스트**:
  - 5년+ commercial CAD 사용 확인
  - 본업 conflict 없음
  - 보상 기대치 align (옵션 A/B 중 선호)
  - 한국어 또는 영어 비즈니스 가능

### Step 2 — 1시간 케이스 인터뷰 / 1-hour Case Interview (Week 2)

- **목적**: 도메인 깊이 + 판단 스타일 확인
- **형식**: Zoom 60분, 실 케이스 함께 풀기
- **케이스 예시**:
  - **Case A — STEP fixture roundtrip**: founder가 미리 준비한 SolidWorks fixture 모델 → NexyFab kernel (replicad) → STEP export → SolidWorks re-import. Tangent edge loss, color/PMI 손실 식별 가능한지.
  - **Case B — Sheet metal bend tolerance**: 1.5mm SUS304 brake-formed bracket 도면 → bend allowance, K-factor 추정, 실 가공 시 우려사항.
  - **Case C — GD&T review**: 잘못 작성된 datum reference frame 도면 → 오류 식별 + 수정안.
- **평가 기준**:
  - 답을 모를 때 "모른다" 라고 말하는가 (LLM과 가장 큰 차이점)
  - Trade-off 설명 능력 (단답형 vs 맥락 설명)
  - 표준 인용의 정확성 (ASME Y14.5 vs 추측)

### Step 3 — 2주 Trial / 2-week Trial (Week 3-4)

- **목적**: 실 작업 호흡 확인
- **형식**: 2주간 advisor 역할 그대로 수행 (1회 미팅 + ad-hoc Slack)
- **보상**: trial 기간도 정상 시간당 비용 지급 ($100-200/h)
- **평가 항목**:
  - 24h 내 Slack 응답 실제 가능한가
  - Meeting note 작성 품질
  - Founder와 communication style fit
- **합격 기준**: 양측 mutual "go" → Step 4

### Step 4 — 정식 계약 / Formal Contract (Week 4+)

- 6개월 trial period 계약 서명
- NDA + IP assignment 서명
- Slack #cad-advisor 채널 초대
- Zoom 정기 미팅 일정 확정 (예: 매월 둘째 주 화요일 21:00 KST)

---

## 11. Onboarding (계약 후 첫 30일) / First 30 days

### Day 1-7

- Founder가 NexyFab 코드베이스 walkthrough (1시간 Zoom)
  - `src/lib/cad/` — geometry kernel wrapper
  - `src/lib/sheet-metal/` — bend allowance 계산
  - `src/lib/drawing/` — 2D drawing extraction
  - `src/lib/cam/` — (Wave 2 진입 시 스캐폴드 예정)
- Read-only repo access (GitHub) 제공
- 현재 burn-in 결과 + open issue list 공유

### Day 8-30

- 첫 정기 미팅 (1시간)
- 첫 분기 architectural review prep (advisor가 가장 우려되는 risk top 3 작성)
- Slack 통합 + meeting cadence 안정화

### Day 30 review

- Founder + advisor 30분 review
- 미팅 빈도 / 보상 / 역할 범위 fine-tune
- 정식 6개월 trial 본격 시작

---

## 12. FAQ

### Q1. 풀타임 직원으로 채용할 수 있나? / Can I be hired full-time?

**A.** 현재 (Wave 2 시점) 는 No. NexyFab은 부트스트랩 + 1인 개발 구조이며, 풀타임 hire는 12개월 후 또는 funding 후 검토. 단, advisor 기간 동안 fit이 확인되면 future full-time conversion 우선 검토 대상.

**A.** Not at this time (Wave 2). NexyFab is bootstrapped and solo-founded; full-time hires will be considered 12 months from now or post-funding. However, advisors who prove fit during the engagement will be priority candidates for future full-time conversion.

### Q2. 여러 advisor를 동시에 채용하나? / Are multiple advisors hired simultaneously?

**A.** No. Wave 2 단계에서는 **CAD/CAM advisor 1명만** 채용. 추후 UX advisor (별도), business/GTM advisor (별도) 가 단계적으로 추가될 수 있으나, 본 JD 는 CAD/CAM 한 자리에 한정.

### Q3. 회사 위치는? 오프라인 미팅 의무? / Office location? In-person required?

**A.** Founder는 한국 거주 (서울/경기). 미팅은 100% Zoom 원격. 오프라인은 advisor 선호 시 분기 1회 카페 미팅 가능. **오프라인 의무 없음.**

### Q4. 보상은 한국 원화 vs USD? / Compensation currency?

**A.** Advisor 선호 따름. 한국 거주 advisor는 KRW 권장 (환율 변동 risk 회피), 해외 거주 advisor는 USD 권장. 지급은 매월 1회.

### Q5. Trial 기간에 fit이 안 맞으면? / What if trial doesn't work?

**A.** Mutual no-fault termination. 양측 모두 부담 없이 종료 가능하며, trial 기간 보상은 정상 지급. 추천 인맥 공유는 mutual best-effort.

### Q6. NexyFab 의 CAD 가 OSS 인가? / Is NexyFab CAD open source?

**A.** 핵심 product (`nexyfab.com`) 는 closed source. 다만 일부 모듈 (예: replicad 기여) 은 upstream OSS 기여 형태로 공개. Advisor가 OSS 기여를 advisor work의 일부로 원할 경우 mutual agreement.

### Q7. AI/LLM 부분이 핵심인데 ML expertise 가 없어도 되나? / I don't have ML background — is that ok?

**A.** **OK.** Advisor는 CAD 도메인 검증 역할이며, LLM 부분은 founder + 별도 AI 전문가 (필요 시) 가 담당. 다만 LLM이 도메인적으로 hallucinate 한 경우를 식별할 수 있어야 함.

### Q8. 가공업체 운영 중인데 NexyFab marketplace 에 등록하면 conflict? / I run a fab shop — is that conflict?

**A.** **No conflict**, 오히려 환영. 가공업체 측 시각이 NexyFab marketplace 설계에 valuable. 단, NexyFab buyer/supplier 평가 알고리즘 등 sensitive 영역은 advisor 본인 업체 데이터에서 격리.

---

## 13. 지원 방법 / How to Apply

### 한국어

다음 정보를 이메일로 보내주세요: **nexyfab@nexysys.com** (제목: "[Advisor 지원] 이름 / 경력년수")

1. **이력서 또는 LinkedIn URL** (1-2 페이지)
2. **사용 가능한 CAD/CAM 도구 목록** + 각 도구별 사용 연수
3. **가장 자랑스러운 프로젝트 1개** 짧은 설명 (3-5 문장, NDA 위반 없는 선에서)
4. **선호 보상 옵션** (A 월 retainer / B 시간당)
5. **현재 본업** + conflict 여부 자가 평가
6. **선발 절차 Step 2 케이스 인터뷰** 가능 시간대 후보 3개 (KST 기준)

응답 SLA: 5 영업일 이내 founder 회신.

### English

Send the following to **nexyfab@nexysys.com** (subject: "[Advisor Application] Name / Years of Experience"):

1. **Resume or LinkedIn URL** (1-2 pages)
2. **List of CAD/CAM tools used** + years of experience per tool
3. **Brief description of one project you're most proud of** (3-5 sentences, within NDA limits)
4. **Preferred compensation option** (A monthly retainer / B hourly)
5. **Current day job** + self-assessment of conflict
6. **3 candidate time slots for Step 2 case interview** (KST baseline)

Response SLA: Founder replies within 5 business days.

---

## 14. About the Founder / 창업자 소개

- **이름**: (별도 1:1 미팅 시 공유)
- **배경**: Software engineer (full-stack), AI/LLM heavy user, 한국 거주
- **현재 portfolio**:
  - NexyFlow — groupware SaaS
  - NexyFab — manufacturing marketplace + CAD/CAM (본 JD 의 product)
  - NexyWise — consulting site
  - NexyRemote — virtual office SaaS
- **Working style**: Async-first, written communication, document-driven decisions
- **Why CAD?**: 한국 제조업의 SW 디지털화 갭이 너무 크고, 1인이 LLM 보조로 시도해볼만한 마지막 frontier 라고 판단

---

## 15. 변경 이력 / Change Log

| 버전 / Version | 일자 / Date | 변경 / Change |
|---|---|---|
| v1.0 | 2026-05-28 | 최초 작성 / Initial draft (Wave 2 prep) |

---

## 16. 부록 — 관련 NexyFab 문서 / Appendix — Related NexyFab Docs

내부 참조 (advisor onboarding 시 공유):

- `docs/wave-2-phase-1-plan.md` — Wave 2 phase 1 plan
- `docs/strategy/` — strategy memos
- `docs/nexyfab-3d-data-policy.md` — 3D data policy
- `docs/process/` — engineering process
- (작성 예정) `docs/wave-2-cad-advisor-outreach-template.md` — LinkedIn / 원티드 outreach 템플릿
- (작성 예정) `docs/wave-2-cad-advisor-case-interview-bank.md` — case interview 문제 풀

---

**END OF DOCUMENT**

문의: nexyfab@nexysys.com
Questions: nexyfab@nexysys.com
