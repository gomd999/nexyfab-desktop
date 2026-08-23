# NexyFab 현재 상태 및 상업 서비스 기준 재평가

## 2026-08-12 Shape Generator 조립 UI 재평가 추가

- 로컬 CAD 매뉴얼(SOLIDWORKS, Fusion 360, Rhino, Grasshopper)의 공통 패턴을 기준으로 기존 거대 모달을 전체 화면 작업공간으로 재구성했다.
- 상단 작업공간 탭, 구성 트리/중앙 3D/속성 패널, 모바일 패널 전환, 하단 상태바, 안내/전문가 모드를 추가했다.
- 빈 조립의 초기 화면은 `STEP 가져오기`, `빈 부품 추가`, `AI로 시작` 세 동선만 우선 노출한다. 안내 모드에서는 고급 mate와 솔버 세부 설정을 점진적으로 공개한다.
- AI 설계, 검증, 기록을 별도 작업면으로 분리했고, 기존 AssemblyState/FeatureTree/solver/정확 검증 로직과 test id를 유지했다.
- solver 및 제조 출시 검증 초기 상태는 계속 `NOT_RUN`으로 표시한다. 검증 실패는 `BLOCKED`/`ERROR`로 표시하며 UI 변경으로 PASS 승격하지 않는다.

검증 결과:

- Chrome DevTools MCP: 연결 PASS, 실제 로컬 페이지 데스크톱 1440×1000 및 모바일 390×844 확인.
- Figma MCP: OAuth identity PASS, 좌석 `View`; 대상 파일 미제공 및 쓰기 권한 부재로 파일 읽기/쓰기 E2E는 `NOT_RUN`.
- TypeScript: PASS.
- 변경 파일 ESLint: PASS.
- 조립 UI/페이지 회귀: 4 files, 295 tests PASS. jsdom WebGL 미구현 경고는 존재하지만 테스트 실패는 0이다.
- Next production build: PASS, 290 static pages, bundle budget PASS. `REDIS_URL` 미설정 경고는 운영 BLOCK 경계로 유지한다.
- Lighthouse snapshot: 데스크톱 Accessibility/Best Practices/SEO `100/100/100`, 모바일 `100/100/80`; 두 뷰포트 모두 가로 이탈 컨트롤 0개.
- Chrome 세션 내 스크린샷 육안 검사는 PASS했지만 파일 영속화는 MCP 경로 정책으로 차단되어 `BLOCKED`로 기록했다.
- 남은 Lighthouse 실패는 전역 `robots.txt` 형식과 `llms.txt` 권고이며 이번 조립 UI PASS에 포함하지 않는다.
- 상세 관찰값: [assembly-workspace-ui-260812/verification.json](./evidence/assembly-workspace-ui-260812/verification.json)

상업 출시 판정은 기존과 동일하게 `BLOCK`이다. 이번 변경은 사용성·접근성·정보구조 개선의 로컬 PASS이며, 외부 제조 증거·운영 인프라·독립 검토의 HOLD/BLOCK/NOT_RUN을 면제하지 않는다.

- 평가일: 2026-08-12 (KST)
- 평가 대상: PT100/복합제품 설계, AI 생성·수정, 정확 CAD 증거, MCP·CLI·API, 상업 출시 게이트
- 기준 브랜치/HEAD: `release/2026-08-10` / `3d6ba1ec`
- 작업 트리: 변경 항목 482개가 있는 `candidate_uncommitted` 개발 스냅샷. 이 문서는 커밋·태그된 출시 기준선이나 외부 인증서가 아니다.
- 선행 요구 문서:
  - `C:\Users\gomd9\OneDrive\문서\Kims\NexyFab_PT100_문제점_및_개선요구사항.md`
  - `C:\Users\gomd9\OneDrive\문서\Kims\NexyFab_PT100_전체문제_FMEA_및_개선명세.md`
- 상세 구현 기록: [NEXYFAB_PT100_COMMERCIAL_HARDENING_260812.md](./NEXYFAB_PT100_COMMERCIAL_HARDENING_260812.md)

## 1. 최종 판정

판정 용어는 다음과 같이 제한한다.

- `PASS`: 현재 저장소에서 해당 범위를 실행해 통과한 증거가 있다.
- `HOLD`: 코드가 구현됐더라도 출시 또는 제조 판정에 필요한 외부·운영 증거가 부족하다.
- `NOT_RUN`: 이번 평가에서 실제 대상 환경을 실행하지 않았다.
- `BLOCK`: 조건 미충족 시 시스템이 성공·출시로 처리하지 않아야 하며, 현재 실제로 차단된다.

| 평가 영역 | 현재 판정 | 확인된 범위 | 남은 경계 |
|---|---|---|---|
| 허위 경로·문자열 기반 PASS 방지 | PASS | 서버 소유 증거, SHA-256 바인딩, 서명 영수증, 실측 검증, fail-closed | 운영 서명키·외부 작업자 구성 필요 |
| AI 임의 단순화·부품 생략 방지 | PASS | 요구사항·부품 재고·책임·수량·인터페이스 보존 및 제한 수리 | 모든 산업 제품군의 제조 적합성을 뜻하지 않음 |
| PT100 및 물리 네트워크 검증 | PASS | 타입 포트, 방향·직경·삽입·경로, 연결성, 중복 유동 솔리드 검증 | 실제 제작물 계측·현장 배선 검증은 별도 |
| 정확 CAD와 제조 출시 분리 | PASS | 형상 생성 성공만으로 제조 출시 불가, 메시/근사 STEP 차단 | 독립 CAD 상호운용·제작 영수증 부족 |
| 로컬 타입·정적·회귀 검증 | PASS | TypeScript, 대상 ESLint, 39개 파일 246개 테스트 | 실서비스 트래픽·장애복구 검증 아님 |
| CLI | PASS | 로컬 계약 및 회귀 테스트 통과 | 배포 환경의 실제 자격증명·외부 서비스 E2E는 NOT_RUN |
| API | PASS | 로컬 라우트, OpenAPI, 인증 제어 증거 일치 | 운영 DB·Redis·스토리지·결제·메일 연결은 NOT_RUN |
| Chrome DevTools MCP | PASS | 현재 Codex 세션 도구 노출, 실제 로컬 페이지·세션·manifest·동적 chunk 200, 복합제품 패널 마운트 | 첫 cold navigation은 120초 timeout 후 완료됐으며 배포 환경 재현은 NOT_RUN |
| Figma MCP | 연결 PASS / 파일 E2E NOT_RUN | 현재 Codex 세션 도구 노출 및 OAuth identity probe 성공 | 대상 파일 미제공, 인증 좌석 `View`; 실제 파일 읽기·쓰기는 NOT_RUN |
| 복합제품 제한 파일럿 | 조건부 PASS | 명시적으로 통과한 제품군에 한해 closed-beta pilot 가능 | 광범위 self-service 및 제조 보증은 HOLD |
| 기계제품 전체 상업 출시 | HOLD | 내부 회귀와 fail-closed 구조 확인 | 30기능 폐루프, 150 의도 캠페인, 블라인드·제작 증거 미충족 |
| 상업 서비스 출시 | BLOCK | preflight/release gate가 미구성 운영조건을 차단 | 운영 인프라·보안·결제·복구·법무 증거 필요 |

현재 결론은 다음과 같다.

> NexyFab은 이제 복잡한 제품을 AI가 임의로 면제하거나 단순화해서 PASS시키지 않도록 코드와 로컬 검증 체계가 강화됐다. 그러나 이를 곧바로 “모든 복합제품을 제조 가능한 수준으로 검증 완료”라고 표현할 수는 없다. 현재 허용 가능한 주장은 **검증된 범위의 코드·로컬 통합 PASS**, **제한된 closed-beta 조건부 가능**, **광범위 상업 출시 HOLD**이다.

## 2. 이번 기준에서 확보한 핵심 통제

### 2.1 가짜 경로와 클라이언트 작성 증거 차단

- 생성 프로그램, 의도, 정확 CAD 체크포인트, 토폴로지, STEP, 부품 증거를 SHA-256으로 결속한다.
- 최종 출시 증거는 서버가 검증한 서명 영수증으로만 인정한다.
- 브라우저나 MCP 호출자가 `record`, 과거 fingerprint, 재시도 횟수 또는 PASS 체크포인트를 직접 작성할 수 없다.
- 요청 본문 크기는 선언값이 아니라 실제 스트림 바이트로 제한한다.
- 상태 저장 데이터의 무결성과 최대 크기를 검증한다.

### 2.2 AI의 임의 단순화·삭제·병합 차단

- 최초 승인된 요구사항, 부품 ID·이름·책임·수량·요구 배분을 최종 결과까지 보존한다.
- 부품 삭제, 임의 병합, 이름 바꾸기, 새 부품 끼워 넣기를 검증 실패로 처리한다.
- 인터페이스는 실제 mate 또는 타입이 지정된 물리 네트워크로 뒷받침돼야 한다.
- 수리 단계는 서버가 발급한 범위 안에서 실패한 부품·mate만 변경할 수 있다.
- 전체 설계 의도와 부품 재고의 전후 해시를 비교하므로 “고치기 쉽게 전체를 축약”하는 방식은 허용되지 않는다.
- 자동 재시도는 서버 고정 3회이며, 실패를 성공으로 바꾸는 무제한 재시도나 클라이언트 조작은 허용하지 않는다.

### 2.3 PT100·배관·배선·센서 네트워크 검증

- PT100/RTD/열전대/센서, 전기·데이터·배선·케이블, 배관·유체·유압·공압·급배수 요구에서 물리 네트워크 의무를 서버가 도출한다.
- 의무가 있는 요청에서 `physicalNetworks`를 생략하거나 빈 배열로 제출하면 실패한다.
- 포트 타입, 방향, 축, 직경, 삽입, 실제 경로 길이, 끝점, 0 길이 구간, 축 정렬, 직경 일치, 포트-런 연결성을 검증한다.
- `physical_solid`와 `analysis_only_internal_flow`를 구분하고, 같은 내부 유로가 중복 솔리드로 만들어지는 경우를 차단한다.
- 문자열 `connectedWith`와 `continuousWith`만으로 연결·연속성을 선언해 PASS할 수 없다.

### 2.4 형상 성공과 제조 출시 분리

- 형상 생성, joint, pipe, connection 증거와 manufacturing release를 별도 상태로 관리한다.
- 완전히 해결된 연결만 `releasePass`가 될 수 있다.
- 메시를 STEP으로 감싼 결과와 STL→STEP 근사 결과는 미리보기/비출시 결과이며 상업 출시에 사용할 수 없다.
- 충돌 검사는 원시 결과, 면제, 오류, 미분류를 분리하고 미분류 충돌을 자동 면제하지 않는다.
- `generation/verify` 결과는 advisory이며 단독으로 `releaseReady`를 만들 수 없다.

## 3. 실행 검증 결과

| 검증 | 결과 | 관찰값 |
|---|---|---|
| 전체 TypeScript 검사 | PASS | `npx tsc --noEmit --pretty false --incremental false` |
| 변경 백엔드 ESLint | PASS | 오류 0 |
| `StudioInner` ESLint | PASS(경고) | 오류 0, 기존 경고 8개: hook dependency 5, `<img>` 3 |
| 통합 회귀 | PASS | 테스트 파일 39개, 테스트 246개 |
| CLI/MCP/API/OpenAPI 집중 회귀 | PASS | 테스트 파일 4개, 테스트 75개 |
| diff 형식 검사 | PASS | 오류 0, Windows LF→CRLF 경고만 존재 |
| CAD API 제어 증거 | PASS | 라우트 80, 핸들러 80, 문서화 operation 30 |
| 커널 식별 증거 | PASS | 현재 커널 stack identity 증거 일치 |
| OCCT 상업 구성 검사 | PASS | `mode=wasm`, warning 0, error 0 |
| 라이선스 검사 | PASS | 패키지 684개, 중요 copyleft 3건은 현재 정책상 허용/검토 대상 |

집중 회귀에 포함된 명령은 다음과 같다.

```powershell
npx vitest run --reporter=dot scripts/cli/nexyfab.test.ts scripts/drawing-to-3d/cad-v1-mcp.test.ts src/app/api/cad/v1/capabilities/route.test.ts src/app/api/docs/openapi/route.test.ts
```

이 결과가 증명하는 것은 로컬 계약, 스키마, 라우트, 도구 동작이다. 운영 도메인에서 실제 OAuth, Figma 파일, Chrome 브라우저, DB, Redis, object storage, 결제, 메일을 모두 연결한 종단간 검증을 대신하지 않는다.

## 4. MCP·CLI·API 재평가

### MCP

- Chrome DevTools MCP는 Windows에서 `cmd /c npx -y chrome-devtools-mcp@latest --no-usage-statistics` 방식으로 설정했다.
- 실제 MCP `initialize`와 `tools/list`를 수행했고 도구 29개를 확인했다.
- Figma MCP는 `https://mcp.figma.com/mcp`로 활성화했으며 OAuth가 저장돼 있다.
- 2026-08-12 19:42 KST 현재 Codex 세션에서 두 서버 도구가 모두 실제 노출됐다. Chrome은 `127.0.0.1:3333`의 어셈블리 페이지, session API, manifest와 동적 chunk를 200으로 읽었고 복합제품 6단계가 `not_run`으로 마운트된 것을 확인했다.
- 첫 Chrome cold navigation은 Next.js 컴파일 중 120초 timeout이었고 이후 페이지가 200으로 완료됐다. cache bypass reload는 성공했으므로 로컬 warm E2E는 PASS지만 cold-start 시간은 면제하지 않는다.
- Chrome이 보고한 이름 없는 폼 필드 5개를 수정한 뒤 동일 화면에서 DevTools issue 0건과 각 필드의 `name`을 재확인했다.
- Figma `whoami` identity probe는 성공했지만 인증 좌석은 `View`이고 대상 파일 URL이 제공되지 않았다. 따라서 특정 파일 읽기·쓰기는 계속 `NOT_RUN`이다.
- 세션 증거: [codex-mcp-session-260812.json](./evidence/operations/codex-mcp-session-260812.json)

### CLI

- NexyFab CLI와 CAD v1 MCP 계약 테스트는 현재 통과한다.
- 호출자가 서버 상태나 검증 기록, 재시도 정책을 위조하는 입력은 노출하지 않는다.
- 로컬 테스트 PASS는 배포 서버 자격증명과 외부 작업자 연결 성공을 뜻하지 않는다.

### API

- capabilities, generation refine, physical-network verify, advisory verify, finalization receipt 계약이 코드·OpenAPI·MCP 사이에서 정렬됐다.
- API 라우트/핸들러 인벤토리는 80/80으로 일치한다.
- 실제 상업 환경 연결은 현재 운영 설정 미충족으로 release gate가 차단한다. 이는 우회할 항목이 아니라 배포 전에 채워야 할 조건이다.

## 5. 복합제품 및 기계제품 증거 재평가

### 복합제품 범위

[complex-product-scope-assessment.json](./evidence/cad-independent/complex-product-scope-assessment.json)의 판정은 다음과 같다.

- `scopedClosedBetaPilotEligible: true`
- `broadComplexProductSelfServiceEligible: false`
- `manufacturingReleaseGuaranteed: false`
- `failClosed: true`
- 8개 참조 제품군 중 교환 파일럿 검증 4개, 부분 검증 4개다.
- 6축 로봇 내부 예시는 `concept_only`, `releaseReady: false`다.
- 미해결 카탈로그 부품 22개와 정확 CAD, 제조 검증, 독립 이중 전문가 검토가 남아 있다.

따라서 “복잡한 제품도 무조건 제대로 완성·검증된다”는 주장은 아직 허용되지 않는다. 정확한 표현은 “명시적으로 검증된 제품군과 assertion만 제한적으로 통과하며, 미실행 항목은 그대로 NOT_RUN으로 남는다”이다.

### 기계제품 범위

[mechanical-product-scope-assessment.json](./evidence/cad-independent/mechanical-product-scope-assessment.json)의 현재 상태는 `private_beta_evidence_pending`이다.

- 내부 회귀 검증: PASS
- artifact/revision 일관성: PASS
- private beta 자격: false
- self-service 자격: false
- 제조 출시 검증: false
- fail-closed: true

남은 증거는 다음과 같다.

1. 기계 핵심 30기능 폐루프 검증
2. private beta용 직접 설계 패키지 10개
3. 전체 직접 설계 패키지 30개
4. 기계 의도 캠페인 150건
5. 표준 STEP 적합성 검증
6. 블라인드 제품 도전 20건
7. 실제 제작 파일럿 영수증 3건

`npm run mechanical:contracts:check`는 위조된 로컬 PASS를 만들지 않고 현재 `eligible=false`로 실패한다. feature 증거는 0/30이며 NexyFab과 별도 구현 계열 STEP 파서의 서명된 AP242 C4 영수증이 부족하다. SolidWorks/Fusion/Onshape는 기본 출시 조건이 아닌 선택 profile이다.

## 6. 상업 출시 차단 상태

`npm run commercial:preflight`는 현재 12개 조건을 차단한다. 핵심 미구성 항목은 다음과 같다.

- `DATABASE_URL`, `REDIS_URL`
- `RECAPTCHA_ALLOWED_HOSTNAMES`, `SECURITY_GATE_MODE`
- `SCAD_AGENT_SESSION_SECRET`
- `OPENSCAD_EXTERNAL_WORKER=1`
- `CAD_RUNTIME_EXTERNAL_WORKER=1`
- `NEXYFAB_CAD_INDEPENDENT_MODE=1`
- `GENERATION_EVIDENCE_SIGNING_SECRET`
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
- DB/Redis 실제 연결 확인

직접 commercial release gate에서도 아래 항목이 추가로 차단된다.

- S3 bucket/access/secret
- `CRON_SECRET`
- SMTP, Sentry
- 완전한 결제 provider 및 webhook
- `NEXYFAB_COMMERCIAL_MODE=1`
- on-call, support, rollback 담당자
- 복구·결제·법무 검증 시각
- 기계 도메인 정확도 증거 디렉터리
- CAD 독립 감사 v2

현재 상업 출시 판정은 명확히 `BLOCK`이다. 누락된 환경변수를 더미 값으로 채우거나, 외부 영수증을 내부 JSON으로 대체하거나, `NOT_RUN`을 `PASS`로 바꾸는 방식은 허용하지 않는다.

2026-08-12 19:49 KST 재실행에서도 같은 경계가 확인됐다.

- `npm run commercial:preflight`: **BLOCK**, blocker 12개와 warning 2개
- `npm run mechanical:contracts:check`: **BLOCK**, feature receipt 0/30, STEP C4 대상 0/4
- `npm run commercial:release-gate`: license 684 패키지, kernel identity, CAD API 80/80까지 PASS한 뒤 mechanical contract에서 **BLOCK**
- 집계 gate의 fail-fast 이후 단계는 그 명령 안에서는 `NOT_RUN`이었다. 이어서 독립 실행한 mechanical scope 정합성 check는 PASS였지만 eligibility는 `private_beta_evidence_pending`/BLOCK, complex scope 정합성은 PASS였지만 broad self-service와 제조 보증은 false, OCCT commercial은 `wasm`/경고 0/오류 0으로 PASS했다.
- 최종 운영 release 판정 스크립트를 독립 실행한 결과 인프라·보안·결제·운영·독립 증거 23개 blocker로 **BLOCK**이었다.
- 실행 증거: [commercial-gate-observation-260812.json](./evidence/release/commercial-gate-observation-260812.json)

## 7. 다음 진행 계획

이후 단계도 `점검 → 구현 → 검증(조정) → 다음 단계` 순환으로 수행한다.

### 단계 1 — 현재 변경 기준선 고정

- 점검: 482개 변경 항목을 release baseline 생성기로 재분류했다. 현재 분류는 deployable 438, documentation 30, evidence 14, protected 0, temporary 0이다.
- 구현: [commercial-release-baseline-current.json](./evidence/release/commercial-release-baseline-current.json)에 각 파일 byte/SHA와 작업트리 분류를 결속했다.
- 검증/조정: manifest는 `candidate_uncommitted`, HEAD `3d6ba1ec`, 변경 482건을 기록한다. `releaseCommitAllowed=true`는 보호·임시 파일 혼입이 없다는 뜻일 뿐 clean RC 또는 출시 승인이 아니다. 변경 소유권 검토, 커밋/태그와 전체 증거 재생성은 아직 남았다.
- 종료 조건: 커밋/태그 가능한 재현 기준선과 변경 추적표 확보.

### 단계 2 — MCP 실제 세션 종단간 검증

- 점검: 완료—현재 Codex 세션에서 Chrome DevTools와 Figma 도구 노출 및 Figma OAuth identity를 확인했다.
- 구현: Chrome 실제 페이지 조회와 폼 필드 5개 브라우저 issue 수정은 완료했다. 권한 있는 Figma 테스트 파일 읽기/쓰기는 대상 파일·편집 좌석이 없어 `NOT_RUN`이다.
- 검증/조정: Chrome cold navigation timeout, 후속 reload PASS, 네트워크 200/304, 콘솔 issue 0, Figma `View` 권한 경계를 세션 증거에 기록했다.
- 종료 조건: 구성 PASS가 아니라 실제 E2E PASS 증거 확보. 권한 없는 쓰기를 성공 처리하면 실패.

### 단계 3 — 운영 인프라와 API 종단간 검증

- 점검: DB, Redis, S3, worker, CAPTCHA, 결제, SMTP, Sentry, cron, 비밀키의 소유자와 환경별 상태를 확인한다.
- 구현: staging에 실제 서비스를 연결하고 최소 권한·키 회전·감사 로그·rate limit·idempotency를 적용한다.
- 검증/조정: 정상, 타임아웃, 재시도, 중복 결제, worker 중단, 저장소 장애, 복구 시나리오를 실행한다.
- 종료 조건: commercial preflight와 release gate 0 blocker, 장애 주입 및 복구 증거 확보.

### 단계 4 — 기계 30기능 폐루프와 상호운용

- 점검: 30개 기능별 권위 입력, 예상 B-rep, 질량/치수/토폴로지, STEP 왕복 acceptance를 확정한다.
- 구현: 누락 기능과 adapter를 기능 단위로 보완한다.
- 검증/조정: NexyFab과 별도 구현 계열 STEP 파서/작성기에서 signed receipt를 수집하고 revision/artifact SHA와 수치 보존을 대조한다. vendor CAD는 선택 profile로 분리한다.
- 종료 조건: 30/30 폐루프 및 요구 상호운용 증거 PASS. 일부 성공을 전체 성공으로 집계하지 않는다.

### 단계 5 — 블라인드·실제 제작 증거

- 점검: 설계자가 보지 못한 블라인드 제품 20건과 제작 파일럿 3건의 판정 기준을 사전 고정한다.
- 구현: 실패 항목만 bounded repair로 수정하고 전체 의도·부품 재고를 재검증한다.
- 검증/조정: 독립 검토자, 계측 원본, 불량·재작업 기록, 서명 영수증을 보존한다.
- 종료 조건: 요구 수량의 독립 증거가 모두 유효하고 위조·만료·revision mismatch가 0건.

### 단계 6 — 제한 beta 후 상업 출시 판정

- 점검: 검증 완료 제품군만 allowlist에 넣고 지원 범위와 금지 주장을 문서화한다.
- 구현: closed beta의 모니터링, incident, rollback, 고객 데이터 보호 체계를 운영한다.
- 검증/조정: 실제 beta 실패율과 제조 피드백을 기준으로 게이트를 재평가한다.
- 종료 조건: 모든 상업 게이트와 독립 증거가 PASS일 때만 self-service/제조 출시 범위를 확장한다.

## 8. 절대 면제하지 않는 판정 규칙

1. 실행하지 않은 검사는 `NOT_RUN`이며 PASS가 아니다.
2. 내부 생성 JSON, 모델 confidence, 문자열 연결 선언은 독립 증거가 아니다.
3. 메시, 미리보기 STEP, 근사 변환은 제조용 정확 CAD가 아니다.
4. 일부 부품·일부 제품군 PASS를 전체 제품 PASS로 승격하지 않는다.
5. timeout, 도구 미연결, 파서 오류, 검증기 오류는 자동 면제하지 않는다.
6. AI가 난이도를 낮추기 위해 부품·요구사항·인터페이스를 삭제하거나 병합하면 실패한다.
7. 수리는 실패 범위 안에서만 수행하며 수리 후 전체 회귀를 다시 실행한다.
8. 외부 서명, 제작, 상호운용 증거가 필요한 항목은 내부 테스트로 대체하지 않는다.
9. 운영 환경변수는 더미 값의 존재가 아니라 실제 서비스 연결과 복구 가능성으로 검증한다.
10. 출시 gate가 BLOCK이면 문서나 UI에서 출시 가능으로 표시하지 않는다.

## 9. 현재 사용자에게 답할 수 있는 정확한 문장

- **복잡한 제품 검증:** 구조상 임의 면제·부품 삭제·가짜 연결 PASS를 차단하도록 개선됐고 로컬 회귀는 통과했다. 다만 검증하지 않은 제품군과 실제 제작은 여전히 HOLD/NOT_RUN이다.
- **MCP:** 현재 세션에서 Chrome 실제 로컬 페이지 E2E와 Figma OAuth identity probe는 통과했다. Figma 실제 파일 읽기·쓰기는 대상 파일과 편집 권한이 없어 `NOT_RUN`이다.
- **CLI/API:** 로컬 계약과 회귀는 정상이다. 운영 인프라를 연결한 실서비스 E2E는 아직 완료되지 않았다.
- **상업 서비스:** 현재 출시 불가이며 gate가 정상적으로 차단 중이다. 위의 운영·독립·제작 증거를 충족한 뒤에만 PASS로 변경한다.

## 10. 2026-08-12 23:50 KST — Shape Generator 정밀 CAD UI 연속 구현 결과

사용자 작업 흐름을 `점검 → 구현 → 검증·조정 → 다음 단계`로 다시 수행했다. SolidWorks/Fusion 계열 매뉴얼 기준의 단일 정밀 CAD 셸, base solid가 포함된 실제 Feature Tree, 실제 파라미터 Inspector, AI 편집/Undo, embedded Assembly AI/History, 모바일 읽기 전용 handoff를 구현했다.

- targeted Vitest: **10 files, 37 suites, 339/339 PASS**. jsdom의 WebGL 미구현 경고는 실제 Chromium 검증으로 분리했다.
- TypeScript: **PASS**. targeted ESLint: 오류 0, 기존 미사용 심볼 경고 4개.
- 표준 `npm run build`: 손상된 증분 cache 재사용을 차단한 뒤 **PASS**, 540초, static pages 290/290, bundle budget PASS.
- standalone: 이전 `MODULE_NOT_FOUND`는 새 clean build에서 재현되지 않았다. 필수 보안 env 누락 시 fail-closed, 로컬 검증값 주입 시 startup PASS. 이는 운영 env PASS가 아니다.
- Chromium desktop/mobile: 적용 대상 2건 PASS, 교차 프로젝트 2건 명시적 SKIP. desktop control overlap 0, mobile overflow/button escape 0, LCP 1,112ms, CLS 0.0140.
- Chrome DevTools MCP 연결·실제 조작은 PASS지만 조정 후 Lighthouse 재감사는 도구 호출이 반환하지 않아 **TIMEOUT**으로 남긴다.
- Figma identity는 PASS, `View` seat와 대상 파일 부재로 실제 파일 편집은 **NOT_RUN**.
- cloud AI는 `Unauthorized`로 **FAIL**, local fallback과 Undo는 PASS.
- embedded assembly의 현재 request는 `phase=stub`, remaining DoF 4로 **BLOCKED**, release verification은 **NOT_RUN**.
- 기계 계약은 0/30 및 STEP 0/4로 BLOCK, 운영 commercial release는 blocker 23개로 BLOCK 상태를 유지한다.

상세 구현·검증·미완료 경계: [shape-generator-precision-cad-ui-260812/README.md](./evidence/shape-generator-precision-cad-ui-260812/README.md)

## 11. 2026-08-13 01:05 KST — Assembly 실솔버 입력·UI 프로세스 후속 구현

이전 재검증에서 `phase=stub`으로 남았던 embedded Assembly 경로를 다시 점검하고, 실제 부품 형상 입력부터 해석·출시 게이트까지 fail-closed로 연결했다.

- `box`, `cylinder`, `disk`, `cone/frustum`, `pipe`, `washer`, `lBracket`, `wedge`의 현재 파라미터를 손실 없이 `FeatureTree`로 승격한다. 사용자가 트리를 편집하면 자동 소유권을 해제해 편집 결과를 덮어쓰지 않는다.
- `gear` 등 아직 손실 없는 변환기가 없는 복합 형상은 bbox/proxy 형상으로 위장하지 않고 blocker로 유지한다.
- legacy triangle face 선택은 실제 part-local 기하 참조로 해석해 solver 입력에는 사용할 수 있게 했지만, 안정적인 semantic reference가 아니므로 `DERIVED_TOPOLOGY_REFERENCE` 출시 blocker는 유지한다. 해석 불가능한 참조는 solve 단계부터 차단한다.
- production solve client는 빈 조립체, 누락/빈 FeatureTree, `phase=stub` 응답을 거부한다. `phase=real`이고 성공 상태와 solved placements가 모두 있을 때만 한 개의 Undo history 항목으로 배치를 적용한다.
- UI에 `부품 형상 → 해석 참조 → Mate → 구속 해석 → 제조` 5단계 rail과 정확 입력 readiness gate를 추가했다. 빈 조립체에는 첫 부품 추가 지침을 표시하고, 제조 검증 버튼은 비활성 상태를 시각적으로 구분한다.
- 제조 검증은 버튼 속성뿐 아니라 실행 함수 내부에서도 빈 조립체, invalid FeatureTree JSON, 누락 트리, 미해결 참조, host release blocker, 필요한 governed motion 누락을 다시 검사한다.

실행 검증:

| 검사 | 결과 | 관측 |
|---|---|---|
| Chrome DevTools MCP 재연결 | PASS | 실제 로컬 페이지, WebGL context, DOM/네트워크/콘솔 재확인 |
| 단일 fixed 부품 실솔버 | PASS | `/api/assembly-solve/` 200, `phase=real`, DoF 0, residual 0, FeatureTree 요청 포함 |
| 2-cube concentric 샘플 | BLOCKED | 실솔버 계산과 residual 0은 확인했으나 remaining DoF 2 > allowed 0 |
| 제조 release verify | ERROR | 데모 세션에서 API 401 `Authentication required`; OCCT/STEP·간섭·release certificate는 이번 호출에서 `NOT_RUN` |
| desktop UI | PASS | 1440×1000, 문서 가로 이탈 0, 실제 WebGL context, 콘솔 error/warn/issue 0 |
| mobile UI | PASS(브라우저 관측) | 390×844, 문서 가로 이탈 0; 5단계 rail은 의도된 내부 가로 스크롤 |
| mobile screenshot 파일 영속화 | BLOCKED | Chrome MCP workspace 경로 정책이 저장을 거부; 세션 내 육안 검사는 별도 수행 |
| targeted Vitest | PASS | 5 files, 31/31; jsdom WebGL 미구현 경고는 실제 Chromium 검증과 분리 |
| TypeScript / targeted ESLint / diff check | PASS | 오류 0; LF→CRLF 안내만 존재 |
| production build | PASS | 초기 3회는 실행 중 서버의 `.next` 잠금으로 EPERM. 해당 검증 서버만 중지 후 clean build 424초, 290/290, bundle budget PASS |
| dev server 복구 | PASS(최종) | 첫 복구에서 손상된 `.next/dev` JSON으로 500; 캐시만 정리 후 동일 URL 최종 200 |
| Figma 파일 E2E | NOT_RUN | 기존 identity 연결 PASS를 유지하나 이번 후속 구현에는 대상 편집 파일/편집 좌석이 없음 |

따라서 “AI 설계 + 정밀 CAD가 모두 상용 제조까지 완전 작동한다”는 판정은 아직 허용되지 않는다. 현재 허용되는 판정은 **지원 형상의 실제 FeatureTree→실솔버 경로 PASS**, **부족한 구속의 정직한 BLOCKED**, **인증이 필요한 제조 출시 검증 ERROR/후속 증거 NOT_RUN**, **전체 상업 출시 BLOCK 유지**다.

상세 증거: [assembly-authoritative-followup-260813.json](./evidence/shape-generator-precision-cad-ui-260812/assembly-authoritative-followup-260813.json)

## 12. 2026-08-13 — 작업 중심 Assembly UI·gear 정밀 경로 완료

사람이 쓰기 어려웠던 전체 도구 동시 노출을 `Parts → Mates → Solve` 작업 중심 PropertyManager로 재구성했다. 데스크톱은 현재 단계에 필요한 browser/viewport/inspector와 footer 명령만 표시하고, 모바일은 좌·우 panel을 기본 drawer로 닫아 viewport와 다음 행동을 우선한다. 모션·애니메이션은 Solve의 접힌 고급 영역으로 이동했다.

- 메이트 part/ref 자유 문자열 입력을 실제 part와 stable reference select로 바꿨다. 비어 있는 FeatureTree에도 origin, XYZ axis, 기준면을 제공한다.
- AI 조립은 `Local deterministic`과 `Cloud AI` 출처를 구분하고, 상태를 바꾸지 않는 ghost 3D preview와 `+parts/+mates/modified` diff 뒤에만 Apply한다. Apply 전체는 Undo 한 건이다.
- involute gear 표시와 FeatureTree가 같은 프로파일 생성기를 공유한다. `extrude → through hole`, OCCT unsupported 0, final bore result를 테스트로 고정했다.
- gear의 rotation/shaft/pitch semantic ref와 선형 부품의 `rack_path`를 part-local reference로 저장한다. 별도 toothed rack primitive는 아직 구현하지 않았으므로 완료로 주장하지 않는다.
- 제조 verify 401은 `AUTH_REQUIRED`와 로그인 링크로 표시하고, 실행되지 않은 OCCT/STEP·간섭·certificate를 각각 `NOT_RUN`으로 유지한다.

검증 결과:

| 검사 | 결과 | 관측 |
|---|---|---|
| 정밀 CAD/solver Vitest | PASS | 6파일, 123/123 |
| Assembly UI/Constraints Vitest | PASS | 2파일 전체 PASS; Preview→Apply와 select 계약으로 테스트 조정 |
| TypeScript / targeted ESLint / diff check | PASS | 오류 0; line-ending 안내만 존재 |
| Chrome desktop | PASS | 1920×1080, overflow 0, WebGL true, form identity/label 누락 0, console error/warn/issue 0 |
| Chrome mobile | PASS(관측) | 390×844, overflow 0, 기본 side panel 노출 0, footer Undo/Redo/STEP import |
| 2-cube solve | BLOCKED | `phase=real`, residual 0, DoF 2 > allowed 0 |
| 제조 verify | AUTH BLOCKED / 후속 NOT_RUN | 401; OCCT/STEP·간섭·certificate 미실행 |
| production build | PASS(최종) | 491.9초, static 290/290, Assembly JS 19,820/20,000 bytes, bundle budget PASS |

build 검증 중 첫 sandbox 실행은 `spawn EPERM`으로 FAIL했고, 이후 두 실행은 compile/static 290개까지 성공했지만 Assembly route가 20,232 bytes로 고정 예산을 232 bytes 초과해 exit 1이었다. 예산을 올리거나 면제하지 않고 page-shell inline style을 CSS로 이동한 뒤 최종 exit 0을 얻었다.

Figma identity 연결은 기존 PASS를 유지하지만 편집 가능한 대상 파일과 편집 좌석이 없어 실제 파일 read/write E2E는 `NOT_RUN`이다. 인증된 제조 verify, 독립 STEP/간섭/서명 영수증, 30/30 기능, blind 20, 제작 pilot 3도 `NOT_RUN/BLOCKED`이며 전체 상업 출시는 계속 **HOLD/BLOCK**다. vendor CAD 4종 연결은 기본 gate에서 제외했다.

## 12. 2026-08-13 — 비전문가 AI 설계·정밀 CAD P0/P1 연속 구현

작업 순서는 `점검 → 구현 → 검증·조정 → 다음 단계`로 수행했다. 로컬 매뉴얼과 `NEXYCAD_Studio_UI_Prototype.html`, `NEXYCAD_Studio_UI_Interactive_v0.2.html`, `Downloads/html`의 기계·건축 화면은 정보구조 참고물로 사용하되, 2D 데모를 실제 B-rep 기능으로 오인해 이식하지 않았다.

- 기계·건축·토목·조경·인테리어 5개 도메인에 공통 Design Brief와 입력 provenance(`user_confirmed`, `imported_authority`, `assumed`, `missing`)를 적용했다. `assumed`는 exact/release 근거가 되지 않는다.
- CAD 능력과 현재 세션 검증을 분리한 truth strip을 추가했다. 예를 들어 기계 precision authoring은 `EXACT`를 표시할 수 있지만, DFM을 실행하지 않은 세션은 계속 `NOT_RUN`, 상업 release는 `BLOCKED`다.
- `Guided / Standard / Expert` 3단계로 리본 밀도를 분리했다. Guided는 완결 가능한 최소 도구, Standard는 기본 도구와 명시적 `All tools`, Expert는 전체 고급 도구를 제공한다.
- Guided의 새 설계 요청은 필수 치수·재료 등 누락 입력을 한 번에 하나씩 묻고, 확인 전에는 AI 서비스나 형상 변경을 실행하지 않는다. 모든 AI 변경은 계획 미리보기와 명시 적용 뒤 단일 Undo 항목으로 처리한다.
- embedded Assembly 리본을 실제 작업면의 Parts/Mates/Solve/Motion/Verify/BOM 동선에 직접 연결했다. 숨겨진 legacy panel만 열던 경로는 제거했고 아직 구현되지 않은 Replace/Sub-assembly/Section/Measure 버튼은 리본에서 제거했다. 빈 조립체 Solve와 제조 verify는 비활성이고 상태는 `NOT_RUN`이다.
- 개발 cold load에서 측정된 LCP 124,464 ms를 기존 120초 상한이 400으로 버리던 문제를 수정했다. duration metric은 유효한 매우 느린 로드를 보존하되 10분 유한 상한을 유지하며, 실제 API 재호출은 202를 반환했다.

검증 결과는 증분 Vitest 15파일 55/55, 기존 AssemblyBrowserModal 회귀 파일 전체, TypeScript, 대상 ESLint, `git diff --check`, clean production build 290/290와 번들 예산 PASS다. Chrome 1440×900에서 Guided/Standard/Expert, Guided AI 기본 패널, Assembly Concentric/Solve/Drive 동선을 확인했고 document overflow 0이었다. 500×900에서는 데스크톱 편집 대신 view-only/send-to-desktop 화면과 document overflow 0을 확인했다. 마지막 Assembly 검증 구간의 Chrome console error/warn/issue는 0이었다.

다음 경계는 그대로 유지한다. 기계 외부 기능 영수증 0/30, STEP C4 0/4, 인증된 제조 release verify, 외부 간섭·certificate, blind 20, 제작 pilot 3, 운영 Redis/secret과 Figma editable-file E2E는 이번 작업에서 실행되지 않았으므로 `NOT_RUN/BLOCKED`다. Figma MCP identity 연결은 PASS지만 좌석은 `View`다.

증거: [assembly-workspace-human-factors-followup-260813.json](./evidence/shape-generator-precision-cad-ui-260812/assembly-workspace-human-factors-followup-260813.json)

## 13. 2026-08-13 — 공간 CAD 분리·인테리어·건축·조경·토목 실제 편집 수직 기능

기계 Shape Generator를 건축·토목·조경·인테리어에 그대로 노출하던 결함을 수정했다. 공간 도메인은 별도 리본과 CAD 작업면을 사용하며, 기계 명령 팔레트·기계 박스·제조용 Share/Quote/Publish를 공간 설계의 완료 기능처럼 표시하지 않는다.

- 인테리어는 동일한 canonical 공간 모델에서 2D 평면, Three.js 3D 뷰, 벽·문 opening, 가구, 카운터, 면적·피난 계산 입력을 만든다.
- 방 폭·깊이·천장고·문 폭·출구 수와 가구 배치를 실제로 편집할 수 있고, 숫자 입력은 타이핑 중 강제 clamp하지 않고 blur/Enter에서 검증·반영한다.
- 계산 전과 치수 변경 후에는 상단/로컬 상태가 모두 `CHECK NOT_RUN`으로 돌아간다. 계산 성공은 `CHECK PREVIEW`이며 release로 승격하지 않는다. HTTP 실패는 `BLOCKED`다.
- 동일 canonical 모델에서 공간 경계 폐합, 연속 유한두께 문 회전, 장애물 여유폭 기반 피난 lattice graph를 만든다. 문짝 두께·법정 최소 통로폭·요구 독립 출구 수가 없으면 해당 검사는 `NOT_RUN`이며 임의 기본값을 넣지 않는다.
- 세 governed `/api/cad/v1/interior/*/verify/` 요청은 로그인 토큰이 있을 때만 Bearer를 전달한다. 현재 익명 Chromium 세션의 실제 401은 세 게이트와 상단을 `AUTH_REQUIRED/BLOCKED`로 표시하고 로그인 링크를 제공했다.
- 모바일은 레이아웃 review surface로만 표시하고, 치수·authority·검증은 desktop이 필요하다고 명시한다.
- 건축은 multi-storey architecture 문서에서 층·벽·슬래브·문·창을 만들고 같은 문서로 2D/3D와 topology 요청을 구성한다. 익명 architecture v1 실제 요청은 401이므로 `AUTH_REQUIRED/BLOCKED`, circulation은 `NOT_RUN`이다.
- 조경은 landscape 문서에서 부지·보행로·식재·토심·개념 경사와 식재 2D/3D를 파생한다. 로컬 일관성은 `PREVIEW`이고 승인 지형·좌표, 수종·공급원, 관수 수리는 `NOT_RUN`이다.
- 토목은 `nexyfab.civil.v1` 문서에서 사용자가 명시한 EPSG, 개념 TIN, 선형·종단·횡단, 코리더와 배수 객체를 만들고 같은 문서에서 2D 선형과 실제 WebGL 3D를 파생한다. EPSG가 없으면 로컬 일관성 검사도 `BLOCKED`, EPSG:5186을 입력하면 내부 문서·형상만 `PREVIEW`다. 승인 측량·TIN, 수직기준·종단, 배수 수리조건은 연결하지 않았으므로 계속 `NOT_RUN`이다. 어떤 공간 도메인도 기계 형상으로 대체하지 않는다.
- 공간 정밀 CAD의 `AI 설계 브리프`는 이제 단순 도메인 이동이 아니다. 현재 작업공간 초안 치수, 로컬 검증 상태, 누락/미검증 권위 입력을 도메인 고정·30분 만료·1회 소비 세션 payload로 AI Studio에 전달한다. 인증 토큰은 포함하지 않으며 프롬프트가 “승인 자료 아님, 먼저 계획 제안, 사용자 확인 전 자동 적용 금지”를 강제한다.
- 실제 Chrome에서 civil EPSG:5186·길이 135m·로컬 `PREVIEW`가 AI Studio textarea에 전달됐고 승인 측량/TIN·수직기준·배수 수리는 누락으로 남았다. 클릭 시 compose/assemble/AI 요청은 0건이고 handoff는 1회 소비됐다.
- AI Studio에서 원래 정밀 CAD 초안으로 돌아오는 경로는 EPSG:5186·135m를 복원하되 검증을 `NOT_RUN`으로 리셋한다. AI Studio의 형상 변경은 깊은 공간 canonical 변환이 없으므로 자동 적용하지 않으며 UI에도 `NOT_IMPLEMENTED` 경계를 표시한다.

검증 결과:

| 검사 | 결과 | 관측 |
|---|---|---|
| 공간 통합 회귀 Vitest | PASS(재실행 후) | AI handoff·초안 왕복 포함 최신 확장 범위 29파일, 101/101; 첫 sandbox 실행 `spawn EPERM`은 면제하지 않음 |
| TypeScript / targeted ESLint | PASS(조정 후) | 기본 4GB 타입 검사는 OOM; 8GB 전체 타입 검사 117.2초 오류 0. 첫 ESLint는 `[lang]` glob 대상 없음으로 실패했고 정확한 경로 재실행은 경고·오류 0 |
| Chrome desktop | PASS(관측) | 1440px, interior/building/landscape/civil 2D·실제 WebGL 3D, overflow 0, dimension/EPSG commit와 truth reset 확인 |
| Chrome mobile | PASS(관측 범위) | building/landscape/civil 500×900, overflow 0, review-only 제한 안내; civil 보이는 편집 입력 0 |
| 인테리어 계산 | PREVIEW | travel/egress/finish 결과를 실제 API에서 표시하되 release 근거로 사용하지 않음 |
| governed 경계·문·피난 | AUTH BLOCKED / 구현 회귀 PASS | API/입력 생성 회귀 PASS; 익명 실제 호출 3건 401, 인증 실행은 NOT_RUN |
| 건축 authoring | PREVIEW | multi-storey 2D/3D·opening·치수 편집 구현; 익명 architecture verify 401, circulation NOT_RUN |
| 조경 authoring | PREVIEW | site/path/planting/grade 2D·3D 구현; 외부 지형·수종·관수 권위 NOT_RUN |
| 토목 authoring | PREVIEW | EPSG fail-closed, TIN/alignment/profile/cross-section/corridor/drainage 2D·WebGL 3D 구현; 승인 측량·수직기준·배수 수리 검증 NOT_RUN |
| AI ↔ 정밀 CAD handoff | PASS(관측 범위) | civil 5186/135m/PREVIEW와 누락 권위 입력 전달, 자동 AI 요청 0, 1회 소비, overflow 0, 조정 후 console error/warn 0 |
| AI → 정밀 CAD 복귀 | PASS(원본 초안만) / NOT_IMPLEMENTED(AI 형상 적용) | 5186/135m 복원, CHECK NOT_RUN, 1회 소비, overflow 0, console error/warn 0; 깊은 canonical patch 없음 |
| production build | PASS(최종) | 왕복 복원 포함 398.8초, 290/290, shared 723.1/781.3KB, worst 1584.1/1660.2KB |
| Figma editable-file E2E | NOT_RUN | identity 연결은 PASS지만 `View` 좌석이고 대상 파일 없음 |
| Chrome screenshot 파일 저장 | BLOCKED | MCP workspace 저장 정책 거부; 세션 내 관측과 분리 |

내부 기계 검증은 첫 `cmd.exe spawnSync EPERM` 실패 뒤 승인된 동일 스크립트 재실행에서 여섯 체크 전부 PASS, accuracy 49/49다. 외부 계약 게이트는 실제 exit 1이며 기능 영수증 0/30, STEP C4 대상 0/4다. 인증 제조 검증, 외부 간섭·서명 certificate, blind 20, 제작 pilot 3, 운영 Redis/secret도 실행되지 않았으므로 전체 상업 출시는 계속 **HOLD/BLOCK**다.

증거: [spatial-cad-workspace-followup-260813.json](./evidence/shape-generator-precision-cad-ui-260812/spatial-cad-workspace-followup-260813.json)
## 14. 2026-08-13 — Freeze v4 기반 공간 정밀 CAD transaction·coordination·Job vertical slice

Freeze v4를 화면 참조에 그치지 않고 공간 정밀 CAD의 typed immutable command, 프로젝트 초안 CAS 저장/복원, 통합 조정, 경계상자 간섭 후보, tenant 격리 이슈와 정확 B-Rep 충돌 Job 입력/큐까지 연결했다. 건축·토목·조경·인테리어·통합 조정은 동일 작업 셸에서 각 도메인의 canonical 의미 모델을 사용하며 기계 형상으로 위장하지 않는다.

정확 충돌 Job은 공통 좌표계와 전 모델의 exact artifact/content hash/shape identity hash를 요구한다. 같은 프로젝트의 무결한 exact CAD revision만 discipline에 선택할 수 있고 enqueue에서 서버 저장 envelope와 hash를 재검증한다. lease·heartbeat·만료 재claim·CAS 완료/실패, 전용 secret과 worker/kernel identity registry, 모든 pair를 묶은 non-stub OCCT receipt 계약도 구현했다. 현재 기본 모델은 `concept_bounds`이고 운영 executor/secret/identity registry가 없으므로 Chrome 결과는 `JOB BLOCKED`, `EXECUTION NOT_RUN`, `RELEASE NOT_RUN`이다. 실제 B-Rep byte resolver·OCCT executor와 AI 생성 형상의 공간 canonical 자동 patch는 아직 구현되지 않았다.

회귀는 첫 sandbox `spawn EPERM` 실패 후 승인 환경에서 최종 명시 26파일 127/127 PASS, TypeScript 33.5초 exit 0, 최종 생산 빌드는 463.7초·static 290/290·bundle budget PASS였다. `/api/nexyfab/projects/[id]/cad-revisions`, spatial-cad 초안·issues·jobs와 `/api/internal/spatial-cad/jobs`가 production route 목록에 포함됐다. 첫 SQLite lifecycle fixture의 과거 완료 시각은 validation이 거부해 FAIL했고 실제 Job epoch 기준으로 조정 후 PASS했다. `REDIS_URL` 미설정, 운영 secret/durable DB, exact executor, 인증된 실제 프로젝트 E2E, Figma editable-file E2E와 독립 STEP 상호운용/검토/제작 증거는 계속 `BLOCKED/NOT_RUN`이다.

로컬 worker API 첫 probe는 trailing slash가 없는 POST가 308 뒤 로컬 HTTPS로 전환돼 `ERR_SSL_PROTOCOL_ERROR`로 FAIL했다. 정식 `/api/internal/spatial-cad/jobs/` 호출은 `503 WORKER_NOT_CONFIGURED`를 반환했고 reload 후 Chrome console error/warn/issue는 0이었다.

상세 상태와 다음 구현 순서: [NEXYCAD_PRECISION_CAD_IMPLEMENTATION_STATUS_260813.md](./NEXYCAD_PRECISION_CAD_IMPLEMENTATION_STATUS_260813.md)
