# 참고 자료 기반 CAD 정확도 다음 통합 계획

## 1. 결론

참고 자료에는 아직 쓸 것이 많다. 다음 목표는 새 데모를 늘리는 것이 아니라 아래 폐루프를
완성하는 것이다.

`원본 CAD → 증거 IR → 부품/어셈블리 복원 → exact B-rep → 원본과 정량 비교 → 오류별 수리 → STEP 재검증`

견적·RFQ는 전 범위에서 제외한다. AI는 형상을 제안하고 관계를 분류하지만, 통과 여부는
결정론적 커널·공학 계산·골든 코퍼스가 판정한다.

## 2. 자료별 남은 활용 가치

### 2.1 `참고파일들/result`

- 1,071개 실행 가능 파일과 A~F 복원 등급을 정확도 회귀 데이터로 사용한다.
- A/B 261개는 파라메트릭 FeatureTree 복원 후보, C 445개는 어셈블리 분해 후보로 사용한다.
- D/F 365개는 AI 생성 대상에서 차단한다. 자유곡면 또는 근거 부족 모델을 그럴듯한 가짜
  파라메트릭 형상으로 바꾸지 않는다.
- 기하 중복 146개는 hash/signature로 묶어 한 번만 처리한다.
- `partial`, `truncated`, `units_unknown`은 성공으로 승격하지 않는다.

### 2.2 실제 기계 어셈블리

- `robotic-arm-466`: 부품 계층, joint axis, pose, 반복 부품의 골든 기준.
- `robot-5-dof-2`: STEP/X_T/Inventor 파일 간 부품명·인스턴스·조립 관계 대조.
- `C5055 motor`: housing, mount, stator, rotor의 구매품/제작품 분해와 동축 관계.
- cycloidal/helical/worm gearbox: shaft-bearing-gear 관계, 반복체, 백래시·간극 검증.
- cylinder, cabinet, welded equipment: 표준 연결, 판금, 용접물, cut-list 검증.

### 2.3 NIST PMI와 IFC

- NIST AP242는 semantic PMI와 graphical PMI를 분리하고 면·edge 참조 보존을 검증한다.
- AP203 geometry-only 파일은 PMI가 없다는 사실을 `not_run`으로 유지하는 음성 대조군이다.
- IFC4.3은 GUID, hierarchy, placement, material, quantity, georeference를 기계 STEP과 별도
  openBIM 트랙에서 검증한다.

### 2.4 CAD 통합 백과사전과 매뉴얼

- 모델 정확도를 형상·위치·의미·행동·생산 정확도로 분리해 각각 독립 점수화한다.
- 모델 크기 기반 상대 공차를 boolean, sewing, topology matching에 적용한다.
- NURBS 품질, naked edge, 짧은 edge, 곡률 불연속을 자유곡면 게이트로 사용한다.
- 공차 누적, 조립 순서, 공구 접근, 정비 envelope, 변형 후 간섭을 release gate에 넣는다.
- 백과사전의 구조·열·피로·유체 식은 계산기 후보 생성에 사용하되, 적용 조건과 단위를
  검증하지 못하면 결과를 인증하지 않는다.

### 2.5 LLM 방법론

- AI에게 최종 성공/실패를 묻지 않고 `extrude/revolve/pattern/freeform`, `part/subassembly`,
  `shaft/bearing/housing` 같은 관계만 구조화해서 받는다.
- 동일 모델 3~5회 자기일관성과 결정론적 veto를 사용한다. 불일치는 자동 적용하지 않는다.
- 파일 hash, 프롬프트 버전, 모델, 회차별 결과를 체크포인트에 분리한다.
- 골든 제품은 프롬프트 예제에 넣지 않고 holdout으로 유지한다.

## 3. 실행 묶음 A — Evidence IR v2와 실제 OCCT 추출

### 구현

- 기존 IR의 metadata 중심 STEP 분석을 OCCT 실측으로 승격한다.
- body/shell/face/edge 수, 면·곡선 종류, bbox, volume, area, centroid, inertia를 기록한다.
- assembly definition/occurrence/transform와 반복 instance를 별도 보존한다.
- 단위의 `declared/inferred/unknown`, 전체/부분 파싱, 원본 hash를 필수화한다.
- 평면·원통·원뿔·구·토러스·회전면·압출면·B-spline을 분류한다.

### 합격 조건

- Core A등급 STEP 18개 전부와 Challenge B등급 STEP 7개에서 커널 import와 BRepCheck 실행.
- 실측하지 않은 속성은 `not_run`; 추정치를 exact로 표시한 사례 0건.
- 동일 입력 hash에서 IR byte-equivalent 재생성.
- API `cad/v1/reference/analyze`, CLI `reference analyze`, MCP `analyze_cad_reference` 동일 계약.

## 4. 실행 묶음 B — 파라메트릭 역복원기

### 구현

- analytic surface adjacency graph에서 base primitive와 가공 feature 후보를 찾는다.
- hole/coaxial-hole, pocket, boss, extrude, revolve, fillet, chamfer, linear/circular pattern을
  FeatureTree로 복원한다.
- 후보마다 원본 B-rep과 재생 B-rep의 volume, bbox, surface-area, section, sampled distance를 비교한다.
- 한 번에 전체를 생성하지 않고 base → major features → repeated features → finishing 순으로 추가한다.
- 자유곡면 지배 또는 모호한 feature 순서는 imported B-rep body로 보존하며 가짜 history를 만들지 않는다.

### 합격 조건

- Core A등급 STEP 18개에서 import 성공 100%. Challenge B 7개는 지원 범위와 실패 원인을 측정한다.
- bbox 각 축 오차 ≤0.1%, volume 오차 ≤0.5%, 주요 hole/pattern recall ≥95%.
- exact 기준 미달 결과의 자동 확정 0건.
- 재생 실패 시 마지막 유효 feature까지 원자 rollback.

## 5. 실행 묶음 C — 가져온 B-rep 직접 편집 확대

### 구현 순서

1. 현재 평면 push/pull의 면 서명에 surface type, area, centroid, normal, adjacency를 추가한다.
2. 편집 전후 위상 대응을 `matched/split/merged/lost/new`로 반환한다.
3. 평면 offset 뒤 작은 edge 제거, sewing, shape healing을 증거와 함께 실행한다.
4. 원통면은 반경 변경, 원뿔면은 angle/radius 변경처럼 해석적 파라미터 편집으로 제한한다.
5. 일반 NURBS는 control-point 편집과 replace-face를 별도 experimental 경로로 두고 release gate에서 차단한다.
6. arbitrary-face shell/offset은 주변 면 연장·trim과 최소 두께 검증 후 지원한다.

### 합격 조건

- box, bracket, flange, motor mount 골든 STEP에서 선택 면 재식별률 ≥99%.
- 편집 후 invalid B-rep, unintended solid count change, zero-thickness 성공 판정 0건.
- 곡면 종류별 지원/미지원이 capability에 명시됨.

## 6. 실행 묶음 D — 어셈블리 역복원과 실제 다중 부품 정확도

### 구현

- STEP/X_T의 독립 body와 occurrence를 절대 하나의 body로 평탄화하지 않는다.
- 부품명, occurrence transform, 반복 인스턴스, subassembly depth를 Assembly IR로 변환한다.
- 동축·접촉 평면·거리·평행 관계를 mate 후보로 추출하되 AI는 관계만 분류한다.
- 코드가 residual, Jacobian rank, DoF, 간섭으로 mate 채택 여부를 결정한다.
- 로봇·모터·감속기 fixture에서 shaft-bearing-housing 축과 joint axis를 대조한다.

### 합격 조건

- 골든 4개 제품에서 unique part/instance/subassembly 수 recall 100%.
- transform 오차 ≤0.01 mm/0.01°, 의도하지 않은 part merge 0건.
- mate precision ≥98%, 거짓 완전구속 0건.
- 원본 pose와 0~N frame motion 검증을 같은 assembly state에서 실행.

## 7. 실행 묶음 E — PMI·공차·제조 의미 보존

### 구현

- AP242 semantic PMI를 dimension, datum, tolerance, surface finish로 분해한다.
- PMI 대상 면을 위상 서명과 연결하고 편집 후 reconcile 결과를 기록한다.
- worst-case/RSS 공차 누적을 mate/interface chain에서 자동 생성한다.
- 판금은 bend allowance/K-factor, flat pattern, bend table, DXF를 서로 대조한다.
- 용접물은 member profile, trim, weld joint, cut-list, 질량을 대조한다.

### 합격 조건

- NIST 지원 PMI 항목의 값·단위·datum·target binding 완전 일치.
- graphical PMI만 있는 파일을 semantic PMI 통과로 오인한 사례 0건.
- 판금 접힘↔전개 왕복 치수 오차와 용접 cut-list 수량 불일치 0건.

## 8. 실행 묶음 F — 생성·수리 정확도 오케스트레이터

### 다단 생성

1. 요구사항과 미해결 조건 추출.
2. 기능 계통과 독립 부품 분해.
3. 인터페이스·기준축·장착면·운동 정의.
4. 각 부품 FeatureTree 생성.
5. exact kernel build와 topology 검사.
6. mate solve, DoF, static/motion interference 검사.
7. 공차·DFM·PMI·STEP roundtrip 검사.
8. 오류 class별 국소 수리 후 해당 단계부터 재검증.

### 오류별 수리

- Boolean: 교차 없음, 접선 접촉, 작은 면, tolerance mismatch를 분리한다.
- Shell: 최소 곡률 반경, 국부 두께, 제거 면 문제를 분리한다.
- Mate: under/over-constrained, redundant, inconsistent를 Jacobian 증거로 분리한다.
- Collision: AABB 과탐과 exact narrow-phase 접촉을 분리한다.
- Topology: split/merge/lost reference만 재선택 요청 대상으로 올린다.
- AI 재시도는 동일 실패를 세 번 반복하지 않고 deterministic repair 후보를 먼저 실행한다.

### 합격 조건

- 실패 원인 없는 일반 `generation_failed` 응답 0건.
- 한 부품 오류로 전체 어셈블리를 처음부터 재생성하는 비율 ≤5%.
- 자동수리 전후 geometry/evidence diff와 rollback artifact 100% 저장.

## 9. 실행 묶음 G — 코퍼스 평가와 배포 게이트

### 평가 계층

- Tier 1: Core A등급 STEP 18개 + Challenge B등급 STEP 7개.
- Tier 2: robot/motor/gearbox/cylinder/cabinet 어셈블리.
- Tier 3: NIST PMI, sheet-metal, weldment.
- Tier 4: 대형 STEP/IFC 스트레스와 partial/truncated 음성 사례.

### 공통 KPI

- import/roundtrip 성공률, part/feature/mate precision·recall.
- bbox/volume/area/mass/transform 오차.
- topology reference 생존률과 PMI binding 생존률.
- invalid B-rep, merge, overlap, unresolved mate, collision 수.
- 생성 시간, 커널 시간, AI 호출 수, 수리 횟수, 사용자 개입 횟수.

### 배포 차단 조건

- 골든 회귀 하락, exact 검증 누락, part flattening, RFQ 부작용이 하나라도 있으면 차단한다.
- 대용량/독점 포맷은 loader가 없으면 `not_run`이며 성공률 분모를 숨겨 조정하지 않는다.
- 운영 배포 전 API·CLI·MCP parity, production build, AI transport smoke를 함께 통과해야 한다.

## 10. 권장 구현 순서

1. A: OCCT Evidence IR v2.
2. B: Core A등급 STEP 18개 파라메트릭 역복원과 Challenge B 7개 한계 측정.
3. C: 영구 위상 서명과 원통/원뿔 직접 편집.
4. D: 로봇·모터·감속기 Assembly IR 및 mate 추론.
5. E: NIST PMI와 공차 chain.
6. F: 오류 분류·국소 수리 오케스트레이터.
7. G: 전체 코퍼스 release dashboard와 배포 게이트.

코리더·건축·토목·조경의 전용 생성은 이 기계 CAD 정확도 폐루프가 Tier 1~3을 통과한 뒤
별도 vertical로 진행한다. 독점 바이너리 변환기 설치도 이 계획의 선행조건으로 만들지 않는다.

## 11. 먼저 고정할 불변 규칙

아래 규칙은 모든 작업 묶음의 공통 완료 조건이다.

1. 제품은 `Product → Subassembly → Part → Body → Feature → Topology` 계층을 유지한다.
2. 서로 제조·구매·교체되는 부품을 boolean union하거나 단일 body로 평탄화하지 않는다.
3. mesh preview, AABB, AI 판정은 exact B-rep 또는 공학 검증을 대신하지 않는다.
4. `pass`, `fail`, `not_run`, `unavailable`을 구분한다. 누락을 pass로 간주하지 않는다.
5. 단위가 불명이면 형상 비율은 비교할 수 있지만 절대 치수·질량·공차는 인증하지 않는다.
6. source hash, parser/kernel revision, tolerance policy, 생성 prompt/model revision을 증거에 남긴다.
7. 입력 자료는 read-only이고 원본 CAD bytes, 경로, 제3자 자료를 모델 prompt나 저장소에 넣지 않는다.
8. 자동수리는 사용자가 확정한 치수·공차·재료·표준 부품을 임의 변경하지 않는다.
9. 모든 변경은 전후 diff, 실패 원인, 적용 repair, rollback 지점을 가진다.
10. Web·API·CLI·MCP는 하나의 core 함수를 호출하고 동일한 결과 schema를 사용한다.
11. 모든 새 CAD API는 입력 크기, NaN/Infinity, 압축폭탄, path traversal, timeout을 차단한다.
12. 견적·가격·공장 RFQ·외부 전송은 호출하지 않는다.

## 12. Phase 0 — 기준선과 골든 세트 동결

### P0-1. 코퍼스 manifest v2

- `src/lib/reference/cadCorpusManifest.ts`에 fixture id, source hash, format, grade, scenario,
  allowed-use, expected assertions, max bytes를 선언한다.
- 원본 절대경로는 실행 시 주입하고, 저장소에는 hash와 익명 fixture id만 둔다.
- 중복 146개는 canonical fixture와 alias로 연결한다.
- 제품 단위 holdout을 지정해 같은 제품의 부품이 학습/예제와 평가 양쪽에 섞이지 않게 한다.

### P0-2. 계층별 fixture 고정

| 계층 | 초기 fixture | 목적 |
|---|---|---|
| T1 analytic part | NIST geometry, flange, motor mount, heat-exchanger head | 역복원·치수 |
| T2 direct edit | box, bracket, flange, motor mount | 면 이름·편집·healing |
| T3 assembly | robotic arm, 5-DoF robot, C5055, gearbox | 부품·transform·mate |
| T4 manufacturing | NIST PMI, cabinet, weldment | PMI·판금·용접 |
| T5 negative | truncated STEP, units unknown STL, garbage STEP, freeform D/F | 거짓 통과 차단 |
| T6 scale | large STEP assembly, large IFC | 메모리·시간·부분처리 |

### P0-3. 기준선 보고서

- 기존 `corpus:inventory`, `corpus:verify` 결과를 새 schema로 한 번 저장한다.
- pass 비율만 쓰지 않고 fail/not_run/unavailable과 분모를 함께 기록한다.
- 이후 모든 묶음은 같은 fixture hash에 대한 before/after KPI를 남긴다.

### P0 완료 조건

- manifest schema 테스트, 중복·누락·hash mismatch 테스트 통과.
- 라이선스/출처 불명 fixture는 로컬 검증 전용으로 표시.
- 저장소 또는 prompt snapshot에 원본 CAD byte가 포함되지 않음.

## 13. Phase 1 — Evidence IR v2 세부 작업

### P1-1. 타입과 버전

새 모듈 후보:

- `src/lib/reference/cadEvidenceIr.ts`
- `src/lib/reference/cadEvidenceIrSchema.ts`
- `src/lib/reference/cadTolerancePolicy.ts`

필수 최상위 필드:

```ts
type CadEvidenceIrV2 = {
  version: 2;
  source: { fixtureId:string; sha256:string; format:string; bytes:number };
  parse: { status:'complete'|'partial'|'failed'; sampledRatio:number; warnings:string[] };
  units: { value:'mm'|'cm'|'m'|'inch'|null; source:'declared'|'inferred'|'unknown' };
  tolerance: { characteristicLengthMm:number|null; linearMm:number|null; angularRad:number };
  geometry: GeometryEvidence;
  topology: TopologyEvidence;
  assembly: AssemblyEvidence|null;
  semantics: SemanticEvidence;
  confidence: EvidenceConfidence;
};
```

### P1-2. OCCT bridge 확장

- `src/lib/occt/bridge.ts`에 surface/curve 분류, area, centroid, inertia, adjacency 추출 계약 추가.
- `src/lib/occt/nodeOcctBridge.ts`에서 각 값의 실제 커널 출처와 실패를 개별 기록.
- shape registry ownership을 명시하고 선택/실패 후보 shape를 해제해 WASM 메모리 누수를 방지.
- 한 파일 kernel timeout과 메모리 budget을 별도 worker/process 경계에서 적용.

### P1-3. 상대 공차 정책

- characteristic length는 bbox diagonal과 최소 비영점 축을 함께 고려한다.
- import sewing, boolean, topology match, metric comparison 공차를 서로 다른 이름으로 둔다.
- 작은 부품과 대형 설비를 동일 절대 공차로 판정하지 않는다.
- 원본 선언 tolerance가 있으면 보존하되 안전 상한/하한을 적용한 사실을 evidence에 기록한다.

### P1-4. 포맷 adapter

- STEP: pure parser의 assembly/PMI와 OCCT geometry를 병합한다.
- STL/OBJ: mesh evidence만 제공하고 analytic B-rep을 `not_run`으로 둔다.
- IFC: semantic hierarchy/placement와 geometry evidence를 분리한다.
- X_T: 현재 읽을 수 있는 body record만 evidence로 쓰고 assembly/mate는 인증하지 않는다.
- IGES/DXF/SCAD는 기존 adapter가 제공하는 증거만 명시적으로 매핑한다.
- 독점 바이너리는 loader가 없으면 파일명만 보고 포맷 성공으로 처리하지 않는다.

### P1-5. 진입점

- core: `analyzeCadReference(input, policy)`.
- REST: `POST /api/cad/v1/reference/analyze`.
- CLI: `nexyfab reference analyze --file ... --out evidence.json`.
- MCP: `analyze_cad_reference`.
- Web: 파일 분석 패널에서 진행 단계, partial/not_run, 단위 경고를 표시.
- capability와 OpenAPI에 최대 크기, 지원 포맷, exact 항목을 노출.

### P1 테스트

- 폐형/개방형, 다중 solid, inch/mm, mirrored transform, curved surfaces, garbage payload.
- 동일 shape의 STEP 왕복 metric 오차.
- deterministic JSON key order와 hash.
- timeout, 취소, memory cleanup, 30MB 경계, base64/UTF-8 입력.

## 14. Phase 2 — 파라메트릭 역복원기 세부 작업

### P2-1. Feature recognition IR

```ts
type RecognizedFeature = {
  id:string;
  kind:'base-extrude'|'base-revolve'|'hole'|'pocket'|'boss'|'fillet'|'chamfer'|'pattern';
  parameters:Record<string,number|string|number[]>;
  sourceFaces:string[];
  dependencies:string[];
  confidence:number;
  alternatives:FeatureAlternative[];
  evidence:string[];
};
```

- surface adjacency graph를 먼저 만들고 feature는 그 graph를 참조한다.
- through/blind/counterbore/countersink hole을 구분한다.
- 동축 원통 집합에서 shaft/hole/step 후보를 구분한다.
- 동일 geometry transform 집합에서 linear/circular/mirror pattern을 찾는다.
- fillet/chamfer는 마지막 feature 후보로 처리하고 base 인식에 방해되지 않게 suppress 비교한다.

### P2-2. 후보 탐색

1. 가장 큰 analytic volume의 base extrude/revolve 후보 생성.
2. face 제거 또는 virtual suppress로 major additive/subtractive feature 후보 계산.
3. 반복 후보를 개별 feature보다 pattern으로 우선 압축.
4. dependency DAG를 만들고 cycle을 차단.
5. 각 단계에서 실제 OCCT 재생 후 원본과 비교.
6. 최적 후보 하나만 숨겨 선택하지 않고 top-N과 점수 근거를 보존.

### P2-3. 정량 비교기

- global: solid count, bbox, volume, area, centroid, inertia.
- sectional: 주축별 여러 section의 loop 수와 면적.
- local: face surface type/area/radius/normal과 hole diameter/depth.
- distance: 원본/재생 tessellation 간 양방향 sampled Hausdorff 근사.
- semantic: feature count와 pattern membership.
- metric마다 tolerance, measured/not_run, pass/fail을 반환.

### P2-4. AI 사용 경계

- AI 입력은 Evidence IR과 feature alternatives만 사용하고 원본 파일을 보내지 않는다.
- AI 출력은 `relation`, `feature kind`, `dependency`, `ambiguity`로 제한한다.
- 동일 모델 반복 결과가 기준 미달이면 자동 FeatureTree 확정 금지.
- exact comparator veto가 AI confidence보다 항상 우선한다.

### P2-5. 편집 가능한 결과

- 인식된 feature는 기존 `FeatureTree`와 stable reference 체계를 그대로 사용한다.
- 인식 불가 잔여 형상은 `ImportedBrepFeature`로 분리하고 provenance hash를 유지한다.
- hybrid part에서 parametric feature와 imported body의 boolean 관계를 명시한다.
- 저장/불러오기/undo/redo/SCAD fallback/OCCT plan 모두 같은 hybrid tree를 처리한다.

### P2 테스트와 완료 조건

- 손으로 만든 synthetic feature 조합으로 precision/recall 단위 테스트.
- Core A 18개 golden parameter snapshot과 exact geometry 비교, Challenge B 7개는 단계별 coverage 비교.
- feature 순서가 다른 동등 형상, tangent hole, overlapping pattern, tiny fillet 음성 사례.
- 목표 수치 외에 `false exact reconstruction = 0`을 필수 gate로 둔다.

## 15. Phase 3 — 위상 식별과 직접 편집 세부 작업

### P3-1. `TopologySignatureV2`

- face: surface kind/parameters, area, centroid, normal/axis, loop count, adjacent edge signatures.
- edge: curve kind/parameters, length, endpoints, adjacent face signatures.
- vertex: quantized position과 incident topology.
- 절대 index가 아니라 다중 특징 비용함수로 matching하고 ambiguous 후보를 반환한다.

### P3-2. 위상 변화 그래프

- kernel history가 있으면 Generated/Modified/Deleted를 우선 사용한다.
- history가 없는 STEP 편집은 signature matcher로 보완한다.
- `one-to-one`, `split`, `merge`, `lost`, `new`, `ambiguous`를 구분한다.
- PMI, selection, mate, annotation 소비자가 같은 reconciliation 결과를 사용한다.

### P3-3. 직접 편집 연산 순서

1. 평면 push/pull 안정화와 reference 재식별.
2. planar replace-face와 adjacent surface extend/trim.
3. 원통 radius 변경과 coaxial adjacent face repair.
4. 원뿔 radius/angle 변경.
5. arbitrary planar shell/offset.
6. NURBS replace-face/control point는 experimental flag 아래 구현.

### P3-4. 실패 및 healing 정책

- zero thickness, inverted solid, self-intersection, sliver face, short edge를 별도 코드로 반환.
- healing 전후 topology/metric diff를 모두 남긴다.
- healing이 사용자 치수를 바꾸거나 solid 수를 바꾸면 자동 채택하지 않는다.
- reference ambiguity는 가장 가까운 면을 임의 선택하지 않고 재선택을 요구한다.

### P3 완료 조건

- 편집 100회 연속 실행에서 선택 ref 누락·WASM 누수 추세 없음.
- split/merge fixture에서 잘못된 PMI/mate 재부착 0건.
- API·CLI·MCP와 Web drag/chat가 동일 edit transaction을 사용.

## 16. Phase 4 — 어셈블리 역복원 세부 작업

### P4-1. Assembly Evidence IR

- definition과 occurrence를 분리해 동일 부품 재사용을 보존한다.
- occurrence id, parent, transform, quantity, source name, material, role을 기록한다.
- transform은 4×4 원본과 분해된 translation/quaternion/scale을 모두 검증한다.
- negative scale/reflection, unit conversion, deep subassembly를 별도 처리한다.

### P4-2. 접촉·축 후보 추출

- planar coincidence, concentric cylinder, parallel/perpendicular axis, distance, tangent 후보.
- bbox proximity는 broad phase일 뿐 mate 증거가 아니다.
- fit/tolerance와 실제 clearance가 선언된 접촉과 모순되는지 확인한다.
- 반복 fastener는 동일 definition의 occurrence pattern으로 보존한다.

### P4-3. mate 선정과 검증

- AI는 부품 역할과 관계 후보만 반환한다.
- solver가 residual, rank, intended DoF, interference로 채택한다.
- redundant와 inconsistent constraint를 분리하고 최소 충돌 집합을 보고한다.
- joint axis는 원본 motion 정보가 없으면 `inferred`, 사용자 확인 전 release 차단.

### P4-4. 조립·분해·정비

- 조립 순서 graph와 삽입 방향 후보.
- 공구 접근 cone/cylinder와 제거 swept envelope.
- service part를 제거할 때 필요한 선행 제거 부품 목록.
- 0~N frame animation, explode view, motion verification이 동일 occurrence id를 사용.

### P4 테스트

- robotic arm, 5-DoF robot, motor, gearbox 각각 part/instance/tree/pose golden.
- 동일 부품 반복, 이름 중복, 빈 이름, mirrored part, deep nesting.
- under/over constraint와 실제 간섭이 있는 음성 조립.
- STEP export→import 후 hierarchy와 transform 재비교.

## 17. Phase 5 — PMI·공차·제조 데이터 세부 작업

### P5-1. PMI schema

- dimension: linear/angular/radius/diameter.
- GD&T: datum, feature control frame, tolerance zone, modifier.
- surface: roughness, finish/process note.
- target: face/edge/axis/datum feature와 semantic/graphical source 구분.

### P5-2. AP242 왕복

- 기존 `ap242PmiEvidence`, `ap242GraphicalPmi`, `ap242PmiSemanticRoundtrip`을 하나의 report로 결합.
- export 후 재import하여 값·단위·datum 순서·target reference를 비교.
- AP203 음성 fixture에서 semantic PMI가 생성되지 않는지 확인.
- topology split/merge 시 PMI를 자동 이전할 수 없는 경우 `ambiguous`로 차단.

### P5-3. 공차 체인

- assembly interface graph에서 기능 치수 chain을 구성.
- worst-case, RSS, 필요 시 Monte Carlo는 각각 method와 가정을 표시.
- fit ISO 286, geometric tolerance, thermal expansion을 혼합할 때 단위와 기준 온도를 명시.
- 공차 만족이 nominal interference를 면제하지 않게 한다.

### P5-4. 제조별 검증

- machining: tool access, internal corner, drill aspect ratio, minimum wall, stock allowance.
- sheet metal: thickness consistency, bend radius, K-factor, relief, collision-free refold, DXF layer.
- weldment: profile identity, trim, weld length/group, cut-list quantity, mass.
- additive: watertight, overhang, minimum feature, trapped volume은 별도 process gate.

### P5 완료 조건

- 모든 제조 evidence에 measured value, criterion, unit, source가 존재.
- 계산은 됐지만 적용 기준이 없는 항목은 `informational`, pass가 아님.
- PMI/공차/제조 API·CLI·MCP 결과가 byte-normalized 동등.

## 18. Phase 6 — 다단 생성 및 국소 수리 상태기계

### P6-1. 상태 단계

`intent → decomposition → interfaces → part_programs → kernel → topology → assembly_solve → motion → manufacturing → roundtrip → release`

각 단계는 다음을 가진다.

- immutable input hash와 output artifact hash.
- `passed/failed/not_run/blocked` 상태.
- warnings, metrics, unresolved decisions.
- rollback checkpoint와 다음 허용 action.

### P6-2. 오류 taxonomy

| 영역 | 세부 코드 | 자동 처리 |
|---|---|---|
| 입력 | missing_dimension, conflicting_requirement, unknown_unit | 사용자 확인 |
| sketch | open_loop, duplicate_segment, under/over_constraint | 결정론 수리/보고 |
| feature | invalid_profile, collapse, axis_crossing | 해당 feature rollback |
| boolean | disjoint, tangent_only, tolerance, sliver | 순서·도구·공차 후보 |
| shell | radius_limit, local_thickness, bad_removed_face | 두께/면 후보 제시 |
| topology | lost, split, merge, ambiguous | reconcile 또는 재선택 |
| mate | under, redundant, inconsistent | 최소 충돌 집합/추가 mate |
| collision | broad_only, penetration, clearance | exact narrow phase |
| manufacturing | dfm_rule, tolerance, pmi_binding | 국소 feature/metadata 수정 |
| transport | auth, provider, timeout, malformed_stream | 재시도 정책/진단 |

### P6-3. 반복과 중단

- 동일 fingerprint가 반복되면 같은 prompt 재시도를 금지한다.
- 1차 deterministic repair, 2차 bounded alternative, 3차 사용자 선택 순서.
- 이미 통과한 독립 부품은 cache하고 실패 part/subassembly만 재실행한다.
- 새로운 수리가 이전 stage evidence를 무효화하면 그 단계부터만 재검증한다.
- cancel/timeout 후에도 마지막 유효 checkpoint를 복구한다.

### P6-4. 채팅·선택 편집 통합

- 자연어는 structured `EditIntent[]`로 변환한 뒤 현재 atomic transaction에 태운다.
- 면·선·부품 선택 context에 occurrence id, persistent ref, coordinate frame을 필수 포함.
- preview에는 실제 geometry diff, 영향 받은 mate/PMI/BOM, invalidated gates를 표시.
- 확정 전 원본 state를 변경하지 않고 stale revision을 차단한다.

## 19. Phase 7 — 서비스 진입점과 UX 누락 방지

### 공통 계약 체크리스트

- Zod 또는 동등 schema 한 곳에서 입력 검증.
- core 함수 하나, thin adapter 네 개(Web/API/CLI/MCP).
- 인증 필요 여부, rate limit, max payload, timeout, cancellation 명시.
- JSON error code와 HTTP/CLI exit code 대응표.
- binary artifact는 base64 또는 명시적 output file로 전달.
- progress event stage 이름은 상태기계와 동일.
- capability와 OpenAPI를 코드와 함께 갱신.
- legacy entrypoint는 공통 core로 위임하거나 명시적 deprecated 처리.

### Web UX

- 초보자: 요구 치수 확인 → 부품 분해 → 생성 → 문제 설명 → 수정 선택의 guided flow.
- 전문가: FeatureTree, topology id, tolerance, solver residual, evidence graph를 직접 확인.
- 선택한 면·선·부품에 대한 채팅 수정과 drag 편집이 같은 transaction으로 합쳐짐.
- 어셈블리 부품 이동, 0~N frame timeline, keyframe, collision 상태를 동시에 표시.
- exact/estimated/not_run 배지를 시각적으로 구분.

## 20. Phase 8 — 테스트 피라미드와 CI

### 단위 테스트

- schema validation, tolerance math, signature cost, feature recognition, metric comparison.
- mate relation, topology split/merge, repair decision, state transition.

### 커널 통합 테스트

- 실제 OCCT import/build/edit/heal/export/reimport.
- volume/bbox/count/BRepCheck뿐 아니라 area/centroid/inertia/section 비교.
- shape ownership과 반복 호출 memory 관찰.

### 계약 테스트

- 같은 fixture를 core/API/CLI/MCP에 넣고 normalized response 비교.
- capability/OpenAPI에 구현되지 않은 supported 항목이 없는지 검사.
- no RFQ/quote side-effect와 외부 fetch 없음 검증.

### UI/E2E

- 파일 import → 분석 → 파라메트릭 후보 → 면 선택 채팅 수정 → undo/redo → STEP export.
- 다중 부품 import → part move → mate → timeline animation → collision → standalone HTML.
- AI provider 장애, SSE 중단, 취소, 재시도, stale selection.

### 성능 테스트

- 작은 part p50/p95, 중형 assembly p95, 대형 파일 bounded failure.
- peak WASM memory, tessellation triangles, evidence JSON 크기.
- 캐시 hit/miss, 동일 part instance 재사용, 병렬 part build 제한.

### 퍼즈/강건성

- 0/음수/극대 치수, 거의 평행·접선·중복 geometry.
- malformed STEP/base64, Unicode part names, 깊은 assembly tree.
- 무작위 feature 순서와 undo/redo 후 invariant 검사.

## 21. Phase 9 — 보안·운영·관측성

- 업로드는 확장자가 아니라 magic/header와 parser 결과로 검증한다.
- 임시파일은 요청별 격리 폴더, 명시적 크기 제한, finally cleanup을 사용한다.
- CAD parser와 OCCT는 네트워크 없는 worker/process에서 실행한다.
- 로그에는 API key, 원본 CAD bytes, 전체 사용자 prompt, 절대 외부 경로를 남기지 않는다.
- metrics: stage latency, kernel failure code, repair count, not_run ratio, memory peak.
- 배포 후 AI health와 CAD kernel health를 분리해 진단한다.
- schema/version migration은 old fixture 재생 테스트를 포함한다.
- 기능 flag는 experimental NURBS edit처럼 exact 보장이 없는 기능에만 사용한다.

## 22. Phase 10 — 릴리스 판정표

| Gate | 통과 조건 | 실패 시 |
|---|---|---|
| R0 corpus | manifest/hash/license/holdout 완전 | 평가 중단 |
| R1 import | 지원 fixture import, invalid 판정 정직 | adapter 수정 |
| R2 reconstruct | 정량 기준과 false-exact 0 | 후보/인식 수정 |
| R3 topology | reference 생존·ambiguity 차단 | matcher 수정 |
| R4 assembly | part/instance/transform/DoF | flatten/mate 수정 |
| R5 manufacturing | PMI/공차/DFM 증거 | releaseReady=false |
| R6 roundtrip | STEP 계층·metric·PMI 재검증 | export 차단 |
| R7 parity | Web/API/CLI/MCP 동등 | 배포 차단 |
| R8 operations | build/smoke/security/perf | 배포 차단 |

`releaseReady=true`는 R0~R8이 모두 pass일 때만 가능하다. `not_run` 하나라도 release 필수
assertion에 있으면 false다.

## 23. 실제 작업 티켓 순서

### 묶음 1 — 기반과 실측

1. P0 manifest v2와 25개 T1 fixture 동결.
2. Evidence IR v2 schema와 migration.
3. OCCT surface/curve/area/centroid/inertia/adjacency 추출.
4. 상대 공차 정책과 metric comparator.
5. reference analyze core/API/CLI/MCP/Web.
6. 코퍼스 기준선 보고서.

### 묶음 2 — 단일 부품 정확도

7. topology adjacency graph.
8. base extrude/revolve recognition.
9. hole/pocket/boss recognition.
10. fillet/chamfer/pattern recognition.
11. staged FeatureTree reconstruction과 hybrid imported body.
12. Core A 18개 + Challenge B 7개 golden KPI와 repair rollback.

### 묶음 3 — 직접 편집

13. TopologySignatureV2와 history graph.
14. planar push/pull healing 및 persistent remap.
15. cylinder/cone parametric direct edit.
16. arbitrary planar shell/offset.
17. selection chat/drag/undo와 PMI/mate invalidation.

### 묶음 4 — 실제 어셈블리

18. definition/occurrence Assembly Evidence IR.
19. STEP hierarchy/transform roundtrip.
20. contact/axis relation extraction.
21. mate candidate validation과 DoF proof.
22. robot/motor/gearbox golden comparison.
23. assembly/service path와 timeline 연계.

### 묶음 5 — 제조 의미와 릴리스

24. AP242 PMI unified report와 roundtrip.
25. interface tolerance-chain 자동 구성.
26. sheet-metal/weldment golden validation.
27. generation state machine과 오류 taxonomy.
28. local repair/checkpoint/cache.
29. corpus dashboard와 R0~R8 release gate.
30. production build, security/performance smoke, 배포 승인 판단.

## 24. 각 티켓의 공통 Definition of Done

- core 구현과 실패 코드가 있다.
- 정상·경계·음성 단위 테스트가 있다.
- 해당 시 실제 OCCT integration fixture가 있다.
- Web/API/CLI/MCP 중 적용되는 모든 진입점이 연결된다.
- capability와 OpenAPI가 실제 동작과 일치한다.
- exact/estimated/not_run 구분이 응답과 UI에 보인다.
- 입력을 mutation하지 않고 rollback/cleanup이 검증된다.
- 성능·메모리 예산을 측정하고 결과를 기록한다.
- 문서와 골든 KPI가 갱신된다.
- 견적/RFQ 및 의도하지 않은 외부 네트워크 부작용이 없다.

## 25. 의도적으로 이번 주축에서 제외하는 것

- SLDPRT/SLDASM, Inventor, CATIA 네이티브 파라메트릭 history 복원.
- 벤더 라이선스가 필요한 서버 변환 자동화.
- 일반 NURBS의 완전한 feature history 추정.
- CFD, 연소, 고온 피로를 실행하지 않은 제트엔진 release 인증.
- Civil 3D 수준 코리더와 Revit 수준 BIM authoring.
- 자동 견적, 공장 매칭, RFQ 전송.

제외 항목도 capability에서 숨기지 않고 `unavailable` 또는 `not_run`으로 노출한다.

## 26. 2026-08-05 계획 감사 결과 — 현재 코드와의 정확한 차이

계획을 세운 뒤 실제 코드를 다시 읽어 확인한 결과다. 이 표의 `현재`를 기준선으로 삼고,
이미 구현된 것처럼 보고하지 않는다.

| 영역 | 현재 실제 상태 | 계획에서 필요한 변화 |
|---|---|---|
| corpus manifest | 8개 scenario와 검색어 기반 discovery | 파일 hash가 고정된 다중 fixture manifest v2 |
| corpus runner | scenario마다 점수가 가장 높은 파일 1개 선택 | 25개 이상 명시 fixture, 전체/표본 모드, shard/resume |
| evidence status | `pass/fail/not_run` 3종 | v1 호환을 유지하며 원인 code와 capability-level `unavailable` 분리 |
| STEP evidence | pure parser 우선, 실패 시 OCCT mesh fallback | OCCT exact metric과 parser semantic evidence의 병합 |
| OCCT inspect | valid, solid/face/edge count | volume/area/bbox/centroid/inertia/surface/curve/adjacency |
| STEP roundtrip | part count, 총 volume 0.1%, PMI count/coverage | per-part metric, hierarchy, transform, semantic identity, target binding |
| assembly import | leaf를 flat `AssemblyState`로 만들고 mates는 항상 빈 배열 | definition/occurrence/subassembly tree 보존과 inferred mate 후보 분리 |
| large assembly | `maxClassifyParts=500`, 초과는 placement만 | budget evidence와 대표화 전략, 미분류를 pass에서 제외 |
| PMI REST | 이미 구성된 callout과 valid ref를 검사 | STEP AP242 ingest/roundtrip API를 별도로 추가 |
| generation stages | 8단계, 세 상태 `pass/review_required/blocked` | 호환 migration 후 제조·topology·release evidence 단계 확장 |
| repair | 동일 fingerprint bounded retry, 일부 단계 manual review | typed failure와 deterministic repair catalog/rollback artifact |
| direct STEP edit | deterministic numeric face ref와 planar push/pull | signature v2, topology change graph, cylinder/cone, healing |

### 감사에 따른 우선순위 수정

1. manifest v2 없이 25개 정확도 수치를 만들지 않는다.
2. `inspectShape` 확장 없이 역복원 정확도를 주장하지 않는다.
3. flat assembly importer를 고치기 전에 mate 역추론을 구현하지 않는다.
4. PMI 개수 왕복을 의미 보존으로 표현하지 않는다.
5. status/state schema migration 없이 기존 API 응답을 직접 변경하지 않는다.

## 27. 스키마와 호환성 마이그레이션 계획

### M1. Corpus evidence v1 → v2

- v1 reader는 계속 유지한다.
- v2 writer를 기본으로 하고 `schemaVersion:2`, `assertion.code`, `method`, `criterion`,
  `measured`, `unit`, `confidence`, `artifactHash`를 추가한다.
- assertion 실행 불가는 record 상태로 `not_run`; 제품 capability 자체가 없다는 사실은
  capability 문서에서 `unavailable`로 둔다. 두 의미를 한 enum에 섞지 않는다.
- v1→v2 변환 시 없는 값은 추측하지 않고 null/not_run으로 채운다.

### M2. Generation evidence 호환 확장

- 기존 `intent/decomposition/part_geometry/assembly_solve/interference/motion/step_roundtrip/complete`
  단계 이름은 바로 삭제하지 않는다.
- v2에 `kernel/topology/manufacturing/release` evidence block을 선택적으로 추가한다.
- v1 요청은 기존 판정을 재현한다. v2 `releaseReady`는 새 필수 block이 모두 실행돼야 true다.
- API 응답에 evaluator version을 넣고 저장된 작업은 생성 당시 evaluator로 재현할 수 있게 한다.

### M3. FeatureTree와 Assembly persistence

- `ImportedBrepFeature`, topology signature, occurrence tree를 versioned optional field로 추가한다.
- 기존 flat assembly는 root 아래 leaf occurrence로 자동 승격한다.
- migration은 id를 재발급하지 않고 legacy id→persistent id map을 함께 저장한다.
- undo/redo, autosave, collaborative document, standalone HTML package의 migration fixture를 둔다.

### M4. API versioning

- 호환 추가는 CAD v1에서 수행한다.
- 상태 의미나 필수 입력이 바뀌는 파괴 변경은 `/api/cad/v2` 후보로 격리한다.
- CLI/MCP는 서버 capability version을 먼저 읽고 지원하지 않는 옵션을 전송하지 않는다.

## 28. 핵심 폐루프 T01~T30 상세 의존성·산출물·검증표

| ID | 작업 | 선행 | 핵심 산출물 | 최소 검증 |
|---|---|---|---|---|
| T01 | manifest v2 schema | 없음 | typed manifest/validator | duplicate id/hash/path privacy |
| T02 | T1 Core A18 + Challenge B7 fixture 동결 | T01 | hash-only fixture set | missing/hash drift/holdout leak |
| T03 | evidence v2 schema | T01 | v1 reader, v2 writer/migrator | golden v1→v2 snapshot |
| T04 | tolerance policy | T03 | operation별 상대 공차 | micro/meter/inch fixtures |
| T05 | OCCT metric extractor | T03,T04 | exact metric API | analytic hand calculation |
| T06 | surface/curve/adjacency extractor | T05 | topology graph | box/cylinder/torus/B-spline |
| T07 | format evidence merger | T05,T06 | STEP semantic+kernel report | partial/fallback truthfulness |
| T08 | reference analyze entrypoints | T07 | core/API/CLI/MCP/Web | normalized parity/security |
| T09 | corpus runner v2 | T02,T07 | all/sample/shard/resume runner | crash-resume, deterministic order |
| T10 | baseline dashboard artifact | T09 | KPI JSON/HTML | denominator/status consistency |
| T11 | base feature recognition | T06 | extrude/revolve candidates | synthetic precision/recall |
| T12 | subtract/add recognition | T11 | hole/pocket/boss candidates | blind/through/counter variants |
| T13 | finishing/pattern recognition | T12 | fillet/chamfer/pattern | tangent/tiny/overlap negatives |
| T14 | metric comparator | T04,T05 | global/local/section/distance report | asymmetric mismatch cases |
| T15 | staged reconstruction | T11-T14 | FeatureTree alternatives/DAG | rollback and exact veto |
| T16 | hybrid imported feature | T15 | persisted hybrid part | save/load/export/undo |
| T17 | topology signature v2 | T06,T14 | face/edge/vertex signatures | symmetric/ambiguous fixtures |
| T18 | topology change graph | T17 | split/merge/lost/new mapping | boolean and shell history |
| T19 | planar edit hardening | T18 | heal/remap evidence | repeated edit/memory test |
| T20 | cylinder/cone edit | T18,T19 | analytic surface edit | coaxial/taper/collapse cases |
| T21 | arbitrary shell/offset | T18,T20 | bounded exact operation | min-thickness/self-intersection |
| T22 | occurrence tree importer | T03 | definitions/occurrences/tree | nesting/reuse/transform |
| T23 | assembly roundtrip comparator | T14,T22 | per-instance/tree diff | STEP export→import golden |
| T24 | relation candidate extractor | T06,T22 | contact/axis relations | precision/recall labels |
| T25 | mate validator | T24 | residual/rank/DoF decision | under/redundant/inconsistent |
| T26 | AP242 unified evidence | T17,T18 | value/datum/target roundtrip | NIST semantic+negative |
| T27 | tolerance/manufacturing chain | T25,T26 | interface chain evidence | units/temperature/DFM |
| T28 | generation state machine v2 | T03,T15,T25,T27 | checkpointed orchestration | stage invalidation/recovery |
| T29 | repair catalog/local retry | T18,T28 | typed repairs and artifacts | repeated fingerprint/rollback |
| T30 | R0~R8 release pipeline | T08-T29 | CI/dashboard/release decision | full corpus/parity/build/smoke |

### 티켓 종료 시 반드시 실행할 검증 계층

- L1: 해당 모듈 unit tests.
- L2: 관련 실제 OCCT test.
- L3: 저장·migration·contract tests.
- L4: 관련 golden corpus shard.
- L5: TypeScript, ESLint, production build 영향 확인.
- L6: 진입점이 있으면 Web/API/CLI/MCP parity.

T01~T36 중 문서만 추가되고 실행 증거가 없는 티켓은 완료가 아니다.

## 29. Metric 정의와 수치 판정 상세

### 29.1 공통 오차식

- scalar relative error: `abs(a-b) / max(abs(a), abs(b), epsilon)`.
- bbox는 위치 오차와 크기 오차를 분리한다.
- rotation은 quaternion 부호 동등성을 고려한 최소 각도 차이를 사용한다.
- volume이 0인 sheet body에는 volume 상대오차를 사용하지 않는다.
- 대칭 부품은 topology index 일치 대신 최적 bijection과 ambiguity를 함께 보고한다.

### 29.2 초기 threshold와 calibration

| 지표 | 초기 gate | 비고 |
|---|---:|---|
| solid/instance count | 완전 일치 | merge/split 허용 안 함 |
| bbox size | 축별 0.1% 이하 | 단위 known일 때 |
| bbox position | max(0.01mm, 상대 공차) 이하 | assembly transform 포함 |
| volume | 0.5% 이하 | roundtrip 자체는 0.1% 유지 |
| surface area | 0.5% 이하 | healing 변화 탐지 |
| centroid | max(0.01mm, L×1e-4) 이하 | 질량 균질 가정 별도 표시 |
| transform translation | 0.01mm 이하 | source precision보다 엄격하게 강제하지 않음 |
| transform rotation | 0.01° 이하 | reflection 별도 |
| feature recall | 95% 이상 | A등급, 중요 feature 가중 |
| mate precision | 98% 이상 | 자동 확정 mate 기준 |
| topology remap | 99% 이상 | ambiguous는 오매핑보다 우선 |

- 이 수치는 목표이지 모든 파일에 무조건 적용할 상수가 아니다.
- T10 기준선에서 source precision과 kernel noise를 측정해 fixture class별 threshold를 고정한다.
- threshold 변경은 골든 회귀 결과와 변경 사유가 있는 versioned policy로만 허용한다.
- 점수 개선을 위해 어려운 fixture를 분모에서 제거하지 않는다.

### 29.3 feature 평가 단위

- hole은 axis, center, diameter, depth, end condition을 모두 비교한다.
- pattern은 kind, seed identity, count, pitch/radius, angular span을 비교한다.
- fillet/chamfer는 적용 edge set과 radius/distance를 비교한다.
- extrude/revolve는 profile loop, direction/axis, extent를 비교한다.
- 형상은 같아도 제조 의도가 다른 alternative는 semantic exact로 통과시키지 않는다.

## 30. 누락 방지용 교차 기능 매트릭스

| 기능 | Core | Persist | Web | API | CLI | MCP | OpenAPI | Unit | OCCT | Golden | E2E |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Evidence IR v2 | 필수 | artifact | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 |
| Reconstruction | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 |
| Direct edit | 필수 | transaction | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 |
| Assembly import | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 일부 | 필수 | 필수 |
| PMI/tolerance | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 일부 | 필수 | 필수 |
| Repair pipeline | 필수 | checkpoint | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 해당 시 | 필수 | 필수 |
| Release report | 필수 | artifact | 필수 | 필수 | 필수 | 필수 | 필수 | 필수 | 집계 | 필수 | 필수 |

한 열이라도 이유 없이 비어 있으면 해당 기능은 통합 완료가 아니다.

## 31. 사용자 시나리오별 최종 인수 테스트

### U1. 일반 사용자 자연어 생성

1. 사용자가 제품 기능과 대략 치수를 설명한다.
2. 시스템이 독립 부품과 미해결 치수를 먼저 보여준다.
3. 사용자가 확인하면 부품별 FeatureTree를 단계 생성한다.
4. 실패한 부품만 국소 수리한다.
5. 조립·간섭·제조·STEP 증거와 함께 결과를 보여준다.

합격: 단일 body 평탄화 없음, 모르는 치수 날조 없음, 실패 이유와 수정 위치가 보임.

### U2. 전문가 STEP 역복원

1. STEP을 업로드한다.
2. exact Evidence IR과 assembly tree를 확인한다.
3. 파라메트릭 후보와 imported 잔여 body를 검토한다.
4. 원본/재생 deviation과 feature ambiguity를 확인한다.
5. 승인한 후보만 editable FeatureTree로 확정한다.

합격: 원본보다 단순한 모델을 exact라고 표시하지 않으며 정량 차이가 재현 가능함.

### U3. 선택 면·선·부품 채팅 수정

1. occurrence와 topology를 선택한다.
2. “이 면 2mm”, “이 모서리 R1”, “이 부품 10mm 이동”을 입력한다.
3. geometry, mate, PMI, BOM 영향 preview를 본다.
4. 확정 또는 rollback한다.

합격: 다른 부품/대칭 면 오선택 0, stale selection 차단, exact diff 제공.

### U4. 실제 어셈블리와 애니메이션

1. 다중 부품 STEP을 가져온다.
2. hierarchy와 occurrence 재사용을 유지한다.
3. mate와 intended DoF를 확인한다.
4. 0~N frame 동작, 충돌, 서비스 envelope를 계산한다.
5. standalone HTML/STEP/BOM을 내보낸다.

합격: part identity, transform, frame target이 export/reload 후 유지됨.

### U5. 제조 릴리스

1. PMI·공차·재료·공정을 확인한다.
2. G0~G9와 R0~R8을 실행한다.
3. 실패·not_run 항목을 수정하거나 명시적으로 보류한다.
4. 모든 필수 gate가 통과한 경우에만 releaseReady가 된다.

합격: 계산하지 않은 항목의 거짓 통과 0, 견적/RFQ 호출 0.

## 32. 데이터·캐시·협업·장기 실행 세부 규칙

### Artifact와 캐시

- cache key는 source hash + schema + kernel + tolerance + recognizer version이다.
- evidence와 generated artifact는 content-addressed hash로 연결한다.
- 실패 artifact는 원인 분석에 필요한 최소 정보만 보존하고 원본 CAD 복제는 피한다.
- cache hit도 이전 evidence version을 검증하고 오래된 결과를 자동 승격하지 않는다.

### 장기 실행

- corpus runner는 fixture 단위 즉시 checkpoint, resume, deterministic shard를 지원한다.
- SIGINT/timeout 후 완료 record를 잃지 않는다.
- 동일 output 경로가 다른 source/config를 가리키면 덮어쓰지 않고 중단한다.
- progress는 파일 수뿐 아니라 bytes와 stage를 함께 표시한다.

### 협업 편집

- topology/occurrence selection에는 document revision을 포함한다.
- 동시 편집 충돌은 feature/part 단위로 탐지하고 last-write-wins로 geometry를 덮지 않는다.
- mate 또는 topology를 무효화하는 merge에는 명시적 사용자 해결이 필요하다.
- undo/redo와 collaboration replay 후 artifact hash와 assembly invariants를 재검증한다.

### 국제화와 접근성

- kernel/error code는 언어 독립이고 표시 문구만 번역한다.
- 한글·베트남어·악센트 부품명의 STEP encode→write→decode 왕복을 검사한다.
- 색상만으로 pass/fail/not_run을 구분하지 않는다.
- 긴 작업은 키보드 취소와 screen-reader progress label을 제공한다.

## 33. 첫 통합 묶음의 파일 단위 실행안

다음 구현 턴은 아래 범위만 완료한 뒤 두 번째 묶음으로 넘어간다.

### 새 파일 후보

- `src/lib/reference/cadCorpusManifestV2.ts`
- `src/lib/reference/cadEvidenceIr.ts`
- `src/lib/reference/cadEvidenceIrSchema.ts`
- `src/lib/reference/cadTolerancePolicy.ts`
- `src/lib/reference/occtCadEvidence.ts`
- `src/lib/reference/cadReferenceAnalyze.ts`
- 각각의 `.test.ts`
- `src/app/api/cad/v1/reference/analyze/route.ts`와 `.test.ts`

### 수정 파일 후보

- `src/lib/occt/bridge.ts`, `nodeOcctBridge.ts`, 관련 real-kernel tests.
- `src/lib/reference/cadCorpusEvidence.ts`, `cadCorpusManifest.ts`는 v1 호환 adapter 유지.
- `scripts/reference/run-cad-golden-corpus.ts`.
- `scripts/cli/nexyfab.mjs`, `scripts/drawing-to-3d/mcp-server.mjs`와 계약 tests.
- `src/app/api/cad/v1/capabilities/route.ts`, OpenAPI route.
- reference corpus 문서와 KPI baseline artifact schema.

### 첫 묶음 완료 증거

- synthetic box/cylinder/compound의 손계산 metric.
- 실제 Core A STEP 최소 3개 smoke와 A18+B7 manifest 발견 검증.
- partial, unknown-unit, unsupported native, corrupt STEP 음성 테스트.
- core/API/CLI/MCP normalized parity.
- typecheck, changed-file lint, 관련 Vitest, 실제 OCCT regression.
- 원본 corpus 수정 0, 외부 fetch 0, quote/RFQ side effect 0.

## 34. 위험 등록부와 사전 대응

| 위험 | 발생 신호 | 예방/완화 | 차단 조건 |
|---|---|---|---|
| 대칭 면 오매핑 | 동일 비용 후보 2개 이상 | adjacency·orientation·history 결합, ambiguity 반환 | 임의 tie-break 금지 |
| 단위 오판 | bbox는 그럴듯하지만 치수 불일치 | declared 우선, inferred 분리, 사용자 확인 | 절대 공학 gate 금지 |
| assembly flattening | unique definition/occurrence 감소 | tree comparator를 export 전후 필수 실행 | part count/tree mismatch |
| partial parse 거짓 성공 | sampledRatio<1 또는 maxClassify 초과 | coverage를 assertion별 기록 | 필수 assertion partial |
| PMI 거짓 보존 | count는 같고 datum/target이 다름 | semantic normalized identity와 binding 비교 | identity/binding mismatch |
| healing 의도 변경 | 체적·면적·solid 수 급변 | heal 전후 exact diff와 승인 threshold | solid 수 또는 확정 치수 변화 |
| feature overfitting | 형상은 맞지만 잘못된 history | alternative와 semantic ambiguity 표시 | semantic exact 승격 금지 |
| AI 환각 | IR에 없는 치수/관계 생성 | source evidence id 필수, deterministic veto | 근거 없는 필드 존재 |
| kernel 메모리 누수 | 반복 실행 RSS/WASM heap 증가 | ownership registry, finally release, stress test | 예산 초과 추세 |
| 대형 파일 DoS | parser/worker timeout, huge entity count | byte/entity/depth/time budget | bounded failure 실패 |
| checkpoint 오염 | source/config 다른데 done 처리 | full run signature와 atomic record | signature mismatch 시 중단 |
| 기존 문서 파손 | migration 뒤 id/selection 손실 | legacy fixtures, bidirectional read test | invariant/id mismatch |
| 진입점 불일치 | Web 성공, CLI/MCP 실패 | core-only business logic, parity snapshot | normalized diff 발생 |
| 골든 누출 | 같은 제품이 prompt 예제에 포함 | product-level holdout 검사 | 누출 시 KPI 무효 |
| 라이선스 문제 | source provenance 불명 | local-only flag, bytes 비배포 | 외부 배포/업로드 금지 |

## 35. 단계별 Go/No-Go 결정

### Gate A — 실측 기반 준비

Go:

- T01~T10 완료.
- Core A18 + Challenge B7 fixture가 hash로 고정되고 기준선 보고서가 재현됨.
- exact metric과 not_run이 구분됨.

No-Go:

- 자동 discovery가 매 실행 다른 파일을 고름.
- source unit/partial 상태가 evidence에서 사라짐.
- OCCT resource cleanup을 검증하지 못함.

### Gate B — 단일 부품 편집 가능

Go:

- T11~T21 완료.
- A등급 KPI를 만족하고 false exact 0건.
- 직접 편집 후 topology/PMI selection을 안전하게 reconcile함.

No-Go:

- 대칭 면을 임의로 재연결함.
- hybrid residual을 숨기고 완전 파라메트릭이라 표시함.
- healing이 확정 치수를 바꿈.

### Gate C — 실제 어셈블리 보존

Go:

- T22~T25 완료.
- definition/occurrence/subassembly/transform 왕복 일치.
- mate 자동 확정 precision과 DoF gate 충족.

No-Go:

- leaf만 flat import함.
- inferred joint를 source-declared처럼 표시함.
- 부유 또는 과구속을 release 통과시킴.

### Gate D — 제조 릴리스 가능

Go:

- T26~T30 완료.
- PMI binding, 공차, DFM, STEP 왕복과 entrypoint parity 통과.
- R0~R8 전부 pass.

No-Go:

- PMI count만 보존됨.
- 필수 assertion에 not_run이 남음.
- production build/AI transport/kernel smoke 중 하나라도 실패.

## 36. 첫 묶음 내부의 정확한 구현 순서

1. 현재 v1 manifest/evidence snapshot을 fixture로 고정한다.
2. v2 schema와 v1 migration test를 먼저 작성한다.
3. tolerance policy의 손계산 테스트를 작성한다.
4. bridge에 새 inspection 타입을 추가하되 기존 `inspectShape` 호출을 깨지 않는다.
5. Node OCCT에서 metric을 하나씩 구현하고 각 항목별 analytic fixture를 통과시킨다.
6. surface/curve/adjacency를 별도 optional capability로 연결한다.
7. pure STEP semantic 결과와 OCCT metric을 병합한다.
8. corrupt/partial/unknown-unit/unsupported 입력이 fail-closed인지 확인한다.
9. `analyzeCadReference` core를 만든다.
10. REST route와 rate/size/timeout 검증을 연결한다.
11. CLI output file과 exit code를 연결한다.
12. MCP schema와 payload parity를 연결한다.
13. Web 분석 화면에 stage와 status를 표시한다.
14. capability/OpenAPI를 실제 지원 항목만으로 갱신한다.
15. runner v2의 all/sample/shard/resume/checkpoint를 구현한다.
16. 3개 smoke 후 Core A18 + Challenge B7 baseline을 실행한다.
17. KPI/미지원/실패 목록을 보고서로 고정한다.
18. 관련 회귀, typecheck, lint, production build 영향 검사를 수행한다.

이 순서에서 schema·test보다 구현을 먼저 시작하지 않는다. runner 전체 실행보다 3개 smoke를
먼저 통과시키고, 각 단계의 실패가 이전에 검증된 artifact를 삭제하지 않도록 한다.

## 37. T1 25개 fixture 후보를 실제 인덱스에 고정

실제 `result/ir_index.json`을 다시 집계한 결과 A등급 STEP은 25개가 아니라 18개다.
따라서 동일 난이도로 묶지 않고 Core A18과 Challenge B7을 분리한다. 아래 경로는 외부 corpus
root 기준이며 저장소 manifest에는 경로 원문 대신 fixture id, hash, locator rule만 저장한다.

### Core A18 — 역복원 합격 기준 적용

| ID | source locator | 주요 검증 목적 |
|---|---|---|
| A01 | NIST-PMI/.../nist_stc_10_asme1_ap242-e2.stp | AP242+analytic feature |
| A02 | TEMA heat exchanger/.../Front Head Nozzle.step | 회전체·노즐·pattern |
| A03 | TEMA heat exchanger/.../Front Head.step | 회전체·flange |
| A04 | industrial piping/.../Pipe Elbow 90º.step | torus/elbow/flange |
| A05 | NIST-PMI/.../AP203 geometry only/nist_ftc_07_asme1_rd.stp | PMI 음성·pattern |
| A06 | NIST-PMI/.../AP203 geometry only/nist_ftc_10_asme1_rb.stp | PMI 음성·pattern |
| A07 | C5055/.../Motor mount.STEP | motor interface·bolt pattern |
| A08 | robot reference/.../Arduino Sensor Board V1.stp | plate·hole pattern |
| A09 | NIST-PMI/.../AP203 geometry only/nist_ftc_11_asme1_rb.stp | geometry-only 비교 |
| A10 | NIST-PMI/.../nist_ftc_08_asme1_ap242-e2.stp | AP242 semantic target |
| A11 | industrial piping/.../Pipe Elbow 180º.step | 180° sweep/torus |
| A12 | robot reference/.../18650 Lipo Battery.step | simple analytic enclosure |
| A13 | NIST-PMI/.../AP203 geometry only/nist_ctc_04_asme1_rd.stp | geometry-only 비교 |
| A14 | NIST-PMI/.../AP203 geometry only/nist_ftc_08_asme1_rc.stp | AP242 pair 음성 기준 |
| A15 | NIST-PMI/.../nist_ctc_01_asme1_ap242-e1.stp | AP242 datum/GD&T |
| A16 | semi-circular-shaft-elevator/.../st1.stp | shaft/elevator analytic part |
| A17 | twin-panoramic-elevator/.../st1.stp | 유사명·중복 geometry 검증 |
| A18 | C5055/.../Stator base.STEP | 동축·원형 pattern |

### Challenge B7 — 범위와 실패 원인 측정

| ID | source locator | 선택 이유 |
|---|---|---|
| B01 | NIST-PMI/.../AP203 geometry only/nist_ftc_06_asme1_rd.stp | 복잡 feature 음성 PMI |
| B02 | NIST-PMI/.../nist_stc_06_asme1_ap242-e3.stp | 더 복잡한 AP242 semantic |
| B03 | TEMA heat exchanger/.../Shell.step | shell/nozzle 반복 형상 |
| B04 | industrial piping/.../Elbow Flange Cast 60º.step | cast/freeform 혼합 경계 |
| B05 | pressure-vessel/.../Pressure Vessel Assembly.STEP | 단일-part 가정 파괴·assembly |
| B06 | spiral-staircase/.../Escada Caracol.STEP | 대형 반복·나선 배치 |
| B07 | TEMA heat exchanger/.../Baffle and Tube.step | 다중 body·대량 pattern |

### Fixture 동결 시 추가할 값

- 실제 normalized relative locator와 SHA-256.
- byte size, format, grade/score, parser version.
- declared unit과 parse complete/partial.
- expected solid/part count와 현재 measured metric.
- redistribution `forbidden_until_proven` 및 local-only 표시.
- duplicate group id. A16/A17처럼 동일하거나 유사할 수 있는 파일은 독립 점수로 부풀리지 않는다.

## 38. 현재 시나리오 assertion 실행 가능성 감사

현재 `cadCorpusEvidence.ts`의 실제 adapter를 기준으로 작성했다.

| Scenario | Assertion | 현재 상태 | 다음 구현 위치 |
|---|---|---|---|
| mearm-motion | part_count | STEP/X_T 일부 실행 | occurrence-aware count로 교체 |
| mearm-motion | assembly_hierarchy | STEP NAUO 존재만 확인 | tree identity/transform comparator |
| mearm-motion | mates_or_joints | 항상 not_run | P4 relation+mate validator |
| mearm-motion | motion_collision | 항상 not_run | imported joint 확인 후 motion verifier |
| fastener-stack | independent_parts | solid/instance count 실행 | definition/occurrence 분리 |
| fastener-stack | concentric_mate | 항상 not_run | cylinder-axis relation extractor |
| fastener-stack | bom_quantity | STEP instance 수 실행 | unique/quantity/source-name 비교 |
| fastener-stack | step_roundtrip | geometry+PMI count 실행 | per-instance/semantic identity 강화 |
| gearbox | subassemblies | depth≥2만 확인 | tree path identity 비교 |
| gearbox | shaft_bearing_layout | 이름 동시 존재만 확인 | 실제 axis/fit/placement 검증 |
| gearbox | pattern_fidelity | repeated definition 존재만 확인 | count/transform/pitch 검증 |
| gearbox | bom_quantity | 실행 | unique definition/occurrence 수 분리 |
| cabinet | independent_panels | 항상 not_run | panel body/definition recognition |
| cabinet | flat_pattern | 항상 not_run | sheet-metal refold comparator |
| cabinet | bend_table | 항상 not_run | thickness/radius/angle/table adapter |
| cabinet | bom_quantity | STEP에서 실행 | panel occurrence 수 검증 |
| weldment | member_identity | 항상 not_run | profile/member recognition |
| weldment | miter_lengths | 항상 not_run | member end-cut geometry 검사 |
| weldment | cut_list | 항상 not_run | length/profile/quantity comparator |
| weldment | mass | 항상 not_run | material+density+exact volume |
| heavy motion | pose_preservation | transform entity 존재만 확인 | source/export transform diff |
| heavy motion | independent_parts | 실행 | occurrence-aware 강화 |
| heavy motion | motion_collision | 항상 not_run | source joint 없으면 inferred+review |
| heavy motion | clearance | 항상 not_run | sampled motion exact narrow phase |
| NIST PMI | semantic_pmi_count | 실행 | 종류·값 identity로 강화 |
| NIST PMI | topology_reference | graph reachability 실행 | persistent target identity 강화 |
| NIST PMI | graphical_semantic_separation | 실행 | negative fixture 확대 |
| NIST PMI | pmi_semantic_roundtrip | normalized semantic 실행 | geometry target binding 결합 |
| NIST PMI | geometry_step_roundtrip | part 수+총체적 실행 | per-part metric 강화 |
| NIST PMI | step_roundtrip | count/coverage 결합 | datum/value/target identity 강화 |
| IFC4.3 | guid/hierarchy/material/quantity/georeference | entity count 실행 | 값·관계·placement 왕복은 별도 vertical |

### Assertion 구현 우선순위

1. 현재 실행되는 검사의 깊이를 강화: part count/roundtrip/PMI/tree.
2. 기계 핵심 not_run 제거: concentric mate, shaft-bearing layout, pattern transform.
3. 제조 핵심 not_run 제거: cabinet와 weldment.
4. motion은 joint가 source-declared인지 inferred인지 구분한 뒤에만 실행.
5. IFC는 기계 CAD release와 분리하고 현재 count를 certification으로 부르지 않는다.

## 39. Evidence artifact의 구체적 JSON 구조

```jsonc
{
  "schemaVersion": 2,
  "run": {
    "id": "content-hash",
    "createdAt": "informational-only",
    "sourceHash": "sha256",
    "configHash": "sha256",
    "engine": { "parser": "...", "kernel": "...", "evaluator": "..." }
  },
  "source": {
    "fixtureId": "A01",
    "format": "step",
    "bytes": 0,
    "usage": "local-only",
    "parse": { "status": "complete", "sampledRatio": 1, "warnings": [] },
    "units": { "value": "mm", "source": "declared" }
  },
  "assertions": [{
    "code": "geometry.volume",
    "status": "pass",
    "method": "occt-gprops",
    "measured": 1000,
    "expected": 1000,
    "unit": "mm3",
    "criterion": { "operator": "relative_lte", "value": 0.001 },
    "confidence": "exact",
    "references": ["body:0"],
    "reason": "..."
  }],
  "artifacts": [{ "kind": "step", "sha256": "...", "retention": "ephemeral" }],
  "summary": { "pass": 0, "fail": 0, "notRun": 0, "releaseBlocking": true },
  "sideEffects": { "sourceModified": false, "quoteCreated": false, "rfqSent": false }
}
```

결정론 비교에서 `createdAt`은 제외한다. 배열 순서와 float 직렬화 정책을 고정하고 NaN/Infinity는
schema 단계에서 거부한다.

## 40. Runner v2 상세 계약

### 실행 모드

- `--fixture=A01`: 단일 재현.
- `--tier=core-a`: Core A18.
- `--tier=challenge-b`: Challenge B7.
- `--scenario=nist-pmi`: 시나리오 전체.
- `--all`: manifest 전체.
- `--shard=1/4`: fixture id 정렬 후 결정론 분할.
- `--resume=<run-dir>`: signature가 같은 미완료 run만 재개.
- `--max-bytes`, `--timeout-ms`, `--kernel-workers`: 자원 상한.

### 출력 디렉터리

```text
run-<configHash>/
  manifest.snapshot.json
  checkpoints/<fixtureId>.json
  evidence/<fixtureId>.json
  artifacts/<fixtureId>/...       # 기본 ephemeral/local-only
  summary.json
  report.html
```

### 종료 코드

- `0`: 선택된 필수 assertion 모두 pass.
- `1`: runner/internal/config 오류.
- `2`: CLI 사용법 오류.
- `4`: 필수 assertion not_run.
- `5`: assertion fail.
- `6`: source hash drift 또는 checkpoint signature mismatch.
- `130`: 사용자 취소. 완료 checkpoint는 보존.

### Runner 인수 조건

- 중간 종료 후 완료 fixture를 다시 실행하지 않는다.
- config/parser/kernel 변경 후 이전 checkpoint를 재사용하지 않는다.
- 한 fixture crash가 전체 결과 파일을 유실시키지 않는다.
- summary count가 evidence 파일을 다시 집계한 값과 일치한다.
- source path는 report에 익명 label로만 표시하고 원본 bytes는 복사하지 않는다.

## 41. 의미 모델에서 반드시 분리할 개념

### Product/Part/Body/Occurrence

- 하나의 Product Definition이 여러 Body를 가질 수 있다. Body 수를 Part 수로 사용하지 않는다.
- 하나의 Part Definition이 여러 Occurrence로 재사용될 수 있다. unique part 수와 BOM quantity를 분리한다.
- geometry가 없는 Product Definition은 subassembly container일 수 있다. 빈 부품으로 삭제하지 않는다.
- 동일 이름은 동일 부품의 증거가 아니다. definition id와 geometry hash를 함께 사용한다.
- 동일 geometry라도 재질·revision·PMI가 다르면 별도 definition일 수 있다.

### 좌표와 변환

- source local, occurrence parent, assembly world, viewer frame을 구분한다.
- STEP의 axis placement를 world transform으로 바꾼 뒤에도 원본 frame을 evidence에 보존한다.
- quaternion normalize, reflection/negative determinant, non-uniform scale을 각각 검사한다.
- 대좌표 모델은 local origin rebasing을 viewer에만 적용하며 engineering coordinate를 변경하지 않는다.

### 형상과 의미

- 동일 B-rep은 동일 feature history를 뜻하지 않는다.
- 동일 위치의 겹친 body는 intended contact, duplicate, interference 중 하나이며 자동 판단하지 않는다.
- mesh watertight는 analytic solid 또는 제조 가능성을 증명하지 않는다.
- PMI graphical glyph는 semantic tolerance가 아니다.
- mate candidate는 source-declared constraint가 아니다.

### 질량과 재료

- exact volume과 mass는 분리한다. density provenance가 없으면 mass는 not_run이다.
- assembly mass는 definition mass×occurrence quantity로 계산하고 중복 occurrence를 빠뜨리지 않는다.
- imported material name을 표준 재료로 매핑할 때 원문과 mapping confidence를 보존한다.
- inertia 기준점과 좌표축을 반드시 기록한다.

## 42. 코드 소유 경계

| 책임 | 소유 모듈 | 금지 사항 |
|---|---|---|
| corpus discovery/governance | `src/lib/reference/cadCorpus*` | geometry 판정 포함 금지 |
| exact kernel 측정 | `src/lib/occt/*` | AI/HTTP/UI 의존 금지 |
| evidence 병합/판정 | `src/lib/reference/*Evidence*` | raw kernel handle 노출 금지 |
| feature recognition | 신규 `src/lib/cad-recognition/*` 권장 | UI 상태 직접 변경 금지 |
| topology reconcile | `src/lib/cad/topology*`, `src/lib/assembly/*Topology*` | positional index 임의 fallback 금지 |
| assembly import/model | `src/lib/brep-bridge/stepAssemblyImport.ts`, `src/lib/assembly/*` | subassembly flatten을 canonical로 사용 금지 |
| generation/repair | `src/lib/ai/aiGenerationPipeline.ts` 계열 | kernel 성공을 자체 추정 금지 |
| API adapters | `src/app/api/cad/v1/*` | business rule 복제 금지 |
| CLI/MCP | `scripts/cli`, `scripts/drawing-to-3d/mcp-server.mjs` | 별도 계산 구현 금지 |
| Web | shape-generator 분석/편집 UI | approximate 결과를 exact로 표시 금지 |

recognition 코드는 `reference` 아래에 두지 않는 편이 낫다. reference는 평가와 evidence의
소유자이고, 역복원은 제품 기능이므로 별도 `cad-recognition` 경계가 순환 의존을 줄인다.

## 43. 첫 묶음 테스트 파일과 실행 명령 계획

### 새 테스트 파일

- `src/lib/reference/cadCorpusManifestV2.test.ts`
- `src/lib/reference/cadEvidenceIrSchema.test.ts`
- `src/lib/reference/cadEvidenceMigration.test.ts`
- `src/lib/reference/cadTolerancePolicy.test.ts`
- `src/lib/reference/occtCadEvidence.test.ts`
- `src/lib/reference/cadReferenceAnalyze.test.ts`
- `src/app/api/cad/v1/reference/analyze/route.test.ts`
- CLI/MCP 기존 계약 테스트에 reference analyze 사례 추가.

### 빠른 검증

```powershell
npx vitest run `
  src/lib/reference/cadCorpusManifestV2.test.ts `
  src/lib/reference/cadEvidenceIrSchema.test.ts `
  src/lib/reference/cadEvidenceMigration.test.ts `
  src/lib/reference/cadTolerancePolicy.test.ts
```

### 커널·통합 검증

```powershell
npx vitest run `
  src/lib/reference/occtCadEvidence.test.ts `
  src/lib/reference/cadReferenceAnalyze.test.ts `
  src/lib/reference/occtStepRoundtrip.test.ts `
  src/lib/occt/nodeOcctBridge.test.ts `
  src/app/api/cad/v1/reference/analyze/route.test.ts
```

### 진입점·기존 회귀

```powershell
npx vitest run `
  scripts/cli/nexyfab.test.ts `
  scripts/drawing-to-3d/cad-v1-mcp.test.ts `
  src/app/api/cad/v1/capabilities/route.test.ts `
  src/lib/reference/cadCorpusEvidence.test.ts `
  src/lib/reference/cadCorpusGovernance.test.ts
npm run typecheck --if-present
```

changed-file ESLint 후, 첫 묶음 전체가 안정되면 production build와 3개 OCCT corpus smoke를 실행한다.
외부 corpus 경로가 없는 CI에서는 테스트를 pass로 건너뛰지 않고 fixture unavailable/not_run을
별도 job 상태로 표시하며, synthetic/저장 가능한 자체 fixture는 항상 실행한다.

## 44. 첫 묶음 API 계약 초안

### Request

```jsonc
{
  "source": "base64 STEP bytes",
  "encoding": "base64",
  "format": "step",
  "fixtureId": null,
  "options": {
    "includeAdjacency": true,
    "includeTessellationDistance": false,
    "timeoutMs": 30000,
    "tolerancePolicy": "relative-v1"
  }
}
```

### Response

```jsonc
{
  "ok": true,
  "evidence": { "schemaVersion": 2 },
  "capabilitiesUsed": ["occt-exact-metrics", "step-semantic-parser"],
  "notRun": [],
  "warnings": [],
  "quoteOrRfqSideEffects": false
}
```

### 오류 코드

| HTTP | Code | 의미 |
|---:|---|---|
| 400 | INVALID_INPUT | schema/base64/NaN/format 오류 |
| 413 | SOURCE_TOO_LARGE | byte budget 초과 |
| 415 | UNSUPPORTED_FORMAT | adapter 없음 |
| 422 | CAD_PARSE_FAILED | 지원 포맷이나 형상 해석 실패 |
| 422 | UNIT_REQUIRED | 요청한 절대 검증에 단위가 없음 |
| 429 | RATE_LIMIT | 요청 제한 |
| 499/408 | CANCELLED/TIMEOUT | 취소 또는 제한 시간 |
| 500 | KERNEL_FAILURE | 격리 커널의 예기치 않은 실패 |
| 503 | KERNEL_UNAVAILABLE | 커널 초기화 불가 |

`fixtureId`는 서버가 가진 승인 fixture를 가리킬 때만 허용한다. 임의 로컬 경로를 API가 읽게 하지
않는다. 일반 사용자는 source bytes를 보내며 서버는 임시 격리 영역에서만 처리한다.

## 45. 첫 묶음 산출물 체크리스트

- [ ] manifest v2와 validator.
- [ ] Core A18/Challenge B7 locator 발견 및 hash snapshot.
- [ ] evidence v2 schema, canonical serializer, v1 migrator.
- [ ] tolerance policy와 version hash.
- [ ] OCCT exact metric 및 topology adjacency.
- [ ] source/kernel evidence merger.
- [ ] `analyzeCadReference` core.
- [ ] API route와 OpenAPI.
- [ ] CLI command와 exit codes.
- [ ] MCP tool과 payload parity.
- [ ] Web status/progress/evidence viewer.
- [ ] runner all/sample/shard/resume/checkpoint.
- [ ] 3개 smoke evidence.
- [ ] A18+B7 baseline summary/report.
- [ ] security/cleanup/memory evidence.
- [ ] typecheck/lint/tests/build 결과.
- [ ] capability의 supported/not_run/unavailable 정합성.
- [ ] 문서·KPI·다음 묶음 진입 판정.

체크박스 하나라도 미완료면 첫 묶음을 완료로 표시하지 않는다.

## 46. 전문가용 편집 가능성을 위해 추가로 놓치면 안 되는 축

### 46.1 Sketch와 구속 복원

- profile point cloud만 저장하지 않고 line/arc/circle/spline entity를 분리한다.
- coincident, horizontal, vertical, parallel, perpendicular, tangent, concentric, equal,
  symmetry, fixed 구속을 복원한다.
- driving dimension과 driven/reference dimension을 구분한다.
- fully/under/over constrained 상태와 남은 DoF를 계산한다.
- 외부 geometry projection과 잃어버린 reference를 명시한다.
- 선 선택 채팅은 sketch entity persistent id를 통해 길이·각도·구속을 수정한다.

합격 조건:

- 재생 형상이 같더라도 불안정하거나 과구속 sketch를 expert-ready로 통과시키지 않는다.
- 치수 변경 후 의도한 entity만 이동하고 profile closure와 B-rep 재생을 다시 검증한다.

### 46.2 기준 형상과 좌표계

- origin, datum plane, datum axis, coordinate system, construction geometry를 정식 IR로 둔다.
- Feature와 Mate가 raw world 좌표 대신 기준 형상을 참조하게 한다.
- 기준 형상 삭제/변경 시 downstream dependency를 표시하고 자동 재부착하지 않는다.
- PMI datum과 modeling datum이 연결되더라도 서로 다른 역할을 보존한다.

### 46.3 세부 기계 Feature

- thread는 실제 나선 geometry와 cosmetic/semantic thread를 분리한다.
- keyway, spline, groove, rib, web, lip, boss, counterbore/countersink를 독립 feature로 다룬다.
- hole wizard 정보가 있으면 단순 cylinder cut으로 축소하지 않는다.
- draft/fillet/chamfer의 feature order 변화가 제조 의미에 미치는 영향을 비교한다.
- multi-body part와 assembly part를 혼동하지 않는다.

### 46.4 Configuration·식·설계표

- configuration마다 suppression, parameter override, material, part number를 보존한다.
- equation/parameter dependency graph의 cycle과 단위를 검증한다.
- design table은 geometry 생성 코드와 분리된 data artifact로 둔다.
- 한 configuration의 편집이 다른 configuration을 의도치 않게 변경하지 않는지 회귀한다.

### 46.5 도면과 제조 문서

- model view, section, detail, exploded view, hidden line, center mark를 모델 reference에 연결한다.
- dimension/PMI 중복과 모순을 검사한다.
- sheet format, scale, projection convention, revision, BOM balloon을 보존한다.
- STEP/BOM/2D drawing의 part number, quantity, revision이 일치해야 release 가능하다.
- PDF는 geometry source가 아니라 검토/비교 문서로만 사용하며 OCR 추출값은 확인 전 exact가 아니다.

### 46.6 Revision·변경 영향

- 모델, drawing, BOM, PMI, animation artifact에 공통 document revision을 둔다.
- 변경 전후 affected feature/part/mate/drawing view를 dependency graph로 계산한다.
- 승인된 release artifact는 새 revision 생성 없이 덮어쓰지 않는다.
- 비교 보고서에 geometry change와 metadata-only change를 분리한다.

이 여섯 축은 Evidence/역복원 기반을 먼저 만든 뒤 구현하지만 최종 expert-ready gate에서는 필수다.

## 47. 전체 목표 커버리지 감사표

| 사용자 목표/자료 요구 | 현재 기반 | 이번 계획의 담당 | 최종 판정 |
|---|---|---|---|
| 자연어 다단 생성 | generation pipeline 존재 | P6/T28-T29 | 단계별 evidence 필수 |
| 단일 body 금지 | decomposition/assembly gate 존재 | P4/R4 | occurrence tree 완전 일치 |
| 면 선택 채팅 수정 | parametric+STEP planar 일부 | P3 | topology remap과 exact diff |
| 선/edge 선택 수정 | fillet/chamfer 일부 | §46.1, P3 | sketch/edge persistent id |
| 부품 선택 이동 | assembly transform 존재 | P4/P6 | mate 영향과 stale 차단 |
| 다중 부품 애니메이션 | timeline/verification 존재 | P4/U4 | occurrence id/frame collision |
| 실제 제조 STEP | part/assembly STEP 기반 존재 | P5/R6 | hierarchy/metric/PMI 왕복 |
| 로봇·감속기·모터 | 생성/공학 모듈 존재 | T22-T25 golden 비교 | part/joint/pose KPI |
| 제트엔진·공장 | 개념 roadmap 존재 | Tier 1~3 후 별도 vertical | 미실행 해석 승격 금지 |
| 자유곡면/NURBS | surface 기능 일부 존재 | P3 experimental+quality gate | general history는 unavailable |
| Sketch/constraint | solver 기반 존재 | §46.1 | DoF·dimension intent |
| GD&T/PMI | callout/AP242 parser 존재 | P5/T26 | datum/value/target identity |
| 공차 누적 | 계산 모듈 존재 | P5/T27 | interface chain+unit |
| 판금/용접 | verify API 존재 | P5/T27 | 실제 corpus artifact 대조 |
| 도면/BOM | 기존 export 기반 존재 | §46.5 | revision/quantity/reference 일치 |
| CLI·MCP·API | 공통 CAD v1 기반 존재 | P7/§30 | normalized parity |
| 초보/전문가 UI | 두 수준의 UI 기반 존재 | P7/U1-U3 | guided+evidence mode |
| 오류·중첩 해결 | 일부 gate/repair 존재 | P6/T29 | typed local repair/rollback |
| 견적 제외 | quote route 제거·side-effect flag | 전 단계 불변 규칙 | 호출 0건 |

## 48. 최종 프로그램 Increment 순서

계획의 36개 티켓을 사용자에게 보이는 결과 단위로 다시 묶는다.

### Increment I — 믿을 수 있는 가져오기

- T01~T10.
- 사용자는 STEP을 넣고 무엇을 정확히 읽었고 무엇을 못 읽었는지 확인한다.
- 결과: Evidence IR, exact metrics, assembly/PMI coverage, no false pass.

### Increment II — 수정 가능한 단일 부품

- T11~T21과 §46.1~46.3의 기본 범위.
- 사용자는 복원된 FeatureTree 또는 hybrid part를 확인하고 면·선 채팅 편집을 수행한다.
- 결과: exact deviation, topology remap, rollback 가능한 수정.

### Increment III — 실제 다중 부품

- T22~T25.
- 사용자는 hierarchy, occurrence, mate, DoF, 이동, animation을 유지한 어셈블리를 다룬다.
- 결과: 단일 body가 아닌 실제 제조/교체 단위의 assembly.

### Increment IV — 전문가 제조 문서

- T26~T27과 §46.4~46.6.
- PMI, 공차, configuration, drawing, BOM, revision을 형상에 연결한다.
- 결과: STEP만 있는 데모가 아니라 검토 가능한 제조 패키지.

### Increment V — 생성·수리·릴리스 자동화

- T28~T30.
- 다단 AI 생성, 국소 수리, corpus regression, R0~R8 release gate를 통합한다.
- 결과: 복잡한 제품도 실패 위치를 보존하면서 단계적으로 생성·수정·검증한다.

각 Increment는 독립적으로 배포 가능해야 하지만, `전문가 제조 릴리스` 표시는 Increment IV와 V가
모두 통과한 경우에만 허용한다.

## 49. 매뉴얼 요구사항 추적 감사와 확장

### 현재 사실

- `manual-index.json`은 20개 PDF의 파일명, hash, 크기, 근사 페이지 수, 제품군을 기록한다.
- 현재 인덱서는 PDF 본문 기능 요구사항을 추출하지 않는다.
- `manual-requirements.json`은 12개 기준 요구사항이며 20권 전체의 원자 요구사항 목록이 아니다.
- `validate-manual-trace.mjs`는 id/status/module 링크를 검증하지만, 매뉴얼의 모든 기능이
  요구사항으로 등록됐는지는 검증하지 않는다.

따라서 “20권 매뉴얼 반영 완료”라고 표현하지 않는다. 현재는 “20권 출처 인덱스와 12개 기준
요구사항의 형식 검증 완료”가 정확한 상태다.

### 기존 12개 요구사항의 구현 연결

| Requirement | 현재 상태 | 닫는 티켓/절 | 필요한 외부 증거 |
|---|---|---|---|
| MAN-FT-001 ordered FeatureTree | partial | T11-T16, §46.1 | gearbox feature reconstruction |
| MAN-SEL-001 selection edit | partial | T17-T21, U3 | fastener face/edge/part E2E |
| MAN-ASM-001 mate residual/DoF | engine verified | T24-T25 | real MeArm neutral assembly |
| MAN-ASM-002 independent hierarchy | partial | T22-T23 | gearbox expected tree manifest |
| MAN-IO-001 STEP roundtrip | partial | T23,T26 | hierarchy/transform/PMI identity |
| MAN-SM-001 sheet metal | engine verified | T27 | real cabinet refold/DXF corpus |
| MAN-WL-001 weldment | engine verified | T27 | real frame cut-list corpus |
| MAN-PMI-001 stable semantic PMI | partial | T17-T18,T26 | NIST target binding roundtrip |
| MAN-UX-001 general/expert project | partial | P7,U1-U3 | cross-mode project E2E |
| MAN-SURF-001 surface modeling | implemented_unverified | T05-T06,T20-T21 | real curved STEP quality corpus |
| MAN-GRAPH-001 editable graph | not implemented | T35 | product graph UX acceptance |
| MAN-CIV-001 civil corridor | not implemented | later vertical | alignment/profile/cross-section golden |

`engine verified`와 `real corpus certified`를 별도 열로 유지한다. 기존 판금·용접 기능이 단위
테스트를 통과했더라도 현재 cabinet/weldment corpus assertion이 not_run이면 외부 인증 완료가 아니다.

### Manual Requirement Ledger v2

새 원장은 다음 원자성을 가진다.

```ts
type ManualRequirement = {
  id:string;
  sourceDocumentIds:string[];
  sourceLocations:Array<{ page:number|null; section:string|null }>;
  domain:string;
  action:string;
  objectKinds:string[];
  preconditions:string[];
  expectedEvidence:string[];
  priority:'P0'|'P1'|'P2';
  applicability:'mechanical-core'|'later-vertical'|'not-applicable';
  implementationStatus:string;
  corpusStatus:'pass'|'fail'|'not_run';
  coreModules:string[];
  tests:string[];
  goldenScenarios:string[];
};
```

### 원장 확장 절차

1. PDF별 목차·heading·기능 동사를 로컬에서 추출하고 source page만 기록한다.
2. 긴 원문을 복사하지 않고 기능을 한 문장의 검증 가능한 action으로 정규화한다.
3. 동일 기능을 제품별 용어와 canonical CAD 용어로 연결한다.
4. geometry/edit/assembly/drawing/exchange/manufacturing/analysis/UX로 분류한다.
5. 각 requirement에 code module, test, golden scenario가 없으면 verified를 금지한다.
6. 두 제품이 같은 기능을 설명해도 source link는 둘 다 유지한다.
7. mechanical-core 밖의 Civil/BIM/visualization은 삭제하지 않고 later-vertical로 유지한다.
8. ledger coverage 보고서에서 문서별 mapped/unmapped heading 수를 공개한다.

### 원장 완료 조건

- 20개 문서 모두 최소 하나 이상의 requirement 또는 명시적 not-applicable 근거를 가진다.
- sourceDocumentId/page가 없는 requirement 0건.
- `implemented_verified`인데 module/test/golden evidence가 없는 항목 0건.
- unmapped functional heading을 0으로 만들거나 제외 사유를 기록한다.
- 요구사항 status와 capability/OpenAPI/코퍼스 결과의 모순 0건.

## 50. 추가 전문가 기능 티켓 T31~T36

기존 T01~T30은 exact geometry/assembly/manufacturing evidence의 핵심 폐루프다. 매뉴얼 감사에서
확인된 전문가 편집 범위를 닫기 위해 다음 티켓을 추가한다.

| ID | 작업 | 선행 | 산출물 | 완료 증거 |
|---|---|---|---|---|
| T31 | Sketch entity/constraint IR | T15,T17 | entity ids, dimensions, constraint graph | DoF/solve/edit golden |
| T32 | Reference geometry 정식 승격 | T17,T31 | plane/axis/point/CSys FeatureTree nodes | persist/dependency/UI/mate E2E |
| T33 | 상세 기계 Feature | T15,T31,T32 | thread/keyway/spline/groove/rib semantics | feature corpus precision/recall |
| T34 | Configuration/equation/design table | T31,T33 | versioned configuration graph | cross-config isolation tests |
| T35 | Drawing/BOM/revision/data-flow graph | T23,T26,T34 | linked drawing package and graph UX | model-drawing-BOM consistency |
| T36 | Manual Ledger v2와 최종 expert gate | T01-T35 | full trace report | 20-document coverage/no contradiction |

T30은 자동 release pipeline의 기반이고, T36은 “일반인부터 전문가까지” 목표의 최종 프로그램
gate다. 따라서 geometry release는 T30에서 가능하지만 expert manufacturing release 표시는 T36까지
통과해야 한다.

## 51. Reference Geometry 구현 세부 계획

현재 `referenceGeometry.ts`의 수학 helper와 설계 문서는 존재하지만 정식 모델 기능은 아니다.

### 데이터 모델

- `ReferencePlaneNode`, `ReferenceAxisNode`, `ReferencePointNode`, `ReferenceCsysNode`를 FeatureTree
  reference node로 추가한다.
- node는 stable id, construction method, params, dependency ids, visibility, evaluation status를 가진다.
- world Front/Top/Right plane과 X/Y/Z axis는 immutable system reference다.
- 기존 `'xy'|'xz'|'yz'`와 `sketchFaceFrame` 문서는 migration adapter로 새 `PlaneRef`에 승격한다.

### 생성 방법

- plane: standard, offset, angle, through-three-points, parallel-through-point, mid-plane,
  line-and-point, cylinder tangent.
- axis: standard, two-points, edge, two-plane-intersection, normal-at-point, cylinder/cone axis.
- point: vertex, edge midpoint, face center, line-plane, three-plane, projection, coordinates.
- CSys: world, origin+axes, origin+plane, face+vertex.

### Dependency와 오류

- 참조 삭제 시 dependent sketch/feature/mate를 dangling 상태로 표시한다.
- 평행 평면 교차, 동일 점 3개, 0 길이 axis 같은 퇴화 입력을 명시적 오류로 반환한다.
- topology-derived reference가 split/merge되면 P3 reconciliation을 거친다.
- dependency cycle은 저장 전에 차단한다.

### 소비자 연결

- sketch plane, extrude/revolve axis, pattern axis, draft pull direction.
- assembly mate plane/axis와 measurement coordinate system.
- drawing view orientation, PMI datum, CNC/export work coordinate.
- selection chat에서 “이 축 기준”, “이 면에서 20mm”를 persistent ref로 해석.

### 완료 조건

- 저장/불러오기/migration/undo/redo/collaboration replay.
- dependency 변경 후 결정론 재평가.
- sketch·feature·mate·drawing 소비자 각각 E2E 1개 이상.
- topology 변경 뒤 잘못된 reference 자동 재부착 0건.

## 52. 기하 릴리스와 공학/CAE 인증 분리

백과사전은 구조·열·유동·피로·접촉까지 다루지만 식이나 solver가 존재한다는 이유로 특정 제품의
공학 안전성을 인증할 수는 없다.

### Geometry Release

- exact B-rep, topology, dimensions, assembly hierarchy, mate/DoF, interference, PMI, STEP roundtrip.
- T01~T30의 주 범위.

### Engineering Evidence Release

- 해석 목적과 적용 기준.
- 재료 property와 온도/방향/출처.
- 하중 case, boundary condition, contact/connector.
- element type, mesh quality, convergence.
- equilibrium/energy/reaction sanity check.
- stress singularity와 averaging 정책.
- safety factor, fatigue/thermal/buckling criteria와 applicability.
- benchmark 또는 hand calculation 대조.

### CAE 단계

1. `analysisIntent`: 무엇을 검증하는지와 실패 기준.
2. `idealization`: solid/shell/beam/rigid/contact 선택 근거.
3. `materialsLoadsBcs`: 단위와 provenance.
4. `mesh`: quality와 convergence series.
5. `solve`: solver version과 residual.
6. `validate`: 평형·에너지·폐형 해·benchmark.
7. `interpret`: singularity/국부 peak/allowable.
8. `release`: geometry revision과 analysis artifact binding.

### 공학 인증 차단 조건

- 하중·구속·재료 중 하나라도 근거 없음.
- rigid-body mode 또는 solver non-convergence.
- mesh convergence 미실행인데 국부 응력을 설계값으로 사용.
- contact/bolt/weld를 geometry 접촉만으로 대체.
- 열·유동·피로가 필요한 제품에서 해당 분석 not_run.
- geometry revision과 analysis mesh revision 불일치.

로봇은 torque/motion/cable evidence, 제트엔진은 열·회전체·피로·clearance, 공장은 구조·배관·전기·
안전거리·공정 evidence를 별도 profile로 요구한다.

## 53. 도메인별 Release Profile

### 일반 기계부품

- geometry/topology/dimension/material/DFM/STEP.
- 움직이지 않으면 mate/motion은 not applicable 근거 필요.

### 로봇

- 독립 actuator/reducer/bearing/structure parts.
- joint axis/limit, FK/IK, singularity, torque, collision, cable, service envelope.
- source-inferred joint는 사용자 승인 전 release 차단.

### 감속기·기어박스

- shaft-bearing-gear-housing hierarchy.
- axis, ratio, backlash/clearance, bearing life, gear contact/bending, lubrication envelope.
- 반복 gear tooth를 mesh 장식으로만 만들지 않고 semantic gear feature로 보존.

### 제트엔진

- fan/compressor/combustor/turbine/shaft/bearing/case 독립 assembly.
- blade profile/station/pattern/tip clearance와 rotor-stator 관계.
- thermal expansion, rotor critical speed, bearing load, high-cycle/low-cycle fatigue.
- CFD/combustion/high-temperature material가 not_run이면 engineering release 금지.

### 공장·생산셀

- equipment hierarchy, foundation/grid/level, port graph.
- robot/conveyor/tool/sensor/fence/cabinet 독립 asset.
- cycle time, buffer, worker/forklift/service envelope.
- electrical/pneumatic/piping/cable tray routing과 clearance.
- STEP/IFC federation, coordinate/georeference, revision/package consistency.

각 profile은 공통 R0~R8 위에 도메인 assertion을 추가한다. profile 미지정 상태에서는 복잡 제품을
`releaseReady=true`로 만들지 않는다.

## 54. Ground Truth 작성·검토·동결 계획

정확도 수치는 독립 정답이 없으면 의미가 없다. 현재 parser/recognizer의 출력을 그대로 expected로
복사하지 않는다.

### Ground Truth 계층

1. `source-declared`: STEP/PMI/assembly entity가 명시한 값.
2. `kernel-measured`: OCCT가 원본 형상에서 직접 측정한 값.
3. `derived-deterministic`: 선언값과 측정값으로 코드가 계산한 관계.
4. `reviewed-inferred`: feature history/mate처럼 원본에 명시되지 않아 검토로 확정한 값.
5. `unknown`: 증거가 부족해 정답을 만들 수 없는 값.

상위 계층을 하위 추론으로 덮지 않는다. `unknown`은 오답이 아니라 평가 제외 사유이며 분모에
별도 공개한다.

### Fixture별 정답 파일

```jsonc
{
  "fixtureId": "A07",
  "sourceHash": "sha256",
  "groundTruthVersion": 1,
  "geometry": {
    "solidCount": { "value": 1, "provenance": "kernel-measured" },
    "volumeMm3": { "value": 0, "tolerancePolicy": "relative-v1", "provenance": "kernel-measured" }
  },
  "features": [{
    "kind": "circular-pattern",
    "parameters": { "count": 4 },
    "importance": "functional",
    "provenance": "reviewed-inferred",
    "evidenceRefs": ["face-signature:..."]
  }],
  "unknown": ["original-feature-order"],
  "review": { "status": "approved", "reviewRevision": 1 }
}
```

### 작성 절차

1. source hash와 포맷 구조를 확인한다.
2. kernel metric을 독립 추출한다.
3. semantic entity와 이름을 별도 추출한다.
4. 자동 후보를 숨긴 상태에서 functional feature/part/interface를 1차 라벨링한다.
5. 자동 후보와 비교해 불일치만 재검토한다.
6. 근거가 불충분하면 억지로 확정하지 않고 unknown/alternative로 둔다.
7. fixture별 review status가 approved가 된 뒤 KPI 분모에 넣는다.
8. source hash 또는 ground truth가 바뀌면 별도 version으로 재승인한다.

### 누출과 자기검증 차단

- ground truth JSON을 AI prompt example로 사용하지 않는다.
- recognizer가 사용하는 heuristic 파일과 평가 expected 파일을 분리한다.
- 현재 구현 결과로 expected snapshot을 자동 갱신하지 않는다.
- snapshot update는 metric diff와 승인 사유가 없으면 CI에서 거부한다.
- 같은 제품의 sibling part가 train/example와 holdout에 섞이지 않게 product group으로 분할한다.

### KPI 분모 규칙

- source-declared/kernel-measured 항목은 해당 측정이 성공하면 분모에 포함한다.
- reviewed-inferred는 approved 항목만 포함한다.
- unknown/not applicable/not_run 수를 각각 공개한다.
- 중요 feature 누락은 장식 feature 여러 개의 적중으로 상쇄하지 않는다.
- micro/macro average를 함께 제시해 대형 fixture가 전체 점수를 독점하지 않게 한다.

## 55. AI 관계 분류 프로토콜

LLM 방법론 자료의 검증 결과를 CAD 관계 추론에 다음과 같이 적용한다.

### 출력 schema

```ts
type CadRelationVote = {
  subjectId:string;
  objectId:string;
  relation:'same_part'|'instance_of'|'contains'|'coaxial'|'coplanar'|
    'parallel'|'perpendicular'|'contact'|'clearance'|'drives'|'unknown';
  evidenceIds:string[];
  ambiguity:string[];
};
```

- 모델은 mate 생성, merge, pass/fail을 직접 결정하지 않는다.
- 코드가 relation과 exact evidence를 받아 허용 action으로 매핑한다.
- evidence id가 없거나 IR에 존재하지 않으면 vote를 폐기한다.

### 자기일관성

- 동일 provider/model/prompt/schema로 기본 5회 실행한다.
- 5/5는 stable, 4/5는 candidate, 3/5 이하는 review/unknown이다.
- part merge, topology binding, source-declared dimension 변경처럼 비가역 비용이 큰 행동은
  5/5라도 deterministic evidence 없이는 자동 적용하지 않는다.
- 다른 모델은 다수결 투표가 아니라 disagreement 탐지와 검토 우선순위에 사용한다.

### 재현성과 비용

- provider, model, endpoint family, prompt hash, schema version, temperature/seed 지원 여부를 기록한다.
- provider별 checkpoint/output 디렉터리를 분리한다.
- fixture×round 단위로 즉시 저장하고 중단 시 결과를 보존한다.
- D/F 자유곡면, unsupported native, already-exact relation은 AI에 보내지 않는다.
- token/cost/time budget 초과는 partial/not_run이며 빈 결과로 대체하지 않는다.

### 회귀

- golden relation set은 실제 production batch 구성에 섞어 평가한다.
- prompt 변경 전후 false merge, false mate, missed relation을 각각 비교한다.
- 자동 적용의 최우선 지표는 false merge/false mate 0건이다.

## 56. 선행관계와 병렬 가능 작업

### Critical Path

`T01 → T03 → T04 → T05 → T06 → T07 → T14 → T15 → T17 → T18 → T22 → T23 → T26 → T28 → T30 → T36`

이 경로의 upstream schema나 identity 규칙이 바뀌면 downstream snapshot을 무효화한다.

### 기반 동결 후 병렬 가능한 Lane

- Lane A: T08~T10 runner/entrypoint/report.
- Lane B: T11~T16 part recognition/reconstruction.
- Lane C: T17~T21 topology/direct edit.
- Lane D: T22~T25 assembly.
- Lane E: T26~T27 PMI/manufacturing.
- Lane F: T31~T35 sketch/reference/drawing/expert UX.

Lane은 파일 충돌 회피 목적이 아니라 의존성 표시다. core schema, topology identity, artifact format은
각 Lane에서 별도로 만들지 않고 Critical Path의 단일 계약을 사용한다.

### 각 Lane 시작 조건

- 입력 schema가 versioned되고 fixture가 존재한다.
- expected failure/status가 정의된다.
- 최소 synthetic test와 one-real-file smoke가 준비된다.
- output consumer와 persistence 영향을 식별한다.

### 각 Lane 병합 조건

- contract/parity test 통과.
- 해당 golden shard에서 KPI 악화 없음.
- migration/undo/cleanup 영향 확인.
- capability와 문서가 실제 상태로 갱신됨.

## 57. 계획 자체의 변경관리

- 각 티켓은 `planned/in_progress/implemented/unverified/verified/blocked` 상태를 가진다.
- `implemented`는 코드가 있다는 뜻이고 `verified`는 정의된 L1~L6 증거가 있다는 뜻이다.
- 티켓 완료 시 계획 문장의 미래형을 실행 기록으로 바꾸고 test count/artifact hash를 남긴다.
- 범위가 바뀌면 삭제하지 말고 decision log에 채택/보류/제외 이유를 기록한다.
- KPI threshold, fixture, tolerance, release profile 변경은 plan revision을 올린다.
- 코드 capability, manual ledger, corpus report, 계획 상태를 하나의 consistency test로 검사한다.

### Decision Log 필수 필드

```text
decisionId, date, scope, alternatives, chosen, reason,
affectedSchemas, affectedFixtures, migration, rollback, approver
```

### 계획 감사 자동화 후보

- manifest fixture 수와 문서의 A18/B7 수 일치.
- T01~T36 id 중복/누락 검사.
- requirement가 존재하지 않는 module/test를 참조하지 않는지 검사.
- capability supported 항목에 구현 test가 있는지 검사.
- release profile의 필수 assertion이 runner adapter에 등록됐는지 검사.
- 문서에서 `verified`인데 최신 corpus evidence가 fail/not_run인 모순 검사.

## 58. 2026-08-05 병렬 기반 묶음 실행 기록

### 완료된 기반

- T01~T02 Manifest v2: Core A18 + Challenge B7 metadata-only 선언과 validator.
- T03 Evidence IR v2: fail-closed validator, canonical serializer/hash, v1 migration.
- T04 상대 공차: 단위 명시, 크기 기반 operation별 tolerance, source tolerance clamp evidence.
- Ground Truth v1: provenance, review/approval, KPI eligibility, 누출 방지 계약.
- Manifest resolver/freezer: root 내부 탐색, ambiguity 차단, byte budget, streaming SHA-256,
  source 변경 감지, 비파괴 frozen manifest.
- T05~T06 OCCT 상세 검사: valid/count/bbox/volume/area/centroid/inertia/surface histogram.
- T07~T08 분석 Core: STEP import→상세 검사→공차→Evidence v2, fail-closed, finally release.

### 실제 코퍼스 검증

- 최초 실행에서 A02의 추측 locator가 실제 경로와 달라 `LOCATOR_NOT_FOUND`가 발생했다.
- 모든 locator를 실제 `ir_index.json`의 안정 부분문자열로 교정했다.
- `C:\Users\gomd9\Downloads\참고파일들`을 read-only로 검사해 A18+B7 **25/25**가
  0-match·ambiguity 없이 유일하게 해석됐다.
- 25개 모두 SHA-256과 observed bytes를 계산해 frozen manifest 생성에 성공했다.
- frozen 결과에는 절대경로와 CAD bytes가 포함되지 않는다.

### 실제 OCCT 검증

- 직접 생성한 analytic box/cylinder에서 exact metric과 surface type을 검증했다.
- box 10×20×30의 STEP export→import→분석 Core 경로에서 volume 6000 mm³,
  surface area 2200 mm²가 실커널 측정과 일치했다.
- inertia는 `GProp_GProps.MatrixOfInertia`를 사용하며 centroid 기준 geometric inertia `mm⁵`로
  명시한다. 재료 density를 곱한 질량 관성으로 오인하지 않는다.
- 현재 opencascade.js binding은 imported STEP adaptor의 surface/curve enum wrapper를 안정적으로
  매핑하지 못한다. 직접 생성 shape의 surface histogram은 가능하지만 imported STEP histogram은
  임의 숫자 매핑 대신 `not_run`으로 유지한다.
- face adjacency도 안전한 OCCT indexed map 연결이 추가될 때까지 `not_run`이다.

### 검증 수치

- Manifest/Evidence/Ground Truth/Tolerance/Resolver 통합: 43 tests pass.
- OCCT 전체와 기반 통합: 76 tests pass, guarded real-corpus test 1개는 일반 실행에서 skip.
- 실제 corpus 환경변수 실행: 1 pass, 25 fixtures frozen.
- 분석 Core: mock/failure/cleanup 6개 + real STEP roundtrip 1개, 총 7 tests pass.
- TypeScript와 관련 ESLint 통과.

### 다음 진입 조건

1. imported STEP surface/curve 분류는 enum 값의 실제 runtime representation을 별도 spike로 고정한다.
2. face adjacency는 `TopExp::MapShapesAndAncestors` 또는 동등한 indexed map binding을 확인한다.
3. 분석 Core를 REST/CLI/MCP/Web thin adapter에 연결한다.
4. runner v2 checkpoint/shard/resume를 구현하고 A18+B7 baseline evidence를 실행한다.
5. histogram/adjacency가 not_run인 상태를 역복원 exact 완료로 승격하지 않는다.
## 59. 실행 기록 — 공통 분석 계약의 API·CLI·MCP 연결

- `POST /api/cad/v1/reference/analyze`는 인라인 STEP(`base64` 또는 `utf8`)만 받고 경로·URL·fixture locator를 거부한다.
- 공개 실행 단위는 `mm` 또는 양수 `scale-to-mm`만 허용한다. `unknown`은 커널 실행 전에 400으로 실패한다.
- STEP 원문은 20 MiB 이하이며 IP rate limit을 적용한다. 응답에는 Evidence IR v2와 tolerance policy만 포함하고 원문·절대경로를 포함하지 않는다.
- CLI `reference analyze`는 로컬 `.step/.stp`를 읽어 동일 API 계약으로 전송하며, scenario와 단위를 필수로 한다.
- MCP `analyze_cad_reference`는 인라인 데이터만 허용하고 서버 오류도 원문·경로가 되비치지 않도록 일반화한다.
- capability/OpenAPI에 API=`/api/cad/v1/reference/analyze`, CLI=`reference analyze`, MCP=`analyze_cad_reference` 매핑을 등록했다.
- 세 진입점 모두 read-only이며 견적·RFQ 부작용은 없다.
## 60. 실행 기록 — Runner v2와 A18+B7 기준선

- frozen Manifest v2 전용 batch runner에 fixture/tier/shard 선택, atomic checkpoint, resume, source hash 재검증, fixture 오류 격리를 구현했다.
- shard 병합은 manifest hash, fixture hash/bytes, shard 배치, 중복·누락, Evidence v2, holdout 및 금지된 부작용을 검증한다.
- 로컬 전용 `corpus:baseline:v2` entrypoint만 corpus/output 경로를 받고 API·MCP·일반 HTTP CLI에는 이를 노출하지 않는다.
- 실제 A18+B7 25개 실행 결과는 pass 0, fail 2, not_run 23, runner error 0이다.
- A01/A10은 OCCT STEP header authorisation parse 실패이며, 25개 모두 imported STEP surface/curve enum mapping이 없어 해당 assertion이 not_run이다.
- 동일 signature로 resume하여 25개 checkpoint를 재사용했다. 결과는 `cad-reference-baseline-260805.json`에 경로·원문 없이 고정했다.
## 61. 실행 기록 — imported STEP 분류와 AP242 복구

- GeomAbs enum container가 callable embind function이라는 런타임 표현을 지원하되, direct singleton 또는 유일한 정수 ordinal 일치만 허용한다.
- `BRepAdaptor_Surface_2(face, true)`의 명시적 restriction 인자를 사용하고 curve adaptor는 edge 단일 인자를 유지한다.
- 대형 AP242는 `ReadFile → TransferRoots → OneShape`가 성공하고 reader destructor에서만 stack overflow가 발생했다. cleanup 실패가 성공한 형상을 import 실패로 뒤집지 않도록 격리했다.
- A01의 단일 FILE_NAME authorisation `$`만 메모리에서 `''`로 보수적으로 재시도하며 DATA section과 원본 파일은 변경하지 않는다.
- 성공과 실패 모두 `geometry.import` assertion을 유지해 baseline 비교에서 검사 삭제가 아닌 fail→pass 전이를 기록한다.
- 실제 A18+B7 재실행은 25 pass, 0 fail, 0 not_run, 0 runner error이며 이전 기준선 대비 regression/blocker 0이다.
## 62. 실행 기록 — fail/not_run 확장 감소 v4

- exact face-edge-face incidence로 boundary/manifold/non-manifold edge와 face degree histogram을 측정한다.
- compound/compsolid/solid/shell 경계를 세되 이를 Product/Part/Occurrence 수로 대체하지 않는다.
- STEP NAUO occurrence는 Part 21 구조 파서로 독립 집계하며 0도 측정된 flat/no-occurrence 결과로 기록한다.
- valid shell/face라도 TopAbs_SOLID가 0이면 manufacturing solid pass를 금지한다.
- public summary builder도 전체 frozen fixture completeness와 Evidence/hash/size/side-effect를 검증한다.
- v3 대비 exact pass assertion 100개를 추가했고 실제 A18+B7는 25 pass, fail/not_run/error 0, regression/blocker 0을 유지했다.

## 63. 실행 기록 — STEP occurrence 좌표 복원과 fail-closed v5

- face adjacency와 compound/compsolid/solid/shell 경계를 유지하면서 STEP NAUO occurrence를 body 수와 독립적으로 해석한다.
- occurrence마다 parent/child definition, parent occurrence, local-to-parent 행렬, world 행렬을 기록한다.
- 변환 누락 시 identity를 추정하지 않고 `not_run`, 특이·반사·비균일 스케일 변환은 `fail`로 판정한다.
- 순환 assembly graph와 다중 parent 문맥으로 world frame이 모호한 경우 release 가능한 성공으로 판정하지 않는다.
- v5 실제 A18+B7 25개에서 occurrence 78개와 world placement 78개를 복원했다. 누락·invalid·reflection·non-uniform scale은 모두 0이었다.
- 실제 결과는 25 pass, 0 fail, 0 not_run, 0 error이며 producer와 checkpoint signature를 v5로 분리했다.
- 추가 fail-closed 경로: legacy STEP solid 0, PMI 0→0, manufacturing G6 0→0, precise interference 없는 assembly `designOk`를 모두 거짓 통과하지 않게 했다.
- 상세 고정 결과는 `cad-reference-baseline-260805-v5.json`에 원문·절대경로·견적/RFQ 부작용 없이 기록했다.

## 64. 실행 기록 — 기계·인테리어 A→E 통합 기반 v6

- A: CAD 오류 taxonomy와 bounded STEP recovery를 추가하고 import 실패를 안정적인 machine code로 분류했다.
- B: 기계 Product와 BIM Spatial container를 구분하는 공통 IR, IFC hierarchy와 placement-chain 증거를 추가했다.
- C: placement, authoritative DoF, precise interference, closed space, egress, MEP interference를 공통 fail-closed gate로 묶었다.
- D: 요구사항→Product/Spatial IR→exact geometry→cross-domain verification→roundtrip export 순서의 AI project pipeline과 제한된 stage-local retry를 추가했다.
- E: `/api/cad/v1/project/verify`, `project verify`, `verify_cad_project`를 동일 계약으로 연결했다.
- 참고자료 20개 PDF의 bytes/SHA-256을 다시 확인해 20/20 일치했고, 7.3 백과사전의 healing 전후 volume/topology/tolerance 및 minimum-edge 제한을 정책에 반영했다.
- 실제 STEP A18+B7 v6은 25 pass, fail/not_run/error 0, assertion 425개, occurrence/world placement 78/78이다. v5 대비 상태 악화·assertion 삭제는 0이다.
- IFC exact world matrix roundtrip, OCCT ShapeFix 실행, continuous collision, door-swing swept clearance는 아직 부분/미구현이며 완료로 인증하지 않는다.
