# NexyFab 상용화 현재 상태

- 기준일: 2026-08-12 KST
- 제품 중심: AI 정밀 기계 CAD
- 확장 제품: Robot Verified Systems, 기계 계열 복잡 조립체
- 보조 서비스: Spatial Labs—건축·토목·조경·인테리어
- 현재 판정: `software_build_robot_and_family_promotion_chain_verified / clean_release_baseline_blocked / private_beta_blocked / commercial_ga_blocked`

### 2026-08-12 제품군 승격 체계 갱신

- 복잡 제품 benchmark 범위를 기계 코어 7개 제품군과 보조 `interior`로 분리했다. Spatial Labs 증거는 기계 출시를 통과시키지도, 차단하지도 않는다.
- `machine_skid`와 `welded_enclosure`를 `factory_equipment` 아래에 숨기지 않고 독립 제품군·정확도 지표·캠페인 범위로 승격했다.
- `verified-robot`, `verified-gearbox`, `verified-machine-skid`, `verified-welded-enclosure` 등 제품군별 릴리스 채널을 구현했다. 한 제품군은 자기 20건·이중 승인·제조 근거로만 승격하며 다른 제품군 증거를 빌릴 수 없다.
- 캠페인 상태의 suite hash는 case bytes뿐 아니라 필수 제품군, campaign 수, repeat 수와 최소 case 수를 함께 결속한다. 중단 후 다른 범위로 재개하면 fail-closed로 거부한다.
- 기존 v2 corpus는 88/120이고 승인 0/88이다. 그중 기계 코어는 68건이며, Machine/Skid 20건과 Welded/Enclosure 20건은 아직 0건이다. 신규 40슬롯 pending-only 획득 큐를 추가했으므로 기계 7제품군 전체 목표는 현재 68/140, 부족 72건이다.
- 이 갱신은 실행·판정 소프트웨어를 완성한 것이며 실제 CAD 72건, 승인, 3×5 AI 실행, 제조와 운영 증거를 생성한 것으로 간주하지 않는다.

## 1. 결론

NexyFab은 **AI 기반 정밀 기계 설계와 자체 CAD를 주력 제품**으로 삼는다. 기존 CAD 제품에 종속되는 플러그인보다 NexyFab 내부의 손실 없는 설계 그래프와 정밀 형상 엔진을 기준으로 하며, 외부 교환은 표준 STEP 호환성을 기본 계약으로 사용한다.

SOLIDWORKS·Fusion·Onshape 설치나 제품별 왕복 인증은 기본 출시 조건이 아니다. 특정 제품명을 사용한 완전 호환 마케팅이 필요할 때만 별도 선택 검증을 수행한다.

로봇·정밀 CAD 범위와 저장소 전체 clean 프로덕션 빌드는 통과했다. 저장소 전체 릴리스 후보는 큰 미정리 작업 트리 때문에 아직 고정되지 않았고, 실제 설계·제조·운영 증거도 없으므로 Private Beta와 Commercial GA는 승인하지 않는다.

## 2. 제품별 현재 평가

| 제품 | 현재 상태 | 남은 핵심 작업 |
|---|---|---|
| AI 정밀 기계 CAD | 상용 소프트웨어 후보 | 직접 설계 30건, 30피처 외부 폐루프, 150 intent, STEP conformance, 제조 3건 |
| Robot Verified Systems | 계산·증거·감사 소프트웨어 체인 완료 | 실제 22개 catalog 부품, 실제 r+1, joint rig·wrist·6축·endurance 계측과 서명 |
| 일반 복잡 조립체 | System Graph v2·3개 제품군 설계 계약·실행 UI 완료 | 제품군별 golden/blind case, 대규모 benchmark, 실제 제작·시운전 |
| Spatial Labs | 보조·실험 서비스 | 기계 제품과 출시 증거·마케팅·게이트를 분리해 운영 |

## 3. 구현 완료 범위

### AI·CAD 코어

- 핵심 30피처 계약과 실제 형상 실행 경로
- 손실 없는 설계 그래프와 revision 결속
- NFAB/STEP 3회 왕복과 실제 커널 STEP 재수입
- 정밀 선택 편집, mate/DoF, 간섭, 연속 운동 검증
- manufacturing package와 release certificate의 fail-closed 경계

### 로봇·복잡 조립체

- 구동계 18개와 보조부품 4개, 총 22개 catalog occurrence 계약
- 목표 상태 29부품·68 mate·unresolved 0
- application/receipt/program/revision/target hash 교차 결속
- r+1 실제 부품 목록과 post-integration evidence 검증
- 동결 요구사항과 payload 0·정격·편심 × governed path 전 조합 엔지니어링 재계산
- 적응형 연속 충돌·workspace coverage, 케이블 bend/twist/flex-life, 안전·전기 설계 증거
- joint rig → wrist → 6축 prototype → endurance/teardown의 27개 계측 항목과 원시 데이터·교정·as-built BOM·독립 이중 서명 receipt
- exact CAD·manufacturing·engineering·motion·cable·safety·physical을 하나의 target으로 결속한 서버 Ed25519 서명 감사 v2
- 실제 증거가 없을 때 release를 승인하지 않는 UI·API 경계
- 요구사항→기능→기술 실현, 위험→저감→안전 기능, 부품→조달→검사→인수를 잇는 `Complex System Graph v2`
- 그래프·계산 계약·원본 증거 bytes를 재검산하는 Graph, Gearbox, Machine/Skid, Welded/Enclosure, change-impact, scale의 6개 API
- 공통 graph·artifact를 재사용하며 계산 PASS와 실물·전문가 blocker를 분리 표시하는 복잡 제품 Verified Systems UI

### 상용 서비스 기반

- 개인·조직별 프로젝트, 파일, 사용량, AI 비용, AI 이력, 설계 리뷰 격리
- active workspace에 결속된 주문·결제·환불·검사 접근 제어
- release → RFQ → quote → contract/order의 원자적 거래 계보
- 주문·release hash에 결속된 제조 검사 receipt
- 중앙 session probe와 게스트 notification/refresh 연쇄 4xx 제거
- 기계 우선 IA와 Spatial Labs 보조 영역 분리

## 4. 최신 검증 결과

| 검증 범위 | 결과 |
|---|---:|
| 전체 Vitest | 8/8 shard 성공, 27,218 pass, 0 fail |
| 명시적 pending/skip | 89개—PASS 수치에서 제외 |
| todo | 1개—PASS 수치에서 제외 |
| Node 전체 테스트 | 326 pass, 0 fail, 환경상 symlink 1 skip |
| 기계 코어 직접 검증 | 11파일, 89테스트 통과 |
| 기계 정확도 | 9파일, 49테스트 통과 |
| 로봇·Verified Systems | 64파일, 265테스트 통과 |
| 일반 복잡 조립체 | 13파일, 104테스트 통과 |
| Complex System Graph·3 family·change impact·scale·UI 통합 회귀 | 14파일, 68테스트 통과 |
| 복잡 제품 benchmark·campaign·ground truth·release channel | 6파일, 33테스트 통과 |
| 제품군별 상용 릴리스 게이트 | Node 13/13 통과 |
| 기존 32 + 신규 40슬롯 pending-only scaffold | Node 3/3 통과 |
| 조직·거래·제조 계보 | 9파일, 43테스트 통과 |
| 인증·모바일 접근성 | 8파일, 24테스트 통과 |
| TypeScript | 전체 통과 |
| ESLint | 전체 `src` 오류 0 |
| 로봇 제품 선택 프로덕션 build | PASS—컴파일, 전체 TypeScript, 페이지 생성, 보안 헤더 |
| 저장소 전체 clean 프로덕션 build | PASS—513.4초, 291/291 페이지, standalone postbuild 완료 |
| 번들 예산 | shared 723.5KB / 795.7KB, worst first-paint 1764.0KB / 1851.5KB |
| CAD API control | 83 route files / 85 handlers, issue 0 |
| 라우트 보안 | 607 route files, 837 handlers, gap 0 |
| 비밀정보 스캔 | 7,657파일 / 88,863,058 bytes, finding 0 |
| 커널 identity | 현재 소스와 일치 |

2026-08-12 최종 공식 `ci:replicate-build`는 신규 제품군 승격 변경을 포함해 513.4초에 Webpack 컴파일, 전체 타입, 291/291 정적 페이지, standalone 정리와 번들 예산을 통과했다. 빌드 PASS와 clean release commit 미확정은 별개로 관리한다.

## 5. 현재 상용화 차단 조건

| 항목 | 현재 값 | 출시 영향 |
|---|---:|---|
| 작업트리 | 375건—221 tracked change, 154 untracked | clean release 기준선 차단 |
| 우선 직접 설계 | 0/10 | Private Beta 차단 |
| 전체 직접 설계 | 0/30 | Commercial Candidate 차단 |
| 30피처 외부 artifact 폐루프 | 0/30 | GA 차단 |
| AI 의도 정확도 campaign | 0/150 | GA 차단 |
| 내부 blind product challenge | 0/20 | GA 차단 |
| 표준 STEP conformance receipt | 없음 | GA 차단 |
| CNC·판금·적층 제조 | 0/3 | 제조 release 차단 |
| Redis 실제 배포 7일 운영 | receipt 없음 | GA 차단 |
| 로봇 실제 부품·rig | receipt 없음 | Robot Verified 출시 차단 |

상용화 게이트는 내부 회귀·보안·기계 revision consistency를 통과시키고 위 외부 증거를 계속 차단한다. 코드 테스트를 실제 제조·운영 증거로 대체하지 않는다.

2026-08-12 최신 `mechanical-core` 상용화 게이트는 의도대로 Private Beta `eligible=false`와 3개 blocker, Commercial GA `eligible=false`와 12개 blocker를 반환했다. Private Beta의 직접 차단은 dirty release tree, 직접 설계 10건 미완료, private-beta evidence 미승격이다. GA에는 30피처·직접 설계 30건·150 intent·표준 STEP·blind 20건·제조 3건·7일 운영이 추가된다.

## 6. 실행 순서

### 단계 0—릴리스 기준선

1. 작업트리 375건을 기능·보안·증거·문서 묶음으로 검토한다.
2. 사용자 변경을 보존하면서 하나의 재현 가능한 clean release commit을 확정한다.
3. 새 commit 기준으로 커널 identity, 보안 매트릭스, secret scan, 기계 scope, 빌드를 다시 생성한다.

### 단계 1—기계 Private Beta

1. 직접 설계 10건을 실제 요구사항에서 시작한다.
2. 각 설계에서 intent → feature graph → 정밀 편집 → NFAB/STEP 왕복 → drawing/package → review를 완료한다.
3. 실패·수동 수정·시간·형상 차이·제조 가능성 결과를 그대로 기록한다.
4. 10/10 완료 전에는 Private Beta로 승격하지 않는다.

### 단계 2—기계 Commercial Candidate

1. 나머지 직접 설계 20건을 완료한다.
2. 핵심 30피처를 실제 artifact 기준으로 각각 폐루프 처리한다.
3. 150개 intent를 도면·치수·재질·공차·제조 문맥별로 평가한다.
4. 구현자와 분리된 검토자가 blind challenge 20건을 수행한다.

### 단계 3—제조·운영

1. CNC 절삭, 판금, 적층 제조를 각 1건 실제 제작한다.
2. 설계 revision, STEP, 도면, 공정, 측정값, 검사 서명을 byte hash로 결속한다.
3. Redis가 연결된 실제 배포에서 72시간 candidate 관찰 후 7일 GA 관찰을 수행한다.
4. 메모리·지연·오류·비용·백업·복구·롤백 영수증을 남긴다.

### 단계 4—Robot Verified Systems

1. 구동계 18개와 brake·encoder·harness·tool connector 4개의 실제 사양을 확정한다.
2. 제조사 CAD·라이선스·정격·mount 기준을 catalog admission에 입력한다.
3. 29부품·68 mate·22 catalog occurrence·unresolved 0의 r+1을 생성한다.
4. 전체 payload/path 계산, 연속 동작, 케이블 수명, 안전·전기 설계 증거를 현재 동결 요구사항으로 실행한다.
5. joint rig·wrist·6축 시제품·endurance teardown의 27개 실제 계측과 원시 데이터·교정·as-built BOM을 채운다.
6. 물리 receipt와 exact-CAD·manufacturing 증거를 서버 서명 감사 v2로 결속하고 감사 이후 전문가 이중 서명을 검증한다.
7. 위 증거 전에는 Verified release를 허용하지 않는다.

### 단계 5—복잡 제품군 확장

1. gearbox
2. equipment/skid
3. welded frame·enclosure
4. pressure vessel·turbomachinery

각 제품군은 golden 5건 → blind 5건 → 제조 가능한 package → 운영 회귀 순으로 별도 승격한다.

## 7. 실행 파일 위치

- 외부 증거 루트: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260812`
- 직접 설계: `direct-design\mechanical-direct-design-workbook.json`
- blind challenge: `blind-challenges\mechanical-blind-product-challenge-workbook.json`
- 제조 파일럿: `manufacturing-pilots\mechanical-manufacturing-pilot-workbook.json`

모든 workbook은 `releaseEligible=false`로 시작한다. 실제 artifact, 측정값, 검토와 서명이 없으면 자동으로 승격되지 않는다.

## 8. 관련 정본

1. `docs/NEXYFAB_PROGRESS_AND_NEXT_ACTIONS.md`—진행 현황과 다음 실행 체크리스트
2. `docs/NEXYFAB_COMMERCIALIZATION_CURRENT.md`—상용화 현재 상태와 경쟁 평가
3. `docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`—상세 상태와 정확도 향상 계획
4. `docs/process/mechanical-core-commercialization-runbook.md`—기계 실증 실행 절차
5. `docs/process/robot-verified-product-runbook.md`—로봇 검증 절차
6. `docs/ACTIVE_EXECUTION_MASTER.md`—전체 구현 이력과 공통 불변조건

## 9. 상용 경쟁 평가 기준

- 평가 시점: 2026-08-12
- NexyFab 근거: 현재 소스, 통과한 테스트·빌드·보안 게이트, 현재 evidence JSON
- 경쟁사 근거: 각 회사의 공식 제품·기능·가격·문서 페이지
- 점수 기준: 10점은 기능 존재가 아니라 실제 시장 사용, 운영 안정성, 지원, 생태계와 외부 증거까지 확보한 상태
- 판정 원칙: `implemented`, `unit_verified`, `real_data_verified`, `release_verified`를 구분하고 내부 테스트를 시장 검증으로 대체하지 않음

경쟁사 제품을 동일 조건에서 직접 벤치마크한 결과가 아니라 공식 공개 자료와 NexyFab 로컬 검증을 결합한 전략 평가다. 따라서 수치는 절대 측정값이 아니라 투자·개발 우선순위를 정하기 위한 상대 지표로 사용한다.

## 10. 종합 경쟁력 평가

NexyFab은 현재 “SOLIDWORKS 대체 CAD”로 경쟁하면 약하다. 반면 **AI가 요구사항을 정밀 CAD로 만들고 검증·제조 패키지·견적·주문까지 연결하는 서비스**로 정의하면 강한 차별성이 있다.

| 평가 축 | 현재 점수 | 판정 |
|---|---:|---|
| 제품 차별성 | 8.2/10 | AI CAD와 제조·검증 계보를 하나로 묶은 방향이 좋음 |
| 구현 기능 경쟁력 | 7.0/10 | 코어·로봇·거래 흐름이 넓고 깊음 |
| 정밀 CAD 신뢰도 | 6.5/10 | 내부 검증은 강하지만 외부 설계·제조 증거 부족 |
| AI-native 설계 경험 | 8.0/10 | 자연어·이미지·도면에서 편집 가능한 설계로 이어지는 구조가 강점 |
| 사용자 경험 | 6.0/10 | 기능은 많지만 초보자와 단일 과업 사용자에게 복잡할 위험 |
| 협업·PDM | 6.0/10 | 조직·리비전·리뷰는 있으나 Onshape 수준의 시장 검증은 없음 |
| 제조 서비스 경쟁력 | 5.0/10 | 거래 흐름은 있으나 공급자망·실제 납품·품질 이력 없음 |
| 운영·지원 성숙도 | 4.5/10 | Redis 7일 운영, SLA, 장애 대응과 고객지원 실증이 남음 |
| 현재 상용 경쟁력 | **5.8/10** | 유료 Private Beta 후보 |
| 계획된 실증 완료 후 잠재력 | **7.5~8.2/10** | 전문 기계 AI CAD 카테고리 리더 후보 |

현재 NexyFab은 기능이 부족한 초기 제품이 아니라 **기능은 강하지만 시장 증거가 부족한 상용 후보**다.

## 11. 경쟁 서비스별 평가

### 11.1 SOLIDWORKS

SOLIDWORKS는 전문 부품·조립체·도면, 대형 설계 검토, Simulation, CAM, PDM, 제조 문서와 지원 생태계가 강하다. SOLIDWORKS 2026은 AURA·LEO와 AI 도면 등 AI 기능도 확대하고 있어 “기존 CAD는 AI가 약하다”는 전제는 더 이상 유효하지 않다.

LEO의 공개 방향에는 자연어 요구사항을 구조화된 파라메트릭 CAD로 변환하고, 모델 문제 진단, 수입 형상의 설계 의도 복구와 문서 검토를 지원하는 기능이 포함된다. 따라서 NexyFab의 시간 우위가 영구적이라고 보면 안 된다.

NexyFab이 열세인 영역:

- 30년 이상 누적된 전문 CAD 안정성과 기능 깊이
- 대형 조립체 성능과 산업별 특화 도구
- 도면·PMI·공차·CAM·Simulation의 시장 검증
- 리셀러, 교육, 인증, 부품 라이브러리와 기업 지원
- 광범위한 네이티브 CAD 생태계

NexyFab이 차별화할 영역:

- 요구사항부터 CAD 생성·검증까지의 대화형 폐루프
- revision·program·STEP·release·inspection receipt 결속
- 설계 이후 RFQ·견적·주문을 동일 계보에 연결
- 로봇과 복잡 제품의 검증형 자동 설계

공식 근거:

- [SOLIDWORKS Design](https://www.solidworks.com/product/solidworks-design)
- [SOLIDWORKS AI Overview](https://www.solidworks.com/product/solidworks-design/ai-overview)
- [SOLIDWORKS 2026](https://www.solidworks.com/product/whats-new)
- [SOLIDWORKS 가격](https://www.solidworks.com/how-to-buy/solidworks-design-cloud-services-plans-pricing)

### 11.2 Autodesk Fusion

Fusion은 CAD·CAM·CAE·PCB·데이터 관리와 제조를 하나의 제품에 통합한다. 생성 설계도 제조 공법, 성능과 형상 제약을 입력해 여러 제조 가능 후보를 탐색하는 구조다.

NexyFab이 열세인 영역:

- 검증된 CAM과 CNC toolpath
- Simulation과 PCB·ECAD/MCAD 통합
- 제조 공정별 확장 기능
- 스타트업·메이커·공장의 기존 사용자 기반

NexyFab이 차별화할 영역:

- 대화에서 구조화된 요구사항과 feature graph를 함께 생성
- 결과 검증과 제조 release를 자동으로 fail-closed 처리
- 설계·견적·발주·검사까지 이어지는 단일 서비스
- 로봇 catalog occurrence와 복잡 조립체 증거 모델

Fusion과 일반 기능 수로 경쟁하는 전략은 비효율적이다. NexyFab은 **AI가 설계를 시작하고 검증 가능한 제조 인계까지 끝내는 시간**으로 비교해야 한다.

공식 근거:

- [Fusion Design for Manufacturing](https://www.autodesk.com/products/fusion-360/design-for-manufacturing)
- [Fusion Generative Design](https://help.autodesk.com/view/fusion360/ENU/?contextId=GD-F360-GENERATIVE-DESIGN)
- [Fusion Personal·Commercial 비교](https://www.autodesk.com/products/fusion-360/personal)

### 11.3 Onshape

Onshape는 cloud-native CAD, 내장 PDM, 자동 버전 이력, branch/merge, BOM과 release 관리, 실시간 공동 편집이 강하다. Professional에는 Simulation·Rendering·ECAD/MCAD·CAM이 포함되고 Standard는 연 1,500달러, Professional은 연 2,500달러로 공개돼 있다.

Onshape Labs는 AI Advisor와 FeatureScript MCP 기반 Text-to-Code-to-CAD를 확대하고 있다. 자연어가 편집 가능한 CAD 기능으로 변환되는 시장도 빠르게 경쟁이 심해지고 있다.

NexyFab이 열세인 영역:

- 동시 편집과 branch/merge의 시장 검증
- CAD 데이터베이스 기반 PDM와 where-used
- 회사 수준 release·BOM·승인·감사 체계
- API, 앱스토어, Arena PLM 연결과 기업 도입 이력

NexyFab이 차별화할 영역:

- 설계 생성 자체를 AI가 주도하는 흐름
- 제조 견적·주문·검사를 CAD release에 직접 결속
- 검증된 시스템 제품과 로봇 전용 제품화
- 한국 기계 설계·공장 거래에 맞춘 통합 경험

공식 근거:

- [Onshape PDM](https://www.onshape.com/en/features/product-data-management)
- [Onshape Collaboration](https://www.onshape.com/en/features/collaboration)
- [Onshape Labs](https://www.onshape.com/en/features/onshape-labs)
- [Onshape CAM Studio](https://www.onshape.com/en/features/cam-studio)
- [Onshape 가격](https://www.onshape.com/en/pricing)

### 11.4 Zoo Design Studio

Zoo는 NexyFab의 가장 직접적인 AI-native CAD 경쟁사다. 자체 geometry engine과 KCL을 기반으로 prompt, point-and-click, code CAD를 한 환경에서 오가며 Zookeeper가 생성·수정·설계 추론을 수행한다. STEP·STL 등 표준 포맷을 지원하며 API·CLI·MCP와 Git 친화적인 코드 CAD 기반도 제공한다.

Zoo 공식 문서는 현재 전통적인 단순 기계 부품이 가장 잘 동작한다고 설명하고, 비네이티브 STEP import는 직접적인 feature history 편집이 아니며 STEP export 시 KCL feature tree가 보존되지 않는다고 명시한다.

NexyFab이 열세인 영역:

- 공개된 AI-native CAD 제품 완성도와 개발자 생태계
- KCL 기반 코드 CAD의 단순성·휴대성
- Engine API·Agent API·CLI·MCP 접근성
- 외부 사용자가 즉시 시험할 수 있는 제품 가시성

NexyFab이 차별화할 영역:

- 제조 release와 검토 receipt를 결합한 신뢰 계층
- 견적·주문·결제·검사까지 연결된 상용 거래 흐름
- 30피처 폐루프와 도면·제조 패키지 계약
- 로봇·복잡 조립체를 별도 Verified Systems로 승격하는 구조

공식 근거:

- [Zoo Design Studio](https://zoo.dev/docs/zoo-design-studio)
- [Zoo Text-to-CAD FAQ](https://docs.zoo.dev/docs/faq)
- [Zoo Import](https://zoo.dev/docs/zoo-design-studio/features/data-management/import)
- [Zoo Export](https://docs.zoo.dev/docs/zoo-design-studio/features/data-management/export)
- [Zoo ML·AI](https://zoo.dev/docs/zoo-design-studio/features/ml-ai)

### 11.5 Shapr3D

Shapr3D는 Siemens Parasolid 기반 정밀 형상, 쉬운 직접·히스토리 모델링, Windows·macOS·iPad 멀티디바이스, 오프라인 사용, STEP과 기술 도면, 직관적인 UI가 강점이다.

NexyFab이 열세인 영역:

- 초보자가 빠르게 배우는 인터랙션 품질
- 터치·펜·직접 편집 경험
- Parasolid 기반 형상 호환성과 시장 신뢰
- 멀티디바이스 성능·동기화·시각화 완성도

NexyFab이 차별화할 영역:

- 자연어·이미지·도면 기반 자동 설계
- 복잡 조립체와 로봇 생성
- 자동 검증·제조 패키지·견적·발주 폐루프

공식 근거:

- [Shapr3D 3D Modeling](https://www.shapr3d.com/product/3d-modeling)
- [Shapr3D Collaboration](https://www.shapr3d.com/product/cad-collaboration)
- [Shapr3D Plans](https://support.shapr3d.com/hc/en-us/articles/7871961422364-Shapr3D-subscription-plans)

### 11.6 Xometry

Xometry는 CAD 저작 도구가 아니라 제조 조달 플랫폼에 가깝다. 공식 자료 기준 5,000개 이상의 공급자 네트워크, 즉시 가격·납기·DFM 피드백, 주문 추적과 CNC·판금·적층·사출 등 실제 제조 역량을 제공한다.

NexyFab이 열세인 영역:

- 실제 공급자망과 가용 생산능력
- 가격·납기 예측 데이터
- 품질 보증·납품·재주문 실적
- 인증 공장과 실제 고객 기반

NexyFab이 차별화할 영역:

- 제조 파일 업로드 이전의 요구사항·설계 생성 단계
- release와 quote/order/inspection의 설계 계보
- 설계 오류를 제조 주문 전에 차단하는 검증형 CAD

현재 NexyFab을 “Xometry 수준의 제조 네트워크”로 표현해서는 안 된다. 공급망이 확보되기 전에는 **설계에서 검증된 RFQ까지 만드는 서비스**로 범위를 제한한다.

공식 근거:

- [Xometry Capabilities](https://www.xometry.com/capabilities/)
- [How Xometry Works](https://www.xometry.com/how-xometry-works/)
- [Xometry Production](https://www.xometry.com/capabilities/high-volume-manufacturing/)

## 12. 경쟁사 대비 요약

| 경쟁 서비스 | 가장 강한 영역 | NexyFab의 현재 상대 위치 | 이겨야 하는 방법 |
|---|---|---|---|
| SOLIDWORKS | 전문 CAD·도면·조립체·생태계 | 정밀도·성숙도 열세 | AI 설계부터 제조 검증까지 걸리는 시간 |
| Fusion | CAD/CAM/CAE/PCB와 제조 | CAM·Simulation 열세 | 요구사항→검증 release 자동화 |
| Onshape | cloud CAD·PDM·협업 | 협업·PDM 열세 | CAD와 제조 거래·검사를 동일 계보로 연결 |
| Zoo | AI-native·code CAD | 직접 경쟁, 현재 공개 제품 완성도 열세 | 신뢰 receipt·제조·로봇 Verified Systems |
| Shapr3D | 쉬운 정밀 모델링 UX | UX·멀티디바이스 열세 | 복잡한 AI 자동 설계와 폐루프 |
| Xometry | 즉시 견적·실제 제조망 | 공급망·납품 실적 크게 열세 | 설계 생성부터 검증된 RFQ까지 선점 |

## 13. 고객군별 현재 적합도

| 고객군 | 현재 적합도 | 평가 |
|---|---:|---|
| 개인 기계 설계자 | 7.0/10 | AI 초안·정밀 편집·STEP 패키지가 매력적. 장시간 안정성과 도면 완성도 증명 필요 |
| 하드웨어 스타트업 | 7.5/10 | 요구사항에서 시제품·견적까지 연결하는 방향이 가장 잘 맞음 |
| 소규모 설계기업 | 6.0/10 | 리뷰·조직 기능은 좋지만 기존 PDM 이전 비용을 감수시킬 증거 부족 |
| 공장·가공업체 | 5.5/10 | RFQ·DFM·주문 흐름은 유망하지만 실제 견적 정확도와 공급 실적 부족 |
| 중견·대기업 | 3.5/10 | SSO·감사·운영·지원·SLA·PLM 연결의 실증 부족 |
| 로봇 개발팀 | 7.0/10 잠재 | 코드 구조는 강하지만 실제 22부품과 한 축 rig 전에는 후보 수준 |

초기 상용 고객은 모든 시장을 동시에 겨냥하지 않는다. 우선순위는 다음과 같다.

1. 하드웨어 스타트업
2. 개인·소규모 기계 설계자
3. 빠른 설계·견적을 원하는 소형 공장
4. 설계기업 팀 기능
5. 운영·보안 증거 확보 후 중견·대기업

## 14. 서비스 자체 평가

### 14.1 가장 강한 부분

NexyFab의 핵심 경쟁력은 단일 AI 기능이 아니라 다음 폐루프다.

`요구사항 → AI 설계 → 편집 가능한 CAD → 형상·조립 검증 → 도면·STEP → release → RFQ → quote → order → inspection`

기존 CAD 회사는 설계 도구가 강하고, Zoo는 AI 생성이 강하며, Xometry는 제조 거래가 강하다. NexyFab은 세 영역을 추적 가능한 하나의 흐름으로 연결한다.

특히 다음 설계가 좋다.

- AI 결과를 즉시 제조 가능으로 과장하지 않는 fail-closed 게이트
- revision·program·STEP·receipt의 교차 hash 결속
- 개인과 조직의 파일·AI 비용·사용량·리뷰·주문 격리
- 로봇 22개 catalog occurrence와 r+1 post-verification
- 표준 STEP을 외부 교환의 기본 계약으로 사용
- 견적 수락과 contract/order 생성을 원자적으로 처리

### 14.2 가장 큰 약점

가장 큰 약점은 기능 부족보다 **증거와 집중도 부족**이다.

- 기능이 많아 첫 화면에서 핵심 가치가 흐려질 위험
- 291개 페이지와 많은 전문 기능이 신규 사용자에게 복잡하게 느껴질 가능성
- 내부 테스트는 강하지만 실제 설계자의 과업 성공률·완료시간 데이터 없음
- 실제 제조 3건, 공급자 성과, 불량률과 납기 정확도 데이터 없음
- 7일 운영, 장애 복구, 고객지원 응답시간과 SLA 근거 없음
- 로봇은 코드상 거의 완성됐지만 제조사 CAD·배선·공차·시제품 검증 없음
- SOLIDWORKS·Onshape·Zoo가 AI 기능을 빠르게 확대하고 있어 시장 진입 속도가 중요

### 14.3 서비스 UX 위험

기계 설계자, 공장, 설계기업과 스타트업을 모두 지원하되 동일한 첫 화면에 모든 기능을 노출하면 안 된다.

- 기계 설계자: 설계 생성·정밀 편집·도면·STEP
- 스타트업: 요구사항→시제품 패키지→견적
- 공장: DFM·RFQ·수주·검사
- 설계기업: 프로젝트·리비전·리뷰·승인

계정 유형별로 핵심 작업을 다르게 보여주고 고급 기능은 progressive disclosure로 노출한다.

## 15. 시장 포지셔닝

### 권장 핵심 문장

> 요구사항을 편집 가능한 정밀 기계 CAD로 만들고, 검증된 제조 패키지와 견적·발주까지 연결하는 AI 설계 플랫폼.

### 보조 문장

> AI가 형상을 그리는 데서 멈추지 않고, 설계 revision과 제조 인계까지 검증합니다.

### 피해야 할 표현

- SOLIDWORKS 완전 대체
- 모든 복잡 제품을 자동 설계
- 제조 가능한 결과를 즉시 보장
- Xometry 수준의 제조 네트워크
- 완전한 상용 로봇 자동 설계
- SOLIDWORKS·Fusion·Onshape 네이티브 feature tree 완전 호환

실제 rig와 제조 receipt 전에는 로봇을 `Robot Verified Systems Candidate` 또는 `Verified Pilot`으로만 표시한다.

## 16. 상용 경쟁력 향상 우선순위

### P0—유료 Private Beta 전

1. 작업트리 375건을 검토 가능한 묶음으로 분리해 clean release로 고정
2. 실제 기계 직접 설계 10건 완료
3. 첫 사용 성공률, 설계 완료시간, 수동 수정 횟수, export 성공률 측정
4. Redis 실제 배포와 72시간 운영
5. 백업·복구·rollback·결제·환불·지원 절차 확인
6. 공개 제품 문구를 실제 증거 수준에 맞춰 제한

### P1—Commercial Candidate 전

1. 직접 설계 30건 완료
2. 핵심 30피처 외부 artifact 폐루프 30/30
3. intent campaign 150건
4. 구현자와 분리된 blind challenge 20건
5. 표준 STEP conformance와 revision consistency 유지
6. CNC·판금·적층 제조 각 1건 실측

### P2—GA 전

1. Redis 포함 실제 배포 7일 운영
2. 오류율·지연·메모리·비용·백업·복구·rollback 기준 통과
3. 고객지원 응답·장애 통지·데이터 삭제·환불 SLA 확정
4. 실제 제조 불량·재작업·납기 데이터를 서비스 지표에 반영
5. 가격과 사용량 정책을 서버 entitlement로 강제

### P3—Verified Systems 확장

1. 실제 로봇 catalog 부품 22종 admission
2. 29부품·68 mate·unresolved 0 r+1
3. 한 축 rig 또는 시제품 검증
4. gearbox → equipment/skid → welded/enclosure 순서로 family golden 5건씩 승격

## 17. 상용 KPI

### 설계 품질

- 직접 설계 완주율
- intent 최초 성공률
- feature별 재시도율
- 수동 수정 횟수
- NFAB/STEP 왕복 후 body·assembly·unit·geometry diff
- 도면·PMI 누락률

### 사용자 가치

- 요구사항 입력부터 첫 유효 CAD까지 걸린 시간
- 제조 package 완료시간
- 기존 CAD 대비 총 작업시간 절감률
- 신규 사용자 첫 과업 성공률
- 7일·30일 재사용률

### 제조

- quote 정확도
- 견적 응답시간
- 주문 전 DFM 차단률
- 실제 검사 합격률
- 재작업·불량·납기 지연률
- release revision과 실제 납품 revision 일치율

### 운영

- API와 CAD job 성공률
- p95·p99 지연
- peak memory와 worker queue 대기시간
- 백업·복구 RPO/RTO
- 장애 감지·통지·복구 시간
- AI·형상 커널·저장소 단위 비용

## 18. 최종 경쟁 판정

NexyFab이 지금 당장 정면 경쟁으로 이기기 어려운 영역은 전통 CAD 기능의 총량, 대형 조립체 시장 이력, PDM 협업 성숙도, CAM·Simulation, 제조 공급망이다.

반대로 이길 수 있는 영역은 다음과 같다.

1. 자연어 요구사항에서 편집 가능한 정밀 기계 CAD까지의 속도
2. AI 결과를 제조 가능성·revision·도면·STEP과 함께 검증하는 신뢰성
3. CAD release를 견적·주문·검사까지 연결하는 제품 완결성
4. 로봇·복잡 제품을 검증형 제품으로 단계적으로 승격하는 구조
5. 한국 기계 설계자·스타트업·공장 사이의 언어와 거래 마찰 제거

앞으로의 승부는 기능을 더 많이 추가하는 것보다 **10건 → 30건 → blind 20건 → 제조 3건 → 7일 운영**을 빠르게 닫아 “실제로 일을 끝내는 AI CAD”라는 신뢰를 만드는 데 달려 있다.

## 19. 로봇·복잡 제품 재평가

로봇은 `CAD·조립·증거 소프트웨어가 거의 구현됨`과 `실제 로봇 제품이 거의 검증됨`을 분리해서 표현한다. 현재 29부품·68 mate·22 catalog occurrence·unresolved 0을 강제하는 r+1 경로와 해시 결속은 강하지만, 실제 제품에 필요한 동역학·열·수명·전장·기능 안전·실물 계측은 아직 같은 수준으로 닫히지 않았다.

아래 점수는 현재 코드와 저장된 증거를 이용한 내부 우선순위 평가이며, 공인 성능시험이나 인증 결과가 아니다.

| 영역 | 현재 평가 | 현재 근거 | 다음 승격 조건 |
|---|---:|---|---|
| 로봇 CAD 생성·조립 | 8.5/10 | 29부품·68 mate target, 22 catalog apply, fail-closed post verify | 실제 부품 22종으로 최신 r+1 재생성 |
| 형상·운동·간섭 | 7.0/10 | isolated 156, coordinated 49, exact interference 경로 | 정의된 작업공간·payload·속도 envelope coverage |
| 정적 기계 설계 | 5.5/10 | 중력 토크, 기본 선정, housing fit | 축·하우징 강성, 공차, 베어링·볼트·수명 결속 |
| 동역학·열·내구 | 3.5/10 | 속도·가속도·jerk 입력과 일부 life 속성 | 역동역학, RMS/peak, torque-speed, 열평형, duty cycle |
| 케이블·전장 | 3.5/10 | 굽힘·비틀림·clearance 기본 검사 | 전 운동범위 swept route, 누적 twist, flex-life, 전장 문서 |
| 제어·기능 안전 | 2.0/10 | 안전 경계 입력과 release 비보증 정책 | hazard log, safety-function matrix, fault response, 전문가 검토 |
| 실물 검증 | 1.0/10 | receipt 없음 | 한 축 rig와 6축 시제품의 계측 receipt |
| 증거 추적·릴리스 통제 | 8.5/10 | revision/application/receipt/signature 결속 | 실제 산출물을 같은 target hash에 결속 |
| Robot Verified 상용 완성도 | **4.5~5.0/10** | 소프트웨어 후보는 강하고 물리 증거는 부족 | 22~24절의 승격 게이트 통과 |

일반 복잡 조립체도 동일하게 구분한다.

| 영역 | 현재 평가 | 판단 |
|---|---:|---|
| 공통 assembly·release 엔진 | 7.5/10 | mate/DoF, exact interference, motion, partial repair, release 경로가 강함 |
| 제품 시스템 의미 모델 | 7.5/10 | Graph v2가 요구·기능·기술·흐름·안전·제조·정비와 전 node/edge 증거 coverage를 fail-closed로 결속 |
| 제품군별 엔지니어링 | 6.5/10 | gearbox, machine/skid, welded/enclosure 전용 계산·증거 계약과 API·UI 완료; 실물 상관은 미완료 |
| 대규모 조립체 실증 | 3.5/10 | 20-body 수준 스트레스 검사는 있으나 100·500 occurrence 실측 부족 |
| 범용 복잡 제품 self-service | **4.5/10** | 세 family의 내부 설계 검증 경로는 열렸지만 golden/blind·제조·운영 전 broad GA를 주장하지 않음 |

## 20. STEP 호환과 시스템 데이터의 경계

기본 제품은 외부 CAD 설치 없이 NexyFab NFAB와 표준 STEP을 중심으로 운영한다. SOLIDWORKS·Fusion·Onshape와의 네이티브 연결은 기본 출시 blocker가 아니다.

다만 STEP 호환만으로 다음 정보가 자동 완결되지는 않는다.

- 모터·감속기 torque-speed와 duty curve
- 브레이크와 엔코더의 안전·제어 의미
- 케이블·하네스·커넥터와 전장 연결
- 제어 loop와 fault response
- 위험평가와 안전 기능
- 윤활·냉각·정비·교체 주기
- 요구사항과 시험 결과의 추적

따라서 NexyFab은 두 층을 유지한다.

1. **Geometry/Product Structure Layer**: NFAB, STEP AP242 계열 교환, occurrence, transform, PMI, 도면, BOM.
2. **Verified System Layer**: requirement, load, energy, signal, fluid, control, safety, service, test와 release receipt를 담는 NexyFab system graph.

STEP roundtrip은 형상·구조 호환 gate이고, Verified System graph는 제품 완결성 gate다. 둘 중 하나만 통과하면 로봇·복잡 제품 release를 허용하지 않는다.

## 21. 로봇 구체 개선 작업

### 21.1 요구사항 계약 v2

`nexyfab.robot-system-requirements.v2`에 다음을 필수화한다.

- payload: 정격 질량, 무게중심, 관성 tensor, 편심 범위
- reach와 작업공간: 허용·금지 공간과 설치 자세
- 성능: TCP 정확도, 반복도, 속도, 가속도, cycle time, duty cycle
- 환경: 온도, 오염, 습도, IP 목표, 케이블 수명 목표
- 동력: 공급 전압, peak/RMS power, 회생·제동 조건
- 안전 경계: intended use, foreseeable misuse, 사람 접근, cell 조건
- 제조: 재료, 공정, 공차, 검사 datum과 조립 방법
- authority: source artifact, approver, revision, hash

필수 권위 입력이 없으면 AI가 값을 추정해서 release하지 않고 `authoritative_input_required`로 멈춘다.

### 21.2 동적 구동계

각 축에 대해 다음을 계산하고 같은 design revision에 결속한다.

- 링크·구동부·payload를 포함한 역동역학
- payload 0, 정격, 편심, 최대 가감속, 급정지 load case
- peak/RMS torque와 motor torque-speed envelope
- 감속기 정격·peak·입력속도·효율·backlash margin
- 베어링 equivalent load, 정적 안전율과 L10 수명
- 브레이크 holding torque와 정전 낙하 방지 margin
- 모터·감속기·브레이크의 duty-cycle 열평형
- 축·하우징·링크의 처짐과 1차 고유진동수 margin

모든 margin은 양수여야 하며, 제조사 curve가 필요한 축에서 curve가 누락되면 `not_run`으로 남긴다.

### 21.3 위치 정확도 budget

다음 항목을 축 오차에서 TCP 위치·자세 오차로 전파한다.

- reducer backlash·lost motion
- bearing clearance와 shaft/housing deflection
- encoder accuracy, resolution, mounting eccentricity
- 축 동심도·직각도·stack-up
- 링크 가공·조립 공차
- thermal growth
- base installation과 TCP calibration

통과 기준은 `예측 worst-case TCP 오차 ≤ 동결 요구값`이고, 반복도는 실물 계측으로 별도 확인한다.

### 21.4 운동·케이블 coverage

기존 156/49 프레임은 결정적 회귀의 최저선으로 유지하되 전체 작업공간 증명의 의미로 사용하지 않는다.

- joint-space 저불일치 샘플과 workspace cell coverage
- singularity·collision 근처 적응형 세분화
- continuous time-of-impact와 최소 clearance
- payload 0·정격·편심 trajectory
- 최대 속도·가속도·jerk와 emergency-stop trajectory
- tool, workpiece, fixture, cell obstacle을 포함한 collision
- 전 범위 cable swept route, bend, twist, service loop, connector load
- 경로별 cycle count와 flex-life consumption

결과에는 검증된 작업공간 비율과 검증되지 않은 영역을 함께 기록한다.

### 21.5 전장·제어·안전 case

NexyFab은 인증을 자동 발행하지 않고 표준 정렬형 설계·증거 패키지를 생성한다.

- [ISO 10218-1:2025](https://www.iso.org/standard/73933.html): 산업용 로봇 자체 안전 요구의 기준선
- [ISO 10218-2:2025](https://www.iso.org/standard/73934.html): 애플리케이션·로봇 셀 통합 기준선
- [ISO 12100:2010](https://www.iso.org/standard/51528.html): 위험평가·위험저감 방법
- [ISO 13849-1:2023](https://www.iso.org/standard/73481.html): 안전 관련 제어부 설계 방법
- [IEC 60204-1:2016+A1:2021](https://webstore.iec.ch/en/publication/66124): 기계 전장 기준선
- [ISO 9283:1998](https://www.iso.org/standard/22244.html): 정확도·반복도 등 성능 시험 기준선

필수 산출물은 hazard log, safety-function matrix, required performance target, fault response, electrical one-line, I/O list, power budget, grounding·protection checklist와 잔여 위험 목록이다. 이는 공인 인증서가 아니며 전문가와 실제 적합성 평가를 대체하지 않는다.

표준 상태는 2026-08-12 확인 기준이며, 각 제품 release review 시작 시 ISO·IEC 공식 발행 상태와 적용 지역 법규를 다시 확인해 기준 revision을 receipt에 기록한다.

### 21.6 실물 검증

1. 한 축 rig: 정격·peak torque, backlash, brake hold, bearing temperature, encoder repeatability.
2. 3축 wrist 또는 부분 조립: cable twist, compact-axis interference, thermal coupling.
3. 6축 시제품: payload 0·정격·편심, 정확도·반복도, cycle time, 온도, 진동, cable motion.
4. 분해 검사: 마모, 체결 풀림, 케이블 손상, 윤활·씰 상태.
5. 설계값과 실측값 차이를 model-correlation receipt로 결속.

실측 장비, 교정 상태, 환경, 시험 횟수, 원시 데이터, 계산식과 판정자 서명이 없으면 물리 증거로 인정하지 않는다.

## 22. 복잡 제품 구체 개선 작업

### 22.1 Complex System Graph v2

기존 part·occurrence·interface graph를 다음 관계까지 확장한다.

- requirement → function → subassembly → part
- load·motion·power·fluid·signal flow
- fastener·weld·seal·bearing·gear mesh·shaft coupling
- electrical connector·sensor·actuator·controller
- safety function·hazard·risk-reduction measure
- manufacturing process·inspection datum·acceptance result
- assembly sequence·tool access·service envelope
- maintenance item·consumable·replacement interval

모든 계산과 시험은 graph node/edge와 artifact hash를 참조해야 하며, 출처 없는 관계는 release assertion에 사용할 수 없다.

### 22.2 제품군 전용 계약

| 제품군 | 필수 계산·검증 | 첫 physical evidence |
|---|---|---|
| Verified Gearbox | gear strength/contact, ratio, backlash, shaft·bearing life, housing stiffness, lubrication, seal, thermal, tolerance | 실제 gearbox 1건 조립·무부하/부하 운전 |
| Verified Machine/Skid | frame/base stiffness, equipment alignment, piping/port, service access, lifting, vibration, installation, commissioning | skid 또는 소형 장비 1건 제작·설치 검사 |
| Verified Welded/Enclosure | member sizing, weld joint/symbol, distortion, datum tolerance, sheet bend, door/seal, grounding, coating | welded frame 또는 enclosure 1건 제작·치수 검사 |
| Robot Verified Systems | 21절 전체 | 한 축 rig와 6축 시제품 |

압력용기와 터보기계는 위 제품군과 같은 gate로 승격하지 않는다. 압력 경계, 재료 추적, 규격 계산, NDE, 회전체·블레이드·진동 등 별도 고위험 계약과 전문가 release를 갖춘 뒤 독립 제품으로 연다.

### 22.3 대규모 조립체 benchmark

| 단계 | 목표 용도 | 측정 항목 |
|---|---|---|
| 20 occurrence | 소형 mechanism | 편집·solve·interference 즉시성 |
| 100 occurrence | 일반 기계·gearbox·skid | hierarchy, partial recompute, STEP structure |
| 500 occurrence | 생산설비·복잡 장비 | peak memory, worker 분할, progressive load |
| 1,000 occurrence | 검토·읽기 모드 | streaming, LOD, 검색, 선택, BOM |

각 단계에서 cold/warm import, first usable render, mate solve, exact interference, motion verification, export, save/resume, peak memory와 deterministic hash를 기록한다. 500/1,000 occurrence에서 모든 기능이 실시간이어야 한다고 가정하지 않고, 편집·검토·배치 작업별 SLA를 따로 정한다.

## 23. 승격 게이트

### Robot Verified Systems

| 단계 | 필수 조건 | 허용 표현 |
|---|---|---|
| Software Candidate | 현재 로봇 테스트와 29/68/22/0 fail-closed 계약 | 내부 개발 후보 |
| Engineering Candidate | 실제 catalog 22종, dynamic/thermal/life/accuracy/cable case 전부 실행 | Robot Engineering Candidate |
| Verified Pilot | exact r+1, 한 축 rig, 6축 prototype, signed manufacturing·inspection receipt | Robot Verified Pilot |
| Product-specific Verified Release | 동결 사양 1개에 대해 안전 case·이중 검토·실측 요구 통과 | 해당 모델·사양에 한정된 Verified Release |

한 제품의 Verified Release를 다른 payload, reach, reducer, controller 또는 cell로 자동 확장하지 않는다.

### 복잡 제품군

| 단계 | 필수 조건 |
|---|---|
| Family Candidate | 직접 설계 golden 5건, 필수 assertion coverage 100% |
| Verified Pilot | golden 5 + blind 5 + 실제 제작·조립 1건 + false-verified 0 |
| Family GA | 독립 20건, 3회 연속 regression, 7일 운영, 공개 scope/limit |

`general complex product self-service`라는 통합 PASS는 만들지 않는다. Gearbox, Machine/Skid, Welded/Enclosure, Robot이 각각 독립적으로 승격한다.

## 24. 구현 우선순위와 완료 순서

1. **R0—정본화**: 361개 작업 트리를 clean release candidate로 결속한다.
2. **R1—계약 구현**: robot requirements v2, system graph v2, 새 receipt schema와 fail-closed tests.
3. **R2—로봇 엔지니어링**: dynamics, thermal, life, accuracy, cable coverage.
4. **R3—안전·전장 지원**: hazard/safety-function/electrical evidence package. 인증 자동 보증은 금지한다.
5. **R4—복잡 제품 공통 확장**: system flow, service, manufacturing trace와 20/100/500 benchmark.
6. **R5—제품군 전용화**: gearbox → machine/skid → welded/enclosure 순으로 golden 5건.
7. **R6—물리 실증**: robot rig·prototype과 제품군별 제조 1건.
8. **R7—승격**: blind·독립·운영 증거를 채운 제품군만 개별 GA.

R1~R5는 코드와 내부 직접 설계로 진행할 수 있다. R6~R7의 실제 부품, 제조, 계측, 교정과 전문가 서명은 소프트웨어 테스트로 대체하지 않는다.

## 25. 2026-08-12 로봇 엔지니어링 구현 스냅샷

### 25.1 이번 구현에서 닫힌 소프트웨어 범위

다음 계층은 계획 문구가 아니라 실행 가능한 fail-closed 코드, API와 직접 회귀로 구현했다.

| 계층 | 구현 결과 | 릴리스 경계 |
|---|---|---|
| 동결 요구사항 v2 | 6축, payload 0/정격/편심, 성능·환경·전원·위험·안전기능·제조 권한을 raw/canonical SHA-256에 결속 | 요구사항 통과만으로 릴리스하지 않음 |
| 6R 동역학 | DH 기구학, 질량행렬, 중력, Coriolis, 외력, 마찰, torque-speed curve, RMS·peak·power·회생 에너지 계산 | 한 payload/path 조합의 계산 결과 |
| 듀티 열 | motor/reducer/brake 손실과 1차 열 노드를 반복 주기 정상상태까지 계산 | 실제 손실곡선·온도 실측 필요 |
| 베어링·감속기 수명 | 하중 spectrum, 기본 정격수명, 누적 손상, 정적 안전율, reducer torque/speed/life 계산 | 실제 spectrum과 내구시험 필요 |
| 구조 강성 | 6축 Jacobian, 최소 관절 비틀림 강성, 링크 상한 컴플라이언스로 자세·하중별 TCP 처짐 계산 | FEA/rig 상관·강성 실측 필요 |
| TCP 오차예산 | backlash, encoder, mounting, manufacturing, thermal, structural, calibration을 자세별 TCP로 전파 | RSS는 진단용이며 worst-case 합으로만 합격 |
| Engineering Analysis Packet | 동역학을 독립 재계산하고 모든 입력을 동일 요구사항·경로·payload·기구 모델에 교차 결속 | `fullRequirementsCoverageComplete=false`, 외부 실증 false, release false |
| 제품 UI | 7개 분석 상태, application hash, 오류와 외부 실증 blocker를 표시·다운로드 | 모순되거나 release를 주장하는 응답 거부 |

새 API는 다음과 같다.

- `POST /api/cad/v1/robot/requirements/verify`
- `POST /api/cad/v1/robot/dynamics/evaluate`
- `POST /api/cad/v1/robot/thermal/evaluate`
- `POST /api/cad/v1/robot/life/evaluate`
- `POST /api/cad/v1/robot/compliance/evaluate`
- `POST /api/cad/v1/robot/precision/evaluate`
- `POST /api/cad/v1/robot/engineering/analyze`

모든 API는 크기 제한과 rate limit을 적용하며 CAD 수정, 저장, 견적, RFQ와 생산 릴리스를 수행하지 않는다.

### 25.2 검증 결과

- 전체 로봇 라이브러리·API·핸드오프 UI 회귀: **64 files / 265 tests PASS**
- 전체 TypeScript 검사: **PASS**
- 신규·변경 범위 ESLint: **PASS**
- TCP 1 m lever, 구조 처짐 1 m/10 N/100 kNm·rad, 정적 중력, 점질량 관성, 2-link Coriolis 등 독립 해석해 fixture 포함
- forged dynamic report, stale hash, 비물리 inertia/compliance, 요구조건 불일치, 구조 처짐 축소 기재, 불충분 수명·열·drive curve를 fail-closed로 거부

이 결과는 `Software Candidate`의 계산·결속 완성도를 크게 높이지만 실제 catalog 22종, 전체 조합 분석, 물리 시험과 서명이 없으므로 `Verified Pilot` 또는 상용 `Verified Release` 증거가 아니다.

### 25.3 현재 정확한 상태 평가

| 영역 | 현재 상태 | 다음 승격 조건 |
|---|---|---|
| AI 정밀 기계 CAD 코어 | 상용 후보 코드가 강하지만 전체 dirty tree와 전 제품 실증 때문에 RC 미확정 | clean baseline, build/security, 20건 독립·피처 30종 3회·제조 3건 |
| Robot Verified Systems | 생성·29/68 구조·22 catalog 통합, 전 payload/path 계산, motion/cable, safety/electrical, 물리 receipt 검증, 서버 서명 감사 v2와 최종 이중검토까지 구현 | 실제 catalog와 현재 revision 실행, rig/wrist/prototype/endurance 원시 증거 |
| 일반 복잡 조립체 | System Graph v2와 3개 family 계산 계약·API·UI 완료; 내부 Software Candidate | golden/blind, 20/100/500/1,000 benchmark, 제품군별 실제 제조·시운전 |

현재 작업 트리는 **361 항목(추적 변경 210, 미추적 151)** 이다. 이는 기능 부족과 별개의 release-engineering 위험이다. 사용자 소유 변경을 임의로 버리지 않고, 변경 출처·의존성·테스트를 묶어 clean release candidate로 승격해야 한다.

### 25.4 바로 이어갈 구현·실증 순서

1. **RC 결속**: 전체 build, security/API-control gate, 변경 인벤토리, 재현 가능한 baseline.
2. **Robot evidence execution**: 구현 완료된 payload/path matrix, motion/cable, safety/electrical gate를 실제 catalog와 현재 revision으로 실행한다.
3. **Physical receipt campaign**: joint rig → wrist → 6축 prototype → endurance/teardown의 27개 계측에 raw data·교정·불확도·as-built BOM·이중 서명을 채운다.
4. **Signed audit operation**: 운영 secret manager에 audit signer와 공개키 registry를 분리 배치하고 key rotation·폐기·복구 훈련을 수행한다.
5. **Complex products evidence**: 구현된 Graph v2와 Gearbox → Machine/Skid → Welded/Enclosure 계약으로 각 golden 5·blind 5·제조 1을 실행한다.
6. **Scale/operations**: 20/100/500/1,000 occurrence benchmark와 Redis 포함 7일 운영.
7. **승격**: 독립 20건, 핵심 피처 30종 외부 3회 폐루프, 제조 파일럿 3건을 완료한 제품군만 개별 GA.

경쟁 우위는 “AI가 형상을 빠르게 생성한다”가 아니라 **요구사항 → 계산 → 실제 CAD → 제조·측정 → 독립 승인**의 손실 없는 폐루프와, 무엇이 아직 검증되지 않았는지를 제품 화면과 receipt에서 정확히 보여주는 데 둔다.

## 26. 2026-08-12 복잡 제품 구현 스냅샷

### 26.1 구현·제품 경계

- `nexyfab.complex-system-graph.v2`는 제품, 요구사항, 기능, 하위조립체, 부품, 인터페이스, 구동기, 센서, 제어기, 위험, 위험저감, 안전기능, 공정, 공급자, 검사, 인수, 공구·서비스, 정비·소모품을 엄격한 node 계약으로 검증한다.
- hierarchy와 requirement→function→technical realization, hazard→risk reduction→safety function, part→make/buy→inspection→acceptance를 전부 검사한다.
- 업로드 artifact의 파일명·byte SHA-256·누락·초과를 검증하고 모든 node와 edge가 evidence subject에 포함돼야 `graphReady=true`가 된다.
- Gearbox 계약은 ratio·direction·torque, gear bending/contact, shaft, bearing life/static, backlash, housing deflection, thermal, lubrication, seal을 재계산한다.
- Machine/Skid 계약은 mass/envelope, frame/load path, anchor, alignment, vibration separation, lifting/CG, port, service/removal, transport/tie-down을 재계산한다.
- Welded/Enclosure 계약은 member, weld capacity, sheet bend/relief, distortion/datum, door/hinge/seal, grounding, coating, ingress **design**을 검사한다. 공인 ingress 인증은 주장하지 않는다.
- Assembly AI 화면의 `Complex-product Verified Systems verification` 패널에서 공통 graph·artifact와 제품군 계약을 업로드·검증·다운로드한다. graph 변경 시 모든 결과를 폐기하고 release/side-effect를 주장하는 모순 응답을 거부한다.
- revision change-impact engine은 이전·현재 graph와 양쪽 artifact bytes를 재검증하고 artifact/node/edge/evidence delta에서 요구→기능→실현, containment와 안전 추적 dependency cone을 계산한다. 무관한 evidence만 재사용하고 변경 영향 evidence는 stale로 격리한다.
- scale benchmark 계약은 20/100/500/1,000 occurrence별 cold 3회·warm 3회, 총 24회와 import/render/edit/mate/interference/motion/부분 재계산/save-resume/STEP/메모리/worker queue, 여섯 fidelity hash, reviewer-approved SLA artifact를 요구한다.

### 26.2 검증 결과와 정확한 한계

| 항목 | 결과 |
|---|---:|
| Graph·3 family·change impact·scale library/API/UI·기존 Assembly AI 통합 | 14 files / 68 tests PASS |
| 기존 CPU large-assembly 실제 진단 | 5/5 PASS—100 build 11ms/74KB, 1,000 build 30ms/0.72MB, 5,000 build 108ms/3.62MB, 1,000 traverse 0.51ms, merge 122ms |
| 변경 범위 ESLint | PASS |
| 전체 TypeScript | PASS |
| 복잡 제품 UI·system API 선택 프로덕션 build | PASS—compile, 전체 TypeScript, page data, static generation, trace |
| CAD API 통제 | 83 route files / 85 handlers, issue 0 |
| 라우트 보안 | 607 routes / 837 handlers, gap 0 |
| secret scan | 7,657 files / 88,863,058 bytes, finding 0 |

이 결과는 **내부 설계 계산 Software Candidate**를 의미한다. 실제 gearbox 시험 리그, skid 시운전, 용접·치수·ingress 시험, 독립 전문가 승인과 같은 revision의 서명 receipt는 아직 없다. 따라서 `physicalValidationComplete`, `physicalCommissioningComplete`, `ingressCertificationClaimed`, `releaseReady`는 계속 false다.

위 CPU large-assembly 진단은 synthetic Three.js 장면의 생성·순회·병합 기준선이며 browser first usable/editable, mate·exact interference·motion, STEP save/resume와 고정환경 24-run 독립 receipt를 대체하지 않는다.

### 26.3 경쟁력 있는 다음 개선

1. 각 family를 임의 샘플이 아니라 `golden 5 → blind 5 → 실제 제작 1`의 독립 승격 단위로 운영한다.
2. Graph v2에서 한 부품 변경 시 영향받은 계산·mate·도면·BOM·검사만 stale 처리하는 change-impact engine을 추가한다.
3. 20/100/500/1,000 occurrence에서 first editable, partial recompute, exact interference, STEP 구조 보존, peak memory를 고정환경 receipt로 남긴다.
4. 계산 결과와 실제 측정의 오차를 model-correlation receipt로 누적해 family별 안전 margin과 추천 신뢰구간을 보정한다.
5. 공장·설계기업에는 graph/contract 템플릿, revision diff, 승인 inbox, 제조 검사 연결을 제공하고 스타트업에는 요구사항 wizard와 검증 blocker 해결 순서를 제공한다.
6. pressure vessel과 turbomachinery는 일반 family 이름으로 우회 지원하지 않고 규격·재료 추적·NDE·회전체 진동·전문가 계약이 생길 때까지 Verified Release 비지원으로 유지한다.

## 27. 릴리스 변경 인벤토리 기준선

2026-08-12 최신 검증 직후 `git status --porcelain` 기준은 **361 항목—추적 변경 210, 미추적 151**다. 이 숫자는 하나의 완성된 커밋을 뜻하지 않으며, 사용자·공유 작업과 이번 구현이 섞인 작업 트리의 검토 대상 수다.

| 최상위 범위 | 항목 수 | 검토 묶음 |
|---|---:|---|
| `src` | 290 | 제품 코드, API, UI, 직접 테스트 |
| `docs` | 36 | 정본·runbook·schema·생성 evidence |
| `scripts` | 30 | 검증·scaffold·release/security 도구 |
| `e2e` | 3 | responsive, 접근성, guest network |
| `.env.example` | 1 | 운영 trust/rate-limit 환경 계약 |
| `package.json` | 1 | 실행·검증 스크립트 |

`src`의 1차 분포는 API 112, AI library 92, 다국어 제품 UI 38, NexyFab 공통 component 8, 인증·조직·제조·기타 library/test 40이다.

### 27.1 검토·고정 순서

1. **AI Mechanical Core**—30 feature, design graph, STEP/NFAB, release channel, 정확도 gate.
2. **Robot Verified Systems**—29/68/22/0 CAD chain, engineering/motion/cable/safety/physical/signed audit.
3. **Complex Product Families**—Graph v2, Gearbox, Machine/Skid, Welded/Enclosure, 실행 UI.
4. **Commercial Trust**—조직 격리, 거래 lineage, 제조 검사, auth/session, 서버 quota/rate limit.
5. **Product UX**—기계 우선 IA, Spatial Labs 분리, 모바일·접근성, 신뢰 상태 표시.
6. **Evidence Tooling**—독립 20건, 30피처 3회, 제조 3건, holdout acquisition, 보안 생성기.
7. 각 묶음별 direct test와 diff를 검토한 뒤 전체 test/type/lint/security/build를 동일 commit에서 다시 실행한다.

사용자 소유 변경을 임의로 삭제·reset·squash하지 않는다. clean RC는 위 묶음의 소유·의도 검토와 승인된 staging 뒤에만 확정한다. 현재 검증된 공식 전체 build는 Graph v2 추가 전 291/291 PASS이고, Graph v2 추가분은 별도 선택 프로덕션 build PASS다. 최종 RC commit에서는 전체 clean build를 한 번 더 실행한다.
