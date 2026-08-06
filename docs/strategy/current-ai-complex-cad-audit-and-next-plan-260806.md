# AI 복잡 제품 CAD 현재 감사 및 다음 실행 계획

> 감사일: 2026-08-06  
> 결론: 기반 계약과 MeArm reference baseline은 구축됐지만, 실제 AI 복잡 제품 생성 정확도 95%와 전체 parity는 아직 달성되지 않았다.

## 1. 이번 감사에서 다시 확인한 것

- 핵심 신규/연결 회귀: 12 test files, 59 tests 전부 통과.
- 포함 범위: product bundle, mesh evidence, assembly fusion, native evidence/adapter, joint motion planner, benchmark v2, S0~S8 checkpoint, product architecture, motion sweep, continuous CCD, OCCT precise interference/TOI.
- 신규 AI/reference/CLI 파일 ESLint 통과.
- 전체 TypeScript `tsc --noEmit` 통과.
- 관련 변경 `git diff --check` 통과.
- MeArm 영속 evidence 존재:
  - bundle 151 files
  - mesh occurrences 93: pass 87, fail 0, not_run 6
  - semantic definitions 35
  - X_T bodies 141, membership unresolved 48
  - native extractor 없음
- MeArm benchmark v2:
  - reference ground-truth run 1
  - reference assertions 1 pass / 9 not_run
  - AI generation runs 0
  - eligible false

## 2. 요청 목록별 정확한 상태

| 항목 | 상태 | 현재 구현 | 완료에 필요한 것 |
|---|---|---|---|
| part intent별 kernel/topology/dimension/feature gate | 구현 완료·실데이터 확대 필요 | `partGenerationCertificate.ts`, fail-closed 4축 판정과 negative test | 실제 6개 제품군 evidence 연결 |
| product definition/occurrence/hierarchy/transform/joint assembly gate | 구현 완료·실데이터 확대 필요 | `productAssemblyCertificate.ts`, 하위 part/transform/joint 독립 gate | 실제 native assembly case 검증 |
| native STL local geometry와 motion·precise collision·clearance certificate | 구현 완료·실데이터 확대 필요 | hash-bound local mesh, solver/precise interval/native clearance 통합 certificate | 실제 native assembly motion baseline 연결 |
| 오류 taxonomy·deterministic repair registry·mutation boundary | 구현 완료·registry 확대 필요 | 공통 code registry, fingerprint 반복 한도, 허용 mutation 경계 | 실제 repair executor 연결 및 제품군 오류 코드 확대 |
| 사용자 확정 필드 보호와 국소 downstream 재생성 | 구현 완료·executor 연결 필요 | locked ancestor/descendant 차단, rollback 및 downstream stage 산출 | 실제 checkpoint repair executor 연결 |
| 현재 corpus T1~T3 assertion graph migration 및 reviewer 승인 흐름 | 계약 완료·전체 migration 필요 | graph/cycle 검증, artifact/tolerance-bound reviewer 승인 | 전체 corpus migration CLI와 review UI |
| 제품군별 20 holdout×5회×3 campaign resume 가능한 AI runner | 실행 계층 완료·실제 campaign 미실행 | 120-case minimum, 1,800 slot, 원자적 checkpoint, retry/resume, suite/result hash 검증 CLI | 승인 holdout 120개와 실제 generation executor를 연결해 실행 |
| 6개 제품군 실제 baseline | 미완료 | MeArm robot reference baseline만 존재 | 각 가족 T1~T3 승인 corpus와 실제 AI runs |
| 각 축·제품군·Tier accuracy와 coverage 95% 개선 반복 | 미완료 | 계측식과 95% policy 구현 | 실제 baseline, 오류 Pareto, 반복 개선 및 재측정 |
| 3회 연속 전체 통과·Web/API/CLI/MCP parity | 미완료 | 일부 기존 API/CLI/MCP 및 계약 시험 존재 | v2 생성/검증 core의 네 표면 통합과 3회 실제 통과 |

따라서 “이 목록이 다 됐다”는 답은 사실이 아니다. 현재는 측정·evidence·checkpoint·architecture·native adapter의 기반이 갖춰진 상태다.

## 3. 완료된 기반

1. Product lineage 및 source SHA-256 bundle.
2. 93개 STL occurrence 실측과 open mesh fail-closed.
3. SLDASM sidecar v1.1 계약과 rigid transform 검증.
4. revolute native joint → signed HingeMate adapter.
5. full-range joint motion plan과 budget `not_run`.
6. benchmark v2의 14개 축, micro/macro/coverage/family/tier/stability.
7. reference ground truth와 AI generation run 분리.
8. S0~S8 ordered checkpoint, resume history, rollback과 locked intent.
9. requirement/product/subassembly/part/body/interface architecture 계약.
10. 기존 continuous CCD, precise mesh/OCCT와 TOI bracket 회귀 확인.

## 4. 다음 실행 순서

### Phase A — Gate 분리

#### A1 Part certificate

- 입력: part definition, body intent, FeatureTree, kernel evidence, requested dimensions/features.
- 판정: build, closed/manifold, intended body count, dimension tolerance, feature precision/recall, DFM applicable status.
- `single_body`만 solidCount=1 요구.
- `multi_body`는 expectedBodies와 body membership을 검사.
- 출력: `nexyfab.part-generation-certificate.v1`.

#### A2 Product assembly certificate

- definition/occurrence precision·recall.
- hierarchy edge F1, transform error, joint pair/type/axis/origin/limit.
- solver residual, rank DoF, static/motion collision, minimum clearance.
- 모든 required part certificate를 artifact hash로 참조.
- 출력: `nexyfab.product-assembly-certificate.v1`.

완료 조건: single-body 규칙이 product 전체에 적용되는 사례 0건, 누락 part certificate가 assembly pass로 승격되는 사례 0건.

### Phase B — Native geometry와 motion certificate

1. hash-bound STL triangle loader.
2. assembly-world STL을 native occurrence inverse transform으로 local coordinates 복원.
3. local triangle/AABB/centroid 재계산과 roundtrip pose 비교.
4. open mesh는 precise unavailable, closed mesh만 precise candidate.
5. motion frames broad phase → precise refinement → TOI bracket.
6. minimum clearance와 geometry fidelity 기록.
7. intended contact는 interface ID와 justification 필수.

완료 조건: known-clear/collision fixture, open-mesh negative, first-contact bracket ≤1 frame, unresolved 0일 때만 release-ready.

### Phase C — Repair controller

- 공통 오류군: input/intent/schema/transport/feature/kernel/topology/body/mate/joint/collision/unit/export/timeout/budget.
- 오류 코드마다 deterministic repair 후보, 허용 stage, 허용 mutation path, 최대 시도와 rollback stage 정의.
- locked intent 경로와 ancestor/descendant 충돌을 검사.
- dependency graph에서 영향 part/subassembly만 재생성.
- 같은 원인 3회 반복 시 blocker로 전환.

완료 조건: repair 선택 정확도 95%, 확정 필드 변경 0, 전체 assembly 초기화 비율 ≤5%.

### Phase D — Corpus review와 runner

1. 전체 후보를 T1~T4, family, lineage group으로 inventory.
2. assertion별 expected value, tolerance, provenance와 evidence hash 작성.
3. reviewer status: draft/reviewed/approved/rejected.
4. approved만 kpiEligible.
5. 6 families × 20 independent cases × 5 repeats × 3 campaigns runner.
6. checkpoint 기반 resume, transport와 geometry failure 분리.

완료 조건: 가족별 20 approved cases, 중복 lineage 누수 0, 모든 실행 hash/version/seed 기록.

### Phase E — 95% 개선과 parity

1. 최초 실제 baseline.
2. family/tier/axis/error별 Pareto.
3. 한 원인군씩 수정 후 전체 holdout 재실행.
4. accuracy와 coverage 둘 다 95% 이상.
5. false verified/false clear/destructive merge 0.
6. 3개 연속 campaign 통과.
7. 동일 core를 Web·API·CLI·MCP에 연결하고 certificate snapshot 비교.

## 5. 다음 즉시 구현 묶음

1. ~~`partGenerationCertificate.ts` 및 negative tests.~~ 완료 (`4/4`).
2. ~~`productAssemblyCertificate.ts` 및 missing-part/joint/transform tests.~~ 완료 (`3/3`).
3. ~~native STL triangle/local-geometry adapter.~~ 완료 (`3/3`).
4. ~~native motion·precise collision·clearance verification certificate.~~ 완료 (`4/4`).
5. ~~repair taxonomy/registry와 mutation boundary.~~ 완료 (`5/5`).
6. ~~reviewer approval schema와 assertion graph 계약.~~ 완료 (`4/4`).
7. ~~전체 corpus migration CLI와 resumable campaign runner.~~ 실행 계층 완료 (`4/4`), 실제 corpus 승인·campaign 실행은 계속 진행.

현재 추가 묶음 전체는 `27/27` 단위 테스트와 ESLint, 전체 TypeScript 검사 및 `git diff --check`를 통과했다. 이 통과는 계약·runner 구현의 회귀 검증이며, 승인 holdout 120개에 대한 실제 1,800회 AI 생성이나 6개 제품군 정확도 95% 달성을 뜻하지 않는다.

## 6. 실제 holdout 준비 현황

`참고파일들`의 제품 단위 CAD/assembly/archive 897개를 스캔하고 해시·lineage 중복을 제거한 review queue를 `docs/evidence/complex-holdout-review-260806`에 영속화했다.

| 제품군 | 독립 후보 | 선택된 review 후보 | 20개 대비 부족 |
|---|---:|---:|---:|
| robot | 49 | 20 | 0 |
| gearbox | 46 | 20 | 0 |
| pressure_vessel | 24 | 20 | 0 |
| turbomachinery | 19 | 15 | 5 |
| factory_equipment | 35 | 20 | 0 |
| interior | 68 | 20 | 0 |

구조 검사를 통과하지 못한 이름뿐인 archive를 제외한 현재 draft corpus는 115 case이며 assertion graph migration까지 완료됐다. 선택 후보의 preflight는 `fail 0 / not_run 115`이고, reviewer 승인 assertion은 0개라 모두 KPI 제외 상태다. 내부 개발에 이미 사용한 `예시 제트엔진_NX-TJ520`은 holdout 누수 방지를 위해 부족한 turbomachinery case에 포함하지 않았다.

실제 1,800회 campaign의 현재 차단 조건은 다음 두 가지다.

1. 독립적이고 제품 구조를 포함한 turbomachinery holdout 후보 5개 추가 확보.
2. 120 case의 provenance/license, native 구조, 좌표계, tolerance와 assertion graph reviewer 승인.

### 자동 사전검토 진행

- 선택된 115 case의 source hash는 모두 재검증됐다.
- 구조 없는 archive를 제거한 뒤 preflight는 `fail 0 / not_run 115`다. `not_run`은 주로 license 승인과 native extractor 의존 항목이다.
- STEP/IFC와 archive 내부 exchange/native 파일을 분석한 구조 증거는 part definition `51 pass / 64 not_run`, occurrence `25 pass / 90 not_run`, hierarchy `25 pass / 90 not_run`, units `38 pass / 77 not_run`이다.
- `review-worklist.json`에 자동 증거와 reviewer 결정 필드를 case/assertion별로 연결했다.
- 자동 구조 측정은 라이선스·holdout 격리·공학 tolerance 승인을 대체하지 않으며 KPI 승격을 수행하지 않는다.
- FreeCAD 1.1.3 설치와 `FreeCADCmd` headless 실행을 확인했다. SolidWorks, Inventor, CAD Exchanger, ODA extractor는 아직 없다.
- 115개 source-hash-bound native extraction 요청을 생성했고, 결과 수신 검증 계약/CLI를 구현했다.
- 직접 STEP/STP 24건은 FreeCAD로 실제 import했다. 최초 `23/24` 후 대형 pressure-vessel STEP을 300초 제한으로 재시도해 `24/24`를 완료했다.
- ZIP 43건에서는 내부 STEP/STP 11건을 추가로 실제 import했고, 32건은 지원 member 부재로 명시적 skip했다. ZIP hash와 내부 member SHA-256을 함께 고정했다.
- 병합된 FreeCAD 결과는 35건이다. definition/occurrence/hierarchy/rigid transform/units는 각각 `35 pass / 80 not_run`, joint는 `0 pass / 115 not_run`이다. 전체 release는 계속 `false`다.
- 35건에서 FreeCAD 문서 객체 definition/occurrence 19,674개를 추출했다. 이 수는 reviewer가 원본 semantic definition과 대조하기 전에는 KPI ground truth가 아니다.
- 동일 gearbox STEP 재추출 artifact hash가 일치해 deterministic extraction을 확인했다.
- 결과 계약은 case/source hash 불일치, 중복 ID, parent cycle, 비강체 4×4 transform, 잘못된 joint endpoint를 `fail` 처리하며 joint 완전성 미선언은 `not_run`으로 유지한다.
- FreeCAD 검증을 reviewer worklist v2에 병합해 35 case의 artifact-bound 자동 증거를 assertion에 연결했다.
- 남은 native 작업은 실제 source 형식에 따라 SolidWorks COM 45, Inventor COM 13, CATIA/CAD Exchanger 1, Creo/Solid Edge 2, Parasolid/CAD Exchanger 1, manual interface review 34, unsupported source triage 19로 분리했다.
- `manual-interface-review`는 STEP에서 이미 소실된 원본 mate를 FreeCAD나 AI가 발명하지 않도록 분리한 작업이다.

각 묶음은 unit test → lint → typecheck → 실제 evidence 실행 → 정책 조정 → 재실행 순으로 종료한다.
