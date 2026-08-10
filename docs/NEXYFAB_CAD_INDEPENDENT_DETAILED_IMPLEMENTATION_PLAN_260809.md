# NexyFab 독립형 CAD 세부 구현 계획

- 기준일: 2026-08-09
- 상위 계획: `docs/NEXYFAB_CAD_INDEPENDENT_COMMERCIALIZATION_PLAN_260809.md`
- 구현 목표: 외부 CAD 제품 설치 없이 NexyFab 자체 엔진으로 설계·검증·제조 전달·전문가 승인을 완료
- 데이터 보호: Closed Beta 계정·비밀번호·저작물과 참고 코퍼스는 읽기 전용 기준으로 보호
- 실행 원칙: 각 작업 묶음마다 `사전 점검 → 최소 변경 → 집중 검증 → 전체 회귀 → 무결성 스냅샷`

> 최종 감사 반영: 이 문서의 `NexyFabCadDocument v2` 및 Project Envelope 신설 표현은 폐기한다. 실제 `.nfab v3`를 프로젝트 진실원으로 유지하고 불변 `CadRevisionManifest v1`만 추가한다. 두 OCCT 배포 스택, part/XCAF assembly evidence 분리, drawing feasibility, 제한된 AP242 PMI, 상용 no-stub gate 및 LGPL 준수의 최종 기준은 `docs/NEXYFAB_CAD_INDEPENDENT_FINAL_PLAN_AUDIT_260809.md`가 우선한다.

## 1. 현행 기반과 정확한 출발점

### 이미 존재하는 기반

- 자체 Pro CAD 방향: `docs/adr/013-own-pro-cad-track.md`
- OCCT를 형상 source of truth로 승격하는 결정: `docs/adr/014-occt-kernel-promotion.md`
- OCCT STEP round-trip·healing·tolerance 모듈
- CAD IR 및 STEP/STL/DXF ingest
- feature program, topology reconcile, B-Rep push/pull API
- assembly verify, motion, interference API
- PMI, tolerance, sheet metal, weldment, manufacturing verify API
- AI 6축 로봇 생성·정밀 재검증·r+1 통합·전문가 이중 서명
- Closed Beta 무결성 스냅샷과 변경 비교
- 프로덕션 빌드 및 bundle budget

### 현재 구조적 문제

1. 로봇 최종 증거가 `external_native_cad_evidence_required`에 묶여 있다.
2. 자체 OCCT 검증 결과가 로봇 release target에 직접 결속되지 않는다.
3. STEP export 가능 범위가 일부 OCCT handle과 box fast path 중심으로 제한되어 있다.
4. CAD IR은 분석용 성격이 강하고 자체 편집 document의 완전한 canonical schema가 아니다.
5. 도면·PMI·BOM·제조 검증 기능이 존재하지만 하나의 제조 패키지 계약으로 통합되지 않았다.
6. 복잡도·성능·비동기 job 정책이 여러 경로에 분산돼 있다.
7. 운영 준비 기능은 존재하나 상업 release gate와 하나의 감사표로 연결되지 않았다.

## 2. 목표 시스템의 핵심 계약

### 2.1 `NexyFabCadDocument v2`

자체 CAD의 단일 진실 원천이다. 기존 프로그램을 즉시 폐기하지 않고 adapter로 수용한다.

```ts
type NexyFabCadDocumentV2 = {
  schema: 'nexyfab.cad-document.v2';
  documentId: string;
  lineageId: string;
  revision: number;
  parentRevisionHash: string | null;
  units: 'mm';
  kernel: {
    family: 'occt';
    version: string;
    tolerancePolicyVersion: string;
  };
  parameters: CadParameter[];
  sketches: CadSketch[];
  features: CadFeature[];
  parts: CadPart[];
  occurrences: CadOccurrence[];
  mates: CadMate[];
  materials: CadMaterialAssignment[];
  pmi: CadPmi[];
  drawings: CadDrawingDefinition[];
  bom: CadBomDefinition;
  manufacturing: CadManufacturingRequirements;
  provenance: CadProvenance;
};
```

불변 조건:

- 모든 ID는 document 안에서 유일
- 모든 참조는 존재하며 순환 의존성 금지
- 내부 길이 단위는 mm로 canonicalize
- 부동소수점은 정책에 정의한 정밀도로 canonicalize
- key ordering과 배열 ordering 규칙 고정
- source bytes와 document metadata를 구분
- hash는 canonical UTF-8 bytes에 대해서만 계산
- revision은 기존 document를 덮어쓰지 않고 증가

### 2.2 `NexyFabKernelEvidence v1`

외부 native CAD 증거를 대체하는 자체 정밀 증거다.

```ts
type NexyFabKernelEvidenceV1 = {
  schema: 'nexyfab.kernel-evidence.v1';
  documentHash: Sha256;
  programHash: Sha256;
  kernelIdentitySha256: Sha256;
  kernelVersion: string;
  tolerancePolicySha256: Sha256;
  generatedAt: string;
  checks: {
    documentSchema: true;
    references: true;
    deterministicRebuild: true;
    brepValidity: true;
    units: true;
    topology: true;
    assembly: true;
    massProperties: true;
    stepExport: true;
    isolatedStepReimport: true;
    roundtripGeometry: true;
    roundtripAssembly: true;
  };
  metrics: KernelEvidenceMetrics;
  artifacts: KernelEvidenceArtifacts;
  signature: string;
};
```

증거 생성 프로세스는 일반 웹 요청과 분리된 격리 worker에서 실행하고 worker identity로 서명한다. 외부 CAD 제품은 사용하지 않는다.

### 2.3 `ManufacturingPackage v1`

```ts
type ManufacturingPackageManifestV1 = {
  schema: 'nexyfab.manufacturing-package.v1';
  releaseTargetHash: Sha256;
  documentHash: Sha256;
  kernelEvidenceSha256: Sha256;
  files: Array<{
    name: string;
    mediaType: string;
    bytes: number;
    sha256: Sha256;
  }>;
  units: 'mm';
  coordinateSystem: string;
  status: 'review_required' | 'manufacturing_reviewed';
};
```

파일 구성:

- `model.step`
- `drawing.pdf`
- `bom.csv`
- `requirements.json`
- `material-and-finish.json`
- `inspection-plan.json`
- `kernel-evidence.json`
- `manufacturing-review.json` 또는 review template
- `provenance.json`
- `manifest.json`

## 3. 호환성과 마이그레이션 원칙

### 절대 금지

- 기존 Closed Beta DB schema를 일괄 destructive migration
- 기존 CAD program 또는 업로드 원본 덮어쓰기
- 기존 `robot-native-cad-evidence.v1` 파일의 의미 변경
- 동일 schema 이름으로 다른 payload를 수용
- 기존 서명을 새 target으로 재사용
- 실패한 migration 결과를 자동 저장

### 채택 방식

- 기존 schema는 읽기 호환으로 유지
- 신규 독립형 경로는 새 schema와 새 API version으로 추가
- 기존 robot program → CAD document v2는 pure adapter로 변환
- 저장 전 dry-run validation과 예상 diff 제공
- 처음에는 다운로드 전용, 이후 명시적 사용자 승인 저장
- migration receipt에 source hash, target hash, adapter version 기록
- rollback은 이전 revision을 다시 활성화하는 방식으로 제공

## 4. 세부 작업 분해

## WP-0. 기준선과 안전 장치

목적: 이후 변경이 기존 사용자 자산을 건드리지 않았음을 매 단계 입증한다.

### 구현

- `scripts/closed-beta-integrity-snapshot.mjs`를 공통 pre/post gate로 사용
- 기준 snapshot과 비교하는 read-only comparator 추가
- CAD 변경 전용 검사 명령을 package script로 등록
- 보호 DB·업로드 경로를 테스트 환경에서 read-only로 열기
- 참고 코퍼스에 write operation이 발생하면 실패하는 guard 추가
- 새 validation report는 항상 `wx`로 생성해 기존 증거 덮어쓰기 방지

### 산출물

- `scripts/verify-protected-assets-unchanged.mjs`
- `validation-reports/cad-independent-baseline-*.json`
- CI job: `cad:protected-assets`

### 통과 기준

- 보호 테이블 diff 0
- 보호 파일 diff 0
- DB SHA-256 기준 일치
- 참고 코퍼스 write 0

## WP-1. Canonical CAD Document v2

목적: 분산된 robot program, feature tree, assembly, PMI, BOM을 하나의 안정된 문서 계약으로 통합한다.

### 구현

- Zod 기반 v2 schema와 TypeScript type
- canonical serializer와 SHA-256
- reference graph validator
- 단위 canonicalizer
- number precision/tolerance normalization
- stable ordering policy
- robot program adapter
- 기존 feature program adapter
- migration dry-run 및 receipt
- v2 → viewer/feature executor projection

### 예상 파일

- `src/lib/cad-document/schemaV2.ts`
- `src/lib/cad-document/canonicalize.ts`
- `src/lib/cad-document/hash.ts`
- `src/lib/cad-document/referenceGraph.ts`
- `src/lib/cad-document/adapters/robotProgram.ts`
- `src/lib/cad-document/adapters/featureProgram.ts`
- `src/lib/cad-document/migrationReceipt.ts`
- `src/app/api/cad/v2/document/validate/route.ts`
- `src/app/api/cad/v2/document/migrate/route.ts`

### 테스트

- key 순서가 달라도 hash 동일
- 의미 있는 수치 변경은 hash 변경
- dangling/cyclic reference 거부
- unknown unit을 임의 추정하지 않음
- 같은 입력 adapter 결과 byte-identical
- adapter가 source bytes를 변경하지 않음
- 6축 로봇 25부품·60 mate·6축 보존

### 통과 기준

- schema/serializer/reference test 100%
- 반복 100회 canonical hash 동일
- 기존 robot golden contract 보존
- source mutation 0

## WP-2. OCCT 커널 identity와 결정론

목적: 커널 결과가 어떤 버전·정책으로 생성됐는지 재현 가능하게 한다.

### 구현

- OCCT JS/WASM bytes SHA-256 계산
- 커널 버전·빌드·wrapper version manifest
- tolerance policy를 versioned JSON으로 분리
- 동일 document rebuild 2회 비교
- shape fingerprint 정의
- 실패 taxonomy 통합
- synthetic bbox fallback을 production precision 경로에서 금지
- kernel unavailable 시 release evidence 생성 금지

### shape fingerprint

- solid/shell/face/edge/vertex count
- volume, surface area, center of mass, inertia
- bounding box
- surface/curve type histogram
- connected component count
- canonicalized occurrence transform
- topology lineage mapping

### 예상 파일

- `src/lib/occt/kernelIdentity.ts`
- `src/lib/occt/deterministicRebuild.ts`
- `src/lib/occt/shapeFingerprint.ts`
- `src/lib/occt/productionKernelPolicy.ts`
- `config/cad-tolerance-policy.v1.json`

### 통과 기준

- 커널 identity 누락 시 fail-closed
- 동일 fixture rebuild fingerprint 일치
- synthetic fallback이 precision 상태를 만들 수 없음
- 허용 공차 초과 delta 자동 차단

## WP-3. Stable topology naming

목적: upstream parameter 변경 후 fillet, mate, PMI, drawing dimension 참조가 잘못된 face/edge를 가리키지 않게 한다.

### 구현

- feature output별 persistent topology token
- geometry signature + adjacency + provenance 기반 reconcile
- exact, reconciled, ambiguous, missing 상태
- ambiguous match는 자동 선택하지 않고 사용자 확인 요구
- topology map을 revision receipt에 포함
- downstream reference 영향 분석

### 활용 기반

- 기존 `topology/reconcile` API
- face provenance 관련 기존 전략과 테스트
- OCCT command plan과 feature dependency

### 통과 기준

- upstream 치수 변경 후 알려진 fillet/mate/PMI 유지
- ambiguous topology silent reassignment 0
- 삭제된 topology 참조 자동 통과 0
- 영향받은 downstream feature 목록 정확성

## WP-4. Part feature production path

목적: preview mesh가 아니라 OCCT B-Rep을 기본 정밀 결과로 사용한다.

### 우선 기능

1. sketch profile
2. extrude
3. revolve
4. boolean
5. hole
6. pattern/mirror
7. sweep/loft
8. fillet/chamfer
9. shell/draft
10. datum/reference geometry

### 구현 규칙

- 모든 feature가 typed OCCT command plan 생성
- unsupported option은 명시적 오류
- 각 feature precondition/postcondition
- 결과 shape validity 자동 검사
- 실패 시 이전 valid revision 유지
- preview mesh와 production B-Rep 상태 분리

### 테스트 fixture

- prismatic bracket
- revolved shaft
- hole pattern plate
- lofted duct
- swept pipe
- shelled housing
- fillet/chamfer mixed part
- boolean multi-body part

### 통과 기준

- fixture 모두 real B-Rep 생성
- invalid solid 자동 저장 0
- feature rebuild 결정론 통과
- STEP export 가능 상태와 B-Rep 상태 일치

## WP-5. Assembly·mate·motion production path

목적: 로봇에서 구현한 정밀 흐름을 범용 assembly document로 승격한다.

### 구현

- occurrence와 reusable part 분리
- subassembly와 configuration
- mate schema 표준화
- DoF rank와 over/under constraint 진단
- broadphase + precise collision
- clearance와 interference evidence
- motion sampling policy
- incremental subassembly verification
- assembly fingerprint

### 기존 모듈 재사용

- `assembly/verify`
- robot kinematics/path/interference
- STEP assembly evidence
- hierarchy IR

### 통과 기준

- 6축 로봇 기준 25 part, 60 mate, 6 DoF
- 저장·재열기 transform/mate diff 0
- r+1 교체 후 dangling occurrence 0
- precise collision 결과 revision hash 결속
- overconstraint와 underconstraint를 서로 구분

## WP-6. 자체 STEP export와 격리 round-trip

목적: 외부 CAD 없이 정밀 제조 교환 증거를 만든다.

### 구현

- 모든 production B-Rep을 OCCT writer로 STEP export
- AP242 우선, 필요한 경우 AP214 compatibility profile
- mesh-to-STEP을 정밀 B-Rep과 구분
- 별도 worker/process가 export bytes를 새로 import
- source와 reimport fingerprint 비교
- assembly hierarchy, name, color, transform, units 비교
- healing 전후 delta 기록
- unsupported entity와 metadata loss 보고
- 결과 서명 및 content-addressed artifact

### 비교 정책

- body/solid/occurrence count: exact
- assembly transform: tolerance 이내
- volume/area/center/inertia: tolerance policy 이내
- topology count: 정책에 따른 exact 또는 bounded delta
- units: exact
- empty/invalid shape: 즉시 실패

### 예상 파일

- `src/lib/cad-evidence/stepExport.ts`
- `src/lib/cad-evidence/isolatedStepRoundtrip.ts`
- `src/lib/cad-evidence/roundtripComparator.ts`
- `src/lib/cad-evidence/kernelEvidence.ts`
- `src/app/api/cad/v2/evidence/kernel/route.ts`

### 통과 기준

- box 전용 fast path 의존 제거
- production B-Rep fixture 100% round-trip
- source와 reimport의 치명적 geometry loss 0
- 같은 artifact bytes에만 증거 유효
- source workspace mutation 0

## WP-7. Drawing·PMI·BOM 통합

목적: 모델만이 아니라 실제 제조 의사소통 패키지를 완성한다.

### 구현

- OCCT HLR 기반 view geometry
- sheet/template/title block
- projection, section, detail, auxiliary view
- model parameter에 결속된 dimension
- datum/GD&T/surface finish/weld symbol
- revision table
- balloon과 BOM row 연결
- model 변경 시 stale drawing 탐지
- PDF renderer와 deterministic output metadata
- BOM CSV/XLSX

### 재사용 기반

- `scripts/drawing-to-3d/hlr-drawing.mjs`
- `drawing-annotation-schema.md`
- PMI verify API
- tolerance analyze API
- XLSX export

### 통과 기준

- orphan dimension 0
- stale drawing을 manufacturing-reviewed로 승격 불가
- BOM quantity와 assembly occurrence 일치
- drawing/PDF/BOM source revision 동일
- 출력 언어가 달라도 수치와 단위 동일

## WP-8. DFM과 제조 전문가 증거

목적: 자체 CAD의 생산 적합성을 사람과 시스템이 함께 확인한다.

### 구현

- 공정별 DFM profile: machining, sheet metal, additive 우선
- tolerance stack과 fit evidence
- fastener, cable, material, finish, process plan
- reviewer registry와 public key
- domain reviewer와 independent reviewer 분리
- review packet과 offline signing
- 반려 사유 taxonomy
- r+1 수정과 재검증 강제

### 외부 서명이 필요한 부분

- 실제 제조 전문가의 판단
- 최종 독립 이중 승인

외부 CAD 제품은 필요하지 않지만, 생산 책임이 있는 사람의 검토는 계속 필요하다.

### 통과 기준

- 모든 제조 check가 exact document hash에 결속
- 동일 reviewer/key 역할 재사용 차단
- 수정 전 서명을 수정 후 revision에 재사용 불가
- 전문가 반려 상태에서 RFQ/production release 불가

## WP-9. Release evidence v2 전환

목적: native CAD 의존을 제거하면서 기존 증거 체계를 깨지 않는다.

### 현행

- `robotReleaseEvidenceAudit.ts`가 native schema와 manufacturing schema를 요구
- native worker kind가 외부 전용 CAD enum으로 고정
- 완료 감사도 7개 worker와 108개 job을 기본 blocker로 판단

### 변경

- 기존 `robot-release-evidence-audit.v1` 유지
- 신규 `nexyfab.cad-release-evidence-audit.v2` 추가
- v2는 `NexyFabKernelEvidence v1 + ManufacturingValidation v1` 요구
- `external_native_cad_evidence_required` 제거
- `nexyfab_kernel_evidence_required` 추가
- final dual review는 그대로 유지
- v1 UI는 legacy/enterprise compatibility로 표시
- v2를 NexyFab 기본 release path로 지정

### 예상 파일

- `src/lib/cad-evidence/releaseEvidenceAuditV2.ts`
- `src/lib/cad-evidence/finalReleaseReviewV2.ts`
- `src/app/api/cad/v2/release/audit/route.ts`
- `src/app/api/cad/v2/release/final-review/route.ts`
- `src/app/api/cad/v2/release/work-packet/route.ts`
- `scripts/audit-cad-independent-production-completion.mjs`

### migration 테스트

- v1 증거는 계속 검증되지만 기본 출시를 차단하지 않음
- v1 signature를 v2에 사용할 수 없음
- v2 kernel evidence drift 차단
- v2 manufacturing evidence drift 차단
- 승인과 실제 release execution 분리

### 통과 기준

- 외부 CAD 미설치 상태에서 v2 내부 kernel gate 통과 가능
- kernel evidence 없는 우회 경로 0
- 기존 v1 test regression 0
- release execution 자동 호출 0

## WP-10. 복잡도·비동기·성능

목적: 복잡 제품을 브라우저 요청 timeout이나 메모리 폭주 없이 처리한다.

### complexity preflight

- bytes
- triangle/body/face/edge/occurrence 수
- assembly depth
- B-spline/freeform 비율
- feature dependency depth
- 예상 kernel operation cost
- 예상 memory와 duration

### 실행 등급

- L1/L2: 동기 또는 짧은 worker
- L3: 표준 비동기 job
- L4: subassembly 분할·증분 검증
- L5: 사전 분석 후 전용 queue/수동 견적

### 구현

- Redis-backed durable queue
- idempotency key
- checkpoint와 resume token
- job cancellation
- retry 가능한 오류와 불가능한 오류 분리
- per-tenant quota
- signed artifact URL
- source bytes를 Redis payload에 저장하지 않음

### 통과 기준

- worker crash 후 checkpoint resume
- duplicate request가 artifact 중복 생성하지 않음
- oversized input이 시스템 전체를 중단시키지 않음
- 취소 후 billable usage와 artifact 상태 일치

## WP-11. UI/UX 통합

목적: 초보자와 전문가가 같은 document에서 다른 깊이로 작업한다.

### 화면 구조

1. 요구사항/파일 입력
2. complexity 및 지원 가능성 preflight
3. AI 설계 계획 검토
4. CAD 생성·편집
5. 정밀 검증
6. 도면/BOM
7. 제조 전문가 검토
8. 제조 패키지
9. 사용자 승인과 RFQ/다운로드

### 상태 표시

- Draft
- Geometry Validated
- Precision Validated
- Manufacturing Review Required
- Manufacturing Reviewed
- Approved for Release
- Released

### 필수 UX

- 미검증 워터마크
- blocker와 해결 동작을 같은 화면에 표시
- AI 추정/실측/전문가 판단 badge 분리
- feature 영향 분석과 before/after
- 비동기 진행률·취소·재개
- 결과 hash와 revision 확인
- 외부 CAD 필요 문구 제거
- Enterprise connector는 별도 설정에서만 노출

### 통과 기준

- 사용자가 검증 단계를 혼동하는 주요 경로 0
- blocker 상태에서 제조 전송 버튼 비활성
- 키보드 및 스크린리더 핵심 흐름
- 한국어/영어의 상태 의미 일치

## WP-12. 상용 운영·보안

### 인프라

- PostgreSQL
- private object storage
- Redis queue/rate limit
- isolated CAD worker pool
- KMS/secret manager
- application/error/metric tracing

### 보안

- tenant-scoped authorization
- 관리자·전문가 MFA
- RBAC
- upload quarantine
- MIME/magic/archive 검증
- worker network egress deny-by-default
- CPU/RAM/time/output quota
- artifact signed URL
- webhook replay 방지
- audit log integrity
- SBOM과 dependency scan

### 신뢰성

- backup policy
- restore drill
- RPO/RTO
- queue drain/recovery
- worker version rollback
- incident severity/runbook
- status page/customer notice

### 통과 기준

- Critical/High 미조치 0
- 교차 tenant 접근 0
- 복구 훈련 성공
- Redis 없는 multi-instance production 배포 차단
- secret이 log/artifact/client bundle에 노출되지 않음

## WP-13. 상업 Pilot

### 대상

- 3~5개 Design Partner
- L1~L3 제품 우선
- L4는 전문가 포함
- 안전 필수 제품 제외

### 프로젝트별 수집

- 입력 복잡도
- 첫 결과 시간
- 편집 횟수
- kernel/STEP/DFM 실패
- 전문가 검토 시간
- 제조사 질문과 수정
- compute/storage/expert 원가
- 고객 만족도
- 실제 마진

### Pilot 중단 조건

- 원본 훼손
- 교차 tenant 노출
- silent geometry corruption
- 검토 없이 제조 전달
- 반복되는 동일 치명 오류
- 복구 불가능한 데이터 손실

### 확대 조건

- 치명 사고 0
- 제조 패키지 반복 승인
- 지원 범위에서 예상 가능한 처리시간
- 프로젝트 단위 공헌이익 양수
- 지원 인력과 전문가 capacity 확보

## 5. 구현 순서와 의존성

```text
WP-0 보호 기준선
  ↓
WP-1 CAD Document v2
  ↓
WP-2 Kernel identity/결정론
  ↓
WP-3 Stable topology
  ↓
WP-4 Part production path
  ├───────────────┐
  ↓               ↓
WP-5 Assembly    WP-7 Drawing/PMI/BOM
  └───────┬───────┘
          ↓
WP-6 STEP isolated round-trip
          ↓
WP-8 Manufacturing evidence
          ↓
WP-9 Release evidence v2
          ↓
WP-10 Complex job scaling
          ↓
WP-11 UI integration
          ↓
WP-12 Commercial operations
          ↓
WP-13 Design Partner Pilot
```

실제 작업에서는 WP-10과 WP-12 기반 일부를 앞당겨 worker 격리와 queue를 먼저 제공할 수 있다. 그러나 release v2 의미는 WP-1~9가 확정되기 전에 고정하지 않는다.

## 6. 권장 구현 묶음

### Increment A — 독립형 release 계약

포함:

- WP-0
- WP-1 최소 schema/canonical hash
- WP-2 kernel identity
- WP-9 v2 schema skeleton

결과:

- 외부 CAD가 아닌 NexyFab kernel evidence를 요구하는 계약 확정
- 아직 실제 release-ready를 주장하지 않음

### Increment B — 실제 kernel evidence

포함:

- WP-2 결정론
- WP-3 topology
- WP-4 주요 part feature
- WP-6 STEP round-trip

결과:

- 자체 형상과 STEP 결과에 대한 서명 증거 생성

### Increment C — assembly 제조 패키지

포함:

- WP-5 assembly
- WP-7 drawing/PMI/BOM
- WP-8 manufacturing packet

결과:

- 외부 CAD 없이 검토 가능한 완전한 제조 ZIP

### Increment D — release v2 UI

포함:

- WP-9 release audit/final review
- WP-11 UI

결과:

- 로봇에서 자체 CAD 증거로 최종 적격성 판단
- release 실행은 여전히 별도

### Increment E — 복잡 제품·운영

포함:

- WP-10
- WP-12
- holdout corpus

결과:

- L1~L5 complexity 정책과 상용 운영 증거

### Increment F — Pilot

포함:

- WP-13
- 실제 제조 검토
- 품질·원가·지원 Go/No-Go

## 7. 각 Increment의 반복 절차

1. **사전 점검**
   - 관련 schema/API/UI/test 확인
   - dirty worktree와 사용자 변경 확인
   - Closed Beta pre-snapshot

2. **구현**
   - 새 schema/version 우선
   - pure function과 fail-closed validator부터 작성
   - API, UI 순으로 연결

3. **집중 검증**
   - module test
   - API route test
   - UI interaction test
   - tamper/negative test

4. **조정**
   - 실패 원인별 수정
   - tolerance를 결과에 맞춰 임의 완화하지 않음
   - baseline 변경은 별도 승인된 evidence revision으로 수행

5. **전체 검증**
   - CAD/robot 전체 회귀
   - typecheck/lint
   - production build
   - route manifest
   - bundle budget

6. **보호 검증**
   - Closed Beta post-snapshot
   - table/file diff 0
   - 참고 코퍼스 write 0

7. **다음 단계 판정**
   - 통과한 gate만 completed
   - 외부 증거 없는 항목은 pending
   - releaseReady와 releaseExecuted 분리

## 8. 테스트 전략

### 단위 테스트

- schema, hash, canonicalization
- topology reconcile
- tolerance comparator
- feature command planning
- signature payload

### property/metamorphic 테스트

- JSON key order 변경 불변
- rigid transform 후 volume/area 불변
- 단위 변환 round-trip
- part ordering 변경과 assembly semantics
- 동일 입력 반복 rebuild 결정론

### integration 테스트

- document → OCCT → STEP → isolated import → compare
- robot adapter → document v2 → r+1 → reverify
- document → drawing/BOM → manufacturing package
- review signature → audit → final eligibility

### negative/tamper 테스트

- hash drift
- unit mismatch
- dangling topology
- stale drawing
- BOM quantity mismatch
- package file substitution
- reviewer/key reuse
- replayed signature
- invalid/empty STEP
- zip bomb/path traversal

### 성능 테스트

- L1~L5 fixture
- cold/warm kernel
- concurrent job
- worker crash/resume
- memory ceiling
- artifact upload/download

### 운영 테스트

- tenant isolation
- backup/restore
- webhook duplicate/order reversal
- Redis failover
- KMS key rotation
- incident rollback

## 9. 완료 정의

독립형 NexyFab CAD가 상업 Pilot 준비 완료로 판정되려면 다음이 모두 필요하다.

- 외부 CAD 설치 없이 AI→CAD→검증→도면/BOM→제조 패키지 완료
- CAD Document v2 canonical hash와 revision 보장
- real OCCT B-Rep 사용
- stable topology가 주요 edit fixture에서 통과
- STEP 격리 왕복 검증 통과
- drawing/BOM/STEP revision 일치
- 제조 전문가 검토와 최종 이중 서명 경로 작동
- 자동 release 실행 없음
- 복잡도 등급과 자원 제한 적용
- 운영 보안·백업 복구·결제 E2E 통과
- Closed Beta table/file diff 0
- 외부 CAD 관련 기본 blocker 0
- 지원하지 않는 proprietary 기능을 명확히 표시

## 10. 바로 시작할 첫 작업 묶음

첫 구현은 Increment A로 제한한다.

1. 기존 robot release v1의 모든 native 의존 위치 목록화
2. `NexyFabCadDocument v2` 최소 schema 작성
3. canonical serializer/hash 작성
4. robot program read-only adapter 작성
5. OCCT kernel identity manifest 작성
6. `NexyFabKernelEvidence v1` schema와 fail-closed validator 작성
7. release audit v2 skeleton 작성
8. v1 회귀 + v2 negative test
9. API/UI에서는 v2를 아직 release-ready로 표시하지 않음
10. 전체 회귀·빌드·Closed Beta 무결성 확인

이 묶음이 통과해야 실제 STEP 왕복 증거 구현으로 넘어간다. 이렇게 하면 외부 CAD 의존 제거를 먼저 코드 계약에 반영하면서도, 아직 검증되지 않은 자체 커널 결과를 생산 가능 상태로 잘못 승격하지 않는다.
