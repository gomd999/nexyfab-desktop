# NexyFab 독립형 CAD 계획 재검증 보고서

- 검증일: 2026-08-09
- 검증 대상: `NEXYFAB_CAD_INDEPENDENT_DETAILED_IMPLEMENTATION_PLAN_260809.md`
- 검증 방식: 실제 코드·ADR·API·테스트·운영 모듈 대조 및 핵심 회귀 실행
- 최종 판정: **방향은 타당, 구현 방식과 우선순위 일부 교정 후 진행 가능**

> 후속 감사: 이 문서의 얇은 Project Envelope 제안도 실제 `.nfab v3`와 중복되므로 폐기한다. `CadRevisionManifest v1`, dual OCCT stack identity, part/XCAF assembly evidence 분리와 구현 전 S1/S2/S3 gate를 정의한 `docs/NEXYFAB_CAD_INDEPENDENT_FINAL_PLAN_AUDIT_260809.md`를 최종 기준으로 사용한다.

## 1. 검증 결과 요약

계획의 핵심 방향은 맞다.

- 외부 CAD 설치 없이 자체 OCCT 기반으로 상용화 가능
- STEP을 정밀 제조 교환 형식으로 사용하는 방향 타당
- 외부 native CAD 증거를 자체 kernel evidence로 교체해야 함
- 제조 전문가 검토와 최종 이중 서명은 계속 필요
- 기존 Closed Beta와 원본을 변경하지 않는 신규 version 경로가 적절

다만 원래 계획은 다음 영역을 새로 만드는 것처럼 기술해 현재 구현량을 과소평가했다.

- feature tree와 persistence
- stable topology와 reference propagation
- assembly solver, DoF, motion, interference
- drawing, dimension, PDF, BOM
- STEP import/healing/round-trip
- Redis 기반 B-Rep/OpenSCAD queue
- checkpoint와 resume 기반 생성 흐름

이 영역은 재작성하지 않고 기존 구현을 production evidence 체계로 승격해야 한다.

## 2. 실행한 검증

검증 범위:

- `src/lib/occt`
- `src/lib/cad`
- `src/lib/drawing`
- `src/lib/assembly`
- OCCT STEP round-trip
- OCCT healing
- 제조 workflow E2E
- PMI 및 tolerance API

결과:

| 항목 | 결과 |
|---|---:|
| 테스트 파일 | 145/145 통과 |
| 테스트 | 2,087 통과 |
| Skip | 2 |
| 실패 | 0 |

실제 real OCCT 기반 테스트에서 다음이 확인됐다.

- real Embind module 인스턴스 생성
- B-Rep box의 체적·면적·face count 측정
- STEP write/read round-trip
- thicken과 surface section
- STEP healing
- tessellation
- revolve topology 대규모 재생성 안정성

따라서 자체 커널 전략은 단순 scaffold가 아니라 실제 동작 기반이 존재한다.

## 3. 계획에서 맞았던 판단

### 3.1 외부 CAD 제거

외부 CAD는 NexyFab 기본 상품에 필요하지 않다. 현재 저장소에 real OCCT 기반 생성·측정·STEP 입출력 경로가 있어 자체 CAD와 중립 형식을 중심으로 진행할 근거가 있다.

### 3.2 release evidence v2 필요

현재 `robotReleaseEvidenceAudit.ts`는 다음 외부 worker kind를 직접 요구한다.

- solidworks-native
- inventor-native
- catia-native
- creo-native
- parasolid-native

또한 blocker가 `external_native_cad_evidence_required`로 고정돼 있다. 따라서 기존 v1을 유지하면서 NexyFab kernel evidence를 받는 v2를 추가하는 계획은 정확하다.

### 3.3 fail-closed와 revision 분리

기존 로봇 흐름의 다음 원칙은 그대로 재사용할 가치가 있다.

- 정확한 artifact hash 결속
- r+1 revision
- 동일 reviewer/key 역할 재사용 차단
- 승인과 실제 release 실행 분리
- source/workspace 자동 변경 금지

### 3.4 STEP 격리 왕복 강화

이미 STEP round-trip이 있으므로 방향은 맞다. 다만 현재 비교가 충분하지 않아 production evidence로 승격하는 추가 작업이 필요하다.

## 4. 반드시 교정해야 할 부분

## 교정 1. 거대한 CAD Document를 새로 만들지 않는다

### 발견

이미 다음 데이터 구조가 존재한다.

- `FeatureTree`와 versioned persistence
- `AssemblyState`
- drawing, PMI 및 BOM schema
- robot editable program
- generation checkpoint와 canonical response

새로운 거대 schema에 모든 세부 데이터를 복제하면 다음 문제가 생긴다.

- 동일 정보의 두 source of truth
- 대규모 migration 위험
- 기존 editor·collaboration·history와 불일치
- Closed Beta 기존 문서 호환성 위험

### 수정

`NexyFabCadDocumentV2`를 전체 재작성 schema가 아니라 다음 모듈을 결속하는 얇은 project envelope로 바꾼다.

```ts
type NexyFabCadProjectEnvelopeV1 = {
  schema: 'nexyfab.cad-project-envelope.v1';
  projectId: string;
  lineageId: string;
  revision: number;
  parentEnvelopeHash: string | null;
  units: 'mm';
  modules: {
    featureTree: ArtifactRef;
    assembly: ArtifactRef | null;
    drawings: ArtifactRef[];
    bom: ArtifactRef | null;
    pmi: ArtifactRef | null;
    manufacturingRequirements: ArtifactRef | null;
  };
  kernelPolicy: ArtifactRef;
  provenance: ArtifactRef;
};
```

각 기존 module은 자기 schema와 validator를 유지한다. envelope는 module hash와 revision 관계만 검증한다.

## 교정 2. Stable topology는 신규 개발이 아니라 coverage 승격이다

### 발견

이미 다음이 구현돼 있다.

- `topoNaming`
- `topologyRemap`
- `topologySurvivalEvidence`
- `namedTopologyReferenceReconcile`
- hole/pattern/revolve topology snapshot
- drawing/GD&T/PMI reference propagation
- mate reference reconcile

real-kernel revolve topology 테스트도 광범위하게 통과했다.

### 수정

WP-3은 신규 naming 알고리즘 작성이 아니라 다음 gap 측정으로 바꾼다.

- feature kind별 topology coverage matrix
- fillet/chamfer/shell/boolean/sweep/loft coverage
- ambiguous·derived mapping의 UI review
- critical reference survival 100% gate
- 일반 reference survival 목표와 minimum sample gate
- topology 결과를 kernel evidence에 결속

중요 topology가 ambiguous 또는 broken이면 자동 release를 막는다.

## 교정 3. Part feature도 재작성하지 않는다

### 발견

extrude, revolve, boolean, fillet, chamfer, shell, sweep, loft, pattern, rib, hole 관련 구현과 테스트가 이미 있다. real OCCT node bridge도 B-Rep 생성과 검사 기능을 제공한다.

### 수정

WP-4의 핵심은 다음으로 제한한다.

- feature별 preview/real-kernel 실행 경로 inventory
- production에서 stub/synthetic fallback 금지
- 지원 option matrix
- real B-Rep postcondition
- memory disposal 검증
- feature별 STEP round-trip fixture

즉, 기능을 다시 만드는 것이 아니라 production-safe 경로가 아닌 분기를 제거하거나 격리한다.

## 교정 4. STEP 검증 지표를 강화한다

### 발견

기존 `roundtripStepWithOcct`는 실제로 임시 디렉터리와 별도 Node 프로세스를 사용한다. Replicad의 `importSTEP/blobSTEP`은 OCCT 기반이므로 외부 CAD 제품 의존은 아니다.

그러나 현재 주요 geometry pass 조건은 다음 중심이다.

- part count 동일
- 총 volume delta 0.1% 이하

PMI도 주로 evidence count와 topology coverage count를 비교한다.

### 수정

production kernel evidence에는 다음을 추가한다.

- solid/shell/face/edge count
- surface 및 curve type histogram
- area, volume, centroid, inertia
- component별 비교
- occurrence hierarchy와 transform
- units
- 이름과 stable part identity
- PMI target reference 유효성
- healing 전후 delta
- exporter와 verifier kernel identity

단순히 같은 라이브러리를 두 번 호출하는 것을 완전한 독립 검증이라고 부르지 않는다. 별도 프로세스 격리와 artifact hash 결속은 유지하되 `independent process verification`으로 표현한다.

## 교정 5. 도면은 기존 기반을 사용하되 exact HLR이 잔여 작업이다

### 발견

다음 도면 기능이 이미 있다.

- sheet와 template
- dimension과 anchor
- BOM sheet와 balloon
- PDF/DXF/PNG export
- hole table
- surface finish/weld symbol
- associative reference review

하지만 `projectView.ts`의 HLR은 pure TypeScript polyhedron projection이다. planar-faced solid에는 유효하지만 곡면 silhouette와 exact analytic curve를 완전히 보장하는 OCCT HLR은 아니다.

### 수정

WP-7을 다음 두 등급으로 분리한다.

- Drawing Basic: 현재 projection 경로, 지원 형상 제한 명시
- Drawing Precision: OCCT HLR, analytic circle/arc/silhouette, section 정확도

Pilot에서 곡면 제조 도면을 제공하려면 Drawing Precision gate가 필요하다.

## 교정 6. Assembly와 BOM은 통합 대상이다

### 발견

assembly solver, Jacobian rank, subassembly, motion, precise interference, animation, history, persistence 및 BOM CSV/JSON이 이미 있다.

### 수정

WP-5와 WP-7에서 신규 solver/BOM을 만들지 않는다. 다음 결속만 추가한다.

- envelope revision
- occurrence identity
- BOM row identity
- drawing balloon identity
- STEP assembly identity
- manufacturing package manifest

## 교정 7. Redis queue와 checkpoint도 재사용한다

### 발견

이미 다음이 있다.

- Redis-backed B-Rep job queue
- Redis-backed OpenSCAD job queue
- in-memory fallback
- generation checkpoint
- complex campaign resume
- idempotency가 적용된 일부 API

### 수정

WP-10은 새 queue 구축이 아니라 다음 production hardening으로 변경한다.

- production에서 Redis 미설정 시 startup failure
- CAD evidence job type 추가
- source bytes를 queue payload에서 제외
- checkpoint artifact hash 결속
- tenant quota와 cancellation
- worker version pinning
- crash/resume E2E

## 5. 수정된 실제 우선순위

원래 계획보다 다음 순서가 정확하다.

### Step 0. 보호 기준선

- Closed Beta snapshot
- dirty worktree 확인
- 참고 코퍼스 read-only 확인

### Step 1. 기존 계약 inventory

- FeatureTree, AssemblyState, drawing, BOM, PMI schema 목록화
- 중복 필드와 authoritative owner 확정
- v1 release의 native 의존 위치 목록화

### Step 2. Project Envelope v1

- 기존 module artifact를 hash로 결속
- canonical envelope serializer
- revision/parent relationship
- robot program adapter
- 저장 없이 dry-run

### Step 3. Kernel Identity와 Production Policy

- JS/WASM bytes hash
- OCCT/Replicad wrapper version
- tolerance policy hash
- real/stub mode 구분
- production evidence에서 stub/synthetic 차단

### Step 4. Kernel Evidence v1

- deterministic rebuild
- B-Rep validity
- topology survival
- assembly verification
- mass properties
- artifact hash/signature

### Step 5. STEP Evidence 강화

- 기존 round-trip 재사용
- component/assembly/topology/mass property 비교 추가
- verifier process identity
- tamper tests

### Step 6. Release Audit v2

- kernel evidence + manufacturing evidence
- native CAD blocker 제거
- final dual signoff 유지
- v1 무변경

### Step 7. Manufacturing Package

- 기존 drawing/BOM/PMI 결과 결속
- STEP과 동일 revision 검증
- content-addressed ZIP

### Step 8. UI 전환

- NexyFab kernel 검증 상태 표시
- 외부 CAD 필수 문구 제거
- legacy/Enterprise native 경로 분리
- 기본 release v2 활성화

### Step 9. Exact Drawing과 복잡 제품

- OCCT HLR
- 곡면/section fixture
- complexity policy
- Redis evidence job
- crash/resume

### Step 10. 운영 및 Pilot

- 보안·백업·결제
- 제조 전문가
- 3~5개 Design Partner

## 6. 수정된 첫 Increment

첫 구현 묶음은 다음으로 줄인다.

1. 보호 snapshot
2. 기존 schema ownership inventory
3. `CadProjectEnvelope v1`
4. robot program → envelope dry-run adapter
5. kernel identity와 production policy
6. `KernelEvidence v1` schema 및 negative validator
7. release audit v2 schema skeleton
8. v1 무변경 회귀
9. 전체 핵심 회귀와 build
10. Closed Beta diff 0

첫 Increment에서는 다음을 하지 않는다.

- 기존 FeatureTree schema 교체
- 기존 AssemblyState 교체
- 기존 document DB migration
- 외부 CAD worker 코드 삭제
- release-ready 상태 부여
- 실제 release 실행 추가

## 7. 위험 순위

| 순위 | 위험 | 대응 |
|---:|---|---|
| 1 | STEP 왕복이 체적만 맞고 topology/assembly를 잃음 | 강화 comparator와 component별 증거 |
| 2 | 곡면 도면이 mesh HLR에 의존 | OCCT exact HLR을 별도 gate로 구현 |
| 3 | topology가 일부 feature에서 ambiguous | feature coverage matrix와 critical 100% gate |
| 4 | stub/synthetic 결과가 production 증거로 승격 | kernel identity 및 production policy fail-closed |
| 5 | 거대 신규 schema로 기존 편집기와 충돌 | 얇은 envelope와 기존 module ownership 유지 |
| 6 | Redis fallback이 다중 인스턴스에서 불일치 | production startup requirement |
| 7 | 자체 커널을 독립 검증이라고 과장 | process 격리와 third-party CAD independence를 구분 |

## 8. 최종 검토 판정

### 계획 적합성

- 제품 방향: 적합
- 외부 CAD 제거: 적합
- OCCT 선택: 적합
- STEP 중심 제조 전달: 적합
- release evidence v2: 필요
- 기존 기능 재작성: 부적합
- 기존 기능 통합·승격: 적합

### 진행 권고

계획은 위 교정을 반영하면 바로 진행 가능하다. 가장 중요한 변경은 `거대한 새 CAD Document를 만드는 것`에서 `기존 검증된 module을 immutable hash envelope로 묶는 것`으로 전환하는 것이다.

첫 실제 구현은 Project Envelope, Kernel Identity, Kernel Evidence schema 및 Release Audit v2 skeleton까지만 수행한다. 이 단계가 통과한 후 STEP comparator를 강화하고, 실제 자체 kernel evidence가 확보됐을 때만 native CAD blocker를 기본 경로에서 제거한다.
