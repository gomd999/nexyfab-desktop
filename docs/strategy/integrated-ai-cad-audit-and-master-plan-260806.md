# NexyFab AI CAD 통합 현황 감사 및 개발 마스터 계획

> 기준일: 2026-08-06  
> 대상: 기계·제품·로봇·공장 설비·건축·토목·조경·인테리어를 포괄하는 대화형 AI 설계 서비스  
> 제품 원칙: 다중 부품·실제 조립 구조·편집 가능한 설계 의도·검증 증거를 유지하며, 견적/RFQ는 현재 범위에서 제외한다.

## 1. 결론

현재 시스템은 단순한 OpenSCAD 데모 수준을 넘어 다음 기반을 갖췄다.

- 요구사항 → 기능 분해 → 제품/부품/occurrence/interface 구조 계약
- 부품별 canonical feature program과 analytic B-rep 생성
- native topology·치수·STEP 왕복 검증과 부품 인증서
- definition/occurrence를 보존하는 AP242 조립 STEP
- 고정·회전·접촉 인터페이스와 잔차 검증
- 오류 코드 기반 결정적 국소 수리와 mutation boundary
- T배관 유로의 native Boolean 연결성 검사
- S0~S8 checkpoint, resume, rollback, 사용자 확정 필드 보호 기반
- Web/API/CLI/MCP에 대응하는 CAD v1 표면과 다수의 도메인별 검증 모듈

하지만 서비스 전체가 제조 CAD 정확도 95%를 달성했다고 판단할 수는 없다.

- 최신 4개 SCAD 교정 시나리오는 구조·조립·인터페이스에서 `4 pass / 0 fail / 0 not_run`이다.
- 이는 알려진 오류를 수리한 좁은 교정 집합의 결과이며 일반화 정확도가 아니다.
- 독립 holdout은 현재 115개 초안이고 reviewer 승인 항목은 0개다.
- 6개 제품군 × 20개 × 5회 × 3 campaign, 총 1,800회의 실제 AI 생성 평가는 아직 실행되지 않았다.
- 배포 사이트의 AI provider 연결 상태는 이번 로컬 감사만으로 확인되지 않았다.
- OpenSCAD native 실행 파일은 현재 PATH에서 발견되지 않아 수리본 STL 교차검증이 중단된 상태다.
- 재료·공정은 사용자 확인 또는 승인 정책이 없어 제조 release가 의도적으로 닫혀 있다.

따라서 현재 단계는 **제조용 AI CAD 검증 기반과 교정 예제가 완성된 상태**, 다음 목표는 **배포 경로 통합, 복잡 제품 일반화, 승인 holdout 기반 95% 입증**이다.

## 2. 이번 재감사에서 확인한 사실

### 2.1 최신 SCAD 제조 경로

| 항목                  |                       실제 결과 | 판정           | 근거                                          |
| --------------------- | ------------------------------: | -------------- | --------------------------------------------- |
| canonical definition  |                      12/12 변환 | 완료           | `scad-canonical-features-260806/run-6.json`   |
| analytic B-rep        |      12 pass, fail 0, not_run 0 | 완료           | `scad-analytic-brep-260806/run-11.json`       |
| native topology       |                      12/12 pass | 완료           | 같은 artifact                                 |
| part certificate      |                      12/12 pass | 완료           | 같은 artifact                                 |
| STEP roundtrip        |                      12/12 pass | 완료           | 같은 artifact                                 |
| AP242 assembly        |                        4/4 pass | 완료           | `scad-native-step-assembly-260806/run-4.json` |
| assembly 규모         |  12 definitions, 30 occurrences | 측정 완료      | 같은 artifact                                 |
| interface/joint       |                        4/4 pass | 교정 집합 완료 | `scad-interface-evidence-260806/run-5.json`   |
| T배관 유로            | component 1, blocked junction 0 | 완료           | `scad-native-flow-260806/run-3.json`          |
| manufacturing release |                               0 | 정책상 정상    | 재료·공정 미확정                              |
| STL cross-check       |                       0/12 실행 | 환경 복구 필요 | OpenSCAD native executable ENOENT             |

### 2.2 실제로 찾아 수리한 오류

1. 자동차 바퀴 원통축이 요구 Y축이 아니라 X축이었던 문제.
2. 동일 위치 창문 occurrence가 두 번 생성된 문제.
3. 기어만 있고 베이스·축·회전 지지가 없었던 문제.
4. T배관 세 부품이 좌표상 만났지만 내부 유로가 두 성분으로 막혀 있던 문제.
5. 첫 T배관 수리가 접선/한 점 접촉만 만들어 유로가 세 성분으로 분리된 문제.

최종 수리는 외곽 -50~+50 mm를 유지하면서 중앙에 유한 개구 면적을 만들었고, native Boolean으로 한 개의 유로 성분을 재확인했다. 수리본은 `validation-reports/scad-agent-2026-08-06T09-10-47-repaired-3.json`에 보존돼 있다.

### 2.3 코드 건강 상태

- 관련 결정적 수리·인터페이스·조립 인증 테스트: 3 files, 16 tests 통과.
- 변경 파일 ESLint 통과.
- 전체 `npm run typecheck` 통과.
- 관련 파일 `git diff --check` 통과.
- 작업 트리는 대규모 modified/untracked 상태다. 기능 손실은 확인되지 않았지만 원인 추적·rollback·병합 위험이 크므로 P0 체크포인트가 필요하다.

### 2.4 reference corpus와 95% 평가 준비

기존 참고 자료와 corpus 작업에서 확인된 현재 상태는 다음과 같다.

- 제품 단위 CAD/assembly/archive 후보 897개를 inventory했다.
- 중복 lineage를 제거한 선택 초안은 115개다.
- robot 20, gearbox 20, pressure vessel 20, factory equipment 20, interior 20 후보가 선택됐다.
- turbomachinery는 15개로 독립 후보 5개가 부족하다.
- preflight는 `fail 0 / not_run 115`다.
- reviewer 승인 assertion은 0개이며 전부 KPI 비대상이다.
- FreeCAD로 직접 STEP/STP 24개와 archive 내부 STEP/STP 11개, 총 35개 native extraction 결과를 확보했다.
- native 결과에서 definition/occurrence/hierarchy/rigid transform/units는 각각 `35 pass / 80 not_run`, joint는 `0 pass / 115 not_run`이다.
- SolidWorks COM 45, Inventor COM 13, 기타 proprietary/native extractor와 manual interface review가 남아 있다.

자동 추출 결과는 reviewer가 provenance·license·tolerance·semantic identity를 승인하기 전까지 ground truth로 승격하지 않는다.

## 3. 기능 영역별 정확한 상태

| 영역                            | 상태                    | 현재 가능한 것                                                 | 완료로 인정하기 위해 남은 것                                      |
| ------------------------------- | ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 대화형 요구사항 구체화          | 부분완료                | 다단 refinement, 요구사항/제품 구조 IR                         | 실제 provider 반복 생성과 모호성 해소 정확도 측정                 |
| 단일 부품 생성                  | 기반완료                | feature program, B-rep, topology/dimension gate                | feature family 확대와 독립 holdout 95%                            |
| 다중 부품 조립                  | 기반완료                | definition/occurrence/AP242/interface                          | 대형 계층 조립, native joint, fastener/bearing/standard part 확대 |
| 면·선·부품 선택 채팅 수정       | 부분완료                | selection context, topology reconcile, assembly selection edit | 실제 UI end-to-end, persistent naming 생존율, 국소 재생성 증거    |
| 모션·충돌·clearance             | 모듈 존재·통합 필요     | precise collision, CCD/TOI, motion certificate                 | 최신 AP242/인터페이스 경로와 실제 제품 baseline 연결              |
| HTML 결과물·부품 이동·animation | 구현 기반 존재          | standalone HTML, GLB, timeline, frame animation                | 최신 생성 세션·assembly certificate와 E2E 연결                    |
| 기계/로봇/설비                  | 부분완료                | 기계 feature와 로봇/조립 검증 모듈                             | 복잡 제품군별 승인 holdout과 실제 AI baseline                     |
| 건축/토목/조경/인테리어         | 부분완료                | IFC spatial/domain IR, 방·문·창·동선·MEP·일조 모듈             | 분야별 authoritative semantics, 문서 세트, 실제 프로젝트 baseline |
| Web/API/CLI/MCP                 | 표면 존재·parity 미완료 | CAD v1 API와 CLI/MCP mapping 다수                              | 동일 core artifact hash와 status/code의 4표면 E2E 증거            |
| 배포 AI API                     | 미검증                  | provider chain·health/usage route 존재                         | 현재 배포 환경 credential/route/streaming smoke와 장애 복구 검증  |
| OpenSCAD                        | 부분 장애               | browser WASM asset 존재, 기존 native evidence 존재             | native executable 경로 복구 및 12/12 STL 재교차검증               |
| 제조 release                    | 의도적으로 닫힘         | fail-closed material/process 정책                              | 사용자 확정 또는 승인 family policy 및 도면/PMI/공정 gate         |
| 견적/RFQ                        | 제외                    | export-to-quote route 제거                                     | CAD 경로에서 side effect 0을 parity test로 계속 보장              |
| 일반화 95%                      | 미측정                  | KPI/runner/checkpoint 계약                                     | 승인 120 holdout, 실제 1,800 runs, 3 campaign 연속 통과           |

## 4. 목표 아키텍처

모든 분야를 하나의 geometry generator로 처리하지 않는다. 공통 orchestration과 분야별 authoritative kernel을 결합한다.

```text
사용자 대화/선택 편집
  → 요구사항 graph + confirmed/unresolved/conflict
  → 분야 분류 및 hybrid project decomposition
  → product/spatial architecture
  → 분야별 generator
      기계: feature/B-rep/assembly/mate/tolerance
      건축·인테리어: space/boundary/opening/circulation/IFC
      토목·조경: alignment/terrain/network/drainage/quantity
      공장: equipment + structure + MEP + clearance hybrid
  → native geometry/semantic artifact
  → part gate + product/project gate
  → deterministic local repair + rollback
  → STEP/IFC/GLB/HTML/도면 artifact
  → Web/API/CLI/MCP shared response
  → holdout assertion graph와 accuracy/coverage 측정
```

공통 계층은 세션·요구사항·checkpoint·artifact hash·오류 taxonomy·증거 schema만 담당한다. 분야별 형상 의미론과 검증 규칙은 분리한다.

## 5. 개발 원칙과 판정 규칙

1. mesh preview를 analytic/native manufacturing artifact로 승격하지 않는다.
2. `not_run`을 pass 또는 fail로 바꾸지 않는다.
3. 실제 측정하지 않은 값은 exact로 표시하지 않는다.
4. occurrence가 여러 개인데 interface expectation이 없으면 release하지 않는다.
5. 정적 배열은 명시적 `interfaceExpectation=none`일 때만 joint-free pass를 허용한다.
6. 사용자 confirmed field와 무관 부품은 repair가 변경하지 못한다.
7. repair 전후 source/artifact hash와 mutation path를 저장한다.
8. 동일 오류가 반복되면 무제한 재생성하지 않고 rollback/blocked로 전환한다.
9. 제조 release와 geometry/structural pass를 분리한다.
10. 견적·공장 연결·RFQ side effect는 CAD 생성/검증 경로에서 호출하지 않는다.
11. 4개 교정 예제의 100%를 일반 정확도 95%로 표시하지 않는다.
12. accuracy와 coverage를 항상 함께 공개한다.

## 6. 단계별 통합 개발 계획

### P0. 기준선 동결과 개발 복구성

목표: 현재 대규모 변경 집합을 잃지 않고 이후 회귀 원인을 추적할 수 있게 한다.

작업:

1. 현재 modified/untracked 파일을 기능 영역별 manifest로 분류한다.
2. evidence JSON, generated STEP/STL, source code를 구분하고 생성물 정책을 정한다.
3. 핵심 schema와 artifact에 SHA-256 manifest를 만든다.
4. 관련 테스트 목록과 재생성 명령을 하나의 audit runner로 묶는다.
5. 안전한 checkpoint/branch/commit 단위를 정한다. 기존 사용자 변경을 덮어쓰지 않는다.

종료 조건:

- clean-room에서 동일 명령으로 최신 4-scenario artifact를 재생성할 수 있다.
- source/evidence/generated artifact의 소유와 재생성 가능 여부가 명시된다.
- rollback 후 hash가 기준선과 일치한다.

### P1. 실행 환경과 배포 AI 연결 복구

목표: 로컬과 현재 배포 사이트에서 AI 및 geometry worker가 실제로 동작하는지 증명한다.

작업:

1. `OPENSCAD_BIN`, `OPENSCADPATH`, BOSL2 경로와 `/api/health/openscad`를 복구한다.
2. 수리된 12개 definition을 STL로 다시 렌더하고 B-rep bbox/volume과 교차검증한다.
3. 배포 환경 provider credential presence를 값 노출 없이 점검한다.
4. provider chain의 text, structured JSON, streaming, timeout, fallback을 각각 smoke test한다.
5. shape chat → generation state → native artifact → viewer까지 배포 E2E를 실행한다.
6. provider outage, rate limit, malformed JSON, stream disconnect를 재현하고 사용자에게 명확한 code를 반환한다.
7. admin health에 provider·endpoint·최근 실패·latency를 연결한다.

종료 조건:

- OpenSCAD repaired definition cross-check 12/12 pass.
- 배포 AI prompt 10회 연속 transport success, silent local fallback 0.
- provider 장애 시 fallback 또는 명시적 오류가 100% 관측된다.
- API key와 로컬 경로가 응답/log에 노출되지 않는다.

### P2. 단일 shared generation/verification core

목표: Web/API/CLI/MCP가 서로 다른 판정을 만들지 않게 한다.

작업:

1. request를 requirement graph, architecture, generation session으로 정규화한다.
2. S0~S8 advance/finalize/refine를 shared application service로 묶는다.
3. part/product/project certificate와 artifact references를 공통 response schema로 고정한다.
4. Web route, CAD v1 API, CLI, MCP를 얇은 adapter로 변경한다.
5. source CAD path/body는 외부 응답에 반환하지 않고 artifact ID만 반환한다.
6. quote/RFQ side effect가 없음을 모든 adapter에서 검사한다.

종료 조건:

- 동일 fixture의 canonical response hash가 Web/API/CLI/MCP에서 일치한다.
- status, codes, definition/occurrence count, transform, certificate hash가 일치한다.
- adapter 자체의 geometry 판정 로직 0개.

### P3. 선택 기반 대화형 편집 완성

목표: 면·선·부품을 선택하고 자연어로 수정해도 설계 의도와 조립 구조가 유지되게 한다.

작업:

1. viewport pick → stable topology reference → selection context를 하나의 계약으로 고정한다.
2. face push/pull, hole diameter/location, fillet/chamfer, pattern count/spacing을 feature edit로 변환한다.
3. part occurrence 이동은 definition geometry 변경과 분리한다.
4. 여러 occurrence가 같은 definition을 참조할 때 `이 부품만/모든 동일 부품`을 명시한다.
5. joint/interface datum이 변경된 topology reference에 재결합되는지 검사한다.
6. 영향 graph로 downstream part/subassembly만 재생성한다.
7. 편집 전후 dimension, interface, collision, clearance certificate를 diff로 표시한다.

종료 조건:

- 주요 편집 intent별 20개 fixture에서 selection target precision ≥98%.
- 사용자 확정 필드 변경 0.
- 무관 부품 재생성 비율 ≤5%.
- topology naming survival ≥95%, 실패 시 명시적 remap review.

### P4. 복잡 기계 제품 assembly generator

목표: 단일 body가 아닌 제조 가능한 definition/occurrence/subassembly 제품을 생성한다.

작업:

1. requirement graph → functional decomposition → product architecture를 필수 단계로 만든다.
2. interface-first로 shaft, bearing, fastener, seal, flange, gear, coupling을 배치한다.
3. standard/buy/make part를 구분하고 BOM identity를 유지한다.
4. body policy를 part별 single/multi-body로 판정한다.
5. native joint axis/origin/limit와 solver residual을 생성한다.
6. static collision, motion swept collision, minimum clearance를 분리한다.
7. robot, gearbox, pressure vessel, turbomachinery, factory equipment용 generator profile을 추가한다.
8. 제품 규모를 T1 단순, T2 중간, T3 복잡 계층으로 확대한다.

종료 조건:

- definition/occurrence/hierarchy/transform/interface 각 축 precision·recall ≥95%.
- destructive part merge 0.
- missing required interface가 pass로 승격되는 경우 0.
- T3에서 resume/repair 후 전체 초기화 비율 ≤5%.

### P5. native motion·collision·clearance 인증

목표: “보기에 움직임”이 아니라 실제 조립 운동과 간섭을 증명한다.

작업:

1. AP242 occurrence local shape와 world transform을 hash로 묶는다.
2. joint DoF/rank와 motion range를 계산한다.
3. broad phase → precise B-rep/triangle refinement → continuous TOI를 실행한다.
4. intended contact와 unintended collision을 interface ID로 구분한다.
5. clearance certificate에 최소 거리, 발생 frame, part pair, topology refs를 기록한다.
6. animation 0~N frames가 인증된 joint motion만 사용하도록 연결한다.

종료 조건:

- known clear/collision/first-contact golden에서 false clear 0.
- TOI bracket ≤1 frame 또는 명시된 시간 허용오차.
- 모든 motion occurrence의 transform evidence coverage ≥95%.

### P6. 건축·토목·조경·인테리어 분야별 authoritative pipeline

목표: 기계 assembly 방식을 그대로 강제하지 않고 분야 의미론에 맞는 hybrid 설계를 제공한다.

#### P6-A 건축

- building/storey/space/wall/slab/roof/opening/window/door/balcony/stair/corridor/curved envelope.
- 공간 폐합, 피난, 채광, 서비스 opening, IFC spatial containment.
- 곡선 건축물은 NURBS/analytic surface와 IFC tessellation을 구분한다.

#### P6-B 인테리어

- 방 배치, 가구 component, 조명/IES/Radiance, 문 스윙, 동선, MEP 간섭.
- 사용자가 방·가구·조명을 이동하면 인접 조건과 검증만 국소 갱신한다.

#### P6-C 토목

- alignment, profile, corridor, terrain, drainage/network, structure, LandXML/IFC.
- station/offset/elevation 좌표계를 보존한다.

#### P6-D 조경

- terrain, grading, path, planting zone, drainage, retaining/edge, quantity.
- 식재 객체와 토공/배수 geometry를 다른 정확도 등급으로 관리한다.

종료 조건:

- 분야별 20개 승인 holdout.
- spatial topology, dimension, semantic identity, code/analysis applicable axis 각각 ≥95%.
- IFC roundtrip에서 storey/space/opening/containment 손실 0.

### P7. 제조 문서·PMI·재료/공정 확정

목표: geometry pass와 제조 release를 분리한 채 실제 현장 전달 수준으로 확장한다.

작업:

1. 사용자 확정 material/process assignment UI/API.
2. 승인된 family policy는 명시적 opt-in으로만 적용한다.
3. tolerance/GD&T/fit, surface finish, datum, weld/sheet-metal 정보를 part certificate와 연결한다.
4. 도면 view, section, BOM, balloon, part sheet, assembly instruction을 생성한다.
5. PMI target face/topology reference와 STEP roundtrip을 검증한다.

종료 조건:

- silent material/process default 0.
- unresolved required manufacturing field가 있으면 releaseReady=false.
- PMI target binding과 주요 치수 roundtrip ≥95%.

### P8. reference corpus 승인과 ground truth 완성

목표: 측정 가능한 120개 독립 제품 holdout을 만든다.

작업:

1. 독립 turbomachinery 후보 5개를 추가한다.
2. 115개 기존 case와 신규 5개의 provenance/license/lineage를 승인한다.
3. native extractor별 SolidWorks/Inventor/CATIA/Creo/Parasolid 작업을 실행한다.
4. 원본 mate가 없는 exchange 파일은 AI 추정 joint와 ground truth joint를 구분한다.
5. assertion별 expected value, tolerance, evidence hash, reviewer를 확정한다.
6. train/example/tuning과 제품 단위로 격리한다.

종료 조건:

- 6 families × 20 approved cases.
- approved assertion에 source/evidence/tolerance/reviewer 누락 0.
- lineage leakage 0.
- 필수 axis의 ground-truth `not_run`을 KPI 시작 기준 이하로 감소.

### P9. 실제 1,800-run 정확도 campaign

목표: 일반화 정확도와 coverage를 실제 AI 생성으로 측정하고 개선한다.

실행 단위:

- 6 제품군 × 20 holdout × 5 repeat × 3 campaign = 1,800 runs.
- 각 run은 model/provider/prompt version/seed/source hash/checkpoint/artifact hash를 기록한다.
- transport retry와 geometry repair를 별도 계수한다.

측정 축:

1. intent/requirement satisfaction.
2. part geometry/topology/dimensions/features.
3. definition/occurrence/hierarchy/transforms.
4. interface/joint axis/origin/limit.
5. collision/clearance/motion.
6. STEP/IFC roundtrip과 semantic identity.
7. editable history/topology naming.
8. Web/API/CLI/MCP parity.

계산:

- `accuracy = pass / executed`
- `coverage = executed / eligible`
- family, Tier, axis, provider, repeat stability를 각각 분리한다.
- `not_run`은 accuracy 분모를 조작하는 데 사용하지 않고 coverage에 반영한다.

최종 종료 조건:

- 각 필수 axis accuracy ≥95%, coverage ≥95%.
- 각 제품군과 각 Tier도 각각 accuracy·coverage ≥95%.
- falseVerified=0, falseClear=0, destructivePartMerge=0.
- 전체 campaign 3회 연속 통과.
- 같은 시점의 Web/API/CLI/MCP parity 통과.

### P10. 운영 안정화와 상용 배포 gate

목표: 정확도 결과가 운영 환경에서도 재현되게 한다.

작업:

1. provider/model/OpenSCAD/OCCT/FreeCAD readiness와 latency dashboard.
2. job queue, timeout, retry budget, resume, idempotency.
3. artifact storage lifecycle과 개인정보/경로 비노출.
4. schema migration과 backward compatibility.
5. 비용·latency·memory·failure code Pareto.
6. canary → staged rollout → rollback rehearsal.

종료 조건:

- 배포 smoke와 campaign artifact hash 재현.
- 장애 시 작업 손실 없이 checkpoint resume.
- 보안/경로/credential 노출 0.
- CAD 생성 흐름에서 quote/RFQ 생성 0.

## 7. 우선 실행 묶음

다음 작업은 아래 순서로 진행한다.

### 묶음 1 — P0/P1 안정화

1. 현재 작업 manifest와 재생성 runner 작성.
2. OpenSCAD native 경로 복구.
3. 수리본 STL 12/12 재검증.
4. 배포 AI provider/streaming smoke.
5. 실제 사이트 shape-chat E2E와 오류 로그 영속화.

### 묶음 2 — P2 parity

1. latest generation/certificate response schema 동결.
2. API adapter 연결.
3. CLI/MCP mapping 연결.
4. Web client session 연결.
5. 동일 fixture hash parity test.

### 묶음 3 — P3/P5 편집·모션

1. face/edge/part selection reference 통합.
2. 국소 feature edit와 occurrence transform 분리.
3. datum remap과 joint 재검증.
4. precise collision/clearance certificate 연결.
5. 검증된 0~N frame animation/HTML export.

### 묶음 4 — P4 복잡 제품

1. gear train 교정 경로를 일반 interface-first generator로 승격.
2. bearing/fastener/seal/coupling standard component library.
3. robot/gearbox/pressure-vessel/turbomachinery/factory profiles.
4. T1→T3 실제 baseline.

### 묶음 5 — P6 분야별 pipeline

건축 → 인테리어 → 토목 → 조경 순으로 authoritative artifact와 검증 gate를 연결하고, 공장 설비 프로젝트에서 기계+건축+MEP hybrid를 검증한다.

### 묶음 6 — P8/P9 95% 증명

120 holdout 승인 → 최초 baseline → 오류 Pareto → 원인군별 수정 → 전체 재실행 → 3회 연속 campaign 순으로 진행한다.

## 8. 각 작업 묶음의 공통 완료 절차

모든 묶음은 다음 순서를 생략하지 않는다.

1. 입력·요구사항·허용 mutation scope 고정.
2. unit/negative/contract test 작성.
3. 구현.
4. lint와 전체 typecheck.
5. 실제 native artifact 실행.
6. fail/not_run 원인 감사.
7. deterministic repair 또는 명시적 보류.
8. 동일 입력 재실행과 hash 비교.
9. Web/API/CLI/MCP 적용 가능 표면 parity.
10. evidence JSON과 MD 갱신.

## 9. 즉시 추적할 위험

| 위험                           | 영향                       | 대응                                      |
| ------------------------------ | -------------------------- | ----------------------------------------- |
| 대규모 dirty worktree          | 변경 손실·회귀 원인 불명   | P0 manifest/checkpoint 우선               |
| OpenSCAD native ENOENT         | STL cross-check coverage 0 | binary/path/BOSL2 health 복구             |
| 배포 AI 연결 미검증            | 사이트 AI 무응답 가능      | credential-safe production smoke          |
| 교정 예제 과적합               | 4/4를 일반화로 오판        | 독립 holdout 외 KPI 금지                  |
| reviewer 승인 0                | 95% 측정 불가              | P8 승인 workflow 최우선                   |
| turbomachinery 5개 부족        | 120-case campaign 차단     | 독립 후보 추가 확보                       |
| native joint ground truth 부족 | 조립 정확도 측정 불가      | proprietary extractor/manual review 분리  |
| 재료·공정 미확정               | 제조 release 불가          | 사용자 확정 workflow, silent default 금지 |
| 분야별 의미론 혼용             | 건축/토목 정확도 저하      | 공통 orchestration+분야별 kernel 유지     |
| repair의 과도한 변경           | 사용자 의도·정상 부품 훼손 | mutation boundary, locked field, rollback |

## 10. 다음 상태 보고 형식

앞으로 “완료됐다”는 표현은 다음 네 수치를 함께 제시할 때만 사용한다.

```text
scope: 제품군 / Tier / assertion axis
accuracy: pass / executed
coverage: executed / eligible
stability: 동일 case 반복 통과율
release blockers: fail / not_run / unavailable 목록
evidence: immutable artifact path + SHA-256
```

4개 SCAD 교정 시나리오의 최신 범위에서는 구조/인터페이스 결과가 100%지만, 전체 서비스 범위에서는 아직 승인 holdout과 실제 campaign이 없어 일반화 accuracy/coverage는 **미측정**이다.

## 11. 관련 근거 문서

- `docs/strategy/scad-interface-joint-evidence-260806.md`
- `docs/strategy/post-scad-manufacturing-cad-execution-plan-260806.md`
- `docs/strategy/current-ai-complex-cad-audit-and-next-plan-260806.md`
- `docs/strategy/reference-derived-cad-accuracy-plan-260805.md`
- `docs/strategy/ai-complex-product-95-plan-260806.md`
- `docs/reference-corpus-integration.md`
- `docs/ai-manufacturing-gates.md`
- `docs/ai-manufacturing-sales-scope.md`

이 문서를 이후 통합 개발의 기준 문서로 사용하며, 각 묶음 종료 시 현황 표·근거 artifact·다음 우선순위를 갱신한다.

## 12. P0/P1 실행 갱신 — 2026-08-06

- 통합 기준선 감사 runner `scripts/audit-ai-cad-baseline.mjs`와 `npm run audit:ai-cad-baseline`을 추가했다.
- 최초 기준선은 34/34 검사를 통과했고 artifact-set SHA-256을 manifest로 영속화했다.
- Windows OpenSCAD Nightly 설치를 자동 탐지하도록 공통 executable resolver를 추가하고 STL/PNG/공통 CLI/health 경로에 연결했다.
- 저장소의 BOSL2 배포 ZIP을 격리된 로컬 검증 경로에서 사용해 수리본 4개 시나리오의 definition mesh evidence를 재생성했다.
- mesh scenario 4/4, analytic B-rep 12/12, STL bbox/volume cross-check 12/12, STEP roundtrip 12/12, native topology 12/12, part certificate 12/12를 통과했다.
- 최신 AP242 assembly는 4/4 pass, 12 definitions, 30 occurrences를 유지한다.
- 최신 interface campaign은 4 pass / 0 fail / 0 not_run이다.

최신 P0 기준선:

- `docs/evidence/integrated-ai-cad-baseline-260806/manifest.json`
- `docs/evidence/scad-definition-geometry-260806/run-5.json`
- `docs/evidence/scad-analytic-brep-260806/run-12.json`
- `docs/evidence/scad-native-step-assembly-260806/run-5.json`
- `docs/evidence/scad-interface-evidence-260806/run-6.json`

P1에서 남은 즉시 작업은 현재 배포 사이트의 AI provider·streaming·shape-chat E2E를 credential-safe 방식으로 검증하는 것이다.

### 배포 읽기 전용 smoke 결과

`scripts/smoke-ai-cad-deployment.mjs`와 `npm run smoke:ai-cad-deploy`를 추가했다. 이 runner는 credential이나 prompt 내용을 artifact에 저장하지 않고 status code, latency, 제한된 상태 필드만 기록한다.

- `https://nexyfab.com/api/health/live`: HTTP 200.
- `https://nexyfab.com/api/health/ready`: HTTP 200, database status ok.
- 최신 `/api/cad/v1/capabilities`: HTTP 404.
- `/api/health/openscad`: 관리자 인증이 없어 HTTP 401, 따라서 `not_run`.
- live 응답에 최신 코드가 제공하는 build tag가 없어 현재 운영 빌드 identity를 확인할 수 없다.
- 실제 AI SSE 호출은 application auth가 없어 실행하지 않았다.

증거는 `docs/evidence/deployment-ai-cad-smoke-260806/latest.json`에 있다. 현재 판정은 **서버/DB 생존, 최신 CAD v1 배포 불일치, AI provider 상태 미검증**이다. 다음 조치는 최신 빌드를 배포한 뒤 build tag와 capabilities를 확인하고, 안전한 smoke 전용 계정으로 SSE `done/error`와 provider telemetry를 검증하는 것이다.

## 13. P2 canonical parity 착수 — 2026-08-06

- generation finalization 결과의 cross-surface subset을 `nexyfab.generation-canonical-response.v1`으로 고정했다.
- canonical response는 run ID/revision, pass·fail·not_run·blocked, stopped stage, release readiness, 정렬된 error codes, unresolved count, affected parts, verified artifact hashes, last checkpoint만 포함한다.
- timestamp, 전체 STEP/source evidence, 로컬 경로는 parity hash에서 제외한다.
- canonical subset은 SHA-256 `contractHash`를 가지며 key/order 차이에도 동일한 hash를 생성한다.
- generation finalize API가 모든 정상 finalization 응답에 canonical response를 포함한다.
- CLI `generation finalize`와 MCP `finalize_ai_generation`은 별도 판정 없이 같은 API 응답을 전달하므로 동일 canonical contract/hash를 받는다.
- 관련 canonical/finalize/CLI/MCP 테스트는 4 files, 72 tests를 통과했고 전체 typecheck도 통과했다.

Web generation session도 canonical contract를 별도 session key에 저장하고 `nexyfab:generation-canonical` 이벤트로 전달한다. canonical schema 또는 64자리 hash가 없으면 finalization 성공으로 처리하지 않는다. API route, Web client, CLI, MCP 관련 검증은 5 files, 74 tests를 통과했고 전체 typecheck도 통과했다.

로컬 P2 계약 연결은 완료됐다. 남은 P2 검증은 최신 빌드가 배포된 뒤 실제 HTTP/SSE 환경에서 동일 fixture의 `contractHash`를 네 표면으로 비교하는 운영 end-to-end parity다.

## 14. P3 선택 기반 편집 경계 및 국소 무효화 — 2026-08-06

- CAD 편집 연산을 `definition_geometry`, `occurrence_transform`, `assembly_constraint`, `product_structure` 네 mutation scope로 분류했다.
- 하나의 transaction에서 서로 다른 scope를 섞거나, 선택하지 않은 부품을 수정하거나, affected part 밖을 변경하는 요청은 fail-closed 한다.
- 부품 배치 이동은 명시적인 `part` occurrence 선택만 허용한다. 면·모서리를 선택한 이동 요청은 definition 형상 편집과 혼동하지 않고 거부한다.
- 축·기준면 기반 feature 편집은 planner가 확정한 feature provenance를 SelectionContext에 기록해 정상적인 hole/depth 편집을 유지한다.
- 여러 자연어 명령을 묶은 batch도 최종 transaction을 다시 평가하므로 형상 수정과 occurrence 이동이 한 번에 섞여 우회되지 않는다.
- 편집 preview에 deterministic impact plan을 포함한다. definition 형상 편집은 kernel/topology부터, occurrence 이동과 mate 편집은 assembly solve부터 재검증하며 기존 definition geometry는 보존한다.
- stale revision, topology confirmation, exact B-rep 편집 증거를 포함한 관련 회귀는 5 files / 42 tests를 통과했고 ESLint와 전체 TypeScript typecheck도 통과했다.

아직 P3 전체 완료로 판정하지 않는다. 다음 작업은 편집 전후 persistent topology remap 생존율 evidence, interface datum 재결합, 영향받은 feature/downstream subassembly만 실제 재생성하는 runner, intent별 20개 fixture campaign이다.

### P3 topology survival evidence 1차

- `nexyfab.topology-survival-evidence.v1` 계약을 추가해 persistent, derived, ambiguous, broken을 별도 집계한다.
- 표본이 기본 20개보다 적으면 성공률과 무관하게 `not_run`, 95%보다 낮으면 `failed`로 판정한다.
- derived는 생존 참조로 집계하되 반드시 확인이 필요한 상태로 남기며 ambiguous/broken은 성공으로 집계하지 않는다.
- 누락된 critical reference도 broken으로 포함해 분모에서 제거하지 않는다.
- 20개 rectangular-extrude depth-edit fixture, 총 360개 face/edge reference의 1차 campaign은 360/360 persistent, survival rate 100%, `passed`다.
- 증거는 `docs/evidence/topology-survival-260806/run-1.json`에 영속화했다.

이 결과의 범위는 사각 extrude의 depth 변경뿐이다. Boolean split/merge, fillet/chamfer, hole, revolve, pattern, multi-body 및 assembly interface datum을 포함하지 않으므로 일반 topology survival 95% 달성으로 해석하지 않는다. 다음 campaign에서 이 변형군을 각각 최소 20 fixture로 확장한다.

### P3 topology survival evidence 2차

- analytic revolve provenance topology를 공통 snapshot/remap 계약에 연결했다.
- full-revolve의 radius/height profile 변경 20 fixture를 추가했다.
- 현재 campaign은 extrude depth 20개와 revolve profile 20개, 총 40 fixture·480 topology reference다.
- aggregate는 persistent 480/480, ambiguous 0, broken 0으로 제한 범위에서 100%다.
- 기존 real-kernel revolve topology 회귀도 함께 실행했으며 partial→partial 540/540, full→full 138/138이 생존했다. partial↔full 전환에서 topology 의미가 달라지는 47개 참조는 잘못 매핑하지 않고 명시적으로 손실 처리되는 기존 fail-closed 동작을 유지한다.
- Boolean split/merge, hole, fillet/chamfer, pattern은 extractor 미연결 상태를 family별 `not_run`으로 기록했다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-2.json`이다.

따라서 topology coverage는 extrude와 revolve까지 확대됐지만 전체 P3 완료는 아니다. 다음 우선순위는 Boolean kernel-history snapshot extractor와 interface datum 소비자 재결합이다.

### P3 topology survival evidence 3차

- `EdgeAnchorSource`의 resolvable Boolean edge namespace를 공통 topology snapshot으로 변환하는 extractor를 추가했다.
- operand feature ID로 한정된 inherited edge와 `Generated()` face key 기반 seam을 함께 추적한다.
- 치수 변경으로 anchor가 이동하고 kernel result edge 순서가 역전되는 Boolean fixture 20개를 추가했다.
- Boolean family는 80/80 persistent, ambiguous 0, broken 0으로 `passed`다.
- 전체 campaign은 extrude 20 + revolve 20 + Boolean 20 = 60 fixture, 560 reference이며 제한 범위 aggregate는 560/560이다.
- composed Boolean fail-closed 회귀를 포함한 관련 테스트 24/24, ESLint, 전체 typecheck를 통과했다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-3.json`이다.

hole, fillet/chamfer, pattern은 계속 family별 `not_run`이다. 다음 작업은 이 세 extractor를 순서대로 연결하고, 그 뒤 assembly joint/interface datum 소비자를 remap 결과에 재결합하는 것이다.

### P3 topology survival evidence 4차

- hole intent에 `f.bore`, `e.entry`, blind `f.bottom/e.bottom`, through `e.exit`의 stable generative provenance를 추가했다.
- counterbore와 countersink도 별도 semantic face/edge ID를 갖는다.
- 직경·깊이·중심 위치가 함께 변경되는 blind-hole 20 fixture, 80 reference가 80/80 persistent로 통과했다.
- blind→through topology 전환 negative control은 사라진 bottom face/edge 2개를 broken으로 처리해 survival 50%, `failed`가 된다. 사라진 참조를 exit rim으로 자동 재해석하지 않는다.
- 전체 campaign은 80 fixture·640 reference, 제한 범위 640/640이다.
- 이 hole 결과의 method는 `generative_intent`다. OCCT Boolean 이후 실제 result face extractor는 별도 `native_result_faces: not_run`으로 유지한다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-4.json`이다.

다음 작업은 hole native result-face history를 연결하거나, 먼저 fillet/chamfer의 post-operation topology extractor를 연결하는 것이다. 정확도 주장의 우선순위상 native hole evidence를 먼저 처리한다.

### P3 topology survival evidence 5차

- OCCT bridge의 read-only `listFaceRefs()`를 실제 through-hole Boolean 결과에 연결했다.
- base와 32-segment cylindrical tool의 크기·깊이·중심을 변경하고 kernel result edge/face enumeration이 달라지는 조건으로 20 fixture를 재생성했다.
- `propagateBooleanFaceNames()`의 IsSame/Modified history로 전파된 native result-face namespace 120개가 120/120 persistent로 생존했다.
- 같은 namespace를 downstream fillet이 실제 해석하는 node OCCT 회귀를 포함해 59 passed / 1 skipped를 확인했다.
- hole은 이제 generative intent 80/80과 native result faces 120/120을 별도 증거로 가진다.
- 전체 topology campaign은 100 fixture·760 reference, 제한 범위 760/760이다.
- campaign runner는 OCCT가 없으면 성공으로 대체하지 않고 native family를 `not_run`으로 기록한다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-5.json`이다.

다음 topology 우선순위는 fillet/chamfer post-operation history와 pattern occurrence-qualified namespace다. 이후 joint/interface datum 재결합으로 진행한다.

### P3 topology survival evidence 6차

- OCCT fillet/chamfer 결과 등록 시 기존 face history table이 유실되던 경계를 수정했다.
- MakeFillet/MakeChamfer의 IsSame/Modified history를 통해 살아남은 기존 face 이름만 결과 shape에 전파한다.
- 새 blend face에는 근거 없는 persistent 이름을 생성하지 않는다.
- fillet radius와 base 치수를 함께 변경하는 native 20 fixture에서 120/120 face reference가 생존했다.
- chamfer distance와 base 치수를 함께 변경하는 native 20 fixture에서도 120/120이 생존했다.
- 전체 topology campaign은 140 fixture·1,000 reference, 제한 범위 1,000/1,000이다.
- node OCCT 단독 회귀 36 passed / 1 skipped, campaign·ESLint·전체 typecheck를 통과했다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-6.json`이다.

남은 family `not_run`은 pattern occurrence-qualified topology다. 이를 완료한 뒤 face/edge remap을 joint/interface datum 소비자에 연결한다.

### P3 topology survival evidence 7차

- pattern topology를 `patternId/occurrence:index/seedTopologyRef` namespace로 고정했다.
- occurrence index는 spacing, direction, circular sweep 변경과 독립적인 identity다.
- linear spacing·direction 변경 10 fixture와 circular sweep 변경 10 fixture에서 1,800/1,800 reference가 persistent로 생존했다.
- count 감소 negative control은 제거된 occurrence를 다른 index로 이동시키지 않고 broken 처리한다.
- upstream seed feature 변경은 기존 downstream regeneration 계약을 통해 pattern 전체에 전파되며 관련 회귀를 함께 통과했다.
- 전체 topology campaign은 160 fixture·2,800 reference, 제한 범위 2,800/2,800이다.
- pattern 결과는 `generative_occurrence_namespace` 방법이다. 별도 native B-rep occurrence 생성은 아직 `not_run`이다.
- 관련 pattern/topology/downstream 테스트 30/30, campaign·ESLint·전체 typecheck를 통과했다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-7.json`이다.

이제 P3 topology family의 generative namespace는 모두 연결됐다. 다음 핵심은 remap 결과를 joint/interface datum, mate, PMI/GD&T 소비자에 재결합하고 broken/ambiguous 참조가 assembly solve로 넘어가지 못하게 하는 것이다.

### P3 topology consumer rebind 1차

- 기존 mate·dimension·GD&T·PMI propagation에 product interface datum을 추가했다.
- interface datum은 `occurrenceId:datumRef` scoped remap을 우선 사용해 다른 occurrence의 동일 local ref와 혼동하지 않는다.
- persistent/derived 참조만 새 ID로 재결합한다. derived 소비자는 `confirmationRequiredIds`에 기록한다.
- ambiguous/broken mate는 suppressed되고 blocking mate로 기록된다.
- ambiguous/broken interface는 active architecture에서 분리되어 review queue로 이동한다.
- blocking mate 또는 interface가 하나라도 있으면 `assemblySolveReady=false`다.
- `runTopologySafeAssemblySolve()`가 이 gate를 강제하며 차단 상태에서는 solver callback을 호출하지 않는다.
- 20개 calibrated fixture에서 safe mate/interface datum 재결합 20/20, safe solver call 20회, broken/ambiguous negative-control solver call 0회를 확인했다.
- 관련 propagation/solver 테스트 11/11, ESLint, 전체 typecheck를 통과했다.
- 증거는 `docs/evidence/topology-consumer-rebind-260806/run-1.json`이다.

다음은 이 계약을 generation checkpoint의 assembly_solve 진입점과 product assembly certificate에 직접 연결하고, derived 확인 미완료 상태도 release gate에서 차단하는 작업이다.

### P3 generation/certificate topology gate

- `advanceGenerationRun()`의 topology 다음, assembly verifier 이전에 topology rebind gate를 연결했다.
- blocking mate/interface가 있으면 `ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED`로 assembly_solve checkpoint가 실패한다.
- derived reference가 confirmation required 목록에 있고 confirmed 목록에 없으면 `ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED`로 실패한다.
- 이 차단은 verifier 호출 전에 일어나므로 부분 mate만 남긴 조립 solve가 정상 결과로 기록되지 않는다.
- 모든 derived ID가 확인되고 blocking 참조가 없을 때만 기존 precise assembly verifier가 실행된다.
- product assembly certificate에 `topology_rebind` gate를 추가했다.
- topology review 또는 미확인 derived가 있으면 다른 part/transform/joint gate가 통과해도 certificate status는 `fail`, `releaseReady=false`다.
- 신규 생성처럼 rebind 자체가 필요 없는 흐름은 evidence 미제공을 `not applicable/pass`로 처리해 기존 정상 경로를 유지한다.
- checkpoint·certificate·propagation 관련 테스트 18/18, ESLint, 전체 typecheck를 통과했다.

다음 작업은 이 gate 결과를 Web/API/CLI/MCP canonical response의 error code·unresolved·affected part에 노출하고 네 표면 parity fixture를 추가하는 것이다.

### P3 topology canonical parity

- `generation/advance`가 최종화 이전 `assembly_solve` 차단도 canonical 응답으로 만든다. 따라서 토폴로지 검토가 필요한 실행은 finalization까지 억지로 진행하지 않는다.
- canonical 계약은 정렬된 오류 코드, 전체 unresolved 수, stage별 unresolved 수, affected part ID와 검증된 part artifact를 포함한다.
- 사람이 작성한 unresolved 원문은 계약 해시에서 제외하고 stage별 개수만 넣어, 민감하거나 비결정적인 문구가 표면 간 parity를 깨지 않게 했다.
- Web은 advance와 finalize에서 같은 canonical 검증·저장 경로를 사용한다. 유효한 v1 schema와 64자리 contract hash가 없으면 성공으로 취급하지 않는다.
- API는 canonical 객체를 생성하고 CLI와 MCP는 이를 재판정하거나 평탄화하지 않고 그대로 전달한다. CLI `--strict`는 차단된 `assembly_solve`를 실패 종료 코드로 유지한다.
- topology review와 derived confirmation 미완료는 각각 `ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED`, `ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED`로 노출된다.
- API·Web·CLI·MCP 집중 회귀 77/77, ESLint, 전체 TypeScript typecheck를 통과했다.

이 결과는 네 실행 표면의 로컬 계약 parity를 증명한다. 아직 일반 복잡 제품 95% 정확도를 뜻하지 않으며, 배포 환경의 실제 AI 공급자 연결은 자격 증명을 노출하지 않는 production smoke로 별도 확인해야 한다. 다음 정확도 우선순위는 native pattern B-rep occurrence, multi-body/part boundary, 실제 제품군 holdout campaign이다.

### P3 native pattern B-rep occurrence

- 기존 `generative_occurrence_namespace` 검사와 별도로 linear·circular pattern의 각 occurrence를 독립 OCCT solid로 실제 생성한다.
- occurrence는 fuse하지 않으며 `patternId/occurrence:index/nativeFaceRef`로 한정한다. 따라서 동일 definition에서 나온 복사본이더라도 assembly occurrence 경계를 잃지 않는다.
- linear pattern은 X→Y 방향과 spacing을 함께 변경하고, circular pattern은 360°→270° sweep으로 변경한다.
- circular occurrence는 위치만 옮기는 것이 아니라 seed loop 전체를 Z축 기준으로 회전해 occurrence 좌표계와 형상 방향을 함께 복원한다.
- 모든 native shape는 face reference를 추출한 직후 명시적으로 release한다.
- native pattern 20 fixture·600 face reference가 600/600 persistent, ambiguous 0, broken 0으로 통과했다.
- 전체 topology campaign은 180 fixture·3,400 reference, 제한 범위 생존율 100%다.
- 최신 증거는 `docs/evidence/topology-survival-260806/run-8.json`이다.

이 수치는 native pattern의 제한된 calibrated fixture 결과이며 일반 제품 정확도 95% 주장이 아니다. 다음 작업은 definition/occurrence와 별개인 multi-body/part 경계를 native STEP roundtrip 전후로 보존하고, body가 잘못 fuse되거나 part로 잘못 승격되는 경우를 fail-closed 처리하는 것이다.

### P3 multi-body intent gate 1차

- 기존 아키텍처의 definition별 `single_body | multi_body`와 `expectedBodies` 계약을 제조 G4 topology gate와 STEP roundtrip comparator에 연결했다.
- body intent가 없으면 이전과 동일하게 정확히 1 solid를 요구하므로 기존 단일 부품 흐름은 바뀌지 않는다.
- `multi_body`이며 예상 수가 정해진 경우 export 전후 모두 그 수와 일치해야 한다. 예상 수가 미정이면 최소 2개 solid를 요구한다.
- before/after solid 수가 같더라도 body intent와 다르면 실패한다. 따라서 3-body 부품이 1-body로 fuse된 결과는 통과하지 않는다.
- 제조 G4와 roundtrip G8이 동일한 `PartFinalizationEvidence.bodyIntent`를 사용하므로 한 gate는 통과하고 다른 gate는 정책 차이로 실패하는 불일치를 제거했다.
- multi-body 내부 body는 계속 같은 part definition의 구성 body다. 별도의 승인된 제품 분해 계약 없이 body를 part definition이나 assembly occurrence로 자동 승격하지 않는다.
- 정상 3-body 보존, 3→1 destructive fuse, 기본 single-body 정책의 2-body 거부를 포함한 집중 회귀 21/21, ESLint, 전체 TypeScript typecheck를 통과했다.

아직 남은 것은 실제 native STEP 파일에서 body membership과 product definition/occurrence hierarchy를 함께 재수집하여 “body 수 보존”뿐 아니라 “어느 definition에 속한 body인가”까지 인증하는 것이다.

### P3 native STEP body membership 2차

- STEP assembly importer가 내부에서만 사용하던 `PRODUCT_DEFINITION → MANIFOLD_SOLID_BREP/BREP_WITH_VOIDS` 매핑을 `productStructure` 증거로 반환한다.
- 각 definition에는 native body entity ID와 body 수가 기록되고, 각 occurrence에는 참조하는 definition ID가 기록된다.
- 반복 occurrence는 같은 definition body inventory를 참조한다. 두 bolt occurrence를 두 bolt body definition으로 중복 계산하지 않는다.
- `STEP body membership` 인증 gate가 아키텍처의 part definition, body intent, definition별 occurrence 수를 import 결과와 비교한다.
- destructive fuse, body 누락, occurrence 누락, 예상하지 않은 part definition 생성은 각각 별도 오류 코드로 release를 차단한다.
- native PD ID와 설계 definition ID는 제품 이름이 양쪽에서 각각 유일할 때만 정규화한다. 중복 이름이나 매칭 실패를 임의 추정하지 않고 `unmapped:pd_*`로 남겨 fail-closed 처리한다.
- 제품 조립 인증서에 `step_body_membership` gate를 추가했다. authoritative native evidence가 없으면 `not_run`이며 pass로 승격하지 않는다.
- importer·membership·product certificate 집중 회귀 33 passed / 실물 선택 코퍼스 2 skipped, ESLint, 전체 TypeScript typecheck를 통과했다.

다음 단계는 생성된 native STEP assembly 파일을 실제 재가져와 이 evidence를 자동 생성하는 campaign이다. 현재는 importer와 인증 계약이 연결됐지만 기존 SCAD assembly artifact에는 새 membership evidence가 아직 없으므로 재생성 전까지 이 새 gate는 정직하게 `not_run`이다.

### P3 native STEP body membership campaign 1차

- 기존 4개 SCAD assembly의 실제 native STEP 파일을 `importStepAssembly()`로 재가져오고 원본 architecture와 자동 비교하는 재생 가능한 campaign을 추가했다.
- `sc7_gear_train`은 5 definition·5 occurrence·5 body, `sc8_pipe_joint`는 3·3·3을 보존했다.
- `sc9_simple_car`은 3 definition·6 occurrence·3 body를 보존했다. 반복 wheel occurrence가 body definition을 복제하지 않았다.
- `sc10_brackets_grid`는 1 definition·16 occurrence·1 body를 보존했다. 16개 bracket 배치가 16개 body definition으로 잘못 승격되지 않았다.
- 결과는 4 pass, 0 fail, 0 not_run이다.
- 재생 명령은 `npm run evidence:step-body-membership`, 영속 증거는 `docs/evidence/step-body-membership-260806/run-1.json`이다.

기존 artifact의 membership gate를 더 이상 추정으로 소급 통과시키지 않아도 된다. 다만 이 native campaign의 각 part definition은 현재 단일 body다. 하나의 part definition 안에 실제 native body가 2개 이상 들어 있는 positive fixture는 아직 없으며, multi-body 판정은 현재 정책 회귀와 destructive negative control까지만 통과했다. 다음 작업은 실제 2~4 body part STEP positive fixture와 hierarchy/transform 동시 인증이다.

### P3 STEP hierarchy·coordinate recovery

- `productStructure.relationships`가 각 NAUO의 parent definition, child definition, designator와 4×4 local-to-parent 행렬을 보존한다.
- 각 leaf occurrence는 root부터 leaf까지의 `definitionPath`와 합성된 4×4 world matrix를 함께 반환한다.
- flat STEP에는 definition당 identity world matrix를 명시적으로 기록해 좌표계가 없는 것과 identity인 것을 구분한다.
- body-membership campaign은 관계 수가 원본 physical occurrence 수와 같은지, 모든 local/world 행렬이 16개 유한 수인지 필수 gate로 검사한다.
- 기존 4개 native STEP assembly가 hierarchy relationship 수와 occurrence world transform을 모두 완전하게 복원했고 4 pass, 0 fail, 0 not_run을 유지했다.

현재 SCAD calibration assembly는 root→part의 한 단계 구조다. 다음 hierarchy 정확도 단계는 subassembly가 중첩된 3단 이상 native STEP과 회전·이동이 동시에 있는 occurrence를 positive fixture로 추가하는 것이다.

### P3 native multi-body positive fixture

- STEP assembly writer에 `multi_body` part를 추가했다. 여러 analytic box solid를 하나의 `PRODUCT_DEFINITION_SHAPE/ADVANCED_BREP_SHAPE_REPRESENTATION`에 기록한다.
- body마다 `MANIFOLD_SOLID_BREP`은 별개지만 PRODUCT, part definition과 occurrence는 하나다.
- 3-body frame/weldment fixture를 실제 STEP으로 export하고 다시 import했다.
- 결과는 `3 bodies → 1 part definition → 1 occurrence`이며 body를 part로 승격하거나 서로 fuse하지 않았다.
- 4개 기존 assembly에 이 positive fixture를 더해 membership campaign은 5 pass, 0 fail, 0 not_run이다.
- fixture는 `docs/evidence/step-body-membership-260806/fixtures/native-multibody-weldment.step`에 영속화했다.

이제 실제 native multi-body positive path도 기준선에 포함된다. 다음 남은 구조 정확도 작업은 3단 이상 subassembly와 회전·이동 동시 좌표 복원이다.

### P3 three-level hierarchy positive fixture

- 유효한 native STEP leaf geometry에 root product와 중간 subassembly container를 구성했다.
- root→subassembly와 subassembly→leaf에 각각 표준 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`, `ITEM_DEFINED_TRANSFORMATION`, `CONTEXT_DEPENDENT_SHAPE_REPRESENTATION` 체인을 연결했다.
- 두 local transform 모두 Z축 90° 회전을 포함한다. 첫 관계는 X 100mm, 두 번째 관계는 local Y 20mm 이동이다.
- 합성 결과는 definition path depth 3, 관계 2개, world translation `(80, 0, 0)`, world rotation Z 180°다.
- campaign은 행렬 존재만 확인하지 않고 translation과 rotation diagonal을 `1e-8` 허용오차로 직접 검증한다.
- fixture는 `docs/evidence/step-body-membership-260806/fixtures/native-three-level-hierarchy.step`에 영속화했다.
- 전체 membership/hierarchy campaign은 6 pass, 0 fail, 0 not_run이다.

다음 구조 정확도 확장은 한 subassembly에 여러 leaf와 다시 중첩된 분기를 갖는 4단 이상 hierarchy, 같은 definition을 서로 다른 subassembly에서 재사용하는 occurrence path 분리다.

### P3 four-level branching definition reuse

- `root → level1 → branch A/B → shared leaf`의 4단 native STEP fixture를 추가했다.
- branch A와 B는 같은 leaf `PRODUCT_DEFINITION`을 참조하며 별개의 leaf definition/body를 만들지 않는다.
- 5개 NAUO 관계와 5개 local transform을 모두 복원한다.
- 두 leaf occurrence의 definition path는 각각 깊이 4이고 definition ID는 동일하지만 occurrence ID와 world matrix는 독립적이다.
- branch A world translation은 `(10,25,0)`, branch B는 `(15,-20,0)`이며 각각 `1e-8` 허용오차로 직접 검사한다.
- 결과는 `1 leaf definition → 2 occurrences → 2 independent paths`다.
- fixture는 `docs/evidence/step-body-membership-260806/fixtures/native-four-level-branching-reuse.step`에 영속화했다.
- 전체 membership/hierarchy campaign은 7 pass, 0 fail, 0 not_run이다.

결정론적 native fixture 기준으로 multi-body, 3단 transform 합성, 4단 branching definition reuse까지 연결됐다. 다음 단계는 이 구조 gate를 실제 외부 복잡 STEP holdout에 적용하고 제품군별 coverage를 측정하는 것이다.

### External complex STEP structure coverage 1차

- 기존 FreeCAD native extraction 결과 35건을 원본 수정 없이 read-only로 재검증했다. source bytes는 새 artifact에 복사하지 않는다.
- definition 참조, parent occurrence 참조, root 존재, hierarchy cycle, 16요소 유한 local transform을 case별로 검사했다.
- 실행된 35건은 구조 계약 35 pass, 0 fail이다. 그러나 선택 후보 115건 대비 execution coverage는 30.43%다.
- 제품군별 실행 coverage는 robot 7/20, gearbox 4/20, pressure vessel 12/20, turbomachinery 11/15, factory equipment 0/20, interior 1/20이다.
- 실행된 case 안에서의 구조 통과율 100%는 전체 정확도 100%가 아니다. 미실행 80건은 분모에서 제외하지 않고 coverage 부족으로 유지한다.
- 외부 35건은 body membership과 joint semantics가 모두 `not_run`이다.
- `groundTruthApprovedCases=0`, `scoreEligible=false`이므로 이 보고서를 95% 정확도 KPI 근거로 사용하지 않는다.
- 영속 증거는 `docs/evidence/external-step-structure-coverage-260806/run-1.json`, 재생 명령은 `npm run evidence:external-step-structure`다.

다음 실행 우선순위는 factory equipment 20건과 interior 19건의 native extraction을 먼저 채우고, 그 뒤 gearbox·robot 부족분을 채우는 것이다. 동시에 body membership과 joint semantics extractor를 추가해야 coverage가 단순 hierarchy 축을 넘어 제품 조립 정확도로 확장된다.

### 외부 native body membership v2

- FreeCAD 1.1.3으로 v1 원본을 덮어쓰지 않고 재추출했다. v2 extractor는 datum 축·평면을 제외하고 solid가 있는 객체 및 이를 포함하는 assembly group만 유지한다.
- 재실행 결과는 기존과 동일하게 35/115건 완료, capability skip 80건, 실행 실패 0건이다.
- 추출된 part definition 8,655개 전부에 extractor 소유의 `Shape.Solids` 증거가 있다. 실행된 case 기준 body membership은 35 pass, 0 fail, 0 not_run이다.
- 구조는 계속 35 pass, 0 fail이다. 하지만 전체 실행 coverage는 30.43%, joint는 35 not_run, reviewer 승인 ground truth는 0이므로 95% 정확도 근거가 아니다.
- 영속 증거는 `docs/evidence/external-step-structure-coverage-260806/run-2.json`, 후속 작업 큐는 `docs/evidence/external-step-structure-coverage-260806/remediation-run-1.json`이다.
- 미실행 80건은 native CAD 자동화 61건과 unsupported source triage 19건으로 분리했다. STEP geometry에서 joint를 추정하지 않으며 manual joint ground truth 34건은 별도 승인 흐름으로 유지한다.

### Native CAD preflight와 IFC coverage v3

- 115개 extraction request 전부에 `body_membership` required axis를 migration했다.
- 현재 Windows 환경의 SolidWorks, Inventor, Solid Edge, Creo, CATIA COM 등록과 licensed exchanger 설정을 자동 점검한다. 현재 ready executor는 0개이며 native CAD 대기 61건은 정확한 `not_run`이다.
- 미지원 interior ZIP 19건을 압축 해제·source 복사 없이 검사해 IFC 3건, Revit 5건, DWG/ODA 11건으로 전부 라우팅했다.
- IFC 3건은 프로젝트 IFC SPF parser로 실제 실행했다. 1,690개 product가 import됐지만 exact 0, approx 1,690이며 unsupported/skipped product가 161개라 body membership와 제조 형상 정확도로 승인하지 않는다.
- IFC 구조 증거를 병합한 v3 결과는 38/115 실행(33.04%), 구조 38 pass/0 fail, body membership 35 pass/3 not_run, joint 38 not_run이다. interior coverage는 4/20이다.
- 영속 증거는 `docs/evidence/external-step-structure-coverage-260806/run-3.json`, `native-cad-preflight-run-1.json`, `unsupported-archive-triage-run-1.json`이다.

### IFC faceted shell fidelity 개선

- `IFCCLOSEDSHELL → IFCFACEOUTERBOUND → IFCPOLYLOOP` 면 방향을 보존해 닫힌 faceted B-rep의 signed tetrahedral volume을 계산한다.
- 사면체 고정 fixture의 기대 부피 `1000/6 mm³`를 회귀 테스트로 검증한다. 열린 shell은 부피 solid로 승격하지 않는다.
- 외부 IFC 1,690개 product 중 exact mesh volume 증거는 1,560개, AABB-only는 130개다. exact-volume coverage는 92.31%다.
- 161개 skip은 전부 spatial/aggregate container이며 unsupported physical product는 0개다. 물리 product import coverage는 100%다.
- exact display geometry coverage는 아직 0%다. exact volume과 exact display를 혼동하지 않으며 releaseReady는 false다.
- AABB-only 130개는 전부 `IFCBUILDINGELEMENTPROXY`다. representation은 `IFCSHELLBASEDSURFACEMODEL` 118개와 `IFCMAPPEDITEM + IFCSHELLBASEDSURFACEMODEL` 12개로 확정했다.
- 영속 fidelity certificate는 `docs/evidence/external-step-structure-coverage-260806/ifc-fidelity-run-1.json`이다.

### IFC surface/mapped display mesh 복원

- 기존 assembly mesh 계약인 `params.verts/faces`로 IFC face loop를 직접 내보낸다. AABB는 더 이상 표시 형상 대체물이 아니라 경계 metadata로만 유지한다.
- `IfcMappedItem`은 `MappingTarget × inverse(MappingOrigin)`을 적용해 definition mesh를 occurrence 좌표계에 복원한다.
- 외부 IFC 1,690/1,690 product가 실제 display vertices/faces를 확보했고 AABB-only는 0개다. exact display geometry coverage는 100%다.
- 그중 open surface mesh는 614개다. 표시 mesh가 정확해도 닫힌 제조 solid가 아니므로 body/manufacturing gate는 통과시키지 않는다.
- exact volume은 1,560/1,690(92.31%)로 그대로이며 case별 closed-solid gate 때문에 전체 `releaseReady=false`다.

### IFC watertight topology 재검증

- IFC의 `IFCCLOSEDSHELL` 선언만 신뢰하지 않고 indexed face mesh의 undirected edge incidence, 공유 edge 방향, boundary, non-manifold, degenerate face를 직접 검사한다.
- 동일 좌표의 서로 다른 IFC point entity는 shell 내부 `1e-6 mm` 좌표 key로 welding한 뒤 검사한다.
- watertight, 방향 일관, boundary 0, non-manifold 0, degenerate 0을 동시에 만족할 때만 signed mesh volume을 exact로 승인한다.
- 이 엄격 gate로 기존 선언 기반 exact-volume 1,560개를 실제 topology 기반 722개로 교정했다. exact-volume coverage는 42.72%다.
- non-watertight mesh는 968개이며 boundary edge 197,936개, non-manifold edge 416개, degenerate face 6,039개다. 자동 승격된 open shell은 0개다.
- 통과율 하락은 회귀가 아니라 과장된 제조 solid 승인을 제거한 정확도 교정이다. 다음 repair 순서는 degenerate 제거 → boundary loop 분류 → 허용오차 내 loop sewing → 재검증 → 실패 시 rollback이다.

### IFC deterministic repair 1단계: degenerate face 제거

- 중복 vertex index, invalid index, 비유한 좌표, 면적 `1e-9` 이하 triangle만 제거 대상으로 제한한다.
- repair 이후 boundary edge와 non-manifold edge가 증가하지 않고 degenerate가 0일 때만 mutation을 채택한다. 조건을 만족하지 않으면 원본 faces를 유지한다.
- 외부 IFC에서 497개 part의 퇴화 face 6,039개를 제거했고 repair 후 degenerate face는 0개다.
- boundary edge 197,936개와 non-manifold edge 416개는 증가하지 않았다.
- watertight exact-volume은 722→723, non-watertight는 968→967로 1개 개선됐다. exact-volume coverage는 42.78%다.

### IFC boundary loop 분류와 sewing 경계

- boundary edge의 연결 성분을 폐루프, 열린 체인, 분기형으로 분류하고 폐루프의 평면성을 `0.01 mm` tolerance로 검사한다.
- 전체 boundary component는 29,851개이며 closed loop 29,213개, open chain 0개, branched component 638개다.
- planar closed loop는 26,540개지만 둘레가 `8 × 0.01 mm` 이하인 micro-gap candidate는 0개다.
- 총 boundary 길이는 21,254,852.0877 mm다. 이는 허용오차 수준의 작은 틈이 아니라 실제 개구·누락 표면·분리 shell이 주된 원인임을 뜻한다.
- 따라서 현재 corpus에는 자동 sewing/cap을 적용하지 않는다. 임의 cap은 창·문·개구 또는 의도된 surface를 제조 solid로 조작할 위험이 있다.
- 다음 단계는 정확한 surface collision mesh 사용과, source-authoritative 폐쇄 정보가 있는 경우에만 국소 cap repair를 허용하는 승인 계약이다.

### IFC indexed mesh precise collision 연결

- IFC `verts/faces`를 triangle SAT collision 계약에 연결했다. 실제 triangle 교차가 발견되면 open surface도 충돌을 확정한다.
- 교차가 발견되지 않은 open/non-watertight mesh는 containment를 증명할 수 없으므로 clearance/pass를 반환하지 않고 `not_run`을 유지한다.
- watertight mesh끼리는 surface intersection과 point-in-mesh containment를 모두 검사해 완전 판정한다. triangle pair budget 소진도 `not_run`이다.
- 기존 SAT의 coplanar triangle false positive를 수정했다. coplanar일 때 face normal 외에 `normal × edge` 평면 내 separating axis를 검사한다.
- IFC 1,690개 모두 collision confirmation eligible이며, 완전 collision/clearance eligible은 watertight 723개다. open 967개는 confirmation-only다.
- 영속 증거는 `docs/evidence/external-step-structure-coverage-260806/ifc-collision-capability-run-1.json`이다.
# 2026-08-06 DWG/Revit fallback 실행 점검

- ZIP 16건의 DWG를 실제 LibreDWG WASM importer로 실행했다. 기본 DWG route 11건과 Revit archive 내부 fallback-export 5건을 구분했다.
- 결과는 2D 도면 8건, 3D 폴리페이스 AABB 근사 8건, 실행 불가 0건이었다. 실다면체(`brep-polyhedron`)는 0건이다.
- `pass`는 파일 판독·분류 성공을 뜻할 뿐 제조 CAD 정확도 통과가 아니다. 이 증거는 `scoreEligible=false`, `releaseReady=false`이다.
- AABB 근사는 폴리페이스 정점 위치와 배치를 보존하지만 면 연결성, 정확 체적, 충돌/간극, body membership을 증명하지 않는다.
- Revit ZIP의 DWG는 export fallback이며 native Revit family/type/instance/constraint/parameter 복원으로 계산하지 않는다.
- 다음 정확도 경로는 (1) ODA/AutoCAD 또는 다른 face-index 접근 가능 extractor 연결, (2) Revit API가 설치된 worker에서 native 추출, (3) 동일 원본의 IFC/STEP 교차검증이다.
- 실행 증거: `docs/evidence/complex-holdout-review-260806/dwg-import-results.json`.
- 정확 복원 capability preflight는 AutoCAD COM, ODA File Converter command, Revit native worker를 각각 독립 확인한다. 현재는 0/3 ready이며 DWG 정확 복원 8건과 Revit native 5건이 `not_run` 대기열이다.
- 외부 worker는 환경변수 `NEXYFAB_ODA_FILE_CONVERTER_COMMAND`, `NEXYFAB_REVIT_WORKER_COMMAND`가 명시된 경우에만 ready가 된다. 단순히 Windows이거나 DWG fallback이 존재한다는 이유로 ready가 되지 않는다.
- 정확 worker queue 13건을 생성했다: DWG exact 8건, Revit native 5건. Revit 작업은 fallback DWG가 아니라 ZIP 내부 원본 `.rvt` member와 그 SHA-256에 결속된다.
- worker 결과는 archive hash와 member hash가 모두 일치해야 한다. `native-brep` 또는 watertight `indexed-closed-mesh`, 양의 체적, 유효 면/body 수, 강체 occurrence transform을 요구한다. Revit은 definition/occurrence 분리, hierarchy, parameters, constraints까지 모두 복원되어야 native 의미 통과다.
- AABB, 열린 mesh, source 교체, 빈 worker identity, 불완전한 Revit 의미는 자동으로 fail 처리된다.
- worker runner는 표준 `--request`, `--source`, `--output` 인자, 최대 10분 기본 timeout, 1GiB 입력/64MiB 결과 예산, shell 비사용 실행, 임시 원본 삭제를 적용한다. 현재 실행 결과는 요청 13, accepted 0, `not_run` 13, fail 0이다.
- worker 결과 구조를 assembly/part definition과 중첩 occurrence hierarchy로 확장했다. 따라서 하위 assembly, 재사용 definition, 다단 좌표계를 손실 없이 표현할 수 있다.
- native evidence 승격은 계약·정확 형상·native semantics가 모두 통과한 결과만 허용한다. DWG exact 형상은 native semantics가 없으므로 구조 점수로 자동 승격되지 않는다. closed mesh는 정확 표면/체적 증거로 사용할 수 있지만 native B-rep body membership으로는 계산하지 않는다.
- 현재 승격 결과는 0건이며 외부 worker가 연결되기 전 기존 38/115 native structure 수치는 변하지 않는다.

## 2026-08-07 reviewer-approved ground truth gate

- 115개 holdout case 전체에 대해 승인 queue를 생성했다. 현재 approved 0, pending 115, scoreEligible 0이다.
- 케이스 승인은 source hash, assertion별 artifact hash와 tolerance policy, 라이선스 검토, holdout 격리 검토를 모두 결속한다.
- domain reviewer와 independent reviewer의 서로 다른 신원이 필요하다. 독립 검토자는 assertion 원검토자와 같을 수 없다.
- 모든 required assertion이 승인되어야 하며 artifact가 바뀌면 artifact-set hash가 달라져 기존 승인은 무효가 된다.
- 자동 추출 pass는 검토 자료일 뿐 사람의 라이선스·정답 승인을 대체하지 않는다. 승인 전에는 95% accuracy/coverage 계산 분모에 들어가지 않는다.
- queue: `docs/evidence/complex-holdout-review-260806/ground-truth-approval-queue.json`.
- 승인 batch validator와 campaign corpus exporter를 추가했다. 중복 case, 미등록 case, hash/tolerance 불일치, 독립성 위반은 승인 corpus에 들어가지 않는다. 현재 records 0, approved corpus 0, pending 115이다.
- 첫 검토 wave는 제품군별 5개씩 총 30개로 선별했다. source hash 통과, 자동 증거 수, 남은 수동 검토량 순으로 정렬되지만 이 우선순위 자체는 승인을 부여하지 않는다.
- 초기 corpus 균형 점검에서는 turbomachinery 15건만 보였으나, IGES/Inventor/Revit archive member 탐색을 추가해 turbomachinery 독립 후보 20건을 확보했다.

## 2026-08-07 holdout lineage-v2 누수 재감사

- 기존 lineage 함수가 ZIP 파일명과 압축 해제 폴더 내부 CAD 파일명을 별도 lineage로 계산하는 문제를 발견했다. 동일 snapshot의 archive와 STEP/SLDASM 등을 서로 다른 holdout으로 사용하는 것은 데이터 누수이므로 수정했다.
- 가장 바깥쪽 `*.snapshot.N` 경로 세그먼트를 lineage root로 사용한다. 같은 snapshot 아래의 포맷 변환본과 부품 파일은 하나의 제품 lineage로 묶인다.
- 기존에 누락했던 IGES/IGS 직접 파일과 ZIP 내부 SLDPRT/IPT/CATPART/PRT/IGES/X_B도 3D 후보 탐색 대상으로 추가했다.
- 초기 lineage-v2 계산은 snapshot 폴더의 `.3` 등을 일반 확장자로 먼저 제거해 `-snapshot`이 남는 정규화 결함이 있었다. 아래 최종 엄격 재감사 수치로 대체한다.
- 증거: `docs/evidence/complex-holdout-lineage-v2-260807/summary.json`.

### lineage-v2 corpus 이관 결과

- 최종 엄격 기준은 88개 독립 제품이다. 기존 115-case ID/승인 상태는 재사용하지 않았고 lineage-v2 source hash에서 assertion graph를 다시 생성했다.
- 새 corpus는 88 cases, 862 required assertions이며 승인 assertion은 0이다.
- source hash preflight는 88/88 통과했고 fail은 0이다. 라이선스·ground truth 미승인 때문에 case 상태는 모두 `not_run`으로 유지된다.
- 자동 구조 증거는 part definitions 44/88, occurrences 28/88, hierarchy 28/88다. 자동 evidence는 승인으로 계산하지 않는다.
- native extraction 요청 88건, 승인 queue 88건, 첫 검토 wave 30건을 별도로 생성했다. 승인 validation은 pending 88, invalid 0, approved corpus 0이다.
- IGES는 STEP 문자열 검사로 대체하지 않고 directory entry의 entity 186(manifold solid B-rep), 308(subfigure definition), 408(instance), 124(transform)를 별도 측정한다.
- 새 corpus: `docs/evidence/complex-corpus-v2-lineage-v2-260807/`; 새 review root: `docs/evidence/complex-holdout-lineage-v2-260807/`.

### 확장 탐색 최종 판정

- 직접 SLDPRT/IPT/CATPART/PRT, X_B, DWG, RVT까지 snapshot 발견 형식에 추가하고 factory/robot/pressure 명칭을 확장했다.
- 제품군 판정은 내부 부품명이 아니라 가장 바깥쪽 snapshot root 이름으로만 수행한다. 자동차 snapshot 내부 `propeller bolt`를 turbomachinery로 세는 것과 같은 교차 제품군 누수를 차단했다.
- 최종 분포는 robot 9, gearbox 17, pressure vessel 11, turbomachinery 11, factory equipment 20, interior 20이다.
- 부족분은 robot 11, gearbox 3, pressure vessel 9, turbomachinery 9로 총 32건이다. 현재 로컬 참고자료만으로 120-case 독립 holdout을 만들 수 없으며, 외부 또는 별도 사내 원본이 추가되기 전 1,800-run 정식 campaign은 차단한다.
- 부족한 32건은 acquisition queue로 생성했다. 이 슬롯은 case가 아니며 정확도 분모에 포함되지 않는다. 이미지/PDF/AABB 단독 자료는 거부하고, 독립 lineage·SHA-256·상업적 출처 검토·holdout 격리·native 구조 검토를 요구한다.
- acquisition queue: `docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json`.
