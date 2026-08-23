# NexyFab 외부 CAD 비의존 구현·검증 및 상용화 리뷰

> **Historical snapshot — superseded for current status.** 이 문서는 2026-08-09 당시
> 25부품 로봇 demonstrator와 외부 증거 정책의 감사 기록이다. 현재 29부품·68 mate
> 로봇 구현, 자체 기계 실증 정책과 다음 실행 게이트는
> `docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`를
> 따른다. 당시 수치와 판정을 현재 정본으로 인용하지 않는다.

- 기준일: 2026-08-09
- 제품 계약: 사용자는 SOLIDWORKS 등 외부 CAD를 설치하지 않고 NexyFab에서 AI로 복잡 제품 완성을 진행한다. 일반 사용자에게는 AI가 정밀 B-Rep CAD 엔진을 내부적으로 자동 운용하고, 전문가는 필요할 때 같은 피처·치수 모델을 직접 편집한다. 이후 검증, 도면·BOM 및 제조 패키지를 처리한다.
- 실행 원칙: `점검 → 구현 → 검증·조정 → 다음 단계`
- 보호 원칙: 기존 Closed Beta 계정, 비밀번호 해시, DB 레코드, 업로드 및 저작물은 수정하지 않는다.

## 1. 현재 판정

### 제품 목표 정정

AI의 목표는 `초안 생성`이 아니라 `complete_manufacturing_product`다. AI가 요구사항, 제품 분해, 인터페이스, 파라메트릭 부품, 커널 형상, topology, assembly, motion, manufacturing 및 STEP 왕복까지 순서대로 진행한다. 정밀 CAD는 일반 사용자가 배워야 하는 필수 수동 단계가 아니다. AI가 정확도가 필요한 해당 부품 또는 assembly 범위에 자동 적용하며, 전문가는 원할 때 동일 모델을 직접 편집할 수 있다.

- exact B-Rep/커널 또는 topology 실패
- mate·assembly intent를 자동 수정하면 안 되는 경우
- 정밀 interference, collision 또는 clearance 문제
- STEP 왕복 불일치
- 동일 AI 수정 실패가 제한 횟수 이상 반복

사양, 재료, 공차, catalog 또는 housing처럼 권위 있는 입력이 없을 때는 AI가 값을 꾸미거나 정밀 CAD 문제로 오분류하지 않고 입력을 요청한다. 도면·BOM·STEP 왕복까지 끝난 `설계 완료`와 제조 책임이 포함된 `최종 릴리스 승인`도 별도 상태로 유지한다.

| 출시 범위 | 판정 | 조건 |
|---|---|---|
| 초대형 Closed Beta | 조건부 Go | AI 제품 구현/조건부 정밀 CAD/검증 상태를 구분하고 생산 보증 금지 |
| 범위를 명시한 기업 Pilot | 조건부 Go | 통과한 제품군과 형식만 계약 범위에 포함 |
| 일반 복잡 제품 셀프서비스 | No-Go | 참고 제품 8개 중 4개에 미실행 의미 검증 존재 |
| 자동 제조 승인·생산 보증 | No-Go | 제조 서명과 독립 최종 이중 승인이 실제로 없음 |
| 외부 CAD 설치 없는 기본 서비스 | 구현 계약 충족 | 통합 OCCT 계열 커널과 중립 제조 형식을 기본 경로로 사용 |

현재 코드는 ‘상용화가 가능한 기반’에는 도달했지만, 모든 복잡 제품을 무검토로 생산에 투입할 수 있는 상태는 아니다. 출시 범위를 통과 증거가 있는 기능으로 제한한 유료 Closed Beta/Pilot이 적절하다.

## 2. 이번 구현 완료 범위

### 정밀 CAD와 증거

- 실제 OCCT hidden-line projection과 실제 커널 테스트
- XCAF assembly AP242 구조·색상·occurrence 증거
- 별도 OCCT importer를 이용한 STEP Part 왕복 비교
- 상용 모드에서 stub/fallback을 허용하지 않는 worker launcher
- 커널·WASM·lockfile·release policy를 SHA-256으로 결속한 kernel identity
- `.nfab` revision manifest와 content-addressed 제조 패키지
- STEP, drawing, BOM, PMI, revision 및 kernel 증거가 부족하면 제조 승인을 차단하는 Release Audit v2

### 보안과 API

- CAD v1 API의 JWT 경계; `GET /api/cad/v1/capabilities`만 공개
- 계정별/플랜별 제한과 edge IP ceiling
- 상용 독립 모드에서 Redis 제한기가 없거나 실패하면 503으로 fail-closed
- OpenAPI 28개 CAD operation의 bearer 인증 표기
- CAD route inventory와 인증 정책을 결속한 API control evidence
- request ID 및 구조화 접근 로그

### AI → 정밀 CAD → 전문가 경로

- 적응형 복잡 제품 실행 계약 `nexyfab.adaptive-complex-product-execution.v1`
- AI 기본 목표 `complete_manufacturing_product`; `aiDraftOnly=false`
- AI 계속 진행, 권위 입력 요청, 조건부 정밀 CAD, 전문가 검토, 완료 상태를 분리
- 검증에서 지정된 affected part만 정밀 CAD로 전달하고 검증된 다른 part artifact는 재사용
- UI workflow rail에서 AI 제품 구현, 조건부 정밀 CAD, 정확도 gate, 전문가/릴리스 단계를 분리
- 제조 산출물 생성이 곧 생산 승인이라는 오인 방지
- 로봇 릴리스 V2가 외부 native CAD 증거 대신 NexyFab 자체 exact-CAD 서명 증거를 요구
- exact-CAD, 제조 검증, 독립 2인 최종 검토를 동일 release target hash에 결속
- 검토와 실제 release execution을 분리하고 UI/API가 임의 게시·RFQ를 실행하지 않음

### 라이선스

- 680개 패키지 notices 생성과 검사
- LGPL 중요 구성요소 3개 표시
- npm 원본에 라이선스 메타데이터가 없던 `buffers@0.1.1`은 별도 검토 ledger와 저장된 MIT 텍스트의 해시를 요구
- 미사용/불일치 override는 검사 실패

## 3. 복잡 제품 실증

원본 `C:\Users\gomd9\Downloads\참고파일들`은 읽기 전용으로 사용했다. 판정 파일은 `docs/evidence/cad-independent/complex-product-scope-assessment.json`이다.

| 범위 | 결과 |
|---|---:|
| 전체 제품군 | 8 |
| 정밀 교환 Pilot 통과 | 4 |
| 부분 검증 | 4 |
| 명시적 fail | 0 |
| 모든 복잡 제품 셀프서비스 적격 | false |

통과 제품군은 STEP fastener assembly, electrical cabinet, NIST AP242 PMI, IFC 4.3이다. Gearbox pattern intent, weldment mass, heavy-equipment motion/clearance, Parasolid assembly hierarchy/mates/motion은 필요한 원천 의미 또는 권위 데이터가 없어 `not_run`을 유지한다. 형상을 읽었다는 사실만으로 이 의미들을 통과시키지 않는다.

내부 6축 로봇 demonstrator는 25개 editable part, 60 mate, rank DoF 6/allowed DoF 6을 생성했다. 그러나 traceable component 22개, placeholder 관련 정밀 간섭 22개, 전체 동작 재검증, 제조 검증 및 최종 서명이 남아 있어 `concept_only`, `releaseReady=false`가 맞다.

## 4. Closed Beta 보호 검증 기준

- 보호 테이블: 17
- 보호 레코드: 13
- 보호 파일: 15개 / 15,429,420 bytes
- DB SHA-256: `e678f7957facbf783f42e261ea5cab14208f27d1a31f2d6e3a0af217775ebb11`
- 기준 snapshot: `validation-reports/closed-beta-integrity-260809-final-plan-audit.json`
- CAD 독립 코어 snapshot: `validation-reports/closed-beta-integrity-260809-cad-independent-core.json`

snapshot 도구는 DB를 read-only로 열며 비교 결과의 table/file diff가 0이어야 한다. 테스트 계정의 email verification 상태를 코드가 임의 변경하지 않으며, 인증된 기존 Closed Beta 사용자는 해당 상태 때문에 CAD API에서 배제되지 않는다.

## 5. 출시 전에 코드 밖에서 필요한 증거

다음은 구현을 더 작성해서 대신할 수 없는 실제 운영·전문가 증거다.

1. 운영 Redis, CAD quota용 Upstash Redis REST, PostgreSQL/객체 저장소, KMS/secret manager의 실제 배포와 장애 시 failover
2. 격리 환경에서 백업 복구 훈련 및 RPO/RTO 측정
3. 독립 침투시험, tenant isolation, 악성 CAD/archive bomb 및 서명 replay 재시험
4. 실제 부품 catalog와 housing capacity에 결속된 로봇 r+1 재검증
5. 동일 target에 대한 NexyFab exact-CAD 서명, 제조 전문가 서명, 서로 다른 두 최종 검토자 서명
6. 결제·환불·세금·SLA·책임 제한 및 금지 사용처의 실제 운영/법률 확정

이 증거가 없을 때 시스템은 `blocked_exact_release_evidence` 또는 각 `not_run` 상태를 반환해야 하며 자동으로 pass를 만들면 안 된다.

## 6. 다음 실행 순서

1. 배포 환경에 Redis/KMS/운영 DB를 구성하고 보안·복구 drill 증거 생성
2. 통과한 4개 제품군으로 제한된 고객 Pilot을 실행하고 성능·오류·지원 데이터를 수집
3. 부분 검증 4개는 assertion별 fixture/ground truth를 확보한 뒤 하나씩 승격
4. 로봇 실제 catalog/housing을 투입해 간섭 제거 r+1 → 전체 motion → exact CAD → 제조 검토 순으로 수행
5. 독립 이중 승인 이후에도 release execution은 별도 권한과 명시적 사용자 승인으로만 실행

## 7. 기계 검증 명령

```text
npm run licenses:check
npm run kernel:identity:check
npm run api:controls:check
npm run complex:scope:check
npm run occt:check:commercial
npm run typecheck
```

전체 상용 release gate는 위 정적 증거 외에도 운영 환경과 실제 release audit 입력을 요구하므로, 로컬 코드만으로 억지로 PASS시키지 않는다.

현재 로컬 상용 게이트의 운영 차단 범주는 PostgreSQL, 공용 Redis, CAD quota용 Upstash REST URL/token과 `NEXYFAB_CAD_INDEPENDENT_MODE=1`, 객체 저장소, cron 인증, SMTP, Sentry, 고정 Server Actions 키, 결제/webhook, 담당자 지정, 복구·결제 rehearsal, 법률 승인, 5개 도메인 정확도 증거 및 실제 CAD-independent release audit이다. 이는 기능 실패가 아니라 운영 증거 없이 공개 상용화를 시작하지 않기 위한 fail-closed 조건이다.

## 8. AI 완제품 목표 반영 후 최종 재검증

- AI 실행 목적: `complete_manufacturing_product`
- 초안 전용 제한: `aiDraftOnly=false`
- 일반 사용자: `ai_guided` — 정밀 CAD 필요 여부와 실행을 AI가 관리하며 수동 CAD 조작을 요구하지 않음
- 전문가: `ai_or_manual_precision` — AI 자동 실행을 그대로 사용하거나 동일 피처·치수 모델을 직접 편집 가능
- AI 설계 중 수동 조정: 숫자·슬라이더로 치수를 직접 바꾸고 사용자 확정값을 잠금. 후속 AI 수정과 전문가 CAD 인계에서도 유지
- 복잡 제품 정확도: geometry 진입 전에 서버가 요구사항 추적·권위 입력·편집 가능한 정의·mate 연결·계층·transform의 8개 게이트를 독립 판정. AI 자기보고 confidence와 발명된 evidence ref는 통과 근거로 인정하지 않음
- 정밀 CAD 직접 편집은 항상 선택 사항이며 외부 CAD 설치는 불필요
- 기본 실행자: AI가 kernel, topology, assembly, motion, manufacturing, STEP roundtrip까지 계속 진행
- 정밀 CAD 진입: exact geometry/topology, mate intent, interference/collision/clearance, STEP roundtrip 또는 제한 횟수 이상 자동 복구 실패가 확인된 affected scope에만 조건부 진입
- 권위 입력 누락: 사양·재료·공차·catalog·housing 값은 AI가 추정해 통과시키지 않고 `authoritative_input_required`로 요청
- 설계 완료와 생산 승인: 제조 산출물 생성 완료와 전문가·독립 2인 최종 release 승인을 별도 상태로 유지

2026-08-09 최종 검증 결과:

| 검증 | 결과 |
|---|---|
| Next.js production build | PASS — TypeScript, 634개 정적 페이지, bundle budget 691.8 KB / 763.3 KB |
| AI 완제품·조건부 정밀 CAD 핵심 테스트 | PASS — 7 files / 35 tests |
| 일반 사용자 AI 자동·전문가 선택 편집 추가 테스트 | PASS — 3 files / 8 tests + scope evidence test |
| 배포 API 라우트 | PASS — generation state/advance/finalize 및 robot/generate 4개 모두 manifest 포함 |
| CAD API control evidence | PASS — 57 route files / 57 handlers, issue 0 |
| 복잡 제품 scope evidence | PASS — 증거 파일과 실행 정책 hash 일치 |
| kernel identity | PASS — 정책·API·UI·커널 hash 일치 |
| third-party notices | PASS — 680 packages |
| OCCT commercial mode | PASS — warning 0 / error 0 |
| Closed Beta 무결성 | PASS — 기준 대비 summary/tables/files 동일, DB hash 동일, read-only |

최종 보존 snapshot은 `validation-reports/closed-beta-integrity-260809-ai-complete-product-final.json`이다. 보호 대상은 17개 테이블/13개 레코드와 15개 파일/15,429,420 bytes로 기준 snapshot과 동일하다.

일반 사용자·전문가 이중 UX 반영 후 재검증 snapshot은 `validation-reports/closed-beta-integrity-260809-general-expert-ux-final.json`이다. 기준 대비 summary, tables, files, DB fingerprint 및 DB bytes가 모두 동일하고 `readonly=true`다.

로봇 생산 완료 감사는 `validation-reports/robot-production-completion-audit-v2-260809-ai-complete-product.json`에 기록했다. 현재 `objectiveComplete=false`, `blocked_exact_release_evidence`인 이유는 AI가 초안까지만 만들도록 제한되어서가 아니다. 특정 실제 제품에 필요한 NexyFab exact-CAD 서명, 제조 검증 서명 및 독립 최종 2인 승인이 아직 입력되지 않았기 때문이다. 이 증거가 제공되면 동일 실행 계약이 다음 단계로 계속 진행하며, 제공되기 전에는 생산 가능하다고 허위 표시하지 않는다.
