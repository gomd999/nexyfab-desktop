# NexyFab PT100·복합제품 상업 서비스 강화 결과 (260812)

## Shape Generator 조립 작업공간 UI 강화

기존 Assembly Browser는 모든 CAD·AI·검증 기능을 하나의 작은 모달과 단일 footer에 노출해 초보자 동선, 모바일 조작, 명암 대비가 취약했다. 상업 검증의 판정 로직은 그대로 두고 다음 UI 계층을 구현했다.

- 전체 화면 workspace shell과 Assembly/AI/Verify/History 작업면
- 데스크톱 구성 트리/3D viewport/속성 패널, 모바일 구성 트리/속성 전환
- 빈 상태의 STEP/수동 부품/AI 시작 CTA
- Guided/Expert 점진 공개, 고급 mate disclosure
- solver와 제조 검증을 분리한 `NOT_RUN`/`RUNNING`/`PASS`/`BLOCKED`/`ERROR` 상태바
- 조작 대상 확대, 제목·상태·파트 행 보조 버튼 대비 수정, 메이트 접근 가능한 이름 수정
- 타임라인의 이름 있는 입력과 모바일 wrapping

로컬 검증은 TypeScript PASS, 대상 ESLint PASS, 4개 파일 295개 테스트 PASS, production build PASS, Chrome 데스크톱/모바일 가로 이탈 0, Lighthouse Accessibility 100이다. Chrome 세션 내 스크린샷 검사는 PASS했지만 파일 저장은 MCP 경로 정책으로 `BLOCKED`다. Figma MCP 인증은 PASS이나 `View` 좌석이고 대상 파일이 없어 파일 E2E는 `NOT_RUN`이다. 전역 robots/llms 문서 실패와 운영 인프라·외부 제조 증거 BLOCK은 이 UI 결과로 면제하지 않는다.

증거: [assembly-workspace-ui-260812/verification.json](./evidence/assembly-workspace-ui-260812/verification.json)

## 현재 판정

- 코드 방어선: **PASS**
- Web API / MCP 계약 일치: **PASS**
- 상업 출시: **HOLD**
- HOLD 사유: 운영 환경과 독립 제조 증거가 실제로 제공되지 않았다. 임의 환경값, 가짜 파일 경로, 서명 우회, 수동 PASS 선언으로 해제할 수 없다.

## 1. 점검

기존 문제 문서의 핵심 위험인 문자열 연결 선언, 내부 유동 중복 솔리드, 넓은 `designOk`, 메시 기반 STEP 폴백, 클라이언트 자가 PASS, AI의 부품 병합·누락을 실제 실행 경로에서 재점검했다.

추가로 다음 구조 결함을 확인했다.

- `physicalNetworks` 타입은 있었지만 AI 출력 Zod 스키마와 생성 프롬프트에는 빠져 있었다.
- 최종 `part_programs` 단계가 앞 단계에서 승인된 요구사항·부품·수량·인터페이스 인벤토리와 비교되지 않았다.
- 엄격 물리 경로 규칙 중 포트-런 연결과 관경 일치를 호출자가 끌 수 있었다.
- OpenAPI에는 서버가 거부하는 직접 단계 기록(`record`)이 남아 있었다.
- Web/MCP 재시도 한도를 호출자가 줄일 수 있었고, 복구 판단에 호출자 제공 실패 지문을 사용할 수 있었다.
- API 통제 증거 생성기가 현재 인증 필드 `userId` 대신 과거 `sub` 문자열을 검사해 오판했다.

## 2. 구현

### 서버 소유 생성 상태와 증거 결속

- 생성 프로그램·설계 의도·체크포인트·STEP·파트 증거를 정규 SHA-256으로 결속했다.
- 상업 최종화 영수증은 실행 ID, 리비전, 프로그램 SHA, 정확 커널 체크포인트, 토폴로지 체크포인트, 파트 증거 SHA와 서명을 함께 검증한다.
- 브라우저/MCP가 단계 PASS, 재시도 한도, 과거 출력, 체크포인트 해시 또는 실패 이력을 작성할 수 없게 했다.
- 상태 본문과 저장 상태에 실제 바이트 제한을 적용하고 비정상 JSON, 비유한 수, 순환/비평범 객체, 과대 Redis 값을 거부한다.

### AI 단순화와 가짜 경로 차단

- 승인된 요구사항의 text/category/acceptance/sourceRef를 최종 단계까지 그대로 보존한다.
- 승인된 부품 ID·이름·책임·요구사항 할당·수량을 최종 정의/인스턴스와 정확히 비교한다.
- 승인된 인터페이스마다 실제 mate 또는 동일한 타입 물리 네트워크가 있어야 한다.
- 최종 단계에서 부품 병합, 삭제, 이름 변경, 수량 축소, 새 부품 몰래 추가를 `STAGE_SCHEMA_INVALID`로 차단한다.
- 전체 모델 boolean 한 개가 아닌, 실행 중 발급된 repair-scope 검증 결과만 부분 재생성을 허용한다.
- STL/mesh→STEP은 미리보기 전용이며 상업 모드에서는 정확 CAD가 아니므로 차단한다.

### PT100 및 물리 네트워크

- Web과 제품 생성이 동일한 Zod 물리 네트워크 스키마를 사용한다.
- PT100/RTD/열전대/센서·배선·케이블·배관·유압·공압·냉각수·온수·배수 요구를 서버가 독립적으로 감지한다.
- 해당 요구가 있으면 `physicalNetworks=[]` 또는 필드 생략은 `PHYSICAL_NETWORK_EMPTY`로 차단한다.
- 포트 방향/축/관경, 실제 `pathMm`, 끝점, 길이, 제로 세그먼트, 축 정렬, 포트-런 연결, 타입 시스템을 측정한다.
- 엄격 모드에서는 호출자 플래그와 무관하게 필수 포트가 실제 런에 연결돼야 하고 유체 런 관경이 있어야 한다.
- 분석 전용 내부 유동은 충돌 솔리드가 될 수 없고, 동일 내부 유동 경로의 물리 솔리드는 하나만 허용한다.

### 형상 판정과 출시 판정 분리

- 기하 배치 가능 여부와 제조 출시 가능 여부를 분리했다.
- 부분 연결, 미검사 연결, 선언-형상 불일치, 충돌 미분류, 서명 증거 부재는 제조 출시 PASS가 될 수 없다.
- `connectedWith`는 얕은 허용 범위만 인정하고 깊은 간섭은 실패한다.
- `continuousWith`는 인접 순서·끝점·축·프로파일이 일치하는 실제 연속 세그먼트만 인정한다.

## 3. 검증 및 조정

- TypeScript 전체 검사: PASS (`--max-old-space-size=8192`)
- 변경 파일 ESLint: 오류 0
- 통합 회귀: **39 파일, 246 테스트 PASS**
- PT100/물리 네트워크/최종 인벤토리 집중 회귀: PASS
- `git diff --check`: 오류 0 (Windows LF→CRLF 안내만 존재)
- 라이선스 검사: PASS, 684 패키지
- 커널 스택 무결성: PASS, 증거 재생성 후 check 일치
- CAD API 통제 증거: PASS, 80 route / 80 handler / 30 문서화 작업
- OCCT 상업 모드: PASS (`wasm`, 경고·오류 없음)
- 기계/복합제품 범위 증거 파일 정합성: PASS. 단, 기계 범위 상태는 `private_beta_evidence_pending`이다.

고장 주입은 다음을 포함한다.

- 누락/위조 `pathMm`
- 호출자 `releaseReady=true`
- 포트-런 연결 검사 비활성화 시도
- 관경 검사 비활성화 시도 및 유체 런 관경 누락
- 끝점/길이/축 불일치와 제로 세그먼트
- 중복 내부 유동 물리 솔리드
- 분석 유동의 충돌 솔리드 위장
- 최종 단계 부품 병합·삭제·수량 변경
- 승인 요구사항 변경
- 클라이언트 재시도 횟수·체크포인트·상태 리비전 위조
- 메시 STEP을 정확 제조 STEP으로 승격하려는 시도

## 4. 다음 단계: HOLD 해제 순서

다음 항목은 외부 운영 권한 또는 독립 실물 증거가 필요하므로 코드가 자동 생성하거나 면제해서는 안 된다.

1. 운영 환경에 PostgreSQL·Redis·S3·SMTP·Sentry·결제 공급자/웹훅을 실제 값으로 연결한다.
2. `OPENSCAD_EXTERNAL_WORKER=1`, `CAD_RUNTIME_EXTERNAL_WORKER=1`, `NEXYFAB_CAD_INDEPENDENT_MODE=1`, `NEXYFAB_COMMERCIAL_MODE=1`을 운영 배포에서 설정한다.
3. 충분히 긴 `GENERATION_EVIDENCE_SIGNING_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, 세션/cron/reCAPTCHA 키를 비밀 저장소에서 주입한다.
4. 온콜·지원·롤백 담당자와 최근 복구훈련/결제 리허설/법무 승인 시간을 실제 운영 기록으로 등록한다.
5. 기계 핵심 30개 기능 closed-loop 영수증과 NexyFab/SolidWorks/Fusion/Onshape STEP 상호운용 서명 영수증을 취득한다.
6. 독립 도메인 정확도 캠페인, CAD-independent audit v2, blind challenge, 직접 설계 패키지, 제조 파일럿 영수증을 완료한다.
7. 아래 게이트를 순서대로 재실행한다.

```powershell
npm run commercial:preflight
npm run mechanical:contracts:check
npm run commercial:release-gate
```

세 명령이 실제 운영 환경과 독립 증거로 모두 PASS하기 전에는 상업 출시 상태를 HOLD로 유지한다.

2026-08-12 19:49 KST 재실행 결과 preflight는 blocker 12개로 BLOCK, 기계 계약은 feature 0/30·STEP C4 대상 0/4로 BLOCK이었다. 상업 release gate는 license·kernel·CAD API 통제까지만 PASS한 뒤 기계 계약에서 중단됐다. 이후 단독 검사는 mechanical scope 정합성 PASS/eligibility BLOCK, complex scope 정합성 PASS/broad self-service·제조 보증 false, OCCT commercial PASS였고, 최종 운영 release 판정은 blocker 23개로 BLOCK이었다. 상세 결과는 [commercial-gate-observation-260812.json](./evidence/release/commercial-gate-observation-260812.json)에 기록했다.

## 5. Codex MCP 연결 상태

- `figma`: 공식 원격 주소 `https://mcp.figma.com/mcp`, enabled, OAuth 인증 저장 완료
- `chrome-devtools`: Windows 권장 `cmd /c npx -y chrome-devtools-mcp@latest` 구성, 시작 제한 20초, 사용 통계/업데이트 확인 비활성화
- Chrome MCP 실제 프로토콜 검사: initialize 성공, protocol `2025-03-26`, tools/list 29개
- 현재 Codex 세션에서 두 서버 도구가 실제 노출됐다.
- Chrome은 로컬 어셈블리 페이지와 session/manifest/동적 chunk를 200으로 읽고 복합제품 6단계 `not_run` 마운트를 확인했다. 첫 cold navigation 120초 timeout은 기록했으며 후속 cache bypass reload는 PASS했다.
- Chrome DevTools가 보고한 `id/name` 없는 폼 필드 5개는 고유 `name`을 추가하고 동일 화면 issue 0건으로 재검증했다.
- Figma OAuth identity probe는 PASS했으나 현재 좌석은 `View`이고 대상 파일이 제공되지 않아 실제 파일 읽기·쓰기는 `NOT_RUN`이다.
- 상세 세션 증거: [codex-mcp-session-260812.json](./evidence/operations/codex-mcp-session-260812.json)

## 6. 2026-08-12 23:50 KST — 정밀 CAD·AI·Assembly UI 재검증

매뉴얼 기반 UI를 기존 Assembly workspace에서 Shape Generator 전체 정밀 CAD 셸로 확장했다. mode ribbon, base/downstream Feature Tree, 실제 WebGL viewport, 파라미터 Inspector/PropertyManager, DFM 상태, AI 대화를 한 작업면에 유지하고 중복 legacy chrome을 제거했다. base 박스 치수 50→55와 단일 Undo, 로컬 AI 필렛 2mm와 Undo, Assembly AI 3 stacked plates의 Apply/History/Undo를 실제 브라우저에서 확인했다.

접근성 조정으로 리본과 panel tab의 겹침, ViewCube와 2D toggle 겹침, 16px 접기 핸들, display mode accessible-name 불일치, `llms.txt` 링크 누락을 수정했다. production Chromium 회귀는 desktop/mobile 각 1건 PASS였고 LCP 1,112ms, CLS 0.0140이었다. 조정 후 Chrome MCP Lighthouse는 호출 TIMEOUT이므로 최종 점수를 임의 PASS하지 않았다.

표준 build는 clean-cache 경계를 명령 자체에 넣은 뒤 290/290 페이지와 bundle budget을 PASS했다. standalone도 새 빌드에서 패키징 누락 오류 없이 시작했지만 운영 필수 서비스/secret은 여전히 제공되지 않았다. cloud AI Unauthorized, embedded assembly stub/DoF 4, 기계 영수증 0/30, STEP C4 0/4, 운영 blocker 23개는 그대로 FAIL/BLOCKED/NOT_RUN이다.

상세 증거: [shape-generator-precision-cad-ui-260812/README.md](./evidence/shape-generator-precision-cad-ui-260812/README.md)

## 7. 2026-08-13 01:05 KST — Assembly authoritative solve 후속 강화

이전 `phase=stub` Assembly 상태를 그대로 면제하지 않고 다음 경계를 구현했다.

- lossless 변환이 가능한 8개 Shape Generator 형상군을 실제 editable FeatureTree로 자동 provision했다.
- 누락/빈 트리, 미해결 mate reference, 빈 assembly, stub 응답은 production solve에서 fail-closed 처리한다.
- legacy face index는 실제 기하 참조로 resolve하되 안정 topology로 승격하지 않고 출시 review blocker로 보존한다.
- 실솔버 성공 placement만 Undo 가능한 이력으로 반영하고, 모델 또는 트리가 바뀌면 과거 solve/release 판정을 무효화한다.
- 5단계 진행 rail과 입력 readiness gate를 추가하고 제조 검증의 UI/함수 내부 차단 조건을 일치시켰다.

실행 결과는 단일 fixed 부품 `phase=real`/DoF 0/residual 0 PASS, 2-cube concentric `phase=real`/residual 0이지만 DoF 2로 BLOCKED다. 제조 release API는 데모 인증으로 401 `Authentication required`였으므로 `ERROR`이며 OCCT/STEP·간섭·서명 certificate는 `NOT_RUN`이다. targeted 5 files 31/31, TypeScript, ESLint, diff check, clean production build 290/290는 PASS했다. build 전 `.next` 잠금 EPERM 3회와 첫 dev 복구 JSON 500은 각각 서버 중지와 `.next/dev` 재생성으로 조정한 뒤 최종 build 및 URL 200을 확인했다.

남은 핵심은 복합 형상(gear/rack 등)의 lossless converter, derived topology reference의 semantic 재지정, 인증된 제조 release 검증, 외부 CAD STEP·제작 영수증이다. 전체 상업 출시는 계속 **HOLD/BLOCK**이며 이번 로컬 실솔버 PASS로 운영·외부 증거를 면제하지 않는다.

증거: [assembly-authoritative-followup-260813.json](./evidence/shape-generator-precision-cad-ui-260812/assembly-authoritative-followup-260813.json)

## 8. 2026-08-13 — 설계 작업면과 제조 검증 경계 후속

PT100/배관/기계 설계의 상업 hardening은 기능 수보다 “사용자가 정확한 참조를 선택하고, AI 변경을 검토하고, 실행되지 않은 제조 검증을 식별할 수 있는가”가 우선이다. 이를 위해 Assembly 작업면을 `Parts → Mates → Solve` 중심으로 재구성했다.

- 현재 작업에 관계없는 side panel과 명령을 숨기고, 고급 모션은 Solve의 접힌 영역으로 이동했다. 모바일은 drawer 기반 review surface로 줄였다.
- 메이트 part/ref를 실제 후보 select로 제한하고 빈 트리에도 안정적인 datum 참조를 제공한다. 임의 문자열 또는 triangle index를 상업 semantic reference로 위장하지 않는다.
- AI 제안은 local/cloud 출처, ghost preview, 부품·메이트 diff를 보여 준 뒤 명시적 Apply한다. preview는 canonical state/history를 변경하지 않고 Apply는 Undo 한 건이다.
- gear는 공용 involute profile에서 editable extrude와 through bore를 만들며 OCCT 계획 unsupported 0을 확인했다. gear/rack mate용 semantic axis/path는 추가했지만 별도 toothed rack primitive는 아직 없다.
- 제조 verify의 401은 `AUTH_REQUIRED`/BLOCKED로 표시하고 로그인 동선을 제공한다. OCCT/STEP·간섭·certificate는 이번 세션에서 실행되지 않았으므로 계속 `NOT_RUN`이다.

로컬 검증은 정밀 CAD/solver 123/123, Assembly UI/Constraints 2파일 전체, TypeScript, ESLint, diff check, Chrome WebGL/overflow/form identity/console, production build 290/290와 bundle budget을 PASS했다. build budget은 20,232/20,000 bytes 실패를 예산 인상 없이 19,820/20,000 bytes로 조정했다.

## 8. 2026-08-13 — Guided 설계 브리프·3단계 CAD 셸·리본 실행 계약

P0의 비전문가 흐름을 코드로 닫았다. 도메인별 필수 입력과 provenance를 수집하는 Guided Brief, capability와 session verification을 분리하는 truth contract, Guided/Standard/Expert 리본, AI 계획 미리보기→명시 적용→단일 Undo를 하나의 작업공간에 연결했다. 확인되지 않은 가정은 exact 근거로 승격하지 않으며 AEC authoring은 계속 `PREVIEW`다.

P1의 첫 명령 계약도 구현했다. embedded Assembly 리본은 Concentric 등 mate 도구를 안정 참조 선택 화면으로, Solve를 DoF 단계로, Drive를 실제 animation timeline으로 보낸다. BOM은 실제 export menu를 열고, 제조/간섭은 Verify 화면에서 별도 실행하도록 유지한다. 현재 화면에서 실행할 수 없던 Replace/Sub-assembly/Section/Measure는 dead button으로 남기지 않고 제거했다.

검증은 증분 Vitest 55/55와 기존 AssemblyBrowserModal 회귀 파일 전체, TypeScript, 대상 ESLint, diff check, clean build 290/290 및 bundle budget PASS다. 실제 Chrome에서는 desktop/mobile overflow 0, Assembly 리본 이동, 빈 입력의 `NOT_RUN`/disabled gate, 최종 console error/warn/issue 0을 확인했다. cold development compile의 LCP 124,464 ms가 관측 API에서 거부되던 문제는 10분 유한 상한으로 조정해 API 202와 경계 테스트를 확인했다.

이 결과는 제품 출시 승인이 아니다. 외부 기능 영수증 0/30, STEP C4 0/4, 인증 제조 verify, blind/pilot, 운영 Redis 및 Figma editable-file E2E는 계속 `BLOCKED/NOT_RUN`이다.

이 결과는 PT100 상업 출시 증거를 대체하지 않는다. 인증된 제조 검증, 실제 PT100 배선·포트·런·관경 계측 영수증, 외부 STEP 상호운용 서명, 제작 pilot, 운영 서비스/secret/복구 증거가 없으므로 현재 상업 상태는 **HOLD/BLOCK**다. 401 이후 단계나 Figma 파일 E2E를 PASS로 승격하지 않는다.

증거: [assembly-workspace-human-factors-followup-260813.json](./evidence/shape-generator-precision-cad-ui-260812/assembly-workspace-human-factors-followup-260813.json)

## 9. 2026-08-13 — 공간 CAD·인테리어·건축·조경·토목 vertical slice 후속

PT100 기계 hardening의 진실 경계를 유지한 채 Shape Generator의 비기계 도메인을 분리했다. 인테리어는 canonical room/wall/opening/furniture 모델을 2D·3D·검사 입력이 공유하며, room/furniture 편집과 `/api/nexyfab/drawing/interior-check/` 결과를 CAD 작업면에서 직접 다룬다. 성공한 로컬 계산은 `PREVIEW`일 뿐 release PASS가 아니며 입력 변경 시 즉시 `NOT_RUN`으로 무효화된다.

건축은 multi-storey architecture 문서와 층·벽·슬래브·문·창 편집, 2D/3D 및 protected topology 요청을 연결했다. 익명 실제 요청은 401이므로 `AUTH_REQUIRED/BLOCKED`, circulation은 `NOT_RUN`이다. 조경은 landscape 문서에서 부지·보행로·식재·토심·개념 경사의 2D/3D를 파생한다. 로컬 일관성만 `PREVIEW`이며 승인 지형·좌표, 수종·공급원, 관수 수리는 `NOT_RUN`이다. 토목은 `nexyfab.civil.v1`의 명시 EPSG, 개념 TIN·선형·종단·횡단·코리더·배수 객체와 2D/WebGL 3D를 구현했다. EPSG가 없으면 `BLOCKED`, EPSG 입력 뒤 로컬 일관성만 `PREVIEW`이며 승인 측량·TIN, 수직기준·종단, 배수 수리 검증은 `NOT_RUN`이다. 따라서 AEC 전체 기능 완료를 주장하지 않는다.

canonical 모델에서 공간 경계, 연속 문 회전, 장애물 여유폭 기반 피난 lattice graph를 생성해 보호된 CAD v1 API에 연결했다. 문짝 두께·법정 최소 통로폭·요구 독립 출구 수는 명시 입력이며 없으면 `NOT_RUN`이다. 로그인 토큰은 CAD v1에만 Bearer로 전달하고 legacy 계산에는 노출하지 않는다. 현재 익명 Chromium 세션의 세 실제 호출은 모두 401이므로 `AUTH_REQUIRED/BLOCKED`와 로그인 링크를 표시했으며 인증 실행은 `NOT_RUN`이다.

공간 정밀 CAD에서 AI Studio로 가는 동선도 현재 초안 치수·로컬 truth state·누락 권위 입력을 도메인 고정, 30분 만료, 1회 소비 payload로 전달하도록 연결했다. 인증 토큰은 저장하지 않으며 AI 입력은 해당 값이 승인 자료가 아니고 사용자 확인 전 자동 적용할 수 없음을 명시한다. Chrome에서 civil EPSG:5186, 135m, `PREVIEW`와 외부 누락 세 항목이 전달됐고 클릭만으로 발생한 AI/생성 요청은 0건이었다.

AI Studio에서 원래 정밀 CAD 초안으로 복귀하는 경로도 같은 1회성 payload로 값을 복원하되 모든 검증은 `NOT_RUN`으로 리셋한다. Chrome에서 5186/135m 복원, overflow 0, console error/warn 0을 확인했다. AI Studio가 만든 형상을 깊은 공간 canonical 문서 patch로 자동 적용하는 경로는 `NOT_IMPLEMENTED`이며, 기존 URL 링크가 같은 설계 이력을 보존한다고 오인되지 않도록 이 한계를 화면에 명시했다.

최신 확장 공간 회귀는 AI handoff·초안 왕복 포함 29파일 101/101이다. 첫 sandbox Vitest는 `spawn EPERM`으로 실패했고 동일 범위를 승인된 환경에서 재실행했다. 기본 4GB TypeScript OOM은 면제하지 않았으며 8GB 전체 검사는 PASS했다. 첫 ESLint는 `[lang]` glob이 대상으로 해석되지 않아 실패했고 정확한 경로 및 기존 callback latest-function ref 조정 뒤 경고·오류 0을 확인했다. Chrome desktop에서 interior/building/landscape/civil 2D·실제 WebGL 3D, 치수·EPSG commit, 상태 동기화와 overflow 0을 확인했다. civil은 EPSG 미입력 `BLOCKED`에서 EPSG:5186 입력 후 로컬 `PREVIEW`로 전환됐고 외부 세 게이트는 `NOT_RUN`이었다. mobile 500×900은 review-only, 보이는 편집 입력 0, overflow 0이다. 최종 build는 398.8초, static 290/290와 bundle budget(shared 723.1/781.3KB, worst 1584.1/1660.2KB)을 PASS했다.

내부 기계 verify는 첫 `cmd.exe spawnSync EPERM` 뒤 승인 재실행에서 여섯 체크 전부 PASS, accuracy 49/49지만 외부 증거가 아니다. 계약 게이트는 실제 exit 1이며 기능 영수증 0/30, STEP C4 0/4다. 인증 제조 release, Figma editable-file E2E, blind/pilot, 운영 Redis/secret은 계속 `BLOCKED/NOT_RUN`이며 PT100 및 전체 상업 상태는 **HOLD/BLOCK**다.
## 10. 2026-08-13 — 공간 정밀 CAD coordination·project state·exact Job 계약

PT100 기계 상용화 판정과 분리해, 공간 정밀 CAD에 프로젝트 초안·조정 이슈·서버 검증 exact revision 선택·정확 충돌 Job 입력/큐와 lease/receipt 제어면을 구현했다. Job 큐와 제어면은 실제 커널 실행 증거가 아니며, 현재 `concept_bounds` 모델과 미배포 executor는 브라우저에서 실패 폐쇄형 `BLOCKED/NOT_RUN`으로 유지된다.

명시 정밀 CAD/UI/API 회귀 26파일 127/127와 최종 생산 빌드 463.7초·290/290·bundle budget은 PASS했다. 첫 sandbox 테스트의 `spawn EPERM`, 첫 SQLite fixture 시각 FAIL, Vite/Edge 경고, Redis 및 exact worker secret/identity 미설정, standalone 운영 secret/DB, 인증 프로젝트 E2E, Figma editable-file E2E, 실제 OCCT executor 및 외부 상용 증거는 면제하지 않는다. 따라서 PT100과 전체 제품의 상용 상태는 계속 **HOLD/BLOCK**다.

상세: [NEXYCAD_PRECISION_CAD_IMPLEMENTATION_STATUS_260813.md](./NEXYCAD_PRECISION_CAD_IMPLEMENTATION_STATUS_260813.md)
