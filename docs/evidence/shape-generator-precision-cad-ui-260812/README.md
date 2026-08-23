# Shape Generator 정밀 CAD UI·AI·Assembly 검증 (260812)

## 판정

- 사람의 설계 작업면: **PASS**. SolidWorks/Fusion 계열의 `리본 → Feature Tree → 3D Viewport → Inspector/PropertyManager → 상태/검증` 구조를 하나의 셸로 통합했다.
- 로컬 AI 편집과 파라메트릭 CAD 연계: **PASS**. 자연어 필렛 적용, 실제 피처 트리/메시/체적 갱신, Undo를 브라우저에서 확인했다.
- 조립 AI 초안과 canonical assembly 상태 연계: **PASS**. 다중 파트/메이트 초안 적용과 Undo가 동작한다.
- embedded assembly 정밀 해석: **지원 형상 경로 PASS / 불완전 구속 BLOCKED**. 실제 FeatureTree를 포함한 단일 fixed 부품은 `phase=real`, DoF 0, residual 0이다. 2-cube concentric 샘플은 `phase=real`과 residual 0이지만 DoF 2가 남아 allowed 0 기준으로 `BLOCKED`다.
- embedded assembly 제조 출시: **AUTH BLOCKED / 후속 증거 NOT_RUN**. 데모 세션의 release verify가 401 `Authentication required`를 반환해 OCCT/STEP·간섭·release certificate는 실행되지 않았다.
- 상용 정밀 CAD 전체 자격: **HOLD/BLOCKED**. 기계 기능 외부 영수증 0/30, NexyFab/SolidWorks/Fusion/Onshape STEP 영수증 0/4, 운영 release blocker 23개가 남았다.

## 참고 기준

`../document(manuals)`의 읽기 전용 매뉴얼 인덱스와 기존 추적표를 사용했다. 직접 UI 기준은 `SOLIDWORKS_Introduction_KO(1).pdf`, Fusion 360 handouts이고, 현재 provenance는 [manual-index.json](../../cad-program/requirements/manual-index.json), 상태 경계는 [requirement-traceability.md](../../cad-program/requirements/requirement-traceability.md)에 있다. 매뉴얼 기반 구조를 채택했지만 외부 CAD 상호운용 영수증을 대신하지 않는다.

## 구현 결과

1. 하나의 정밀 CAD 셸
   - 상단 mode/ribbon, 좌측 base solid+downstream feature tree, 중앙 실제 WebGL viewport, 우측 실제 파라미터 Inspector, 하단 DFM/상태 영역으로 정리했다.
   - 기본 박스를 트리의 root로 노출하고 폭/높이/깊이를 실제 scene store와 연결했다.
   - 숫자 연속 입력은 400ms 단위로 한 Undo transaction에 묶었다.
   - 좌우 패널 접기, 명령 팔레트, 추가/검색, ViewCube, display mode, 2D/3D 전환을 유지했다.
2. AI 설계
   - cloud `/api/shape-chat`가 `Unauthorized`일 때 오류를 숨기지 않고 로컬 명령 해석 fallback을 실행한다.
   - `필렛 반경 2mm 적용`은 feature tree에 fillet을 만들고 triangle 12→2,804, volume 30→29.67 cm³로 바꿨으며 Undo로 원복했다.
   - Assembly AI `3 stacked plates`는 3 parts/2 mates preview, Apply, History, Undo까지 확인했다.
3. 조립 정확성 경계
   - legacy placed-parts/CRDT와 canonical `AssemblyState` 사이의 bridge를 추가했다.
   - 지원하지 않는 reference는 손실시키지 않고 blocker로 남긴다.
   - lossless 변환 가능한 box/cylinder/disk/cone·frustum/pipe/washer/lBracket/wedge와 involute gear를 editable FeatureTree로 provision한다. gear 표시와 FeatureTree는 같은 프로파일 생성기를 사용하고 관통 보어를 별도 hole feature로 유지한다. 아직 미지원인 복합 형상은 proxy로 대체하지 않는다.
   - solver 응답의 phase/DoF/residual을 판정하며 stub 또는 허용 DoF 초과를 출시 PASS로 승격하지 않는다. 성공한 real solve placement만 Undo 이력으로 반영한다.
   - `부품 형상 → 해석 참조 → Mate → 구속 해석 → 제조` 진행 rail과 readiness gate로 누락 입력과 `NOT_RUN`을 작업면에서 확인할 수 있게 했다.
4. 사용성·접근성
   - 모바일은 편집 UI 대신 실제 형상의 읽기 전용 touch viewer와 QR/copy/email desktop handoff를 제공한다.
   - guest banner 중첩, ViewCube/2D toggle 중첩, 리본/패널 탭 중첩을 제거했다.
   - 접기 핸들은 24×24px, collapsed rail은 28px로 조정했다.
   - visible form field의 id/name/accessible label을 정리하고 display mode 아이콘은 접근성 이름에서 제외했다.
   - DFM/telemetry API는 canonical trailing-slash URL을 사용한다.
   - `public/llms.txt`에 실제 링크를 추가했다.
5. 빌드 재현성
   - `typecheck`가 Next 생성 타입만 정리한 뒤 남은 증분 build cache와 충돌해 `undefined.length`가 재현됐다.
   - 경로를 검증하는 기존 `scripts/clean-next-build.mjs`를 표준 `npm run build` 시작에 연결했다.

## 검증 결과

| 검사 | 결과 | 관측 |
|---|---|---|
| Chrome DevTools MCP 연결·실제 브라우저 조작 | PASS | 로컬 CAD 화면, WebGL canvas, API, DOM, AI/Undo를 확인 |
| Figma MCP identity | PASS | `DEEPIKA D DEVANATHAN`, student plan, `View` seat |
| Figma 파일 편집/sync | NOT_RUN | 편집 좌석과 대상 파일 URL 없음 |
| targeted ESLint | PASS | 오류 0; `ShapeGeneratorInner.tsx`의 기존 미사용 심볼 경고 4개 유지 |
| TypeScript | PASS | `npm run typecheck`, exit 0 |
| targeted Vitest | PASS | 10 files, 37 suites, 339/339 tests; jsdom WebGL 미구현 경고는 실제 Chrome 검증과 분리 |
| production build | PASS | 표준 `npm run build`, 540s, static pages 290/290, bundle budget PASS |
| standalone packaging/start | PASS(로컬 검증 범위) | 이전 누락 모듈 오류 미재현; 필수 보안 env 미설정 시 fail-closed, 로컬 검증값 주입 시 startup PASS |
| desktop Chromium regression | PASS | overflow 0, form identity 누락 0, 리본/탭·ViewCube/2D overlap 0, 접기 타깃 ≥24px, WebGL canvas 존재 |
| mobile Chromium regression | PASS | Pixel 5, view-only surface, overflow 0, 화면 밖 button 0, guest banner 0 |
| browser Web Vitals | PASS(관측) | LCP 1,112ms, CLS 0.0140 |
| 조정 후 Chrome MCP Lighthouse 재감사 | TIMEOUT | MCP 감사 호출이 반환하지 않아 점수를 PASS 처리하지 않음; 동일 Chromium assertion은 위와 같이 별도 PASS |
| cloud AI | FAIL | `Unauthorized`; local fallback은 별도 PASS |
| embedded assembly fixed-part solve | PASS | request FeatureTree 포함, API 200, `phase=real`, DoF 0, residual 0 |
| embedded 2-cube concentric solve | BLOCKED | `phase=real`, residual 0, remaining DoF 2 > allowed 0 |
| embedded manufacturing release verify | AUTH BLOCKED / NOT_RUN | API 401 `Authentication required`; 로그인 링크와 기술 상태를 표시하며 OCCT/STEP·간섭·certificate는 미실행 |
| mechanical contracts | BLOCKED | feature receipts 0/30, STEP C4 targets 0/4 |
| commercial release | BLOCKED | 운영·보안·결제·독립 증거 blocker 23개 |

기계 판독 결과는 [verification.json](./verification.json), 브라우저 회귀는 [shape-generator-precision-ui.spec.ts](../../../e2e/shape-generator-precision-ui.spec.ts)에 있다.

## 다음 단계

1. 별도 rack primitive와 아직 미지원인 복합 형상의 lossless FeatureTree converter를 구현한다. gear converter와 gear/rack semantic 축·경로는 이번 후속 작업에서 완료됐다.
2. 남은 derived triangle topology reference를 semantic face/axis/plane reference로 다시 지정해 release blocker를 해제한다.
3. 인증된 세션에서 manufacturing release verify를 실행해 OCCT/STEP·간섭·DoF·motion·joint certificate를 실제로 취득한다.
4. 운영 cloud AI 인증을 연결해 local fallback과 별개로 cloud path를 PASS시킨다.
5. Chrome MCP 프로세스를 재시작한 뒤 최종 CAD URL로 desktop/mobile Lighthouse를 다시 실행한다. 현재 재감사는 `TIMEOUT`이다.
6. 30/30 closed-loop 기능 영수증, 4개 CAD STEP 상호운용 서명 영수증, blind 20, 제조 pilot 3을 실제 외부 증거로 채운다.
7. PostgreSQL/Redis/S3/SMTP/Sentry/payment/worker/secret/on-call/restore/legal 조건을 운영 환경에서 충족한 뒤 commercial gate를 재실행한다.

## 2026-08-13 Assembly authoritative follow-up

targeted Vitest 5 files 31/31, TypeScript, targeted ESLint, diff check와 production build 290/290는 PASS했다. Chrome desktop 1440×1000은 document overflow 0, 실제 WebGL context, console error/warn/issue 0을 확인했다. mobile 390×844은 document overflow 0이며 5단계 rail만 내부 가로 스크롤이다. 스크린샷 파일 저장은 MCP workspace 경로 정책으로 `BLOCKED`이며 세션 내 육안 검사와 혼동하지 않는다.

build는 실행 중 dev/start/standalone 서버의 `.next` 점유로 3회 EPERM을 기록한 후 해당 검증 서버만 중지하고 424초 clean build를 PASS했다. 첫 dev 복구는 손상된 `.next/dev` JSON 때문에 500이었고, dev cache만 재생성한 뒤 동일 URL 200으로 복구했다. 상세 기계 판독 증거는 [assembly-authoritative-followup-260813.json](./assembly-authoritative-followup-260813.json)에 있다.

## 2026-08-13 작업 중심 UI·gear 정밀 경로 후속

SolidWorks/Fusion 계열의 밀도 높은 단일 화면을 그대로 복제하지 않고 `Parts → Mates → Solve` 작업별 PropertyManager 구조로 정리했다. 데스크톱은 현재 작업에 필요한 패널과 명령만 표시하고, 모바일은 좌·우 패널을 기본 drawer로 숨겨 캔버스와 핵심 명령을 우선한다. 모션/애니메이션은 Solve의 접힌 고급 영역으로 이동했다.

- 메이트 부품/참조 자유 문자열 입력을 실제 부품과 stable reference 드롭다운으로 바꿨다. 빈 FeatureTree에도 origin, XYZ axis, 기준면을 제공한다.
- AI 조립은 local deterministic/cloud AI 출처를 표시하고, 적용 전 ghost 3D preview와 `+parts/+mates/modified` diff를 보여준다. preview는 상태와 history를 바꾸지 않으며 Apply 전체가 Undo 한 건이다.
- involute gear는 표시 메시와 FeatureTree가 동일한 `gearProfile`을 사용한다. FeatureTree→OCCT 계획은 `extrude → through hole`, unsupported 0, final bore result로 검증했다.
- gear `rotation_axis/shaft_axis/pitch_axis/pitch_plane/pitch_point`와 선형 부품 `linear_axis/rack_path`를 part-local semantic reference로 소유한다. 별도 toothed rack 형상 primitive는 아직 구현하지 않았다.
- 제조 검증 401은 일반 오류로 숨기지 않고 `AUTH_REQUIRED`와 로그인 동선을 표시한다. 이 호출에서 OCCT/STEP·간섭·certificate는 모두 `NOT_RUN`이다.

검증 결과는 정밀 CAD/solver 관련 Vitest 6파일 123/123, Assembly UI/Constraints 2파일 전체 PASS, TypeScript PASS, targeted ESLint PASS, `git diff --check` PASS다. Chrome 1920×1080은 document overflow 0, WebGL true, visible/hidden form identity 누락 0, console error/warn/issue 0이었다. 모바일 390×844은 document overflow 0, 좌·우 complementary panel 기본 노출 0, footer를 Undo/Redo/STEP import로 축소했다.

production build는 첫 sandbox 실행이 `spawn EPERM`으로 실패했고, 이후 두 실행은 compile/290개 static page까지 성공했지만 Assembly route 20,232 bytes가 고정 예산 20,000 bytes를 넘어 최종 exit 1이었다. 예산을 올리지 않고 page-shell inline style을 CSS로 이동한 뒤 마지막 접근성 수정까지 포함한 최종 표준 build는 491.9초, static 290/290, Assembly route 19,820/20,000 bytes, bundle budget PASS로 exit 0을 기록했다.

로컬 AI preview/apply/Undo와 지원 형상 정밀 경로가 PASS여도 상업 제조 완료 판정은 아니다. 인증된 제조 verify, 외부 OCCT/STEP 실행 영수증, 간섭·서명 certificate, 30/30 기능·4 CAD 상호운용·blind 20·제작 pilot 3은 여전히 `NOT_RUN/BLOCKED`다.

## 2026-08-13 Guided/Standard/Expert·실행 리본 후속 증거

- Guided 새 exact 설계는 누락 치수/재료를 순차 질문하며 확인 전 AI network 요청 0건, 가정 입력은 exact 승격 차단을 확인했다.
- Standard는 기본 리본+`All tools`, Expert는 전체 고급 도구, Guided는 Sketch/Extrude/Hole/Fillet/Measure/Section/AI의 최소 완결 리본을 표시한다.
- Assembly Concentric → Mates/stable references, Solve → DoF task, Drive → 실제 animation timeline 이동을 Chrome에서 확인했다. 빈 조립체 solve/manufacturing은 disabled 및 `NOT_RUN`이다.
- Chrome 1440×900/500×900 document overflow 0, 마지막 Assembly 검증 console error/warn/issue 0이다.
- cold development LCP 124,464 ms 관측값은 수정 후 API 202로 수락된다. 성능이 좋다는 뜻이 아니라 느린 표본을 더 이상 폐기하지 않는다는 뜻이다.
- 증분 Vitest 15파일 55/55, 기존 AssemblyBrowserModal 회귀 파일 전체, TypeScript, 대상 ESLint, diff check, clean production build 290/290, bundle budget PASS다.

Figma는 identity 연결만 PASS이고 `View` 좌석/대상 파일 없음으로 editable-file E2E는 `NOT_RUN`이다. 외부 제조 및 상업 출시 증거 상태는 변경하지 않는다.

기계 판독 증거: [assembly-workspace-human-factors-followup-260813.json](./assembly-workspace-human-factors-followup-260813.json)

## 2026-08-13 공간 CAD·인테리어·건축·조경·토목 수직 기능 증거

- interior/building/civil/landscape에서 기계 ribbon/box/command palette를 제거하고 도메인별 공간 ribbon과 workbench를 연결했다.
- interior는 canonical model을 2D plan, WebGL 3D, verifier가 공유한다. 치수·문·출구·가구를 편집하고 실제 interior-check API 결과를 표시한다.
- 같은 모델에서 폐합 boundary, 연속 유한두께 door swing, 장애물 여유폭을 측정한 egress lattice graph를 만든다. 관련 governed 입력이 없으면 호출하지 않고 `NOT_RUN`을 유지한다.
- CAD v1 세 요청에만 로그인 Bearer를 전달한다. 익명 실제 호출은 boundary/door/egress 모두 401이었고 UI는 `AUTH_REQUIRED/BLOCKED`와 로그인 링크를 표시했다. 인증 성공 E2E는 `NOT_RUN`이다.
- 초기·입력 변경은 `CHECK NOT_RUN`, 성공한 계산은 `CHECK PREVIEW`, 요청 실패는 `BLOCKED`로 상단 truth strip과 작업면을 동기화한다. 어떤 경로도 release PASS로 승격하지 않는다.
- building은 multi-storey `nexyfab.architecture.v1` 문서를 2D 평면과 실제 WebGL 3D가 공유하며, 층·벽·슬래브·문·창을 파라메트릭 편집한다. 보호된 architecture verify의 익명 실제 호출은 401이었고 `AUTH_REQUIRED/BLOCKED`, circulation은 `NOT_RUN`이다.
- landscape는 `nexyfab.landscape.v1`에서 부지·보행로·식재·토심·개념 경사와 원기둥 줄기/타원체 수관 3D를 파생한다. 로컬 문서 일관성만 `PREVIEW`이며 승인 지형·좌표, 수종·공급원, 관수 수리는 `NOT_RUN`이다.
- civil은 `nexyfab.civil.v1` 문서에서 명시 EPSG, 개념 TIN·선형·종단·횡단·코리더·배수 객체를 만들고 같은 문서로 2D 선형과 실제 WebGL 3D를 파생한다. EPSG가 비어 있으면 로컬 검사도 `BLOCKED`, EPSG:5186 입력 뒤 내부 일관성만 `PREVIEW`다. 승인 측량·TIN, 수직기준·종단, 배수 수리 검증은 모두 `NOT_RUN`이다.
- 네 공간 정밀 CAD의 AI 브리프 동선은 도메인 링크만 열던 상태에서 현재 초안 치수·로컬 truth state·누락 권위 입력을 30분 만료/1회 소비 세션 payload로 넘기도록 연결했다. payload에는 인증 토큰이 없고, AI Studio는 승인 자료가 아닌 초안임과 사용자 확인 전 자동 적용 금지를 프롬프트에 명시한다.
- Chrome E2E에서 civil EPSG:5186, 길이 135m, 로컬 `PREVIEW`가 AI Studio에 전달됐고 승인 측량/TIN·수직기준·배수 수리는 누락 상태로 유지됐다. 버튼 클릭 시 AI/생성 요청은 0건, 핸드오프는 1회 소비, destination overflow 0, smooth-scroll 메타데이터 조정 후 console error/warn 0이다.
- AI Studio에서 원래 정밀 CAD 초안으로 돌아오면 EPSG:5186·135m를 복원하고 모든 검증을 `NOT_RUN`으로 리셋한다. 이 왕복도 1회 소비, overflow 0, console error/warn 0으로 관측했다. AI Studio에서 만든 형상을 깊은 공간 canonical 문서로 자동 적용하는 경로는 `NOT_IMPLEMENTED`이며 UI에 명시한다.
- Chrome 1440px에서 네 도메인의 2D/실제 WebGL 3D, 치수 commit, truth state와 overflow 0을 관측했다. building은 익명 401을 확인했고 landscape/civil은 console error/warn 0이다. civil 3D canvas는 888×520 WebGL이며 500×900은 보이는 편집 입력 0, review-only 안내, overflow 0이다.
- 최신 확장 공간 회귀는 Vitest 29파일 101/101, 8GB TypeScript, targeted ESLint 무경고다. 기본 4GB TypeScript OOM, 첫 Vitest `spawn EPERM`, 첫 ESLint `[lang]` glob 대상 없음 실패와 기존 DesignInner callback 의존성 경고를 면제하지 않고 동일 검사 재실행·정확한 경로·latest-function ref로 조정했다.
- 최종 production build는 398.8초, 290/290, shared 723.1/781.3KB, worst first-paint 1584.1/1660.2KB로 PASS했다. 이전 sandbox worker `spawn EPERM`, `.next` clean `ENOTEMPTY` 실패와 조정 이력도 유지한다.
- Redis 미설정 및 Edge Runtime 경고는 운영 blocker로 유지한다. Figma file E2E는 `NOT_RUN`, screenshot 파일 영속화는 MCP 정책으로 `BLOCKED`다.

기계 내부 verify는 첫 `cmd.exe spawnSync EPERM` 뒤 승인 재실행에서 여섯 체크 전부 PASS, accuracy 49/49다. 외부 feature receipt 0/30, STEP C4 0/4 계약 게이트는 실제 exit 1 `BLOCKED`이며 제조 인증·blind/pilot도 `NOT_RUN`이다.

기계 판독 증거: [spatial-cad-workspace-followup-260813.json](./spatial-cad-workspace-followup-260813.json)
