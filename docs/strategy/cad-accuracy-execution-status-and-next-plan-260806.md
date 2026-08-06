# CAD 정확도 구축 현황 및 다음 통합 실행 계획

> 기준일: 2026-08-06  
> 작업 루트: `nexyfab.com/new`  
> 제품 목표: 일반인과 전문가가 대화로 실제 제조 가능한 다중 부품·다중 body CAD를 설계하고, 면·선·부품 선택 수정과 조립·동작 검증까지 수행  
> 제외 범위: 공장 견적 요청, RFQ 생성·연결, 자동 견적

복잡 제품 AI 생성 정확도 95%의 별도 측정·구현 계획은 `ai-complex-product-95-plan-260806.md`를 따른다.

## 1. 불변 원칙

1. 제품은 `Product → Subassembly → Part → Body → Feature → Face/Edge` 계층을 유지한다.
2. 제조·구매·교체 단위가 다른 부품을 단일 body로 합치지 않는다.
3. AI는 설계 후보와 관계 후보를 만들지만 최종 통과 판정은 결정론적 커널·공학 계산·golden corpus가 담당한다.
4. `pass`, `fail`, `not_run`, `unavailable`을 구분하며 누락·추정·미실행을 통과로 승격하지 않는다.
5. 원본 파일, parser/kernel 버전, tolerance, 입력 hash와 산출 증거를 함께 기록한다.
6. mesh와 AABB는 preview 및 broad phase 증거이며 exact B-rep 검증을 대체하지 않는다.
7. 모든 자동 복구는 적용 전후 diff, 원인 코드, 재검증 결과와 rollback 지점을 남긴다.
8. Web·API·CLI·MCP는 동일 core, schema, 오류 코드와 release gate를 사용한다.

## 2. 이번 체크포인트까지 완료한 작업

### 2.1 제품 단위 코퍼스 bundle

- `cadCorpusProductBundle.ts`에 제품 lineage와 역할 분류를 구현했다.
- 역할은 authoritative geometry, exchange/native assembly, native/mesh part, drawing, documentation, motion/reference visual로 분리한다.
- 모든 원본을 SHA-256으로 결속한다.
- `.snapshot.N` 기준으로 lineage를 고정하고 서로 다른 제품 lineage의 자료 결합을 금지한다.
- 실제 MeArm bundle 결과:
  - 전체 151개 파일
  - 89,595,298 bytes
  - authoritative X_T 1개
  - native assembly 9개
  - native part 34개
  - mesh part 93개
  - motion reference 5개
  - drawing 1개
  - documentation 1개
  - reference visual 7개

관련 구현:

- `src/lib/reference/cadCorpusProductBundle.ts`
- `src/lib/reference/cadCorpusProductBundle.test.ts`
- `scripts/reference/build-cad-product-bundle.ts`
- `npm run corpus:bundle`

### 2.2 다중 부품 assembly fusion IR

- STL 파일명을 definition과 occurrence로 분리했다.
- 반복 STL을 하나의 part definition 아래 여러 occurrence로 보존한다.
- SLDPRT는 정규화된 의미 이름으로 연결 후보를 만들되 확정 transform을 추정하지 않는다.
- 원본 네이티브 좌표계가 없으면 모든 transform은 `not_run`이다.
- X_T 전체 body 수와 STL occurrence 수를 무조건 1:1로 간주하지 않도록 수정했다.
  - `body count > occurrence count`: multi-body part 가능성이 있으므로 body membership `not_run`
  - `body count < occurrence count`: 구조적으로 불충분하므로 `fail`
- 실제 MeArm 결과:
  - part definition 35개
  - mesh occurrence 93개
  - authoritative X_T body 141개
  - 아직 part에 소속되지 않은 body 48개
  - 잘못된 count mismatch `fail`을 제거하고 compound-part membership `not_run`으로 교정

관련 구현:

- `src/lib/reference/cadProductAssemblyFusion.ts`
- `src/lib/reference/cadProductAssemblyFusion.test.ts`
- `scripts/reference/fuse-cad-product-assembly.ts`
- `npm run corpus:fuse`

### 2.3 STL occurrence 실제 형상 증거

- bundle manifest hash와 실제 STL bytes를 다시 대조한다.
- 각 occurrence에서 triangle count, AABB, surface area, volume, centroid, watertight/fidelity를 측정한다.
- 원본 hash 불일치 또는 파싱 실패는 `fail`, 열린 mesh는 `not_run`, 폐합 mesh만 `pass`이다.
- 실제 93개 결과:
  - pass 87개
  - fail 0개
  - not_run 6개
  - 통과 mesh 총 478,652 triangles
  - 통과 mesh 체적 합계 109,832.79 mm³
- `not_run` 6개는 파서 실패가 아니라 원본 open mesh이다.
  - pan-head screw 2개
  - SG90 servo housing 4개
- 이 증거를 fusion IR에 연결하여 evidence 누락은 `not_run`, manifest hash 불일치는 `fail`로 처리한다.

관련 구현:

- `scripts/reference/measure-cad-product-mesh-occurrences.ts`
- `npm run corpus:mesh-occurrences`

### 2.4 네이티브 assembly evidence 계약

- SLDASM 같은 독점 바이너리를 임의 문자열 분석으로 복원하지 않는다.
- 외부 CAD extractor가 생성할 `nexyfab.native-assembly-evidence.v1` 계약을 구현했다.
- 검증 대상:
  - source SLDASM 경로와 SHA-256
  - extractor 이름·버전·CAD 시스템·CAD 버전
  - definition과 occurrence ID 유일성
  - parent occurrence 참조와 단일 root
  - 각 occurrence의 유한한 4×4 transform
  - joint 종류, 부모/자식 occurrence, axis, origin, lower/upper limit
  - source lineage 및 bundle membership
- 증거 누락은 `not_run`, hash·transform·joint 손상은 `fail`이다.
- fusion IR에 native evidence status, native occurrence 수와 joint 수를 연결했다.

관련 구현:

- `src/lib/reference/cadNativeAssemblyEvidence.ts`
- `src/lib/reference/cadNativeAssemblyEvidence.test.ts`
- `scripts/reference/validate-native-assembly-evidence.ts`
- `npm run corpus:native-assembly`

### 2.5 검증 결과

- product assembly fusion 및 native evidence 단위시험 7개 통과
- 변경 파일 ESLint 통과
- 전체 TypeScript `tsc --noEmit` 통과
- 실제 MeArm fusion 최종 상태: `not_run`
- 현재 직접 원인: `native_assembly_extractor_not_run`
- 로컬에서 SolidWorks/eDrawings 실행 파일을 발견하지 못했으므로 SLDASM transform과 mate를 추정하지 않았다.

실행 중간 산출물은 현재 임시 경로에 있으므로 재현 명령의 결과를 장기 evidence 디렉터리로 옮기는 작업이 필요하다.

- `C:\tmp\mearm-product-bundle-v1.json`
- `C:\tmp\mearm-mesh-occurrences-v1.json`
- `C:\tmp\mearm-assembly-fusion-v3.json`

## 3. 현재 정확하게 말할 수 있는 범위

### 확인된 것

- 제품 lineage가 같은 X_T, SLDASM, SLDPRT, STL, drawing, 문서와 motion reference를 하나의 추적 가능한 bundle로 묶을 수 있다.
- 93개 개별 STL occurrence를 flatten하지 않고 보존하고 실제 형상 지문을 계산할 수 있다.
- 원본 open mesh, hash 불일치, evidence 미실행을 서로 다른 결과로 분류할 수 있다.
- multi-body part와 assembly occurrence 수가 다를 수 있음을 판정 정책에 반영했다.
- 외부 네이티브 extractor 결과를 안전하게 수용할 schema와 fail-closed validator가 있다.

### 아직 확인되지 않은 것

- 실제 MeArm SLDASM의 occurrence transform과 subassembly hierarchy
- 141개 X_T body가 35개 part definition 및 93개 occurrence에 속하는 정확한 관계
- 실제 joint/mate, 축, limit와 원본 motion의 일치
- 관절 전체 구간의 exact collision, clearance 및 first-contact frame
- 재질·밀도 기반 질량과 무게중심
- 이 제품을 포함한 전체 코퍼스 95% 이상 통과율

따라서 현재 결과를 “복잡한 로봇을 제조 정확도로 완전 복원했다”고 표현하면 안 된다. 형상 occurrence 증거는 크게 개선됐지만 네이티브 조립 의미와 동작 검증은 후속 단계다.

## 4. 다음 실행 계획

각 단계는 `구현 → 단위시험 → 정적 검사 → 실제 코퍼스 실행 → 원인 분류 → 정책/구현 조정 → 재실행` 순서로 끝낸다. 이전 단계의 계약을 깨는 회귀가 나오면 다음 단계로 넘어가기 전에 수정한다.

### P0-3 네이티브 좌표계·joint ground truth 완성

#### 구현

1. SolidWorks Document Manager/API, headless CAD worker 또는 사용자가 실행 가능한 exporter adapter를 정의한다.
2. extractor 출력은 native evidence v1 JSON으로 제한하고 원본 SLDASM hash를 필수화한다.
3. root assembly와 8개 subassembly를 재귀 순회하여 definition/occurrence를 분리한다.
4. suppressed, lightweight, flexible subassembly와 configuration을 별도 상태로 보존한다.
5. transform의 좌표 convention, 행/열 우선, 길이·각도 단위를 evidence metadata에 명시한다.
6. SolidWorks mate를 fixed/revolute/prismatic/cylindrical/planar/spherical 및 unresolved constraint로 변환한다.
7. mesh definition과 native definition은 이름만으로 확정하지 않고 source path, geometry fingerprint, occurrence 수를 함께 비교한다.
8. 141개 X_T body를 native part별 body membership으로 복원한다.

#### 점검·조정 조건

- root가 0개 또는 2개 이상이면 `fail`.
- cyclic parent graph, singular transform, NaN/Infinity는 `fail`.
- configuration이 불명확하면 해당 branch만 `not_run`.
- 이름은 같지만 geometry fingerprint가 다르면 자동 연결하지 않는다.
- transform 단위나 handedness를 알 수 없으면 좌표 정확도는 `not_run`.

#### 완료 기준

- actual MeArm의 native definition/occurrence/subassembly 수가 sidecar와 fusion에서 일치한다.
- 모든 활성 occurrence가 하나의 root에 도달한다.
- transform roundtrip 최대 오차 ≤ 0.01 mm / 0.01°.
- part/body/occurrence mapping 누락 0개 또는 누락마다 명시적 원인 코드가 존재한다.

### P0-4 관절 전 구간 collision·clearance 검증

#### 구현

1. native joint evidence를 기존 assembly solver 입력으로 변환한다.
2. 초기 pose에서 residual, Jacobian rank, 자유도와 과구속/저구속을 계산한다.
3. joint limit을 coarse sampling하고 인접 frame의 swept AABB로 broad phase를 수행한다.
4. broad-phase 후보만 triangle SAT 또는 OCCT exact narrow phase로 재검증한다.
5. 충돌 구간은 이분 탐색하여 first-possible/confirmed collision frame bracket을 저장한다.
6. 의도된 접촉, bearing/shaft fit, fastener/hole 관계는 명시적 interface evidence가 있을 때만 whitelist한다.
7. 최소 clearance와 해당 part pair, joint value, frame을 기록한다.
8. GIF motion reference는 joint 방향·순서의 보조 증거로만 사용하고 치수 ground truth로 사용하지 않는다.

#### 점검·조정 조건

- AABB 과탐을 실제 collision으로 확정하지 않는다.
- geometry가 open mesh이면 exact clearance는 `not_run`이며 보수적 preview만 제공한다.
- CCD 예산 초과분을 통과 분모에서 숨기지 않는다.
- 동일 pair가 반복 실패하면 tolerance 확장 전에 좌표계·단위·의도 접촉을 먼저 점검한다.

#### 완료 기준

- 모든 joint의 전체 limit 또는 선언된 operating range가 검사된다.
- collision 0이라는 결론은 모든 후보 narrow phase가 완료된 경우에만 허용한다.
- golden collision의 first-contact frame 오차 ≤ 1 frame 또는 joint range의 0.5%.
- unresolved/unchecked pair 0개가 release 조건이다.

### P0-5 실제 코퍼스 재측정 및 자동 원인 대응

1. robot, motor, gearbox, cylinder, cabinet, weldment, heavy equipment를 제품 bundle 단위로 재구성한다.
2. 각 scenario를 geometry, hierarchy, pattern, mate, motion, clearance, material/mass로 분리 채점한다.
3. `fail/not_run`을 parser, missing extractor, unsupported entity, open mesh, unit unknown, budget exhausted, ground-truth absent 등으로 분류한다.
4. 원인별 deterministic repair만 자동 수행한다.
5. 수정 전후 evidence diff와 재시도 횟수를 저장한다.
6. 제품별 통과율과 assertion별 통과율을 동시에 보고한다.

완료 기준은 대상 assertion의 95% 이상 pass, 허위 pass 0건, 원인 없는 generic failure 0건이다. 지원하지 않는 독점 포맷은 분모에서 몰래 제외하지 않고 별도 `unavailable/not_run` 비율로 공개한다.

### P1 재질·질량·관성

1. native material, STEP property, 사용자 지정 material을 출처 우선순위로 병합한다.
2. density의 값·단위·표준·출처를 필수화한다.
3. part별 volume×density, assembly mass, CG와 inertia tensor를 계산한다.
4. mesh-open 및 material-unknown은 질량 exact 통과를 금지한다.
5. welded cut-list와 purchased component mass를 별도 처리한다.

완료 기준은 golden 질량 오차 ≤1%, CG 각 축 오차 ≤0.5%, 단위/재질 추정 pass 0건이다.

### P1 AI 다단 생성·국소 수정·자동 복구

1. 요구조건과 미해결 조건 추출
2. 기능 계통과 독립 부품 분해
3. interface, datum, joint, manufacturing intent 정의
4. 부품별 FeatureTree 생성
5. exact kernel build와 topology 검사
6. assembly solve, DoF, collision/clearance 검사
7. 공차·재질·DFM·PMI·STEP roundtrip 검사
8. 오류 class별 국소 repair 후 실패 단계부터 재검증

면·선·부품 선택 수정은 persistent topology signature와 연결하고 `matched/split/merged/lost/new`를 반환한다. 한 부품 오류 때문에 전체 제품을 처음부터 재생성하지 않으며, 사용자 확정 치수·재료·공차를 repair가 변경하지 못하게 한다.

### P1 건축·토목·조경·인테리어 hybrid vertical

- 공통 spatial IR: site, building, storey, space, element, opening, system, finish, furniture, landscape object.
- 건축: 벽·슬래브·지붕·창문·문·베란다·계단·곡면 외피·복도와 IFC hierarchy/placement.
- 토목: alignment, profile, corridor, terrain, drainage, structure와 좌표계/georeference.
- 조경: terrain, planting, hardscape, retaining/drainage와 계절·성장 clearance.
- 인테리어: room program, circulation, furniture, door swing, MEP interference, 조명과 Radiance.
- 기계 CAD의 part/assembly kernel은 가구·설비·연결 상세에 재사용하고 공간·건물 의미는 IFC 계층으로 유지한다.

각 vertical은 서로 다른 golden corpus와 KPI를 사용하되 selection/edit, evidence, fail-closed, API 계약은 공통으로 유지한다.

### P1 Radiance 조명 검증

1. 고정 버전 Radiance 실행 환경을 확보한다.
2. geometry/material/light/weather 입력 hash를 manifest에 저장한다.
3. illuminance, glare, daylight 결과를 golden room과 비교한다.
4. 실행 파일·weather·material 누락은 `not_run`이다.
5. 상업 배포물에 Radiance 라이선스·고지 요구사항을 포함한다.

### P2 대규모 성능·안정성

- 10k+ occurrence의 parsing, BVH, selection, transform update, frame animation을 측정한다.
- lazy loading, instancing, worker 분리와 memory budget을 적용한다.
- partial result가 release-ready로 오인되지 않도록 cancellation/resume checkpoint를 둔다.
- 동일 입력의 결과 재현성과 장시간 soak를 검증한다.

### P2 Web·API·CLI·MCP 최종 통합

1. 같은 request/response schema와 core 함수를 사용한다.
2. Web에서 part 이동, joint 조작, 0~N frame timeline, collision frame 탐색을 제공한다.
3. API·CLI·MCP가 같은 evidence ID, status, warning/error code를 반환한다.
4. API 호출 실패와 AI transport 단절은 geometry 실패와 분리한다.
5. production AI endpoint, 인증, rate limit, timeout, retry와 streaming을 실제 배포 환경에서 smoke test한다.
6. release gate는 quote/RFQ를 생성하지 않는 read-only CAD 검증으로 유지한다.

## 5. 공통 단계별 점검 템플릿

각 구현 단위마다 아래 기록을 남긴다.

1. 변경 목적과 입력 원본 hash
2. 변경 파일과 schema version
3. 단위시험 및 negative test 결과
4. ESLint, TypeScript, 관련 integration test 결과
5. 실제 corpus 실행 결과와 pass/fail/not_run 수
6. 새로 발견한 오판정 또는 누락
7. 적용한 조정과 조정 전후 diff
8. 남은 blocker와 다음 단계 진입 여부

## 6. 바로 이어서 수행할 순서

1. 임시 MeArm JSON 세 개를 저장소 evidence 디렉터리에 재현 가능하게 생성하는 runner와 manifest를 추가한다.
2. native evidence v1에 transform convention, units, configuration, suppression/flexible 상태를 보강한다.
3. native evidence → assembly solver adapter와 synthetic golden fixture를 구현한다.
4. 기존 precise interference/continuous collision 엔진에 adapter 결과를 연결한다.
5. joint range sampler와 first-contact bracket 회귀시험을 추가한다.
6. 실제 SLDASM extractor가 없는 환경의 `not_run` remediation을 capability/API/CLI/MCP에 동일하게 노출한다.
7. MeArm 이후 motor·gearbox 실제 bundle로 동일 파이프라인을 재실행한다.

이 순서는 독점 CAD extractor가 당장 없어도 계약·solver·collision 연결을 먼저 완성할 수 있게 구성했다. 실제 extractor가 확보되면 같은 evidence schema로 sidecar만 투입하여 실제 좌표계와 joint 검증을 즉시 재실행한다.

## 7. 다음 작업 상세 WBS

### 묶음 N1 — 재현 가능한 evidence 보존

목표는 `C:\tmp` 파일에 의존하지 않고 같은 source hash에서 같은 보고서를 다시 만드는 것이다.

#### N1-1 저장 구조

- `data/reference-evidence/manifests/`: bundle 및 실행 manifest
- `data/reference-evidence/reports/`: 사람이 검토 가능한 소형 JSON summary
- 대용량 원본·삼각형 배열은 저장소에 복사하지 않고 원본 상대경로와 SHA-256만 기록한다.
- report에는 schema, generator version, source root identity, source hash, command, 생성 시각과 결과 count를 기록한다.
- 절대 사용자 경로는 장기 산출물에 저장하지 않는다.

#### N1-2 단일 runner

- 새 파일: `scripts/reference/run-cad-product-evidence.ts`
- 입력: bundle discovery spec, corpus root, output directory, optional native evidence.
- 실행 순서: bundle → mesh measurement → native validation → fusion → summary.
- 중간 단계가 `fail`이어도 이후 독립 측정은 계속하며 최종 exit code는 가장 심한 상태를 사용한다.
- 원본 hash가 같은 기존 산출물만 재사용하고 schema/generator version이 달라지면 다시 계산한다.

#### N1-3 시험

- 임시 synthetic corpus로 pass, open-mesh `not_run`, hash mismatch `fail`을 재현한다.
- Windows 경로 탈출, cross-lineage, duplicate member를 negative test한다.
- 두 번 실행한 JSON에서 생성 시각을 제외한 canonical content가 byte-equivalent인지 검사한다.

#### N1 완료 조건

- MeArm 세 보고서를 한 명령으로 재생성한다.
- 보고서에 절대 경로와 원본 CAD bytes가 포함되지 않는다.
- 93개 occurrence count와 87/0/6 결과가 기존 측정과 일치한다.

### 묶음 N2 — native evidence v1.1과 좌표 검증

#### N2-1 schema 추가 필드

- `coordinateSystem`: handedness, up axis, forward axis, matrix layout, vector convention.
- `units`: length와 angle을 명시하며 canonical 내부 단위는 mm/degree로 고정한다.
- `configuration`: assembly/part configuration 이름과 referenced configuration.
- occurrence 상태: resolved, suppressed, lightweight, flexible, hidden.
- `transformScope`: local-to-parent 또는 local-to-world.
- extractor capability: hierarchy, transforms, mates, configurations, body membership 각각 `pass/not_run/unavailable`.

#### N2-2 수학 검증

- affine 마지막 행/열 convention 검사.
- 3×3 회전부의 orthonormal 오차와 determinant 검사.
- determinant가 음수인 mirror occurrence는 일반 rigid transform과 분리한다.
- local-to-parent transform을 root부터 합성하고 cycle을 검출한다.
- quaternion 변환 후 matrix roundtrip 오차를 기록한다.
- 단위 변환은 source metadata가 명시된 경우에만 수행한다.

#### N2-3 상태 정책

- singular, NaN, cycle, 잘못된 parent, source hash mismatch: `fail`.
- lightweight 미해결, referenced configuration 누락, unit unknown: 해당 branch `not_run`.
- suppressed occurrence는 assembly tree에는 보존하지만 solver/collision 활성 집합에서는 제외한다.
- flexible subassembly는 rigid flatten을 금지하고 내부 joint evidence가 없으면 motion `not_run`.

#### N2 시험 fixture

- 정상 우수 좌표계, mm와 inch 변환, local transform 3-depth 합성.
- left-handed/mirror, singular matrix, scale/shear 혼입, cycle graph.
- suppressed와 flexible subassembly 혼합.

#### N2 완료 조건

- transform validator branch coverage 100%.
- 합성 transform 오차 ≤1e-9 내부 단위.
- scale/shear를 rigid pose로 오인하는 사례 0건.

### 묶음 N3 — native joint → solver adapter

#### N3-1 신규 산출물

- 새 파일: `src/lib/reference/cadNativeAssemblyAdapter.ts`
- 출력:
  - `AssemblyState`
  - part/occurrence ID mapping
  - resolver용 axis/origin reference registry
  - compiled joint 목록
  - unsupported/unresolved joint 목록
  - adapter certificate

#### N3-2 occurrence 변환

- native world transform의 translation을 `PartInstance.position`으로 변환한다.
- 정규화한 rotation을 `(x,y,z,w)` quaternion으로 변환한다.
- root occurrence만 기본 fixed로 지정한다.
- definition은 공유해도 occurrence마다 고유 PartInstance ID를 사용한다.
- suppressed occurrence는 state에서 제외하되 excluded evidence에 남긴다.

#### N3-3 joint 변환 정책

| Native joint | 기존 엔진 연결 | 초기 정책 |
|---|---|---|
| fixed | coincident/concentric 같은 임의 조합을 만들지 않고 전용 rigid relation compiler 사용 | 정확한 frame reference가 있으면 pass |
| revolute | `HingeMate` + axis/origin + signed zero-angle reference + degree limit | 지원 |
| prismatic | 기존 `slot`으로 억지 변환 금지 | 전용 prismatic mate 추가 전 `not_run` |
| cylindrical | revolute+prismatic으로 분해하려면 독립 축/limit 증거 필요 | 초기 `not_run` |
| planar | coincident 하나로 완전 대체 금지 | 전용 planar joint 전 `not_run` |
| spherical | point coincidence로 회전 자유도를 보존하는 전용 compiler 필요 | 초기 `not_run` |

이 정책의 목적은 지원하지 않는 joint를 그럴듯한 완전구속 mate로 변환하여 거짓 `pass`를 만드는 것을 막는 것이다.

#### N3-4 reference registry

- native axis/origin을 각 occurrence의 body-local frame으로 역변환해 registry에 등록한다.
- hinge 양쪽 axis가 world frame에서 동축인지 각도·거리 residual로 검사한다.
- zero-angle vector는 axis에 수직인 안정적인 basis를 결정론적으로 만들고 source pose와 함께 저장한다.
- 동일 축에서 basis 방향이 뒤집혀 limit 부호가 반전되지 않도록 signed convention을 고정한다.

#### N3-5 시험

- 2-part hinge, 3-link arm, nested subassembly, repeated definition occurrence.
- 잘못된 axis, 뒤집힌 limit, root 없음, unsupported prismatic.
- 입력 순서가 달라도 canonical output이 동일한 결정론 시험.
- `validateAssembly`, solver residual과 rank DoF를 함께 검사한다.

#### N3 완료 조건

- revolute golden의 axis 거리 ≤0.01 mm, 축 각도 ≤0.01°.
- 선언 자유도와 rank DoF 일치.
- unsupported joint가 solver pass로 포함되는 사례 0건.
- root/occurrence flattening으로 부품 ID가 사라지는 사례 0건.

### 묶음 N4 — motion·continuous collision·clearance 통합

기존 자산을 재사용한다.

- `src/lib/assembly/motionStudy.ts`: hinge/value sweep와 warm-start solve.
- `src/lib/assembly/interference.ts`: spatial AABB broad phase.
- `src/lib/assembly/featureTreePreciseInterference.ts`: mesh/OCCT narrow phase, rotational interval refinement, collision time bracket.
- `src/lib/assembly/assemblyAnimationVerification.ts`: frame 및 연속 구간 검증과 bounded recovery.
- `src/app/api/cad/v1/assembly/verify/route.ts`: solver·DoF·static/motion interference release gate.

#### N4-1 joint sweep planner

- 새 파일: `src/lib/reference/cadNativeJointMotionPlan.ts`
- 각 supported joint의 lower/upper 또는 operating range를 읽는다.
- range가 없으면 motion을 통과시키지 않고 `joint_range_not_run`을 반환한다.
- 기본 coarse step은 각도 range와 part 회전 반경으로 정하며 최대 chord error로 제한한다.
- solver 실패·충돌 후보·clearance 급변 구간만 adaptive subdivision한다.

#### N4-2 geometry 연결

- mesh evidence의 AABB를 occurrence local frame으로 되돌릴 수 있는 경우에만 localBoxes로 사용한다.
- 현재 STL이 assembly world pose로 export된 것이라 local transform을 모르면 local box로 재사용하지 않는다.
- closed mesh 87개는 precise geometry 후보, open mesh 6개는 conservative/unavailable로 보존한다.
- X_T body membership이 복원되면 exact B-rep/OCCT geometry를 mesh보다 우선한다.

#### N4-3 접촉 정책

- intended contact는 source mate/interface ID와 justification을 모두 요구한다.
- 단순 whitelist string은 release-ready 경로에서 금지한다.
- bearing/shaft, screw/hole, gear mesh는 종류별 허용 contact와 required clearance를 별도 규칙으로 둔다.
- 접촉 허용이 collision volume 관통까지 자동 허용하지 않게 한다.

#### N4-4 time of impact와 clearance

- broad-phase interval을 precise separation과 motion bound로 분류한다.
- `proven_clear`, `confirmed_collision`, `unresolved`, `unavailable`을 유지한다.
- collision은 `firstPossibleFrame`과 `confirmedCollisionFrame` bracket으로 보고한다.
- 최소 clearance는 값뿐 아니라 part pair, joint value, frame, geometry fidelity를 함께 기록한다.
- recovery는 rotational depth/budget만 단계적으로 늘리며 geometry나 tolerance를 변경하지 않는다.

#### N4-5 API/CLI/MCP

- core 함수는 route 밖 `src/lib/reference` 또는 `src/lib/assembly`에 둔다.
- API: 기존 `/api/cad/v1/assembly/verify`에 native evidence 입력 또는 별도 read-only reference verify endpoint 추가.
- CLI: `reference assembly-motion --bundle --native-evidence`.
- MCP: 동일 API schema를 전달하는 `verify_reference_assembly_motion`.
- 세 표면의 status, error code, evidence summary snapshot을 contract test로 비교한다.

#### N4 완료 조건

- 0~N frame에서 sampled frame과 열린 interval을 모두 검증한다.
- unresolved interval, missing geometry, solver non-convergence가 있으면 releaseReady=false.
- synthetic known-collision fixture에서 first-contact bracket 오차 ≤1 frame.
- known-clear fixture에서 collision false positive를 precise phase가 해제한다.
- API·CLI·MCP 결과의 핵심 certificate가 동일하다.

## 8. 구현 순서와 각 단계 종료 점검

| 순서 | 구현 단위 | 필수 시험 | 실제 실행 | 다음 단계 진입 조건 |
|---:|---|---|---|---|
| 1 | N1 runner/manifest | canonical·path/hash negative | MeArm 93개 | 87/0/6 재현 |
| 2 | N2 schema/transform | matrix·unit·cycle fixture | sidecar 없는 MeArm | 정확한 remediation 유지 |
| 3 | N3 occurrence adapter | nested/repeated/root fixture | synthetic robot | transform·ID·DoF 통과 |
| 4 | N3 revolute compiler | hinge axis/limit fixture | 3-link robot | residual/DoF 기준 통과 |
| 5 | unsupported joint gate | 5종 negative fixture | mixed-joint robot | 거짓 solver pass 0건 |
| 6 | N4 motion planner | range/adaptive fixture | 3-link sweep | 전 range frame 생성 |
| 7 | CCD/precise 연결 | known-clear/collision/open mesh | synthetic sweep | bracket·unresolved 정책 통과 |
| 8 | parity 연결 | API·CLI·MCP contract | local smoke | certificate 동일 |
| 9 | actual 재측정 | 전체 관련 회귀 | MeArm + 다음 제품 | 원인별 수치 보고 |

각 행이 끝날 때 관련 Vitest, ESLint, `tsc --noEmit`, 실제 명령을 실행한다. 실패하면 오류를 시험 부족, schema 문제, implementation defect, source limitation, environment limitation으로 분류하고 해당 행 안에서 조정한 뒤 재실행한다.

## 9. 이번 다음 묶음에서 만들지 않을 것

- SLDASM 바이너리 휴리스틱 파서
- 이름만으로 확정하는 body/part/mate 연결
- open mesh의 가짜 watertight repair와 exact 승격
- prismatic/cylindrical/planar/spherical의 부정확한 hinge/slot 대체
- AABB만으로 collision-free를 선언하는 release certificate
- 미실행 항목을 제외해 만든 인위적 95% 통과율
- 견적·RFQ·공장 연결 기능

## 10. 2026-08-06 후속 실행 체크포인트

### 완료

- N1 단일 재현 runner `corpus:product-evidence` 구현.
- `docs/evidence/mearm-snapshot-10/`에 bundle, mesh, native, fusion, summary 보고서 영속화.
- 실제 원본에서 두 번 재실행하여 5개 보고서 SHA-256 안정성 확인.
- 장기 보고서의 사용자 절대경로 유출 0건 확인.
- 실제 결과 재현:
  - bundle 151개, 89,595,298 bytes, 제외 0개
  - mesh 93개: pass 87, fail 0, not_run 6
  - definitions 35개, occurrences 93개, X_T body membership 미복원 48개
  - native SLDASM extractor 부재로 최종 `not_run`
- N2 native evidence v1.1 구현:
  - 좌표계, 단위, transform scope, definition kind, occurrence 상태, joint frame scope
  - affine row, orthonormal, scale/shear, determinant/mirror와 parent cycle 검증
  - suppression conflict 및 zero-length joint axis 차단
- N3 native assembly adapter 구현:
  - local-to-parent transform 재귀 합성
  - mm/cm/m/in translation 변환
  - rigid matrix → quaternion
  - occurrence ID 보존과 root fixed anchor
  - world joint axis/origin → body-local reference registry
  - revolute → signed `HingeMate`와 degree/radian limit 변환
  - prismatic 등 unsupported joint는 `not_run`, slot/hinge로 위장하지 않음
- N4 joint motion planner 구현:
  - 전체 joint limit coverage
  - maximum angular step과 maximum step budget
  - range 누락 및 budget 초과의 명시적 `not_run`

### 자체 점검 결과

- 새 pipeline governance, evidence, adapter, planner 시험 통과.
- 관련 ESLint와 전체 TypeScript 검사 통과.
- motion sweep, animation continuous CCD, precise mesh/OCCT interference 회귀를 함께 실행.
- 관련 6개 파일 묶음에서 36개 시험 통과.
- OCCT boolean/hole tessellation, rotational interval separation, collision bracket와 budget exhaustion 경로 통과.
- 점검 중 발견한 inch joint-origin 단위 버그를 수정하고 nested inch fixture를 추가함.

### 다음 미완료 연결

1. adapter + motion planner를 호출하는 하나의 native motion verification core.
2. native STL 원본 triangle을 hash 검증 후 collision geometry로 로드하는 adapter.
3. assembly-world STL을 occurrence-local geometry로 역변환하고 AABB를 재계산하는 단계.
4. open mesh 6개의 precise unavailable 및 conservative fallback 증거.
5. motion frame broad phase → precise refinement → TOI bracket 통합 certificate.
6. API·CLI·MCP parity.
7. 실제 SLDASM extractor 또는 사용자 실행 sidecar exporter.

실제 extractor가 없으므로 synthetic v1.1 fixture에서는 solver adapter를 검증했지만 MeArm joint motion 자체를 통과시켰다고 주장하지 않는다.
