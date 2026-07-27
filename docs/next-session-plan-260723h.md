# 다음 세션 인수인계 — 2026-07-23h (아키텍처 부채 1~2단계 + 종합 평가 + 발견 3건)

**전임 문서**: `next-session-plan-260722g.md` (Wave B 배치1·GA3 배선·G4 영속)
**이 세션의 궤도**: 4차~5차 dogfooding(FEA·mate축 등, 이미 배포 -152/-153) 이후 —
아키텍처 부채(mate 솔버 통합·PDM 서버 게이트) 스코핑→구현, 이어서 사용자 지시로
"기계설계~인테리어·AI·성능" 종합 평가(4개 병렬 실행-기반 에이전트)→발견 3건 수정.
**배포**: -154(아키텍처 부채 1단계) → -155(2단계 준비+PDM UI) → **-156(현재 라이브,
평가에서 나온 3건 수정)**. `RAILWAY_EXIT=0`+헬스체크 200 확인됨.

## 0. 완전체까지 남은 거리 — 정직한 현재 위치 (2026-07-23 재확인)

사용자 질문("이제 거의 다 된거야? 진짜 기계·토목·건설·조경·인테리어 전부 쓸 수 있어?")에
답하기 위해 정본 3개 문서(`docs/roadmap/AI_COVERAGE_MATRIX.md`·
`docs/roadmap/MULTI_DOMAIN_EXPANSION_PLAN.md`·`docs/roadmap/COMPLETION_PLAN.md`,
전부 2026-07-21~22자)를 재확인. **목표 문장 그대로**: "사람이 최종 검토하지만 AI가
거의 대부분을 해서 기존 툴을 대체할 수 있는 수준". 아래는 도메인별로 "코딩으로
닫을 수 있는 갭"과 "코딩으로 안 닫히는 구조적 천장"을 구분한 것 — 이 둘을 섞으면
과대·과소평가 둘 다 된다.

### 기계 — 엔진은 완성에 가까움, 목표 문장 자체는 미측정
- 커버리지 87.5%(7/8 A + 기어 부분), 게이트·정확도 실측 견고 — **이건 진짜 완성 근접**.
- 그러나 매트릭스 자신의 판정문: `zero-touch n=0 (전 카테고리 미측정)` +
  *"측정 없는 목표는 날조 — GA3 첫 실측 전까지 '대체 수준' 정량 판정 유보"*.
  **"AI가 대부분 하고 사람은 검토만"이라는 목표 문장 자체가 단 한 번도 실측된 적이
  없다** — 이게 실제로 질문에 답하는 유일한 숫자이고, 아직 0이다.
- 이번 세션에 오늘 아침까지 "평범한 브래킷 브리프조차 계획 단계에서 거의 항상
  거부"되는 버그가 있었다(§1의 수정 1) — 엔진 축조차 오늘에서야 정상화됐고, 그
  수정도 표본 3개로만 검증됨. **"거의 다 됐다"고 하기엔 이르다.**

### 토목·건설 — 코딩 문제가 아니라 법적 천장
`MULTI_DOMAIN_EXPANSION_PLAN.md` 원문: *"토목·건설의 구조 날인은 4단계가
상한(면허 책임) — '코파일럿'이지 '대체'가 아니다."* 현재 1/5 단계. **이건 아무리
코드를 고쳐도 안 올라가는 천장** — 구조기술사/건축사 날인은 법이 요구하는 것이지
AI 완성도의 문제가 아님. "완전체"라는 틀 자체가 이 두 도메인엔 안 맞음 — 목표를
"코파일럿(스크리닝·초안) 수준 최대화"로 재정의해야 정직한 로드맵이 나옴.

### 조경·인테리어 — 트랙이 둘이고, 하나만 존재함
- **일반인/소비자 트랙**: 실제로 있고 제품으로 나감(이번 세션 인테리어 평가가
  테스트한 게 바로 이 트랙). 품질 괜찮음 — 단, 오늘 고친 버그(소비자 문서가 안전
  판정 숨김)가 한 세션 이상 방치돼 있었다는 건 비슷한 게 더 있을 수 있다는 뜻(§3-A-07
  전수 감사 항목 참고).
- **전문가/실시설계 대체 트랙**: `COMPLETION_PLAN.md` 원문 *"전문가 실시설계 대체는
  별도 여정, 현 추력 아님"* — **단계 0, 아직 시작 안 함**. "인테리어도 쓸 수 있어?"의
  답은 "소비자용은 된다, 전문가용 대체는 아직 아니다"로 나눠야 정직함.

### 정리 — "완전체가 되려면" 실제로 필요한 것 (아래 순서가 실제 병목 순서)
1. **GA3 파트너 실측 자체가 유일하게 진짜 "완성"을 증명할 수 있는 사건** — 코드로
   더 못 닫음. `docs/DESIGN_PARTNER_OUTREACH_EXECUTION.md`가 트래킹시트·템플릿
   전부 TODO 상태 — 배선은 끝났는데 **접촉 자체가 아직 실행 안 됨**. 이게 사실상
   가장 큰 병목이고 사용자 몫(§3-D).
2. 그 전까지 코딩으로 닫을 수 있는 것 = "GA3가 열렸을 때 떨어지지 않도록" 엔진
   견고성 올리기 — §3-A의 05(vitest가 실 LLM 못 돌림)·04(ref-naming 통계 확정)·
   07(소비자문서 안전판정 패턴 전수 감사)이 정확히 이 범주.
3. 토목·건설은 "완전체" 틀을 버리고 코파일럿 완성도 지표로 갈아타는 게 다음 로드맵
   결정 후보(사용자 논의 필요 — MULTI_DOMAIN_EXPANSION_PLAN.md 갱신 필요할 수 있음).
4. 조경·인테리어 전문가 트랙은 명시적으로 "아직 시작 안 함" — 착수할지 여부 자체가
   사용자 결정 사항(범위 확장 vs 소비자 트랙 심화에 집중).

## 1. 완료 (전부 커밋+배포됨)

### 아키텍처 부채 1단계 (`5d62fbf2`+`48346685`, 배포 -154)
사용자 승인="둘 다 안전한 1단계만".
- **mate 솔버 4중구현**: 드리프트 감지 테스트(`mateSolversAlignment.test.ts`)를 #1
  (`lib/assembly/api.ts`)까지 확장하는 과정에서 **#4(`lib/nexyfab/assemblyMateSolver.ts`)의
  실제 발산버그 발견**(위치보정 부호 반전 — `vsub`해야 할 자리 `vadd`, coincident/
  distance/concentric/limitDistance 전부 영향, B가 5회 반복만에 x=40→303.75 발산).
  #4 폐기(테스트 0개·진부분집합), 유일 호출처(ShapeGeneratorInner.tsx 반응형
  재해석 effect)를 #1로 마이그레이션. 회귀 13파일/60테스트.
- **PDM 서버 게이트 부재**: 확정된 실위험 — `POST /api/documents/[id]/versions`가
  게이트 실패 여부 무관 라이브문서를 "공식버전"으로 등극시킬 수 있었음. **advisory
  전략 채택**(전면 차단 아님 — CAD의 정당한 WIP 저장을 막지 않기 위해): `nf_document_versions`에
  `gate_status`/`gate_report` 컬럼(SQLite idempotent-catch+Postgres `ADD COLUMN IF
  NOT EXISTS`), POST가 선택적 `gateReport` 수용해 파생·저장하되 **절대 요청을 거부하지
  않음**. 오해유발 주석 4곳 정정("게이트 실패=main 불가"는 클라이언트 세션 불변식일
  뿐, 서버 보장 아님). 회귀 19파일/191테스트.

### 아키텍처 부채 이어서 — PDM UI 배선 + mate 2단계 준비 (배포 -155)
- **PDM 게이트 UI**(`0f71608f`+`c0115cae`): 착수 중 발견 — `VersionTreePanel.tsx`가
  `loadHistory`/`persistCommit`을 전혀 호출 안 해 배지를 그릴 UI 자체가 없었음.
  사용자 확인 후 진행: `documentPersistence.ts`/`sessionRepoStore.ts`에 `gateReport`
  클라이언트 배선 완주 + `VersionTreePanel`에 실동작 "서버 이력" 섹션(✓/✗/– 배지,
  미바인딩 정직 캡션) 신설. **⚠️미해결 스코프**: `documentId` prop이 오늘 라이브
  화면 어디서도 실값을 못 받음 — 캔버스는 `nf_projects`(`?project=`)로만 저장되고
  이 API는 별개 ID공간인 `nf_documents`를 씀, 둘을 잇는 다리가 없음(DocPermissionsButton의
  `cloudDocumentId`도 동일 미배선 패턴). **다리 놓기는 별도의 더 큰 아키텍처 결정 — 다음
  세션 후보**.
- **mate 솔버 통합 2단계 준비**(`70109aa4`): 스코핑 리포트가 진짜 2단계(#3
  `AssemblyMates.ts`=product-critical 드래그앤드롭/저장 경로를 #1로 마이그레이션)를
  "medium risk, #4 안정화 후"로 명시. 사용자 확인 후 **준비 작업만**(#3 미접촉):
  `faceRefResolver.ts` 신설 — face-index→#1 `PartRefSpec` 변환 + `placedPartsAndAssemblyMatesToSolveMatesInput()`로
  전체 입력 조립. 실제 `solveMates()` 수렴까지 검증(mock 아님). 커버리지: 13종 중
  9종 1:1(coincident/concentric/distance/angle/parallel/perpendicular/tangent/hinge/gear),
  slider/limitDistance/limitAngle/width는 `unsupported_kind` 명시 스킵.

### 종합 평가(기계·인테리어·AI·성능) → 발견 3건 수정 (배포 -156)
4개 병렬 에이전트가 **실행 기반**(코드리뷰 아님 — 실제 브리프 생성·API 호출·테스트
실행·빌드 타이밍)으로 평가. 축 분리 스코어카드(단일점수 금지).
1. **ref-naming 문법 버그**(`49670241`) — 기계설계·AI 두 에이전트가 **독립적으로
   같은 근본원인 재발견**(교차검증 신호): 기본 프로바이더(DeepSeek)로 평범한 브리프가
   plan-preflight에서 거의 100% 거부 — 모델이 존재하지 않는 `e.vert.{i}-{j}`(2-인덱스)
   문법을 반복 생성, 실제 스키마는 `e.vert.{i}`(1-인덱스)뿐. `llmPlanner.ts`
   시스템 프롬프트에 인덱스 개수 차이 명시+워크드 예제 삽입. 실 DeepSeek 재검증:
   3브리프 0/3→3/3 성공.
2. **쉬운요약 도메인안전 배선 누락**(`7fc46d65`, P0) — 인테리어 평가에서 발견:
   FEA 안전율은 쉬운요약에 반영되는데(지난 세션 F2), 인테리어/조경/교량/건축의
   `domainSafetyReportHtml`(피난·활하중 등) 실패는 전혀 반영 안 돼 정원초과·출구부족
   패키지도 "이상 없음"으로 표시. `domain-dossier-verify.mjs`에 `domainSafetyVerdict()`
   신설(스키마불문 실패수집기), `easySummary()`에 `opts.domainSafety`로 병합, MCP
   `generate_package`+웹 `route.ts` 양쪽 배선. 실 MCP 재현으로 뒤집힘 확인.
3. **로컬 프로덕션 빌드 크래시**(`716aa905`, P1) — 성능평가 중 발견, **처음엔
   "병렬 에이전트 리소스 경합"으로 오판했다가 완전 격리 재현으로 정정**: 원인=
   `SENTRY_AUTH_TOKEN`(+ORG/PROJECT) 로컬 완전부재 시 `@sentry/nextjs` 빌드타임
   webpack 플러그인이 조용히 스킵 대신 uncaughtException으로 `next build` 자체를
   죽임(레일웨이는 시크릿 보유라 안 터짐 — 배포는 항상 정상이었음). `next.config.ts`에서
   토큰 있을 때만 `withSentryConfig`로 감싸도록 수정. 격리 재빌드로 크래시100%→
   완주(번들 692.8KB/763.3KB budget 통과) 확인.

## 2. 현재 상태 스코어카드 (축 분리, 이번 세션 실측 근거)

- **기계설계**: 커버리지 매트릭스 불변(계획 7/8+1부분·검증 7/8+1부분·**zero-touch
  n=0, 8/8 전카테고리**). 게이트 정직·기존 정확도(relErr≤1e-9 등) 재확인. ref-naming
  수정으로 "평범한 브리프 1차 성공률" 개선(정확한 before/after % 미측정 — 브리프
  3개 표본만, 통계적 확정 아님).
- **AI 레이어**: 재시도/복원력 수정 2건(`retryOnUnverified`·provider 예외 보존)
  생존 확인. 리뷰큐 클라이언트 게이트 거부=진짜, 서버 advisory=의도설계(회귀 아님).
- **인테리어**: P0 안전배선(지난 세션) 양쪽 호출부 생존, 가구수량 정확. 위 발견②로
  소비자 문서 정확도 개선.
- **성능**: typecheck 콜드177s/웜25-31s. gmsh 예산초과시 정직 screening강등(설계대로,
  회귀 아님 — 이 머신에서 상시 발생 가능성 있음, 미해결). 로컬빌드 크래시=위 발견③로
  해소. 번들: 공유청크 1.4MB(`60663.*.js`)+shape-generator/sketch-solver 236KB — budget
  내지만 가장 무거운 단일 청크.
- **PDM/mate 아키텍처 부채**: 1단계 완료, 2단계는 "준비만"(#3 미접촉) — **진짜
  고위험 마이그레이션(#3)은 여전히 미착수**, 다음 세션 재확인 필요 항목.

## 3. 다음 작업 — 전체 정리 (카테고리별, 각 항목에 근거·다음 행동 명시)

### A. 이번 세션에서 직접 파생 (우선순위 순 — 스코프/리스크 결정 포함하니 전부 사용자 확인 후 진행)

1. **PDM `documentId` 브리지** — `nf_projects`(현재 캔버스 저장, `?project=`)와
   `nf_documents`(이 PDM 버전 API가 쓰는 별개 ID공간)를 잇는 아키텍처 결정. 다리
   없이는 서버 이력 UI(`VersionTreePanel`의 "서버 이력" 섹션, `documentId` prop)가
   오늘 라이브 화면에서 절대 활성화 안 됨(DocPermissionsButton의 `cloudDocumentId`도
   동일하게 미배선). **먼저 사용자와 논의**: 같은 id 공유? 신규 매핑 테이블? 이
   트랙 자체를 당분간 보류?
2. **mate 솔버 진짜 2단계** (#3 `AssemblyMates.ts` → #1 마이그레이션) — 스코핑
   리포트가 "medium risk, product-critical 드래그앤드롭/저장 경로"로 명시. 준비물
   (`faceRefResolver.ts`, 실 `solveMates()` 수렴까지 검증됨)은 완비 — 실행 여부/
   타이밍은 **다시 명시적으로 확인 후** 진행.
3. **gmsh precise 경로 벽시계 예산 재검토** — 이 개발머신에서 26s 예산을 34.5초
   정도로 상시 초과, "engineering" 등급이 실사용에서 자주 "screening"으로 강등될
   가능성. 예산 상향이 안전한지(레일웨이 게이트웨이 타임아웃과의 관계) 먼저 확인.
4. **ref-naming 수정의 통계적 확정** — 이번 검증은 브리프 3개 표본(정성적 확인).
   10~20개 규모로 재측정하면 실제 개선폭(%)이 나와 커버리지 매트릭스 갱신 근거가
   됨.
5. **로컬 vitest 하네스가 실 LLM 경로를 못 돈다** (신규 발견, 미수정) — 기계설계
   평가 에이전트가 확인: `getActiveBreaker()` → `admin-settings.ts:100` →
   `db-adapter.ts:180`의 lazy `require('./db')`가 vite-node 아래서만
   `Cannot find module './db'`로 깨짐(plain tsx는 정상). 결과적으로 "플래너가
   거부했다"는 결과가 진짜 의미론적 거부인지 하네스 결함인지 vitest 안에서는
   구분이 안 됨 — CI가 실 LLM 경로를 검증 못 한다는 뜻. 근본 수정 필요(예: 테스트
   환경에서 lazy require 우회하는 주입 경로 마련).
6. **hexbolt 픽스처 이슈 상태 미확정** — 이전 세션 메모에 있던 항목인데, 기계설계
   평가 에이전트가 design-driver 안에서 해당 픽스처를 찾지 못함(다른 파이프라인
   — SCAD/shape-generator exemplar 쪽 얘기였을 가능성). **다음 세션에서 확정**:
   메모가 스테일/오귀속이었는지, 아니면 실제로 남아있는 별도 이슈인지.
7. **"소비자 문서가 안전판정을 놓침" 패턴 전수 감사** — 같은 종류의 갭이 두 번
   연속 발견됨(1차: FEA 안전율이 쉬운요약에 안 반영 → 수정. 2차: 도메인
   안전검토가 쉬운요약에 안 반영 → 이번 세션 수정). **다른 계산기(DFM, GD&T,
   BOM 유효성, 실시검도 M1~M6 외 다른 산출물)도 consumer-facing 표면에 제대로
   반영되는지 체계적으로 점검** — 이 패턴이 세 번째로 나올지 미리 확인하는 게
   개별 발견을 기다리는 것보다 나음.

### B. Wave B 백로그 이월 — ⚠️**이 절은 스테일이다 (260727 정정)**

> 아래 목록은 **전부 이미 완료돼 있었다**: `dfa02fc6`(WB-6, matrix ③→A 87.5%)·
> `82faefc5`(WB-3, ⑤→A)·`b4238120`(WB-5) 등. 정본
> `docs/roadmap/AI_COVERAGE_MATRIX.md`는 **검증 A 7/8 = 87.5%, '불가' 소멸**로 이미
> 갱신돼 있었고, 남은 건 ⑥ 인벌류트 치형(별도 대공사·보류)뿐이다.
> **Wave B 백로그는 사실상 비어 있다** — 정정본은 `next-session-plan-260727.md` §5.

- WB-2 판금 전개 드라이버 편입(④ 판금 카테고리)
- WB-3 웰드먼트 편입(⑤ — W5-E 마이터+컷리스트를 계획 어휘로)
- WB-7 피처 패턴·end condition 계획 어휘(⑥ 기어류 부분 여는 관문)
- WB-5 GD&T 자동 제안(gdtSuggestion→도면 게이트 확장)
- WB-6 곡면 쉘/필렛 OCCT 게이트(③ 하우징 부분→A)
- ※ 전부 design-driver 계획 어휘(`llmPlanner`/`fixturePlanner`/`types`)+게이트 확장이라
  코어 경합 — 순차 또는 1트랙씩 권장(260722g 문서의 기존 권고 그대로 유효).

### C. 기존 아키텍처 부채 (4차 dogfooding에서 보류 — ③⑥은 이번 세션에 일부 해소, ⑦⑧은 미착수)

- ③ mate 솔버 4중구현 — 1단계(#4 폐기) 완료, 2단계 준비 완료, **진짜 실행(#3
  마이그레이션)은 위 A-2와 동일 항목** — 진행중으로 재분류.
- ⑥ PDM 게이트/승인 보장 — 서버측 advisory 필드는 완료, 그러나 클라이언트 UI가
  실제 라이브 문서에 안 물림(위 A-1과 동일 이슈) — 진행중으로 재분류.
- ⑦ **`VersionRepo.commit()` 낙관적 동시성 체크 없음**(stale-parent 조용히
  rebase) — 미착수. 현재 세션당 인메모리라 저위험이나, A-1(documentId 브리지)이
  실제로 배선되어 멀티세션이 열리면 위험도가 올라감 — A-1 착수 전에 같이 검토.
- ⑧ **CLI `resolve_constraints`가 같은 축 중복 제약 시 last-write-wins** — 미착수.

### D. 파트너/외부 의존 (코드로 못 여는 문 — 사용자 몫)

- **GA3 실측** — 배선 완료(autonomySessionStore+대시보드 mount), 디자인파트너
  접촉이 있어야 zero-touch n=0이 실제 값으로 채워짐. 온보딩=
  `docs/partner/AI_DESIGN_PARTNER_ONBOARDING.md`.
- **Yjs WS 서버 배포** — SSE는 라이브, 진짜 실시간 협업엔 WS 배포 필요(CF 계정
  확인 필요).

## 4. 검증 명령 (재현)

```bash
node scripts/typecheck.cjs                                          # 프로젝트 전체 tsc
npx vitest run "src/app/[lang]/shape-generator/pdm"                  # PDM 339
npx vitest run "src/app/[lang]/shape-generator/pdm/versionTreePanel.ui.test.tsx"  # 서버이력 UI 10
npx vitest run src/test/m3/                                          # mate 솔버 전체(faceRefResolver 포함)
npx vitest run src/lib/ai/design-driver/                             # AI 레이어 105
npx vitest run scripts/drawing-to-3d/easy-summary.test.ts            # 쉬운요약(도메인안전 포함) 24
npx vitest run scripts/drawing-to-3d/landscape-interior.test.ts      # ⚠️1건 사전 실패(무관, 조경 템플릿 카운트 7vs8 — 이번 세션 발견, 미수정)
npm run build                                                        # 로컬 프로덕션 빌드(이제 정상 완주)
```

## 5. 이번 세션에서 배운 절차적 교훈 (반복 방지용)

- **`cmd; echo "EXIT=$?"` 패턴은 셸이 보고하는 종료코드가 echo의 것**(항상 0)이지
  실제 명령의 것이 아니다 — 배포/빌드 성공 여부는 반드시 로그 안의 `EXIT=` 값을
  직접 읽어 확인할 것. 이번 세션에 이 실수로 "빌드 성공"을 두 번 잘못 보고했다가
  정정함.
- **repo 루트에 임시 검증 스크립트를 두고 그 상태로 동시에 빌드를 돌리면**, 빌드의
  타입체크 단계가 그 임시 파일을 루트파일 목록에 넣었다가 이미 삭제된 뒤 "file not
  found"로 실패할 수 있음 — scratchpad 우선, repo 루트 사용 시 빌드와 동시 실행 금지.
- **두 에이전트가 독립적으로 같은 근본원인을 발견하면** 그 자체가 신뢰도 신호 —
  이번 세션 ref-naming 버그가 그 사례.
