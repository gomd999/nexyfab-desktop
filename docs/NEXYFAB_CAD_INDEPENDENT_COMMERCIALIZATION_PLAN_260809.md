# NexyFab 독립형 AI·정밀 CAD 상업화 전체 계획

- 기준일: 2026-08-09
- 제품 목표: 외부 CAD 설치 없이 NexyFab만으로 AI 설계, 정밀 편집, 검증, 도면·BOM 및 제조 전달을 완료
- 기본 교환 형식: STEP 중심의 중립 형식
- 외부 전용 CAD 호환: 기본 상품의 필수 조건이 아닌 선택적 Enterprise 기능
- 실행 방식: `점검 → 구현 → 검증·조정 → 다음 단계`

> 구현 현황과 실증 판정은 `docs/CAD_INDEPENDENT_IMPLEMENTATION_AND_COMMERCIAL_REVIEW_260809.md`에 기록한다. 현재 Phase 0의 외부 CAD 비의존 계약, 커널 identity, exact-CAD 릴리스 V2, API 보안, 제조 패키지 및 복잡 제품 범위 판정이 구현되었다. 일반 복잡 제품 셀프서비스와 자동 제조 승인은 아직 No-Go다.

## 1. 최종 제품 정의

NexyFab은 단순한 3D 뷰어나 외부 CAD 실행기가 아니라 다음을 하나의 서비스에서 제공하는 독립형 제조 설계 플랫폼을 목표로 한다.

1. 자연어·요구사항·참고 형상에서 AI 3D 초안 생성
2. 파라메트릭 feature와 치수 기반 정밀 편집
3. 부품 및 assembly 구조 작성
4. mate, joint, motion, collision 및 interference 검증
5. 재료, 공차, 표면처리, 체결부 및 BOM 정의
6. 2D 제조 도면과 중립 3D 제조 패키지 생성
7. DFM 및 전문가 검토
8. 견적·파트너·제조 전달
9. 개정, 승인, 서명, provenance 및 감사 추적

사용자는 SOLIDWORKS, Inventor, CATIA, Creo 또는 Revit을 설치하지 않고 브라우저와 NexyFab 서비스만으로 전체 기본 흐름을 수행한다.

## 2. 지원 범위와 비지원 범위

### 2.1 기본 상품에서 지원

- NexyFab 자체 프로젝트 및 파라메트릭 모델
- B-Rep 기반 solid/surface 형상
- sketch, constraint 및 feature history
- part, assembly, mate 및 joint
- 치수, 공차, 재료, 표면처리 및 BOM
- STEP AP242 우선 입출력
- STEP AP203/AP214 호환 입력
- STL/OBJ/3MF 메시 교환
- DXF/SVG 기반 2D 교환
- PDF 제조 도면 및 검토 문서
- ZIP 기반 제조 handoff 패키지
- AI 생성물과 전문가 개정본의 완전한 lineage

### 2.2 명시적으로 비지원 또는 제한 지원

- SLDPRT/SLDASM의 네이티브 feature tree 완전 보존
- IPT/IAM, CATPart/CATProduct, PRT/ASM, RVT의 네이티브 의미 완전 보존
- 외부 CAD 전용 매크로, 플러그인, 수식 및 proprietary constraint
- 특정 외부 CAD에서의 픽셀·기능 단위 동일 동작 보증
- 검증되지 않은 메시를 자동으로 생산 가능한 정밀 B-Rep이라고 주장하는 기능

전용 형식은 향후 라이선스가 허용되는 변환 SDK, 고객 측 변환 또는 별도 Enterprise Connector로만 제공한다. 기본 NexyFab 상용화의 완료 조건에는 포함하지 않는다.

## 3. 기술 아키텍처 목표

```text
사용자 요구사항 / 참고 파일
          ↓
AI 설계 계획 및 파라미터 제안
          ↓
NexyFab Parametric CAD Document
          ↓
Geometry Kernel (B-Rep / Boolean / Fillet / Topology)
          ↓
Assembly + Constraint + Motion Solver
          ↓
Precision / DFM / Drawing / BOM Validators
          ↓
전문가 검토 및 r+1 개정
          ↓
STEP AP242 + PDF Drawing + BOM + Evidence Package
          ↓
견적 / 제조 파트너 / 생산 승인
```

### 3.1 단일 진실 원천

NexyFab의 자체 CAD document를 설계의 단일 진실 원천으로 사용한다.

- 모든 feature와 parameter에 안정적인 ID 부여
- part와 occurrence를 구분
- assembly transform과 mate를 명시적으로 저장
- 단위계를 문서 최상위에서 고정
- 재료, 공차, 표면처리 및 제조 메타데이터를 형상과 함께 버전 관리
- 저장할 때 canonical serialization과 SHA-256 생성
- 모든 내보내기 결과를 정확한 document revision에 결속

### 3.2 형상 커널

현재 OCCT/Replicad 계열 기반을 상용 코어로 정리한다.

- 서버와 브라우저의 커널 버전 고정
- Boolean, fillet, chamfer, shell, sweep, loft의 결정론 검증
- topology naming 안정화
- tolerance와 healing 정책 중앙화
- 실패한 연산은 형상을 조용히 변경하지 않고 명시적 오류로 반환
- 대형 모델은 worker로 격리하고 시간·메모리·파일 크기 제한 적용

### 3.3 AI와 CAD 커널의 경계

AI는 직접 임의 B-Rep 바이트를 만드는 주체가 아니라 검증 가능한 CAD 명령과 parameter를 제안한다.

- 허용된 command schema만 실행
- 명령별 precondition과 postcondition 검사
- 형상 실패 시 자동 단순화 또는 사람 검토로 전환
- AI의 텍스트 주장보다 커널 계산 결과를 우선
- 생성 모델, prompt, parameter, command, 결과 hash를 기록
- 고객 파일을 기본적으로 학습 데이터에 사용하지 않음

## 4. 필수 제품 기능 계획

### 4.1 Part Design

- 2D sketch 작성 및 완전 구속 상태 표시
- line, arc, circle, spline 및 construction geometry
- dimensional/geometric constraint solver
- extrude, revolve, sweep, loft, hole, pattern, mirror
- fillet, chamfer, shell, draft
- datum plane, axis, point 및 local coordinate system
- feature reorder, suppress, rollback 및 dependency graph
- feature 실패 원인과 복구 제안

완료 게이트:

- golden part 세트 100% 재생성
- 저장 후 재열기 geometry hash 일치
- undo/redo 및 parameter edit 후 의도하지 않은 feature 소실 0건
- 단위 변환 왕복 오차가 정의된 허용치 이내

### 4.2 Assembly Design

- part occurrence, subassembly 및 configuration
- fixed, coincident, concentric, distance, angle 및 tangent mate
- revolute, prismatic 및 cylindrical joint
- mate overconstraint/underconstraint 진단
- interference와 minimum clearance
- exploded view와 assembly sequence
- 대형 assembly의 지연 로딩 및 simplified representation

완료 게이트:

- 6축 로봇 25부품·60 mate·6 DoF 재현
- r+1 개정 후 18개 구동계 occurrence와 모든 참조 일치
- assembly 저장·재열기 후 transform 및 mate diff 0
- 대형 기준 모델에서 정의된 응답시간과 메모리 예산 충족

### 4.3 정밀 검증

- solid validity, open shell, non-manifold 및 self-intersection 검사
- collision, interference 및 clearance 검사
- mass, center of gravity, inertia 및 bounding box
- joint limit, workspace, path 및 singularity 경고
- 케이블 굽힘·비틀림·서비스 공간
- tolerance stack과 fit class
- 얇은 벽, 작은 hole, undercut 등 공정별 DFM

완료 게이트:

- 알려진 결함 fixture의 탐지 recall 목표 확정 및 달성
- 거짓 통과로 분류되는 치명 결함 0건
- 검증 결과가 프로그램 revision hash와 결속
- 기준 결과 변경 시 승인된 baseline update 요구

### 4.4 도면·PMI·BOM

- 정면, 평면, 측면, section, detail 및 isometric view
- linear, angular, diameter, radius 및 ordinate dimension
- 일반공차, 기하공차, datum, surface finish 및 welding symbol
- title block, revision table 및 approval status
- balloon과 BOM row의 양방향 연결
- part number, revision, material, quantity 및 make/buy
- PDF와 CSV/XLSX 제조 산출물
- STEP AP242 PMI는 지원 가능 범위를 명시하고 검증

완료 게이트:

- 모든 제조 필수 치수가 모델 parameter와 추적 가능
- orphan dimension 및 잘못된 BOM reference 0건
- 개정 후 drawing/BOM stale 상태 자동 탐지
- PDF/CSV/STEP 패키지의 revision과 hash 일치

### 4.5 중립 형식 입출력

- STEP을 기본 정밀 형식으로 지정
- 가져오기 전 sandbox, 크기, 확장자, MIME 및 magic-byte 검사
- 가져온 형상의 healing 전후 차이 보고
- 내보내기 후 별도 프로세스에서 다시 가져오기
- volume, area, body count, component count, transform 및 topology 비교
- STL/OBJ/3MF는 메시임을 명시하고 정밀 feature 편집과 구분
- DXF는 지원 entity와 단위를 명시

완료 게이트:

- STEP round-trip에서 치명적 geometry/assembly 손실 0건
- 모든 export에 source revision과 검사 보고서 포함
- unsupported entity를 조용히 삭제하지 않고 경고 또는 실패 처리
- 제조사 샘플 수신 시험 통과

## 5. 복잡 제품 대응 계획

`C:\Users\gomd9\Downloads\참고파일들`과 같은 복잡 제품은 평가 코퍼스로만 사용한다. 원본은 읽기 전용으로 유지하고 별도 holdout/golden 정책을 적용한다.

### 5.1 난이도 분류

- L1: 단일 prismatic part
- L2: 다중 feature 단일 part
- L3: 소형 assembly
- L4: 운동 assembly 및 배관·케이블
- L5: 대형 복합 제품, 다중 subassembly, 제조 문서 포함

### 5.2 평가 항목

- 파일 열기 성공률
- 형상 유효성
- 부품·body·occurrence 보존
- assembly transform 보존
- 단위와 재료 보존
- round-trip 차이
- 화면 첫 표시 시간
- 편집 명령 응답시간
- peak memory
- 검증 완료 시간
- 장애 후 복구 가능성

### 5.3 상업화 기준

- L1~L3를 기본 상품의 초기 지원 범위로 확정
- L4는 전문가 검토 포함 상품에서 제공
- L5는 사전 complexity scan 후 비동기 처리 또는 별도 견적
- 지원 한계를 넘는 파일은 결제 전에 차단하거나 수동 견적으로 전환

## 6. 자체 정확도 보증 체계

외부 CAD를 사용하지 않으므로 정확도는 특정 제품과 비교하는 방식이 아니라 독립적인 수학·기하·제조 증거로 입증한다.

### 6.1 4중 검증

1. **문서 검증**: schema, 참조, 단위, revision, dependency
2. **커널 검증**: B-Rep validity, topology, tolerance, mass properties
3. **왕복 검증**: STEP export 후 격리된 importer로 재수입 및 비교
4. **전문가 검증**: DFM, 공차, 재료, 공정, 조립 및 안전 판단

### 6.2 독립성 확보

- export와 re-import 검증 프로세스를 분리
- 동일 메모리 객체 재사용 금지
- 검증 fixture와 생성 fixture 분리
- holdout 제품은 개발 중 기대값 조정에 사용하지 않음
- 전문가 서명은 정확한 revision hash에만 유효

### 6.3 결과 상태

- `draft`: AI 또는 사용자가 편집 중
- `geometry_validated`: 커널 검증 통과
- `precision_validated`: 치수·공차·assembly 검증 통과
- `manufacturing_reviewed`: 제조 전문가 검토 통과
- `approved_for_release`: 독립 최종 승인 통과
- `released`: 별도 권한으로 실제 배포 완료

`approved_for_release`와 `released`는 계속 분리한다.

## 7. 제조 전달 구조

외부 CAD 없이 제조사에 전달할 표준 패키지는 다음과 같다.

```text
manufacturing-package.zip
├─ model.step
├─ drawing.pdf
├─ bom.csv
├─ requirements.json
├─ material-and-finish.json
├─ inspection-plan.json
├─ validation-report.json
├─ provenance.json
└─ manifest.json
```

필수 조건:

- 모든 파일의 SHA-256을 manifest에 기록
- 단위와 좌표계를 모든 산출물에 명시
- drawing, BOM 및 STEP이 같은 revision을 참조
- 제조사가 받은 패키지를 포털에서 검증 가능
- 제조사 피드백은 새 revision으로만 반영
- 견적/RFQ 전송은 명시적 사용자 승인 후 수행

## 8. UI/UX 전체 흐름

```text
요구사항 입력
 → AI 복잡 제품 구현·자동 반복 검증
 → 파라미터/Feature 편집
 → Assembly/동작 편집
 → 정확도 검사
 → 도면/BOM 생성
 → 전문가 제조 검토
 → 제조 패키지 미리보기
 → 사용자 승인
 → 견적/RFQ 또는 다운로드
```

### 필수 UX 원칙

- 현재 상태와 다음 통과 조건을 항상 표시
- AI 추정값과 커널 계산값을 시각적으로 구분
- 미검증 결과에 명확한 워터마크
- 오류를 자동으로 숨겨서 통과시키지 않음
- 복잡 작업은 비동기 job, 진행률, 취소 및 재개 제공
- 모든 자동 수정은 before/after와 영향 범위 표시
- 전문가 모드에서 feature tree, constraint, tolerance 및 evidence를 한 화면에서 연결
- 초보자 모드와 전문가 모드는 같은 document를 사용하고 기능만 단계적으로 노출

## 9. 운영·보안 계획

### P0

- PostgreSQL 및 객체 저장소 운영 구성
- Redis 기반 queue와 분산 rate limit
- KMS/secret manager 기반 서명 키 관리
- 관리자·전문가 MFA와 최소 권한 RBAC
- CAD worker의 격리, egress 제한, CPU/RAM/time quota
- 업로드 malware와 archive bomb 방어
- 테넌트 간 object key와 DB 접근 격리 테스트
- 감사 로그 위변조 방지
- 백업·복구 훈련과 RPO/RTO 검증
- 결제·웹훅·환불 E2E
- 외부 침투시험과 재시험

### P1

- 장애 상태 페이지와 고객 알림
- 요청부터 제조 패키지까지 trace ID
- worker 성공률, queue latency, geometry failure, 비용 모니터링
- SBOM 및 dependency/container scan
- 데이터 보존·삭제 자동화와 삭제 증거
- 지원, 반려, 재작업 및 분쟁 runbook

## 10. 상업 상품 구조

| 상품 | 범위 | 외부 CAD |
|---|---|---|
| AI Product Build | AI가 부품·조립·동작·제조 산출물까지 완성 시도하고 검증 상태 제공 | 불필요 |
| NexyFab Design | 파라메트릭 CAD, assembly, STEP, 도면/BOM | 불필요 |
| Verified Design | 정밀 검증과 evidence report | 불필요 |
| Expert Manufacturing | 제조 전문가 검토와 승인 패키지 | 불필요 |
| Enterprise Connector | 고객사의 전용 CAD 연계 | 선택 사항 |

기본 매출 모델:

- 사용자/팀 구독
- compute 및 저장 용량
- 복잡 모델 처리 크레딧
- 전문가 검토 건별 요금
- 제조 패키지 및 협업 워크플로
- Enterprise 보안·보존·SSO·전용 connector

전용 CAD 라이선스 비용은 기본 상품 원가에 포함하지 않는다.

## 11. 단계별 실행 계획

### Phase 0 — 기준 고정 및 위험 제거

목표: 외부 CAD 의존 없는 제품 계약을 코드와 UI에 고정

- 기존 7개 native worker를 기본 release blocker에서 제거
- `external_native_cad_evidence_required`를 자체 STEP round-trip 증거로 대체
- 전용 CAD 호환 문구를 Enterprise optional로 이동
- 상태 모델과 금지 주장 적용
- Closed Beta 무결성 기준 재스냅샷

완료 조건:

- 외부 CAD 미설치 상태에서 기본 흐름의 필수 blocker 0개
- proprietary compatibility를 암시하는 UI/API 문구 0개
- 기존 계정·비밀번호·저작물 diff 0

### Phase 1 — 자체 CAD 문서와 커널 강화

목표: 저장·편집·재생성의 결정론 확보

- canonical document schema와 migration
- topology naming 및 feature dependency 강화
- 연산별 pre/post validation
- undo/redo, rollback, suppress 및 recovery
- golden part/assembly 확대

완료 조건:

- golden 모델 저장·재열기 diff 0
- 결정론 테스트 반복 통과
- 치명적 silent geometry change 0건

### Phase 2 — STEP·도면·BOM 제조 산출물

목표: 외부 CAD 없이 제조사가 사용할 패키지 완성

- STEP AP242 export/import 검증
- 격리 round-trip verifier
- 2D drawing과 PMI 지원 범위 확정
- BOM, 재료, 표면처리, 검사계획
- content-addressed manufacturing ZIP

완료 조건:

- golden/holdout STEP round-trip 통과
- drawing/BOM/STEP revision 불일치 0건
- 최소 2개 독립 제조 환경에서 샘플 수신 확인

### Phase 3 — 복잡 제품과 성능

목표: L4/L5 제품을 예측 가능하게 처리

- complexity preflight와 자동 등급
- 비동기 분할 처리
- simplified representation와 LOD
- subassembly 단위 incremental validation
- crash recovery와 resumable job
- 메모리·시간·비용 budget

완료 조건:

- 참고 코퍼스의 대표 holdout 세트에서 목표 성공률 달성
- 시스템 중단 없이 oversized 작업 거부/전환
- job 재개 후 결과 hash 일관성

### Phase 4 — 제조 전문가 검토

목표: 자체 CAD 결과의 실제 생산 적합성 입증

- DFM·공차·재료·공정 review packet
- 전문가 자격과 역할 분리
- 정확한 revision hash에 서명
- 반려→r+1 수정→재검증 루프
- 제조사 피드백과 inspection result 수집

완료 조건:

- 로봇 demonstrator 제조 검증 통과
- domain/independent reviewer 이중 서명
- 실제 샘플 제작 또는 제조사 수신 검증 증거

### Phase 5 — 운영 상용화

목표: 통제된 유료 Pilot 운영

- Redis, KMS, MFA, RBAC, sandbox worker
- 백업 복구와 장애 훈련
- 결제·환불·세금·웹훅
- SLA, 지원, 상태 페이지
- 보안·법무·라이선스 검토

완료 조건:

- Critical/High 보안 취약점 0
- 복구 훈련 성공
- 중복 청구와 권한 오부여 0
- 상업 라이선스 및 고객 데이터 조건 검토 완료

### Phase 6 — Design Partner Pilot

목표: 3~5개 기업의 실제 저위험 프로젝트로 검증

- L1~L3 기본, L4 전문가 포함
- 정확도, 재작업, 처리시간, 원가, 만족도 측정
- 모든 제조 전달 전 사용자와 전문가 승인
- 실패 사례를 지원 매트릭스와 자동 차단 정책에 반영

완료 조건:

- 원본 훼손·교차 테넌트 노출 0
- silent corruption 0
- 전문가 검토 누락 0
- 프로젝트별 원가와 마진 측정 가능
- 반복 가능한 제조 패키지 승인 증거

### Phase 7 — 제한적 유료 Beta 및 공개 확대

- 지원 형식, 기능, 복잡도 및 산업을 명시
- 30일 이상 품질·가용성·비용 지표 수집
- 지원 용량과 전문가 공급 확인
- 독립 보안 재시험
- 공개 확대 Go/No-Go 심사

## 12. 재정의된 출시 게이트

### 기본 NexyFab 출시 필수

- 자체 CAD document 결정론
- B-Rep/assembly 정밀 검증
- STEP 독립 round-trip
- 도면/BOM/제조 패키지 일관성
- 제조 전문가 검증
- 운영 보안·복구·결제
- Closed Beta 및 고객 데이터 보호

### 기본 출시에서 제외

- SOLIDWORKS 설치
- Inventor 설치
- CATIA 설치
- Creo 설치
- Revit 설치
- Parasolid 전용 변환기
- DWG 전용 엔진
- 전용 CAD native feature tree 보증

### 선택적 Enterprise 게이트

- 특정 전용 CAD connector 계약이 체결된 경우에만 해당 제품/SDK 검증
- 기본 서비스의 정확도·릴리스 상태와 별도 표시
- connector 실패가 NexyFab 자체 CAD 결과를 훼손하지 않도록 격리

## 13. 핵심 품질 지표

| 지표 | 상업화 초기 목표 |
|---|---:|
| 원본·Closed Beta 훼손 | 0건 |
| 교차 테넌트 접근 | 0건 |
| 치명적 silent geometry corruption | 0건 |
| golden 저장·재열기 일치 | 100% |
| 지원 범위 STEP round-trip 치명 손실 | 0건 |
| 미검증 상태의 제조 승인 | 0건 |
| drawing/BOM/STEP revision 불일치 | 0건 |
| 필요한 전문가 검토 누락 | 0건 |
| 백업 복구 훈련 | 100% 성공 |
| Critical/High 보안 미조치 | 0건 |

성능 SLA와 일반 성공률은 복잡도 등급별 실제 Pilot 결과로 결정한다. 모든 모델에 하나의 과장된 정확도·처리시간 수치를 적용하지 않는다.

## 14. 최종 판단

외부 CAD 설치를 제거하는 목표는 기술적으로 타당하며 NexyFab의 제품 정체성을 더 명확하게 만든다. 다만 외부 CAD를 없앤다는 것은 정확도 검증을 없애는 것이 아니라 다음으로 대체하는 것이다.

> 자체 CAD 문서의 결정론 + 독립 커널 검증 + STEP 왕복 검증 + 제조 전문가 검증

상업화의 첫 목표는 모든 proprietary CAD를 대체한다고 주장하는 것이 아니다. NexyFab 안에서 설계를 완성하고 제조사가 받을 수 있는 중립 패키지를 정확하게 만드는 것이다. 전용 CAD 호환은 고객 수요와 라이선스 경제성이 확인될 때 별도 Enterprise connector로 추가한다.

이 기준에서는 7개 외부 CAD 라이선스가 없어도 기본 제품의 개발과 유료 Pilot이 가능하다. 다음 구현의 최우선 순서는 Phase 0의 release gate 재정의와 Phase 1~2의 자체 문서·STEP·도면/BOM 검증 강화다.
