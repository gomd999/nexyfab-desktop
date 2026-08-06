# SCAD 이후 제조 CAD 고도화 실행 계획 — 2026-08-06

## 1. 재점검 결론

현재 완료된 것은 다음 범위다.

- 실제 DeepSeek → SCAD agent → OpenSCAD 조립 시나리오 4개가 강화 assertion으로 3회 연속 통과했다(12/12).
- SCAD module을 재사용 가능한 definition으로, 정적 callsite를 occurrence로, translate/rotate를 4×4 강체 transform으로 복원했다.
- 3회 보고서의 bridge 변환도 12/12 통과했다.
- 최신 회차에서 definition 9개를 각각 독립 STL로 렌더했고 9/9 watertight, occurrence 28개가 definition hash와 transform을 분리 참조했다.
- 결과물 없는 `done`, composition 실패 뒤 auto-preview 오인증, 대각선 배열 오통과, BOSL2 include/경로 오류, 렌더 오류 소실은 차단됐다.

그러나 제조 현장에서 사용할 수 있는 native parametric assembly의 완료 증거는 아직 없다.

| 축 | 현재 상태 | 제조 release 판정 |
|---|---|---|
| AI 다단 생성 | 실제 4개 조립 시나리오 반복 통과 | 제한 범위 pass |
| definition/occurrence | SCAD 정적 구조에서 복원 | 구조 pass, native CAD 아님 |
| definition-local geometry | 독립 STL 9/9 watertight | mesh evidence pass |
| editable feature history | SCAD source는 있으나 CAD feature history 계약 미연결 | not_run |
| analytic B-rep | SCAD 조립 definition별 미생성 | not_run |
| part certificate | STL 증거를 정식 intent/tolerance gate에 아직 연결하지 않음 | not_run |
| STEP assembly | AP242 definition/occurrence/hierarchy/transform 왕복 미완료 | not_run |
| mate/joint | SCAD placement에는 의미론적 mate가 없음 | not_run |
| motion/collision/clearance | 인증 모듈은 있으나 이 경로의 실제 입력 미연결 | not_run |
| Web/API/CLI/MCP | 관련 표면은 존재하나 새 bridge/evidence 계약 parity 미검증 | not_run |
| 120-case holdout | draft 115개, turbomachinery 5개 부족, reviewer 승인 0 | blocked from KPI |
| 일반화 정확도 95% | 4개 보정 시나리오 결과만 존재 | 미달/미측정 |

### 정책상 즉시 막아야 할 위험

1. `PartKernelEvidence.source`가 `native_mesh`를 허용하므로, 호출자가 mesh evidence를 제조용 editable B-rep과 동일하게 취급할 위험이 있다.
2. architecture에 interface가 0개면 product assembly joint gate가 통과한다. 단순 고정 배치인지, joint 추출 실패인지 구분하는 선언이 필요하다.
3. mesh→삼각면 STEP은 열리는 파일일 수 있으나 editable analytic B-rep 또는 native assembly 증거가 아니다.
4. 보정 prompt와 assertion에 맞춘 4개 시나리오의 100%를 일반 제품군 정확도 95%로 확대 해석하면 안 된다.

## 2. 최종 목표 계약

최종 결과물은 한 assembly bundle 안에 다음을 함께 가져야 한다.

1. 요구사항 graph와 확정/가정/미해결 필드.
2. 독립 part/subassembly definition과 occurrence hierarchy.
3. definition별 editable feature history와 analytic B-rep artifact.
4. occurrence별 local-to-parent 및 world transform.
5. interface/mate/joint, datum, 축, 접촉·간극 요구사항.
6. definition별 kernel/topology/dimension/feature/DFM certificate.
7. assembly별 hierarchy/transform/joint/collision/clearance certificate.
8. AP242 STEP export 및 재수입 후 definition·occurrence·transform 보존 증거.
9. 오류 taxonomy, deterministic repair, rollback, 확정 필드 보호 기록.
10. Web/API/CLI/MCP가 동일 schema·gate·artifact hash를 반환하는 parity 증거.

`releaseReady=true`는 위 필수 gate가 모두 pass일 때만 가능하다. `not_run`은 실패와 구분해 보존하되 release에는 포함하지 않는다.

## 3. 실행 순서

### A. 인증 정책 분리와 오인증 차단

구현:

- part certificate에 `artifactClass: mesh_preview | mesh_manufacturing | analytic_brep | native_parametric`를 추가한다.
- 제품군/Tier별 최소 artifact class를 정책으로 고정한다.
- `native_mesh`는 topology/preview 증거로 사용할 수 있지만 기계 제조 release의 kernel gate를 단독 통과하지 못하게 한다.
- assembly architecture에 `interfaceExpectation: none | fixed | articulated | unknown`을 추가한다.
- occurrence가 2개 이상인데 expectation이 `unknown`이거나 interface가 필요한데 0개이면 joint gate를 `not_run`으로 유지한다.
- 동일 geometry hash를 가진 definition도 part number·재질·공차·기능이 다르면 자동 병합하지 않는다.

완료 조건:

- mesh-only 기계 assembly가 `releaseReady=false`.
- 명시적 joint-free 고정 배열만 joint gate 예외를 받을 수 있음.
- 누락 interface가 pass로 바뀌는 테스트 0건.
- 기존 part/product certificate 회귀 테스트 전체 통과.

#### A 단계 구현 결과 (2026-08-06)

- `releaseTarget`과 `artifactClass`를 part certificate에 추가했고, 기본 target은 `manufacturing`이다.
- `native_mesh` 기반 `mesh_preview`, `mesh_manufacturing`, `faceted_brep`은 제조 release를 통과하지 못한다. 명시적 preview target만 유효 mesh를 허용한다.
- evidence source와 artifact class가 모순되면 `PART_KERNEL_ARTIFACT_CLASS_SOURCE_MISMATCH`로 fail한다.
- 다중 물리 occurrence에서 interface expectation이 없거나 `unknown`이면 joint gate가 `not_run`이다. 명시적 `none`만 정적 joint-free 예외다.
- part의 `not_run`은 assembly에서 fail로 왜곡하지 않고 `ASSEMBLY_PART_NOT_VERIFIED`를 포함한 `not_run`으로 보존한다.
- watertight SCAD 다중부품 mesh가 part/assembly 제조 release를 얻지 못하는 통합 회귀 테스트를 추가했다.
- 관련 단위·통합 테스트 21개, TypeScript typecheck, ESLint가 통과했다.
- 실제 SCAD bridge evidence 3회를 새 계약으로 다시 생성했고 각 회차 4/4, 합계 12/12 구조 변환을 유지했다. 이 수치는 구조 변환 통과율이며 제조 release 정확도 수치가 아니다.

따라서 A 단계의 오인증 차단 항목은 완료했다. 다음 실행 기준점은 B 단계의 canonical feature program이며, 이 단계 전까지 현재 STL/SCAD 결과는 preview/geometry evidence이지 제조용 native CAD가 아니다.

### B. SCAD definition → canonical part intent/feature program

구현:

- 각 module에 안정 ID, part number, material/process, body policy, governing dimensions를 연결한다.
- SCAD AST/제한 문법 parser로 cube/cylinder/boolean/transform/BOSL2 gear 등 지원 feature를 canonical program으로 변환한다.
- parser가 이해하지 못한 free-form SCAD는 `feature_history_not_available`로 유지하고 AI가 feature를 발명하지 못하게 한다.
- 사용자 확정 치수와 가정 치수를 분리하고 provenance를 저장한다.
- definition 하나의 수정은 해당 occurrence들과 downstream interface만 재생성한다.

완료 조건:

- 현재 9개 definition에서 지원 feature의 치수·body policy가 원 SCAD와 일치.
- unsupported construct가 silent fallback 없이 명시적 not_run.
- 확정 필드 mutation 0건.

#### B 단계 1차 구현 결과 (2026-08-06)

- SCAD definition을 deterministic canonical tree로 변환하는 제한 문법 파서를 추가했다.
- 지원 범위는 numeric `cube`, `cylinder`, BOSL2 `spur_gear`, `translate`, `rotate`, `union`, `difference`, `intersection`이다.
- node ID는 source 순서로 안정적으로 생성되며 part number, body policy, source reference를 definition에 연결한다.
- 모든 수치에는 canonical path, 단위, `generated_scad` provenance를 기록한다. AI가 생성한 수치를 사용자 확정값으로 승격하지 않는다.
- 변수식, 알 수 없는 call, 비수치 인수, 불완전 block은 silent fallback 없이 구체적인 `SCAD_FEATURE_*` code와 `not_run`을 반환한다.
- material/process는 원본에 없으므로 null과 unresolved metadata로 보존한다. canonical 변환 성공만으로 `manufacturingReady`가 되지 않는다.
- 최신 실제 SCAD 보고서 4개 시나리오에서 definition 9/9가 변환됐고 parser `not_run=0`, `manufacturingReady=0`이다. 이는 현재 제한 문법 coverage이며 analytic B-rep 정확도나 제조 release 통과율이 아니다.
- 실제 증거는 `docs/evidence/scad-canonical-features-260806/run-1.json`에 저장했다.

B단계의 현재 9개 definition 변환 범위는 완료했다. 새 SCAD 자유 문법 전체를 지원하는 것은 아니며, 다음 C단계에서 이 canonical tree를 analytic kernel command로 컴파일하고 형상 측정으로 교차 검증해야 한다.

### C. definition별 analytic B-rep 및 part certificate

구현:

- canonical feature program을 OCCT/replicad part kernel로 실행한다.
- STL을 B-rep으로 포장하는 우회는 별도 `faceted_brep`으로 표시하고 analytic pass에 포함하지 않는다.
- definition별 STEP, B-rep hash, solid/body count, watertight topology, 면/모서리 수, 치수·feature measurement를 생성한다.
- SCAD STL 측정과 analytic B-rep tessellation을 bbox/volume/topology tolerance로 교차 검증한다.
- part intent별 gate를 분리한다: machined, turned, sheet metal, pressure boundary, blade, structural, architectural, general.

완료 조건:

- 지원되는 9개 definition 모두 analytic B-rep 생성 또는 구체적 unsupported code.
- kernel/topology/dimension/feature gate가 definition별 독립 실행.
- B-rep↔STL 교차 검증 불일치가 release를 차단.
- part certificate가 artifact hash와 tolerance policy를 포함.

#### C 단계 1차 구현 결과 (2026-08-06)

- canonical tree를 실제 Replicad/OCCT analytic B-rep으로 실행하는 definition-local kernel 경로를 추가했다.
- analytic box, cylinder, translate, X/Y/Z rotate, fuse, cut, intersect를 지원한다.
- OpenSCAD `center` 좌표 의미를 OCCT primitive 배치에 보존한다.
- 결과마다 bbox, volume, solid count, face count를 native kernel에서 측정하고 single-body policy를 검사한다.
- definition별 STEP을 실제 OCCT에서 내보내고 `MANIFOLD_SOLID_BREP`, `ADVANCED_FACE`, byte count, SHA-256을 증거에 기록한다.
- SCAD STL과 analytic B-rep의 bbox·volume을 교차 검증한다. 원통의 mesh 허용치는 임의 상수가 아니라 OpenSCAD 기본 `$fa=12`, `$fs=2` 또는 명시적 `$fn`으로 계산한다.
- 최신 9개 definition 실제 실행 결과는 analytic pass 7, explicit not_run 2, kernel fail 0, 실행된 교차 검증 7/7 pass다.
- not_run 2건은 BOSL2 involute `spur_gear`의 analytic kernel compiler가 아직 없기 때문이다. gear mesh를 faceted B-rep으로 포장하는 우회는 사용하지 않았다.
- material/process가 원본에서 미확정이고 gear 2건이 미실행이므로 manufacturingReady는 0으로 유지한다.
- 실제 STEP과 JSON 증거는 `docs/evidence/scad-analytic-brep-260806/`에 저장했다.

C단계는 primitive/boolean definition 7개에 대해 완료됐고 전체 9개 완료는 아니다. 다음 핵심 작업은 analytic involute gear compiler, definition별 part certificate 연결, STEP 재수입 검증이다. 이 세 항목 전에는 D단계 assembly release로 승격하지 않는다.

#### C 단계 2차 구현 결과 (2026-08-06)

- 표준 full-depth 치형(addendum `m`, dedendum `1.25m`)과 pressure angle을 사용하는 deterministic involute spur gear profile compiler를 추가했다.
- profile은 OCCT sketch/wire에서 extrusion되는 analytic-kernel 형상이며 STL 삼각면을 B-rep으로 포장한 것이 아니다. bore는 기존 canonical subtract 연산으로 정확히 절삭된다.
- flank 분할과 definition-local feature parameter를 고정해 같은 입력은 같은 profile과 STEP을 생성한다.
- 실제 gear 20T/30T를 포함한 9개 definition 모두 analytic B-rep 생성에 성공했다. 결과는 analytic pass 9/9, parser/kernel not_run 0, kernel fail 0, SCAD STL bbox·volume 교차검증 9/9 pass다.
- 생성된 STEP 9개를 다시 OCCT로 import하여 bbox, volume, solid count를 재측정했고 roundtrip 9/9가 0.001 mm·1e-6 relative volume 기준을 통과했다.
- definition별 part certificate를 실제 artifact hash와 연결했다. 그러나 native non-manifold/degenerate topology 검사와 개별 governing dimension 재측정은 아직 없으므로 9개 모두 정직하게 `not_run`이다.
- 따라서 geometry/STEP roundtrip coverage는 9/9이지만 part certificate pass와 manufacturingReady는 0이다. 이 상태를 전체 제조 정확도 100%로 해석하지 않는다.
- 최신 증거는 `docs/evidence/scad-analytic-brep-260806/run-3.json`과 같은 폴더의 STEP 9개다.

다음 작업은 native detailed topology extractor와 canonical dimension/feature measurement를 연결해 part certificate의 `not_run`을 실제 측정으로 줄이는 것이다. 그 후에만 D단계 native assembly writer 입력으로 사용한다.

#### C 단계 3차 구현 결과 (2026-08-06)

- 기존 Node OCCT detailed inspector를 STEP 재수입 경로에 연결했다. BRep validity, solid/face/edge count, face adjacency, boundary/non-manifold edge, minimum edge length를 definition별로 측정한다.
- Replicad OCCT 7.8과 기존 opencascade.js의 차이를 처리하도록 `TransferRoots(progressRange)`/zero-argument 및 3/2-argument `BRepCheck_Analyzer` 호환 경로를 구현했다.
- native topology 검사는 실제 9개 definition에서 9/9 pass, not_run 0이다.
- 최종 B-rep에서 독립적으로 역측정 가능한 box, oriented cylinder, concentric hollow cylinder, fused L-bracket 치수를 certificate evidence로 연결했다.
- no-op zero translate/rotate는 canonical tree에서 제거해 가짜 governing dimension을 만들지 않는다.
- 실제 part certificate는 기존 0 pass/9 not_run에서 7 pass/2 not_run/fail 0으로 개선됐다.
- 남은 2 not_run은 gear20/gear30이다. 치수 입력을 그대로 되읽지 않고 보어 원통 반지름, tooth periodicity, pressure angle을 native surface/edge에서 역측정하는 extractor가 필요하다.
- material/process는 여전히 unresolved metadata이므로 geometry certificate가 pass한 7개도 최종 `manufacturingReady`는 0이다.
- 최신 증거는 `docs/evidence/scad-analytic-brep-260806/run-8.json`, 대응 canonical 증거는 `docs/evidence/scad-canonical-features-260806/run-2.json`이다.

#### C 단계 4차 구현 결과 (2026-08-06)

- OCCT detailed inspection에 unique cylindrical face radius 측정을 추가했다. 이는 source parameter가 아니라 STEP 재수입 B-rep의 `BRepAdaptor_Surface.Cylinder().Radius()` 값이다.
- gear의 tooth count는 native face periodicity로, bore diameter는 native cylindrical radius로 측정한다.
- module과 pressure angle은 native bbox·volume·tooth count·bore·thickness를 입력으로 involute profile을 역산하고, bbox 0.001 mm 및 volume 1e-5 relative residual 이내일 때만 증거로 인정한다.
- gear cutter의 과도한 관통 높이는 최종 제품에 남지 않는 construction clearance이므로 governing product dimension에서 제외했다. bore diameter는 계속 필수 측정한다.
- 실제 gear20/gear30 모두 역측정 gate를 통과해 part certificate가 9 pass/0 not_run/0 fail이 됐다.
- 전체 실제 결과는 canonical 9/9, analytic B-rep 9/9, STL cross-check 9/9, STEP roundtrip 9/9, native topology 9/9, part certificate 9/9다.
- real-OCCT 및 canonical 관련 테스트는 45 pass/1 fixture-dependent skip, TypeScript와 ESLint는 통과했다.
- `manufacturingReady=0`은 geometry certificate 실패가 아니라 material/process가 source에서 미확정이기 때문이다. 이를 AI 기본값으로 발명하지 않는다.
- 최신 증거는 `docs/evidence/scad-analytic-brep-260806/run-9.json`, canonical 입력 증거는 `docs/evidence/scad-canonical-features-260806/run-3.json`이다.

C단계의 현재 9개 definition 형상 인증 범위는 완료됐다. 다음 D단계로 이동하기 전 material/process는 사용자 선택 또는 명시적 제품군 정책으로 확정해야 하며, 그 정책의 provenance를 bundle에 기록해야 한다.

#### D 단계 준비 및 metadata provenance 결과 (2026-08-06)

- material/process assignment는 `user_confirmed` 또는 명시적으로 opt-in한 `approved_family_policy`만 허용한다. 값, sourceRef, confirmation/policy ID가 없으면 silent default 없이 not_run이다.
- assignment가 적용되면 해당 definition의 `material`/`process` unresolved만 제거하며 tolerance 등 다른 미확정 필드는 보존한다.
- native STEP assembly plan은 part definition별 STEP path/hash/material/process provenance를 한 번만 보유하고 occurrence별 parent와 4×4 local-to-parent transform을 별도로 보유한다.
- 누락 assignment/artifact/transform은 not_run, 잘못된 hash나 affine matrix는 fail이다.
- 반복 wheel처럼 같은 definition을 여러 occurrence가 참조해도 definition은 하나만 유지한다.
- 실제 4개 SCAD 조립 시나리오에 plan builder를 실행한 결과 pass 0/not_run 4/fail 0이다. 원인은 9개 part의 material/process가 사용자 또는 승인 정책으로 확정되지 않았기 때문이다.
- 실제 계획 증거는 `docs/evidence/native-step-assembly-plan-260806/run-1.json`이다.

다음 D 실행은 확정 assignment bundle을 받은 뒤 XCAF writer에 local definition shape와 occurrence matrix를 전달하고, AP242 재수입에서 definition/occurrence/hierarchy/transform/units를 비교한다. 현재 구형 writer의 pre-baked rotation 경로는 이 검증에 사용하지 않는다.

#### D 단계 구조 roundtrip 결과 (2026-08-06)

- local B-rep definition과 row-major occurrence matrix를 직접 받는 새 XCAF writer를 추가했다. 형상에 placement를 미리 굽지 않는다.
- definition label은 한 번만 AddShape하고 모든 occurrence가 같은 label을 AddComponent로 참조한다.
- XCAF location과 STEP NAUO reader 사이의 inverse convention을 writer 경계에서 보정해 canonical local-to-parent 행렬이 왕복 후 복원된다.
- 실제 4개 assembly에서 AP242 구조 export/re-import를 실행한 결과 4/4 pass, fail 0이다.
- definition 9개, occurrence 28개 전체가 보존됐고 transform available 28/28, missing/invalid 0, cycle 0이다.
- simple car는 definition 3/product 4/occurrence 7, bracket grid는 definition 1/product 2/occurrence 16으로 반복 부품이 flatten/duplicate되지 않았다.
- 각 scenario의 expected transform multiset과 STEP에서 재추출한 local-to-parent transform multiset이 1e-7 정규화 기준으로 일치했다.
- 구조 검증용 STEP 4개와 JSON은 `docs/evidence/scad-native-step-assembly-260806/`, 최신 결과는 `run-2.json`이다.
- material/process는 미확정이므로 structuralReady 4/4와 별개로 manufacturingReleaseReady는 0이다.

D단계의 현재 4개 조립 구조 roundtrip 범위는 완료됐다. 제조 release 승격에는 assignment provenance와 다음 E단계 interface/joint 증거가 모두 필요하다.

### D. native STEP assembly occurrence 왕복

구현:

- product/subassembly/part definition을 유지한 AP242 assembly writer를 단일 경로로 만든다.
- 동일 definition의 반복 occurrence는 동일 product definition을 참조하게 한다.
- local-to-parent transform, hierarchy, units, coordinate system을 기록한다.
- FreeCAD/OCCT 재수입 extractor로 definition count, occurrence count, parent edge, transform를 재측정한다.
- source bundle과 re-import bundle을 ID가 아니라 구조·hash·tolerance로 비교한다.

완료 조건:

- 4개 조립 시나리오에서 definition/occurrence/hierarchy/transform/units 전부 pass.
- 16개 브래킷이 1 definition + 16 occurrences로 왕복.
- occurrence flattening, transform 누락, body merge는 fail.
- STEP에 포함되지 않은 항목이 있으면 releaseReady=false.

### E. interface-first mate/joint 계약

구현:

- prompt 요구사항에서 접촉면·축·구멍 패턴·offset·자유도를 먼저 선언한다.
- fixed, revolute, prismatic, cylindrical, planar, spherical, contact를 canonical interface로 저장한다.
- datum은 안정 face/axis reference와 연결하고 topology naming 변경 시 재바인딩 증거를 남긴다.
- 정적 배열은 fixed placement policy, 기어열은 축·중심거리·회전비, 로봇은 실제 joint DoF로 분리한다.
- inference 결과는 confidence만으로 통과시키지 않고 solver residual과 endpoint identity를 측정한다.

완료 조건:

- interface expectation과 실제 interface 수가 일치.
- joint endpoint, type, axis, residual 전부 측정.
- 0-joint 오인증 없음.
- 기어열에는 맞물림 중심거리와 회전 관계 증거가 포함.

### F. motion·precise collision·clearance

구현:

- joint별 범위, 단위, frame 수, 구동 occurrence를 motion plan으로 만든다.
- 0~N frame solver 결과와 수렴 여부를 저장한다.
- broad phase 뒤 실제 part-local mesh/B-rep 기반 precise collision을 실행한다.
- 연속 구간 CCD/TOI를 수행해 frame 사이 충돌 누락을 막는다.
- 요구 간극은 pair별 최소 거리, artifact hash, 허용 접촉 여부와 함께 인증한다.
- 고정 조립도 정적 collision/clearance는 반드시 수행한다.

완료 조건:

- 누락 frame, solver 비수렴, unresolved interval, 거리 미측정은 not_run/fail.
- motion certificate의 planning/solver/precise_collision/clearance가 모두 pass해야 release.
- 토이카 wheel/body, 기어쌍, 파이프 section, bracket grid에 제품별 합리적 collision policy 적용.

### G. deterministic repair와 국소 재생성

구현:

- 오류를 intent/schema/kernel/topology/dimension/interface/transform/collision/clearance/export/parity로 분류한다.
- 각 code에 deterministic repair handler, 허용 mutation boundary, 재검증 범위를 연결한다.
- repair 전 checkpoint와 artifact hash를 저장한다.
- 사용자 확정 필드와 무관 definition은 변경하지 않는다.
- 동일 오류 2회 반복 시 다른 repair로 전환하고, 3회 반복 시 명시적 blocked로 종료한다.

완료 조건:

- 확정 필드 변경 0.
- 정상 part 전체 재생성 비율 5% 이하.
- repair 후 영향받은 gate와 downstream gate만 재실행.
- rollback hash 일치.

### H. Web/API/CLI/MCP 단일 계약 연결

구현:

- bridge, definition geometry, part certificate, assembly certificate, motion certificate를 하나의 shared service로 묶는다.
- Web은 진행 단계·not_run 이유·선택된 part/face 수정 범위를 표시한다.
- API는 동일 request/response schema와 artifact IDs를 반환한다.
- CLI와 MCP는 API를 우회해 별도 판정을 만들지 않고 동일 core를 호출한다.
- quote/RFQ 기능은 계속 포함하지 않는다.
- AI provider 연결, OpenSCAD/BOSL2/OCCT/FreeCAD readiness를 배포 health에 포함한다.

완료 조건:

- 동일 fixture의 Web/API/CLI/MCP canonical JSON hash 일치.
- status, codes, releaseReady, definition/occurrence count, artifact hash parity.
- 인증되지 않은 로컬 경로나 source CAD가 외부 응답에 노출되지 않음.
- 실제 배포 환경 smoke test 통과.

### I. holdout corpus와 95% campaign

선행 조건:

- turbomachinery 독립 holdout 5개 추가.
- 총 120개 case의 provenance/license/lineage/native structure/tolerance/assertion reviewer 승인.
- tuning에 사용된 자료와 holdout 격리.

실행:

- 6개 제품군 × 20 holdout × 5 repeat × 3 campaign = 1,800회.
- robot, gearbox, pressure vessel, turbomachinery, factory equipment, interior를 T1~T3로 계층화한다.
- 축별로 intent, part geometry, dimensions, features, definitions, occurrences, transforms, joints, collision, clearance, STEP roundtrip을 채점한다.
- `accuracy = pass / executed`, `coverage = executed / eligible`을 별도로 계산한다.
- fail과 not_run을 숨기지 않고 family/Tier/axis별 Pareto를 만든다.

95% 완료 조건:

- 각 필수 축의 accuracy ≥95% 및 coverage ≥95%.
- 각 제품군과 각 Tier도 각각 ≥95%.
- falseVerified=0, falseClear=0, destructivePartMerge=0.
- 전체 campaign 3회 연속 통과.
- Web/API/CLI/MCP parity 동시 통과.

## 4. 병렬 실행 구조

순서 의존성을 지키면서 다음 lane은 병렬화할 수 있다.

| Lane | 작업 | 선행 조건 |
|---|---|---|
| L1 kernel | canonical feature program, analytic B-rep, part STEP | A, B |
| L2 assembly | definition/occurrence writer, AP242 roundtrip | A, bridge |
| L3 interfaces | mate/joint schema, solver residual, topology refs | A, architecture |
| L4 verification | collision, clearance, motion, CCD | definition-local geometry, L3 일부 |
| L5 surfaces | Web/API/CLI/MCP shared contract와 parity tests | 각 core schema가 고정되는 즉시 |
| L6 corpus | reviewer worklist, turbomachinery 5개, campaign manifests | 독립 진행 가능 |

통합 순서는 `A → B → (C || corpus 준비) → D → E → F → G → H → I`다. C/D/E 사이에는 schema freeze checkpoint를 두고, 이후 변경은 migration과 backward-compatibility test를 요구한다.

## 5. 다음 즉시 실행 묶음

1. part certificate artifact-class 정책과 mesh-only release 차단.
2. assembly interface expectation 및 0-joint 오인증 차단.
3. 현재 9개 SCAD definition을 canonical feature program으로 변환하는 지원 범위 작성.
4. 지원 definition의 analytic B-rep 생성과 STL 교차 검증.
5. 4개 조립의 AP242 assembly export/re-import occurrence 검증.
6. 그 결과를 shared service로 묶고 API/CLI/MCP parity fixture 추가.

각 묶음은 `unit test → typecheck/lint → 실제 artifact 실행 → fail/not_run 감사 → 정책 조정 → 재실행 → 증거 MD/JSON 갱신` 순서로 종료한다.
