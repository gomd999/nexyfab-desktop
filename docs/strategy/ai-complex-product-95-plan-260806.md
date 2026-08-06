# AI 복잡 제품·다중 부품 생성 정확도 95% 실행 계획

> 기준일: 2026-08-06  
> 목표: 자연어·도면·참고 형상에서 제조 가능한 다중 부품 제품을 생성하고, 독립 검증 항목 기준 95% 이상 정확도를 달성  
> 제외: 견적, RFQ, 공장 연결  
> 연계 문서: `cad-accuracy-execution-status-and-next-plan-260806.md`

## 1. 95%의 정의

95%는 “파일이 열림”, “렌더링이 비슷함” 또는 여러 항목을 뭉친 임의 총점이 아니다. 다음 항목을 독립적으로 측정하며 모든 필수 항목이 가족별 95% 이상이어야 한다.

| 축 | 측정 단위 | 목표 |
|---|---|---:|
| 요구사항 | 명시 요구·금지·미확정 조건 | ≥95% precision/recall |
| 치수 | 검증 가능한 선형·각도·직경·간격 | ≥95% within tolerance |
| feature | hole/pocket/boss/revolve/pattern/fillet 등 | ≥95% precision/recall |
| part definition | 독립 제조·구매 부품 종류 | ≥95% precision/recall |
| occurrence | 반복 부품 수량과 instance | ≥95% precision/recall |
| body membership | part별 multi-body 소속 | ≥95% accuracy |
| hierarchy | product/subassembly/part 계층 | ≥95% edge F1 |
| transform | occurrence 위치·방향 | ≥95% within 0.01 mm/0.01° |
| joint/mate | 종류·연결 pair·축·원점·limit | ≥95% F1 및 tolerance |
| 동작 | joint range·frame pose·DoF | ≥95% verified assertions |
| 충돌·간극 | static/motion collision 및 clearance | ≥95% precision/recall, false-clear 0 |
| 제조 의미 | 재료·공차·PMI·DFM·공정 | ≥95% applicable assertions |
| STEP 왕복 | body/part/topology/dimension 보존 | ≥95%, destructive merge 0 |
| 자동 복구 | 오류 원인 분류·국소 복구·rollback | ≥95% correct repair selection |

다음은 95% 평균과 별개인 절대 조건이다.

- 허위 `verified` 0건.
- 원인 없는 `generation_failed` 0건.
- 의도하지 않은 part merge 또는 단일-body flattening 0건.
- 미검사·예산초과·도구부재를 pass로 처리한 사례 0건.
- 사용자 확정 치수·재료·공차를 자동 복구가 임의 변경한 사례 0건.
- 필수 release gate 통과율 100%.

## 2. 제품 난이도 계층

| Tier | 정의 | 예시 | 최소 corpus |
|---|---|---|---:|
| T1 | 1~5 definitions, 1~20 occurrences, 고정 조립 | bracket assembly, cabinet module | 가족별 20 |
| T2 | 6~25 definitions, 21~100 occurrences, 1~4 joints | 소형 로봇, 감속기, 펌프 | 가족별 20 |
| T3 | 26~100 definitions, 101~1,000 occurrences, 다단 subassembly | 로봇 셀, 제트엔진 module, 생산 설비 | 가족별 20 |
| T4 | 100+ definitions 또는 1,000~10,000+ occurrences | 공장 line, 복합 기계, 대형 설비 | 가족별 10 성능 holdout |

정확도 95% 출시는 최소 T1~T3를 가족별로 충족해야 한다. T4는 정확도와 별도로 memory, latency, cancellation/resume, viewport 성능을 보고한다.

## 3. 평가 제품군

기존 `complexProductBenchmark.ts`의 제품군을 유지하되 평가 내용을 확장한다.

1. robot: serial arm, parallel linkage, gripper, mobile manipulator.
2. gearbox: spur/helical/worm/cycloidal/planetary 및 shaft-bearing-housing.
3. pressure vessel: shell, nozzle, flange, support, fastener와 weldment.
4. turbomachinery: motor, pump, fan, compressor, turbine/jet-engine module.
5. factory equipment: conveyor, frame, actuator, guard, piping와 robot cell.
6. interior: room, furniture, door/window, lighting, MEP와 circulation.

건축·토목·조경은 기계 assembly 점수에 섞지 않고 spatial/IFC vertical benchmark로 별도 확장한다.

## 4. 데이터와 holdout 정책

- 제품군별 독립 holdout 최소 20개, 각 사례 5회 반복: 기본 600회.
- 동일 모델의 파일 형식만 다른 자료는 한 holdout group으로 묶어 데이터 누수를 막는다.
- golden 제품은 prompt 예제, repair rule 튜닝과 few-shot에 넣지 않는다.
- source hash와 snapshot lineage를 필수화한다.
- manual-derived 값은 공식·단위·적용 조건과 reviewer 승인이 없으면 KPI 분모에 넣지 않는다.
- customer failure는 익명화 후 별도 regression tier로 보존한다.
- 성공 사례만 골라 분모를 만들지 않으며 `fail/not_run/unavailable`을 원인별로 공개한다.

## 5. AI 다단 생성 파이프라인

### S0 입력 정규화

- 텍스트, 이미지, DXF/DWG, STEP/IFC, 참고 이미지와 manual citation을 분리한다.
- source별 신뢰도와 hash를 저장한다.
- 관측값, 사용자 확정값, 표준값, 추정값을 구분한다.
- 단위·좌표계·제품 domain이 불명확하면 질문 또는 명시적 unresolved로 남긴다.

### S1 요구사항 graph

- 기능, envelope, interface, 하중, 운동, 제조, 재료, 공차와 금지 조건을 구조화한다.
- 서로 충돌하는 요구는 생성 전에 차단한다.
- 확인되지 않은 치수를 AI가 확정값으로 승격하지 않는다.

### S2 제품 architecture

- product → subassembly → part → body → feature hierarchy를 생성한다.
- make/buy/standard component를 구분한다.
- independent part와 occurrence를 분리한다.
- joint와 datum/interface graph를 형상보다 먼저 정의한다.
- BOM definition 수와 occurrence 수를 별도 관리한다.

### S3 부품별 설계

- 각 part를 base feature → major feature → interface feature → repeated feature → finishing 순으로 생성한다.
- 부품별 독립 FeatureTree와 body membership을 만든다.
- 표준 부품은 검증된 catalog definition을 instance로 사용한다.
- 자유곡면·복잡 blade는 analytic/parametric 지원이 없으면 imported B-rep 또는 unresolved로 유지한다.

### S4 커널 생성·부품 검증

- OCCT/Parasolid급 analytic B-rep build.
- closed/manifold, invalid edge/face, volume, AABB, surface, minimum thickness 검사.
- G4의 단일 solid 조건은 제품 전체가 아니라 “해당 part intent가 single-solid일 때” 적용한다.
- multi-body part는 선언된 body count/membership과 비교한다.

### S5 assembly solve

- occurrence transform, mate residual, Jacobian rank와 DoF를 검사한다.
- joint 종류·축·원점·limit을 검증한다.
- 미지원 joint를 유사 mate로 치환하지 않는다.
- subassembly rigid/flexible 상태를 구분한다.

### S6 motion·collision·clearance

- 모든 joint operating range를 coarse/adaptive sampling한다.
- AABB broad phase 후 mesh/OCCT precise narrow phase를 수행한다.
- first-contact bracket과 minimum clearance를 evidence로 남긴다.
- intended contact는 interface ID와 justification이 있을 때만 허용한다.

### S7 제조·roundtrip

- 재료·밀도·질량·CG·관성, 공차, DFM, PMI를 applicable 범위에서 검증한다.
- STEP export 후 재수입하여 definition/occurrence/body/topology/dimension을 대조한다.
- part merge, transform loss, unit change와 PMI target loss는 release blocker다.

### S8 국소 자동 복구

- 오류를 intent, feature, boolean, topology, mate, collision, unit, export, transport로 분류한다.
- 실패한 part/feature/joint만 수정하고 영향 graph의 downstream만 재생성한다.
- deterministic repair를 AI 재생성보다 먼저 수행한다.
- 같은 원인 3회 반복 시 무한 재시도하지 않고 명시적 blocker로 전환한다.
- 매 시도에 before/after diff와 rollback artifact를 저장한다.

## 6. 정확도 향상 루프

1. baseline 실행: 모든 holdout 5회, seed/model/prompt version 기록.
2. 오류 clustering: 원인 코드와 product tier별 Pareto 분석.
3. 한 번에 한 원인군만 수정.
4. 해당 실패 corpus와 전체 holdout을 모두 재실행.
5. macro와 micro 지표, 최악 제품군과 최악 tier를 함께 비교.
6. 개선이 특정 가족의 회귀를 만들면 배포하지 않는다.
7. 3회 연속 독립 전체 실행에서 기준을 통과해야 95% 달성으로 인정한다.

## 7. 점수 계산 규칙

- micro accuracy: 전체 assertion 합산. 대량 반복 부품의 실제 영향 측정.
- macro accuracy: case별 점수 평균. 큰 제품 하나가 전체 수치를 지배하지 않게 함.
- family minimum: 여섯 가족 각각의 최저값.
- tier minimum: T1/T2/T3 각각의 최저값.
- stability: 동일 case 5회 중 최저 점수와 표준편차.

출시 조건:

```text
각 필수 축 micro >= 0.95
각 필수 축 macro >= 0.95
각 제품군 >= 0.95
T1, T2, T3 각각 >= 0.95
required gates = 1.00
falseVerified = 0
destructivePartMerge = 0
3 consecutive full runs pass
```

`not_run`을 제외한 조건부 정확도와 전체 coverage를 둘 다 공개한다. 출시에는 accuracy ≥95%뿐 아니라 governed coverage ≥95%도 필요하다.

## 8. 구현 묶음

### A — benchmark schema v2

- `ComplexBenchmarkCase`에 tier, body membership, hierarchy, transform, joint, motion, collision, manufacturing assertion을 추가한다.
- `ComplexBenchmarkRun`에 pass/fail/not_run과 원인 코드를 assertion 단위로 저장한다.
- micro/macro/family/tier/stability/coverage를 계산한다.
- 기존 v1 보고서는 migration 또는 명시적 legacy로 유지한다.

### B — generation checkpoint orchestrator

- S0~S8 checkpoint state와 artifact hash를 구현한다.
- part별 병렬 생성은 허용하되 interface 확정 후 실행한다.
- 실패 part만 retry하고 assembly 전체 재시작 비율을 5% 이하로 제한한다.
- model truncation, JSON/schema, rate limit, timeout을 geometry error와 분리한다.

### C — complex assembly generator

- functional decomposition과 definition/occurrence 분리.
- interface-first datum/joint 계획.
- catalog component grounding.
- native assembly IR, solver와 motion/clearance 연결.

### D — repair controller

- error taxonomy → deterministic repair registry.
- repair eligibility, mutation boundary, maximum attempts, rollback.
- 사용자 확정 필드 write protection.
- repair 효과를 원인별 성공률로 측정한다.

### E — corpus runner와 dashboard

- 600회 이상 실행을 resume 가능한 job으로 관리한다.
- case hash, model/prompt/kernel version과 random seed를 저장한다.
- 가족·tier·축·원인별 pass/fail/not_run을 표시한다.
- false verified와 destructive merge는 최상단 경보로 둔다.

### F — Web·API·CLI·MCP parity

- 같은 orchestrator와 benchmark schema를 사용한다.
- Web 채팅 생성과 face/edge/part 수정도 같은 checkpoint/gate를 통과한다.
- API·CLI·MCP의 artifact hash, status와 error code를 contract test한다.

## 9. 단계별 완료 기준

| 단계 | 완료 기준 |
|---|---|
| M1 계측기 | v2 schema negative test, 분모/coverage 왜곡 0건 |
| M2 T1 | 여섯 가족 T1 각 20개×5회, 모든 축 95% |
| M3 T2 | moving assembly 포함, transform/joint/motion 95% |
| M4 T3 | 26~100 definitions 복잡 제품, part/assembly/collision 95% |
| M5 repair | 정확한 원인 분류·repair 선택 95%, 전체 재생성 ≤5% |
| M6 roundtrip | destructive merge 0, STEP preservation 95% |
| M7 parity | Web·API·CLI·MCP certificate 동일 |
| M8 release | 3회 연속 전체 실행, coverage와 accuracy 모두 95%, false verified 0 |

## 10. 바로 다음 실행 순서

1. complex benchmark v2 타입·validator·계산기와 v1 호환 시험.
2. 현재 corpus를 tier와 assertion graph로 migration하되 ground truth 없는 값은 `not_run`.
3. MeArm synthetic/actual evidence를 첫 T2 assembly fixture로 연결.
4. S0~S8 checkpoint state machine과 resume/rollback artifact 구현.
5. functional decomposition → definition/occurrence generator 계약 구현.
6. 기존 manufacturing G0~G8을 part gate와 product assembly gate로 분리.
7. 실제 AI 5회 반복 runner에 truncation/transport/geometry 원인 분리.
8. baseline을 측정한 뒤 가장 큰 실패 원인부터 개선한다.

현재는 95% 달성을 주장하지 않는다. 이 계획의 첫 산출물은 숫자를 높이는 생성기 변경이 아니라, 복잡 제품에서 무엇이 맞고 틀렸는지 숨김없이 측정하는 benchmark v2다.

## 11. 구현 체크포인트

### 2026-08-06 benchmark v2

- `src/lib/ai/complexProductBenchmarkV2.ts` 구현.
- 14개 accuracy axis와 T1~T4, assertion별 `pass/fail/not_run` 구현.
- micro accuracy, macro accuracy, coverage, family/tier/overall, 최저 run과 표준편차 계산.
- 기본 정책:
  - 가족별 20 cases
  - campaign당 5 repeats
  - 연속 3 campaigns
  - accuracy와 coverage 각각 95%
  - required gate 100%
  - false verified, false clear, destructive part merge 0
- 누락 assertion은 pass에서 제외하지 않고 `not_run`으로 coverage를 낮춘다.
- 중복 execution, unknown assertion, tuning 사용, gate 없이 verified를 거부한다.
- legacy v1 migration은 `legacy-unreviewed`, `kpiEligible:false`로 생성하여 reviewer 승인 전 점수에 포함하지 않는다.
- CLI `npm run kpi:complex-products:v2 -- --cases=... --runs=...` 추가.
- 신규 시험 5개와 기존 v1 회귀, ESLint, 전체 TypeScript 검사 통과.
- 빈 입력 실제 실행은 `eligible:false`이며 데이터 없음이 성공으로 표시되지 않음을 확인.

다음 구현은 MeArm evidence에서 승인 가능한 assertion과 여전히 `not_run`이어야 하는 assertion을 분리하여 첫 T2 case/run fixture를 생성하는 것이다.

### 2026-08-06 T2 baseline·checkpoint·architecture

- MeArm evidence → T2 v2 변환기와 영속 baseline 구현.
- reference ground-truth run과 AI generation run을 분리하여 원본 분석이 AI 정확도를 올리지 못하게 함.
- 실제 MeArm reference 결과: 1 pass, 9 not_run, AI runs 0, eligible false.
- 승인된 occurrence count만 KPI eligible; filename 기반 35 definitions와 body/hierarchy/transform/joint/motion/collision은 비채점·not_run.
- S0~S8 checkpoint state machine 구현: ordered execution, hash-bound pass, reason-bound fail/not_run, resume history, downstream rollback, locked intent 보호.
- interface-first product architecture IR 구현: requirement graph, make/buy/standard definition, definition/occurrence 분리, body intent, hierarchy, datum interface와 joint type.
- 관련 신규 시험과 ESLint, 전체 TypeScript 검사 통과.

다음 구현은 기존 G4 single-solid 규칙을 part intent별 gate로 옮기고 product gate에서 definition/occurrence/hierarchy/transform/joint/collision을 별도로 판정하는 것이다.
