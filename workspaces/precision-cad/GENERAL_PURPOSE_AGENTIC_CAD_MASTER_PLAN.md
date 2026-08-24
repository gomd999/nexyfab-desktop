# 범용 Agentic CAD·설계 플랫폼 마스터 계획

- 상태: `PROPOSED_EXECUTION_PLAN`
- 작성 기준일: `2026-08-24`
- 주 구현 소유자: `scope/precision-cad`
- 통합 대상: `integration/nexyfab`, 이후 `scope/ai-design`
- 1차 산업 범위: 기계, 건축, 인테리어, 토목, 조경
- 장기 범위: 범용 CAD/CAM/CAE/BIM·설계 프로그램
- 출시 효과: 없음. 이 문서는 구현·검증 순서이며 어떤 `HOLD`도 해제하지 않는다.

연관 문서:

- `AI_DESIGN_BINDING.md`
- `MULTI_DOMAIN_PRODUCT_PLAN.md`
- `INTEGRATION_ACTIONS.md`
- `CURRENT.md`

## 1. 목표

현재의 풍부한 Shape Generator 기능, exact OCCT 경로, revision 저장소,
공간 설계 UI, 분야별 계약·검증·qualification을 하나의 권위 모델과
agent command 체계로 수렴시킨다.

최종 제품은 다음을 만족해야 한다.

1. 사람이 직접 정밀 설계할 수 있다.
2. AI Design 또는 agent가 같은 도구를 제한된 권한으로 사용할 수 있다.
3. 모든 변경은 명령, revision, 입력 권위, 형상, 산출물, 검증 receipt로
   추적된다.
4. AI가 만든 결과도 사람의 결과와 동일한 deterministic kernel 및 검증
   경로를 통과한다.
5. preview mesh, 설명 텍스트, AI 자기평가, 자체 fixture가 exact 또는 상용
   증거로 승격되지 않는다.
6. 기계부터 조경까지 분야별 대표 제품을 실제 납품 가능한 수준으로 먼저
   완성하고, 이후 범용 기능을 확장한다.

### 1.1 비협상 쓰기 경계

이 계획에서 **실제 코드·설정·테스트 수정은 `workspaces/registry.json`의
`precision-cad.ownedPaths`에만 허용**한다. 현재 핵심 허용 범위는
`capabilities/precision-cad/**`, `domains/**`, Shape Generator, CAD API,
`src/lib/cad/**`, `src/lib/occt/**`, 관련 worker/container 및
`workspaces/precision-cad/**`이다. 매 slice 시작 시 registry를 다시 읽고
경로 소유권을 확정한다.

다음은 이 branch에서 수정하지 않는다.

- `packages/**`의 shared contract와 root build/CI/config
- `src/lib/ai/**` 및 AI Design planner/emitter
- platform auth, queue, artifact, tenant, production infrastructure
- shared/global locale router, 공용 message catalog 및 전역 i18n 설정
- 다른 worktree와 integration-owned 파일

타 범위 구현이 필요하면 읽기·호환성 점검만 수행하고, 요청·계약 초안·필수
evidence를 `INTEGRATION_ACTIONS.md` 또는 `AI_DESIGN_BINDING.md`에 기록한다.
Precision 내부의 consumer draft, adapter, fixture는 shared contract의 승인이나
배포를 의미하지 않는다. 타 범위 변경이 합쳐지기 전까지 관련 기능은 feature
flag 또는 `HOLD` 상태를 유지한다.

## 2. 상용 범위 정의

### 2.1 1차 출시에서 의미하는 범용 CAD

1차 목표는 기존 대형 CAD 제품의 모든 기능을 복제하는 것이 아니다.
다음 공통 기능을 제공하면서 분야별 대표 프로젝트를 끝까지 수행하는
확장 가능한 범용 기반을 의미한다.

- 2D 스케치와 구속
- exact solid/surface B-rep
- feature history와 안정적인 topology reference
- multi-body, assembly, configuration
- 직접 편집과 parametric 편집
- 도면, PMI/GD&T, BOM/BOQ, schedule
- STEP, IFC, DXF 및 분야별 교환
- revision, branch, 비교, 협업, 승인, 감사
- 계산·분석·제조·시공 산출물
- agent 계획, 미리보기, 실행, 검증, rollback

### 2.2 분야별 1차 상용 vertical

| 분야 | 첫 완결 제품 | 필수 결과 |
| --- | --- | --- |
| 기계 | 조정식 모터·감속기 구동 모듈 | exact 부품·조립체·도면·PMI·BOM·STEP·DFM·제작 |
| 건축 | 한 관할지역의 2층 소형 상업건물 코어 | BIM 의미 객체·도면·수량·IFC·조정·전문 검토 |
| 인테리어 | 실측 호스트 기반 소형 사무실/매장 fit-out | 공간·FFE·RCP·마감·밀워크·BOQ·IFC·시공 |
| 토목 | 실제 측량 기반 소형 진입도로·우수배수 | CRS/TIN·선형·종횡단·코리더·토공·수리·LandXML/IFC |
| 조경 | 승인 지형 기반 소형 광장/중정 | grading·식재·토양·관수·수량·유지관리·현장 검증 |

### 2.3 성숙도

```text
PREVIEW
  -> DESIGN_CANDIDATE
  -> EDITABLE_MODEL
  -> DOMAIN_VERIFIED
  -> DELIVERY_CANDIDATE
  -> PRODUCT_QUALIFIED
  -> COMMERCIAL_RELEASED
```

- `EDITABLE_MODEL`은 저장·재개·편집·재생성 가능성을 의미한다.
- `DOMAIN_VERIFIED`는 현재 revision의 내부 deterministic 검증 통과다.
- `DELIVERY_CANDIDATE`는 정상 산출물과 독립 왕복검증 통과다.
- `PRODUCT_QUALIFIED`는 외부 권위·전문가·실제 pilot 증거까지 필요하다.
- `COMMERCIAL_RELEASED`는 보안·운영·지원·계약 범위까지 승인된 상태다.
- 평균 점수로 필수 gate 실패를 덮지 않는다.

### 2.4 개념-only·clean-room 권리 기준

`document(manuals)`와 공학·수학 백과 문서는 기능 목록, 공개된 공학 원리,
상호운용 요구, 검증 항목을 찾는 **참고 색인**으로만 사용한다. 원문의 문장,
도표, 그림, UI 배치, 예제 데이터, 코드, 독창적 분류·설명 구조를 복제하지 않는다.

- 먼저 `source/version/date/권리상태/추출한 일반 개념/금지된 표현` reference ledger 작성
- 요구사항은 NexyFab 용어와 독립된 구조로 다시 정의하고 구현자는 원문 표현을
  소스 코드에 전사하지 않음
- 수식·표준·카탈로그도 사실/인터페이스와 표현물을 구분하고 사용 조건을 검토
- test fixture, sample drawing, model, 번역문, font는 자체 제작 또는 명시적 사용권 확보
- 경쟁 제품의 비공개 파일 형식, 보호 우회, 역공학 산출물, 상표성 UI 복제 금지
- 독립 설계 기록, 코드 provenance, reviewer, 라이선스 scan을 release evidence로 보존

권리 상태가 불명확하면 아이디어를 구현 backlog로 승격하지 않고 `HOLD`한다.
실제 법률·표준 라이선스 판단이 필요한 출시는 권리 담당자의 별도 승인을 받는다.

## 3. 현재 자산과 핵심 간극

### 3.1 재사용할 자산

- Shape Generator의 스케치, feature, assembly, drawing, FEA, CAM, 직접 편집,
  collaboration 및 import/export 기능
- `src/lib/cad/**` feature tree, topology naming, revision, spatial command,
  artifact binding 및 qualification
- `src/lib/occt/**` exact feature plan과 executor
- `src/lib/assembly/**` mate, clearance, tolerance 및 verification
- `workspaceRevisionStore`와 `spatialCadDraftStore`의 서버 권위 revision
- 건축·인테리어 exact 승격과 artifact transaction
- 다섯 분야의 strict product contract, native artifact, verifier,
  qualification 및 connected-project invalidation
- isolated `occt-exact`, job orchestration 및 artifact storage 경계

### 3.2 해결할 구조적 간극

- 13,000줄 이상의 `ShapeGeneratorInner.tsx`에 너무 많은 orchestration이
  집중돼 있다.
- UI feature 모델, `src/lib/cad` feature tree, 공간 parameter document,
  분야별 product contract가 서로 다른 truth model을 사용한다.
- localStorage history/autosave와 서버 revision이 하나의 권위 lineage로
  완전히 통합되지 않았다.
- exact 경로에서 일부 operation이 mesh fallback 또는 reduced fidelity로
  내려간다.
- 새 `domainProductService`와 qualification API가 분야별 저작 UI의 정상
  완료 흐름에 연결되지 않았다.
- 건축·인테리어는 일부 exact/artifact 경로가 있으나 기본 UI가 여전히
  concept 중심이다.
- 토목·조경 UI는 concept preview이고 실제 survey/TIN/catalog/hydraulic
  입력·편집이 없다.
- STEP 일부 case는 강하지만 DXF 및 외부 의미 보존 corpus 범위가 부족하다.
- AI Design 결속은 문서화됐으나 shared version contract와 production job
  wiring은 아직 없다.
- security, CI, rate limit, secret rotation 관련 integration P0가 남아 있다.

## 4. 목표 아키텍처

```text
Human UI / AI Design
        |
        v
Untrusted Intent Candidate
        |
        v
Agent Planner + Policy Gate
        |
        v
Versioned Tool Registry
        |
        v
CadExecutionPlan (dry-run only)
        |
        +--> Preview Sandbox --> findings / cost / changed-object set
        |
        v
Human Approval or pre-authorized low-risk policy
        |
        v
Authoritative CadCommand Bus
        |
        +--> Mechanical Document --> OCAF/XCAF + OCCT
        +--> Building/Interior Semantic Document --> BIM/IFC adapter
        +--> Civil/Landscape Semantic Document --> survey/terrain engines
        |
        v
Immutable Workspace Revision + Artifact Graph
        |
        v
Regeneration + Domain Verification + Independent Exchange
        |
        v
Execution / Verification / Qualification Receipts
```

### 4.1 이중 문서 계층

한 포맷에 모든 분야를 억지로 넣지 않는다.

1. NexyFab canonical document
   - 프로젝트, requirement, 의미 객체, 관계, 권위 입력, revision, artifact
     dependency를 관리한다.
   - 서버 저장·협업·agent command의 권위다.
2. Kernel/native document
   - 기계 형상·조립·속성은 OCCT worker 내부 OCAF/XCAF 문서로 관리한다.
   - B-rep, stable label, assembly, color/layer/name, STEP/XDE metadata를 맡는다.
   - spatial domain은 IFC/terrain/native adapter를 별도 유지한다.

두 문서는 `projectId`, `revision`, `objectId`, semantic hash, geometry hash,
kernel identity로 결속한다. 어느 한쪽만 저장되면 authoritative commit이
아니다.

### 4.2 권위 source of truth

- 브라우저 THREE mesh는 표시 cache다.
- AI intent는 candidate다.
- localStorage/IndexedDB는 복구 cache다.
- 서버의 immutable canonical revision과 worker의 exact/native receipt가
  함께 존재할 때만 authoritative model이다.
- 도면·수량·교환 파일은 canonical revision에서 파생되고 별도의 사용자
  truth가 될 수 없다.

## 5. Agentic CAD 배선

### 5.1 AI Design과 Precision CAD의 책임 분리

| 구성요소 | 책임 |
| --- | --- |
| AI Design | 요구 해석, 후보 설계, 대안 생성, 실행 계획 제안 |
| Precision CAD | schema 검증, feasibility, deterministic command 실행, exact/native 산출물, 검증 |
| Integration | versioned shared contract, artifact transport, auth, job binding |
| Platform | 사용자·조직·프로젝트 권한, DB, queue, storage, audit, observability |
| Governed release | 외부 증거·전문가 승인·release decision |

AI는 DB, OCCT handle, release flag를 직접 변경하지 않는다. Precision이
노출하는 allow-listed tool만 사용한다.

### 5.2 공통 agent artifact

공유 package로 승격되기 전에는 모두
`nexyfab.precision-cad.*-consumer-draft.v1` 이름을 사용한다.

```text
CadIntentEnvelope
CadToolDescriptor
CadExecutionPlan
CadCommand
CadExecutionReceipt
CadVerificationReceipt
CadApprovalReceipt
CadRollbackReceipt
```

모든 artifact는 다음을 포함한다.

- schema와 contract version
- project, document, base revision, content hash
- actor와 agent/model/prompt identity
- units, coordinate frame, tolerance policy
- command dependency와 예상 changed-object set
- input/output artifact hash
- permission, risk class, approval scope
- timeout, memory, iteration 및 retry budget
- deterministic/idempotency key
- side-effect declaration
- verifier와 blocker
- issued/expiry time 및 stale condition

### 5.3 Tool descriptor

모든 agent tool은 다음 계약을 갖는다.

```text
toolId
version
domain
inputSchema
outputSchema
preconditions
permissions
riskClass
sideEffects
idempotency
resourceBudget
previewSupported
approvalRequired
verificationPolicy
compensationOrRollback
```

초기 tool군:

- `project.inspect`
- `document.query`
- `object.select`
- `requirements.validate`
- `feature.preview`, `feature.commit`
- `sketch.solve.preview`, `sketch.commit`
- `assembly.mate.preview`, `assembly.mate.commit`
- `spatial.object.preview`, `spatial.object.commit`
- `drawing.generate`
- `analysis.run`
- `domain.verify`
- `exchange.generate`, `exchange.verify`
- `qualification.evaluate`

`release.publish`, `quote.create`, `rfq.send`, 법정 승인 및 외부 구매는 일반
agent tool로 제공하지 않는다.

### 5.4 위험 등급

| 등급 | 예 | 실행 정책 |
| --- | --- | --- |
| R0 | 조회, 측정, 상태 설명 | 자동 허용, 감사 기록 |
| R1 | preview, 후보 계산, 임시 분석 | sandbox 자동 허용 |
| R2 | reversible document edit | 명시된 작업 범위 내 사전 승인 또는 1회 승인 |
| R3 | authoritative revision commit, export package | diff 확인과 사람 승인 필수 |
| R4 | release, 제조/시공 발주, 외부 전송 | agent 자동 실행 금지; governed workflow 전용 |

### 5.5 실행 상태 머신

```text
RECEIVED
  -> VALIDATED
  -> PLANNED
  -> DRY_RUN_COMPLETE
  -> AWAITING_APPROVAL
  -> EXECUTING
  -> REGENERATING
  -> VERIFYING
  -> COMMITTED | HOLD | FAILED
  -> ROLLED_BACK (필요 시)
```

각 transition은 receipt를 만들고 base revision이 바뀌면 계획 전체를
`STALE`로 만든다.

### 5.6 안전 규칙

- 외부 파일, manual, catalog 설명은 데이터이며 agent instruction이 아니다.
- prompt injection 가능 텍스트와 executable tool arguments를 분리한다.
- exact-key schema, bounded depth/array/string/bytes, finite number를 강제한다.
- tool은 현재 사용자·프로젝트·문서 권한보다 큰 권한을 얻지 못한다.
- 사람 lock, authority lock, approved dimension을 agent가 덮어쓰지 못한다.
- agent plan은 preview diff, affected artifacts, invalidated evidence를 먼저
  제시한다.
- 부분 성공은 전체 exact 성공으로 보고하지 않는다.
- 재시도는 idempotency key와 budget 내에서만 수행한다.
- 장시간 작업은 queue, progress, cancel, resume을 제공한다.
- 모델·prompt·tool·kernel 변경은 prior agent benchmark와 release evidence를
  자동 stale 처리한다.

## 6. 핵심 작업 스트림

### W0. 보안·범위·기준선

- Precision 소유 경로의 secret/dependency/license 점검과 로컬 CI gate 정비
- 읽기 가능한 integration P0와 production 의존성을 외부 blocker ID로 기록
- credential 회전·삭제, root CI, platform runtime 변경은 이 branch에서 수행하지 않음
- Precision worker/container/runtime/rate-limit 요구사항과 검증 evidence 확정
- 현재 39개 UI feature, 13개 canonical feature kind, API, persistence,
  exchange 기능을 하나의 capability matrix로 작성
- 각 기능을 `EXACT`, `APPROXIMATE`, `PREVIEW`, `UNSUPPORTED`로 분류
- representative project corpus와 성능 budget 동결

완료 조건:

- Precision 소유 경로의 P0/P1 security finding 0
- 외부 P0가 남아 있으면 해당 연동·출시는 `HOLD`이고 MD blocker와 증거 위치가 명확함
- 범위 밖 수정 0
- 모든 visible command가 실제 implementation 또는 명시된 disabled 상태에
  매핑됨
- authoritative 경로의 silent fallback 0

### W1. Canonical document·command·revision

- parameter-only `spatialCadCommand.v1`을 typed object operation이 가능한 v2로
  확장
- create/update/delete/move/relate/host/constraint/feature/assembly/drawing
  operation 정의
- mechanical feature history와 spatial semantic document를 동일 workspace 및
  artifact graph에 결속
- client cache를 IndexedDB journal로 이동하고 서버 revision을 권위로 유지
- reconnect 시 deterministic command replay와 conflict resolution 제공
- local Undo/Redo를 authoritative command 및 compensation 기록과 연결
- 모든 upstream 변경에서 계산·도면·수량·exchange·qualification stale 처리

완료 조건:

- save/reopen/replay 후 stable ID·관계·hash 변화 0
- 동시 edit의 lost update 0
- stale base revision commit 0
- command sequence 재생 결과가 canonical hash까지 동일
- crash recovery가 미완료 commit을 authoritative로 노출하지 않음

### W2. OCCT/OCAF/XCAF exact kernel

- exact worker 안에 OCAF/XCAF application/document adapter 도입
- canonical object ID와 OCAF label의 영속 mapping
- feature dependency, shape, name, color, layer, material, mass property,
  assembly metadata 저장
- exact undo transaction과 서버 command revision 결속
- UI feature registry와 canonical feature tree를 한 registry에서 생성
- extrude, revolve, sweep, loft, boolean, hole, fillet, chamfer, shell, draft,
  rib, pattern, mirror, split, direct edit의 first-release subset을 exact로 폐쇄
- unsupported operation은 preview로 격리하고 export/release를 차단
- stable topology reference의 edit survival corpus 확대
- shape healing을 import/export validation과 분리 기록

완료 조건:

- first-release 기능의 mesh fallback 0
- B-rep validity, body/solid membership, topology reference gate 100%
- 동일 input+kernel build의 deterministic receipt hash
- STEP 재입력 후 shape/assembly/metadata 허용오차 충족

### W3. 스케치·직접 편집·곡면

- line/arc/circle/ellipse/spline 및 construction/reference geometry
- coincident, horizontal/vertical, parallel, perpendicular, tangent,
  concentric, equal, symmetry, dimensional constraint
- over/under-constrained 진단 및 사용자 해소 흐름
- sketch-on-face와 arbitrary plane reference 안정성
- push/pull, move/offset/delete/replace face의 exact semantics
- NURBS curve/surface, trim, sew, continuity, boundary/sweep/loft surface
- feature 실패 시 최소 재생성 범위와 참조 relink UI

완료 조건:

- benchmark sketch에서 자유도·해·단위·치수 일치
- topology-changing edit에서 유효 참조 보존 또는 명시적 relink
- solver non-convergence를 success로 표시하지 않음

### W4. 기계 assembly·PDM·drawing·manufacturing

- part/assembly/subassembly occurrence와 transform
- mate/joint, DoF, motion range, continuous collision
- configuration, suppression, family/table, variant BOM
- tolerance stack, fit, datum, GD&T/PMI, inspection plan
- drawing view, HLR, section/detail, dimension, title block, revision table
- sheet metal, weldment, standard parts, material/process binding
- STEP AP242/XDE assembly와 metadata round-trip
- DFM/CAM/FEA는 입력·solver identity·mesh·result hash를 receipt로 결속

완료 조건:

- 30-feature closed-loop gate
- 10개 direct design package private beta, 30개 broad package
- independent STEP conformance
- 20 blind challenges
- 3 manufactured/assembled pilots

### W5. 건축·인테리어 BIM 편집기

- site, building, storey, level, grid, space
- wall, slab, roof, envelope layer, opening, stair, service opening
- hosted object와 relationship 편집
- surveyed architecture host에 interior document 결속
- FFE, circulation/activity clearance, ceiling, light, MEP reference, finish,
  millwork
- plan/elevation/section/RCP/detail/schedule/quantity generation
- IFC 4.3 기반 schema와 출시 MVD/IDS 범위를 명시
- semantic ID, unit, placement, relationship, property/quantity round-trip
- 관할지역별 code rule pack은 edition/effective date와 권리 receipt로 관리

완료 조건:

- concept parameter UI를 semantic object editor로 교체
- 실제 field/survey authority 없이는 release 차단
- drawing/schedule/model agreement
- independent IFC round-trip
- 분야별 전문가 2명 및 3개 pilot

### W6. 토목 설계

- survey control, CRS, epoch, horizontal/vertical datum
- point, breakline, TIN import/edit/quality
- horizontal alignment, profile, vertical curve
- assembly/cross-section, corridor, target, daylight
- grading, parcel/boundary, utility/structure coordination
- reproducible earthwork surface 및 grid/TIN volume
- catchment, inlet, pipe, outfall과 governed hydraulic engine
- alignment/profile/cross-section/grading/drainage sheet
- LandXML 및 IFC infrastructure exchange
- construction stage와 revision change impact

완료 조건:

- concept road UI 제거
- 승인 survey/TIN/datum 결속
- 토공량 independent comparison
- hydraulic checks와 `NOT_RUN` 분리
- LandXML/IFC round-trip
- 토목/수리 전문가와 3개 site pilot

### W7. 조경 설계

- approved civil terrain과 immutable binding
- terrain modifier, spot grade, drainage path, hardscape
- planting zone, soil volume, plant occurrence, mature root/canopy
- rights-cleared species/supplier catalog
- irrigation source, valve, zone, pipe, emitter network
- pressure/flow loss, water budget, climate authority
- grading/planting/hardscape/irrigation plan
- schedule, BOQ, maintenance zone/task
- civil drainage 및 building/interior coordination

완료 조건:

- concept local-coordinate UI 제거
- approved terrain과 catalog 없이는 release 차단
- irrigation network/hydraulic independent check
- quantity/drawing/site-model round-trip
- 조경/관수 전문가와 3개 site pilot

### W8. Agent runtime·AI Design integration

- Precision-owned local consumer draft와 tool registry
- intent -> typed design operation -> execution plan compiler
- read-only inspector와 sandbox preview runner
- policy/risk/approval engine
- command executor, checkpoint, retry, compensation
- verification-aware planner feedback
- task memory는 immutable project artifact를 참조하고 hidden truth를 만들지 않음
- integration-owned shared contract와 artifact job graduation 요구는 MD로만 인계하고,
  Precision에서는 consumer adapter와 compatibility fixture만 구현
- AI Design worktree는 공유 envelope만 emit하고 Precision 내부 구현을 import하지
  않음
- UI에서 plan/diff/blocker/receipt/rollback을 사람이 이해할 수 있게 표시

완료 조건:

- AI가 raw code 또는 release state를 직접 주입할 수 없음
- stale revision과 authority lock 우회 0
- 도구 호출마다 identity·argument·result·artifact hash 감사 가능
- 실패 후 partial authoritative commit 0
- 분야별 agent benchmark와 human baseline 비교

### W9. 상호운용

- STEP/XDE: geometry, assembly, name, layer, color, material, validation/PMI 범위
- IFC: schema version, declared MVD/IDS, geometry, semantic relationship,
  placement, property, quantity
- DXF: supported entity/type coverage를 별도 집계하고 의미 미지원은 명시
- STL/3MF/glTF/USD: preview/manufacturing/presentation 목적을 분리
- LandXML: survey/alignment/profile/surface/corridor 지원 matrix
- 모든 importer는 untrusted input sandbox, byte/depth/entity/expansion limit 적용
- 모든 exporter는 독립 target application 또는 parser로 reopen

완료 조건:

- import success와 semantic coverage를 별도 보고
- self-parser 왕복만으로 independent pass를 만들지 않음
- unit, coordinate, ID, hierarchy, relation, quantity 허용오차를 format별 정의

### W10. UI·성능·협업

- `ShapeGeneratorInner`를 route shell, document controller, command adapter,
  viewport, panels, job monitor로 분해
- mechanical/spatial UI가 동일 selection, command, revision, artifact protocol 사용
- virtualized tree/table, incremental regeneration, LOD, worker transfer 최적화
- long job progress/cancel/resume
- offline cache와 reconnect conflict UX
- presence, comment, review, approval, role, lock UX
- mobile은 검토/승인 범위와 authoring 범위를 명확히 분리
- 접근성, i18n, keyboard workflow, crash recovery

완료 조건:

- Phase 0에서 동결한 small/medium/large corpus 성능 budget 통과
- 큰 모델에서 main-thread 장기 block과 메모리 누수 기준 통과
- read-only 사용자의 mutation 0
- reconnect 후 revision/content hash 일치

### W11. Precision 운영 경계·보안 증거

- Precision API/tool/worker가 기존 organization/project identity와 RBAC를
  least-privilege consumer로 검증
- tenant/project/revision identity 누락 또는 mismatch를 fail-closed 처리
- Precision 소유 worker/container의 queue isolation, worker identity, signed
  artifact, replay prevention, non-root/minimal runtime
- Precision 소유 경로 secret/dependency/SBOM/license scan과 provenance
- Precision job의 audit event, metrics, tracing, health, cancel/recovery hook
- license/standard/catalog/customer data rights receipt와 compatibility/deprecation
  metadata
- tenant isolation, encryption, retention, Redis rate limit, backup/DR, SLA 등
  platform 구현 요구는 `INTEGRATION_ACTIONS.md`에 기록하고 기존 shared API만 소비

완료 조건:

- Precision 소유 경로 P0/P1 security issue 0
- identity/tenant mismatch mutation 0과 worker isolation evidence
- release artifact 재현과 provenance 확인
- 외부 platform evidence가 없으면 production 연동 `HOLD`
- Precision production readiness review 승인

### W12. i18n·locale-neutral 설계

초기 지원 locale은 `ko`, `en`, `ja`, `zh`, `es`, `ar`로 정의하되, locale별
release evidence가 없는 기능은 지원된다고 표시하지 않는다.

- canonical document, command, tool argument, plan, receipt, error는 번역 문자열이
  아닌 stable machine code와 구조화된 값을 저장
- Precision 로컬 message ID/catalog/adapter는
  `src/lib/cad/i18n/**`와 `src/app/[lang]/shape-generator/i18n/**`에 배치
- shared/global i18n 모듈은 수정하지 않고 현재 공개 API를 소비하는 호환 adapter만
  Precision 소유 경로에 구현
- fallback은 영어로 고정하고 missing/unused/key-parity report를 build evidence로 생성
- ICU 스타일 placeholder 또는 구조화 값으로 문장을 구성하고 동적 문자열 이어붙이기 금지
- canonical 수치·단위·좌표·각도는 locale-neutral로 저장하고 표시에만 locale별
  decimal/grouping/unit 규칙 적용
- 날짜·시간은 ISO 기반 값, timezone, calendar/format policy를 분리
- Arabic은 RTL, logical CSS property, mirrored/non-mirrored CAD control을 검증
- 도면/PDF/export는 project language, Unicode shaping, font embedding/license,
  text overflow 및 필요 시 bilingual 표기 정책을 명시
- AI 설명은 locale별로 제공할 수 있으나 tool 실행과 판정의 권위는 machine code와
  receipt에만 부여
- 번역문, terminology, font, reference corpus의 출처·권리·reviewer를 기록

완료 조건:

- 6개 locale key parity, fallback, missing key, placeholder type test 통과
- number/unit/date/timezone/RTL/error-code mapping test 통과
- 대표 도면·PDF·BOM/BOQ·schedule의 다국어 snapshot과 사람이 수행한 layout 검토
- locale별 terminology reviewer와 release 상태가 독립적으로 기록됨
- 미검증 locale은 영어 fallback과 미검증 표시를 사용하며 거짓 지원 claim 0

### W13. Qualification·pilot

각 분야:

1. 권리 확보된 독립 case 20개 이상
2. first-release capability 전부 포함
3. 각 governed axis 정확도·coverage 95% 이상
4. safety/authority/release/critical round-trip 100%
5. 5회 반복 campaign 3회 연속 통과
6. 독립 전문가 2명 검토
7. 대표 change request 후 전체 산출물 재생성
8. controlled beta pilot 1개
9. broad commercial claim 전 독립 pilot 3개
10. critical/major issue 폐쇄 후 동일 revision 재검증

Agent benchmark는 별도로 다음을 검증한다.

- 요구 이해 정확도
- 올바른 tool 선택
- 변경 범위 준수
- ambiguity 발견률
- authority/lock 위반 0
- false completion 0
- deterministic replay
- rollback 성공
- 사람 대비 시간 절감과 오류율

## 7. 단계별 실행 로드맵

### Phase 0: 기준선·보안·통합 설계 (0~2개월)

- W0 완료
- integration P0는 외부 blocker로 문서화하고 해결 evidence 없이는 연동·출시 `HOLD`
- capability/exactness/interoperability/i18n matrix 작성
- canonical document와 agent artifact ADR 확정
- 성능 corpus와 release gate 동결
- 기존 dirty work와 scope ownership 보존

Exit:

- Precision 소유 경로의 보안 P0 0
- 타 범위 P0 및 shared 변경 요청에 owner·blocker ID·필요 evidence가 지정됨
- 기능별 truth 상태가 완전하게 분류됨
- Precision consumer draft와 version migration 제안이 MD에 동결됨

### Phase 1: 공통 CAD document와 agent command 기반 (2~5개월)

- W1 canonical command/revision
- W2 OCAF/XCAF 최소 adapter
- W8 tool descriptor, planner dry-run, approval skeleton
- W12 stable message/error code, locale-neutral value, local catalog 기반
- UI에서 command diff와 artifact invalidation 표시
- product qualification API를 UI 검증 흐름에 연결

Exit:

- 사람과 agent가 동일 command bus 사용
- preview와 authoritative commit 분리
- save/reopen/replay/rollback 통과
- 6개 locale의 기본 shell, 오류, receipt fallback·RTL·format test 통과

### Phase 2: 범용 기계 CAD v1 + Agentic Alpha (4~10개월)

- W2, W3, W4 first-release 범위
- 30-feature exact 폐쇄 루프
- assembly/configuration/drawing/STEP XDE
- AI intent -> feature plan -> exact build -> verification end-to-end
- 기계 용어, 단위, 도면, BOM의 locale별 표현과 canonical 값 분리
- private beta package 10개 및 첫 제작 pilot

Exit:

- 기계 `DELIVERY_CANDIDATE`
- agent가 제한된 기계 작업을 preview/approval/commit/verify/rollback 가능
- broad release는 외부 evidence 완료 전 `HOLD`

### Phase 3: 건축·인테리어 범용 공간 편집 (6~14개월)

- W5 완료
- 기존 concept UI를 semantic BIM/interior editor로 승격
- exact component geometry와 BIM 관계 결속
- drawing/schedule/quantity/IFC
- 한 관할지역 rule pack과 actual survey/field authority
- building -> interior dependency invalidation
- 건축·인테리어 용어, schedule, quantity, 도면/PDF의 locale qualification

Exit:

- 건축·인테리어 각각 `DELIVERY_CANDIDATE`
- 독립 IFC 왕복과 첫 pilot

### Phase 4: 토목·조경 범용 site 편집 (10~20개월)

- W6, W7 완료
- 실제 survey/TIN/CRS/datum 편집
- corridor, grading, earthwork, drainage hydraulics
- landscape terrain/planting/soil/irrigation/maintenance
- civil -> landscape dependency invalidation
- LandXML/IFC/site-model exchange
- CRS·측량·토공·식재·유지관리 용어와 수치 표기의 locale qualification

Exit:

- 토목·조경 각각 `DELIVERY_CANDIDATE`
- 독립 exchange와 첫 site pilot

### Phase 5: 통합 Agentic Design Platform (14~24개월)

- W8 production graduation
- 문서로 요청한 AI Design/shared contract cutover evidence를 Precision consumer에서 검증
- multi-domain plan과 dependency-aware execution
- mechanical equipment -> building/interior coordination
- survey -> civil/building/landscape connected pilot
- multi-agent orchestration은 동일 tool policy와 project budget 아래에서만 허용

Exit:

- 5개 분야 connected-project pilot
- agent false completion, unauthorized mutation, destructive merge 0
- cross-domain stale propagation 100%

### Phase 6: 상용 qualification·운영 출시 (18~30개월)

- W9, W10, W11, W12, W13 release 기준 완료
- 분야별 20 case, campaign, reviewer, 3 pilot
- 보안·성능·복구·지원·라이선스 승인
- locale별 terminology·RTL·format·font rights·다국어 export 승인
- 분야별 독립 release decision

Exit:

- 증거가 충족된 분야만 `COMMERCIAL_RELEASED`
- 미충족 분야는 제품 전체 평균과 무관하게 `HOLD`

### Phase 7: 범용 확장 (24개월 이후)

- plant/piping, HVAC/MEP, electrical/ECAD, structural, mold/tooling,
  advanced CAM/CAE를 동일 document/tool/receipt 체계로 확장
- proprietary format connector는 라이선스·독립 conformance가 확보된 경우만
  추가
- 지역·산업 rule pack을 독립 qualification 단위로 확대

## 8. 병렬 실행 구조

권장 전담 squad:

| Squad | 인원 범위 | 주요 경로 |
| --- | ---: | --- |
| Kernel/Sketch/Topology | 3~4 | `src/lib/occt`, `src/lib/sketch`, exact worker |
| Document/PDM/Collab | 2~3 | `src/lib/cad`, project APIs, revision/artifact |
| Mechanical/Manufacturing | 3 | mechanical domain, assembly, drawing, CAM/DFM |
| BIM/Interior | 3 | architecture/interior domain, IFC, spatial UI |
| Civil/Landscape | 3 | civil/landscape domain, survey/terrain/hydraulic |
| Agent/AI Integration | 2~3 | Precision tool registry, AI Design adapter, jobs |
| Product i18n/UX | 1~2 | local catalog, terminology, RTL, drawing/export locale |
| QA/Security/Performance | 2~3 | corpus, E2E, scanners, load/soak, release evidence |

전체 권장 규모는 19~24명이며 18~30개월을 1차 범용 release 범위로 잡는다.
소수 인원으로도 진행할 수 있지만 외부 검토·pilot을 포함하면 calendar time이
크게 증가한다. 기존 대형 범용 CAD의 전체 기능 parity는 별도 3~5년 이상
프로그램으로 취급한다.

병렬화 규칙:

- contract와 canonical ID가 동결된 뒤 disjoint path만 병렬화한다.
- kernel/serialization/security/release gate는 한 owner가 최종 통합한다.
- 분야 구현은 공통 document/command API를 소비하고 자체 변형을 만들지 않는다.
- AI Design과 Precision은 shared fixture와 contract hash로만 병렬 개발한다.
- integration-owned 파일은 integration branch에서만 변경한다.
- shared/global i18n 요청은 MD로 인계하고 Precision은 local adapter/catalog만 변경한다.

## 9. Agentic 개발 진행 규칙

모든 slice는 아래 순서를 반복한다.

```text
점검
  -> 계약·완료조건 동결
  -> 구현
  -> 단위/속성/회귀/E2E 검증
  -> 실패 조정
  -> 독립 review
  -> handoff와 다음 slice
```

작업 배분:

- Luna: 독립 fixture, 타입 보강, 반복 UI, 문서, 단순 adapter, 기계적 test 추가
- 강한 reasoning 모델: kernel algorithm, tolerance/topology, serialization,
  security, agent policy, cross-domain contract, release gate
- 병렬 작업은 파일 소유권이 겹치지 않고 acceptance contract가 먼저 동결된
  경우만 수행
- main integrator는 모든 agent 결과를 직접 검토하고 전체 regression을 실행

각 slice handoff 필수 항목:

- 변경 파일과 scope owner
- 구현한 capability와 의도적으로 미지원인 capability
- authoritative/preview/fallback 상태
- 테스트와 실제 kernel/external evidence의 구분
- 성능 및 security 영향
- stale/invalidation 영향
- 다음 blocker
- release 상태

## 10. 저장소 구현 지도

### Precision-owned 예정 경로

```text
capabilities/precision-cad/agent-tool-runtime/**
src/lib/cad/document/**
src/lib/cad/commands/**
src/lib/cad/agent-tools/**
src/lib/cad/qualification/**
src/lib/cad/i18n/**
src/lib/occt/document/**
src/lib/occt/xde/**
src/app/api/cad/v2/**
src/app/[lang]/shape-generator/_shell/**
src/app/[lang]/shape-generator/i18n/**
domains/mechanical/product/**
domains/architecture/product/**
domains/interior/product/**
domains/civil/product/**
domains/landscape/product/**
containers/occt-exact/**
workspaces/precision-cad/**
```

이 경로명은 설계 방향이며 실제 구현 전 기존 모듈과 중복 여부를 점검한다.
호환 adapter 없이 새 truth model을 병렬로 만들지 않는다.

### Integration-owned 문서-only 요청

아래 항목은 이 계획의 구현 대상이 아니다. `INTEGRATION_ACTIONS.md`에 요청과
acceptance evidence만 남기고 integration owner가 별도 branch에서 결정한다.

- `packages/**`의 versioned intent/tool/command/artifact contract
- shared API/job schema와 service registry
- AI Design emitter와 Precision consumer parity
- auth/artifact/queue/retention 및 production configuration
- CI, secret scan, dependency/SBOM/license gate

### AI Design-owned 문서-only 요청

아래 항목도 이 branch에서 구현하지 않는다. Precision은 versioned consumer
adapter와 contract fixture까지만 소유한다.

- 요구 해석과 ambiguity output
- shared `CadIntentEnvelope` 생성
- tool-aware planning과 결과 설명
- model/prompt/output provenance
- rights-cleared retrieval/reference policy

AI Design은 exact builder, release verifier, Precision DB를 소유하지 않는다.

## 11. Migration 및 폐기 계획

1. 현재 모델을 즉시 제거하지 않는다.
2. canonical adapter와 parity test를 먼저 추가한다.
3. 기존 UI 동작과 새 command document를 dual-observe한다.
4. geometry, semantic, revision, artifact hash parity를 확인한다.
5. 한 vertical씩 authoritative write를 새 경로로 전환한다.
6. legacy 경로는 read-only compatibility를 거쳐 제거한다.
7. localStorage는 복구 cache로만 남기고 서버 truth claim을 제거한다.
8. parameter-only spatial v1은 v2 object migration 이후 read compatibility만
   유지한다.
9. self-authored exchange validator는 independent evidence로 사용하지 않는다.
10. raw AI code와 SCAD preview는 authoritative path에서 영구 제외한다.

## 12. 최종 release gate

다음이 모두 현재 release commit과 같은 hash lineage에서 통과해야 한다.

- typecheck, architecture, scope, lint, unit, integration, E2E
- exact kernel identity와 no-stub evidence
- canonical save/reopen/replay/rollback
- first-release feature exactness와 topology survival
- drawing/model/schedule/quantity agreement
- independent STEP/IFC/DXF/LandXML target round-trip
- domain accuracy·coverage·false-verification gate
- agent task, permission, approval, audit, stale, rollback gate
- performance, memory, long-job, crash recovery, multi-user load
- secret, dependency, SBOM, license, tenant isolation, backup restore
- locale별 key parity, fallback, RTL, number/unit/date, font rights, 다국어 export
- 분야별 authority, reviewers, campaign, real pilots
- marketing claim과 qualified scope 일치

어느 필수 gate도 문서 체크박스, 합성 fixture, AI 판단, 평균 점수로 대체하지
않는다.

## 13. 첫 13개 구현 epic

1. `GP-00` Precision scope guard, 소유 경로 security baseline, 외부 blocker ledger
2. `GP-01` capability/exactness/exchange/i18n matrix 및 corpus
3. `GP-02` canonical object/document/command v2 ADR와 consumer draft
4. `GP-03` server revision + IndexedDB recovery journal
5. `GP-04` OCAF/XCAF document adapter와 ID/hash binding
6. `GP-05` unified feature registry와 no-silent-fallback policy
7. `GP-06` stable message/error code, local catalog, locale-neutral format 기반
8. `GP-07` agent tool descriptor, risk, dry-run, approval, receipt
9. `GP-08` Shape Generator command-controller 분해
10. `GP-09` product qualification UI binding
11. `GP-10` mechanical 30-feature exact closed loop
12. `GP-11` mechanical agentic end-to-end pilot
13. `GP-12` building/interior semantic editor foundation

`GP-00`~`GP-03`이 승인되기 전에는 새로운 분야 기능을 대량 추가하지 않는다.
기능 수보다 truth model과 실행·검증 결속을 먼저 고정해야 이후 다섯 분야를
병렬 확장해도 다시 합칠 수 있다.

## 14. 공식 기술 기준 참고

이 계획은 표현을 복제하지 않고 일반 기술 개념과 공개된 공식 기능 범위만
참고한다.

- Open CASCADE Application Framework:
  `https://dev.opencascade.org/about/application_framework`
- OCCT OCAF user guide:
  `https://dev.opencascade.org/doc/overview/html/occt_user_guides__ocaf.html`
- OCCT XDE/data exchange documentation:
  `https://dev.opencascade.org/doc/overview/html/index.html`
- buildingSMART IFC 4.3.2.0 official documentation:
  `https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/index.html`
- NIST AI Risk Management Framework:
  `https://www.nist.gov/itl/ai-risk-management-framework`
- NIST Secure Software Development Framework:
  `https://csrc.nist.gov/projects/ssdf`

각 실제 출시 표준, MVD/IDS, 관할 법규, 제품 catalog 및 외부 validator는
별도의 version·rights·적용성 검토를 거친다.

## 15. 다음 결정

다음 구현 turn은 `GP-00`과 `GP-01`을 병렬 점검한 뒤 `GP-02` canonical
document/command ADR을 확정하는 순서로 시작한다. Precision branch에서는
읽기 가능한 integration blocker를 기록만 하고, shared/security 파일을 직접
수정하지 않는다. `GP-02`가 동결되면 Luna 작업자는 독립 capability matrix,
fixture, adapter test, UI extraction 후보를 병렬 수행할 수 있다.
