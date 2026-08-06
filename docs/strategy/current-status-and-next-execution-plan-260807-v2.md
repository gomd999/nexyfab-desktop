# Nexyfab AI CAD 현재 상태 점검 및 다음 실행 계획 v2

- 기준일: 2026-08-07
- 기준 workspace: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 목적: 일반인부터 전문가까지 채팅으로 제조 가능한 다중 부품 CAD/건축·인테리어 모델을 만들고 Web·API·CLI·MCP에서 동일하게 제공
- 정확도 원칙: 실행 증거와 승인된 ground truth가 없는 기능은 `pass`로 계산하지 않는다.

## 1. 결론

기반 구현과 검증 체계는 상당히 구축됐지만 서비스 전체가 95% 정확도에 도달한 상태는 아니다. 현재 확실히 말할 수 있는 것은 다음과 같다.

- 통합 구현 감사는 통과 상태이며 최신 검사 수와 artifact-set hash는 감사 manifest에서 관리한다.
- 핵심 계약 회귀 테스트 27/27과 TypeScript 검사는 통과했다.
- 엄격 lineage corpus는 목표 120건 중 88건이며 32건이 부족하다.
- 88건 중 native definition/occurrence/hierarchy/transform 증거는 31건, body membership은 24건이다.
- native joint 증거는 0/88이다.
- 외부 native worker 작업 108건은 실행 엔진과 라이선스 부재로 전부 `not_run`이다.
- ground-truth reviewer 승인은 0/88이다.
- 실제 AI 1,800회 campaign은 아직 시작 조건을 충족하지 못했다.

따라서 현재 단계는 “CAD 생성·검증 플랫폼 기반과 fail-closed 증거 체계 완성도는 높음, 실제 복잡 제품 정확도 인증은 미완료”로 평가한다.

## 2. 최신 검증 기준선

### 2.1 코드 및 artifact 무결성

| 항목 | 결과 |
|---|---:|
| 통합 감사 | pass, 최신 수치는 감사 manifest 참조 |
| 감사 artifact set SHA-256 | 감사 실행마다 manifest에 기록 |
| 핵심 회귀 테스트 | 6 files, 27/27 pass |
| TypeScript | pass |
| `git diff --check` | pass |
| 작업 트리 경로 | 466 |
| modified | 109 |
| deleted | 1 |
| untracked | 356 |

위 466은 `git status --short`의 디렉터리 축약 항목 수다. 최신 checkpoint에서 untracked 디렉터리를 파일 단위로 펼친 실제 보호 대상은 842개 파일이다.

통합 감사 통과는 등록된 구현 파일과 evidence artifact가 존재하고 해시 가능하다는 뜻이다. 복잡 제품 생성 정확도 95%를 뜻하지 않는다.

### 2.2 corpus와 승인

| 제품군 | 현재 | 목표 | 부족 |
|---|---:|---:|---:|
| Robot | 9 | 20 | 11 |
| Gearbox | 17 | 20 | 3 |
| Pressure vessel | 11 | 20 | 9 |
| Turbomachinery | 11 | 20 | 9 |
| Factory equipment | 20 | 20 | 0 |
| Interior | 20 | 20 | 0 |
| 합계 | 88 | 120 | 32 |

- source lineage 후보 중 중복 snapshot은 분리·정리됐다.
- source hash preflight는 88개 요청에 연결돼 있다.
- ground-truth 승인: approved 0, pending 88, invalid 0.
- 승인되지 않은 candidate는 정확도 분모의 정답으로 사용하지 않는다.

### 2.3 native extraction

| 축 | pass | not_run | coverage |
|---|---:|---:|---:|
| Part definitions | 31 | 57 | 35.2% |
| Body membership | 24 | 64 | 27.3% |
| Occurrences | 31 | 57 | 35.2% |
| Hierarchy | 31 | 57 | 35.2% |
| Rigid transforms | 31 | 57 | 35.2% |
| Units | 31 | 57 | 35.2% |
| Native joints | 0 | 88 | 0% |

현재 88개 케이스의 종합 상태는 모두 `not_run`이다. 대부분의 추출 결과가 잘못됐기 때문이 아니라 모든 필수 축, 특히 joint semantics가 채워지지 않았기 때문이다.

### 2.4 포맷 및 worker 상태

- FreeCAD/IFC 로컬 결과: 31개 case.
- STEP timeout remediation: 1건 복구.
- 남은 IGES blocker: 600초 timeout 1건, non-rigid scaling transform 1건.
- ZIP 28건: FreeCAD 지원 교환 포맷 member 0, 원본 CAD/DWG/RVT worker로 라우팅.
- 전체 routing: 88/88 case, 141 jobs, unrouted 0.
- 로컬 jobs: 33.
- external native jobs: 108.

| External worker | jobs | health | canary |
|---|---:|---|---|
| SolidWorks | 35 | not_run | blocked |
| Inventor | 33 | not_run | blocked |
| Creo | 16 | not_run | blocked |
| Exact DWG | 16 | not_run | blocked |
| Revit | 6 | not_run | blocked |
| CATIA | 1 | not_run | blocked |
| Parasolid | 1 | not_run | blocked |

worker command가 없기 때문에 execution 결과는 requested 108, accepted 0, not_run 108, fail 0이다. 이는 parser fail과 구분된다.

## 3. 현재 구현됐다고 볼 수 있는 기반

- 다중 part definition과 occurrence를 분리한 assembly 계약
- source/ZIP-member SHA-256 lineage
- body membership, hierarchy, rigid transform의 축별 판정
- native joint와 inferred kinematics의 비승격 경계
- STEP/STP/IGS 및 IFC 로컬 추출 경로
- 외부 CAD worker routing, 실행 계약, resume, timeout, result validation
- worker health, license/capability validation, deterministic canary gate
- 오류를 pass/fail/not_run으로 분리하는 fail-closed 체계
- generation checkpoint/resume, repair/rollback, 선택 기반 편집, Web/API/CLI/MCP 기반 구현
- standalone HTML의 다중 부품 transform/animation 기반

위 항목은 기반 구현 존재를 의미한다. 모든 복잡 제품에서 제조 정확도가 승인됐다는 의미는 아니다.

## 4. 아직 완료로 볼 수 없는 핵심

### 4.1 제조 CAD

- SolidWorks/Inventor/CATIA/Creo 원본의 native feature, mate, constraint 복원
- native joint 0/88 해소
- precise motion/collision/clearance의 승인된 제품군별 증거
- 단일 body로 파괴되지 않는 assembly roundtrip의 실제 holdout 승인
- 도면·공차·재료·가공성까지 포함한 manufacturing release certificate

### 4.2 건축·인테리어

- IFC 4건에서 product 6,310개를 읽었지만 폐곡면 체적은 2,583개이고 열린 표면은 3,727개다.
- 창문·문·계단·복도·베란다·곡선 건축물의 의미 보존을 제품군 holdout에서 승인하지 않았다.
- Revit native hierarchy/constraint worker가 없다.
- 조명/Radiance, 공간 배치, 동선, 법규, 구조·MEP 충돌을 하나의 release gate로 묶은 실제 campaign이 없다.

### 4.3 서비스 운영

- 현재 배포 사이트 AI 연결은 이 점검 묶음에서 production credential로 재검증하지 않았다.
- Web/API/CLI/MCP parity는 기반 구현이 있으나 최신 배포에서 3회 연속 전체 통과 증거가 없다.
- AI 1,800회 campaign, 각 축·제품군·Tier 95%, 3회 연속 통과가 없다.

## 5. 위험 및 blocker 우선순위

| 우선순위 | blocker | 영향 | 해소 조건 |
|---|---|---|---|
| 해소 | 최신 변경 checkpoint | 842개 파일과 patch 2개 보호 완료 | 후속 대규모 변경 뒤 재생성 |
| P1 | corpus 32건 부족 | 120-case campaign 불가 | 독립 source 32건 확보·중복 검사 |
| P1 | reviewer 승인 0/88 | 정확도 정답 부재 | dual signoff와 변경 요청 처리 |
| P1 | native worker 7종 부재 | 원본 CAD 108 jobs not_run | licensed host health+canary pass |
| P1 | native joints 0/88 | motion/assembly 정확도 인증 불가 | 제품군별 native joint ground truth |
| P2 | IGES 2건 미복구 | local extraction coverage 제한 | large/non-rigid IGES worker |
| P2 | IFC open surfaces 3,727 | exact solid/collision 제한 | authoritative geometry recovery |
| P2 | production parity 미검증 | 판매 사이트 AI 장애 위험 | credential-safe smoke 3회 |

## 6. 다음 실행 계획

### Phase A — 복구 가능 상태 갱신

1. [x] 최신 작업 트리 전체 checkpoint를 `C:\tmp\nexyfab-workspace-checkpoint-260807-v3`에 생성했다.
2. [x] 복사 파일 842개와 binary patch 2개의 SHA-256을 독립 재검증했다.
3. [x] restore 문서에 HEAD, branch, deleted path, manifest hash를 기록했다.

완료 결과: 파일 842/842, patch 2/2, file-set hash 통과, 삭제 경로 1개 기록, 오류 0건. File-set SHA-256은 외부 checkpoint의 `manifest.json`에 기록한다.

### Phase B — ground truth 분모 완성

진행 상황: 우선순위 reviewer packet 30건을 생성·검증했다. Packet hash·중복·required assertion·미승인 상태 검증은 30/30 통과했으며 실제 승인 수는 계속 0건이다. 기존 탈락 자료 중 부족분에 재사용 가능한 source는 0건으로 확인됐다.

1. Robot 11, Gearbox 3, Pressure vessel 9, Turbomachinery 9건을 추가 확보한다.
2. outer snapshot lineage와 내부 파일 중복을 다시 제거한다.
3. T1~T3 assertion graph를 생성한다.
4. reviewer A/B의 독립 승인과 disagreement resolution을 수행한다.

완료 조건: 120/120 독립 case, 승인 120/120, source hash 120/120, invalid/rejected unresolved 0.

### Phase C — native worker 연결

1. 실제 확보 가능한 Parasolid 또는 exact DWG worker부터 설치·라이선스를 확인한다.
2. `--health`를 3회 연속 통과시킨다.
3. deterministic canary 1건을 실행한다.
4. canary 결과의 definition/body/occurrence/transform/semantics를 reviewer가 확인한다.
5. 해당 worker family batch만 실행하고 hash-bound resume를 검증한다.
6. SolidWorks → Inventor → Revit → Creo/CATIA 순으로 확대한다.

완료 조건: 108/108 accepted 또는 각 미실행 건에 승인된 대체 native evidence가 존재하고 silent fallback이 0건이다.

### Phase D — joint·motion·collision 인증

진행 상황: native/user-confirmed/geometry-inferred joint 증거 등급과 release gate를 구현했다. 현재 88건에서 geometry structure 31, native semantics complete 0, native joint 0, KPI eligible 0, manufacturing release eligible 0이며 fail 0, `not_run` 88이다.

1. native mate/constraint를 joint IR로 변환한다.
2. inferred kinematics는 별도 `inferred` provenance로 유지한다.
3. 제품군별 최소 3개 native joint 승인 case를 만든다.
4. motion sweep, exact collision, clearance certificate를 동일 occurrence 좌표계에서 실행한다.
5. false-clear fixture와 near-contact tolerance fixture를 추가한다.

완료 조건: native joint required case 전부 pass, false-clear 0, inferred-to-native 승격 0.

### Phase E — 건축·인테리어 domain gate

1. IFC spatial hierarchy와 opening 관계를 ground truth에 포함한다.
2. wall/window/door/stair/corridor/balcony/curved envelope를 별도 축으로 검증한다.
3. room adjacency, circulation, lighting/Radiance, furniture clearance를 분리 평가한다.
4. Revit worker 결과와 IFC 결과의 허용 가능한 semantic equivalence를 정의한다.
5. 구조·MEP·건축·인테리어 충돌을 domain-specific tolerance로 검증한다.

완료 조건: 건축/인테리어 holdout 각 축 accuracy와 coverage 95% 이상, open-surface를 exact solid로 잘못 판정한 사례 0.

### Phase F — 실제 AI campaign

1. 6개 제품군 × 20 holdout × 5회 × 3 campaign = 1,800 runs를 실행한다.
2. S0~S8 checkpoint와 artifact hash로 중단 재개한다.
3. seed, model, prompt, tool version을 고정한다.
4. 요구사항·기능분해·part kernel·assembly·joint·제조 gate를 축별 평가한다.
5. failure taxonomy에 따라 deterministic repair만 수행한다.
6. 사용자 확정 필드는 보호하고 영향받은 downstream만 재생성한다.

완료 조건: 각 제품군·Tier·필수 축에서 accuracy와 coverage 각각 95% 이상, required gate 100%, false-verified 0, destructive merge 0, 전체 조건 3회 연속 통과.

### Phase G — 배포 및 표면 parity

1. production AI endpoint를 credential-safe 방식으로 점검한다.
2. 동일 요청을 Web/API/CLI/MCP에 보내 canonical response를 비교한다.
3. timeout, rate limit, retry, idempotency, resume를 검증한다.
4. OpenSCAD/FreeCAD/Radiance/native worker health를 배포 health에 연결한다.
5. standalone HTML multi-part 이동과 0~N frame animation을 회귀 검증한다.
6. quote/RFQ 흐름이 제품 생성 경로에 다시 노출되지 않았는지 확인한다.

완료 조건: production smoke와 parity가 3회 연속 통과하고 AI 연결 끊김·silent fallback·무표시 근사 결과가 0건이다.

## 7. 즉시 실행 순서

`A checkpoint(완료) → B corpus/approval → C worker → D joints → E architecture/interior → F 1,800 campaign → G deployment parity`

병렬 가능한 범위:

- corpus 수집은 제품군별로 병렬 가능하다.
- reviewer 승인은 source 검증 이후 case별 병렬 가능하다.
- worker host는 vendor별 병렬 구축 가능하다.
- 건축 domain assertion 작성은 기계 joint 작업과 병렬 가능하다.
- campaign은 ground truth와 worker 증거가 고정된 뒤 제품군별 병렬 가능하다.

## 8. 정확도 보고 규칙

- `pass / eligible denominator`와 `coverage / required denominator`를 함께 보고한다.
- `not_run`을 분모에서 제거해 정확도를 높이지 않는다.
- approximate mesh/AABB/display mesh를 exact B-rep으로 계산하지 않는다.
- inferred joint를 native joint로 계산하지 않는다.
- reviewer 미승인 assertion을 정답으로 사용하지 않는다.
- 전체 95%는 각 제품군·Tier·필수 축이 모두 95% 이상일 때만 선언한다.

## 9. 작업 추적 표

| ID | 작업 | 현재 | 목표 | 상태 |
|---|---|---:|---:|---|
| A1 | 최신 checkpoint | 842/842 파일, patch 2/2 검증 | 최신 작업 보호 | complete |
| B1 | corpus | 88 | 120 | blocked |
| B2 | ground truth 승인 | packet 30/88, 승인 0/88 | 120/120 | in_progress |
| C1 | native worker health | 0/7 | 7/7 | blocked |
| C2 | external jobs | 0/108 | 108/108 | blocked |
| D1 | native joints | boundary gate 완료, native 0/88 | required case 전부 | in_progress |
| E1 | architecture/interior domain campaign | 미실행 | 각 축 ≥95% | pending |
| F1 | AI campaign | 0/1,800 | 1,800 | blocked |
| F2 | accuracy/coverage | 미인증 | 각 그룹 ≥95% | blocked |
| G1 | production parity | 최신 미검증 | 3회 연속 pass | pending |

## 10. 재현 명령

```powershell
node scripts/audit-ai-cad-baseline.mjs
npx tsc --noEmit --pretty false
npm run evidence:native-worker-routing
npm run evidence:native-worker-preflight
npm run evidence:native-worker-health
npm run evidence:native-worker-canary-gate
npm run evidence:native-remediation-report
```

이 문서는 이후 각 작업 묶음이 끝날 때 실제 수치, evidence 경로, 새 blocker와 해소된 blocker를 갱신하는 기준 문서로 사용한다.
