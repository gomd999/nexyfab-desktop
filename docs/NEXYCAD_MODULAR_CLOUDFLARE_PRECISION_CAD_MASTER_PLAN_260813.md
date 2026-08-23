# NEXYCAD 모듈 분리·Cloudflare 전환·정밀 CAD 완성 통합 마스터 플랜

- 기준일: 2026-08-13
- 대상 저장소: `nexyfab.com/new`
- 실행 방식: 점검 → 구현 → 검증·조정 → 다음 단계
- 현재 상용 판정: **HOLD / BLOCK**
- 생산 사이트 변경: 이 계획 수립 단계에서는 없음

## 1. 최종 결정

### 2026-08-13 실행 상태

- Wave 0~3: 로컬 구현 완료. 실제 Cloudflare 자원 생성·staging 배포는 `NOT_RUN`이므로 운영 gate는 열지 않는다.
- Wave 4 / G4: `PASS_LOCAL`. 공통 Studio shell, Mechanical, Coordination, 3개 desktop viewport, 실제 상태 패널, 키보드·포인터 패널 resize를 검증했다.
- Wave 5 / G5: `PASS_LOCAL`. Building·Civil·Landscape·Interior·Coordination의 typed revision, 저장·복원 unit path, immutable Undo/Redo, fail-closed governed check를 검증했다. 실제 로그인 프로젝트 browser E2E는 `NOT_RUN`이다.
- Wave 6 / G6: `PASS_LOCAL`. revision-bound AI Candidate, Diff, Locks, Evidence, 명시 Apply, stale/NOT_RUN 전파, single-step Undo를 unit 및 실제 Mechanical browser에서 검증했다.
- Wave 7 / G7: 로컬 exact compute, artifact hash gateway, Queue/Workflow, 네 Cloudflare Container와 Railway fallback 계약은 `PASS_LOCAL`. 실제 Cloudflare/Railway 동일 corpus parity는 `NOT_RUN`이므로 G7 전체는 `PARTIAL`이다.
- Wave 8 / G8: 단일 STEP OCCT 왕복, XCAF 조립체 검증·byte 보존, IFC hash-bound federation IR과 6축 보존, 별도 순수 TypeScript AP242 C4 16/16은 `PASS_LOCAL`. OCCT 반환의 occurrence 기하·배치는 보존되지만 이름·품번·label은 `FAIL_LOCAL`이고 외부 CAD 서명·DWG/RVT worker는 `NOT_RUN`이므로 G8 전체는 `PARTIAL`이다.
- Wave 9 / G9: Cloudflare 9개 배포 단위와 Railway `core-api`·`native-fallback` 최소 allowlist, 5단계 퇴역 순서, 30일 fail-closed gate는 `PASS_LOCAL`. 실제 이전·복구 훈련·30일 관찰은 `NOT_RUN`이다.
- 현재 실행 단계: 외부 staging·운영 증거와 상용 검증 준비.
- 전체 출시 판단: `HOLD`. 생산 배포, 독립 STEP C4 영수증, 독립 전문가 검토, 제조 pilot, 30일 운영 증거는 완료되지 않았다.
- 최신 상용 gate: 기술 release `BLOCKED`(v3 감사·승인 mechanical campaign 없음), private beta `BLOCKED` 4항목, GA `BLOCKED` 13항목. 내부 회귀나 dry-run으로 면제하지 않는다.
- 검증 영수증: `docs/evidence/platform-modularization-wave7-260813/verification.json`, `docs/evidence/platform-modularization-wave8-260813/verification.json`, `docs/evidence/platform-modularization-wave9-260813/verification.json`

폴더 분리, 선택적 검증·배포, Cloudflare 우선 인프라, Railway 최소화, NEXYCAD Studio UI 통합, AI 설계, 분야별 정밀 CAD, exact B-Rep 계산, CAD 상호운용, 상용 검증을 하나의 마스터 프로그램으로 연속 수행한다.

여기서 “한번에 한다”는 다음 의미다.

1. 범위 일부를 임의로 제외하지 않는다.
2. 작업을 여러 개의 서로 모순되는 계획으로 나누지 않는다.
3. 앞 단계가 끝나면 같은 기준서에서 다음 단계로 계속 진행한다.
4. 다만 생산 배포와 데이터 이전은 한 번의 빅뱅으로 수행하지 않는다.
5. 각 배포 단위는 독립 검증·canary·rollback이 가능해야 한다.
6. 실패, `NOT_RUN`, `BLOCKED`, 미구현 상태는 다음 단계나 출시 과정에서 자동 면제하지 않는다.

즉, **하나의 연속 프로그램으로 전부 구현하되 위험과 배포 단위는 분리한다.**

## 2. 현재 진실과 출발점

### 2.1 이미 있는 것

- Mechanical 정밀 CAD 3D 작업공간과 feature 중심 도구
- 건축·토목·조경·인테리어·통합검토 의미 모델과 preview 작업공간
- typed spatial command와 immutable revision 규칙
- 프로젝트 초안·이슈·Job 저장 및 tenant/권한 검증
- exact project revision 선택과 Job queue/lease/heartbeat/receipt 제어면
- Cloudflare Cron Worker와 협업 Durable Objects 기반
- Railway Next.js, PostgreSQL, Redis, OpenSCAD Worker, FEA Worker
- R2 호환 S3 storage adapter
- Freeze v4와 원본 `Downloads/html`의 제품·UI 기준

### 2.2 아직 완료되지 않은 것

- 원본 HTML/Freeze v4 수준의 통일된 실제 React Studio UI
- 모든 리본 도구의 실제 ToolDefinition/CommandBus 배선
- AI 계획을 canonical CAD 변경으로 변환하는 Preview → Apply → Undo
- immutable B-Rep byte resolver
- 실제 OCCT exact common/distance executor
- IFC/STEP exact federation 및 검증된 왕복
- 실제 로그인 조직·프로젝트 전체 E2E
- Cloudflare OpenNext production 호환 증거
- R2 직접 대형 업로드와 immutable artifact lifecycle
- Railway 최소화의 30일 비용·복구 증거
- 표준 STEP 독립 상호운용, 전문가 검토, 제작 pilot

현재 CAD UI와 제어면이 존재한다는 이유로 정밀 CAD 제품 전체를 `PASS`로 판정하지 않는다.

## 3. 목표 시스템 구조

```text
사용자 / Desktop / Browser
        │
        ▼
Cloudflare DNS · CDN · WAF
        │
        ▼
Edge Gateway
  ├─ NEXYCAD Studio Web / Static Assets
  ├─ Auth preflight / lightweight BFF
  ├─ R2 direct upload authorization
  ├─ Cron / Webhook ingress
  ├─ Queues / Workflows orchestration
  ├─ Durable Objects collaboration
  └─ CAD Containers
       ├─ OpenSCAD
       ├─ FEA
       ├─ IFC / STEP
       └─ OCCT Exact
        │
        ▼
Railway 최소 Origin
  ├─ Core transaction API
  ├─ PostgreSQL
  └─ Native CAD fallback
```

장기적으로 Containers와 외부 Postgres 대안이 모든 검증을 통과하면 Railway를 더 줄일 수 있다. Railway 0개를 목표 자체로 삼지는 않는다. 정확성과 복구 가능성이 비용 절감보다 우선이다.

## 4. 목표 저장소와 배포 단위

```text
apps/
  studio-web/                 # Cloudflare OpenNext / Static Assets
  core-api/                   # Railway 최소 transaction API

workers/
  edge-gateway/
  cron/
  webhook/
  collab/
  job-orchestrator/

containers/
  occt-exact/
  openscad/
  fea/
  ifc-step/
  native-fallback/

packages/
  cad-contracts/
  auth-contracts/
  job-contracts/
  artifact-contracts/
  cad-core/
  cad-shell/
  design-system/

domains/
  mechanical/
  architecture/
  civil/
  landscape/
  interior/
  coordination/
```

### 4.1 공통으로 공유할 것

- 문서와 revision 계약
- selection과 preselection
- CommandBus와 ToolDefinition
- Undo/Redo
- 단위와 tolerance
- 권한과 tenant context
- artifact와 Job 계약
- AI Intent·Lock·Candidate·Diff·Evidence
- 공통 Studio Shell과 디자인 토큰
- truth state (`PASS`, `FAIL`, `PREVIEW`, `NOT_RUN`, `BLOCKED`)

### 4.2 도메인별로 분리할 것

- 의미 모델
- ribbon와 tool manifest
- viewport adapter
- Browser tree provider
- Inspector/PropertyManager schema
- governed check
- export/import adapter
- 도메인별 test corpus

도메인은 서로 직접 내부 구현을 import하지 않는다. 분야 간 연결은 versioned contract와 `coordination`을 통한다.

## 5. 데이터 소유권

| 데이터 | 권위 저장소 | 금지 사항 |
|---|---|---|
| 사용자·조직·권한·결제·주문 | PostgreSQL | KV/Durable Object를 원장으로 사용 금지 |
| 프로젝트·CAD revision metadata | PostgreSQL | Queue만으로 상태 보존 금지 |
| STEP·IFC·B-Rep·도면·결과 | R2 | Web/Container 로컬 디스크에만 보존 금지 |
| 실시간 협업 session | Durable Objects | 장기 원장으로 단독 사용 금지 |
| 협업 복구 snapshot | Durable Objects + R2 | memory-only 복구 금지 |
| Job 전달 | Queues | CAD bytes를 message에 포함 금지 |
| Job 장기 상태·receipt | PostgreSQL + R2 | Queue 성공을 계산 성공으로 해석 금지 |
| Feature flag·비권위 cache | KV/Cache API | 결제·권한의 권위 판단 금지 |
| Container 작업파일 | ephemeral disk | sleep 이후 존재 가정 금지 |

## 6. 공통 계약

### 6.1 ToolDefinition

모든 표시 가능한 CAD 도구는 다음 계약을 가져야 한다.

```ts
interface ToolDefinition {
  id: string;
  domain: CadDomain;
  contractVersion: string;
  requiredSelection: SelectionRequirement;
  parameterSchema: unknown;
  previewCapability: 'EXACT' | 'PREVIEW' | 'NOT_IMPLEMENTED';
  executeCapability: 'EXACT' | 'PREVIEW' | 'NOT_IMPLEMENTED';
  undoPolicy: 'SINGLE_REVISION' | 'TRANSACTION' | 'NOT_AVAILABLE';
  requiredPermission: string;
  requiredEvidence: string[];
  unavailableReason?: string;
}
```

눌러도 아무 일도 하지 않는 장식 버튼은 금지한다. 도구는 `WORKING`, `PREVIEW`, `BLOCKED`, `NOT_IMPLEMENTED` 중 하나를 명시한다.

### 6.2 Artifact 계약

```text
artifactId
projectId / tenantId
objectKey
mediaType / format
byteLength
contentSha256
shapeIdentitySha256
producerBuildId
kernelIdentity
createdAt
immutabilityState
```

### 6.3 Job과 receipt 계약

- Queue에는 `jobId`, artifact key, hash, contract version만 전달한다.
- Worker는 R2 bytes와 hash를 다시 검증한다.
- Worker/kernel identity가 허용 목록과 일치해야 한다.
- 모든 요청 pair와 결과 pair 수가 일치해야 한다.
- receipt hash 검증 전 `execution=PASS`를 금지한다.
- 계산 PASS가 construction/manufacturing release PASS를 의미하지 않는다.

### 6.4 배포 식별

모든 앱·Worker·Container 응답과 로그에 다음을 포함한다.

- `buildId`
- `contractVersion`
- `schemaVersion`
- `kernelIdentity` 또는 `NOT_APPLICABLE`
- `environment`

## 7. 실행 Workstream

### WS-A — 기준선·거버넌스

- 전체 route/API/cron/webhook/service inventory
- 현재 비용·성능·오류율 기준선
- 데이터 소유권과 secret inventory
- rollback artifact와 DB backup
- 기존 dirty worktree 보존
- 상태 문서와 증거 registry 연결

### WS-B — 모듈·폴더 분리

- npm workspace 기반 경계 생성
- 기존 `src`와 새 package 사이 compatibility export
- import boundary 검사
- 순환 의존성 검사
- 도메인별 manifest와 lazy loading
- path 기반 test/build graph

### WS-C — Cloudflare Edge·Storage

- DNS/CDN/WAF/Gateway
- OpenNext Preview
- R2 large artifact storage
- direct multipart upload
- Range·cache·CORS·content disposition
- artifact retention과 orphan cleanup
- Workers/Queues/Workflows/Cron
- Hyperdrive 연결

### WS-D — NEXYCAD Studio UI

- 원본 `Downloads/html`을 제품·기능 깊이 기준으로 사용
- Freeze v4를 상호작용·시각 기준으로 사용
- 현재 React를 실제 기능·검증 기준으로 사용
- 공통 dark/light token
- title/menu/document/workbench/ribbon
- resizable Browser와 Inspector
- PropertyManager Preview/Accept/Cancel
- ViewCube·orbit·pan·zoom·fit·section
- command center·shortcut HUD·context menu
- Jobs·Issues·Timeline·status bar
- 접근성·키보드·축소 화면

### WS-E — 도메인 CAD

#### Mechanical

- sketch·feature·direct edit
- part·assembly·drawing
- constraints·mates·motion
- sheet metal·surface·MBD
- exact B-Rep revision과 topology identity

#### Architecture

- level·grid·wall·slab·roof·column·beam
- door·window·opening·stair·room
- plan·3D·section·elevation·schedule

#### Civil

- survey·coordinate system·TIN
- alignment·profile·cross-section·corridor
- grading·drainage·utility·earthwork

#### Landscape

- site·grading·path·hardscape
- planting·growth·season·root zone
- irrigation·water·lighting

#### Interior

- room·partition·opening·ceiling
- FF&E·finish·lighting·material
- circulation·egress·accessibility

#### Coordination

- exact linked models
- shared coordinates와 transform
- visibility·isolate·section
- bounds preview와 exact clash 분리
- issue·version compare·review·publish

### WS-F — AI 설계와 정밀 CAD 연결

```text
자연어/도면/사진
→ guided requirements
→ intent와 authoritative inputs
→ user locks
→ candidate plan
→ typed canonical CAD commands
→ geometry Preview/Diff
→ governed checks
→ 사용자 Apply
→ immutable revision
→ stale propagation
→ Undo
```

- 사용자가 잠근 값은 AI가 변경하지 못한다.
- 입력 근거가 없으면 값을 발명하지 않는다.
- 후보 지표는 실제 계산 결과와 연결되지 않으면 `ESTIMATE` 또는 `NOT_RUN`이다.
- Apply 전에는 프로젝트 권위 문서를 변경하지 않는다.

### WS-G — Exact CAD Compute

- immutable B-Rep byte resolver
- OCCT exact shape load와 transform
- boolean common과 exact distance
- tolerance policy
- timeout·cancel·lease·heartbeat
- retry와 quarantine
- kernel identity·content hash·shape hash
- signed receipt
- bounds issue의 exact 승격
- revision 변경 시 stale 처리

### WS-H — CAD 상호운용

- STEP import/export/roundtrip 우선
- IFC spatial/geometry/federation
- DWG는 검증된 변환 범위만
- RVT는 라이선스와 변환기 증거 확보 후
- 별도 구현 계열 STEP 파서/작성기에서 재개방·재출력·수치 비교
- vendor CAD 재개방은 제품별 선택 profile이며 기본 출시 조건이 아님
- units·coordinate·assembly·PMI·material 보존 측정

### WS-I — 운영·상용 검증

- 실제 사용자·조직·프로젝트 E2E
- 권한·tenant 침투 회귀
- backup/restore drill
- canary와 rollback
- 30일 비용·성능·오류 관찰
- 표준 STEP 독립 상호운용
- 독립 전문가 검토
- 제작 pilot
- release 재판정

## 8. 연속 실행 Wave

### Wave 0 — 기준선과 복구 지점

작업:

- 저장소·서비스·route·데이터 inventory
- 비용·성능·build identity capture
- 현재 UI와 API snapshot
- rollback/backup 확인

Gate G0:

- 누락된 서비스/데이터 소유권이 없음
- 복구 지점이 확인됨
- 미확인 항목은 `NOT_RUN`으로 기록됨

### Wave 1 — 폴더·계약 분리

작업:

- 새 폴더 구조 생성
- contract package와 domain manifest
- compatibility adapter
- path CI와 import boundary

Gate G1:

- 기능 변화 없이 기존 build/test/UI 기준 유지
- 공통 contract 변경 시 모든 소비자 검사가 실행됨
- 도메인 변경이 무관 Worker를 배포하지 않음

### Wave 2 — Edge와 R2

작업:

- Cloudflare Gateway가 기존 Railway를 proxy
- WASM과 CAD artifact R2 이전
- direct multipart upload
- artifact registry와 cleanup

Gate G2:

- 500MB class upload가 Worker memory를 경유하지 않음
- tenant 격리·hash·Range·중단 복구 PASS
- origin rollback PASS

### Wave 3 — 제어면 이전

작업:

- cron·webhook·notification
- Queues·Workflows·DLQ
- Durable Objects collaboration 정식화
- Redis 대체 대상 분리

Gate G3:

- duplicate delivery idempotency
- retry/DLQ/복구
- 협업 재접속·snapshot 복구
- Redis 제거 전 동등성 증거

### Wave 4 — Studio Shell과 대표 작업공간

작업:

- 공통 Studio shell
- Mechanical 전체 깊이 이식
- Coordination 실제 기능/상태 이식
- 원본 HTML과 Freeze v4 시각 회귀

Gate G4:

- 1920×1080, 1440×900, 1280×800에서 핵심 조작 가능
- console uncaught error 0
- 장식 버튼 0
- 실제 상태와 UI truth label 일치
- 기존 CAD 명령과 저장 회귀 PASS

### Wave 5 — 공간 도메인 완성

작업:

- Architecture·Civil·Landscape·Interior
- 도메인 ribbon/view/tree/inspector
- typed command와 project revision 배선
- governed check

Gate G5:

- 각 도메인의 core authoring loop가 저장·복원·Undo됨
- 외부 입력 없는 검사는 `NOT_RUN`
- preview와 exact가 구별됨

### Wave 6 — AI canonical Apply

작업:

- Intent·Locks·Candidate·Diff·Evidence
- AI plan → typed commands
- Preview → Apply → Undo
- stale propagation과 재검증

Gate G6:

- AI가 잠긴 값을 변경하지 않음
- 명시 Apply 전 권위 문서 불변
- fabricated evidence 거부
- candidate 비교 지표의 출처와 상태 표시

### Wave 7 — Exact Compute와 Containers

작업:

- R2 resolver와 OCCT executor
- OpenSCAD·FEA·IFC/STEP Containers 선행
- exact clash와 receipt
- Railway native fallback

Gate G7:

- 동일 corpus에서 Railway/Container 결과 일치
- content/shape/kernel identity 검증
- cancel/timeout/retry/recovery PASS
- exact 결과 없는 승격 0건

### Wave 8 — 상호운용

작업:

- STEP/IFC exact federation
- 별도 구현 계열의 AP242 조립체 재개방·재출력
- DWG/RVT 제한 범위 검증

Gate G8:

- unit·coordinate·topology·assembly 보존 측정
- roundtrip 손실이 문서화된 허용 범위 이내
- 미지원 형식을 지원으로 표시하지 않음

### Wave 9 — Railway 축소와 운영 검증

작업:

- web origin·Redis·검증된 CAD worker 순차 폐기
- Core API·PostgreSQL·fallback 최소화
- 30일 관찰과 복구 훈련

Gate G9:

- 비용·성능·오류율·복구 기준 만족
- 서비스별 rollback PASS
- 상용 release gate 재실행

## 9. 선택적 검증·배포 규칙

| 변경 경로 | 필수 검사 | 배포 단위 |
|---|---|---|
| `domains/mechanical/**` | mechanical + cad-core + Studio smoke | Studio Web |
| `domains/civil/**` | civil + spatial contract + visual | Studio Web |
| `domains/coordination/**` | coordination + exact job contract | Studio Web |
| `packages/cad-contracts/**` | 모든 CAD 소비자 | 소비자 전부 canary |
| `packages/design-system/**` | 7개 작업공간 시각·접근성 | Studio Web |
| `workers/cron/**` | schedule/idempotency | Cron Worker |
| `workers/collab/**` | WebSocket/tenant/recovery | Collab Worker |
| `containers/occt-exact/**` | exact corpus/kernel/receipt | OCCT Container |
| `containers/fea/**` | analytic/corpus/convergence | FEA Container |
| DB migration | backup/forward/rollback/API | Core API + DB gate |

공통 계약 변경을 도메인 단독 변경으로 위장해 선택 검사를 우회하지 않는다.

## 10. 배포와 rollback

모든 서비스는 다음 흐름을 사용한다.

```text
Local contract tests
→ Preview
→ Staging integration
→ Canary 1%
→ 10%
→ 50%
→ 100%
→ observation
```

다음 중 하나가 발생하면 자동 승격을 중단한다.

- auth/tenant 오류
- artifact hash 불일치
- Job 중복 최종화
- CAD exact 결과 불일치
- p95 또는 오류율 예산 초과
- rollback 불가능
- build/contract/kernel identity 미표시
- console uncaught error

DB migration은 backward-compatible expand → dual-read/write 검증 → contract 순서를 사용한다. destructive migration은 백업·복구 검증 전 실행하지 않는다.

## 11. 검증 예산

### 11.1 기능

- 기존 spatial CAD 명시 회귀: 최소 현재 127/127 유지
- 새로운 도메인/contract test는 추가되며 기존 수를 대체하지 않음
- 실제 인증 프로젝트 E2E 필요
- Queue duplicate/retry/DLQ test 필요
- Worker/Container receipt test 필요

### 11.2 UI/UX

- 7개 작업공간 핵심 화면 시각 회귀
- console error 0
- 접근성 critical 0
- 모든 interactive control에 accessible name
- 패널을 열어도 유효 viewport 확보
- 초보자 모드에서 필수 다음 행동이 한 화면에 보임

### 11.3 성능

- 기존 shared bundle 723.1/781.3KB 예산을 악화시키지 않음
- 기존 worst first-paint 1584.1/1660.2KB 예산을 악화시키지 않음
- 도메인 lazy loading으로 초기 CAD bundle 분리
- p95가 기준선 대비 20% 이상 악화되면 승격 중단

### 11.4 비용

- Railway 서비스별 월 환산
- Workers request/CPU
- R2 GB-month/Class A/B
- Queue operation/retry
- Container CPU/RAM/disk/egress
- 로그 비용

Cloudflare 이전은 단순히 다른 청구서로 비용을 이동하는 것으로 완료 판정하지 않는다. 동일 부하에서 비용이 의미 있게 낮아지거나 scale-to-zero·배포 격리·복구성이 개선돼야 한다.

## 12. Railway 축소 단계

### 현재

```text
Next Web + PostgreSQL + Redis + OpenSCAD + FEA
```

### 1차 목표

```text
Core API + PostgreSQL + Native fallback
```

### 2차 목표

```text
Core API + PostgreSQL
```

### 장기 선택지

```text
PostgreSQL 또는 Native fallback만 유지
```

각 제거는 별도 비용·정확도·rollback 증거가 필요하다. 특히 PostgreSQL을 D1로 바로 대체하지 않는다.

## 13. 외부 입력이 필요한 항목

다음은 코드만으로 임의 완료할 수 없다.

- Cloudflare/Railway production 권한과 secret
- 결제·이메일·스토리지 운영 credential
- 실제 조직·프로젝트 계정
- 별도 구현 계열 STEP 파서/작성기와 서명 가능한 검증 실행 환경
- vendor CAD 설치·라이선스와 test seat는 제품별 선택 profile에만 필요
- 편집 가능한 Figma 파일/좌석
- 승인 측량·지반·재료·법정 기준 입력
- 독립 전문가 서명
- 실제 제작·시공 pilot 결과

해당 입력이 없으면 코드·로컬·staging 범위까지 진행하고 운영/상용 증거는 `NOT_RUN` 또는 `BLOCKED`로 남긴다.

## 14. 완료 정의

이 마스터 프로그램은 다음 조건을 모두 만족할 때만 완료다.

1. 폴더와 배포 단위가 실제로 독립돼 있다.
2. Cloudflare가 정적·edge·artifact·queue·collaboration의 기본 플랫폼이다.
3. Railway에는 검증상 필요한 최소 서비스만 남는다.
4. 7개 CAD 작업공간이 공통 Studio UX와 실제 명령을 사용한다.
5. 초보자 AI와 전문가 CAD가 같은 문서·revision·Undo를 공유한다.
6. exact B-Rep 계산이 실제 bytes와 승인 kernel로 수행된다.
7. STEP/IFC 상호운용과 독립 STEP C4 재개방·재출력 증거가 있다. vendor-native 호환은 별도 선택 claim이다.
8. tenant·권한·결제·프로젝트 E2E가 실제 환경에서 통과한다.
9. 30일 비용·성능·오류·복구 증거가 있다.
10. 외부 검토와 제작 pilot이 완료됐다.
11. 상용 release gate가 새 증거로 다시 `PASS`됐다.

그 전까지 전체 완료나 상용 출시를 선언하지 않는다.

## 15. 첫 연속 실행 묶음

다음 구현은 여기서 시작한다.

1. M0 inventory와 변경 영향 지도를 생성한다.
2. 현재 route·cron·Railway/Cloudflare service·storage·DB 의존을 machine-readable manifest로 만든다.
3. `packages/*-contracts`의 최소 schema와 version header를 만든다.
4. `domains` manifest와 import boundary 검사를 추가한다.
5. 기존 코드에 compatibility adapter를 두고 실제 동작 변경 없이 첫 폴더 분리를 수행한다.
6. 기존 targeted test, typecheck, build, browser smoke, diff check를 실행한다.
7. 동일 결과가 확인된 후 Wave 2 Edge/R2로 진입한다.

이 첫 묶음에서는 생산 배포, DB destructive migration, Redis 제거, Railway 서비스 삭제를 하지 않는다.

## 16. 관련 정본

- `docs/ACTIVE_EXECUTION_MASTER.md`
- `docs/PERFORMANCE_SECURITY_MULTI_DOMAIN_PRECISION_CAD_EXECUTION_PLAN_260810.md`
- `docs/strategy/product-direction-commercial-master-plan-260811.md`
- `docs/NEXYCAD_PRECISION_CAD_IMPLEMENTATION_STATUS_260813.md`
- `docs/NEXYFAB_CURRENT_STATUS_AND_REASSESSMENT_260812.md`
- `docs/NEXYFAB_PT100_COMMERCIAL_HARDENING_260812.md`
- `C:/Users/gomd9/Downloads/html`
- `C:/Users/gomd9/Downloads/NEXYCAD_UI_Freeze_v4_Bundle`

## 17. Wave 10 정밀 CAD 상용화 폐쇄루프

Wave 0~9의 폴더·배포 구조 위에서 다음을 실제 제품 코드에 연결했다.

1. 비전문가 채팅 요구사항 확정 gate와 Guided AI/Expert CAD 전환
2. 첫 10개 대표 intent의 revision-bound exact CAD 실행
3. 30개 핵심 피처 7축 evidence contract와 30개 피처 실제 OCCT 실행
4. Assembly→Drawing→BOM의 서버 소유 immutable handoff와 bounded expiry prune
5. 제조 artifact가 불완전하면 package 생성을 막는 fail-closed gate
6. 별도 구현 계열 STEP AP242 C4 runner와 self-roundtrip 거부
7. 로컬 qualification·영속 handoff receipt의 독립 check-only 재검산

현재 완료율을 하나의 PASS로 합치지 않는다.

- 플랫폼 구조: `PASS_LOCAL`
- 채팅 intake qualification: `PASS_LOCAL`, AI model/geometry campaign `NOT_RUN`
- 대표 intent→exact CAD: 10/10 로컬 PASS
- 핵심 피처: 30/30, 축 210/210 `PASS_LOCAL`, FAIL/NOT_RUN 0. 외부 CAD·상용 승인은 별도 gate
- Assembly handoff: 로컬 SQLite/auth/tenant 경로 PASS, production DB/cookie/scheduler `NOT_RUN`
- 독립 STEP C4: 별도 순수 TypeScript parser/writer 16/16과 NexyFab kernel open→export→reopen가 제한된 2-box assembly에서 `PASS_LOCAL`; kernel 반환 occurrence 기하·변환은 `PASS_LOCAL`, 이름·품번·label은 `FAIL_LOCAL`; 외부 CAD 재개방·일반 곡면 B-Rep·operator 서명은 `NOT_RUN`
- runtime placement: `HOLD`, live 10항목 전부 `NOT_RUN`
- 제조/외부 검토/30일 관찰: `NOT_RUN` 또는 `BLOCKED`

따라서 Wave 10은 상용화 기반을 실질적으로 확장했지만 상용 release 완료가 아니다. 로컬 exact 피처 30개는 완료했다. 다음 연속 묶음은 150 intent의 실제 AI model campaign, multi-feature assembly exact regeneration, GD&T/PMI·human approval, STEP 의미 식별자 보존, 외부 CAD C4, live staging과 제조 pilot 순으로 진행한다.

## 18. Wave 11 프로덕션 UI·handoff 통합 조정 — 2026-08-14

1. Drawing 첫 화면에서 Three.js/STL/ZIP 그래프를 제거하고 제조 readiness를 dependency-free 모듈로 분리했다.
2. AI/Expert 전환기, Assembly page shell, handoff read/write를 사용 시점 동적 로딩으로 전환했다.
3. 고정 예산을 올리지 않고 shape-generator 7,165 B, Assembly 4,105 B, Drawing 301,366 B로 프로덕션 bundle gate를 PASS했다.
4. Chrome 실제 사용자 흐름에서 Assembly→Drawing의 expert gate 누락을 발견·수정했고, 재실행에서 revision handoff와 fail-closed 제조 상태를 확인했다.
5. Drawing 접근성 snapshot 92의 두 실패군(contrast, target-size)을 조정한 뒤 최종 production snapshot에서 Accessibility/Best Practices/SEO/Agentic Browsing 100, 실패 0을 확인했다.

Wave 11 이후에도 상용 release 판정을 변경하지 않는다. 로컬 exact 30/30과 production browser Apply/Undo는 완료했지만 외부 operator 서명을 포함한 일반 B-Rep STEP C4, STEP 의미 식별자 보존, production auth/PostgreSQL/scheduler, 150개 실제 AI model campaign, GD&T/PMI human approval 및 제조 pilot이 없으므로 전체 상태는 `HOLD`다.

최종 gate 결과도 같은 경계를 확인했다. 플랫폼 architecture는 cron inventory 누락을 수정한 뒤 issue 0 PASS지만 scheduler 관찰은 `NOT_RUN`이다. commercial release gate는 license/kernel/API control을 통과한 뒤 external commercial feature receipt 0/30 및 `nexyfab`·독립 STEP parser C4 receipt 부재로 exit 1이다. runtime placement의 10개 live claim도 모두 `NOT_RUN`이다.
