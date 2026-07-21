# Wave A — AI 설계 드라이버 (사람=최종 검토자, AI=작업자)

**승인일**: 2026-07-22 (사용자 확정: "사람이 최종 검토하지만 AI가 거의 대부분을
해서 기존 툴들을 대체할 수 있는 수준")
**전제**: G1~G4 전 게이트 실행형 실증 완료(REPLACEMENT_ROADMAP §5) — 엔진이
거짓말하지 않는 상태가 이 웨이브의 토대.

## 0. 원칙 (기존 불변원칙의 런타임 제품화)

- **모든 AI 산출물은 실측 게이트를 통과한 것만 사람 앞에 도착한다.**
  게이트 실패는 조용한 폴백이 아니라 이유와 수치를 단 검토 항목이다.
- LLM은 **계획 생성까지만** — 실행은 전부 결정론 경로(기존 원칙:
  NL→JSON→결정론 빌드). 같은 계획=같은 산출물.
- 자동화 수준은 주장하지 않고 **측정**한다(§GA3).
- 도메인 순서: 기계 → 조경/인테리어(일반인) → 토목/건설(보조+사람 책임
  라벨 고정 — "대체" 언어 금지 영역).

## 1. 재료 (전부 실재 — 260722 확인)

`src/lib/ai/scad-agent/`: runScadAgent(멀티턴 에이전트 루프)·intentSchema·
featureTree·assemblyMateSolve·specVerification·dfmGate·renderToGeometry·
bomGenerator·costEstimation·gdtSuggestion·pmiExport·budget/aiMeter.
`lib/assembly`: solveMates+kinematics(드라이브). `lib/drawing`: 실측 치수
(measureSheetDimension)·시트 자동 생성(standardThreeViewSheet)·PDF/DXF.
`pdm/`: sessionRepoStore(커밋·브랜치·3-way 머지·충돌해결). MCP 26종.

## 2. 트랙 (파일 소유권 배타)

| 트랙 | 내용 | 소유권 | 수용 기준 (정량) |
|---|---|---|---|
| **WA-A** 드라이버 코어+검증 게이트 체인 | `designDriver.run(brief)` — ①계획(LLM, 주입 가능한 플래너 인터페이스+fixture 계획으로 테스트) ②빌드(결정론: featureTree/scad 경로) ③**verifyGates**: 지오메트리(부피·워터타이트)→구속/mate 수렴→DFM→(어셈블리 시)간섭→치수 실측, 각 게이트 pass/fail+수치+사유 IR ④패키지: 3뷰 시트+실측 치수+PDF/DXF+BOM+검증 리포트 JSON | 신설 `src/lib/ai/design-driver/**` (+테스트). scad-agent·drawing·assembly는 **소비만** | fixture 계획 3종(브래킷·축·간이 어셈블리)이 **전 게이트 통과 패키지**를 산출: 치수 실측 1e-6·부피 이론치 게이트·리포트에 게이트별 수치. 게이트 실패 주입 시 패키지 미산출+사유 IR |
| **WA-C** 검토 루프 | AI 실행 = PDM 브랜치 커밋(`ai/<runId>`)으로 기록 → 리뷰 큐 패널(변경 diff·검증 리포트 표시) → 승인=main 머지 / 수정요청=코멘트가 다음 실행 입력으로 반환되는 IR | `pdm/reviewQueue*`(신설)+`_shell` 패널 1개(신설)+sessionRepoStore 가산 확장 | jsdom: AI 커밋 2건 큐 표시→승인 시 merge 커밋(2-parent)→수정요청 IR에 코멘트·대상 피처 id. 기존 pdm 45/45 유지 |
| **WA-E** 자동화율 계측 | 개입 이벤트 IR(수정요청 수·재실행 수·게이트 재시도 수·검토 소요) + 런별 리포트 집계. §GA3의 측정 도구 | 신설 `src/lib/ai/design-driver/autonomyMetrics.ts`(+테스트). funnel-logger 관례 소비 | 시뮬레이션 런 시퀀스에서 자동화율 산식(개입 0=100%, 산식 문서화) 수치 재현. WA-A 리포트에 계측 필드 편입 |
| **WA-D** 표면 노출 (2차 배치) | MCP 도구 `design_brief` 1종 + API 라우트 + 웹 진입(채팅/폼) — WA-A 계약 확정 후 | mcp-server·api route·UI 최소 | 3면(MCP/API/웹)에서 동일 brief→동일 패키지 |

## 3. 게이트

- **GA1 (드라이버) ✅ 260722 통과** — `design-driver/__tests__/` 픽스처 3종
  (브래킷 부피 relErr≤1e-9·치수≤1e-6·DXF 결정론 / 24각형 진원 축 /
  어셈블리 수렴 1e-6+BOM) + 실패 주입 4종 명시 거부 + 통합 하네스
  `src/test/ai/waGate.test.ts`. 부수 발견: featureMesh centroid 배향
  휴리스틱이 비볼록에서 오배향(부호합 5760 vs 실부피 14720) — 게이트 측
  재배향으로 보정, **원본 수정은 별도 트랙**(전 앱 하중 경로라 신중).
- **GA2 (검토 루프) ✅ 260722 통과** — waGate 하네스: 커밋→수정요청
  (RevisionDirective)→재실행→승인(2-parent 머지) 사이클 + **게이트
  실패물은 사람 승인으로도 main 진입 불가** 실증 + 자동화율 계측
  (개입 1회·검토 3,000ms 손계산 일치).
- **GA3 (자동화율 — design-partner)**: 실사용자 부품군에서 **개입 횟수·검토
  시간 실측** — 목표치는 첫 실측 후 설정(측정 없는 목표는 날조).
  ⚠️GA3는 코드로 통과 불가 — 외부 실행(파트너) 필요. 측정 도구
  (autonomyMetrics)는 준비 완료.

## 4. 정직 고지 (제품 표면에도 유지)

AI 산출물 검증 리포트에는 근사·미검증 항목이 명시된다(예: FEA=스크리닝
한정 비법정, DXF 치수 비연관, 곡면 쉘 OCCT 경로). 토목·건설 표면에는
"보조 도구·최종 책임은 면허 보유자" 문구 고정.

---

## 5. 확장 로드맵 (260722d 구체화 — 사용자 확인 후 착수)

### Wave A 2차 — WA-D 표면 노출 (다음 배치, 병렬 4트랙 → 완료 시 배포)

| 트랙 | 내용 | 소유권 | 수용 기준 |
|---|---|---|---|
| **WA-D1** LLM 실플래너 | `llmPlanner: DesignPlanner` — 기존 ai provider 체인(aiMeter/budget) 경유, DesignPlan 스키마 출력 강제+**계획 사전검증**(스키마·참조 유효성·게이트 측정 가능성 프리플라이트 — 측정 불가 계획은 게이트에 가기 전에 명시 거부). revision 시 RevisionDirective 코멘트를 플래너 컨텍스트에 포함 | `design-driver/llmPlanner.ts` 신설 | mocked LLM 응답(결정론)으로: 유효 계획→패키지, 스키마 위반/측정 불가 계획→plan 단계 거부. 실 LLM 스모크는 env 게이트(옵션) |
| **WA-D2** 어댑터·되먹임 | 드라이버 산출물→PDM FeatureInstance 실제 어댑터(waGate 로컬 어댑터 대체) + RevisionDirective→재실행 파이프 | `design-driver/pdmAdapter.ts`+reviewQueue 소비 | 수정요청→재실행→승인 사이클이 어댑터 경유로 waGate 재통과 |
| **WA-D3** 3면 표면 | MCP `design_brief` 도구 · API 라우트(`/api/nexyfab/design-brief`) · 웹 진입(폼/채팅)+AiReviewQueuePanel mount(Inner 최소 diff) | mcp-server·api·UI | 3면 동일 brief→동일 패키지(결정론 플래너 기준), 미인증/플랜 게이트 |
| **WA-D4** 배포 배치 | CACHEBUST 범프→railway up→지문 전환+smoke | Dockerfile | "한 문장→검증된 패키지"가 프로덕션 도달 |

### Wave A 3차 — 지원 트랙 (2차와 병렬 가능)

- **featureMesh 배향 결함 원본 수정**: 부호부피 의존 소비자 전수 조사(실측)
  → centroid 휴리스틱을 에지 인접 전파로 교체 → 전 스위트 회귀(14,000+).
  게이트 측 보정과 이중화 후 보정 제거 여부 판단.
- **GA3 준비물(코드로 가능한 전부)**: ①파트너 온보딩 문서(할 수 있는 것/
  한계 정직 고지 — 커버리지 매트릭스 발췌), ②autonomy 대시보드(측정치
  시각화, admin), ③샘플 브리프 세트(파트너 부품군 유도용), ④측정 동의
  문구. **파트너 접촉·선정은 사용자 몫.**

### Wave B — 측정-확장 루프 (★"거의 다 됐나"를 표로 답하는 체계)

**WB-0 AI 경로 커버리지 매트릭스** (신규 정본 문서):
부품 카테고리 분류(기계 실무 기준: 브래킷/플레이트 · 축/샤프트 · 하우징 ·
판금 · 용접 프레임 · 기어/전동 · 체결/규격품 · 복합) × 3열:
`AI 계획 가능?` × `게이트 검증 가능?` × `zero-touch 실측치(n 병기)`.
초기값은 재실사(실행 근거)로 채움 — 추정 금지. **"대체 수준" 판정은 이
표의 수치로만 한다.**

**WB 확장 백로그** (커버리지 경계 = 현행 명시 한계 목록의 재배열):
1. revolve/loft NamedTopology(→회전체 치수 실측 — 축류 커버리지의 관문)
2. 판금 전개를 드라이버에 편입(G1 자산 — 계획→전개→DXF 자동)
3. 웰드먼트 편입(마이터 프레임+컷리스트 → 용접 프레임 카테고리)
4. 간섭 게이트(어셈블리 표준 게이트로 승격)
5. GD&T 자동 제안 편입(gdtSuggestion → 도면 게이트 확장)
6. 곡면 쉘/필렛 체인의 게이트 경로(OCCT 게이트 통합)
7. 피처 패턴·end condition의 AI 계획 어휘 편입

루프: 백로그 1건 소화 → 매트릭스 해당 행 재실사 → zero-touch 재측정 →
반복. **웨이브 게이트(GB) 목표치는 GA3 첫 실측 후 설정**(측정 없는 목표는
날조 — 원칙 유지).

### 도메인 병렬 트랙 (낮은 우선, Wave B와 병행)

- 조경·인테리어: 일반인 트랙에 design_brief 연결(가장 쉬운 AI 비중 확대).
- 토목·건설: 보조 도구 심화 + "면허 보유자 최종 책임" 고지 라벨 전수 감사.
  **"대체" 언어 금지 유지.**

### 세션 배치 계획 (제안)

| 세션 | 내용 |
|---|---|
| 다음 | WA-D1~D3 병렬 3에이전트 → waGate 확장(LLM mocked 전체 루프) → WA-D4 배포 |
| +1 | featureMesh 트랙 + GA3 준비물 + WB-0 매트릭스 초판(재실사) |
| +2~ | WB 백로그 루프(회당 2~3건) × 매트릭스 갱신, GA3 실측 개시(파트너 확보 시) |
