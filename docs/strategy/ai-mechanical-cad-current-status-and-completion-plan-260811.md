# NexyFab AI 정밀 기계 CAD 현재 상태 및 완성도 향상 계획

- 기준 시각: 2026-08-12 KST
- 적용 범위: `mechanical-core`, `robot-verified-systems`, 기계 계열 복잡 조립체
- 문서 상태: 현재 상태·다음 실행 게이트 정본
- 제품 전략 정본: `docs/strategy/ai-mechanical-cad-category-dominance-plan-260811.md`
- 상용 경쟁·서비스 평가: `docs/NEXYFAB_COMMERCIALIZATION_CURRENT.md` 9~18절

## 0. 2026-08-12 상용화 클로저 판정

현재 소스의 **로봇·정밀 CAD 범위와 저장소 전체 clean 프로덕션 빌드는 통과**했다. 저장소 전체 릴리스 후보는 작업 트리 정본화가 남아 아직 확정하지 않았고, **private beta와 GA도 승인하지 않았다.** 코드 품질과 실제 제품·제조·운영 증거를 분리해 판정한다.

- 내부 기계 CAD 영수증: 30개 코어 피처, 무손실 설계 그래프, NFAB/STEP 3회, 기계 정확도, 타입 검사 모두 PASS
- 로봇 소프트웨어: 64파일 265테스트 PASS, 22개 catalog occurrence부터 전 조합 계산·물리 receipt·서버 서명 감사 v2·최종 이중검토까지 교차 해시 결속 완료
- 상용 계정 경계: 개인/조직별 프로젝트, 파일, 사용량, AI 비용, AI 이력, 설계 리뷰, 결제·주문 접근을 active workspace에 결속
- 거래 계보: release v2 → RFQ → quote → contract/order를 원자적으로 생성하고 결제·환불·검사 시점마다 release 유효성을 재검사
- 제조 검사: 주문·release hash에 결속된 신뢰 검사자 서명 receipt를 추가하고 불일치·취소 release를 fail-closed 처리
- 게스트 안정성: 중앙 session probe 하나만 사용하며 게스트 상태에서 notification/refresh 연쇄 4xx를 제거
- 2026-08-11 당시 로봇 품질 게이트: 64파일/265테스트, 전체 TypeScript, 변경범위 ESLint, 로봇 선택 프로덕션 빌드 PASS. Graph v2·3 family·change impact·scale·UI 통합 14파일/68테스트 PASS. 당시 CAD API 79/79 issue 0, 보안 라우트 569개/783 handler gap 0, 비밀정보 스캔 6,903파일 finding 0. 2026-08-23 권위값은 CAD API 83 route files/85 handlers, 보안 607 route files/837 handlers, secret scan 7,657 files/88,863,058 bytes/finding 0이다.
- 저장소 전체 build: 신규 제품군 승격 변경을 포함한 공식 clean `ci:replicate-build` 513.4초 PASS, 291/291 페이지와 postbuild bundle budget 완료. RC는 대규모 공유 작업 트리 정본화 때문에만 별도 차단

2026-08-12 상용화 gate의 정직한 결과는 다음과 같다.

| 항목 | 현재 값 | 판정 |
|---|---:|---|
| 직접 설계 package | 0/30 | 첫 10건 전 private beta 차단 |
| 30피처 외부 artifact 폐루프 | 0/30 | GA 차단 |
| 의도 정확도 campaign | 0/150 | GA 차단 |
| 내부 blind product challenge | 0/20 | GA 차단 |
| CNC·판금·적층 제조 | 0/3 | 제조 release 차단 |
| 7일 실제 운영 | receipt 없음 | GA 차단 |
| 작업 트리 | 201 tracked change + 150 untracked | 릴리스 기준선 확정 차단 |

실제 실행 파일을 채울 저장소 외부 작업공간은 `C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260812`에 생성했다. 30개 직접 설계, 20개 blind challenge, 제조 3개 workbook은 모두 `releaseEligible=false`로 시작하며 실제 artifact와 승인 없이 자동 승격되지 않는다.

## 1. 결론

NexyFab의 현재 상태는 다음 세 문장으로 정리한다.

1. **AI 정밀 기계 CAD 코어는 상용 후보 수준이다.** 핵심 30개 피처 계약, 무손실 설계 그래프, NFAB/STEP 3회 왕복, 실제 커널 형상 실행과 fail-closed 경계가 구현돼 있다. 다음 단계는 기능 존재 증명이 아니라 직접 설계한 실제 산출물 30건으로 정확도와 사용자 작업 완주를 증명하는 것이다.
2. **Robot Verified Systems의 소프트웨어 검증 체인은 구현 완료됐고 실제 실행·실증이 남았다.** 29부품, 68 mate, 구동계 18개와 보조부품 4개, 총 22개 catalog occurrence, unresolved 0뿐 아니라 전 payload/path 계산, 연속 motion, cable life, safety/electrical, 27개 물리 계측 receipt, 서버 서명 감사 v2와 감사 이후 이중검토를 강제한다. 실제 artifact가 없는 테스트 fixture는 제품 검증 증거가 아니다.
3. **일반 복잡 조립체는 공통 엔진이 강하지만 제품군별 완결성이 부족하다.** 정밀 선택 편집, mate/DoF, 실제 OCCT 형상 기반 간섭, 연속 운동, release certificate 경로는 구현됐다. 그러나 참조 제품군 8개 중 4개만 전체 검증됐고 4개는 의미·운동·질량 검증 일부가 `not_run`이다.

외부 SOLIDWORKS, Fusion 또는 Onshape 설치와 제품별 C4 실증은 기본 출시 조건에서 제외한다. 기본 상품은 **NexyFab 자체 CAD와 표준 STEP 교환**을 보증 범위로 삼는다. 특정 상용 CAD 이름을 사용한 인증·완전 호환 마케팅이 필요할 때만 별도 선택 검증을 수행한다.

## 2. 확인된 최신 기준선

### 2.1 검증 결과

2026-08-12 최신 작업 소스에서 다음을 다시 실행했다.

| 범위 | 결과 | 의미 |
|---|---:|---|
| 기계 코어 직접 검증 | 11파일, 89테스트 통과 | 30개 피처 계약, 런타임 경로, 설계 그래프, NFAB/STEP 왕복 |
| 기계 정확도 | 9파일, 49테스트 통과 | 실제 커널 STEP 재수입, hole/assembly/body-count 회귀 |
| 로봇 | 64파일, 265테스트 통과 | 생성, catalog/r+1/post, engineering coverage, motion/cable, safety/electrical, physical receipt, signed audit/UI/API |
| 일반 복잡 조립체 | 13파일, 104테스트 통과 | mate/DoF, 실제 형상 간섭, 연속 운동, 선택 편집, release certificate |
| 조직·거래·제조 계보 | 9파일, 43테스트 통과 | active workspace 격리, 원자 quote 수락, release·inspection 결속 |
| 인증·모바일 접근성 | 8파일, 24테스트 통과 | 단일 session probe, guest 4xx 제거, sidebar/drawer/mobile 회귀 |
| 전체 Vitest | 8/8 shard 성공, 27,218 pass, 0 fail | 27,308개 중 pending/skip 89개와 todo 1개는 성공 수치에 포함하지 않음 |
| Node 전체 테스트 | 326 pass, 0 fail, 1 skip | evidence·보안·복구·상용 게이트·scaffold 계약 |
| TypeScript | 전체 통과 | 현재 공유 소스 그래프 타입 일관성 |
| ESLint | 전체 `src` 오류 0 | 상용 변경 전체 정적 검사 |
| 로봇 선택 프로덕션 build | PASS | 로봇 UI/API 컴파일, 전체 TypeScript, 페이지 생성, 보안 헤더 |
| 저장소 전체 clean 프로덕션 build | PASS | 513.4초, 291/291 페이지, standalone prune·sync와 bundle budget 완료 |
| 보안 | PASS | 2026-08-11 스냅샷: CAD API 79/79, 569 route, 783 handler, gap 0, secret 6,903파일 finding 0. 최신값은 위 갱신 문단 참조 |

전체 `npm test` 단일 프로세스는 15분 제한에서 최종 집계 전에 종료됐으므로 Vitest를 8개 결정적 shard로 분할했다. 최초 shard 실행에서 조직 격리 인자 추가를 반영하지 못한 오래된 기대값 4개를 발견했고, 이 과정에서 Studio AI guard가 조직 비용 예산 대신 개인 버킷을 조회하던 실제 누락 1건도 수정했다. 수정된 두 shard를 다시 실행한 최종 JSON은 8/8 `success=true`, 27,218 pass, 0 fail이며 Node 축도 326 pass, 0 fail이다. jsdom navigation/WebGL 로그는 테스트 실패와 분리된 환경 경고로 남는다.

기계 피처 런타임은 등록된 38개 중 35개가 단독 형상을 생성한다. `bendRelief`, `deleteFace`, `offsetFace` 3개는 선택, 선행 피처 또는 정밀 B-Rep 문맥이 필요하므로 문맥 없이 통과시키지 않는다. 빈 형상 0, apply 경로 없음 0이다.

### 2.2 릴리스 상태

점검 시작 시 작업 트리는 152개 항목이었고, 구현·증거 도구·테스트를 통합한 현재 작업 트리는 361개 항목이다.

- 추적 변경 파일 200개
- 신규 파일 138개
- staged 파일 없음

이 숫자는 기능 실패가 아니라 아직 하나의 재현 가능한 릴리스 후보로 고정되지 않았다는 뜻이다. 문서 작업 뒤 숫자는 달라질 수 있으므로 최종 기준선은 커밋과 새 evidence receipt로 다시 측정한다.

현재 `mechanical-core` v3 gate에서 private beta blocker는 `current_release_working_tree_dirty`, 우선 직접 설계 10건 미완료, 기계 제품 private beta 미승격이다. GA에는 30피처 폐루프, 직접 설계 30건, 의도 입력 150건, 표준 STEP conformance, blind challenge 20건, 제조 3건과 7일 운영 receipt가 남아 있다. SOLIDWORKS·Fusion·Onshape 제품별 검증은 기본 출시 blocker가 아니다.

### 2.3 운영 상태

현재 7일 운영 receipt는 없다. 과거 표본은 6시간 1개뿐이며 웹 서비스는 768MB 정책 한도에서 최고 883.2MB를 기록했다. 2026-08-12 프로덕션 build도 `REDIS_URL` 미설정으로 다중 인스턴스 rate limit이 메모리 fallback임을 경고했다. 따라서 Redis 연결, 메모리 한도 조정 또는 최적화, 실제 복구·롤백·부하 관찰을 포함한 새 7일 campaign이 필요하다.

## 3. 증거 정책 v2

### 3.1 기본 출시에서 제거하는 조건

- SOLIDWORKS·Fusion·Onshape 설치
- 세 제품에서 동일 파일을 열고 되돌리는 C4 의무
- 합법적 외부 CAD 원본 32건 확보를 기계 코어의 선행 조건으로 사용하는 것
- 외부 기관의 20건 독립 검증과 40개 서명을 기본 제품의 필수 조건으로 사용하는 것
- 공간 설계 4개 분야의 준비도를 기계 CAD 출시와 결합하는 것

제거된 항목은 선택적 상호운용성·마케팅·Enterprise 검증 트랙으로 보존할 수 있지만 기본 제품을 차단하지 않는다.

### 3.2 반드시 유지하는 조건

- 실제 B-Rep 생성과 유효성 검사
- NFAB 저장·복원 및 STEP export/re-import 3회
- 잠금 치수, 단위, 피처 ID, 요구사항, revision과 산출물 hash 보존
- 미지원·미실행·근사 검사를 통과로 표시하지 않는 fail-closed 정책
- 직접 설계한 블라인드 과제와 구현자에서 분리된 내부 검토
- 절삭·판금·적층 산출물의 실제 제작과 치수 검사
- 로봇 구매 부품의 추적 가능한 사양·정격·장착 치수
- Redis를 포함한 실제 배포 환경의 운영 검증

### 3.3 외부 연결과 물리 증거의 구분

외부 CAD 연결은 없어도 된다. 그러나 다음 사실은 코드가 임의 생성하면 안 된다.

- 구매 모터·감속기·베어링·브레이크·엔코더의 실제 정격과 외형 치수
- 재료 물성, 공차, 하중, 사용률과 안전계수
- 가공·판금·적층 후 실측 치수와 조립 결과
- 실제 운영 메모리, 오류율, 지연시간과 복구 결과

이 값은 외부 CAD 의존성이 아니라 물리 제품의 권위 입력과 관측 결과다.

## 4. AI 정밀 기계 CAD 코어 향상 계획

### 4.1 현재 강점

- Mechanical Design Graph가 원본 payload, stable ID, lineage, 잠금값과 opaque 노드를 보존한다.
- AI는 허용된 intent와 feature만 실행하며 unknown feature와 위험한 inline 변형을 거부한다.
- 핵심 30개 피처는 실제 런타임 build 경로에 결속돼 있다.
- NFAB와 STEP의 3회 왕복 기반이 통과한다.
- 결과 STEP, BOM, 도면과 입력 옵션을 동일 revision manifest에 결속할 수 있다.

### 4.2 남은 정확도 공백

1. 현재 통과의 중심은 코드·fixture 회귀이며 사용자가 실제로 내려받는 30개 기준 설계 패키지가 없다.
2. 자연어 표현의 폭, 단위 혼용, 모호한 요구, 불가능한 요구에서의 정답률을 별도 측정하지 않는다.
3. 문맥 의존 피처 3개와 복합 선택·참조가 긴 편집 체인에서 충분히 검증되지 않았다.
4. STEP 왕복은 기본 형상에서 강하지만 모든 피처의 제조 핵심 치수와 의미를 증명한 것은 아니다.
5. 도면의 기준면, 치수, 공차, GD&T와 BOM까지 30개 설계 모두에서 폐루프가 완성된 것은 아니다.

### 4.3 직접 설계 30건

핵심 피처마다 하나의 장난감 형상이 아니라 제조 맥락이 있는 기준 부품을 만든다.

- 기계가공 12건: 브래킷, 플레이트, 샤프트, 부싱, 플랜지, 하우징, 지그
- 판금 8건: 베이스, 커버, 제어함, 탭·플랜지·벤드·릴리프 조합
- 회전·스윕·로프트 5건: 노즐, 덕트, 핸들, 전이부, 나선 형상
- 패턴·멀티바디·불리언 5건: 홀 배열, 체결 패턴, 분할·결합, 반복 부품

각 case는 다음 산출물을 실제 파일로 남긴다.

1. 잠금 요구사항과 허용 공차
2. 최초 AI intent와 Mechanical Design Graph
3. 생성 B-Rep 및 형상 유효성 보고서
4. 사람 수정과 revision-bound AI patch
5. NFAB 3회 및 STEP 3회 산출물
6. STEP 재수입 형상 비교
7. 도면, BOM과 package manifest
8. 실패 음성 대조군

완료 기준:

- 30/30 case 완주
- 각 case 3회 NFAB와 3회 STEP cycle 완주
- 잠금 파라미터 drift 0
- stable feature ID와 selection의 silent remap 0
- 단위와 body/occurrence 수 불일치 0
- B-Rep invalid 또는 빈 형상 0
- STEP 수치 허용치는 case별 제조 공차보다 엄격하게 선언하고 초과 시 실패
- 미실행 검사를 녹색으로 표시한 case 0

### 4.4 AI 의도 정확도

30개 case마다 최소 다섯 가지 입력 표현을 만든다.

- 한국어 실무 표현
- 영어 실무 표현
- 단위가 섞인 표현
- 일부 필수값이 누락된 표현
- 의도적으로 모순되거나 제조 불가능한 표현

최소 150개 입력을 `parse → requirements → plan → geometry → verification` 단계별로 평가한다. 하나의 평균 점수로 합치지 않고 다음을 별도로 보고한다.

- intent 분류 정확도
- 필수 요구사항 추출 coverage
- 권위 입력 누락 탐지율
- 잘못 실행된 피처 수
- 생성 성공 후 검증 실패율
- false-verified 수
- 제한 횟수 내 수정 성공률

모호한 입력을 정확히 거부하거나 질문하는 것도 성공으로 집계한다. 무조건 형상을 생성하는 비율을 정확도로 사용하지 않는다.

### 4.5 정밀 CAD 편집 정확도

- face/edge 선택을 위치 인덱스가 아니라 안정 reference와 기하 signature에 결속한다.
- suppress/reorder/replace가 하류 피처에 미치는 영향을 적용 전에 계산한다.
- context 피처 3개는 실제 선행 bend와 실제 선택 face를 가진 case로 검증한다.
- 단일 수정, 연속 10회 수정, branch 후 재결합의 세 수준을 분리한다.
- topology가 바뀔 때 자동 재지정과 사용자 확인이 필요한 경우를 구분하고 침묵 재매핑을 금지한다.

### 4.6 기계 코어 승격 게이트

| 채널 | 승격 조건 |
|---|---|
| 내부 후보 | 현재 89테스트, 기계 accuracy, typecheck, build 통과 |
| 비공개 Beta | 깨끗한 커밋·재현 build, 30개 중 우선 10개 실제 package, 치명적 false-verified 0 |
| 상용 Candidate | 30/30 package, 150개 intent 평가, 절삭·판금·적층 3건 제작, 72시간 운영 |
| GA | 30/30 유지, 제조 3건 실측 통과, 7일 운영, 백업·복구·결제·보안·지원 절차 통과 |

## 5. Robot Verified Systems 향상 계획

### 5.1 구현 완료에 가까운 부분

- 6축 요구사항과 deterministic kinematic chain
- 25부품 placeholder 설계에서 catalog를 적용한 29부품 r+1 생성 경로
- 기본 60 mate에서 보조부품 통합 후 68 mate 경로
- 모터·감속기·베어링 18개와 보조부품 4개의 엄격한 admission/selection
- 22/22가 아니거나 unresolved가 남으면 apply 거부
- target, lineage, source/output revision, program, application, receipt, precision, catalog와 housing hash 결속
- 156개 단일 축 및 49개 협조 동작 프레임 검증
- 충돌·정밀 간섭·모순된 passed report 거부
- exact-CAD, 제조 검증과 최종 검토용 v3 work packet
- 소스와 live workspace를 바꾸지 않는 다운로드형 r+1

### 5.2 현재 증거 공백

- 최신 코드로 생성한 실제 29부품 r+1 정본이 evidence 폴더에 없다.
- 실제 선택 부품 22개의 사양 artifact와 housing capacity가 확정되지 않았다.
- 이전 25부품 demonstrator 감사가 최신 구현을 대표하고 있다.
- 운동 검증은 설계 좌표계에서 강하지만 실제 제작 공차, 백래시, 처짐과 케이블 수명을 포함하지 않는다.
- 실물 또는 축소형 로봇 조립·구동 결과가 없다.

### 5.3 정확도 향상 순서

1. **요구사항 동결**: payload, reach, repeatability 목표, 속도, duty cycle, 작업공간, 설치 자세, 전원과 안전 경계를 고정한다.
2. **22개 부품 입력 확정**: 외부 CAD 파일 대신 datasheet의 정격, 외형, 축, 플랜지, 질량, 관성, 커넥터와 케이블 조건을 해시 결속한다.
3. **구조부 직접 설계**: base, shoulder, upper arm, forearm, wrist, flange와 housing을 선택 부품·가공·조립 공차에 맞게 재설계한다.
4. **29부품 r+1 실행**: 18 replacement와 4 auxiliary addition을 실제 apply하고 68 mate, unresolved 0을 확인한다.
5. **정적 검증**: 축별 토크, 감속기 출력, 베어링 하중·수명, 볼트, 처짐, 응력, 질량·관성, 무게중심을 확인한다.
6. **운동 검증**: 156/156, 49/49 외에 payload 0/정격/편심 세 조건, 속도·가속도 제한, near-singularity와 cable bend/twist를 확인한다.
7. **공차 검증**: 축 동심도, 베어링 끼워맞춤, reducer pilot, stack-up, backlash와 말단 위치 오차 budget을 결속한다.
8. **시제품 검증**: 최소 한 축 rig와 축소형 또는 완전한 6축 시제품을 조립해 간섭, 반복 위치, 온도와 케이블 거동을 측정한다.

### 5.4 로봇 완료 게이트

- 실제 r+1: 29부품, 68 mate
- catalog: drive 18 + auxiliary 4 = 22/22, unresolved 0
- isolated motion: 156/156, collision 0
- coordinated motion: 49/49, collision 0
- precise interference: 0
- 선택 부품 정격 margin: 모든 축 양수, 요구 safety factor 충족
- housing와 shaft/bearing/reducer interface: 선언 공차 내
- BOM·도면·STEP·검증 report: 동일 revision/hash
- exact-CAD와 manufacturing evidence: 동일 application/receipt target
- 실제 시제품: 조립 가능, 필수 실측 통과

이 게이트를 통과하기 전 상품명은 `Robot Verified Pilot`로 제한한다. 통과 후에도 안전 기능과 산업용 인증을 자동 보증하지 않는다.

## 6. 일반 복잡 조립체 향상 계획

### 6.1 현재 강점

- part/interface-first 구조와 requirement trace
- mate solve, rank DoF와 허용 DoF 비교
- 실제 OCCT solid에서 계산한 broad-phase/precise interference
- 연속 운동 중 충돌 시점과 budget 부족 fail-closed
- 선택 피처의 exact B-Rep 수정과 최소 하류 무효화
- 움직이는 assembly의 signed joint evidence와 release certificate 경로

### 6.2 현재 제품군 공백

참조 8개 제품군 중 4개는 전체 exchange pilot을 통과했고 4개는 부분 검증이다.

- MeArm X_T: assembly hierarchy, mates, motion 의미 없음
- gearbox STEP: 반복 pattern intent 권위 정보 없음
- welded structure: 재료 밀도 미결속으로 질량 `not_run`
- heavy equipment: governed motion/clearance adapter 없음

이 결과는 공통 엔진 실패가 아니라 **제품군 계약과 권위 입력 adapter 부족**을 의미한다.

### 6.3 제품군별 완성 전략

모든 복잡 제품을 한 번에 지원한다고 선언하지 않고 다음 순서로 family를 승격한다.

1. gearbox
2. factory equipment/skid
3. welded frame과 enclosure
4. robot variants
5. pressure vessel과 turbomachinery는 별도 고위험 검증 제품

각 family는 최소 다섯 개 직접 설계 golden assembly를 갖는다.

- 명시 부품과 subassembly hierarchy
- interface datum과 mate 의미
- 재료, 질량과 관성
- 움직임과 joint limit
- interference와 clearance
- 반복 부품·configuration 의미
- BOM·도면·STEP product structure
- 제조 또는 조립 검사 항목

### 6.4 공통 엔진 정확도 향상

- 20, 100, 500 occurrence 단계별 성능·메모리·solver benchmark
- fixed, revolute, slider, concentric, coincident와 distance mate의 독립/혼합 검증
- 과구속, 저구속, redundant constraint와 singular configuration 분리
- static pose뿐 아니라 전체 joint range와 coordinated path 검증
- material/밀도 누락 시 mass를 추정 통과시키지 않음
- repeated definition은 동일 geometry hash를 요구하고 instance transform만 분리
- source STEP에 pattern intent가 없으면 geometry repetition과 design intent를 구분
- 부분 실패 시 실패 part만 재생성하고 정상 part의 revision/hash 유지

### 6.5 복잡 제품 승격 게이트

| 상태 | 의미 |
|---|---|
| Common Engine Verified | 공통 assembly API와 현재 104테스트 통과 |
| Family Candidate | 직접 설계 golden 5건과 모든 필수 assertion 실행 |
| Verified Pilot | golden 5건, 실제 고객/내부 블라인드 5건, 조립 또는 제조 1건 통과 |
| Family GA | 지원 범위·한계 공개, 20건 회귀, 7일 운영, false-verified 0 |

`general complex product self-service`라는 한 개의 광범위한 PASS는 만들지 않는다. family별로 독립 승격한다.

## 7. 실행 순서

### M0 — 문서·릴리스 기준선

1. 현재 195개 수정과 82개 신규 파일을 기계 코어, 로봇, 조립체, 조직·거래, 인증·운영, UX, evidence tooling 단위로 분류한다.
2. 각 묶음의 source와 test가 함께 들어 있는 검토 가능한 커밋을 만든다.
3. 전체 typecheck, build, 보안, 기계 89, 로봇 143, 조립체 104 테스트를 재실행한다.
4. 최신 commit에 결속된 내부 receipt와 readiness preview를 새 파일로 생성한다.
5. 이전 25부품 로봇 감사는 historical/superseded로 유지하고 덮어쓰지 않는다.

### M1 — 기계 코어 직접 실증

1. 30개 기준 부품 설계
2. 150개 intent 입력 세트
3. NFAB/STEP 3회 실제 artifact campaign
4. 도면/BOM/package revision 결속
5. 우선 10건으로 private beta candidate, 30건으로 commercial candidate

### M2 — Robot Verified Pilot

1. 고정 로봇 요구사항과 22개 부품 사양 입력
2. 29부품·68 mate r+1 실행
3. motion/torque/housing/tolerance/cable 사후 검증
4. exact-CAD와 manufacturing packet 생성
5. 한 축 rig와 로봇 시제품 실증
6. 최신 production completion audit 생성

### M3 — 제조·운영

1. 절삭, 판금, 적층 각 1건 실제 제작
2. 실측·사진·재작업·납기·비용 receipt 결속
3. 웹 메모리 883.2MB 원인 분석 후 768MB 안으로 낮추거나 배포 한도를 근거 있게 상향
4. 72시간 candidate 관찰 후 7일 GA 관찰
5. Redis outage, quota, backup/restore와 rollback rehearsal

### M4 — 복잡 제품군 확장

1. gearbox의 다섯 golden assembly
2. equipment/skid의 다섯 golden assembly
3. welded/enclosure의 다섯 golden assembly
4. family별 Verified Pilot 승격
5. 고위험 제품은 별도 계약과 전문가 release 유지

## 8. 문서 정본 순서

충돌 시 다음 순서로 해석한다.

1. 이 문서: 현재 상태, 증거 정책 v2, 다음 실행 게이트
2. `docs/strategy/ai-mechanical-cad-category-dominance-plan-260811.md`: 제품 포지셔닝과 자원 배분
3. `docs/process/mechanical-core-commercialization-runbook.md`: 기계 코어 실행 절차
4. `docs/process/robot-verified-product-runbook.md`: 로봇 실행 절차
5. 현재 commit에 결속된 JSON evidence: 특정 실행의 실제 결과
6. 날짜가 오래된 review, handoff와 audit: 당시 상태의 이력

JSON evidence와 최신 코드가 다르면 코드가 자동으로 PASS가 되는 것이 아니다. **증거가 오래됐다고 표시하고 현재 코드에서 pipeline을 다시 실행해 새 정본을 생성한다.**

## 9. 즉시 다음 작업

1. 361개 작업 트리를 검토 가능한 묶음으로 분리하고 하나의 clean release commit을 확정한다.
2. 생성된 외부 workbook에서 우선 직접 설계 10건을 완주해 private beta gate를 연다.
3. 나머지 직접 설계 20건과 150개 intent 입력을 실행해 30피처 폐루프를 닫는다.
4. 구현자와 분리된 내부 검토자가 blind challenge 20건을 실행하고 고위험 5건을 이중 승인한다.
5. CNC·판금·적층 각 1건을 실제 제작·실측하고 signed inspection receipt를 결속한다.
6. Redis가 연결된 실제 배포에서 메모리·지연·오류·백업·복구·롤백을 7일 관찰한다.
7. 병행 트랙으로 실제 22개 로봇 부품 사양을 채워 29부품·68 mate r+1을 생성하고 한 축 rig/시제품으로 검증한다.
8. 이후 gearbox → equipment/skid → welded/enclosure 순으로 family golden 5건씩 승격한다.

1번은 릴리스 관리 작업이고 2~7번은 실제 실행·물리 증거 작업이다. 코드가 다시 통과해도 이 증거를 대신하지 않는다.

## 10. Robot Verified Systems 구현 명세 v2

이 절은 5절의 방향을 실제 코드 작업과 acceptance test로 변환한다. 기존 156 isolated frame과 49 coordinated frame은 결정적 회귀 최저선이며 전체 작업공간 증명이 아니다.

### 10.1 요구사항·권위 입력

신규 계약 `nexyfab.robot-system-requirements.v2`는 다음 필드를 갖는다.

```text
identity: productId, lineageId, revision, intendedUse
mechanics: axes, reach, jointRanges, installationPose, payloadCases[]
performance: tcpAccuracyMm, tcpRepeatabilityMm, cycleTimeS, dutyCycle
motion: velocity/acceleration/jerk limits, governedPaths[], forbiddenZones[]
environment: temperatureRange, contamination, ipTarget, expectedLifeCycles
power: supply, peakPower, rmsPower, regenerativeCondition, brakeCondition
safety: personsPresent, cellBoundary, foreseeableMisuse[], safetyFunctions[]
manufacturing: material/process/tolerance/inspection authorities
authority: sourceArtifactSha256, approvedBy, approvedAt
```

검증 규칙:

- payload case는 mass, center of mass와 inertia tensor를 모두 요구한다.
- 성능 수치는 단위와 허용 방향을 명시한다.
- 안전 기능은 hazard 또는 risk-reduction requirement와 연결한다.
- 권위 artifact hash와 승인자가 없으면 `requirementsReady=false`다.
- 이후 AI repair는 승인 필드를 바꾸지 못한다.

구현 파일:

- `src/lib/ai/robot/robotSystemRequirements.ts`
- `src/lib/ai/robot/robotSystemRequirements.test.ts`
- `src/app/api/cad/v1/robot/requirements/verify/route.ts`
- `src/app/api/cad/v1/robot/requirements/verify/route.test.ts`

### 10.2 동역학·구동계·열

신규 `robotDynamicLoadEnvelope`는 각 governed path와 payload case에 대해 축별 position, velocity, acceleration, gravity, inertia와 external wrench를 결합한다.

필수 출력:

- peak positive/negative torque
- RMS torque와 RMS speed
- torque-speed envelope outside count
- peak/RMS mechanical·electrical power
- reducer input/output speed·torque margin
- bearing equivalent load와 life input
- brake hold와 emergency-stop torque
- 계산에 사용한 path/payload/component artifact hash

`robotDriveDutyThermal`은 제조사 duty/thermal curve가 있을 때만 pass를 만들며, curve가 없으면 보수 상수로 통과시키지 않고 `not_run`으로 둔다.

`robotBearingReducerLife`는 bearing L10, reducer rated life, shaft·fastener load case를 분리한다. 제품 요구 수명보다 계산 수명이 작거나 source rating이 없으면 release blocker다.

구현 상태:

- `robotDynamicLoadEnvelope.ts`
- `robotDriveDutyThermal.ts`
- `robotBearingReducerLife.ts`
- 각각의 direct unit test와 API contract test

비상정지 하중은 별도 파일이 아니라 동역학 envelope와 동결 path/load-case 계약에서 결속한다. 실제 제조사 torque-speed·thermal curve 입력은 외부 실행 단계다.

### 10.3 구조 강성·진동·정밀도 budget

`robotStructuralCompliance`는 최소한 다음 compliance source를 요구한다.

- shaft torsion/bending
- bearing radial/axial compliance
- reducer torsional stiffness와 lost motion
- housing/link stiffness
- base mounting stiffness

고정된 하중 case별 joint deflection을 TCP translation/rotation으로 전파한다. 정밀도 budget에는 geometric tolerance, encoder, reducer, compliance, thermal과 calibration을 구분해 기록한다.

필수 판정:

```text
predictedWorstCaseTcpError <= frozen tcpAccuracy requirement
predictedRepeatabilityFloor <= frozen repeatability requirement
firstModeFrequency / dominantExcitationFrequency >= approved margin
all source terms are authoritative or measured
```

구현 상태:

- `robotStructuralCompliance.ts`
- `robotTcpPositionErrorBudget.ts`

modal margin은 구조 compliance 입력·판정에 포함한다. `robotMetrologyCorrelation`은 실제 rig/prototype 계측값이 생길 때 구현·실행할 외부 상관 단계다.

정밀도 예측은 실측 반복도 receipt를 대신하지 않는다.

### 10.4 운동 coverage와 케이블 수명

`robotMotionCoverage`는 156/49 회귀 외에 다음 coverage를 생성한다.

- joint-space low-discrepancy samples
- reachable workspace cells와 checked cell ratio
- singularity/near-contact adaptive refinements
- governed production paths
- emergency-stop path
- tool/workpiece/fixture/cell obstacle configuration

모든 collision-free 판정은 exact geometry 또는 검증된 conservative bound를 사용하고 검사되지 않은 영역은 `unknown`으로 남긴다.

`robotCableLifeSweep`은 각 motion frame에서 route를 평가하고 다음을 누적한다.

- minimum dynamic bend radius
- maximum local and accumulated twist
- minimum clearance
- service loop travel
- connector/strain-relief displacement
- route-specific cycle count와 flex-life consumption

구현 상태:

- `robotMotionCoverage.ts`
- `robotCableLifeSweep.ts`

continuous collision과 cell/workspace coverage는 `robotMotionCoverage`의 단일 결과·해시 경계 안에서 처리한다.

### 10.5 안전·전장 evidence package

목표는 인증 자동화가 아니라 누락 없는 전문가 검토 패키지다.

기준선은 [ISO 10218-1:2025](https://www.iso.org/standard/73933.html), [ISO 10218-2:2025](https://www.iso.org/standard/73934.html), [ISO 12100:2010](https://www.iso.org/standard/51528.html), [ISO 13849-1:2023](https://www.iso.org/standard/73481.html), [IEC 60204-1:2016+A1:2021](https://webstore.iec.ch/en/publication/66124)이다. 성능 계측 계획은 [ISO 9283:1998](https://www.iso.org/standard/22244.html)에 정렬하되 공인 인증을 주장하지 않는다.

`robotSafetyCase` 필수 요소:

- lifecycle phase와 intended use
- hazard, cause, hazardous situation, harm
- initial risk, protective measure, residual risk
- safety function, trigger, safe state, reset/restart condition
- required performance target와 전문가 판단 근거
- verification method, evidence hash, reviewer

`robotElectricalEvidence` 필수 요소:

- power architecture와 보호 장치
- motor/brake/encoder/controller/I/O 연결
- voltage/current/power budget
- protective bonding·grounding·overcurrent evidence
- emergency stop·protective stop·STO 등 적용 기능 mapping
- cable/connector derating와 separation

구현 상태:

- `robotSafetyElectricalEvidence.ts`
- `robotSafetyElectricalEvidence.test.ts`
- `src/app/api/cad/v1/robot/safety/electrical/route.ts`

hazard register, safety-function matrix, 전장 증거와 독립 전문가 서명 조건은 하나의 교차필드 검증 경계에 결속했다. 이는 설계 지원 증거이며 공인 인증서가 아니다.

코드가 schema와 모순을 검사할 수는 있지만 PL, 적합성, 산업 안전 인증은 권한 있는 전문가·시험·법적 절차가 필요하다.

표준 목록은 2026-08-12 확인 기준선이다. 제품별 release review를 시작할 때 ISO·IEC 공식 발행 상태, 개정·폐지 여부와 판매 지역 법규를 재확인하고 적용 edition을 safety review receipt에 결속한다.

### 10.6 물리 검증 receipt

`nexyfab.robot-physical-validation-receipt.v1`은 다음 공통 필드를 요구한다.

- target/product/revision/application hash
- specimen serial과 as-built BOM
- test equipment, equipment serial, calibration reference
- environment와 setup 사진·도면 hash
- raw data artifact hash와 계산 version
- requirement, measured value, uncertainty, acceptance result
- operator와 engineering reviewer signature

시험 단계:

1. **한 축 rig**: peak/rated torque, brake hold, backlash, bearing·motor·reducer temperature, encoder repeatability.
2. **3축 wrist/부분 조립**: compact interference, thermal coupling, cable twist와 connector load.
3. **6축 prototype**: payload 0/정격/편심, accuracy, repeatability, cycle time, thermal steady state, vibration, cable motion.
4. **endurance 후 분해**: wear, fastener loosening, cable damage, lubrication과 seal 상태.

측정값이 동결 요구를 벗어나면 AI는 기존 release를 유지하지 않고 affected requirement/part/load case만 재개방한다.

### 10.7 로봇 제품군 검증

동일 구조의 단순 scale 세 개를 독립 제품으로 세지 않는다. 다음 세 유형을 서로 다른 requirement와 구동계 선택으로 직접 설계한다.

1. 소형 고속 6축
2. 중형 범용 6축
3. 장축·편심 payload 6축

각 유형은 golden 1건, blind variant 1건과 동일한 software/dynamic/safety/physical schema를 사용한다. 첫 Product-specific Verified Release는 세 제품 전체가 아니라 실제 prototype이 있는 한 사양에만 부여한다.

### 10.8 로봇 acceptance matrix

| Gate | 통과 기준 |
|---|---|
| Requirements | 필수 권위 입력 100%, unresolved/conflict 0 |
| Catalog/integration | drive 18 + auxiliary 4, 29 parts, 68 mates, unresolved 0 |
| Dynamics | 모든 governed load case에서 torque/speed/power margin 양수 |
| Thermal/life | duty thermal limit 내, bearing/reducer life가 요구 수명 이상 |
| Accuracy | predicted TCP error가 동결 요구 이하, source missing 0 |
| Motion | baseline 156/49 + frozen coverage 완료, collision/precise interference 0 |
| Cable | bend/twist/clearance/service/flex-life requirement 모두 통과 |
| Safety/electrical | hazard와 safety function trace 100%, 독립 전문가 검토 |
| Physical | rig와 prototype receipt가 동일 revision/hash에 결속 |
| Release | exact-CAD, manufacturing, physical, safety, 이중 release review 모두 일치 |

## 11. 일반 복잡 제품 구현 명세 v2

### 11.1 Complex System Graph

`nexyfab.complex-system-graph.v2`는 기존 requirement/definition/occurrence/interface 외에 다음 node를 추가한다.

- function, loadCase, energyFlow, fluidFlow, signalFlow
- actuator, sensor, controller, connector, port
- fastenerJoint, weldJoint, seal, bearing, gearMesh, shaftCoupling
- hazard, safetyFunction, riskReduction
- process, inspectionDatum, inspectionResult
- assemblyStep, toolAccess, serviceEnvelope, maintenanceItem

모든 edge는 `sourceRefs`, `artifactHashes`, `status=confirmed|unresolved|conflict`를 갖는다. release assertion은 confirmed edge만 사용할 수 있다.

구현 파일:

- `src/lib/ai/complexSystemGraph.ts`
- `src/lib/ai/complexSystemGraph.test.ts`
- `src/app/api/cad/v1/system/verify/route.ts`

현재 구현은 업로드 artifact byte SHA-256, 누락·초과 파일, graph containment·cycle·reachability, edge endpoint 관계, requirement→function→technical realization, hazard→risk reduction→safety function, part별 make/buy·inspection·acceptance와 전 node/edge evidence coverage를 재검산한다. 별도 `complexSystemTrace.ts`를 만들지 않고 같은 verifier 안에서 trace coverage를 단일 권위로 처리한다.

### 11.2 제품군 adapter

`familyContracts`는 공통 엔진을 제품 규칙에 연결한다.

#### Gearbox

- ratio와 direction
- gear geometry·strength·contact assertion
- shaft reaction·bearing life
- backlash/tolerance stack
- lubrication, seal, thermal, housing stiffness
- assembly order, shim·preload, runout inspection

#### Machine/Skid

- equipment·baseplate hierarchy
- alignment datum와 anchor/load path
- pipe/port/valve/instrument relation
- service/removal envelope
- lifting·transport·installation state
- vibration·commissioning inspection

#### Welded/Enclosure

- structural member와 load path
- weld joint·symbol·access·inspection
- distortion allowance와 datum tolerance
- sheet bend/relief와 door/hinge/seal
- grounding, coating, thermal/IP requirement

구현 위치:

- `src/lib/ai/familyContracts/gearbox/*`
- `src/lib/ai/familyContracts/machineSkid/*`
- `src/lib/ai/familyContracts/weldedEnclosure/*`

각 adapter는 graph 파일 bytes와 전체 artifact를 다시 검증하고 `systemGraphHash`를 제품군 계산 계약에 결속한다. 대응 API는 `/api/cad/v1/system/{gearbox|machine-skid|welded-enclosure}/verify`이며 Assembly AI의 복잡 제품 검증 패널에서 실행할 수 있다. 내부 계산 통과 후에도 물리 실증·전문가 승인·release는 false로 유지한다.

### 11.3 부분 변경과 configuration

- definition은 geometry hash로 불변 식별하고 occurrence transform/configuration을 분리한다.
- configuration은 suppressed/alternative part와 requirement delta를 명시한다.
- source part 변경 시 영향받은 mate, motion, drawing, BOM, calculation만 stale 처리한다.
- 정상 part hash가 바뀌거나 전체 assembly를 무조건 재생성하면 repair-isolation 실패다.
- 제품 variant 간 evidence를 재사용할 때 공통 source hash와 delta verification을 모두 요구한다.

### 11.4 20/100/500/1,000 occurrence benchmark

benchmark receipt는 다음 환경을 고정한다.

- commit/build/kernel/worker version
- CPU, memory, browser/Node, concurrency
- source artifact와 deterministic seed
- cold/warm execution 구분

측정 항목:

- import, first render, first editable, mate solve
- broad/exact interference, motion, partial recompute
- save/resume, STEP export/import
- peak memory, worker queue, timeout/error
- hierarchy/occurrence/transform/BOM hash fidelity

20·100은 편집 SLA, 500은 batch/partial-edit SLA, 1,000은 review/streaming SLA를 따로 승인한다. 임의의 절대 시간 목표는 하드웨어 기준선 없이 문서에 고정하지 않는다.

구현된 `nexyfab.complex-assembly-scale-benchmark.v1` 계약은 각 단계마다 cold 3회와 warm 3회를 강제한다. 총 24개 run에서 import, first usable/editable, mate solve, broad/exact interference, motion, partial recompute, save/resume, STEP export/import, peak memory, worker queue, timeout/error를 기록한다. hierarchy·occurrence·transform·BOM·save/resume·STEP roundtrip hash가 모든 반복에서 같아야 하며, reviewer-approved SLA profile artifact의 실제 bytes도 검증한다. 내부 실행 계약이 통과해도 독립 benchmark 승인은 별도이므로 release는 false다.

revision 간 부분 검증은 `nexyfab.complex-system-change-impact-report.v1`로 처리한다. 동일 system의 정확히 다음 revision만 비교하며, artifact/node/edge/evidence delta와 containment·요구→기능→실현·위험→저감→안전 trace를 따라 dependency cone을 계산한다. 영향권 evidence는 stale로 격리하고 byte·record가 모두 동일한 비영향 evidence만 재사용한다.

### 11.5 제품군 acceptance

| 상태 | 구체 기준 |
|---|---|
| Family Candidate | golden 5건, 필수 assertion coverage 100%, source authority 누락 0 |
| Verified Pilot | golden 5 + blind 5 + 실제 제작/조립 1, false-verified 0 |
| Family GA | 독립 20건, 3회 연속 regression, 7일 운영, 공개 scope/limit |

pressure vessel과 turbomachinery는 별도 고위험 contract·규격 계산·전문가 증거가 생기기 전까지 `not_supported_for_verified_release`다.

## 12. 구현 작업 묶음과 의존성

| Work package | 구현 | 검증 | 완료 조건 | 외부 의존성 |
|---|---|---|---|---|
| W0 Release baseline | dirty tree 분류·release commit | full test/build/security | clean commit과 재생성 evidence | 없음 |
| W1 Contract v2 | robot requirements, system graph, receipts | schema negative/cross-hash tests | 누락·모순·stale evidence fail-closed | 없음 |
| W2 Robot engineering | dynamics, thermal, life, accuracy | analytic fixtures + independent calculation cases | 모든 known fixture 오차 허용 내 | 부품 curve는 후속 가능 |
| W3 Motion/cable | coverage, continuous collision, cable life | adversarial near-contact/twist cases | unknown을 pass로 승격 0 | 없음 |
| W4 Safety/electrical support | hazard, function, electrical package | contradictory/incomplete case tests | 전문가 검토 전 release false | 표준 원문·전문가 필요 |
| W5 Complex families | graph + 3 family adapters | golden 5/family | assertion coverage 100% | 직접 설계 가능 |
| W6 Scale | 20/100/500/1,000 harness | fixed environment runs | signed benchmark receipts | 기준 장비 필요 |
| W7 Physical | rig, prototype, family builds | calibrated measurement | same-revision signed receipts | 부품·제조·계측 필요 |
| W8 Promotion | blind, 독립, 운영 evidence | promotion gate | 제품군별 scope/limit 공개 | 사용자·검토자 필요 |

W1~W6의 코드와 내부 설계는 병렬화할 수 있다. W7은 W1 receipt schema가 고정된 뒤 시작하고, W8은 W7을 건너뛰지 않는다.

## 13. 바로 구현할 코드 backlog

다음 순서가 가장 작은 위험으로 실제 완성도를 높인다.

1. `robotSystemRequirements`와 route: 권위 입력을 먼저 고정한다.
2. `robotDynamicLoadEnvelope` + analytic 2-link/6-axis fixtures.
3. `robotDriveDutyThermal`과 `robotBearingReducerLife`.
4. `robotPositionErrorBudget`과 tolerance-source fail-closed.
5. `robotMotionCoverage`와 `robotCableLifeSweep`.
6. `robotSafetyCase`·`robotElectricalEvidence` schema. 자동 인증 표현은 금지한다.
7. `robotPhysicalValidationReceipt`와 current release audit 결속.
8. `complexSystemGraph`와 gearbox family contract.
9. 20/100/500/1,000 benchmark harness.
10. machine/skid와 welded/enclosure contract.

각 항목은 `점검 → 구현 → direct unit/negative test → scoped type/lint → 통합 test/build → evidence 갱신 → 다음 항목` 순서로 닫는다. 코드 PASS만으로 물리·전문가·운영 증거를 완료 처리하지 않는다.

## 14. 실행 현황과 다음 구현 큐 — 2026-08-12

### 14.1 완료된 backlog

- [x] `robotSystemRequirements` v2와 검증 route
- [x] `robotDynamicLoadEnvelope`와 해석 fixture
- [x] `robotDriveDutyThermal`
- [x] `robotBearingReducerLife`
- [x] `robotTcpPositionErrorBudget`
- [x] `robotStructuralCompliance`
- [x] 위 계산을 재계산·교차결속하는 `robotEngineeringAnalysisPacket`
- [x] 7개 상태와 외부 blocker를 표시하는 제품 UI
- [x] 로봇 전체 64 files / 265 tests와 전체 TypeScript 검사
- [x] payload case × governed path 전체 engineering coverage matrix
- [x] 적응형 continuous motion/workspace coverage와 cable bend·twist·flex-life
- [x] hazard/safety-function/electrical evidence 설계 지원
- [x] joint rig·wrist·6축·endurance 27개 계측 physical receipt 검증기
- [x] 전체 CAD·제조·계산·물리 증거를 재검산하는 서버 Ed25519 서명 감사 v2
- [x] 감사 이후 별도 키의 도메인·독립 검토자 이중 서명 최종 gate
- [x] 위 6단계를 실행·다운로드하는 fail-closed 제품 UI
- [x] `Complex System Graph v2`와 graph 검증 API
- [x] Gearbox, Machine/Skid, Welded/Enclosure family 계산·증거 계약과 3개 API
- [x] 공통 graph·artifact를 재사용하고 물리 blocker를 표시하는 복잡 제품 Verified Systems UI
- [x] Graph·family·change impact·scale·UI·기존 Assembly AI 통합 14 files / 68 tests, 전체 TypeScript, 보안/API 통제 재결속
- [x] 복잡 제품 UI와 6개 system API 선택 프로덕션 build
- [x] revision-scoped dependency cone과 stale/reusable evidence를 계산하는 change-impact API·UI
- [x] 20/100/500/1,000 × cold/warm 3회 성능·결정론·SLA receipt 계약과 API·UI
- [x] 기존 CPU synthetic large-assembly 실제 진단 5/5—100/1,000/5,000 build, 1,000 traverse/merge
- [x] 기계 코어 7제품군과 Spatial Labs 보조 제품군의 benchmark·출시 판정 분리
- [x] `machine_skid`·`welded_enclosure` 독립 family metric과 제품군별 campaign scope
- [x] suite hash에 필수 family·case minimum·campaign·repeat를 결속한 안전한 중단/재개
- [x] 제품군별 `verified-*` 릴리스 채널과 타 제품군 evidence 차용 방지
- [x] Machine/Skid 20 + Welded/Enclosure 20의 pending-only 획득 큐와 무승격 scaffold 검증

### 14.2 다음 코드 큐

1. 실제 제조사 catalog 22개와 현재 r+1으로 완료된 로봇 검증 API 전 단계를 실행한다.
2. joint rig·wrist·6축 prototype·endurance teardown을 제작·계측하고 27개 subject의 raw/calibration/as-built 증거를 채운다.
3. 배포 secret manager에 감사 private key와 final-review 공개키 registry를 분리하고 rotation/revocation drill을 기록한다.
4. 구현된 Graph v2와 세 family 계약으로 제품군별 직접 설계 golden 5건과 blind 5건을 실행한다.
5. 제품군별 실제 제작·조립·시운전 1건을 같은 revision/hash의 계측 receipt에 결속한다.
6. 구현된 20/100/500/1,000 occurrence 계약에 실제 고정환경 24-run raw trace를 채우고 Redis 포함 7일 운영 receipt를 실행한다.
7. 전체 작업 트리를 검토 가능한 묶음으로 분리하고 검증된 full Next build를 결속한 clean RC를 만든다.

### 14.3 제품·시장 판단

SolidWorks/Fusion/Onshape와의 깊은 플러그인 종속보다 STEP 호환성과 NexyFab 자체 B-rep·feature·assembly·drawing 폐루프를 우선한다. 경쟁 제품의 범용 편집 폭을 단기간에 복제하는 것이 아니라, 기계 설계자·공장·설계기업·스타트업이 동일한 검증 receipt로 협업하고 제조 위험을 조기에 제거하는 흐름을 차별점으로 삼는다.

로봇과 복잡 제품의 상용 표현은 제품군별 evidence tier로 제한한다. 내부 계산 PASS는 `Engineering Analysis`, 실제 제조·계측·독립 검토까지 결속된 특정 revision만 `Verified`로 표시한다.

### 14.4 제품군별 실증 현황과 실행 명령

기존 v2 corpus는 Robot 9, Gearbox 17, Pressure Vessel 11, Turbomachinery 11, Factory Equipment 20, Interior 20으로 총 88건이다. 이 중 기계 코어는 68/140이며 승인된 ground truth는 0건이다. 기존 32슬롯 부족분과 신규 Machine/Skid·Welded/Enclosure 40슬롯을 합쳐 기계 코어 부족분은 72건이다.

- 기존 32슬롯: `docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json`
- 신규 40슬롯: `docs/evidence/complex-holdout-lineage-v3-extension-260812/shortfall-acquisition-queue.json`
- 제품군 실행: `npm run campaign:complex-products:v2 -- --cases=<approved-cases.json> --state=<state.json> --executor=<adapter.mjs> --families=machine_skid`
- 제품군 판정: `npm run kpi:complex-products:v2 -- --cases=<approved-cases.json> --runs=<runs.json> --families=machine_skid`

큐와 scaffold는 실제 CAD·라이선스·ground truth·검토 서명·정확도 PASS가 아니다. 획득·격리·네이티브 구조 추출·이중 승인이 완료된 case만 캠페인 입력으로 승격한다.
