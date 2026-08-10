# NexyFab 독립형 CAD 최종 계획 감사

- 감사일: 2026-08-09
- 범위: 외부 CAD 설치 없이 NexyFab만으로 AI 설계, 정밀 CAD 편집, 검증, 제조 전달까지 수행하는 상용화 계획
- 보호 기준: Closed Beta 계정·비밀번호·업로드 저작물·기존 `.nfab` 원본 및 참고 코퍼스 무변경
- 근거: 실제 저장 형식, ADR, OCCT/Replicad 실행 경로, STEP/XCAF, 도면, PMI, API, 운영 게이트, 라이선스 고지를 코드와 대조
- 최종 판정: **전략은 타당하다. 아래 교정을 계획의 최종 기준으로 적용한 뒤 구현을 시작한다.**

이 문서는 다음 문서의 구현 전 마지막 교정본이다.

- `NEXYFAB_CAD_INDEPENDENT_COMMERCIALIZATION_PLAN_260809.md`
- `NEXYFAB_CAD_INDEPENDENT_DETAILED_IMPLEMENTATION_PLAN_260809.md`
- `NEXYFAB_CAD_INDEPENDENT_PLAN_VALIDATION_REVIEW_260809.md`

충돌할 경우 이 문서가 우선한다.

## 1. 최종 결론

### 가능한 목표

NexyFab은 SOLIDWORKS, Inventor, CATIA, Creo 등 외부 CAD 제품을 설치하지 않아도 다음 사용자 흐름을 제공할 수 있는 기반이 있다.

1. AI가 초기 3D 설계와 편집 가능한 feature/assembly 상태 생성
2. 사용자가 NexyFab 안에서 파라미터, 스케치, feature, 부품, mate, 도면을 정밀 편집
3. 자체 OCCT 계열 커널로 B-Rep 재생성, 치수·위상·간섭·운동·제조성 검증
4. STEP, PDF 도면, BOM, 증거 파일을 제조 패키지로 출력
5. 고위험 또는 복잡 제품은 NexyFab 내부 전문가 검토와 서명으로 release

외부 CAD 설치는 기본 상품의 필수조건이 아니다. 다만 외부 형식과의 완전한 동등성, 모든 AP242 PMI 의미 보존, 모든 곡면 도면의 정확성은 아직 입증되지 않았으므로 초기 상용 범위를 명확히 제한해야 한다.

### 현재 근거

- 정밀 CAD 관련 집중 회귀: 145개 테스트 파일, 2,087개 테스트 통과, 2개 skip, 실패 0
- real OCCT: B-Rep 생성·측정, STEP read/write 왕복, healing, thicken, surface section, tessellation 확인
- 배포 자산의 WASM 필수 검사: `node scripts/check-occt-readiness.js --mode=wasm` 통과, warning/error 0
- 감사 종료 시 Closed Beta 재비교: 17개 보호 테이블·13개 행, 15개 파일·15,429,420 bytes가 기존 기준과 일치하고 DB SHA-256은 `E678F7957FACBF783F42E261EA5CAB14208F27D1A31F2D6E3A0AF217775EBB11`
- feature tree, topology remap, assembly solver, motion/interference, drawing/BOM, queue/checkpoint가 이미 존재

이는 구현 기반이 실제라는 증거다. 상용 release 준비 완료를 뜻하지는 않는다.

## 2. 최종 교정 사항

### 교정 1. `.nfab v3`를 프로젝트 진실원으로 유지한다

`src/app/[lang]/shape-generator/io/nfabFormat.ts`의 실제 포맷 버전은 3이며 다음을 이미 저장한다.

- feature tree와 scene
- assembly와 manufacturing
- configurations와 AI history
- SCAD intents와 reference geometry
- v1→v2→v3 migration

따라서 `NexyFabCadDocument v2` 또는 별도 Project Envelope를 새로운 프로젝트 진실원으로 만들지 않는다. 이는 이중 schema, 이중 migration, 기존 Closed Beta 호환성 위험을 만든다.

대신 추가할 것은 불변 `CadRevisionManifest v1`이다.

```ts
type CadRevisionManifestV1 = {
  schema: 'nexyfab.cad-revision-manifest.v1';
  projectFormat: 'nfab';
  projectFormatVersion: 3;
  artifactSha256: Sha256;
  canonicalDesignSha256: Sha256;
  canonicalizationPolicy: 'nfab-design-v1';
  revisionId: string;
  parentManifestSha256: Sha256 | null;
  kernelStackIdentitySha256: Sha256;
  createdAt: string;
};
```

해시는 두 종류를 구분한다.

- `artifactSha256`: 사용자가 저장하거나 업로드한 정확한 `.nfab` bytes
- `canonicalDesignSha256`: 명시적 allowlist와 정렬·수치 정책으로 계산한 설계 의미 해시

`serializeProject()`는 시간을 새로 기록하므로 재직렬화 byte 동일성을 설계 결정성으로 오판하지 않는다. `createdAt`, `updatedAt`, thumbnail 등 변동 필드는 canonicalization 정책에서 명시적으로 처리한다. 기존 artifact는 절대 덮어쓰지 않고 새 revision artifact를 만든다.

### 교정 2. 단일 커널이 아니라 두 OCCT 배포 스택을 식별한다

최신 accepted ADR-016의 기준은 다음과 같다.

- 대화형 모델링 kernel of record: Replicad의 in-process OCCT
- 서버 보조 경로: `src/lib/occt`의 opencascade.js 기반 기능
- import 보조: 사용 시 `occt-import-js`

동일 OCCT 계열이어도 JS wrapper, WASM build, 바인딩 범위와 실행 환경이 다르다. 따라서 `KernelStackIdentity v1`에는 다음을 모두 기록한다.

- `replicad` 및 `replicad-opencascadejs` 버전
- browser Replicad WASM SHA-256
- server/headless opencascade.js 버전과 WASM SHA-256
- 사용 시 occt-import-js 버전과 WASM SHA-256
- NexyFab wrapper commit/build ID
- tolerance/healing/topology policy 버전과 SHA-256
- 각 artifact를 생성한 stack과 검증한 stack

같은 OCCT 계열의 다른 프로세스로 검증하는 경우 `독립 커널 검증`이라고 부르지 않고 `격리 프로세스 재검증`이라고 정확히 표현한다.

### 교정 3. 부품 STEP과 XCAF 어셈블리 STEP 증거를 분리한다

현재 두 경로가 다르다.

- 일반 shape STEP: STEPControl/Replicad 경로
- 조립 구조 STEP: `scripts/drawing-to-3d/to-step.mjs`의 XCAF + STEPCAFControl, AP242 schema 5 경로

일반 `roundtripStepWithOcct()`는 Replicad import/export를 사용하며 어셈블리 트리를 평탄화할 수 있다. 이것을 어셈블리 보존 증거로 사용하지 않는다.

상용 evidence는 반드시 나눈다.

1. Part/B-Rep geometry round-trip
   - solid/shell/face/edge 수
   - surface/curve type histogram
   - area, volume, centroid, inertia
   - bbox, units, healing delta
2. XCAF assembly round-trip
   - definition/occurrence 수
   - parent-child hierarchy
   - reused definition identity
   - occurrence transform
   - name, color, unit
   - 누락·추가·평탄화 여부

현재 comparator의 `part count + total volume ≤ 0.1%`는 smoke gate로 유지하되 production release 증거로는 부족하다.

### 교정 4. AP242 PMI는 초기 상용판에서 제한 기능으로 둔다

현재 semantic/graphical PMI 처리와 증거 모듈은 존재한다. 그러나 다음은 아직 완전한 증거가 아니다.

- PMI 개수 일치
- topology coverage 개수
- text-level transplant/reattachment

초기 Pilot의 제조 주석 source of truth는 서명된 PDF 도면으로 한다. AP242 PMI는 다음이 검증될 때까지 `Beta/limited`로 표시한다.

- PMI syntax와 semantic reimport
- target face/edge identity 결속
- units와 datum/reference 보존
- graphical presentation과 semantic item 대응
- 대표 golden corpus의 외부 제품 비의존 왕복 검증

### 교정 5. exact drawing은 구현 선언 전에 feasibility gate를 통과해야 한다

현재 opencascade.js build에는 `HLRBRep_Algo` 바인딩이 없다. 한편 Replicad의 `drawProjection` 경로는 HLR 기능을 제공한다.

따라서 바로 `OCCT exact HLR 구현`을 약속하지 않고 선행 spike에서 다음을 검증한다.

- cylinder, cone, sphere, fillet의 analytic silhouette
- visible/hidden line 분리
- circle/arc 보존 여부
- section view와 hatch 경계
- 투영 치수와 원래 B-Rep 측정치 일치
- 동일 입력의 결정적 SVG/path 결과

합격하면 Replicad projection을 production drawing 경로로 승격한다. 불합격하면 custom OCCT binding 또는 지원되는 패키지 업그레이드를 별도 승인한다. 그 전까지 곡면 정밀 도면을 release-ready로 표시하지 않는다.

### 교정 6. 상용 독립형 빌드는 stub fallback을 금지한다

배포 WASM은 현재 존재하고 `--mode=wasm` 검사를 통과했다. 그러나 일반 copy/build 경로는 OCCT 누락을 경고만 하고 성공할 수 있으며 runtime launcher도 stub fallback 가능성이 있다.

상용 독립형 모드에는 다음 fail-closed 조건을 추가한다.

- `NEXYFAB_CAD_INDEPENDENT_MODE=1`
- `check-occt-readiness.js --mode=wasm` 필수
- Replicad/opencascade.js/occt-import-js 사용 자산의 실제 SHA-256 기록
- real worker handshake가 기대 identity와 일치
- stub/preview worker 선택 시 빌드 또는 시작 실패
- release evidence에 생성·검증 worker identity 기록

파일 존재만으로 real kernel 실행을 증명하지 않는다.

### 교정 7. 오픈소스 라이선스 준수를 P0로 올린다

설치된 핵심 패키지 메타데이터는 다음을 표시한다.

| 구성요소 | 확인된 라이선스 |
|---|---|
| replicad | MIT |
| replicad-opencascadejs | MIT |
| opencascade.js | LGPL-2.1-only |
| occt-import-js | LGPL-2.1 |
| @salusoft89/planegcs | LGPL-2.0-or-later |

현재 third-party notices 페이지는 있으나 JSON이 목록을 비완전하다고 명시한다. 따라서 현 상태를 상용 배포 라이선스 준수 완료로 판정할 수 없다.

상용 gate 전 필수 작업:

- lockfile 기준 자동 생성된 전체 dependency inventory
- 정확한 copyright/license notice와 license text
- 배포하는 LGPL WASM/JS의 corresponding source 제공 방식 또는 법률 검토에 따른 적절한 제공 절차
- 수정 여부와 수정 소스 공개 범위 기록
- 사용자가 LGPL library를 교체/relink할 수 있는 배포 구조 검토
- 법률 전문가 승인 일시·승인 artifact를 release evidence에 결속

이는 법률 판단이 아니라 반드시 검토해야 할 기술·운영 체크리스트다.

### 교정 8. CAD API를 비용·권한 기준으로 분류한다

강한 B-Rep 업로드 경로는 플랜, 소유권, 크기, 월간 사용량, 큐 깊이와 audit를 검사한다. 반면 일부 `/api/cad/v1` 계산 경로는 IP rate limit만 사용한다.

상용화 전에 모든 CAD API를 다음 중 하나로 등록한다.

| 등급 | 정책 |
|---|---|
| public stateless calculator | 작은 payload, 낮은 CPU, 부작용 없음, 엄격한 IP limit |
| authenticated metered compute | 사용자 인증, plan, user+IP limit, quota 차감, queue, audit |
| privileged review/release | 역할 인증, 서명 key policy, immutable artifact, audit, replay 방지 |

무거운 B-Rep, assembly motion/interference, STEP 변환, evidence 생성은 두 번째 또는 세 번째 등급이어야 한다. 상용 중요 경로는 Redis-backed async limit 또는 fail-closed 운영 정책을 사용한다. Redis 미설정 상태를 상용 정상 모드로 허용하지 않는다.

### 교정 9. 전문가 검토는 유지하되 외부 CAD는 요구하지 않는다

전문가가 필요하다는 의미는 SOLIDWORKS 설치가 필요하다는 뜻이 아니다. 전문가는 NexyFab 내부에서 다음 evidence를 검토하고 서명한다.

- exact `.nfab` revision과 canonical design hash
- B-Rep 및 STEP round-trip 결과
- assembly motion/interference와 unresolved DoF
- PDF drawing, BOM, tolerance/manufacturing checks
- 알려진 unavailable/limited 항목

고위험 안전부품, 복잡 공차 chain, 규제 대상 또는 첫 제조 제품은 전문가 승인을 필수로 둔다. 도구와 책임 역할을 분리한다.

## 3. 구현 전 선행 Gate

### S1. Drawing projection 정확성 spike

입력: 단순 prism, cylinder, cone, sphere, fillet part, section 가능한 hollow part.

합격 조건:

- visible/hidden 분리와 analytic curve 보존이 golden expectation과 일치
- 투영 원/호 및 section 경계가 B-Rep 치수와 허용오차 내 일치
- 실패 형상은 release-ready가 아니라 명시적 unavailable

### S2. XCAF assembly 왕복 spike

입력: 중첩 assembly, 동일 part 재사용, 서로 다른 occurrence transform/name/color.

합격 조건:

- AP242 export 후 definition/occurrence/hierarchy/transform 보존
- 일반 shape round-trip 결과와 혼용하지 않음
- 현재 binding에서 reimport traversal이 불가능하면 별도 XCAF reader binding 또는 검증기를 선택하고 그 한계를 evidence에 기록

### S3. LGPL 배포 준수 spike

입력: 실제 production public/static/server bundle과 lockfile.

합격 조건:

- 모든 직접·간접 배포 구성요소 inventory 생성
- 핵심 LGPL 구성요소가 notice/source 제공 절차에 포함
- 법률 검토가 필요한 미결 항목을 owner와 기한 없이 `완료` 처리하지 않음

세 spike는 서로 독립적이며 모두 fail-closed다. S1 또는 S2가 미통과여도 기존 편집 기능을 훼손하지 않고 해당 release capability만 제한한다.

## 4. 보정된 실행 순서

각 단계는 `점검 → 구현 → 집중 검증 → 회귀 → Closed Beta 무결성 비교 → 다음 단계`로 진행한다.

### Phase 0. 보호선 및 실증

1. 기존 DB/파일 무결성 snapshot 재확인
2. 참조 코퍼스 read-only inventory 고정
3. S1 drawing, S2 XCAF, S3 license spike 실행
4. API 등급 inventory와 현재 auth/quota gap 작성

종료 조건: 원본 무변경, spike 결과와 blocker가 재현 가능한 artifact로 남음.

### Phase 1. 불변 revision 및 kernel identity

1. `.nfab v3` canonical design normalizer
2. `CadRevisionManifest v1`
3. `KernelStackIdentity v1`
4. 상용 `--mode=wasm` 및 no-stub gate
5. exact artifact 보존·새 revision 생성 정책

종료 조건: 동일 설계 의미는 동일 canonical hash, 변동 metadata는 artifact hash만 바꾸며, 기존 `.nfab`는 byte 단위로 변하지 않음.

### Phase 2. 자체 kernel evidence 기반

1. `NexyFabKernelEvidence v1` schema와 signature envelope
2. 생성 stack/검증 stack identity 결속
3. part geometry comparator 강화
4. XCAF assembly comparator 분리
5. unavailable/partial 결과 fail-closed

종료 조건: evidence만 보고 입력 revision, 커널 자산, 정책, 측정값, 검증 프로세스를 재현 가능.

### Phase 3. Release Audit v2와 상용 API 경계

1. 기존 외부-native evidence v1은 호환 보존
2. 자체 kernel evidence를 받는 v2 추가
3. 외부 CAD worker 요구를 v2 기본 경로에서 제거
4. heavy/release API auth, plan, quota, Redis limit, audit 적용
5. replay 방지와 trusted key registry 적용

종료 조건: 외부 CAD 파일 없이도 자체 evidence + 제조 전문가 서명으로 최종 review에 진입할 수 있으며 검증 미완료면 release는 차단됨.

### Phase 4. 도면·PMI·제조 패키지

1. S1 합격 경로만 exact drawing으로 승격
2. PDF drawing을 초기 제조 annotation 기준으로 결속
3. AP242 PMI는 limited capability 상태와 검증 범위를 UI/evidence에 표시
4. STEP part, STEP assembly, PDF, BOM, manifest, evidence를 하나의 immutable package로 생성

종료 조건: package 내 모든 artifact hash가 manifest와 일치하고, 미지원 기능이 성공처럼 표시되지 않음.

### Phase 5. 복잡 제품 Pilot

1. 단품 → 반복 occurrence assembly → 복잡 로봇/참고 제품 순서
2. 참조 파일은 복제본/파생 artifact로만 처리
3. golden corpus, mutation, round-trip, performance, abuse tests
4. 실제 제조 전문가의 내부 검토와 서명
5. 관측성, restore drill, rollback rehearsal 후 제한 상용 Pilot

종료 조건: 선정 범위에서 오류율·성능·복구·보안·제조 전달 기준을 충족. 일부 샘플 성공만으로 일반 상용 ready를 선언하지 않음.

## 5. 첫 구현 묶음의 정확한 범위

첫 구현은 다음만 수행한다.

1. 기존 보호 snapshot과 reference inventory 재확인
2. S1/S2/S3 spike artifact와 판정기
3. `.nfab v3` canonical design hash 정책·테스트
4. `CadRevisionManifest v1`
5. `KernelStackIdentity v1`
6. 상용 WASM-required/no-stub preflight
7. `NexyFabKernelEvidence v1` schema skeleton
8. Release Audit v2 skeleton

첫 묶음에서 하지 않는 것:

- 기존 project schema 교체
- 기존 `.nfab`, DB row, 업로드 원본 수정
- feature tree/assembly/drawing/BOM 재작성
- 외부 native CAD v1 흐름 삭제
- AP242 PMI 완전 지원 선언
- exact HLR 실증 전 production 승격
- 실제 evidence 없이 외부 CAD blocker 해제

## 6. 상용화 판단 기준

### 초기 제한 상용 Pilot 가능 조건

- 외부 CAD 설치 없이 지원 형상 생성·편집·저장·재열기 성공
- real kernel identity와 no-stub gate 통과
- part 및 assembly STEP evidence 분리 통과
- 지원 도면 형상 범위 명시 및 PDF 제조 도면 검토 완료
- heavy CAD API 인증·할당량·queue·audit 적용
- 라이선스 배포 검토와 notice/source 절차 완료
- backup/restore, payment, support, rollback 운영 gate 통과
- Closed Beta 무결성 비교 통과

### 아직 충분하지 않은 주장

- 모든 CAD 제품과 완전 동등
- 모든 AP242 PMI 완전 보존
- 모든 곡면·자유곡면 도면 자동 release-ready
- 모든 복잡 제품 무인 제조 승인
- 테스트 통과만으로 양산 책임까지 자동 보장

## 7. 최종 Go/No-Go

**계획 구현 시작: GO**

단, 다음 세 원칙은 변경 불가다.

1. 기존 `.nfab v3`와 Closed Beta 원본은 진실원으로 보존하고 새 revision만 추가한다.
2. 자체 evidence가 실제로 통과하기 전에는 외부 native CAD blocker를 코드에서 제거하지 않는다.
3. S1 drawing, S2 XCAF, S3 LGPL 실증과 상용 no-stub gate를 Phase 0/P0로 먼저 끝낸다.

이 조건이면 외부 CAD 설치 없는 NexyFab 자체 서비스라는 목표와 데이터 보호, 기술적 정직성, 상용화 안전성을 함께 유지할 수 있다.
