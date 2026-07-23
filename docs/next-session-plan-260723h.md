# 다음 세션 인수인계 — 2026-07-23h (아키텍처 부채 1~2단계 + 종합 평가 + 발견 3건)

**전임 문서**: `next-session-plan-260722g.md` (Wave B 배치1·GA3 배선·G4 영속)
**이 세션의 궤도**: 4차~5차 dogfooding(FEA·mate축 등, 이미 배포 -152/-153) 이후 —
아키텍처 부채(mate 솔버 통합·PDM 서버 게이트) 스코핑→구현, 이어서 사용자 지시로
"기계설계~인테리어·AI·성능" 종합 평가(4개 병렬 실행-기반 에이전트)→발견 3건 수정.
**배포**: -154(아키텍처 부채 1단계) → -155(2단계 준비+PDM UI) → **-156(현재 라이브,
평가에서 나온 3건 수정)**. `RAILWAY_EXIT=0`+헬스체크 200 확인됨.

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

## 3. 다음 작업 (우선순위 순, 전부 사용자 확인 후 진행 권장 — 스코프/리스크 결정 포함)

1. **PDM `documentId` 브리지**: `nf_projects`(현재 캔버스 저장)↔`nf_documents`(이
   PDM API가 씀) 둘을 잇는 아키텍처 결정. 다리 없이는 서버 이력 UI가 오늘 라이브
   화면에서 절대 활성화 안 됨. **사용자와 먼저 논의**(같은 id 공유? 신규 테이블?
   아니면 이 트랙 자체를 보류?).
2. **mate 솔버 진짜 2단계**(#3 `AssemblyMates.ts` → #1 마이그레이션): 스코핑
   리포트가 "medium risk, product-critical 드래그앤드롭/저장 경로"로 명시. 준비물
   (`faceRefResolver.ts`)은 완비, 실행 여부/타이밍은 **다시 명시적으로 확인 후** 진행.
3. **gmsh precise 경로 벽시계 예산**: 이 개발머신에서 26s 예산을 34.5초 정도로
   상시 초과할 수 있어 "engineering" 등급이 실사용에서 자주 "screening"으로 강등될
   가능성. 예산 상향이 실제로 안전한지(레일웨이 게이트웨이 타임아웃과의 관계)
   먼저 확인.
4. **ref-naming 수정의 통계적 확정**: 이번 검증은 브리트 3개 표본 — 더 큰 표본으로
   실제 개선폭(%) 측정하면 커버리지 매트릭스 갱신 근거가 됨.
5. Wave B 백로그 잔여(WB-2 판금·WB-3 웰드먼트·WB-7 패턴·WB-5 GD&T·WB-6 곡면쉘) —
   260722g 문서에서 그대로 이월, 아직 미착수.
6. GA3 실측(파트너 확보 시) — 배선 완료, 파트너 접촉은 사용자 몫.

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
