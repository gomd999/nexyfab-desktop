# NexyFab 활성 실행 기준서

상태 기준일: 2026-08-10  
적용 범위: 결제·법무를 제외한 AI 복잡 제품 생성, 정밀 CAD, 기계·건축·토목·조경·인테리어, 참고자료 활용, 기술 출시 검증

## 1. 이 문서의 역할

이 문서는 NexyFab CAD 작업의 단일 활성 기준서다. 날짜가 붙은 기존 계획·리뷰·handoff 문서는 근거와 이력으로만 사용한다. 현재 작업 순서와 완료 상태가 충돌하면 이 문서를 우선하며, 상태는 코드·테스트·실데이터 증거가 있을 때만 변경한다.

다음 표현은 서로 바꾸어 쓰지 않는다.

- `implemented`: 코드 경로가 존재한다.
- `unit_verified`: 단위·통합 테스트가 통과했다.
- `real_data_verified`: 독립 실데이터로 검증됐다.
- `release_verified`: 승인된 홀드아웃·운영 증거를 포함한 출시 게이트를 통과했다.
- `partial`: 일부 코드가 있으나 실제 제품 흐름이 끝까지 연결되지 않았다.
- `not_run`: 입력이나 권위 근거가 없어 검증하지 않았다. 실패나 통과로 바꾸지 않는다.
- `unsupported`: 현재 지원하지 않으며 UI와 문서에서도 지원한다고 표시하지 않는다.

## 2. 변경 불가 원칙

1. 기존 Closed Beta 계정, 비밀번호, 프로젝트, 업로드 저작물과 보호 파일을 수정·삭제·마이그레이션하지 않는다.
2. 각 작업 전후 Closed Beta 무결성을 비교하고 테이블·행·보호 파일 차이가 하나라도 있으면 다음 작업으로 넘어가지 않는다.
3. `7.3 example`, CAD 매뉴얼, BIM 지침, `참고파일들`, `239.건축 도면 데이터`는 원본 위치에서 읽기 전용으로 사용한다.
4. 출처·라이선스가 승인되지 않은 파일은 로컬 기술 평가만 허용하며 학습, 재배포, 상용 정확도 근거로 승격하지 않는다.
5. AI가 만든 값, 추정값, 규칙 파생값, 실측값, 외부 원본값을 provenance로 구분한다.
6. 필수 치수·재료·공차·하중·좌표계가 없으면 AI가 임의로 채워 release 상태를 만들지 않는다.
7. NexyFab의 기본 설계·정밀 CAD 흐름은 외부 CAD 설치를 요구하지 않는다.
8. SLDPRT, SLDASM, RVT, CATPart 등 독점 네이티브 형식의 선택적 변환 워커는 핵심 출시 조건으로 사용하지 않는다.
9. 결제와 법무는 기술 출시 감사에서 `deferred=true`로 명시하며 기술 통과로 간주하지 않는다.

## 3. 고정 실행 사이클

모든 작업 패키지는 다음 순서로만 진행한다.

### A. 점검

- 관련 소스, 테스트, 기존 증거, 실데이터를 검색한다.
- `이미 구현`, `부분 구현`, `미구현`, `외부 조건`을 구분한다.
- 변경 대상과 건드리지 않을 대상을 기록한다.
- 입력, 출력, 실패 상태, 보안 경계를 먼저 정의한다.

### B. 구현

- 기존 기능을 복제하지 않고 현재 공용 모델과 연결한다.
- 변경 범위를 해당 작업 패키지로 제한한다.
- 원본 참고자료나 Closed Beta 데이터를 직접 수정하지 않는다.
- 불확실한 결과는 `not_run`, `concept_only`, `authoritative_input_required` 중 하나로 명시한다.

### C. 검증 및 조정

- 신규 단위 테스트와 관련 회귀 테스트를 실행한다.
- 가능한 경우 독립 실데이터를 별도로 실행한다.
- 실패 원인을 코드, 데이터, 환경, 권위 입력 부족으로 분리한다.
- 수정 후 같은 검증을 다시 실행한다.
- Closed Beta 무결성 차이 0을 확인한다.

### D. 다음 작업 진입 판정

다음 조건을 모두 만족해야 다음 패키지로 이동한다.

- 구현 산출물이 존재한다.
- 필수 테스트가 통과한다.
- 알려진 한계와 `not_run`이 기록된다.
- 허위 pass 또는 지원 과장이 없다.
- Closed Beta 및 참고자료 원본 변경이 없다.
- 본 문서의 상태와 증거 링크가 갱신된다.

## 4. 재점검 기준선

2026-08-09 선별 재검증 결과:

- 분야·IFC·도면·접촉 관련 Vitest: 28개 테스트 파일, 227개 테스트 통과
- 참고자료 격리·분류 정책 Node 테스트: 6개 통과
- 형식 지원 진실표·네이티브 차단·LandXML 회귀: 4개 테스트 파일, 10개 통과, 조건부 실파일 1개 `skip`
- 결정론 조립 템플릿: 59개
  - 기계 20
  - 건축 11
  - 토목 3
  - 교량 7
  - 조경 8
  - 인테리어 10
- 참고파일 활용 매니페스트: 6,914개 파일 해시·분류, 원본 쓰기 0 정책
- 형식 admission probe: 1,076건 중 1,074건 통과, 2건은 확장자 위장 파일을 정상적으로 실패 처리
- 대표 golden corpus: 4 pass, 4 not_run
- 5개 분야 정확도 증거: dry-run만 존재하며 상용 승인 근거가 아님
- 실제 `nexyfab.cad-technical-release-audit.v3` 증거: 미입력

## 5. 현재 기능 상태

| 기능 | 현재 상태 | 판단 |
|---|---|---|
| 5개 분야 프로필·오케스트레이션 | unit_verified | 재구현하지 않는다. |
| 59개 분야 템플릿 | unit_verified | 분야 의미 문서와 연결한다. |
| UnifiedProject·정밀 CAD handoff | unit_verified, partial | 59개 템플릿의 출처 ID와 깊은 문서 `not_run` 경계는 연결됐다. 실제 분야 문서 승격은 후속 WP에서 수행한다. |
| 건축도면 4트랙 의미 그래프·건축 문서·3D solid plan | unit_verified, real_data_verified | 종단 합성 테스트와 Training 4트랙 7건 그래프 변환을 통과했다. Validation 4트랙 교집합은 0건이므로 상용 정확도 근거는 아니다. |
| 토목·조경 의미 모델과 검증기 | unit_verified | 정확 코리더·지형 편집 제품 흐름은 부분 구현이다. |
| 분야별 일반/전문가 UI | integration_verified, partial | 요구사항→AI 구현→수동 조정(선택)→정밀 검증→도면·산출물의 공통 5단계와 분야별 입력·검증·산출물을 표시한다. 간편 설계→정밀 CAD 딥링크는 분야·사용자 수준·작업 방식·언어 경로를 보존한다. 다만 프로필의 모든 전문가 도구가 실제 명령으로 연결된 것은 아니다. |
| 이미지→템플릿/조립 | unit_verified, partial | 전 분야 의미 분할·토폴로지 복원은 아니다. |
| 239 STR/SPA/OBJ/OCR 코퍼스 감사 | real_data_verified | 20개 ZIP·43,219개 라벨을 읽기 전용 전수 검사했다. 데이터 품질 문제 때문에 입력은 격리하며 학습·상용 근거 승격은 금지한다. |
| 239 STR/SPA/OBJ/OCR 추론 | not_run | 감사와 실제 추론 벤치마크는 별개이며 모델 추론·재투영 검증은 아직 실행하지 않았다. |
| IFC 계층·배치·의미 비교 | unit_verified, integration_verified | 자체 IFC4 export→import에서 객체·계층·월드 배치·Pset 실제 값·분류·수량·CRS·레지스트리 결합을 비교하며 값 변조 음성 대조군을 차단한다. 외부 독립 IFC 홀드아웃은 WP9에 남아 있다. |
| WBS·OBS·Pset·BEP 레지스트리 | unit_verified, real_data_audited | 버전·타입·단위·필수값·수식·BEP를 검증하는 제품 코어와 API가 있다. 원본 WBS/OBS 2종 및 BEP 16개 섹션은 대조 통과했다. 원본 Pset/보조 수식의 오류는 자동 승격하지 않고 격리한다. |
| 연관 도면 | unit_verified | 모델·도면·수량·BIM 품질·IFC revision/hash 의존성 그래프가 변경을 stale로 전파하고 검증된 재생성만 원자적으로 확정한다. |
| 수량산출 | unit_verified, partial | 모델·도면·BIM 품질·IFC와의 추적 연결은 구현했다. 분야별 실제 수량 규칙 홀드아웃은 WP9에 남아 있다. |
| 접촉·체결 계산 | unit_verified, integration_verified, partial | persistent B-Rep face·exact patch·bolt preload·다물체 HEX8 결과·artifact revision이 연결됐다. 비정합 곡면·대변형·소성·마찰 접촉 독립 검증은 남았다. |
| 참고파일 거버넌스 | unit_verified | 독립 승인과 미실행 의미 검증이 남았다. |
| 분야별 입력 형식 진실표 | unit_verified | `verified`, `preview`, `optional_external`, `unsupported`를 코드로 구분한다. |
| 외부 CAD 없는 자체 설계 | verified_supported_path | AI·수동·내장 정밀 CAD와 STEP/IFC 지원 흐름은 외부 CAD 설치가 필요 없다. 독점 네이티브 파일의 정확 의미 추출은 지원 흐름과 분리해 preview/unsupported로 표시한다. |
| 의존성 보안 | verified_local | 2026-08-10 `npm audit --audit-level=low` 0건, Next 16.3.0·Sharp 0.35.3·Nodemailer 9.0.5 등 패치 후 프로덕션 빌드와 회귀를 통과했다. 침투시험·운영 설정 검증은 별도다. |
| 기술 출시 감사 v3 | implemented, candidate_blocked | 실제 로컬 증거를 해시 결속한 v3 후보를 생성한다. 현재 42개 v3 항목과 5개 분야 서명 캠페인이 미충족이라 의도대로 BLOCKED다. |

## 6. 활성 작업 순서

순서는 의존성 때문에 변경하지 않는다. 선행 패키지가 기술적으로 실패하면 그 결과에 의존하는 후속 구현은 시작하지 않는다. 다만 WP9처럼 외부 검토자·staging/운영 영수증을 기다리는 항목은 `in_progress`와 출시 차단을 유지한 채, 그 증거를 대체하지 않는 로컬 성능·보안·CAD 완성 작업을 계속할 수 있다.

| 순서 | 작업 패키지 | 시작 상태 | 완료 기준 |
|---:|---|---|---|
| WP0 | 기준선·기능 진실표·격리 정책 고정 | complete | 본 문서, 지원 상태, Closed Beta 기준선이 일치한다. |
| WP1 | 공통 조립 결과와 분야별 깊은 문서 연결 | complete | 59개 템플릿이 의미 문서를 생성하거나 명시적 `not_run`을 반환한다. |
| WP2 | 239 데이터 읽기 전용 어댑터·누수 검사 | complete | 페어링·스키마·중복·split 검사가 완료되고 원본 쓰기가 0이다. |
| WP3 | 건축도면 STR/SPA/OBJ/OCR→2D 의미 그래프→3D | complete | 객체별 불확실성, 축척 게이트, 토폴로지, 재투영 검증이 연결된다. |
| WP4 | BIM WBS·OBS·Pset·BEP 레지스트리 | complete | 버전·타입·단위·필수값·공식 오류를 fail-closed로 검증한다. |
| WP5 | IFC 완전 의미 왕복·BIM 품질검수 | complete | 객체·계층·Pset 값·분류·수량·좌표가 완전 왕복한다. |
| WP6 | 모델-도면-수량-품질 의존성 그래프 | complete | 모델 변경이 관련 산출물을 stale 처리하고 재생성한다. |
| WP7 | 5개 분야 일반/전문가 수동 CAD 작업공간 | complete | AI와 수동 편집이 같은 리비전에서 왕복하고 잠금값을 보존한다. |
| WP8 | 복잡 제품 B-Rep 접촉·체결·FEA 통합 | complete | 실제 face·contact patch·FEA 결과·증거 해시가 연결된다. |
| WP9 | 독립 홀드아웃·운영·기술 출시 감사 | in_progress | 5개 분야와 필수 CAD 기능이 승인된 증거로 technical private pilot 게이트를 통과한다. |
| WP10 | 5개 분야 사용자 여정 UI/UX 정리 | complete | 기계·건축·토목·조경·인테리어의 분야별 시작·수동 수정·정밀 CAD·검증·산출물 흐름이 명확하고 맥락을 보존한다. |
| WP11 | route별 성능·로딩 최적화 | local_complete_external_rum_pending | 로컬 route 예산·lazy load·RUM 수집 경로는 통과했다. staging/production mobile p75 표본 판정은 `not_run`이다. |
| WP12 | 보안 경계·CAD 작업 격리 | planned | API 전수 권한 매트릭스, tenant/file 격리, CAD parser/worker 제한, AI tool 경계, 운영 보안 증거를 통과한다. |
| WP13 | 공통 정밀 CAD 코어 완성 | complete_local | 서버 영속 리비전·CAS 충돌 diff·payload hash 결속·5개 분야 계약·topology commit gate·정식 SQLite/Postgres 스키마를 검증했다. 운영 Postgres 실배포 증거는 WP20에 남긴다. |
| WP14 | 기계 정밀 CAD | complete_local | 24축 리비전 결속 릴리스 인증서, 실제 STEP 왕복과 기계 회귀를 통과했다. 독립 20제품/2검토자 상용 정확도 증거는 WP9/WP20 차단기로 유지한다. |
| WP15 | 건축 정밀 CAD/BIM | complete_local | 20축 리비전 결속, 공간/host/opening·IFC 심층 의미·도면/수량 경계를 검증했다. 독립 정확도와 외부 IFC open-solid 제한은 WP20 차단기다. |
| WP16 | 토목 정밀 CAD | complete_local | 22축 리비전 결속과 CRS·TIN·선형·종단·횡단·corridor·배수·LandXML exact element 경계를 검증했다. 독립 정확도는 pending이다. |
| WP17 | 조경 정밀 CAD | complete_local | 토목 지형 문서·표면·revision·CRS 결속과 grading·flow·식재·토양·포장·관수·스케줄 20축 경계를 검증했다. 독립 정확도는 pending이다. |
| WP18 | 인테리어 정밀 CAD | complete_local | 건축 host revision 기반 실측·공간·동선·가구·천장/MEP·마감·밀워크·조명·음향·BOQ 25축 경계를 검증했다. 독립 정확도는 pending이다. |
| WP19 | 분야 간 연합·대형 복잡 프로젝트 | complete_local_gate | 5개 분야 인증·좌표·revision·충돌·수량·권한·복구/성능 10-gate와 20,000-reference 영향 분석을 검증했다. 실제 대형 reference 운영 증거는 pending이다. |
| WP20 | 상용 기술 출시 검증 | local_complete_launch_blocked | 로컬 빌드·성능·보안·정확 커널·문서·Beta 무결성은 통과했다. 승인된 독립 정확도 캠페인과 운영 증거가 없어 technical private pilot gate는 BLOCKED다. |

WP11~WP20의 세부 입력·구현·검증·수치 기준은 [성능·보안·5개 분야 정밀 CAD 통합 실행계획](./PERFORMANCE_SECURITY_MULTI_DOMAIN_PRECISION_CAD_EXECUTION_PLAN_260810.md)을 따른다. 이 계획 문서는 세부 명세이고, 활성 상태와 최종 판정은 계속 본 문서에만 기록한다.

## 7. 작업별 필수 기록 형식

각 WP가 끝날 때 아래 블록을 이 문서 하단 실행 기록에 추가한다.

```text
### WPn 실행 기록 — YYYY-MM-DD
- 점검:
- 이미 구현되어 재사용한 것:
- 구현한 것:
- 수정 파일:
- 자동 테스트:
- 실데이터 검증:
- Closed Beta 무결성:
- 남은 not_run/한계:
- 판정: complete | adjust | blocked
- 다음 작업:
```

`complete`는 코드 작성 완료가 아니라 해당 WP의 완료 기준과 검증을 모두 통과했다는 뜻이다.

## 8. 출시 수치 기준

- 5개 분야 각각 승인된 독립 사례 최소 20개
- 독립 검토자 최소 2명
- 연속 3개 캠페인
- 캠페인당 사례별 최소 5회 반복
- 필수 정확도·커버리지 축 95% 이상
- `false_verified=0`
- `false_clear=0`
- 파괴적 부품 병합 0
- Closed Beta 보호 대상 차이 0
- 참고자료 원본 쓰기 0
- 실제 WASM 정밀 커널 사용, stub fallback 없음
- 롤백·카나리·모니터링·worker resume·성능 예산 통과
- 기술 감사 v3에 결제·법무 연기를 명시

## 9. 활성 실행 기록

### WP0 실행 기록 — 2026-08-09

- 점검: 5개 참고자료, 현재 분야 모델, 59개 템플릿, IFC, 도면, 접촉·체결, 코퍼스 거버넌스, 출시 게이트를 교차검토했다.
- 이미 구현되어 재사용할 것: 분야 프로필·오케스트레이터, UnifiedProject, 분야 문서·검증기, 템플릿, 연관 도면 코어, IFC 계층·배치, 접촉 솔버, 참고자료 정책.
- 구현한 것: 단일 활성 실행 기준서와 분야별 입력 형식 진실표를 생성했다. 독점 네이티브 형식, 독립 실행 가능한 중립 형식, 프리뷰, 미지원 경계를 분리하고 release 주장은 검증 상태에서만 허용했다.
- 수정 파일: `docs/ACTIVE_EXECUTION_MASTER.md`, `src/lib/ai/domainFormatSupport.ts`, `src/lib/ai/domainFormatSupport.test.ts`
- 자동 테스트: 선별 Vitest 227개 통과, 참고자료 정책 Node 테스트 6개 통과. 형식 진실표·네이티브 차단·LandXML 회귀 4개 파일에서 10개 통과/조건부 실파일 1개 `skip`. 전체 TypeScript typecheck 통과.
- 실데이터 검증: 참고파일 매니페스트 6,914개, admission probe 1,074 pass/2 expected fail, golden 4 pass/4 not_run을 확인했다.
- Closed Beta 무결성: 최종 구현 후 `validation-reports/closed-beta-integrity-260809-active-master-wp0-final.json`을 기존 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 239 데이터 권한, 5개 분야 승인 홀드아웃, BIM 정보 레지스트리, 실제 audit v3.
- 판정: complete
- 다음 작업: WP1 점검으로 진입해 공통 `domain-assembly` 결과와 기존 분야별 깊은 문서 사이의 실제 누락 매핑을 확정한다.

### WP1 실행 기록 — 2026-08-09

- 점검: 공통 `domain-assembly`, UnifiedProject, 59개 결정론 템플릿, 기계·건축·토목·조경·인테리어 깊은 문서 타입과 검증기를 대조했다.
- 이미 구현되어 재사용한 것: `UnifiedDesignProject`, 분야 프로필의 목표 스키마, 분야별 깊은 문서·검증기, 결정론 템플릿 카탈로그.
- 구현한 것: 모든 성공 템플릿 빌드에 `templateId`와 `templateDomain`을 보존했다. 공통 조립 문서에는 목표 깊은 스키마, `not_run`, `DEEP_DOCUMENT_ADAPTER_NOT_RUN` 사유를 기록해 단순 조립을 분야 의미 문서로 오인하지 않게 했다. 이후 실제 어댑터가 검증을 통과할 때만 `deep_document_validated`로 승격할 수 있다.
- 수정 파일: `scripts/drawing-to-3d/domain-assemblies.mjs`, `src/lib/ai/unifiedDesignProject.ts`, `src/lib/ai/assemblyUnifiedProjectAdapter.ts`, `src/lib/ai/assemblyUnifiedProjectAdapter.test.ts`, `docs/ACTIVE_EXECUTION_MASTER.md`
- 자동 테스트: 관련 회귀 2개 파일 11개 통과. 최종 집중 실행에서 실제 물탱크 템플릿 빌드를 포함한 9개 통과. 전체 TypeScript typecheck 통과.
- 실데이터 검증: 이 WP는 템플릿-문서 계약 고정 단계이며 외부 실데이터 승격은 수행하지 않았다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260809-active-master-wp1-final.json`을 기준선과 비교해 보호 테이블·행·파일 차이 0을 확인했다.
- 남은 not_run/한계: 59개 템플릿의 깊은 분야 문서 생성 자체는 아직 실행되지 않았다. 각 분야의 권위 입력과 전용 어댑터가 검증될 때 개별 승격한다.
- 판정: complete
- 다음 작업: WP2에서 `239.건축 도면 데이터`를 원본 쓰기 없이 읽고 페어링·스키마·중복·split 누수를 검사하는 어댑터를 구현한다.

### WP2 실행 기록 — 2026-08-10

- 점검: 별도 원본 위치의 Training/Validation, 원천/라벨, OBJ/OCR/SPA/STR 구조를 확인했다. 총 20개 ZIP이며 기존 문서의 “삭제 완료” 표현은 현재 파일 상태와 불일치했다.
- 이미 구현되어 재사용한 것: COCO 호환 어노테이션 방법론과 참고자료 읽기 전용·비학습 정책.
- 구현한 것: ZIP을 풀지 않고 중앙 디렉터리와 JSON 엔트리를 스트리밍하는 읽기 전용 감사기를 추가했다. 아카이브 구성, JSON·좌표·참조 무결성, 원천 이미지 페어링, 중복 파일명, 트랙 혼입, Training–Validation 누수, 감사 전후 원본 크기·mtime을 검사한다. 보고서에는 원본 payload 대신 집계와 제한된 문제 표본만 기록한다.
- 수정 파일: `scripts/reference/audit-239-drawing-corpus.mjs`, `scripts/reference/audit-239-drawing-corpus.test.mjs`, `package.json`, `package-lock.json`, `docs/strategy/drawing-annotation-schema.md`, `docs/ACTIVE_EXECUTION_MASTER.md`
- 자동 테스트: Node 단위 테스트 4개 통과. 전체 TypeScript typecheck 통과.
- 실데이터 검증: 20개 ZIP, 라벨 43,219개, 이미지 참조 43,219개를 전수 검사했다. 소스 페어 누락·파일명 중복·원본 변형은 0이다. 스키마·좌표 오류 140건/47파일, 트랙 혼입 44건/19파일, Training–Validation 누수 키 8개를 발견했다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp2-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 라이선스 승인이 없으므로 학습·재배포·상용 정확도 증거 사용은 금지한다. 발견된 74개 문제 대상(47+19+8, 집합 간 중복 가능)은 WP3 입력에서 격리해야 한다. 실제 추론 정확도는 `not_run`이다.
- 판정: complete
- 다음 작업: WP3에서 감사 통과·비누수 입력만 소비하는 STR/SPA/OBJ/OCR 의미 그래프 계약과 축척·불확실성·재투영 게이트를 구현한다.

### WP3 실행 기록 — 2026-08-10

- 점검: 이미지→프리셋 API, 건축·인테리어 의미 문서, 공간·개구부 토폴로지, UnifiedProject 승격 경로를 대조했다. 기존에는 네 트랙을 동일 도면 증거로 결합하는 계층이 없었다.
- 이미 구현되어 재사용한 것: `ArchitectureDocument`, 건축 토폴로지 검증기, 벽 개구부 boolean plan, `architectureDomainDocument`, UnifiedProject 검증기.
- 구현한 것: STR/SPA/OBJ/OCR provenance 그래프, 격리·신뢰도·권위 축척·필수 설계값 게이트, SPA 경계와 STR 벽 교차검증, 문·창호 host 연결, 건축 문서 변환, 3D solid plan, 2D 재투영 오차, `deep_document_validated` UnifiedProject 승격을 구현했다. 새 API는 잘못된 입력 400, 권위 입력 부족 409, 검증 실패 422로 fail-closed 처리한다. 239 COCO 트랙 어댑터는 같은 원본 도면 키가 아니면 병합하지 않는다.
- 수정 파일: `src/lib/ai/architectureDrawingReconstruction.ts`, `src/lib/ai/architectureDrawingReconstruction.test.ts`, `src/lib/ai/architectureTopologyVerification.ts`, `src/lib/ai/aihub239DrawingAdapter.ts`, `src/lib/ai/aihub239DrawingAdapter.test.ts`, `src/app/api/nexyfab/drawing/architecture/reconstruct/route.ts`, `src/app/api/nexyfab/drawing/architecture/reconstruct/route.test.ts`, `scripts/reference/audit-239-drawing-corpus.mjs`, `scripts/reference/probe-239-four-track.ts`, `src/types/unzipper.d.ts`.
- 자동 테스트: WP3 및 기존 건축 회귀 5개 파일, 22개 테스트 통과. 전체 TypeScript typecheck 통과.
- 실데이터 검증: 239 전수 감사에서 Training 4트랙 동일 도면 7건, Validation 0건을 확인했다. Training 7건은 모두 어댑터·그래프 게이트를 통과했으나 학습 split이고 권위 축척이 없어 상용 정확도 증거로 사용하지 않는다. `docs/evidence/aihub239/four-track-probe-260810.json` 참조.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp3-final.json`을 기준선과 비교해 보호 테이블·행·파일 차이 0을 확인했다.
- 남은 not_run/한계: 독립 Validation 4트랙 종단 사례, 실제 사용자 확인 축척, 이미지 추론 모델의 홀드아웃 정확도는 `not_run`이다. 이들은 WP9 출시 감사 전 반드시 별도 확보한다.
- 판정: complete
- 다음 작업: WP4에서 BIM 지침의 WBS·OBS·Pset·BEP를 버전·단위·필수값·공식까지 검증하는 레지스트리로 구현한다.

### WP4 실행 기록 — 2026-08-10

- 점검: BIM 지침 원본의 XLSX 7개·워크시트 161개와 BEP HWP를 읽기 전용으로 검사했다. WBS/OBS 7단계 코드 열, Pset 형식·단위·입력주체·수식 열, BEP의 업무범위·LOD·역할·CDE·교환·품질·납품·보안 항목을 실제 원문에서 확인했다.
- 이미 구현되어 재사용한 것: 안전한 수식 파서와 의존성 평가기, API rate limit·입력 크기 제한, Closed Beta 무결성 스냅샷·비교기.
- 구현한 것: `nexyfab.bim-information-registry.v1`, WBS/OBS 분류, Pset 정의·값, 단위 카탈로그, 16개 BEP 필수 섹션, 출처·버전 계약을 추가했다. 레지스트리와 인스턴스는 미등록 코드·속성·BEP 키, 타입·단위·필수값·출처·버전 불일치, Excel 오류 토큰, 미등록 수식 변수·순환·결과 불일치를 모두 fail-closed 처리한다. 10 MB 제한과 rate limit을 둔 검증 API도 연결했다.
- 수정 파일: `src/lib/bim/informationRegistry.ts`, `src/lib/bim/informationRegistry.test.ts`, `src/lib/bim/lhSiteBepCatalog.ts`, `src/lib/bim/lhSiteBepCatalog.test.ts`, `src/app/api/nexyfab/bim/information/validate/route.ts`, `src/app/api/nexyfab/bim/information/validate/route.test.ts`, `scripts/reference/inspect-bim-guideline-workbooks.mjs`, `scripts/reference/audit-bim-guideline-registry.ts`, `scripts/reference/audit-bim-bep-source.ts`, `package.json`.
- 자동 테스트: BIM 코어·BEP·API 3개 파일, 9개 테스트 통과. 전체 TypeScript typecheck 통과.
- 실데이터 검증: WBS/OBS 후보 2종은 각각 1,231개(OBS 229/WBS 1,002), 1,054개(OBS 167/WBS 887) 분류로 구조 검증을 통과했다. BEP HWP 456,192 bytes를 pyhwp로 메모리 내 추출해 16개 계약과 연결한 모든 제목을 확인했다. `docs/evidence/bim-guideline/bep-source-audit-260810.json` 참조.
- 원본 품질 격리: 7개 XLSX에서 수식 셀 3,016개 중 `#REF!` 등 오류 결과 2,288개를 발견했다. Pset 속성 202개에서 중복 ID 7개와 식별자로 사용할 수 없는 영문 키 8개도 확인했다. 이 항목들은 고치거나 추측하지 않고 자동 승격을 차단했다. `docs/evidence/bim-guideline/registry-audit-260810.json` 참조.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp4-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 원본 오류 행은 자료 소유자의 정정본 또는 승인된 명시 매핑 없이는 승격하지 않는다. Pset 수식 설명 19개를 실행 수식으로 번역·승인하는 작업은 아직 수행하지 않았다.
- 판정: complete
- 다음 작업: WP5에서 이 레지스트리를 IFC 객체·공간 계층·배치·Pset 값·분류·수량·좌표의 내보내기/재가져오기 의미 비교 게이트에 연결한다.

### WP5 실행 기록 — 2026-08-10

- 점검: 기존 IFC 의미 검사는 occurrence GUID·부모와 Pset/수량 컨테이너 서명까지만 비교했다. Pset 내부 실제 값, 객체별 분류, 수량 실제 값, 월드 배치 행렬을 완전 비교하지 않아 값 변조를 놓칠 수 있었다. 기존 IFC2X3 폐메시 exporter/importer와 공간 배치 해석기는 재사용 가능했다.
- 이미 구현되어 재사용한 것: IFC STEP 엔티티 파서, 공간 계층·local/grid/linear placement 해석, 폐메시 IFC exporter, 정확 표면 메시 importer, 기존 얕은 의미 왕복 API.
- 구현한 것: `nexyfab.ifc-deep-semantic-roundtrip.v1`에서 객체·계층·월드 변환·Pset 실제 값과 명시 단위·분류 참조·수량 값·ProjectedCRS/MapConversion을 독립 비교한다. 필수 증거가 원본에 없거나 placement가 미해결이어도 실패한다. WP4 레지스트리 인스턴스를 IFC occurrence에 결합해 타입·단위·필수 WBS/OBS가 실제 IFC에 있는지 확인한다. 자체 exporter는 BIM 입력 시 IFC4로 레지스트리 ID/버전·출처·Pset·분류·수량·CRS를 방출하며 미매핑 단위는 거부한다. 강화 기준을 클라이언트가 낮출 수 없는 심층 왕복 API도 추가했다.
- 수정 파일: `src/lib/bim/ifcDeepSemanticRoundtrip.ts`, `src/lib/bim/ifcDeepSemanticRoundtrip.test.ts`, `src/lib/bim/ifcRegistryBinding.ts`, `src/lib/bim/ifcRegistryBinding.test.ts`, `src/lib/brep-bridge/ifcExport.ts`, `src/lib/brep-bridge/ifcBimExport.test.ts`, `src/app/api/cad/v1/ifc/deep-roundtrip/route.ts`, `src/app/api/cad/v1/ifc/deep-roundtrip/route.test.ts`, `scripts/build-ifc-deep-roundtrip-evidence.ts`, `package.json`.
- 자동 테스트: IFC exporter/importer·공간·기존/심층 의미·API 회귀 9개 파일, 61개 테스트 통과. 전체 TypeScript typecheck 통과.
- 통합 검증: 자체 IFC4 export→import 증거에서 6 occurrence, 5 placement, 3 Pset/8 property value, 분류 1, 수량 1, 지리참조 2를 모두 보존했다. 재가져온 형상은 `exact_surface_mesh`였고 Pset 상태값 변조 음성 대조군은 `PROPERTY_SET_CHANGED`로 차단됐다. `docs/evidence/bim-guideline/ifc-deep-roundtrip-260810.json` 참조.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp5-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 제공 참고자료에서 원본 IFC 파일을 찾지 못해 독립 외부 IFC 홀드아웃 왕복은 아직 `not_run`이다. 자체 export/import 통합 검증을 외부 도구 상호운용성이나 상용 정확도 증거로 과장하지 않는다.
- 판정: complete
- 다음 작업: WP6에서 모델·도면·수량·BIM 품질·IFC 산출물을 하나의 버전 의존성 그래프로 연결하고 변경 시 stale 전파·재생성·검증을 원자적으로 수행한다.

### WP6 실행 기록 — 2026-08-10

- 점검: 기존 UnifiedProject는 객체 간 `follow`·`notify`·`locked` 영향과 영향받은 문서 ID를 계산하지만, 모델·도면·수량·BIM 품질·IFC 산출물의 실제 revision/hash·검증 증거·stale 상태는 저장하지 않았다.
- 이미 구현되어 재사용한 것: UnifiedProject 원자 트랜잭션, 객체 변경 영향 분석, topology reference 전파와 stale confirmation 차단 원칙.
- 구현한 것: `nexyfab.design-artifact-graph.v1`에 model·drawing·quantity·bim_quality·ifc·simulation 노드와 invalidate·notify·locked 의존성을 추가했다. 각 current 노드는 최신 상류 artifact의 ID/revision/content SHA-256에 정확히 바인딩되고 verifier/evidence SHA-256을 가져야 한다. 상류 변경은 모든 하류에 stale/review를 전파하며, 재생성은 의존 순서·최신 바인딩·검증 통과를 모두 만족할 때만 한 graph revision으로 원자 확정한다. 순환·stale graph revision·잠금·미검증 결과·잘못된 바인딩은 원본 graph를 보존한 채 실패한다.
- 수정 파일: `src/lib/ai/designArtifactGraph.ts`, `src/lib/ai/designArtifactGraph.test.ts`, `docs/ACTIVE_EXECUTION_MASTER.md`.
- 자동 테스트: 새 그래프 및 기존 UnifiedProject·서비스 개구부·건축/인테리어 연동 회귀 4개 파일, 13개 테스트 통과. 전체 TypeScript typecheck 통과.
- 검증: model revision 1→2 변경 시 drawing·quantity·bim_quality·ifc 네 산출물이 모두 stale 처리됐다. 이전 model binding 재생성은 거부됐고, drawing→quantity→quality→ifc 순서의 최신 hash/검증 증거 commit 후에만 releaseReady가 복구됐다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp6-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 실제 장기 실행 job queue와 영속 DB 연결은 아직 없다. WP7 작업공간 상태에 이 graph를 연결하고 WP9 운영 검증에서 worker resume·동시성·롤백을 검증한다.
- 판정: complete
- 다음 작업: WP7에서 일반 사용자의 AI 중심 편집과 전문가의 정밀 CAD 편집을 같은 project/artifact revision에 연결하고, 권위 입력·사용자 잠금값·수동 편집을 AI 재생성보다 우선 보존한다.

### WP7 실행 기록 — 2026-08-10

- 점검: 일반/전문가 선택기와 분야별 도구 목록, AI feature edit dispatcher, 수동 parameter 편집, 정밀 CAD handoff, UnifiedProject와 WP6 artifact graph를 교차 점검했다. 기존 UI는 선택과 안내는 제공했지만 AI가 사용자 수동값을 변경·삭제·전체 교체하기 전에 검사하는 강제 계약과 동일 revision 증명이 없었다.
- 이미 구현되어 재사용한 것: 5개 분야 프로필, guided/expert 도구 계층, 원자적 AI batch rollback, optimistic content revision, UnifiedProject, 검증된 분야 assembly handoff, WP6 산출물 의존성 graph.
- 구현한 것: `nexyfab.design-workspace-revision.v1`에 project/lineage/revision, AI·수동·정밀 CAD 작업 방식, human/expert/authority 잠금과 변경 이력을 정의했다. AI는 잠금을 해제하거나 잠긴 parameter·feature·assembly·권위 입력을 변경할 수 없고, stale base revision도 거부한다. 모델 commit과 도면·수량·BIM 품질·IFC stale 전파는 하나의 원자적 결과로 결합했다. 실제 feature dispatcher에 잠금 guard를 연결하고, 수동 feature parameter·base parameter·expression·feature tree 추가 시 프로젝트별 잠금을 자동 생성했다. 전체 모델 SCAD 편집도 보호값이 있으면 fail-closed 처리한다. UI는 AI 설계·수동 편집·정밀 CAD를 일반/전문가와 독립적으로 선택하며 같은 설계 이력임을 표시하고, 명시적 확인 후에만 잠금을 해제한다. 분야 handoff v2는 UnifiedProject ID/revision과 동일한 workspace revision을 요구한다.
- 수정 파일: `src/lib/ai/designWorkspaceRevision.ts`, `src/lib/ai/designWorkspaceRevision.test.ts`, `src/lib/ai/domainDesignHandoff.ts`, `src/lib/ai/domainDesignHandoff.test.ts`, `src/app/[lang]/shape-generator/ai/featureEditDispatcher.ts`, `src/app/[lang]/shape-generator/ai/featureEditDispatcher.test.ts`, `src/app/[lang]/shape-generator/ai/manualEditProtectionStore.ts`, `src/app/[lang]/shape-generator/ai/manualEditProtectionStore.test.tsx`, `src/app/[lang]/shape-generator/ai/AiAssistantShell.tsx`, `src/app/[lang]/shape-generator/_shell/domainWorkspaceStore.ts`, `src/app/[lang]/shape-generator/_shell/domainWorkspaceStore.test.tsx`, `src/app/[lang]/shape-generator/_shell/DomainWorkspaceBar.tsx`, `src/app/[lang]/shape-generator/_shell/DomainWorkspaceBar.test.tsx`, `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx`, `scripts/build-design-workspace-revision-evidence.ts`, `package.json`.
- 자동 테스트: 최종 WP7 핵심·dispatcher·브라우저 잠금 store·작업공간 UI·분야 handoff 6개 파일 37개 테스트 통과. 전체 TypeScript typecheck 통과.
- 통합 검증: `docs/evidence/workspace/design-workspace-revision-260810.json`에서 guided→expert precision 전환의 lineage/revision 보존, 전문가 승인 shaft 치수에 대한 AI 변경 차단, 모델과 artifact graph 원자 commit, drawing·quantity stale 전파를 확인했다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp7-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 브라우저 session 잠금은 런타임 보호 계층이며 서버 영속·다중 사용자 충돌 병합은 WP9 운영 검증에 남아 있다. 각 분야 전체 수동 도구의 독립 holdout 정확도는 WP9 전에는 상용 승인 근거가 아니다.
- 판정: complete
- 다음 작업: WP8에서 실제 B-Rep face identity·접촉 patch·체결 preload/접촉 조건·다물체 FEA 결과를 동일 revision 및 증거 hash에 묶고, mesh/상자 근사만으로 정밀 통과를 주장하지 못하게 한다.

### WP8 실행 기록 — 2026-08-10

- 점검: centroid 기반 접촉 후보, surface sampling penalty, augmented-Lagrange 단일 접촉, rigid-plane HEX8 contact, bolt preload/bolted-joint 공식, 단품 STL FEA, OCCT 정밀 충돌을 확인했다. 이 계산들은 각각 존재했으나 B-Rep face identity·접촉 patch·체결·다물체 해석·artifact revision을 한 증거 사슬로 결합하지 않았다.
- 이미 구현되어 재사용한 것: HEX8 요소 강성, contact 후보·penalty·augmented-Lagrange 계산, ISO 계열 bolt preload, OCCT persistent topology/정밀 충돌, WP6 model→simulation artifact stale/재생성 계약, WP7 workspace revision.
- 구현한 것: `nexyfab.contact-fea-evidence.v1`은 OCCT kernel/build hash, occurrence shape/transform hash, persistent face와 kernel entity, exact contact patch, friction 조건, fastener preload/proof load, boundary condition, contact pressure/normal force, bolt force/utilization, solver/mesh/load/result/evidence hash를 동일 workspace/model revision에 결합한다. face hash 불일치, bbox/preview mesh, 미수렴, 평형 잔차 1e-3 초과, 에너지 오차 5% 초과, contact/fastener 결과 누락, fixed→load 경로 단절은 fail-closed 처리한다. 검증된 결과만 stale simulation artifact를 최신 model binding으로 원자 승격한다. 새 structured HEX8 다물체 solver는 각 탄성체의 강성을 block 조립하고 matching-node normal contact active-set, preload, PCG, 요소 중심 von Mises 응력과 평형 잔차를 계산한다.
- 수정 파일: `src/lib/assembly/contactFeaEvidence.ts`, `src/lib/assembly/contactFeaEvidence.test.ts`, `src/app/[lang]/shape-generator/fea/multiBodyContactFea.ts`, `src/app/[lang]/shape-generator/fea/multiBodyContactFea.test.ts`, `scripts/build-multibody-contact-fea-evidence.ts`, `package.json`.
- 자동 테스트: 새 통합 계약·다물체 solver와 기존 contact·preload·bolted joint·정밀 interference·artifact graph 회귀 9개 파일 83개 테스트 통과. 전체 TypeScript typecheck 통과.
- 수치 검증: `docs/evidence/fea/multibody-contact-260810.json`의 2-body/2-element/48-DOF 결정론 fixture에서 M10-8.8 preload 23,038.5309 N와 외력 1,000 N이 4개 active contact node를 통해 전달됐다. 합 normal force는 24,038.5309 N, 평형 잔차비는 `1.5927017095950354e-16`, 최대 변위 0.0005106053 mm, 요소 중심 최대 von Mises 8.5 MPa이며 linear/active-set 모두 수렴했다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp8-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 새 solver는 small-strain linear elasticity, matching-node structured HEX8, frictionless normal penalty contact 범위다. 임의 비정합 곡면 mortar contact, 대변형·소성·마찰 접촉의 독립 복잡제품 검증은 아직 없다. 수치 fixture는 실제 solver 실행이지만 외부 독립 제품 holdout이나 인증 증거가 아니며 WP9에서 별도 판정한다.
- 판정: complete
- 다음 작업: WP9에서 기존 reference/holdout/운영 감사 자산을 재점검하고, 실제 실행 가능한 독립 증거만 technical private pilot 기준에 집계한다. 미충족 표본·서명·worker·성능 항목은 구현 여부와 별개로 명시적 not_run/blocked를 유지한다.

### WP9 실행 기록 — 2026-08-10

- 점검: 기존 CAD technical release audit v3, 5개 분야 정확도 캠페인, 복잡제품 holdout, 카나리·롤백·복원·성능 도구, API 제어, 커널 식별, 참고자료 매니페스트와 의존성 보안을 교차 점검했다. 기존 v3는 감사 파일 누락만 보고했고 5개 분야 증거를 기술 게이트에서 직접 요구하지 않았으며, 분야 검토자는 ID 문자열만 있어 신뢰 등록된 실제 검토자임을 증명하지 못했다.
- 이미 구현되어 재사용한 것: fail-closed audit v3, 5개 분야 95% 평가기, candidate/review/campaign 도구, 기술 카나리 정책, 백업 복원·롤백 검증기, 실제 WASM 커널 식별, CAD API 인증·쿼터 증거, Closed Beta 스냅샷과 참고자료 읽기 전용 매니페스트.
- 구현한 것: `nexyfab.technical-private-pilot-readiness.v1`에서 v3 감사와 5개 분야 판정을 하나로 결합하고 `verified`, `code_verified`, `dry_run`, `not_run`, `blocked`를 분리했다. 로컬 테스트나 dry-run은 표본 수가 많아도 public claim으로 승격되지 않는다. 현재 증거 파일을 SHA-256으로 결속하는 후보 생성 CLI와 v3 입력 파일을 추가했다. 기술·상용 게이트는 이제 `DOMAIN_ACCURACY_EVIDENCE_DIR`도 필수로 검사한다. 각 분야의 cases/runs 전체 바이트 해시, 90일 이내 승인 시각, 서로 다른 domain/independent reviewer, `NEXYFAB_DOMAIN_REVIEWER_KEYS`의 신뢰 공개키와 Ed25519 서명을 요구하며 변조·미등록·동일 검토자 서명은 거부한다. 감사 수치 타입도 실패 후보의 실제 nonzero diff를 표현하도록 수정했다.
- 보안 조정: `npm audit`에서 처음 발견한 18건(8 high)을 비강제 보안 패치와 제한된 override로 0건까지 제거했다. Next 16.3.0, Sharp 0.35.3, Sentry 10.69.0, Nodemailer 9.0.5, DOMPurify 3.4.13, fast-uri 3.1.5, nanoid 3.3.18, tmp 0.2.7, ExcelJS 하위 uuid 11.1.1, esbuild 0.28.2를 사용한다. ExcelJS는 원본 BIM XLSX 7개·161개 sheet를 다시 읽었고 Nodemailer는 `disableFileAccess`/`disableUrlAccess` 제한 transport 스모크를 통과했다. 제3자 고지 656개와 kernel stack identity도 최종 lockfile로 재생성·검증했다. `docs/evidence/release/dependency-security-audit-260810.json` 참조.
- 수정 파일: `src/lib/technicalPrivatePilotReadiness.ts`, `src/lib/technicalPrivatePilotReadiness.test.ts`, `src/lib/cad-technical-release-audit-v3.ts`, `src/lib/ai/domainAccuracyReleaseGate.ts`, `src/lib/ai/domainAccuracyReleaseGate.test.ts`, `scripts/build-technical-private-pilot-candidate.ts`, `scripts/technical-release-gate.ts`, `scripts/commercial-release-gate.ts`, `package.json`, `package-lock.json`, `src/content/third-party-notices.generated.json`, `docs/evidence/cad-independent/kernel-stack-identity.json`, `docs/evidence/cad-independent/cad-api-control-evidence.json`, `docs/evidence/release/*`.
- 자동 테스트: 준비도·감사·서명 게이트 11개 테스트, 서버 생성 상태 7개, 보안·카나리·감사 관련 25개, 복원·롤백 4개를 통과했다. 보안 업데이트 후 공통 분야 테스트 56개+Node 7개, 기계 38개, 건축 62개, 토목 70개, 조경 57개, 인테리어 61개를 재실행해 모두 통과했다. 전체 TypeScript typecheck와 Next.js 16.3.0 프로덕션 빌드도 통과했다.
- 빌드·성능: 634개 정적 페이지를 생성했다. shared/worst first-paint는 721.4 KB로 763.3 KB 예산 이내다. 첫 10분 실행은 전체 제한 때문에 내부 타입 단계에서 중단됐고, 20분 제한 재실행은 226초에 전 구간 통과했다.
- 실데이터 검증: 참고자료 매니페스트 6,914 artifact/467 lineage가 현재 원본과 일치하고 source write 0 정책을 유지했다. 현재 로컬 후보 보고서는 Closed Beta와 reference corpus만 `verified`, 7개 CAD 기능은 `code_verified`/0 approved independent sample, 5개 분야는 signed approved campaign 0/5로 기록한다. `docs/evidence/release/technical-private-pilot-candidate-260810.json`과 `cad-technical-release-audit-v3-candidate-260810.json` 참조.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp9-security-final.json`을 commercial-v1 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 실제 운영 Redis 다중 인스턴스 CAS/resume, staging rollback·restore·alert delivery·production-like load/canary 영수증, 7개 필수 기능의 승인된 독립 holdout(각 10~30개), 5개 분야의 실제 권리 확인 사례 20개 이상·서로 다른 신뢰 검토자 2명 서명·3 campaign×5 repeat가 없다. 비정합 곡면·대변형·소성·마찰 접촉과 외부 독립 IFC 상호운용 검증도 미실행이다. 결제·법무는 명시적으로 deferred다.
- 판정: adjust. 로컬에서 구현·보안 패치·검증 가능한 항목은 완료했지만 WP9 완료 기준인 실제 독립 승인·운영 영수증은 로컬 코드로 생성할 수 없으므로 releaseReady=false와 BLOCKED를 유지한다. 면책문구나 “전문가 확인 필요” 표시는 이 기술 증거를 대체하지 않는다.
- 다음 작업: 실제 staging/운영 환경과 신뢰 검토자가 준비되면 5개 분야 holdout 승인·서명 → 3×5 campaign → 기능별 v3 matrix → Redis resume/복원/롤백/카나리/부하 영수증 순으로 입력하고 `npm run technical:pilot-candidate`와 `npm run technical:release-gate`를 다시 실행한다.

### WP10 실행 기록 — 2026-08-10

- 점검: 간편 설계와 정밀 CAD의 진입·복귀 링크, 5개 분야 선택 상태, 일반/전문가와 AI/수동/정밀 CAD 모드, 생성·검증·출력 탭, 모바일 레이아웃, 접근성 트리를 코드와 실제 브라우저에서 대조했다. 기존 `mode=expert` 링크가 서버의 `expert=1` 게이트를 통과하지 못하고 분야도 전달하지 않는 문제, 인테리어 화면에 기계·조경·토목 시작 문구와 `AI 제품/DFM` 표현이 노출되는 문제를 확인했다.
- 이미 구현되어 재사용한 것: 5개 분야 프로필·템플릿·검증기·산출물 목록, 동일 revision 수동값 보호, 분야 handoff, 정밀 CAD shell, 실제 B-rep/도면/STEP 흐름.
- 구현한 것: 모든 분야에 `요구사항 → AI 구현 → 수동 조정(선택) → 정밀 검증 → 도면·산출물`의 공통 사용자 여정을 추가하고, 정밀 입력·검증·산출물과 시작 예시는 분야별로 분리했다. 간편 설계의 4개 작업 버튼은 현재 상태를 접근성 속성으로 노출한다. AI 결과 후 수동 수정과 선택적 정밀 CAD 진입을 명시하고, 딥링크에 `expert=1`, 분야, 사용자 수준, 작업 방식, 3D 편집 진입점을 함께 전달한다. 정밀 CAD는 URL 맥락을 session workspace에 복원하며 `/kr` 언어 경로를 보존한다. 상단 CAD 흐름도 기계의 제품/DFM 표현을 건축·토목·조경·인테리어에 재사용하지 않고 선택 분야의 범위와 형상·분야 검증 문구를 사용한다. 760px 이하에서는 제어판과 3D 뷰를 1열로 전환한다.
- 수정 파일: `src/lib/ai/domainUserJourney.ts`, `src/lib/ai/domainUserJourney.test.ts`, `src/app/[lang]/nexyfab/design/DesignInner.tsx`, `src/app/[lang]/nexyfab/design/DesignInner.module.css`, `src/app/[lang]/nexyfab/design/AssemblyPresetPanel.tsx`, `src/app/[lang]/shape-generator/_shell/DomainWorkspaceBar.tsx`, `src/app/[lang]/shape-generator/_shell/DomainWorkspaceBar.test.tsx`, `src/app/[lang]/shape-generator/_shell/CadWorkflowRail.tsx`, `src/app/[lang]/shape-generator/_shell/CadWorkflowRail.test.tsx`, `src/app/[lang]/shape-generator/_shell/ModelerShell.tsx`, `src/app/[lang]/studio/StudioInner.tsx`, `src/app/[lang]/sheetmetal/page.tsx`, `docs/ACTIVE_EXECUTION_MASTER.md`.
- 자동 테스트: 분야 여정·workspace 상태 복원·CAD 흐름 UI 3개 파일의 10개 테스트를 통과했다. 전체 TypeScript typecheck를 통과했다. 변경 범위 ESLint는 오류 0이며 기존 hook dependency 경고 2개만 보고했다.
- 브라우저 검증: 실제 production standalone 화면에서 인테리어 간편 설계의 5단계·정밀 입력·검증·산출물·수동/정밀 CAD CTA를 접근성 트리로 확인했다. 정밀 CAD 링크가 redirect되지 않고 열렸으며 `interior`, `expert`, `precision_cad`가 복원되고 데스크톱 편집 shell이 표시됐다. 일반 사용자의 모바일 정밀 CAD는 기존 정책대로 보기 전용과 PC 전송 안내를 표시한다.
- 빌드·성능: Next.js 16.3.0 프로덕션 빌드가 527.4초에 성공했고 정적 페이지 634/634를 생성했다. shared/worst first-paint 721.4 KB로 763.3 KB 예산 이내다.
- Closed Beta 무결성: 빌드 후 `validation-reports/closed-beta-integrity-260810-active-master-wp10-uiux-postbuild-final.json`을 WP9 security 기준선과 비교했다. 17개 보호 테이블, 13개 보호 행, 15개 보호 파일, 15,429,420 bytes에서 차이 0이다.
- 남은 not_run/한계: 실제 신규 일반 사용자와 각 분야 실무자를 대상으로 한 과업 성공률·완료시간·오류 회복 사용성 시험은 아직 `not_run`이다. 분야 프로필에 표시된 모든 전문가 도구가 실제 명령으로 연결된 것은 아니며, 5개 분야의 상용 정확도·독립 검토와 운영 증거는 계속 WP9의 release blocker다. 모바일은 간편 설계 중심이며 정밀 CAD 직접 편집은 PC 정책을 유지한다.
- 판정: complete. 이번 WP의 로컬 UI·라우팅·반응형·접근성·빌드·데이터 보존 기준은 통과했다. 이는 WP9의 기술 출시 승인이나 외부 사용자 사용성 증거를 대신하지 않는다.
- 다음 작업: WP9의 실제 분야별 사용자 과업 시험과 승인된 독립 holdout을 함께 수집해, UI 과업 실패와 설계 정확도 실패를 분리 측정한다.

### WP11 실행 기록 — 2026-08-10

- 점검: 기존 bundle budget이 Pages Router `build-manifest`만 집계해 App Router 155개 route를 사실상 보지 못하는 문제, 전역 reCAPTCHA 약 0.33 MiB, 간편 설계의 숨겨진 대형 panel 정적 import, 모바일 보기 전용에서도 exact kernel을 예약하던 경로, 운영 RUM 부재를 확인했다.
- 이미 구현되어 재사용한 것: Next standalone 배포, content-hashed 정적 asset, bounded WASM cache, 기존 CSP·rate limit·감사 저장소, 정밀 CAD kernel-of-record와 전문가 진입 게이트를 유지했다.
- 구현한 것: App Router client-reference manifest 기반 route별 JS/CSS 측정기와 필수 route 예산, 제출 시점 reCAPTCHA singleton loader, 간편 설계 탭/도구 dynamic import와 visited-tab 상태 보존, 모바일 exact WASM 억제·데스크톱 exact 기본 활성화, production Chromium 런타임 감사, 개인정보 최소화 RUM 수집기/API를 추가했다.
- 수정 파일: `scripts/app-route-bundle-manifest.mjs`, `scripts/app-route-bundle-manifest.test.mjs`, `scripts/bundle-budget.mjs`, `scripts/bundle-budget.json`, `scripts/verify-wp11-runtime-performance.mjs`, `src/lib/recaptcha-client.ts`, `src/lib/recaptcha-client.test.ts`, `src/lib/webVitals.ts`, `src/lib/webVitals.test.ts`, `src/components/WebVitalsReporter.tsx`, `src/app/api/observability/web-vitals/route.ts`, `src/app/api/observability/web-vitals/route.test.ts`, `src/app/[lang]/layout.tsx`, 5개 보호 폼 page, `src/app/[lang]/nexyfab/design/DesignInner.tsx`, `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx`, `package.json`, `playwright.config.ts`, 실행계획 문서.
- 자동 테스트: App Router manifest Node 테스트 2/2, reCAPTCHA·분야 여정·CAD shell 13/13, RUM 개인정보/API 7/7, 전체 TypeScript typecheck와 변경 범위 ESLint 오류 0을 통과했다. 기존 대형 CAD 파일의 미사용 항목/훅 경고 5개는 별도 정리 대상으로 남겼다.
- 브라우저·성능: `validation-reports/wp11-runtime-performance-260810.json`의 모든 회귀 검사가 통과했다. 랜딩 623,080 bytes, 간편 설계 890,920 bytes, 모바일 shell 1,630,149 bytes, 데스크톱 exact 6,850,023 bytes다. 초기 reCAPTCHA 0, 모바일 exact WASM 0, 데스크톱 Replicad WASM 1회이며 heap은 각각 약 7.6/10.0/21.2/48.5 MB로 예산 이내다.
- 빌드: Next.js 16.3.0 production build가 635/635 정적 페이지와 RUM API route를 생성했다. 155개 App Router entry를 측정했고 shared 721.6 KB, worst first-paint 2,060.5 KB 및 필수 route별 예산을 통과했다. 전체 빌드가 8~10분이므로 후속 개발에서는 빠른 검증과 정식 release build를 분리하되 최종 gate에서는 전체 빌드를 유지한다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp11-performance-pre.json`과 `...-post.json`을 비교했다. 17개 보호 테이블/13행, 15개 보호 파일/15,429,420 bytes에서 `differences: []`다.
- 남은 not_run/한계: 실제 staging/production의 Brotli/CDN 응답, mobile p75 LCP/INP/CLS, 대표 복잡제품 long-task·worker·취소·메모리 회수 운영 표본은 아직 `not_run`이다. 로컬 HTTP 감사에서 CSP의 `upgrade-insecure-requests`가 auth background 요청을 HTTPS로 바꿔 실패한 것은 production HTTPS에서는 재현 조건이 다르므로 staging에서 별도 확인한다.
- 판정: local_complete_external_rum_pending. 로컬 구현·예산·브라우저·빌드·데이터 보존은 통과했지만 운영 RUM 수치를 만들어 통과한 것으로 간주하지 않는다.
- 다음 작업: WP12에서 전체 API·asset·worker route security matrix를 생성하고 shadow gate의 실제 차단 후보를 검증한 뒤, Closed Beta 흐름을 보존하는 순서로 enforce 범위를 조정한다.

### WP12 실행 기록 — 2026-08-10

- 점검: Next 16에서 실제 실행되는 `src/proxy.ts`, 543개 route 파일, 751개 handler, 인증 세션 재검증, 파일 저장·다운로드, OpenSCAD/OCCT 작업, AI tool protocol, CSP/CORS, lockfile·SBOM·비밀 스캔, 복구 도구를 교차 점검했다. 신규 partner/quick-quote 업로드의 public URL, token 발급 후 계정 삭제·잠금·권한 변경 반영 지연, 임의 SCAD include/import, AI `import_doc_ref`의 모델 제어 URL/로컬 경로, 전역의 예측 가능한 OCCT handle, production CSP의 일반 `unsafe-eval`, 로컬 전용 critical rate limit을 발견했다.
- 구현한 것: production 기본 enforce 프록시에 cookie-origin/크기/속도/CAD API 경계를 결합하고 route security matrix를 생성했다. partner 계약과 quick-quote 인증 파일은 private storage+소유자 ACL stream/signed redirect로 전환했으며 기존 Beta key는 읽기 호환만 유지했다. 인증 token은 매 요청 DB의 삭제·잠금·role/org/plan을 재확인하고 logout/account deletion cookie를 일괄 제거한다. 중요 인증·관리자·AI 경로 rate limit은 Redis 지원 비동기 경계로 이동했다. ZIP admission, OpenSCAD allowlist와 production network-none Docker, 사용자별 BREP 대기열·취소·Redis pending index를 추가했다.
- AI 설계 보안: tool envelope 110KB/30-call/깊이/객체/ID/prototype-key 제한, 실제 executor own-property allowlist, SCAD write/diff/module/composition 저장 전 실행 정책, 사용자별 HMAC 서명 session, session 밖 `occt:*` handle 거부, untrusted prompt/tool-result 지침을 강제했다. 공용 doc-ref adapter는 SSRF·local-file read 방지를 위해 fail-closed 처리했으며, 이후 request-scoped private file ID+owner adapter가 준비될 때만 재활성화한다.
- 웹·공급망: production에서 일반 `'unsafe-eval'`을 제거하고 `'wasm-unsafe-eval'`만 유지했다. `object-src 'none'`, base/form/manifest 제한과 CSP/CORS env header-injection 방지를 추가했다. `npm audit` 0건, CycloneDX 1.5 SBOM 1,005 components/1,006 dependencies, dependency/lock/kernel/notices 5개 artifact 결속, 6,634파일·77,697,417 bytes secret scan 0건을 증거화했다. 별도 SCAD session secret preflight와 실제 rotation/restore 영수증 체크리스트를 추가했다.
- 자동 검증: 통합 Vitest 82파일에서 992개 통과, 외부 live AI 1개만 조건부 skip; Node 보안/복구/Closed Beta 테스트 13개 통과; CSP/CORS 29개 통과; 전체 typecheck와 변경 범위 ESLint 오류 0. route matrix는 543/751, unknown 0, gaps 0이고 CAD API control은 58/58 issues 0이다.
- production 빌드: Next.js 16.3.0 build가 707.4초에 성공하고 635/635 정적 페이지를 생성했다. 155 App Router entry의 shared 721.6KB/793.8KB, worst first-paint 2,060.5KB/2,266.6KB로 bundle budget을 통과했다. 로컬 build에는 `REDIS_URL`이 없어 in-memory fallback 경고가 있었고 production preflight는 Redis를 필수로 유지한다.
- Closed Beta 무결성: WP11 post→WP12 prebuild, WP12 prebuild→postbuild, WP11 post→WP12 postbuild 세 비교가 모두 `differences: []`다. 보호 범위는 17개 테이블/13행, 15개 파일/15,429,420 bytes다.
- 남은 not_run/한계: 실제 staging/production header 응답, Redis 다중 instance, DAST/수동 침투, credential rotation, 암호화 backup restore, canary enforce 영수증은 외부 증거 대기다. 모든 STEP/IFC/DWG/LandXML parser를 API process 밖의 CPU/memory 제한 worker로 옮긴 것은 아니며 malware scan과 geometry admission의 완전한 이중 상태도 남아 있다. doc-ref는 안전한 소유자 adapter가 생기기 전까지 비활성이다. CSP의 `'unsafe-inline'`은 Next bootstrap nonce 전환 전의 잔여 위험이다.
- 판정: `local_complete_external_evidence_and_parser_isolation_pending`. 로컬 상용 보안 기반은 크게 강화됐지만 위 외부 영수증과 잔여 parser 격리를 근거 없이 PASS로 만들지 않는다.
- 다음 작업: WP13 공통 정밀 CAD 코어에서 기존 WP4~WP8 revision/lock/artifact/topology 계약을 재사용해 실제 server-persistent revision, stable reference 재생성, exact import/healing/export 증거의 현재 격차부터 점검한다.

### WP13 실행 기록 — 2026-08-10

- 점검: WP4~WP8의 workspace lock, artifact stale graph, stable topology, import/healing과 exact kernel 계약을 다시 대조했다. 기존 기능은 브라우저 상태와 개별 엔진에는 있었지만 요구사항·분야 의미 문서·정확 B-Rep·관계·잠금·산출물 graph·provenance·kernel identity 전체를 한 서버 리비전으로 영속하는 공통 경계가 없었다.
- 구현: `nexyfab.cad-workspace-envelope.v1`과 `/api/nexyfab/projects/[id]/cad-revisions`를 추가했다. envelope은 실제 payload SHA-256, 분야별 허용 semantic schema, workspace/artifact 동일 revision, exact B-Rep와 real WASM/no-stub identity를 결속한다. 서버는 append-only revision과 CAS head transaction을 사용하고 stale writer에는 최대 100개 field/object diff를 반환한다. 인증·프로젝트 ACL·editor 권한·Origin·2.2MB 제한·감사를 적용했다.
- topology/실패 안전: `nexyfab.cad-regeneration-gate.v1`은 persistent reference만 자동 커밋하고 derived reference는 정확한 이전 ref에 대한 사용자 확인을 요구한다. ambiguous/broken은 `reference_lost`, 커널 실패는 `kernel_failed`로 처리하며 두 경우 모두 candidate geometry hash를 저장 계층에 노출하지 않고 마지막 정상 revision을 보존한다.
- DB/공통 분야: SQLite와 PostgreSQL 정식 schema에 immutable revisions/CAS heads를 추가했다. 기계·건축·토목·조경·인테리어 5개 adapter가 같은 envelope, `.nfab`, guided/expert 도구 계층, 외부 CAD 불필요 verified import 경로를 공유하되 semantic schema와 분야 검증은 분리됨을 계약 테스트로 확인했다.
- 검증: 공통 revision·API·workspace/artifact·topology·5개 분야 계약 10개 파일 47개 테스트와 실제 in-memory SQLite 정식 migration/round-trip 및 Postgres schema drift 9개 테스트가 통과했다. 전체 typecheck, 변경 범위 ESLint 오류 0, route matrix 544파일/753 handler/unknown 0/gap 0, CAD API controls 58/58 issues 0이다.
- 문서/참고자료 감사: 제품/계획/7.3 참고 Markdown 266개, 3,651,080 bytes를 해시·제목·상태 marker·상대 링크 기준으로 전수 인덱싱했다. 깨진 저장소 링크를 정리해 missing local Markdown link 0으로 만들었다. CAD 매뉴얼 20개/요구사항 16개 trace와 전체 참고자료 manifest 6,914 artifact/467 lineage 검증도 통과했다.
- 신규 후속 업무: BIM BEP 16개 요구사항은 원본 HWP에서 모두 추적됐지만 지침 XLSX 7개/161 sheet의 registry 승격은 원본 수식 오류 2,288셀, 중복 Pset ID 7개, 구조 검증 이슈 8개 때문에 blocked다. WP15에서 source-owner correction 또는 승인된 disambiguation mapping 전에는 권위 Pset으로 사용하지 않는다.
- Closed Beta 무결성: WP12 postbuild와 `validation-reports/closed-beta-integrity-260810-active-master-wp13-common-cad.json` 비교 결과 17개 보호 테이블/13행, 15개 보호 파일/15,429,420 bytes에서 `differences: []`다.
- 남은 한계: 실제 운영 PostgreSQL 배포·다중 인스턴스 동시 writer·브라우저 AI→수동→전문가→서버 저장 장기 E2E는 아직 외부/운영 증거가 없다. WP11의 viewer-only no-WASM 결과와 WP12 보안 잔여도 WP20에서 재검증한다.
- 판정: `complete_local`. 공통 코어의 로컬 구현·실DB SQLite·계약 검증은 완료했으며 운영 증거를 허위 PASS로 올리지 않는다.
- 다음 작업: WP14 기계 정밀 CAD에서 선정 제품 범위의 부품·조립·공차·제조·도면·STEP 종단 흐름을 기존 구현과 독립 정확도 증거 기준으로 재점검하고 실제 누락만 구현한다.

### WP14 실행 기록 — 2026-08-10

- 점검: 기계 관련 구현 2,338개 파일과 부품·조립·운동·BOM·도면·GD&T·판금·STEP·FEA 경로를 재분류했다. 기존 기계 회귀는 실제 STEP export/import와 XCAF 조립 트리를 포함해 38/38 통과했지만, 기존 dry-run은 과거 14축 상태와 현재 24축 profile이 섞여 있어 최신 근거로 사용할 수 없었다.
- 구현: `nexyfab.mechanical-release-certificate.v1`을 추가해 공통 workspace envelope와 부품·복합제품·조립·운동·제조 G0~G9·공차·도면 증거를 동일 workspace revision/model hash/payload SHA-256에 결속했다. 24개 필수 축 중 누락은 `not_run`, detached/tampered 증거는 `fail`, model/drawing/BOM artifact가 stale이면 `output_consistency=fail`로 처리한다. 기존 domain assertion adapter와 표준 기계 회귀 명령에도 결합했다.
- 결함 발견과 조정: 최초 24축 300회 드릴에서 `machine_line`의 15회 STEP 왕복이 모두 `Maximum call stack size exceeded`로 실패했다. 안전펜스 반복문의 잘못된 배열 구조분해가 `ty`에 배열을 넣어 STEP에 `NAN` 좌표 100개를 방출한 것이 원인이었다. 유한 좌표를 사용하도록 수정하고 실제 OCCT STEP 재임포트 회귀를 추가했다. 제조 feature가 명시적으로 `not applicable`일 때 모순된 count failure 문구를 만들던 G6도 정리했다.
- 검증: 표준 기계 정확도 명령은 9파일/48개 테스트를 통과했다. 여기에는 실제 STEP 생성·재임포트, body count, hole/feature, XCAF NAUO tree, machine-line 비유한 좌표 음성 회귀와 24축 인증서 fail-closed 계약이 포함된다. 새 인증서·adapter·제조 gate 묶음 16/16, 전체 TypeScript typecheck, 변경 범위 ESLint 오류 0도 통과했다.
- 24축 dry-run v3: 20개 내부 템플릿×3 campaign×5 repeat=300/300 required gate PASS, STEP roundtrip 300/300, evidence integrity issue 0, falseVerified/falseClear/destructive merge 0이다. 도구체인 자체 14/14 검사는 통과했지만 내부 템플릿 promotion은 0건이고 report는 의도대로 `eligible=false`다. v2 실패 폴더는 삭제하지 않고 결함 이력으로 `SUPERSEDED` 표시했다.
- Closed Beta 무결성: WP13 기준선과 `validation-reports/closed-beta-integrity-260810-active-master-wp14-mechanical.json` 비교 결과 17개 보호 테이블/13행, 15개 보호 파일/15,429,420 bytes에서 `differences: []`다.
- 남은 한계: 독립 20제품, 실제 검토자 2인, 제조 도면/PDF/BOM 현업 승인, 외부 holdout에 대한 24축 ≥95% 증거는 아직 없다. 자유곡면 Class-A, 고급 비선형 해석과 전 CAM도 제한 범위다. 이 항목은 허위 PASS로 올리지 않고 WP9/WP20 출시 차단기로 유지한다.
- 판정: `complete_local_independent_accuracy_pending`. 로컬 구현·음성 회귀·실제 STEP 왕복·fail-closed 릴리스 경계는 완료했으며 독립 상용 정확도 인증은 별도다.
- 다음 작업: WP15 건축 정밀 CAD/BIM에서 현재 구현된 의미 모델·host/opening·IFC·도면·스케줄 경로를 재사용하고, 원본 BIM registry의 2,288 수식 오류·7개 중복 Pset·8개 구조 이슈를 권위 데이터로 승격하지 않는 입력 격리부터 수행한다.

### WP15 실행 기록 — 2026-08-10

- 점검: 건축 구조·개구부·정확 STEP 기존 suite 7파일/62개와 architecture semantic/host/opening/IFC/registry 묶음 15파일/76개가 통과했다. 공간 폐합·곡선 경계·opening host 범위/중첩/수직 적합, service opening B-Rep cut, IFC Pset/classification/quantity/CRS 심층 왕복 구현을 재사용했다.
- 구현: `nexyfab.building-release-certificate.v1`을 추가해 공통 workspace revision/model hash에 site coordinate, architecture topology, cross-domain egress/MEP, accessibility, envelope, IFC deep roundtrip, drawing/schedule/quantity, repair와 registry 사용 정책을 결속했다. 20축 누락은 `not_run`, detached hash/revision은 `fail`, stale model/drawing/quantity/IFC는 release 차단이다.
- registry 격리: BIM 지침 원본의 수식 오류 2,288셀·중복 Pset 7개·구조 이슈 8개는 수정하거나 권위 데이터로 승격하지 않았다. `quarantined + usedForRelease=false`만 허용하며 이를 release에 사용하면 provenance가 실패한다. 향후 source-owner correction 또는 승인된 disambiguation mapping 없이는 approved로 바뀌지 않는다.
- 검증: 보강 후 표준 건축 정확도 suite는 16파일/99테스트, 전체 TypeScript, 변경 범위 ESLint를 통과했다. 자체 IFC deep roundtrip 증거는 occurrences 6, placements 5, Psets 3/values 8, classification 1, quantity 1, georeference 2를 보존해 releaseReady=true다.
- 참고 IFC 진실표: 지정 `참고파일들`의 3개 IFC native 추출은 3/3 성공, 1,690 물리 객체 import와 exact display coverage는 100%다. 하지만 exact volume coverage는 42.781%, open surface mesh 967개이며 그중 wall/slab/column/beam/roof 등 release-critical 객체가 108개라 외부 IFC를 제조급 closed solid로 승격하는 경로는 `releaseReady=false`다. display/coordination과 exact solid 주장을 분리한다.
- 20축 dry-run v2: 내부 템플릿 20개×15반복=300/300 gate PASS, evidence integrity/false 계열 0, 도구체인 14/14다. promotion은 0이고 `eligible=false`라 독립 인증이 아니다.
- Closed Beta 무결성: WP14 기준선과 `validation-reports/closed-beta-integrity-260810-active-master-wp15-building.json` 비교 결과 17개 보호 테이블/13행, 15개 보호 파일/15,429,420 bytes에서 `differences: []`다.
- 판정: `complete_local_independent_accuracy_and_external_ifc_solidity_pending`. 자체 생성 exact BIM/IFC와 20축 fail-closed 경계는 로컬 완료했지만 독립 20프로젝트/2검토자, 외부 IFC host solid closure, 현업 도면·수량 승인은 WP9/WP20 차단기다.
- 다음 작업: WP16 토목에서 CRS/datum·survey·TIN·선형·종단·횡단·corridor·drainage·LandXML의 기존 구현과 실제 누락을 같은 리비전 결속 기준으로 점검한다.

### WP16 실행 기록 — 2026-08-10

- 점검: 토목 기존 suite 4파일/70개와 civil document·drainage·LandXML 추가 7파일/34개 통과를 확인했다. CivilDocument는 EPSG/horizontal·vertical datum, source evidence, survey control, TIN/breakline, line/arc/spiral alignment, profile, cross-section, corridor, drainage, structure와 stage cycle을 fail-closed 검증한다.
- 결함과 구현: LandXML exporter가 clothoid `<Spiral>`을 방출하지만 importer는 이를 unsupported로 버리고, exporter가 생략하는 기본 Curve `crvType`을 importer가 필수로 요구하는 비대칭을 발견했다. Line/Curve/Clothoid exact elements에 길이·반경·회전·PI·단위를 보존하고, legacy ips/curves 투영 불가를 별도 issue로 분리했다. 실제 참고 샘플의 중첩 경로도 suite에 연결했다.
- 릴리스 경계: `nexyfab.civil-release-certificate.v1`이 22축 CRS/단위·survey·surface·alignment·profile·section·corridor·earthwork·drainage·stage·structure·IFC/LandXML·drawing·quantity·repair 증거를 workspace revision/model/payload hash에 결속한다. 누락은 `not_run`, 변조/비유한/깨진 TIN은 `fail`, stale artifact는 output 차단이다.
- 검증: 최종 토목 suite 8파일/81테스트, 전체 typecheck와 변경 범위 lint가 통과했다. 내부 20케이스×15반복 300/300 gate, evidence integrity/false 계열 0, 도구체인 14/14이며 promotion 0/eligible=false다.
- Closed Beta: WP15 대비 `validation-reports/closed-beta-integrity-260810-active-master-wp16-civil.json`에서 17테이블/13행, 15파일/15,429,420 bytes, 차이 0이다.
- 판정: `complete_local_independent_accuracy_and_production_adapter_pending`. CSV PNEZD/DEM/point-cloud production adapter, 대규모 TIN/corridor 성능, 독립 20사례/2검토자는 WP20 차단기로 남긴다.
- 다음 작업: WP17 조경이 토목 authoritative terrain revision/CRS를 복제하지 않고 참조하도록 grading·flow·planting·soil·hardscape·irrigation·schedule 경계를 점검한다.

### WP17 실행 기록 — 2026-08-10

- 점검: 기존 조경 suite 4파일/57테스트가 통과했고, `LandscapeDocument`가 식재 provenance·토양 volume·포장·관수 capacity·표면 배수·유지관리 access를 검증하며 연합 validator가 토목 지형 document/surface/revision/coordinate-system과 명시적 `FOLLOWS_TERRAIN` 관계를 fail-closed 처리함을 확인했다. 릴리스 시 이 권위 지형과 도면·스케줄·수량을 같은 workspace revision으로 결속하는 경계가 누락돼 있었다.
- 구현: `nexyfab.landscape-release-certificate.v1`을 추가했다. 20개 필수 축에 토목 문서 해시·표면 해시·civil revision·EPSG·horizontal/vertical datum, grading·surface flow·mature clearance·irrigation·drawing/schedule/quantity·repair 증거를 exact workspace revision/model hash/payload SHA-256으로 결속했다. 지형 불일치·변조·stale 산출물은 `fail`, 미제공 검증은 `not_run`이다.
- 검증: 보강된 표준 조경 suite는 8파일/71테스트를 통과했다. stale civil revision, 누락 관수 증거, stale drawing의 음성 회귀를 포함하며 전체 typecheck와 변경 파일 lint도 통과했다. 내부 20케이스×15반복은 300/300 gate, evidence integrity issue 0, 도구체인 14/14를 통과했지만 promotion 0/`eligible=false`다.
- Closed Beta: WP16 대비 `validation-reports/closed-beta-integrity-260810-active-master-wp17-landscape.json`에서 17테이블/13행, 15파일/15,429,420 bytes, `differences: []`다.
- 판정: `complete_local_independent_accuracy_pending`. 외부 현장 20사례/2검토자, 실제 survey/soil/nursery 자료와 유지관리·관수/배수 현업 승인은 WP20 차단기로 남긴다.
- 다음 작업: WP18 인테리어가 건축 host revision을 권위 원본으로 참조하고 실측·공간·동선·문 스윙·가구 여유·천장/MEP·마감·밀워크·조명·음향·도면/BOQ를 같은 리비전으로 결속하는지 점검한다.

### WP18 실행 기록 — 2026-08-10

- 점검: 공간·host·opening, exact polygon route, 회전 가구 clearance, door swing, egress, ceiling/MEP, IES 조명, 마감·밀워크·음향과 2-track 독립 정확도 구현을 확인했다. `fieldMeasurement.architectureRevision`은 저장됐지만 연합 validator가 현재 건축 revision과 비교하지 않아 오래된 현장 실측을 허용하는 결함을 발견했다.
- 조정/구현: 연합 validator에 건축-인테리어 coordinate system 일치와 field measurement host revision 일치를 추가했다. `nexyfab.interior-release-certificate.v1`은 25축 host document payload/hash/revision, 실측, 공간 폐합·host/opening, 동선·문·피난·접근성·가구 여유, 천장/MEP, 마감·밀워크·조명·음향, IFC·도면·schedule·quantity·repair를 exact workspace revision/model hash에 결속한다.
- 검증: 표준 인테리어 suite 12파일/83테스트, 전체 typecheck와 변경 범위 lint를 통과했다. stale field measurement, 누락 photometric evidence와 stale IFC 산출물의 음성 회귀를 포함한다. 내부 20케이스×15반복은 300/300 gate, integrity issue 0, 도구체인 14/14이며 promotion 0/`eligible=false`다.
- Closed Beta: WP17 대비 `validation-reports/closed-beta-integrity-260810-active-master-wp18-interior.json`에서 17테이블/13행, 15파일/15,429,420 bytes, `differences: []`다.
- 판정: `complete_local_independent_accuracy_pending`. 외부 현장 20사례/2검토자, 실제 scan/실측·IES·MEP·마감/밀워크 제작도 승인과 IFC 현업 왕복은 WP20 차단기로 남긴다.
- 다음 작업: WP19에서 5개 분야 문서의 좌표·source revision·artifact dependency·권한을 보존하며 연합 변경, 충돌, 수량, 복구와 복잡 프로젝트 성능을 검증한다.

### WP19 실행 기록 — 2026-08-10

- 점검/결함: unified project는 global object ID, coordinate tree, cross-domain reference와 atomic revision transaction을 제공했지만 편집이 선언한 `changedObjectIds`가 실제 대상 문서 소유인지 확인하지 않았다. 또 change impact가 큐의 각 객체마다 전체 reference를 재검색해 대형 연합 모델에서 O(V×E) 병목이 될 수 있었다.
- 구현/조정: 단일·batch transaction 모두 문서-객체 소유권 불일치를 원본 무변경으로 차단했다. 영향 분석은 양방향 adjacency index를 한 번 만들고 O(V+E)로 순회하도록 변경했다. `nexyfab.federated-project-release-certificate.v1`은 프로젝트 payload hash/revision, deep profile schema, 좌표 변환, 5개 분야별 release certificate/document hash/revision, reference pinning, 변경 전파, 충돌, 수량, 권한 격리, 복구/성능을 10개 fail-closed gate로 묶는다.
- 검증: 연합·service opening·architecture/interior·assembly adapter 전체 7파일/27테스트와 typecheck/lint가 통과했다. 추가 20,000-reference follow chain은 20,000개 전파/20,000개 reference 추적을 26ms에 완료했고, 연합 certificate 음성/양성 회귀와 합쳐 2파일/9테스트가 통과했다. 이는 로컬 합성 구조 성능이며 실제 대형 파일 load/save 메모리 증거가 아니다.
- Closed Beta: WP18 대비 `validation-reports/closed-beta-integrity-260810-active-master-wp19-federation.json`에서 17테이블/13행, 15파일/15,429,420 bytes, `differences: []`다.
- 판정: `complete_local_gate_operational_evidence_pending`. 실제 5분야 복합 프로젝트의 source update→conflict→repair→deliverable 재생성, cross-tenant 음성 운영시험, 대형 reference load/save/resume/cancel/restore와 장기 메모리 측정은 WP20 No-Go 항목이다.
- 다음 작업: WP20에서 지금까지의 local evidence를 다시 결속하고, MD/링크·보안·성능·분야별 정확도·연합·Beta 무결성을 재점검해 기술 출시 후보와 실제 차단기를 분리한다.

### WP20 실행 기록 — 2026-08-10

- 점검: 275개 Markdown, 매뉴얼 20개/요구사항 16개, 참고자료 6,914 artifact/467 lineage, App Router 544 route file/753 handler, CAD API 58/58, dependency·SBOM·license·secret·kernel identity, production build와 실제 Chromium runtime을 다시 대조했다. 로컬 backup restore와 rollback은 필요한 외부 대상 환경변수가 없어 `not_run`으로 유지했다.
- 정밀 CAD 런타임 조정: production CSP가 Replicad Emscripten glue의 JavaScript 평가를 차단해 데스크톱 exact kernel이 켜지지 않는 결함을 재현했다. 전역 CSP는 계속 `'unsafe-eval'`을 금지하고, 인증/전문가 게이트가 있는 `/:lang/shape-generator/:path*`에만 명시적 예외를 적용했다. HTTP 헤더와 31개 CSP 회귀 테스트로 범위를 고정했다. eval-free 격리 worker glue 전환은 후속 hardening이다.
- QR 보안 조정: 모바일 PC 전송 QR이 외부 `api.qrserver.com`에 프로젝트 URL을 보내고 CSP에도 차단되던 구조를 제거했다. `qrcode`를 모바일 컴포넌트에서만 동적 로딩해 브라우저 data URL로 생성하며 외부 요청·CSP 위반을 0으로 만들었다. 타입 패키지는 devDependency로 분리했고 npm audit 0을 재확인했다.
- 빌드/성능: Next.js 16.3.0 production build가 compile·TypeScript·635/635 static page·postbuild를 통과했다. shared JS 721.6KB/793.8KB, worst first-paint 2060.5KB/2266.6KB이며 155개 App route를 측정했다. `docs/evidence/performance/wp20-runtime-performance-260810.json`의 production Chromium 20/20이 통과했고 모바일 exact kernel 요청 0, 데스크톱 `replicad_single.wasm` 요청 1 및 `OCCT: ON`, page error 0이다. 비로그인 진단의 401/400 API 응답은 남지만 CSP 위반은 0이다.
- 보안/공급망/문서: dependency audit 취약점 0, CycloneDX 1.5 1,005 component/1,006 dependency·취약점 0, 제3자 고지 684 package/issues 0, route unknown/gap 0, CAD API issue 0, kernel identity 재생성을 완료했다. 운영 Redis/PostgreSQL/S3 미설정 경고는 배포 차단기로 유지한다.
- Closed Beta 무결성: `validation-reports/closed-beta-integrity-260810-active-master-wp20-final.json`을 WP19와 비교해 17개 보호 테이블/13행, 15개 보호 파일/15,429,420 bytes에서 differences `[]`를 확인했다. 기존 계정·비밀번호·프로젝트·저작물은 변경하지 않았다.
- 출시 후보: `technical-private-pilot-candidate-260810.json`과 `cad-technical-release-audit-v3-candidate-260810.json`을 생성했다. Closed Beta와 reference corpus는 verified지만 decision은 `blocked`, domain verified는 0이다. v3 경로를 명시한 실제 release gate는 generation state/accuracy, 7개 필수 capability의 독립 holdout·표본·95% pass rate, rollback/canary/monitoring/worker resume/performance 운영 증거, 승인된 5분야 campaign 누락으로 BLOCKED했다.
- 판정: `local_complete_launch_blocked`. 로컬 구현과 재현 가능한 기술 검증은 완료했지만 유료 technical private pilot와 공개 GA를 승인할 수 없다. 면책문구나 전문가 확인 안내는 독립 정확도·보안·운영 증거를 대체하지 않는다.

#### 운영 배포 검증 기록 (2026-08-10)

- Railway production service `nexyfab.com` 배포 `2073b676-3d0a-4167-afd2-d465dca9009b`가 `SUCCESS / RUNNING`으로 완료됐다.
- 첫 배포 후보는 PostgreSQL `partner_applications` 테이블 생성 누락으로 crash되어 활성화하지 않았고, 기존 closed-beta 운영 배포는 계속 유지됐다. `CREATE TABLE IF NOT EXISTS`를 마이그레이션에 추가한 뒤 재배포했다.
- 실서비스 `https://nexyfab.com/api/health/live/`는 HTTP 200, build `20260810023750`; `/kr/` 및 정밀 CAD 화면도 HTTP 200으로 확인했다. closed-beta 데이터/저작물 무결성 스냅샷은 변경하지 않았다.
- 다음 작업: 기계·건축·토목·조경·인테리어별 독립 검토자 2인과 승인된 holdout campaign을 수집하고, 실제 대형 5분야 프로젝트 load/save/resume/cancel/restore, cross-tenant 음성시험, production PostgreSQL/Redis/S3, parser 격리·malware/admission 이중 상태, staging RUM/DAST/pentest/credential rotation, backup restore/canary/rollback을 실행한다. 법무·결제는 요청대로 기술 범위 밖에 두지만 공개 판매 전 별도 필수 gate다.

### WP21 상업화 하드닝 실행 기록 — 2026-08-10

- 릴리스 기준: `release/2026-08-10` 브랜치, 운영 deployment `2073b676-3d0a-4167-afd2-d465dca9009b`, rollback `5c15e12e-cf5d-4874-83c5-800cae40d01b`, image `sha256:e2a8441e85513182f396a43352b8ff3b579c8723f375a6778721f17d372a2f1e`를 release manifest에 결속했다. 배포 제외 필수 항목 20개를 자동 검증하고 983파일/201,863,801 bytes의 복구 체크포인트를 임시 안전 경로에 생성했다. 작업트리는 아직 `candidate_uncommitted`이므로 새 운영 배포의 기준으로 승격하지 않는다.
- DB: production startup 전체 DDL 실행을 기본값에서 제거하고 읽기 전용 필수 schema 검증으로 변경했다. 별도 PostgreSQL migration 실행기는 advisory transaction lock, version `2026081001`, SQL SHA-256, checksum drift 거부와 rollback을 구현했다. 실제 production migration·backup restore 영수증은 안전한 restore-drill DB가 없어 미실행이다.
- 정확도 데이터: 합성/참고/독립 holdout 3레인을 분리했다. 합성은 5분야 각 20건, 총 100건이며 각 3 campaign×5 repeat를 실제 실행해 1,500/1,500 gate pass와 분야별 14/14 체크를 기록했다. 참고자료는 6,914 artifact/467 lineage를 read-only·license-review 경계로 결속했다. 합성·가상 검토자 promote는 scoreEligible 0으로 거부됐고 독립 holdout은 5분야 모두 0건으로 정직하게 차단 상태다.
- 신뢰 UX/API 계약: `ai_draft`, `auto_verifying`, `auto_verified`, `manual_revision`, `expert_review_required`, `expert_approved`, `manufacturing_or_construction_approved`, `blocked`를 공통 상태로 정의했다. 제조 패키지는 최종 승인 상태·정확 STEP·drawing·PMI·kernel/revision hash가 모두 있어야 PASS이며 그 외에는 expert-review-only로 표시한다.
- 실환경: AI 자동 정밀 설계 기본값과 자유형↔정밀 모드 Chromium E2E가 통과했다. live/ready/DB는 200이지만 OpenSCAD 서버 렌더는 production host execution 금지 정책 때문에 503으로 fail-closed다. Docker-in-Docker 우회 대신 격리 worker가 필요하다.
- 성능: Railway 6시간 실측은 memory average 420.0MB/max 488.8MB/current 159.7MB, CPU average 0.00074 vCPU/max 0.0607 vCPU, HTTP p95 157ms다. 현재 web runtime은 메모리 과다로 판정하지 않으며 7일 증거는 아직 필요하다.
- 보안/빌드: route 544/handler 753 gap 0, CAD API 58/58 issue 0, secret scan 6,664파일 findings 0, dependency vulnerabilities 0이다. 추가 테스트 17개가 통과했고 Next 16.3 production build 635/635 page, bundle budget(shared 721.6KB, worst first-paint 2,060.5KB)을 통과했다. postbuild Closed Beta는 17테이블/13행, 15파일/15,429,420 bytes에서 차이 0이다.
- 통합 판정: `npm run commercialization:gate`는 Private Beta를 미커밋 release, production smoke, migration receipt, backup restore receipt 때문에 BLOCKED한다. GA에는 5분야 독립 holdout, 7일 운영, 전문가 검토가 추가 차단기다. 외부 영수증 없이 PASS를 생성하지 않는다.
