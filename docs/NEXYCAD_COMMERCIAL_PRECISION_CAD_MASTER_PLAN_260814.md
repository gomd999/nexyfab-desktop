# NEXYCAD 상용 정밀 CAD 통합 마스터 계획

- 기준일: 2026-08-14
- 상태: `PROPOSED_CANONICAL_PLAN`
- 대상 제품: AI CAD + 정밀 기계 CAD
- 현재 출시 판정: `HOLD`
- 현재 저장소: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 권장 상용 저장소: `C:\Users\gomd9\Downloads\nexysys_1\nexycad-commercial`
- 매뉴얼 기준 자료: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\document(manuals)`
- UI 기준 프로토타입: `C:\Users\gomd9\Downloads\html\NEXYCAD_Mechanical.html`

> 이 문서는 기존 계획을 그대로 합친 문서가 아니다. 2026-08-14 재점검 결과, 실제 코드와 검증 영수증, CAD 매뉴얼에서 추출한 제품 요구사항, HTML Mechanical 프로토타입의 디자인 장점을 함께 반영한 상용화 기준서다.

## 1. 결론

NEXYCAD는 현재 기능과 테스트 자산이 많은 연구·개발 저장소이지만, 그대로 상용 배포할 수 있는 상태는 아니다. 가장 큰 문제는 기능 수 부족이 아니라 다음 네 가지다.

1. 구형 배포 흔적, 신규 모듈 구조, 제품 코드, 실험 코드, 문서가 한 저장소에 중첩돼 있다.
2. UI 기능 모델, 내부 FeatureTree, OCCT 실행 계획이 서로 다른 기능 집합을 사용한다.
3. 로컬 테스트 통과와 실제 정밀 CAD 상용 증거가 혼용돼 있다.
4. 정확 형상 실패 시 메시 또는 이전 결과로 조용히 대체되는 경로가 있어 사용자가 결과의 진위를 구분하기 어렵다.

따라서 상용화의 우선순위는 기능 추가가 아니라 다음 순서로 고정한다.

1. 깨끗한 상용 저장소와 단일 CAD 문서 모델을 만든다.
2. `Exact B-Rep`과 `Preview Mesh`를 데이터·UI·API에서 완전히 구분한다.
3. Part CAD의 제한된 지원 범위를 먼저 완전하게 만든다.
4. Assembly, Drawing, Sheet Metal을 각각 독립된 출시 게이트로 승격한다.
5. AI는 동일한 명령·검증 파이프라인만 사용하게 한다.
6. 초기에는 6개 배포 단위로 운영하고, 실제 부하와 장애 격리 증거가 생긴 뒤 더 쪼갠다.

“완벽한 CAD”는 모든 상용 CAD 기능을 한 번에 복제한다는 뜻으로 사용하지 않는다. NEXYCAD에서의 의미는 **공개한 지원 범위에서는 정확하고 결정적이며, 지원하지 않는 범위에서는 조용히 근사하지 않고 명시적으로 중단하는 CAD**다.

## 2. 근거의 우선순위

서로 다른 문서나 화면이 충돌할 때 다음 순서를 적용한다.

1. 실행 가능한 제품 코드와 재현 가능한 검증 영수증
2. 이 마스터 계획과 승인된 ADR
3. 현재 상태 문서와 릴리스 매니페스트
4. `document(manuals)`의 제품 워크플로 참고 자료
5. HTML Mechanical 시각 프로토타입
6. 과거 날짜가 붙은 계획·리뷰·handoff 문서

매뉴얼은 제품 요구사항과 벤치마크를 만드는 자료이지 NEXYCAD 구현 완료의 증거가 아니다. HTML 프로토타입은 디자인 기준이지 실제 명령 실행의 증거가 아니다.

상태 표현은 다음 여섯 개로 제한한다.

| 상태 | 의미 |
|---|---|
| `IMPLEMENTED` | 코드 경로가 존재한다. 정확성이나 출시 가능성을 뜻하지 않는다. |
| `LOCAL_PASS` | 로컬 단위·통합 검증이 통과했다. |
| `EXTERNAL_PASS` | 독립 코퍼스 또는 외부 시스템을 이용한 검증이 통과했다. |
| `RELEASE_PASS` | 승인된 상용 릴리스 게이트와 운영 증거를 모두 통과했다. |
| `NOT_RUN` | 필수 검증을 아직 수행하지 않았다. 실패나 통과로 바꾸어 쓰지 않는다. |
| `BLOCKED` | 필수 입력·기능·증거가 없어 다음 단계로 진행할 수 없다. |

## 3. 2026-08-14 재점검 기준선

### 3.1 저장소와 배포 상태

- 점검 브랜치: `release/2026-08-10`
- 점검 커밋: `3d6ba1ec461169d9d331b939e432483c3953b752`
- 작업 트리: 수정 356, 삭제 2, 추적되지 않은 파일 1,394, 합계 1,752
- 추적 중인 Markdown: 273
- 추적되지 않은 Markdown: 20
- 신규 모듈 디렉터리와 배포 기술서의 상당 부분이 아직 추적되지 않은 상태다.
- 11개 서비스 기술서는 모두 `deployEnabled: false`다.
- `apps/studio-web`, `apps/core-api`는 실제 독립 앱보다 기술서에 가깝다.
- 신규 컨테이너가 계속 레거시 `src/lib`를 직접 가져온다.
- 선택 배포 검증은 매니페스트·타입 검증 수준이며 실제 선택 배포와 복구를 입증하지 않았다.

현재 저장소에는 다음 배포 흔적이 동시에 존재한다.

- Railway 단일 Docker 및 23개 cron
- Vercel 4개 cron
- 과거 Wrangler 및 `.vercel/output`
- Docker Compose
- 과거 `services/*`
- 신규 `containers/*`
- 과거 서비스 경로를 빌드하는 GitHub Actions

이 상태에서는 특정 폴더만 고쳐 배포해도 실제 영향 범위를 확정하기 어렵다.

### 3.2 검증 상태

| 항목 | 결과 | 상용 판정 |
|---|---:|---|
| 플랫폼 구조 검사 | 11 services, 5 stores, 69 API groups, 23 cron, 6 domains, 4 contracts, issue 0 | 구조 기술서 검사만 통과 |
| 플랫폼 런타임 게이트 | live evidence 10개 `NOT_RUN` | `HOLD` |
| 기계 Feature 로컬 게이트 | 30개 기능 × 7축 = 210 통과 | 로컬 한정, commercial false |
| AI qualification | 150개 케이스 점검, model/geometry/verification 모두 `NOT_RUN` | `HOLD` |
| AI runtime | 10개 케이스, 로컬 70축 통과, model/external campaign `NOT_RUN` | `HOLD` |
| 기계 contract 검사 | commercial receipt 0/30, interop 증거 없음 | 실패 |
| STEP 구조 검사 | 형상·변환 로컬 통과, 이름·부품번호·occurrence label 실패 | `HOLD` |
| Assembly handoff | 11/11 로컬 테스트 통과 | live evidence 없어 `HOLD` |
| 신규 모듈 테스트 | 9 files, 35/35 통과 | 초기 구조 검증 |

로컬 통과 수치는 보존하되 `상용 완료`, `외부 검증`, `실제 AI 검증`으로 승격하지 않는다.

### 3.3 CAD 핵심 결함

현재 CAD에서 상용화를 직접 차단하는 결함은 다음과 같다.

- OCCT 초기화 실패 시 메시 경로로 조용히 내려간다.
- 기반 solid 생성 오류 일부를 무시한다.
- 알 수 없는 feature를 건너뛰거나 빈 결과를 이전 결과로 되돌릴 수 있다.
- subtract 실패를 additive merge로 대체할 수 있다.
- B-Rep 생성 오류 후에도 메시 결과가 계속 보일 수 있다.
- 안정적 topology naming이 같은 빌드 안의 일부 흐름에만 제한된다.
- UI 약 39개 기능, `featureTree` 13개 기능, OCCT exact plan 직접 지원 7개 기능으로 모델이 분리돼 있다.
- 스케치 제약 삭제가 실제 solver가 아닌 JS ledger에서만 처리되는 경로가 있다.
- fixed point가 solver의 완전한 고정 제약으로 연결되지 않는다.
- Assembly는 FeatureTree가 없을 때 0값의 성공 응답을 만들 수 있다.
- Assembly exact resolver는 모든 스케치 plane을 XY로 보는 등 축·참조 지원이 제한적이다.
- Drawing exact handoff는 단일 part, 제한된 정투상, 전체 bbox 치수, 수량 1 BOM 수준이다.
- GD&T, PMI, 사람 승인, 제조 승인 증거가 없다.
- Sheet Metal의 일부 history는 exact 전개가 아니라 bbox 기반 경로를 사용한다.
- NFAB v3 정규화가 잘못된 part, mate, body를 조용히 버릴 수 있다.
- 신규 CAD contract가 실제 CommandBus의 유일한 계약으로 사용되지 않는다.

이 결함들이 해결되기 전에는 화려한 화면이나 많은 기능 버튼이 상용 정확도를 대신할 수 없다.

## 4. 매뉴얼 20종에서 반영한 제품 기준

`document(manuals)`에는 PDF 20개와 중복·보관 성격의 ZIP 1개가 있다. 총량은 약 448 MB다. 모든 자료를 한 제품 범위로 합치지 않고 다음과 같이 역할을 나눈다.

### 4.1 최우선 기계 CAD 참고군

| 참고군 | 반영할 핵심 개념 | NEXYCAD 요구사항 |
|---|---|---|
| SOLIDWORKS Introduction | FeatureManager, PropertyManager, design intent, sketch, feature, configuration, assembly, drawing, BOM | 하나의 문서에서 설계 의도부터 도면·BOM까지 추적 가능해야 한다. |
| Fusion 360 교재 2종 | workspace, 구속 스케치, base solid, feature history, placed/sketched feature, drawing | Part→Assembly→Drawing 흐름을 독립 모듈이되 같은 문서 계보로 연결한다. |
| SOLIDWORKS 2026 What's New | AI 보조, Sketch Doctor, configuration, 협업 공간, PLM 속성, configured drawing | AI 변경도 명령·검증·리비전 기록을 남기며 구성별 도면과 BOM을 지원해야 한다. |

이 자료에서 도출한 정식 문서 계보는 다음과 같다.

```text
Design Intent
  -> Sketch + Constraints + Dimensions
  -> Feature History
  -> Configuration
  -> Assembly Occurrence + Mate
  -> Associative Drawing + BOM
  -> Revision + Approval + PLM/Manufacturing Handoff
```

### 4.2 정확 형상·파라메트릭 참고군

| 참고군 | 반영할 핵심 개념 | NEXYCAD 요구사항 |
|---|---|---|
| Rhino User Guide 및 Level 1 | NURBS, B-Rep, trimmed surface, 좌표 입력, osnap, tolerance, export | exact geometry와 display mesh를 별도 자산으로 관리한다. |
| Grasshopper Primer 및 한국어 자료 | explicit history, 재계산, persistent/volatile data, data matching, tolerance | 의존성 그래프와 재생성 결과가 결정적이어야 하며 문서 tolerance를 전역 불변조건으로 둔다. |

메시는 뷰포트 표시, 썸네일, 근사 분석에 사용할 수 있다. 질량, 간섭, 제조 도면, STEP 납품과 같은 정밀 결과의 권위 데이터는 exact B-Rep만 사용한다.

### 4.3 제도·도면 참고군

AutoCAD 자료에서 다음 요구사항을 반영한다.

- 절대·상대·극좌표 입력과 명령 상태 표시
- object snap, ortho, polar, dynamic input
- layer, color, linetype와 객체 속성
- dimension style, template, block
- model space와 paper space 분리
- associative viewport와 plot 결과

따라서 Drawing은 단순 SVG 캡처가 아니라 모델과 연관된 도면 문서여야 한다. 뷰, 치수, BOM, 풍선, 리비전은 원본 모델 변경 시 `UP_TO_DATE`, `STALE`, `BROKEN_REFERENCE` 중 하나로 판정한다.

### 4.4 향후 AEC·시각화 참고군

| 참고군 | 활용 방향 | 현재 우선순위 |
|---|---|---|
| Civil 3D, midas Civil | 측량 좌표, surface, alignment, profile, corridor, section | 별도 Civil 제품군 이후 |
| Vectorworks Landmark | 2D/3D 통합, class/layer/sheet, data-rich object, worksheet | Spatial/AEC 모듈 이후 |
| MicroStation | design file, level/filter, view, element 속성 | 대형 도면·인프라 모듈 이후 |
| SketchUp, 3ds Max, Enscape | 개념 모델링, 렌더링, 프레젠테이션 | 정확 커널과 분리된 시각화 계층 |
| Grasshopper | 시각적 파라메트릭 자동화 | Part CAD 안정화 후 Labs |

이 자료들은 유용하지만 V1 범위를 AEC 전체로 넓히는 근거로 사용하지 않는다. V1은 기계 Part CAD의 정확성과 신뢰성을 우선한다.

### 4.5 저작권과 자료 관리

- 매뉴얼 원본은 현재 위치에서 읽기 전용 참고자료로 사용한다.
- 화면, 아이콘, 도표, 문장을 제품에 그대로 복사하지 않는다.
- 제품에는 추상화한 워크플로, 기능 요구사항, 검증 케이스만 반영한다.
- 출처·라이선스가 승인되지 않은 자료는 모델 학습, 재배포, 마케팅 이미지에 사용하지 않는다.
- ZIP은 중복·보관 여부와 라이선스를 확인하기 전까지 개발 입력으로 자동 전개하지 않는다.

## 5. 제품 범위와 출시 전략

### 5.1 제품 구성

상용 제품은 한 화면에 모든 산업을 섞지 않고 다음과 같이 나눈다.

| 제품 | 범위 | 출시 순서 |
|---|---|---:|
| NEXYCAD Mechanical Part | 구속 스케치, exact solid feature, 속성, 구성, STEP/STL/DXF | 1 |
| NEXYCAD Mechanical Assembly | occurrence, mate, DOF, interference, BOM | 2 |
| NEXYCAD Drawing | 연관 뷰, 치수·공차, 표제란, BOM·풍선, PDF/DXF | 3 |
| NEXYCAD Sheet Metal | 판금 feature, bend rule, unfold/refold, flat pattern | 4 |
| NEXYCAD AI Assistant | 명령 계획, 설명, 수정 제안, 검증·승인 | 각 모듈 게이트 통과 후 |
| NEXYCAD Spatial Labs | 건축·토목·조경·인테리어 실험 | 별도 제품 트랙 |

Part가 `RELEASE_PASS`이기 전에는 Assembly·Drawing·Sheet Metal을 유료 완성 기능으로 묶지 않는다. 각 모듈은 독립적인 beta/GA 상태를 가진다.

### 5.2 지원 범위 표현

기능별로 다음을 공개한다.

- 입력 단위와 허용 범위
- 지원 형상과 지원하지 않는 형상
- exact/preview 여부
- tolerance와 실패 조건
- 지원 import/export 형식과 보존 속성
- 알려진 제한과 우회 없는 오류 코드
- 검증 코퍼스 버전

`지원`, `정확`, `제조 가능`, `AI 검증`은 영수증이 있을 때만 사용한다.

## 6. 단일 CAD 문서와 정확 커널 계약

### 6.1 Canonical CAD Document

현재 분리된 UI feature, FeatureTree, OCCT plan을 하나의 버전 계약으로 통합한다.

```text
CadDocument
├─ documentId, schemaVersion, unitSystem, linearTolerance, angularTolerance
├─ provenance, author, organization, revision
├─ parameters[]
├─ sketches[]
│  ├─ planeRef
│  ├─ entities[]
│  ├─ constraints[]
│  └─ dimensions[]
├─ parts[]
│  ├─ bodies[]
│  ├─ featureHistory[]
│  ├─ material
│  └─ configurations[]
├─ assemblies[]
│  ├─ occurrences[]
│  └─ mates[]
├─ drawings[]
├─ sheetMetalRules[]
├─ artifacts[]
└─ validationState
```

모든 기능은 다음 계약을 따른다.

```text
Command -> Validate -> Plan -> Exact Execute -> Verify -> Commit -> Artifact/Receipt
```

- UI, AI, API, batch job은 같은 `Command`를 생성한다.
- 명령은 지원 여부와 참조 유효성을 실행 전에 검증한다.
- exact 실행 실패 시 문서 revision을 커밋하지 않는다.
- preview 생성은 exact 성공 여부와 별도의 상태로 기록한다.
- 정규화 과정에서 잘못된 객체를 조용히 버리지 않는다.
- 실패는 구조화된 오류와 feature path를 반환한다.

### 6.2 형상 자산의 분리

| 자산 | 용도 | 권위 여부 |
|---|---|---|
| `ExactBrepArtifact` | 편집, 질량, 간섭, STEP, 제조 판단 | 권위 있음 |
| `PreviewMeshArtifact` | 브라우저 표시, 썸네일, 빠른 탐색 | 권위 없음 |
| `DrawingArtifact` | 승인된 도면 출력 | 원본 B-Rep revision과 일치할 때만 권위 있음 |
| `AnalysisArtifact` | 해석 결과 | solver, mesh, material, boundary receipt가 있을 때만 권위 있음 |

exact 실패 후 preview mesh를 성공 결과처럼 표시하는 경로는 금지한다. UI는 최소한 `EXACT`, `PREVIEW_ONLY`, `STALE`, `FAILED`를 항상 보여야 한다.

### 6.3 안정적 참조와 재생성

- 모든 datum, sketch plane, edge, face 참조는 stable reference ID를 사용한다.
- feature 전후의 topology mapping을 저장한다.
- 모호한 재연결은 자동 확정하지 않고 사용자 확인 상태로 둔다.
- 같은 문서·커널·tolerance·입력은 동일한 결과 hash를 생성해야 한다.
- save/load, undo/redo, configuration 전환 후 stable reference가 유지돼야 한다.
- 커널 업그레이드는 이전 코퍼스 전체의 형상·위상·속성 차이를 산출한다.

## 7. CAD 모듈별 상용 완료 기준

### 7.1 Sketch Core

V1 필수 범위:

- point, line, polyline, circle, arc, rectangle, slot
- coincident, horizontal, vertical, parallel, perpendicular, tangent
- equal, concentric, midpoint, symmetry, fixed
- distance, horizontal/vertical distance, radius, diameter, angle
- construction geometry, trim, extend, offset
- under/constrained/fully constrained/over-constrained 판정

완료 조건:

- 제약 추가·삭제가 실제 solver와 문서에 동시에 반영된다.
- solver residual, DOF, 충돌 제약 집합을 반환한다.
- 단위와 tolerance를 바꿔도 정의된 변환 규칙이 유지된다.
- save/load와 undo/redo 후 동일한 해를 재생성한다.
- 무한값, NaN, 0길이 entity, 자기교차 profile을 명시적으로 차단한다.

### 7.2 Part Core

유료 V1 exact 범위:

- datum plane/axis/point
- extrude/add/cut
- revolve/add/cut
- hole 및 표준 hole 속성
- fillet, chamfer
- shell, draft
- boolean union/subtract/intersect
- linear/circular pattern
- mirror
- body transform 및 multi-body 관리

V1.1 후보:

- sweep, loft, rib, split, face replace
- helix/thread의 정확 형상과 제조 주석
- 고급 surface 및 NURBS 직접 편집

완료 조건:

- 각 feature가 canonical contract 한 곳에만 정의된다.
- 단일/다중 body 결과와 실패 조건이 명확하다.
- self-intersection, zero-thickness, invalid topology를 차단한다.
- mass, volume, area, center of mass가 독립 기준과 tolerance 안에서 일치한다.
- feature suppress/reorder/edit 후 deterministic regeneration을 보장한다.
- 30개 기능 수치가 아니라 기능별 정상·경계·실패·회귀 코퍼스를 통과한다.

### 7.3 Assembly Core

V1 필수 mate:

- fixed, coincident, concentric
- distance, angle
- parallel, perpendicular, tangent
- occurrence transform, grounding, suppress

완료 조건:

- FeatureTree나 exact artifact가 없는 부품에 성공 응답을 만들지 않는다.
- 임의 sketch plane과 datum reference를 보존한다.
- 각 occurrence의 DOF와 mate 기여도를 계산한다.
- over-constrained, inconsistent, circular mate를 진단한다.
- 중첩·간섭·clearance 계산은 exact B-Rep으로 수행한다.
- 동일 part의 여러 occurrence와 configuration을 구분한다.
- STEP AP242 구조에서 part name, part number, occurrence label, transform을 보존한다.

### 7.4 Drawing Core

V1 필수 범위:

- front/top/right 및 사용자 기준 base view
- projected, section, detail, auxiliary view
- hidden-line removal
- linear, angular, radial, diameter, ordinate dimension
- 치수 공차와 기본 GD&T 주석
- center mark/line, datum symbol
- title block, revision table, BOM, balloon
- PDF, SVG, DXF 출력

완료 조건:

- view와 dimension이 모델 entity reference에 연관된다.
- part/assembly configuration과 drawing revision을 고정한다.
- 모델 변경 후 영향받은 도면 객체가 자동 갱신되거나 `STALE`이 된다.
- BOM 수량이 실제 assembly occurrence와 일치한다.
- 사람 승인 전에는 `MANUFACTURING_RELEASED`가 될 수 없다.
- bbox 치수나 화면 투영을 제조 도면의 권위 치수로 사용하지 않는다.

### 7.5 Sheet Metal Core

V1 필수 범위:

- sheet-metal base feature
- edge flange, bend, hem
- corner relief, bend relief
- cut across bend
- unfold/refold
- flat pattern과 bend line
- thickness, inside radius, K-factor 또는 bend table
- flat DXF 및 bend report

완료 조건:

- folded와 flat 상태가 같은 feature history에서 재생성된다.
- bend allowance/deduction 공식과 material rule을 receipt에 기록한다.
- bbox walk나 thin-box preview를 exact flat pattern으로 승격하지 않는다.
- 겹침, 찢김, 허용되지 않는 bend, 최소 flange를 검출한다.
- 외부 기준 샘플과 전개 치수가 합의된 tolerance 안에서 일치한다.

### 7.6 Interoperability

초기 상용 형식:

- STEP AP242: solid, assembly structure, name, color, part number, transform
- IGES: surface 교환 한정, 손실 경고 필수
- STL/3MF: mesh export, exact가 아님을 명시
- DXF: sketch 및 flat pattern/drawing 범위를 구분
- NEXYCAD native: 전체 parametric history와 provenance

SLDPRT, SLDASM, CATPart, RVT 같은 독점 native 형식은 실제 라이선스와 변환 검증이 있기 전에는 지원한다고 표시하지 않는다.

## 8. AI CAD 상용 기준

AI는 별도의 비밀 CAD 엔진이 아니라 canonical command의 제안자다.

```text
User Intent
  -> AI Plan
  -> Typed CAD Commands
  -> Deterministic Validation
  -> Exact Kernel Execution
  -> Geometry/Rule Verification
  -> Human Review when required
  -> Commit + Receipt
```

필수 정책:

- AI가 만든 치수, 재료, 공차, 하중, 좌표계는 provenance를 가진다.
- 필수 값이 없으면 질문하거나 `AUTHORITATIVE_INPUT_REQUIRED`로 중단한다.
- AI는 검증 실패를 덮고 preview를 승인할 수 없다.
- 생성·수정·삭제는 사람이 확인할 수 있는 diff와 undo 단위로 제공한다.
- 동일 prompt 재현성을 강제하지 않되, 확정된 command plan의 실행은 결정적이어야 한다.
- prompt injection, 파일 내용 오염, 조직 간 데이터 유출을 별도 보안 코퍼스로 검증한다.
- 실제 모델 호출 없이 fixture만 통과한 결과는 `MODEL_NOT_RUN`으로 유지한다.

AI 출시 게이트:

1. 최소 150개 qualification 케이스에서 실제 승인 모델을 호출한다.
2. 기능별 성공률뿐 아니라 invalid geometry, unsupported command, 단위 오류를 측정한다.
3. 독립 holdout과 adversarial prompt 세트를 분리한다.
4. 사람 기준안과 command diff, exact geometry hash, 검증 receipt를 보존한다.
5. 모델 교체 시 전체 회귀를 다시 실행한다.

## 9. 디자인 테마 결정

### 9.1 채택 의견

`C:\Users\gomd9\Downloads\html\NEXYCAD_Mechanical.html`의 테마를 **NEXYCAD CAD Studio의 기본 디자인 방향으로 채택**한다.

채택 이유:

- topbar, menu, document bar, ribbon, work area, status bar의 계층이 명확하다.
- 좌측 model tree, 중앙 viewport, 우측 inspector의 위치가 안정적이다.
- 명령, 선택, 작업 상태, Jobs/Issues/AI를 한 작업 맥락 안에서 찾기 쉽다.
- 일반 SaaS 대시보드보다 전문 CAD 제품의 정보 밀도와 조작 감각에 가깝다.
- Part, Assembly, Drawing, Sheet Metal 모드 확장에 적합하다.

단, 원본 HTML은 약 391 KB의 단일 프로토타입이고 `runFake`, 가짜 AI, 고정 진행률 같은 시뮬레이션을 포함한다. 파일 전체나 스크립트를 제품 코드로 이식하지 않는다.

현재 `src/app/globals.css`의 `--nx-*` 테마는 이미 이 방향에 가깝다. 전면 재작성 대신 원본 HTML의 장점을 토큰·레이아웃·컴포넌트 계약으로 추출하고, 현재 구현의 하드코딩 색상과 중복 CSS를 제거한다.

### 9.2 디자인 토큰 기준

CAD Studio는 dark-first로 정리한다.

| 의미 | 기준 색상 |
|---|---|
| canvas background | `#0D1117` |
| secondary background | `#11161D` |
| panel | `#151B23` |
| raised panel | `#1A212B` |
| active surface | `#202934` |
| border | `#2A3441` |
| primary text | `#E9EEF5` |
| muted text | `#95A2B3` |
| accent | `#4AA3FF` |
| success | `#61D78C` |
| warning | `#F3C969` |
| error | `#FF6B6B` |

이 값은 출발점이다. 실제 적용 전 WCAG AA 대비와 뷰포트 가독성을 검증해 미세 조정한다. 상태는 색만으로 표현하지 않고 텍스트와 아이콘을 함께 사용한다.

### 9.3 화면 구조

```text
Global Topbar
Menu / Document Tabs
Context Ribbon
Workspace
├─ Left: Model / Feature / Assembly / Drawing Tree
├─ Center: Exact-aware Viewport + Selection Toolbar
├─ Right: Property / Constraint / Validation Inspector
└─ Drawers: Jobs / Issues / AI / Command History
Command Line / Status Bar
```

필수 UX 규칙:

- CAD 기본 밀도는 `Compact`, 접근성용 `Comfortable` 모드를 제공한다.
- 클릭 대상은 최소 24 px, 핵심 툴은 더 크게 유지한다.
- 폰트 크기 9~11 px의 과도한 사용을 줄인다.
- 키보드 탐색, focus ring, screen-reader label을 포함한다.
- viewport 배경과 panel 배경을 명확히 구분한다.
- 정확성 상태를 화면 하단과 속성 패널에 계속 노출한다.
- feature 실패는 트리, viewport, Issues drawer에서 같은 오류 ID로 연결한다.
- 긴 작업은 job ID, 단계, 취소 가능 여부, 재시도 정책을 표시한다.
- AI 제안과 확정된 모델 변경을 시각적으로 구분한다.

### 9.4 디자인 시스템 구조

```text
packages/design-system/
├─ tokens/
│  ├─ color.css
│  ├─ typography.css
│  ├─ spacing.css
│  ├─ density.css
│  └─ cad-status.css
├─ primitives/
├─ cad-shell/
├─ ribbon/
├─ model-tree/
├─ property-inspector/
├─ command-line/
├─ status-bar/
└─ storybook/
```

상태 토큰은 일반 success/error 외에 다음을 포함한다.

- `EXACT`
- `PREVIEW_ONLY`
- `NOT_RUN`
- `BLOCKED`
- `STALE`
- `BROKEN_REFERENCE`
- `AI_ASSUMED`
- `HUMAN_APPROVAL_REQUIRED`

현재 컴포넌트의 `#ecfdf5`, `#eff6ff` 같은 인라인 색상과 `custom.css`의 대규모 마케팅/과거 스타일은 단계적으로 제거한다. CAD Studio와 마케팅 사이트는 동일 CSS 번들을 사용하지 않는다.

## 10. 권장 저장소와 폴더 구조

### 10.1 새 상용 저장소 원칙

현재 `nexyfab.com\new` 안에서 파일을 옮기며 정리하면 1,752개 작업 트리 변경과 과거 배포 흔적을 다시 섞을 위험이 크다. 다음 인접 저장소를 새로 만들고 검증된 slice만 옮기는 방식을 권장한다.

```text
C:\Users\gomd9\Downloads\nexysys_1\nexycad-commercial\
```

현재 저장소는 `legacy source`로 동결하고 읽기 기준으로 사용한다. 자동 대량 복사는 하지 않고, 패키지별 소유권·테스트·계약을 확정한 뒤 이동한다.

### 10.2 목표 구조

```text
nexycad-commercial/
├─ apps/
│  └─ studio-web/
├─ services/
│  └─ core-api/
├─ workers/
│  ├─ job-control/
│  ├─ collaboration/
│  └─ scheduler/
├─ kernels/
│  ├─ exact-cad/
│  ├─ interop/
│  └─ analysis/
├─ packages/
│  ├─ cad-document/
│  ├─ cad-commands/
│  ├─ cad-kernel-contract/
│  ├─ sketch-core/
│  ├─ part-core/
│  ├─ assembly-core/
│  ├─ drawing-core/
│  ├─ sheet-metal-core/
│  ├─ ai-cad/
│  ├─ artifact-contracts/
│  └─ design-system/
├─ deploy/
│  ├─ cloudflare/
│  ├─ railway/
│  └─ local/
├─ evidence/
│  ├─ schemas/
│  ├─ corpora/
│  ├─ manifests/
│  └─ receipts/
├─ docs/
│  ├─ current/
│  ├─ adr/
│  ├─ operations/
│  └─ archive/
└─ legacy-adapters/
```

### 10.3 폴더 단위 작업 계약

각 deployable 폴더는 다음 파일을 자체 소유한다.

```text
<deploy-unit>/
├─ README.md
├─ package.json 또는 pyproject.toml/Cargo.toml
├─ src/
├─ tests/
├─ Dockerfile
├─ deploy.manifest.yaml
├─ env.schema.json
├─ health.contract.json
├─ openapi 또는 event schema
├─ SLO.md
├─ RUNBOOK.md
└─ OWNERS
```

규칙:

- 다른 deployable의 `src`를 직접 import하지 않는다.
- 공유 코드는 버전이 있는 `packages/*` 계약으로만 사용한다.
- 서비스 간 호출은 OpenAPI, event schema, artifact schema 중 하나로 고정한다.
- 폴더 변경 감지로 build/test/deploy 범위를 계산한다.
- DB migration 소유자를 하나로 정하고 서비스별 임의 migration을 금지한다.
- 각 단위는 독립 health check, 로그, metric, trace, rollback 절차를 가진다.
- `README`에는 로컬 실행, 입력/출력, 의존성, 장애 모드, 배포 명령을 기록한다.

이 구조를 사용하면 향후 특정 폴더만 열어 작업하더라도 필요한 계약과 검증 기준을 그 폴더 안에서 확인할 수 있다.

## 11. 초기 배포 단위

처음부터 11개 서비스를 모두 따로 운영하지 않는다. 상용 초기에는 다음 6개로 고정한다.

| 배포 단위 | 책임 | 금지사항 |
|---|---|---|
| `studio-web` | CAD UI, 인증 진입, viewport, command submission | exact kernel 내장 금지 |
| `core-api` | 조직·프로젝트·문서·revision·권한 API | 장시간 CAD 실행 금지 |
| `job-control` | queue, idempotency, timeout, retry, artifact lifecycle | CAD 결과 위조 금지 |
| `exact-cad-kernel` | sketch/part/assembly/drawing exact 실행 | 사용자 인증·결제 로직 금지 |
| `analysis-worker` | mesh/physics/DFM 분석 | exact authoring 결과로 가장 금지 |
| `collaboration-worker` | presence, lock, event sync, revision notification | canonical document 직접 변조 금지 |

cron은 `scheduler` 코드 패키지로 관리하되 초기에는 `job-control` 배포에 포함할 수 있다. 실제 처리량, 장애 도메인, 배포 빈도 중 두 가지 이상의 분리 근거가 생기면 독립 배포한다.

배포 순서:

```text
contract/schema
  -> exact-cad-kernel
  -> core-api/job-control
  -> analysis/collaboration
  -> studio-web
  -> smoke/canary
  -> promote or rollback
```

부분 배포는 단순 path filter가 아니라 다음을 증명해야 한다.

- 변경된 패키지의 downstream 영향 계산
- contract compatibility
- DB migration 호환성
- kernel/artifact schema 호환성
- canary health와 대표 CAD smoke
- 이전 이미지와 migration의 복구 가능성

## 12. 정리와 마이그레이션 원칙

### 12.1 보존 분류

모든 기존 파일을 먼저 다음으로 분류한다.

| 분류 | 처리 |
|---|---|
| `MIGRATE` | 새 계약과 테스트를 붙여 상용 저장소로 이동 |
| `ADAPT` | legacy adapter 뒤에 격리하여 임시 사용 |
| `REFERENCE_ONLY` | 읽기 전용 참고, 빌드·배포에서 제외 |
| `ARCHIVE` | 날짜·근거와 함께 docs/archive 또는 외부 보관 |
| `DROP_CANDIDATE` | 사용처·소유자·복구 경로 확인 후 별도 승인으로 제거 |

이 계획 단계에서는 기존 파일을 삭제하지 않는다.

### 12.2 배포 흔적 정리

1. 현재 Railway, Vercel, Wrangler, Compose, GitHub Actions의 실제 사용 여부를 inventory로 만든다.
2. production DNS, secret, DB, queue, cron 소유자를 연결한다.
3. 목표 배포 플랫폼과 단일 source of truth를 ADR로 결정한다.
4. 신규 6개 단위의 staging 배포와 rollback을 검증한다.
5. 기존 경로에서 트래픽이 없음을 로그와 DNS로 확인한다.
6. 삭제는 별도 승인된 cleanup PR에서만 수행한다.

### 12.3 문서 정리

- `docs/current`: 현재 사실과 실행 순서만 둔다.
- `docs/adr`: 변경 불가 결정과 대안을 기록한다.
- `docs/operations`: 배포·장애·복구 절차를 둔다.
- `docs/archive`: 과거 계획과 handoff를 날짜별로 보존한다.
- 상태 수치는 생성 스크립트와 receipt에서 가져오며 사람이 여러 문서에 복사하지 않는다.
- `완료`, `상용`, `검증` 단어는 evidence ID가 없으면 사용하지 않는다.

## 13. 실행 단계와 종료 조건

### Phase 0 — Clean Commercial RC

목표: 혼합 저장소에서 상용 개발 경계를 분리한다.

작업:

- 새 저장소 생성과 branch protection
- package/deploy ownership 확정
- license, secret, generated artifact 검사
- 문서 정본·archive 규칙 적용
- 6개 deploy manifest와 공통 CI 골격 작성
- 기존 기능 inventory와 `MIGRATE/ADAPT/REFERENCE_ONLY/ARCHIVE` 판정

종료 조건:

- 깨끗한 clone에서 install, lint, typecheck, test, build가 재현된다.
- 추적되지 않은 배포 파일이 0개다.
- 배포 단위별 owner, health, rollback이 문서화된다.
- 이전 저장소에 대한 직접 runtime import가 0개다.

### Phase 1 — Canonical CAD Foundation

목표: 모든 CAD 경로가 같은 문서·명령·artifact 계약을 사용한다.

작업:

- CadDocument schema와 migration
- typed command registry
- exact/preview artifact 분리
- stable reference/topology map
- unit/tolerance/provenance 정책
- undo/redo와 deterministic replay

종료 조건:

- UI, API, AI, batch가 같은 command schema를 사용한다.
- 지원하지 않는 feature는 구조화 오류로 fail-closed한다.
- save/load/replay 결과 hash가 코퍼스에서 일치한다.
- exact 실패 후 성공 mesh가 남는 케이스가 0개다.

### Phase 2 — Precision Part GA

목표: 제한된 Part 범위를 유료 판매 가능한 수준으로 만든다.

작업:

- Sketch와 Part V1 기능 완성
- feature edit/suppress/reorder
- property/mass 계산
- STEP/STL/DXF export
- 외부 코퍼스와 장기 soak
- HTML 테마 기반 CAD Studio shell 정식 적용

종료 조건:

- 기능별 정상·경계·실패 코퍼스가 모두 통과한다.
- 외부 STEP round-trip과 형상 속성 오차가 공개 tolerance 이내다.
- 브라우저 새로고침·동시 편집·작업 재시도에서 revision 손실이 없다.
- P0/P1 미해결 결함이 0개다.
- restore drill과 canary rollback이 통과한다.

### Phase 3 — Assembly

목표: occurrence와 mate가 정확한 조립 문서를 제공한다.

종료 조건:

- 지원 mate의 DOF·충돌 진단 코퍼스 통과
- 다중 occurrence와 configuration 보존
- exact interference 검증 통과
- AP242 assembly name/number/label/transform 보존
- stub success 0건

### Phase 4 — Drawing, Sheet Metal, Manufacturing Handoff

목표: 설계 모델에서 승인 가능한 도면과 판금 산출물을 만든다.

종료 조건:

- associative view/dimension 회귀 통과
- BOM·balloon·revision 일관성 통과
- sheet-metal flat pattern 외부 기준 통과
- PDF/DXF/STEP 산출물 provenance 완비
- 사람 승인과 제조 release 상태 전이가 감사 가능

### Phase 5 — Actual AI Qualification

목표: 실제 승인 모델의 CAD 생성·수정 성능을 입증한다.

종료 조건:

- 150개 이상 실제 모델 qualification 완료
- 독립 holdout과 adversarial set 완료
- geometry verifier와 human review 일치율 기준 충족
- AI 비용·지연·실패·재시도 SLO 충족
- 모델 교체 rollback과 회귀 절차 검증

### Phase 6 — Partial Deployment and Operations

목표: 폴더별 독립 작업과 배포를 실제 운영에서 입증한다.

종료 조건:

- 6개 단위 각각 독립 build/deploy/rollback 성공
- contract compatibility gate 작동
- representative CAD canary 자동화
- 7일 이상 운영 receipt와 장애 훈련 증거 확보
- 실제 필요성이 입증된 단위만 추가 분리

## 14. 상용 릴리스 게이트

| 게이트 | 필수 증거 | 실패 시 상태 |
|---|---|---|
| Geometry | exact B-Rep validation, mass/property 비교, topology check | `BLOCKED` |
| Determinism | replay hash, save/load, undo/redo, kernel-version diff | `BLOCKED` |
| Interop | STEP/DXF round-trip, structure/name/transform 보존 | `BLOCKED` |
| AI | 실제 model receipt, holdout, verifier, human review | `NOT_RUN` 또는 `BLOCKED` |
| Security | tenant isolation, authz, signed artifact, prompt/file attacks | `BLOCKED` |
| Reliability | queue idempotency, timeout, retry, restore, rollback | `BLOCKED` |
| Performance | 대형 모델 목표치, interaction latency, job latency | `BLOCKED` |
| UX/accessibility | keyboard, focus, contrast, error recovery, status truth | `BLOCKED` |
| Operations | dashboard, alert, runbook, on-call drill, 7-day receipt | `BLOCKED` |
| Manufacturing | drawing approval, BOM, material/tolerance, human release | `BLOCKED` |

게이트 결과는 JSON receipt와 사람이 읽는 요약을 동시에 생성한다. receipt에는 최소한 commit, image digest, schema version, kernel version, corpus version, 시작·종료 시간, 환경, 결과, 실패 목록을 포함한다.

## 15. 성능·보안·운영 목표

정확한 수치는 대표 모델 코퍼스를 확정한 뒤 조정하되, 최초 목표는 다음과 같이 둔다.

- 일반 UI 입력 피드백: p95 100 ms 이내
- 로컬 preview 갱신: p95 250 ms 이내
- 소형 exact regeneration: p95 2초 이내
- 장시간 작업: 비동기 job, progress와 cancel 제공
- command 제출: idempotency key 필수
- 문서 저장: optimistic concurrency와 revision conflict 처리
- artifact: content hash, tenant scope, TTL/retention, signed access
- 조직 간 데이터 접근: deny-by-default
- secret: 저장소·로그·artifact에서 0건
- 백업: 정기 restore drill로 RPO/RTO 검증

성능을 위해 exact를 mesh로 바꾸지 않는다. preview와 exact를 병렬·점진적으로 계산하되 결과 상태를 분리한다.

## 16. 즉시 실행할 작업 패키지

### WP-01 저장소 기준선 고정

- 현재 dirty tree와 배포 흔적 inventory를 machine-readable manifest로 만든다.
- 사용자 변경과 생성물, 레거시, 상용 후보를 구분한다.
- 삭제 없이 migration map을 완성한다.

### WP-02 Canonical Contract

- UI feature 약 39개, FeatureTree 13개, exact plan 7개의 차이표를 만든다.
- 기능 ID, 입력 schema, 참조, exact 지원, 오류를 한 registry로 통합한다.
- NFAB normalize의 silent drop을 validation error로 바꾼다.

### WP-03 Fail-Closed Exact Pipeline

- OCCT init/feature/boolean/B-Rep 실패 시 commit을 중단한다.
- previous result, additive fallback, preview fallback을 성공 경로에서 제거한다.
- exact/preview 배지와 receipt를 UI에 연결한다.

### WP-04 Sketch/Topology

- PlaneGCS 명령과 solver ledger를 단일화한다.
- constraint add/delete/fix의 실solver 검증을 추가한다.
- persistent topology naming과 save/load 회귀를 구축한다.

### WP-05 디자인 시스템

- HTML Mechanical에서 색상·간격·shell anatomy만 추출한다.
- 현재 `--nx-*`를 semantic token으로 정리한다.
- hard-coded color와 marketing CSS 의존을 제거한다.
- Part 작업의 ribbon/tree/inspector/status를 먼저 완성한다.

### WP-06 6개 배포 단위 skeleton

- 각 폴더에 manifest, health, env schema, SLO, runbook, owner를 만든다.
- cross-source import를 packages 계약으로 교체한다.
- path change graph와 contract test를 CI에 추가한다.

### WP-07 Commercial Evidence

- 코퍼스, receipt schema, evidence manifest를 버전 관리한다.
- 현재 `LOCAL_PASS`, `NOT_RUN`, `BLOCKED`를 자동 집계한다.
- 30 direct design, 20 blind, 3 manufacturing, 7-day operation 캠페인을 실제 실행 가능한 workbook으로 만든다.

## 17. 이번 결정에서 하지 않는 것

- 현재 혼합 저장소의 파일을 즉시 대량 삭제하지 않는다.
- HTML 프로토타입 전체를 React 제품 코드로 복사하지 않는다.
- 매뉴얼의 화면·문구·아이콘을 복제하지 않는다.
- 로컬 fixture 통과를 실제 AI/상용 검증으로 표시하지 않는다.
- AEC, 렌더링, Grasshopper형 비주얼 프로그래밍을 Part V1의 선행조건으로 만들지 않는다.
- 11개 기술서를 모두 즉시 독립 서비스로 배포하지 않는다.
- proprietary native CAD 변환을 검증 없이 지원한다고 광고하지 않는다.

## 18. 최종 출시 판정 규칙

다음 질문에 모두 `YES`여야 해당 모듈을 판매할 수 있다.

1. 공개한 기능이 canonical command와 exact kernel 한 경로로 실행되는가?
2. 실패 시 근사 결과를 성공처럼 반환하지 않는가?
3. 저장·재생성·undo/redo·configuration 전환이 결정적인가?
4. stable reference와 도면 연관성이 유지되는가?
5. import/export의 보존 범위와 손실이 검증됐는가?
6. 실제 AI를 사용하는 기능은 실제 모델과 독립 holdout으로 검증됐는가?
7. 조직 격리, 권한, artifact, secret 보안이 통과했는가?
8. 배포, canary, rollback, restore가 실제 환경에서 통과했는가?
9. UI가 exact/preview/stale/AI assumed 상태를 숨기지 않는가?
10. 상용 claim마다 재현 가능한 evidence ID가 있는가?

하나라도 `NO` 또는 `NOT_RUN`이면 그 모듈은 `HOLD`다. 기능을 숨기거나 Labs로 제한할 수는 있지만, 문서상의 통과로 바꾸지는 않는다.

---

이 계획의 첫 실무 목표는 “기능이 많은 CAD”가 아니라 **정확성과 실패가 정직하게 드러나는 Part CAD**다. 그 기반이 완성되면 Assembly, Drawing, Sheet Metal, AI, 분리 배포를 같은 계약과 증거 체계 위에서 확장한다.

## 19. 참고 자료 추적표

페이지 수는 PDF 메타데이터 기준이다. 이 표의 `반영 영역`은 해당 자료를 제품에 복제한다는 의미가 아니라, 추상화한 요구사항과 검증 항목을 어느 모듈에 반영했는지를 뜻한다.

| 파일 | 페이지 | 분류 | 반영 영역 |
|---|---:|---|---|
| `SOLIDWORKS_Introduction_KO(1).pdf` | 131 | 기계 CAD 핵심 | design intent, sketch, feature, assembly, drawing, BOM |
| `autodesk-fusion-360 (1).pdf` | 255 | 기계 CAD 핵심 | workspace, feature history, part/drawing workflow |
| `handout_5231_CD5231_20-_20Getting_20Started_20with_20Fusion_20360 (1).pdf` | 41 | 기계 CAD 보조 | Fusion 입문 workflow와 UI 동선 |
| `whatsnew(1).pdf` | 293 | 상용 CAD 동향 | AI 보조, configuration, 협업, PLM/BOM, drawing |
| `Rhino User's Guide for Windows.pdf` | 276 | 정확 형상 | NURBS, B-Rep, surface, 좌표, tolerance, export |
| `Rhino 6 Level 1 Training (ko-kr).pdf` | 344 | 정확 형상 | object snap, curve/surface, 정밀 모델링 절차 |
| `Rhino Level 1 v4.pdf` | 256 | 정확 형상 보조 | 명령형 모델링과 형상 기초 |
| `Grasshopper Learning Material.pdf` | 20 | 파라메트릭 | dependency graph, data flow, regeneration |
| `Grasshopper+Primer_Korean+Edition_rev.01.pdf` | 166 | 파라메트릭 | persistent/volatile data, matching, NURBS/BRep, tolerance |
| `woojsungcom-rhinograsshoppertutorial001200902181.pdf` | 47 | 파라메트릭 보조 | Rhino/Grasshopper 학습 흐름 |
| `AutoCAD Workbook for Architects and Engineers.pdf` | 298 | 제도 | 좌표, snap, layer, dimension style, paper/model space |
| `Autodesk Civil 3D 2022 Fundamentals.pdf` | 90 | Civil 후속 | point, surface, alignment, profile, section, corridor |
| `Getting_Started_Civil.pdf` | 240 | Civil 후속 | 토목 모델·해석 workflow 참고 |
| `moving-from-autocad-to-vectorworks-landmark-a-guide.pdf` | 27 | Landscape/BIM 후속 | 2D/3D 전환, class/layer/sheet, data-rich object |
| `Vectorworks Landmark.pdf` | 3 | Landscape/BIM 보조 | Landmark 기능 개요 |
| `_DesignDivision_assistant_engineer_design_design_v8_MicroStation V8 Manual.pdf` | 150 | Infrastructure 후속 | design file, level/filter, view, element 속성 |
| `SketchUp 2024 for Interior Designers.pdf` | 26 | 개념 모델링 | Interior 개념 모델·프레젠테이션 경계 |
| `Autodesk 3ds Max 2021 Fundamentals.pdf` | 50 | 시각화 | 렌더링/시각화 계층 경계 |
| `Enscape.pdf` | 29 | 시각화 | 실시간 프레젠테이션 계층 경계 |
| `handout_7273_VI7273-L_Handlout.pdf` | 29 | 보조 자료 | 범위·라이선스 확인 전 참고 전용 |
| `document(manuals).zip` | 약 210 MB | 보관 묶음 | 중복·라이선스 확인 전 자동 전개 및 제품 입력 금지 |

디자인 판단은 다음 파일을 대조했다.

| 파일 | 판단 |
|---|---|
| `C:\Users\gomd9\Downloads\html\NEXYCAD_Mechanical.html` | CAD Studio의 시각·레이아웃 기준으로 채택, 실행 스크립트는 채택하지 않음 |
| `C:\Users\gomd9\Downloads\html\NEXYCAD_UI_Implementation_Plan.md` | Mechanical-first 및 shared shell 방향 참고 |
| `src/app/globals.css` | 기존 `--nx-*` 자산을 새 semantic token으로 통합 |
| `src/app/custom.css` | CAD와 무관한 대규모 과거/마케팅 스타일을 별도 번들로 분리 |
