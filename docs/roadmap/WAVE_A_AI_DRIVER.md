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

- **GA1 (드라이버)**: fixture 계획 3종 전 게이트 통과 패키지 + 실패 주입 시
  명시 거부 — 실행형 하네스로 판정.
- **GA2 (검토 루프)**: AI 커밋→검토→승인/수정요청→재실행이 한 사이클로
  실행됨(하네스). 사람이 보는 것 = diff+검증 리포트뿐.
- **GA3 (자동화율 — design-partner)**: 실사용자 부품군에서 **개입 횟수·검토
  시간 실측** — 목표치는 첫 실측 후 설정(측정 없는 목표는 날조).
  ⚠️GA3는 코드로 통과 불가 — 외부 실행(파트너) 필요.

## 4. 정직 고지 (제품 표면에도 유지)

AI 산출물 검증 리포트에는 근사·미검증 항목이 명시된다(예: FEA=스크리닝
한정 비법정, DXF 치수 비연관, 곡면 쉘 OCCT 경로). 토목·건설 표면에는
"보조 도구·최종 책임은 면허 보유자" 문구 고정.
