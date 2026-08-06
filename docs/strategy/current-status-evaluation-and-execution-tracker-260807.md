# NexyFab AI CAD 현재 상태·평가·실행 추적기

- 기준일: 2026-08-07 (Asia/Seoul)
- 문서 역할: 이후 작업의 단일 상태 추적 문서
- 현재 감사: 305/305 pass
- 감사 artifact set SHA-256: `dbce455e9af8896df549b314a730c349a4cc9d44fda418745a413ad9297b49c2`
- 정확도 선언: 현재 자료로 일반적인 95% AI CAD 정확도를 주장할 수 없음

## 1. 목표와 판정 원칙

목표는 일반 사용자부터 전문가까지 채팅으로 실제 제조·시공에 활용 가능한 설계를 생성하고 수정하는 것이다. 결과는 단일 결합 mesh가 아니라 part definition, body, occurrence, hierarchy, transform, interface, joint를 보존하는 다중 부품 assembly여야 한다. 기계, 로봇, 터보기계, 공장 설비, 건축, 인테리어는 공통 프로젝트 계층 위에서 분야별 생성기와 검증기를 사용한다.

다음 원칙을 계속 유지한다.

- AABB·표시 mesh·파일 판독 성공을 정확 제조 CAD 통과로 계산하지 않는다.
- `not_run`을 pass로 바꾸지 않는다. 실행기 또는 권위 있는 증거가 생겼을 때만 상태를 올린다.
- 동일 snapshot의 ZIP, 압축 해제 폴더, 포맷 변환본, 내부 부품은 하나의 lineage다.
- 내부 파일명이 아니라 제품 snapshot root로 제품군을 판정한다.
- 자동 추출 결과는 reviewer approval을 대체하지 않는다.
- 승인되지 않은 case와 acquisition placeholder는 95% 지표 분모에 넣지 않는다.
- 95%는 전체 평균 하나가 아니라 제품군·Tier·정확도 축별 accuracy와 coverage가 모두 기준을 만족해야 한다.

## 2. 현재 구현 상태

### 2.1 생성·편집 기반

- 다단 생성 S0~S8 checkpoint, artifact hash, resume 상태 모델이 구축되어 있다.
- 요구사항, functional decomposition, product architecture, definition/occurrence 기반 assembly 생성 계약이 있다.
- SCAD canonical feature, analytic B-rep, native STEP assembly, body intent와 body membership 검증 경로가 있다.
- face/edge/part selection context와 국소 채팅 수정, topology reference 재결속 경로가 있다.
- deterministic repair, mutation boundary, 사용자 확정 필드 보호, downstream 국소 재생성 기반이 있다.
- HTML 다중 부품 transform, animation timeline, assembly viewer 관련 구현과 테스트가 있다.
- Web/API/CLI/MCP 공통 CAD 경로와 canonical generation response 기반이 있다.

평가: 기능 골격은 강하지만 복잡한 실제 제품에 대한 승인된 생성 정확도 증명은 아직 부족하다.

### 2.2 형상·어셈블리 검증

- SCAD/STEP 내부 교정 fixture에서 definition, occurrence, transform, body intent, topology survival/rebind가 감사 대상에 포함된다.
- 외부 STEP 기존 기준선은 115건 중 38건 실행, 구조 pass 38, 구조 fail 0이다.
- 외부 body membership은 35건 pass, 3건 `not_run`이다.
- 외부 joint semantics는 실행 38건 모두 `not_run`이다.
- 정확 worker 계약은 nested assembly definition/occurrence, source/member hash, exact B-rep 또는 watertight mesh를 검증한다.
- ODA/AutoCAD/Revit exact worker queue 13건은 구축됐지만 worker 미연결로 accepted 0이다.

평가: 구조와 좌표계 기반은 유효하지만 native joint·constraint·motion 증거가 제품 assembly 정확도의 가장 큰 공백이다.

### 2.3 IFC·건축·인테리어

- IFC product 1,690개에서 표시 mesh 1,690개를 복원했다.
- 정확 폐형 체적 mesh는 723/1,690, 약 42.78%다.
- 열린 surface mesh는 967개이며 완전한 containment·clearance 판정에는 사용할 수 없다.
- boundary/non-manifold/degenerate face 분석과 deterministic degenerate repair가 있다.
- indexed mesh precise collision은 닫힌 mesh와 열린 mesh의 증명 가능 범위를 분리한다.
- 건축·인테리어 생성기에는 공간, 개구부, 창문, 계단, 복도, 조명, 가구, MEP 및 분야별 검증 기반이 있다.

평가: 표시와 공간 검토에는 진전이 크지만 정확 체적·법규·시공 문서까지 일괄 release-ready라고 볼 수 없다.

### 2.4 DWG·Revit

- DWG archive 16건을 실제 LibreDWG WASM으로 판독했다.
- 2D 도면 8건, 3D AABB 근사 8건, exact 3D 0건이다.
- AABB 결과는 body membership, 충돌·간극, 제조 정확도 점수에서 제외된다.
- Revit ZIP 내부 DWG는 fallback export로만 분류하며 native Revit 의미로 계산하지 않는다.
- AutoCAD COM, ODA exact worker, Revit native worker는 현재 ready 0이다.

평가: 파일 분류 경로는 안정적이지만 정확 DWG/Revit 복원 기능은 외부 native worker 없이는 미완성이다.

## 3. 정확도 corpus 현재 상태

엄격 lineage-v2는 snapshot ZIP과 내부 파일 중복 및 내부 부품명에 의한 제품군 오분류를 제거한 기준선이다.

| 제품군 | 독립 case | 목표 | 부족 |
|---|---:|---:|---:|
| Robot | 9 | 20 | 11 |
| Gearbox | 17 | 20 | 3 |
| Pressure vessel | 11 | 20 | 9 |
| Turbomachinery | 11 | 20 | 9 |
| Factory equipment | 20 | 20 | 0 |
| Interior | 20 | 20 | 0 |
| 합계 | 88 | 120 | 32 |

- required assertions: 862
- source hash preflight: 88/88 pass
- preflight fail: 0
- 자동 part definition evidence: 44/88
- 자동 occurrence evidence: 28/88
- 자동 hierarchy evidence: 28/88
- ground-truth approved cases: 0
- approval pending: 88
- approved campaign corpus: 0
- 부족 acquisition slots: 32

판정: lineage 독립성은 개선됐지만 120-case suite와 1,800 AI runs를 시작할 데이터 조건은 충족되지 않았다.

## 4. 현재 준비도 평가

| 영역 | 현재 등급 | 근거 | 다음 승격 조건 |
|---|---|---|---|
| 내부 CAD 생성 골격 | B | 다단 생성, feature/B-rep/assembly 계약과 테스트 존재 | 실제 AI holdout 반복 실행 |
| 다중 부품 구조 | B- | definition/occurrence/transform 경로 존재 | native joint와 복잡 assembly 승인 사례 |
| STEP 상호운용 | B- | 내부 fixture와 외부 구조 추출 존재 | lineage-v2 88건 재추출 및 승인 |
| IFC 표시·공간 검토 | B | 1,690/1,690 표시 mesh | 열린 mesh와 법규/시공 검증 확대 |
| IFC 제조/정확 체적 | C | exact volume 42.78% | 제품군별 exact-volume coverage 95% |
| DWG/Revit exact | D | exact DWG 0, native worker 0 | exact worker 연결 및 source-bound 결과 |
| Joint/motion/clearance | D+ | 내부 계약은 있으나 외부 joint 0 | native joint·motion·clearance certificate |
| Ground truth | D | approved 0/88, 목표 120 | 이중 독립 승인 120/120 |
| 95% 정확도 증명 | 미충족 | 승인 corpus와 1,800-run campaign 없음 | 축·제품군·Tier별 95%, 3회 연속 |
| 제조 release readiness | 미충족 | 재료·공정·공차·joint 등 미확정 | part/product gate 전부 pass |

종합 평가: 연구·개발용 AI CAD 플랫폼 기반은 상당 부분 구축됐지만, 상용 제조 결과를 자동 승인할 수준은 아니다. 현재 가장 큰 문제는 생성 코드 부족보다 승인된 독립 corpus, native CAD 실행기, joint/constraint ground truth 부족이다.

## 5. 위험과 기술 부채

### R1. 작업 트리 복구 위험 — 높음

- 현재 `git status --short` 기준 변경·신규 항목이 약 457개다.
- 여러 단계의 작업이 한 작업 트리에 누적되어 있다.
- hash manifest는 변조 탐지는 가능하지만 파일 복구 수단은 아니다.
- 다음 대규모 기능 변경 전에 사용자 승인 하에 checkpoint commit 또는 외부 백업이 필요하다.

### R2. 기존 115-case corpus 오사용 — 높음

- 기존 corpus에는 snapshot ZIP과 내부 파일의 lineage 중복이 있었다.
- `complex-holdout-review-260806`은 역사적 증거로만 유지한다.
- 신규 accuracy campaign과 승인은 반드시 `complex-holdout-lineage-v2-260807`을 사용한다.

### R3. 자동 pass와 승인 혼동 — 높음

- 구조 parser pass는 정답 승인이나 상업적 사용권 승인이 아니다.
- ground-truth dual signoff gate를 우회하는 실행 경로가 생기지 않도록 감사한다.

### R4. 근사 형상 오사용 — 높음

- DWG AABB, 열린 IFC mesh, 대표 샘플은 표시·확인에는 사용할 수 있으나 완전한 체적·충돌·간극 증거가 아니다.

### R5. 제품군 불균형 — 높음

- Robot, pressure vessel, turbomachinery가 크게 부족하다.
- 동일 lineage 또는 다른 제품군의 파일을 재분류해 숫자만 채우면 안 된다.

## 6. 이후 통합 실행 계획

### P0. 복구 가능한 기준선 확보

목표: 현재 작업을 잃지 않고 이후 변경을 비교할 수 있게 한다.

- [x] 변경·신규 파일을 inventory했다.
- [x] tracked binary patch와 untracked/source 원본 사본을 분리해 저장했다.
- [x] `C:\tmp`에 외부 체크포인트를 생성했다.
- [x] checkpoint의 base HEAD, branch, file-set hash와 복구 절차를 기록했다.

체크포인트 기록:

- 경로: `C:\tmp\nexyfab-workspace-checkpoint-260807-p0`
- base HEAD: `524a7b8afca2e449836e0f46b0f6725b5832b03b`
- branch: `feat/landing-chat-first`
- 백업 파일: 808개
- 구성: modified 109, staged 0, untracked 699, deleted record 1
- source bytes: 86,464,126 bytes
- file-set SHA-256: `a92e29cc9fac4a670c3bc2736e4b4f30a2aa5f517acca20cb937af6f717be652`
- 사본 SHA-256 검증: 808/808 pass
- patch SHA-256 검증: 2/2 pass
- 복구 안내: `C:\tmp\nexyfab-workspace-checkpoint-260807-p0\RESTORE.md`

완료 조건:

- 현재 305개 감사 check를 재현할 수 있다.
- 새 위치 또는 commit에서 핵심 테스트와 artifact hash를 다시 계산할 수 있다.

### P1. lineage-v2 88건 native extraction 재실행

목표: 새로운 case/source hash 기준으로 기존 외부 구조 증거를 다시 연결한다.

- [ ] STEP/STP를 FreeCAD native extractor에 연결한다.
- [ ] IGES/IGS entity 구조를 native geometry 결과와 교차검증한다.
- [ ] IFC case를 indexed mesh/closure/collision evidence에 연결한다.
- [ ] ZIP member 선택을 source member hash에 결속한다.
- [ ] SLDASM/IAM/CATPRODUCT/ASM/X_T/X_B를 executor별 partition한다.
- [ ] 결과를 lineage-v2 case ID로만 merge한다.

완료 조건:

- source mismatch 0, unknown result 0, duplicate result 0
- 실행 가능한 case의 structure fail 0
- part definition/occurrence/hierarchy/transform coverage가 현재보다 증가
- body membership과 joint는 증거가 없으면 `not_run` 유지

### P2. native joint·motion·collision 증거

목표: 복잡 assembly를 단순 부품 목록이 아니라 작동 가능한 제품으로 검증한다.

- [ ] SolidWorks/Inventor/CATIA/Creo/Revit worker 계약 구현 또는 연결
- [ ] mate/constraint를 fixed, revolute, prismatic 등 공통 joint IR로 변환
- [ ] joint origin, axis, limits, parent/child occurrence hash 결속
- [ ] native motion sweep와 precise collision 비교
- [ ] clearance certificate와 pair-budget exhaustion `not_run` 처리
- [ ] 사용자 확정 joint/치수 보호 및 국소 repair

완료 조건:

- 최소 제품군별 3개 승인 assembly에서 native joint pass
- false-clear 0, false-verified 0
- joint 미지원 파일을 fixed joint로 임의 변환하지 않음

### P3. 부족한 독립 holdout 32건 확보

목표: 제품군별 20개, 총 120개 독립 제품을 완성한다.

- [ ] Robot 11건
- [ ] Gearbox 3건
- [ ] Pressure vessel 9건
- [ ] Turbomachinery 9건
- [ ] source SHA-256 및 lineage root 등록
- [ ] 상업적 provenance/license 검토
- [ ] prompt/tuning corpus와 holdout 격리
- [ ] native definition/occurrence 또는 정확 교환 형상 확인

완료 조건:

- 제품군별 정확히 20개 이상의 독립 lineage
- cross-family reuse 0
- ZIP/member 중복 0
- 이미지/PDF/AABB-only case 0

### P4. reviewer-approved ground truth

목표: 120건의 모든 required assertion을 사람이 검토한 정답으로 만든다.

- [ ] 첫 wave 30건 domain review
- [ ] independent reviewer 재검토
- [ ] license와 holdout isolation 승인
- [ ] dimensions/features/transforms/body/joints/motion/clearance/manufacturing 검토
- [ ] artifact 변경 시 승인 자동 무효화 확인
- [ ] rejected/changes_requested의 수정·재검토 이력 보존

완료 조건:

- approved cases 120/120
- required assertion 미승인 0
- 동일인 이중 signoff 0
- invalid/unknown/duplicate approval record 0

### P5. 1,800-run 실제 AI campaign

목표: 20 cases × 6 families × 5 repeats × 3 campaigns를 실제 AI 생성으로 실행한다.

- [ ] production과 분리된 고정 model/prompt/toolchain manifest
- [ ] usedForTuning=false 확인
- [ ] S0~S8 checkpoint와 resume
- [ ] 실패 taxonomy 및 deterministic repair 이력
- [ ] part kernel gate와 product assembly gate 분리
- [ ] Web/API/CLI/MCP 동일 요청·결과 hash 비교
- [ ] 제품군·Tier·축별 accuracy와 coverage 보고

완료 조건:

- AI generation runs 1,800
- 누락 slot 0, 중복 slot 0, resume hash mismatch 0
- 각 축·제품군·Tier accuracy ≥ 95%
- 각 축·제품군·Tier coverage ≥ 95%
- required gate pass rate 100%
- false-verified 0, false-clear 0, destructive part merge 0
- 전체 조건 3개 연속 campaign 통과

### P6. 정확도 개선 반복

목표: campaign fail을 제품군별 생성·검증·repair 개선으로 연결한다.

- [ ] 오류를 requirements/decomposition/geometry/topology/assembly/joint/manufacturing/export로 분류
- [ ] 확정 필드를 보호하며 영향받은 downstream만 재생성
- [ ] 동일 오류 deterministic reproduction fixture 추가
- [ ] repair 전후 artifact hash와 rollback 검증
- [ ] holdout 결과를 prompt tuning에 직접 유입하지 않음

완료 조건:

- 같은 원인의 반복 실패율 감소
- repair가 무관 부품을 변경한 사례 0
- regression fixture와 campaign 양쪽 통과

### P7. 배포·표면 parity 및 운영 안정화

목표: 로컬 구현과 배포 사이트의 AI·CAD 기능이 동일하게 동작하도록 한다.

- [ ] credential-safe production AI smoke test
- [ ] Web/API/CLI/MCP canonical response parity
- [ ] timeout, rate limit, retry, idempotency, resume 검증
- [ ] OpenSCAD/FreeCAD/Radiance/native worker health endpoint
- [ ] quote/RFQ 흐름이 제품 생성 경로에 재유입되지 않았는지 점검
- [ ] standalone HTML multi-part transform/animation 회귀 테스트

완료 조건:

- 3회 연속 배포 smoke pass
- 표면별 결과 hash 또는 허용된 canonical equivalence 일치
- AI 연결 끊김, silent fallback, 근사 결과 무표시 사례 0

## 7. 실행 순서와 병렬화

순차 의존성:

`P0 → P1 → P2/P3 → P4 → P5 → P6 → P7`

병렬 가능한 작업:

- P1의 STEP, IGES, IFC extractor는 병렬 가능하다.
- P2의 기계 native worker와 Revit worker는 병렬 가능하다.
- P3의 제품군별 자료 확보는 제품군 단위로 병렬 가능하다.
- P4의 domain review는 case 단위 병렬 가능하지만 independent signoff는 원검토 이후다.
- P6의 제품군별 repair는 공통 IR 계약을 변경하지 않는 범위에서 병렬 가능하다.

## 8. 작업 추적 표

상태 값은 `pending`, `in_progress`, `blocked`, `complete`만 사용한다. 완료는 증거 경로와 검증 명령이 있을 때만 기록한다.

| ID | 작업 | 상태 | 현재 수치 | 완료 수치 | 증거/메모 |
|---|---|---|---:|---:|---|
| P0-1 | 복구 가능한 checkpoint | complete | 808/808 사본 검증 | 복구 검증 1회 | `C:\tmp\nexyfab-workspace-checkpoint-260807-p0` |
| P1-1 | lineage-v2 source hash | complete | 88/88 | 88/88 | `preflight.json` |
| P1-2 | part definition 자동 증거 | in_progress | 정적 44/88, native 31/88 | 실행 가능 case 전부 | `structure-evidence.json`, `native-direct-validation.json` |
| P1-3 | occurrence/hierarchy 자동 증거 | in_progress | 정적 28/88, native 31/88 | 실행 가능 case 전부 | `structure-evidence.json`, `native-direct-validation.json` |
| P1-4 | body membership | in_progress | native 24/88 pass | 증거 가능 case 전부 | `native-direct-validation.json` |
| P2-1 | native joints | pending | 외부 기준 0 | 제품군별 최소 3 승인 case | native CAD worker 필요 |
| P2-2 | motion/clearance | pending | 일반화 증명 없음 | false-clear 0 | joint 이후 |
| P3-1 | Robot corpus | blocked | 9/20 | 20/20 | 신규 독립 자료 11건 필요 |
| P3-2 | Gearbox corpus | blocked | 17/20 | 20/20 | 신규 독립 자료 3건 필요 |
| P3-3 | Pressure vessel corpus | blocked | 11/20 | 20/20 | 신규 독립 자료 9건 필요 |
| P3-4 | Turbomachinery corpus | blocked | 11/20 | 20/20 | 신규 독립 자료 9건 필요 |
| P3-5 | Factory equipment corpus | complete | 20/20 | 20/20 | 승인 전 candidate 상태 |
| P3-6 | Interior corpus | complete | 20/20 | 20/20 | 승인 전 candidate 상태 |
| P4-1 | Ground truth approval | pending | 0/88 | 120/120 | dual signoff 필요 |
| P5-1 | 실제 AI campaign | blocked | 0/1,800 | 1,800/1,800 | P3/P4 선행 |
| P5-2 | 95% 정확도·coverage | blocked | 미측정 | 각 그룹 ≥95% | campaign 선행 |
| P7-1 | Web/API/CLI/MCP parity | in_progress | 기반 구현 존재 | 3회 연속 전체 pass | 배포 smoke 필요 |

## 9. 매 작업 후 갱신 규칙

각 작업 묶음이 끝날 때 이 문서에 다음을 추가한다.

1. 날짜와 작업 ID
2. 변경한 source 파일
3. 생성·갱신한 evidence 경로
4. 실행한 검증 명령과 pass/fail/not_run 수
5. accuracy/coverage 분모가 바뀌었는지 여부
6. 새 blocker와 제거된 blocker
7. 다음 실행 작업과 완료 조건

`fail`이나 `not_run`을 줄였을 때는 단순 상태 변경이 아니라 어떤 새 증거로 줄었는지 기록한다.

## 10. 현재 재현 명령

```powershell
node scripts/audit-ai-cad-baseline.mjs
npx tsc --noEmit --pretty false
npx vitest run src/lib/ai/complexGroundTruthApproval.test.ts src/lib/ai/complexAssertionReview.test.ts src/lib/ai/complexCampaignRunner.test.ts src/lib/ai/complexProductBenchmarkV2.test.ts --reporter=dot
npm run evidence:holdout-shortfall
```

## 11. 변경 이력

최신 전체 상태 평가와 이후 실행 계획은 `docs/strategy/current-status-and-next-execution-plan-260807-v2.md`를 기준으로 한다.

### 2026-08-07 — 최초 작성

- 현재 구현과 정확도 증거를 재점검했다.
- 통합 감사 305/305 pass를 확인했다.
- 엄격 lineage-v2 88건과 부족 32건을 공식 현재 corpus로 기록했다.
- 기존 115건 corpus는 역사적 증거로만 사용하도록 명시했다.
- P0~P7 실행 계획, 완료 조건, 병렬화, 추적 표를 생성했다.

### 2026-08-07 — P0 체크포인트 완료

- tracked binary patch 2개와 변경·신규 파일 808개의 원본 사본을 `C:\tmp`에 저장했다.
- 808개 파일과 patch 2개의 SHA-256 재검증에서 오류 0건을 확인했다.
- 삭제된 tracked 경로 1개를 manifest와 patch에 기록했다.
- 체크포인트는 현재 작업을 복구하기 위한 사본이며 Git commit을 대신하지 않는다.
- 다음 활성 작업을 P1 lineage-v2 native extraction 재실행으로 변경했다.

### 2026-08-07 — P1 직접 CAD 형상 추출 1차

- lineage-v2 88건 중 직접 STEP/STP/IGS 파일에서 FreeCAD native 결과 26건을 생성했다.
- 축별 결과는 part definition 26 pass, body membership 23 pass, occurrence/hierarchy/transform 26 pass다.
- 모든 88건의 종합 상태는 joint semantics 미확보 때문에 `not_run`이며, 구조 축 통과를 제품 전체 통과로 과장하지 않는다.
- STEP은 14/15, STP는 9/9, IGS는 3/3 성공했다.
- STEP 1건과 IGES 1건은 180초 timeout, IGES 1건은 non-rigid scaling transform 오류로 실패했다.
- IFC 4건은 현재 FreeCAD import 경로가 지원하지 않아 0/4였으며, 러너의 capability 선언에서 IFC를 제거했다.
- FreeCAD 직접/ZIP 지원을 STEP, STP, IGES, IGS로 fail-closed 정리하고 ZIP 내부 IGES/IGS 탐색을 추가했다.
- 다음 활성 작업은 ZIP 28건의 지원 멤버 분류·추출과 실패 3건의 deterministic remediation이다.

### 2026-08-07 — P1 ZIP 분류 및 직접 IFC 복구

- ZIP 28건을 실제 검사했으며 FreeCAD 지원 교환 포맷 멤버는 0건, fail 0건, 명시적 skip 28건이었다.
- ZIP 자료는 SLDPRT/IPT/PRT와 DWG/RVT 중심이므로 FreeCAD 성공으로 가장하지 않고 native CAD/DWG/Revit worker 경로로 분리했다.
- IFC 전용 러너가 직접 `.ifc`와 ZIP 내부 IFC를 구분하도록 확장했다.
- 과거 triage case ID가 새 lineage 자료에 섞이지 않도록 `none` triage 실행 경계를 추가했다.
- 직접 IFC 4/4를 복구해 native 결과를 26건에서 30건으로 늘렸다.
- IFC 4건에서 product 6,310개를 읽었고 폐곡면 체적 증거 2,583개, 열린 표면 3,727개로 측정했다.
- 최종 축별 결과는 part definition/occurrence/hierarchy/transform 30/88 pass, body membership 23/88 pass, joints 0/88 pass다.
- 모든 케이스의 종합 상태는 joint semantics 미확보로 계속 `not_run`이며 release-ready가 아니다.
- 다음 활성 작업은 proprietary CAD 32건(SLDASM/IAM/CATPRODUCT/ASM/X_T 및 ZIP 원본 CAD)의 worker routing manifest와 source-member hash 확정이다.

### 2026-08-07 — P1 native worker routing manifest

- 직접 파일과 ZIP 내부 CAD 멤버를 동일한 worker routing 계약으로 통합했다.
- 88/88 case가 라우팅됐고 unrouted case는 0건이다.
- 원본과 ZIP member의 SHA-256을 검증해 총 141개 deterministic job을 생성했다.
- 로컬 실행 가능 job은 33개, 외부 native worker 필요 job은 108개다.
- worker별 job은 SolidWorks 35, Inventor 33, Creo 16, DWG 16, Revit 6, CATIA 1, Parasolid 1, FreeCAD exchange 29, IFC 4다.
- 외부 worker가 없는 108개 job은 성공으로 표시하지 않고 `not_run`으로 유지한다.
- 확장자 라우팅은 unsupported format을 null로 반환하며 fail-closed 단위 테스트를 추가했다.
- 다음 활성 작업은 108개 외부 job의 공통 요청/결과 계약, worker command registry, resume 및 결과 검증기 구축이다.

### 2026-08-07 — P1 외부 native worker 실행 계층

- SolidWorks, Inventor, CATIA, Creo, Parasolid, DWG, Revit 공통 실행 계약과 환경 명령 registry를 구현했다.
- source outer hash와 직접/ZIP member payload hash를 실행 직전에 다시 검증하도록 했다.
- worker 결과에서 job/case/source hash, worker identity, body count, definition/occurrence, rigid transform, joint reference, native semantics를 fail-closed 검증한다.
- timeout, 임시 입력 격리, 결과 크기 제한, deterministic result hash, manifest-hash-bound resume를 구현했다.
- 현재 registry 실행 결과는 requested 108, accepted 0, `not_run` 108, fail 0, release-ready false다.
- `not_run` 원인은 SolidWorks 35, Inventor 33, Creo 16, DWG 16, Revit 6, CATIA 1, Parasolid 1 worker command 미설정이다.
- worker가 없는 상태를 parser 실패와 구분했으며, 결과 증거 없이 성공으로 승격되는 경로는 없다.
- 다음 활성 작업은 설치 가능한 Parasolid/DWG worker부터 연결하고, 나머지는 vendor CAD 설치 또는 격리 worker host 요구사항을 명문화하는 것이다.

### 2026-08-07 — P1 native worker host preflight 및 배포 계약

- Program Files 검색에서 ODA, SolidWorks, Inventor, AutoCAD, Revit, CATIA 실행기는 발견되지 않았고 기존 FreeCAD만 확인됐다.
- 7종 external worker의 OS, 라이선스, exact geometry, hierarchy/constraint capability health 계약을 구현했다.
- command 존재만으로 ready가 되지 않으며 `--health` 결과의 라이선스와 capability가 모두 통과해야 한다.
- host preflight 결과 workers 7, jobs 108, ready-to-probe 0, `not_run` 7, fail 0이다.
- `.env.example`에 7개 명령 변수를 추가하고 격리 계정, macro 차단, 임시 디렉터리, timeout, 증거 승격 규칙을 배포 문서로 고정했다.
- 현재 정확도 blocker는 코드 라우팅이 아니라 authorized native engine 및 라이선스가 설치된 worker host 부재다.
- 다음 활성 작업은 health probe runner와 canary gate를 구현한 뒤 실제로 확보 가능한 첫 worker를 연결하는 것이다.

### 2026-08-07 — P1 health probe 및 canary gate

- 7종 worker의 `--health --output` 실행기와 1 MiB 결과 제한, 30초 timeout, 격리 임시 디렉터리를 구현했다.
- health 결과는 worker kind/identity/OS/license/exact geometry/native semantics를 검증한다.
- deterministic 최소 job ID를 worker별 canary로 선택하고 health 통과 전에는 batch 실행을 차단한다.
- 현재 health 결과는 pass 0, fail 0, `not_run` 7이고 canary gate는 pass 0, ready 0, blocked-health 7이다.
- 외부 실행 러너에 `--job`과 `--worker` 선택 범위를 추가했다.
- 실제 canary dry-run 1건은 requested 1, accepted 0, `not_run` 1, fail 0으로 범위 제한과 fail-closed 동작을 확인했다.
- 다음 활성 작업은 상용 worker 없이 진행 가능한 로컬 정확도 축인 STEP 실패 1건 및 IGES 실패 2건의 deterministic remediation과 joint inference 비승격 증거 강화다.

### 2026-08-07 — P1 FreeCAD deterministic remediation

- 기존 180초 timeout 2건을 동일 입력·동일 extractor·600초 상한으로 각각 한 번만 재시도했다.
- `pressure_vessel-review-01` STEP은 235.5초에 복구됐고 native validation에 병합했다.
- `factory_equipment-review-03` IGES는 약 2.3 GiB working set으로 처리됐지만 600초에 다시 timeout되어 large IGES worker 대상으로 분리했다.
- `turbomachinery-review-03` IGES는 non-rigid scaling transform 오류이며 partial import를 성공으로 승격하지 않았다.
- native 결과는 30→31건, part definition/occurrence/hierarchy/transform은 31/88, body membership은 24/88 pass로 증가했다.
- remediation 정책은 same-extractor retry 최대 1회, partial import 금지, inferred joint의 native 증거 승격 금지로 고정했다.
- joints는 계속 0/88 pass이며 모든 종합 케이스는 `not_run`, release-ready false다.
- 다음 활성 작업은 large/non-rigid IGES 전용 라우팅과 native joint·inferred kinematics 증거 계층 분리 강화다.

### 2026-08-07 — 최신 workspace checkpoint v3

- `C:\tmp\nexyfab-workspace-checkpoint-260807-v3`에 최신 작업을 저장했다.
- 파일 842개, modified 109, untracked 733, deleted 1, binary patch 2개를 기록했다.
- 원본 842/842, 복사본 842/842, patch 2/2 SHA-256 독립 검증을 통과했다.
- file-set SHA-256은 외부 checkpoint의 `manifest.json`에 기록했다.
- HEAD는 `524a7b8afca2e449836e0f46b0f6725b5832b03b`, branch는 `feat/landing-chat-first`다.
- Phase A를 완료하고 다음 활성 작업을 Phase B corpus 32건 확보 및 approval 흐름으로 전환한다.

### 2026-08-07 — Phase B reviewer packet 1차

- 6개 제품군별 우선순위 5건, 총 30개 reviewer packet을 생성했다.
- 각 packet에 source hash/locator, artifact-set hash, required assertions, 자동 증거, 최신 native axis, license/holdout/assertion/dual-signoff 입력란을 결합했다.
- packet 30/30, unique case 30/30, artifact-set hash와 required assertion 검증 오류 0건이다.
- 자동·조기 승인 0건을 확인했으며 packet 생성은 승인 권한을 갖지 않는다.
- 기존 구조 탈락 후보는 총 12건이고 부족 제품군에서 재사용 가능한 후보는 0건이다.
- Corpus 부족은 Robot 11, Gearbox 3, Pressure vessel 9, Turbomachinery 9로 그대로 32건이다.
- 다음 활성 작업은 우선순위 30건의 사람이 작성한 license/holdout/assertion review와 독립 dual signoff이며, 동시에 새 독립 source 32건 확보가 필요하다.

### 2026-08-07 — Phase B human review ingestion

- 30개 packet을 case별 evidence-bound review form으로 내보냈다.
- 각 form의 SHA-256을 index에 고정하고 `immutableTarget` 변경을 제출 검증에서 차단했다.
- license, holdout, required assertion, domain signoff, independent signoff의 실제 ID·note·timestamp를 요구한다.
- 같은 reviewer의 이중 서명과 independent reviewer의 assertion 작성 참여를 차단했다.
- 현재 forms 30, submitted 0, pending 30, invalid 0, ready-for-import 0이다.
- 사람이 작성하지 않은 빈 form은 승인이나 score-eligible 상태가 되지 않는다.
- 다음 단계는 실제 reviewer 제출이 필요하며, 제출 전에는 승인 수 0/88을 유지한다.

### 2026-08-07 — Native joint evidence boundary

- joint provenance를 `native-cad`, `user-confirmed`, `geometry-inferred`로 분리했다.
- geometry inference는 visualization-only, user-confirmed는 editable-unverified로 제한했다.
- reviewer가 승인한 complete native CAD joint만 native KPI와 manufacturing release 대상이 된다.
- non-native claim이 `semanticsComplete=true`를 선언하면 fail하도록 차단했다.
- 현재 corpus 결과는 cases 88, geometry structure 31, native semantics complete 0, native joint 0, KPI eligible 0, manufacturing release 0, `not_run` 88, fail 0이다.
- 다음 활성 작업은 native worker가 없는 동안 user-confirmed/inferred joint를 UI·API 응답에서도 provenance와 함께 유지하고 release certificate에서 제외하는 parity 검증이다.
