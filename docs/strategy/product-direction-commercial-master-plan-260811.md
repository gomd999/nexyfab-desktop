# NexyFab 제품 방향·상용화 통합 마스터 플랜

작성 기준일: 2026-08-11 KST  
적용 대상: `nexyfab.com/new`  
문서 성격: 지금까지의 제품 방향, AI CAD 정확도, 복잡 제품·로봇, 다분야 설계, UX, 운영 및 상용화 논의를 하나의 실행 기준으로 통합한 계획

> **2026-08-11 전략 갱신:** 제품 계층, 자원 배분 및 릴리스 채널은
> `docs/strategy/ai-mechanical-cad-category-dominance-plan-260811.md`를 우선 적용한다.
> 주력 제품은 `AI 기계 CAD + 정밀 CAD`이며, 건축·토목·조경·인테리어는
> `Space Design Labs` 부가 서비스로 분리한다. 이 변경은 기존 검증 기준을 낮추는 것이
> 아니라 기계 제품과 공간 Labs의 출시 계약을 각각 독립시키는 것이다.

> **현재 상태 정본:** 이 문서의 제품 방향은 유지하지만, 3장 이후의 시점별 수치와
> 과거 external-CAD/holdout 임계경로는
> `docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`가
> 대체한다. 특히 로봇은 25부품 개념 상태가 아니라 29부품·68 mate·22 catalog
> occurrence r+1 경로까지 구현됐고, 기본 기계 제품은 상용 CAD C4를 필수로 요구하지
> 않는다.

## 1. 최종 결정

NexyFab은 다섯 개 설계 서비스를 동급으로 판매하지 않는다. 하나의 AI 설계 플랫폼 안에서 **제품·기계 설계를 상용 핵심**으로 두고 **공간·인프라 설계는 명시적 Beta 확장 영역**으로 운영한다.

### 1.1 제품 정의

> **NexyFab은 제품·기계 설계를 중심으로, 공간·인프라 설계까지 확장하는 검증형 AI 설계 플랫폼이다.**

외부 사용자에게 보이는 제품 경로는 두 개다.

1. **제품·기계 설계** — 기본 경로이자 상용 핵심
2. **공간·인프라 설계 Beta** — 건축·토목·조경·인테리어를 포함하는 제한형 확장 경로

내부 기술 구조는 현재처럼 세 계열을 유지한다.

- `product`: 제품·기계·로봇·장비
- `spatial-bim`: 건축·인테리어
- `site-infrastructure`: 토목·조경

사용자 화면의 두 경로는 제품 포지셔닝과 진입 구조일 뿐이다. 분야별 검증기, 증거 축, 산출물, 법규 및 릴리스 게이트까지 두 개로 억지 통합하지 않는다.

### 1.2 핵심 메시지

권장 히어로:

> **아이디어를 검증 가능한 설계로**

권장 설명:

> 제품·기계 설계를 중심으로, 공간·인프라 설계 Beta까지 하나의 AI 설계 흐름에서.

초기 상용화에서는 다음 표현을 사용하지 않는다.

- 모든 설계 완전 자동화
- 모든 복잡 제품 제조 가능
- 전문가 검토 없이 제조·시공 가능
- 모든 분야 95% 정확도
- SolidWorks, Fusion 또는 Revit의 완전 대체

## 2. 고객과 가치 제안

### 2.1 1차 핵심 고객

- 하드웨어 스타트업 및 메이커
- 중소 제조업체와 장비 제작사
- 로봇·자동화 기구 개발팀
- 설계 인력이 부족한 제품 개발 조직
- CAD 초안, 수정, 검증 및 제조 전달을 빠르게 반복해야 하는 실무자

핵심 작업 흐름:

`요구사항 입력 → AI 설계 계획 → 3D 생성 → 정밀 수정 → 조립·동작·제조성 검증 → STEP/BOM/도면 → 견적·제조 또는 전문가 검토`

### 2.2 2차 확장 고객

- 초기 건축·인테리어 기획자
- 소규모 설계사무소와 시공 전 검토팀
- 토목·조경 개념설계 및 수량 검토 실무자

공간·인프라 경로는 당분간 `개념설계 + 검토 보조 + 교환 산출물`로 제한한다. 허가도서나 시공 확정물을 자동 보증하는 상품으로 판매하지 않는다.

### 2.3 경쟁 포지션

NexyFab의 초기 경쟁 방식은 기존 전문 CAD의 전체 기능 수를 그대로 복제하는 것이 아니다.

- Fusion/SolidWorks/Onshape 계열 대비: 요구사항에서 검증과 제조 전달까지 이어지는 AI 우선 흐름
- 텍스트-투-CAD 서비스 대비: 단순 형상 생성이 아니라 요구사항 추적, 정밀 편집, 조립·동작·DFM 및 fail-closed 증거
- 제조 플랫폼 대비: 견적 단계 이전의 설계 생성·수정·검증을 제품 내부에 포함
- BIM/공간 도구 대비: 동일 프로젝트·개정·증거 셸을 공유하되 분야별 전문 검증을 분리

목표 포지션은 **“AI가 초안을 만드는 도구”가 아니라 “AI가 설계를 진행하고, 검증 근거와 함께 전문가·제조 단계로 넘기는 도구”**다.

## 3. 2026-08-11 현재 상태

### 3.1 상용 준비도

- 기계 코어 제한형 비공개 Beta: 현재 부적격, 직접 blocker는 dirty working tree 1건
- 기계 코어 전체 상용 GA: 부적격, legacy evidence blocker와 실제 제조·운영 증거 미완성
- 경로 보안 매트릭스: 통과
- 비밀정보 탐지: 0
- 의존성 취약점 탐지: 0
- 기계 코어 readiness preview: `docs/evidence/release/mechanical-core-readiness-preview-260811.json`

현재 기계 GA 차단 요인은 크게 네 묶음이다.

1. 최신 소스가 깨끗한 release commit과 재현 build에 결속되지 않음
2. 직접 설계 30건과 blind challenge 20건의 실제 artifact receipt 미완성
3. 절삭·판금·적층과 로봇 시제품의 물리 실증 미완성
4. Redis 포함 7일 운영·복구·결제·지원 증거 미완성

legacy gate가 표시하는 상용 CAD C4와 외부 독립 holdout은 자체 실증 evidence v2로
버전업할 정책 전환 항목이다. current JSON을 손으로 수정하지 않고 schema와 validator를
버전업한 뒤 새 commit에서 재생성한다.

### 3.2 운영 관찰

- 관찰 대상 staging build: `a687007b657a3948f3ad0c01a45cfcf744baee29`
- 적격 관찰 시작: 2026-08-11 15:50:09 KST
- 정책상 가장 이른 168시간 완료 시각: 2026-08-18 15:50:09 KST
- 요구 표본: 서비스별 6시간 창, 총 28개
- 현재 receipt는 표본 부족으로 `ok: false`

이 기간에는 해당 staging build를 교체하지 않는다. 제품 IA와 UX 변경은 로컬 또는 별도 preview에서 진행하고, 관찰 중인 릴리스에 섞지 않는다. staging build가 바뀌면 새 build 기준으로 7일 관찰을 다시 시작한다.

### 3.3 제품·기계 설계

현재 판매 가능 범위는 다음과 같다.

- 치수 기반 판재, 플레이트, 브래킷, 커버
- 단순 하우징
- 축, 부싱 및 단순 회전체
- 파이프, 플랜지 및 규칙적 홀 패턴
- 단순 판금
- 2~20부품 단순 조립체

현재 별도 검토 또는 미지원으로 남겨야 하는 범위:

- 유기적·고급 자유곡면
- 안전 필수 부품
- 압력용기 최종 설계
- 복잡 메커니즘의 무검토 제조 릴리스
- 용접 변형, 금형 수축 및 공정 보정까지 포함한 최종 생산 보증

판매 범위 정본: `docs/ai-manufacturing-sales-scope.md`

### 3.4 복잡 제품과 로봇

6축 로봇의 이전 concept demonstrator는 25부품·60 mate였다. 최신 구현 목표와 검증 경로는
다음과 같다.

- catalog 통합 후 편집 가능 r+1 29부품
- mate 68개
- 모터·감속기·베어링 18개와 보조부품 4개, 총 22 occurrence
- catalog unresolved 0 강제
- rank DoF 6
- 의도 접촉 24개
- 정밀 간섭 0개
- 단일 축 탐색 156/156 프레임 검사, 충돌 프레임 0
- 협조 동작 49/49 프레임 검사, 충돌 프레임 0

최신 로봇 집중 검증은 36파일 143테스트를 통과했다. 다만 정본 감사 JSON은 최신 apply
경로보다 오래돼 이전 25부품·unresolved 22 상태를 기록한다. 현재 분류는
`Robot Verified Pilot candidate`이며 제조 릴리스 준비 상태는 아니다.

남은 핵심 증거:

- 모터·감속기·베어링·브레이크·엔코더·하네스·툴 커넥터 22개의 권위 사양 입력
- 선택 부품과 하우징의 실제 적합성
- 최신 코드에서 실제 29부품 r+1 생성과 전체 동작 재검증
- NexyFab exact-CAD 서명 증거
- 한 축 rig와 로봇 시제품 제조·실측
- 위험도가 높은 최종 release의 분리된 2역할 승인

정본: `docs/evidence/release/robot-production-completion-audit-260811-v4.json`

### 3.5 선택적 reference 자료와 자체 실증

아래 두 외부 자료 프로그램은 이미 만들어진 validator와 acquisition 이력으로 보존한다.
그러나 기계 코어와 Robot Verified Pilot의 기본 출시 조건으로 사용하지 않는다.

#### A. 복잡 제품 120-case corpus의 부족분 32건

- robot 11
- gearbox 3
- pressure vessel 9
- turbomachinery 9
- 합계 32

이 32건은 실제 CAD 파일이 저장된 것이 아니라 **선택적으로 확보할 수 있는
reference/interoperability acquisition slot**이다.

- queue: `docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json`
- 현재 확보: 0/32
- 기존 88개 reference case의 승인: 0/88

선택적으로 신규 원본을 사용하는 경우 독립 lineage, SHA-256, 라이선스 판단, holdout
격리, native 구조 검토를 계속 요구한다. 이미지, PDF 또는 AABB만 있는 자료는 독립 CAD
case로 인정하지 않는다.

#### B. 5개 도메인 독립 상용 검토 키트 100건

- 기계·건축·토목·조경·인테리어 각 20건
- 요구 case 100
- 확보 0/100
- 요구 서명 200
- 완료 서명 0/200
- 정본: `docs/evidence/release/independent-domain-review-kit-260810.json`

이 키트는 과거 5도메인 동시 GA 정책의 정본이다. 새 기계 evidence v2는 직접 설계
30건과 잠금 blind challenge 20건으로 분리한다. 기존 JSON을 가짜 승인으로 채우지 않고,
GA 계약과 schema를 제품별 릴리스 채널로 정식 버전업한다.

### 3.6 매뉴얼 활용 상태

참고 폴더: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\document(manuals)`

- PDF 20개
- 총 2,771페이지
- index hash와 실제 파일 hash 일치
- manual trace: 20 manuals / 16 baseline requirements 유효
- 요구사항 상태: 구현·검증 8, 구현·미검증 1, 부분 5, 미구현 2

매뉴얼은 기능 사양, 용어, 작업 흐름 및 검증 항목의 참고 근거로 사용한다. 상용 재배포 자산, 독립 holdout, 실제 제조 증거 또는 전문가 승인을 대신하지 않는다. 원문 PDF를 서비스 데이터셋에 대량 복제하거나 고객에게 재배포하지 않는다.

### 3.7 UX와 유지보수 위험

최근 점검에서 확인한 주요 문제:

- 랜딩 번들 예산 사용률 약 99.7%
- 정밀 CAD 데스크톱 번들 예산 사용률 약 93.5%
- 비로그인 화면의 불필요한 세션 요청과 401
- 정밀 CAD 갱신 요청 400 및 알림 요청 401
- 393px 모바일에서 일반 설계 콘텐츠와 CAD 도구의 큰 가로 넘침
- 접근성 영향 노드: 랜딩 31, guided 20, 정밀 CAD 데스크톱 65, 모바일 25
- ESLint 경고 596
- `ShapeGeneratorInner.tsx` 약 12,942줄로 변경 위험 집중

기능 추가만 계속하면 전환율과 신뢰도가 떨어질 수 있으므로, UX·접근성·유지보수 작업을 상용화 트랙 안에 포함한다.

## 4. 목표 제품 구조

### 4.1 첫 화면

사용자에게 두 개의 큰 분야 선택 카드를 먼저 강요하지 않는다.

> 무엇을 설계할까요?  
> 아이디어를 설명하거나 이미지·도면·CAD 파일을 올려주세요.

입력을 분석한 후 시스템이 경로와 예상 산출물을 제안한다.

- 제품·기계: 3D 모델, 조립 검토, BOM, STEP, 제조성 보고서
- 공간·인프라 Beta: IFC, 평면·단면, 수량, 동선·간섭 검토

사용자는 제안된 경로를 직접 변경할 수 있어야 한다. 자동 분류의 신뢰도와 근거를 표시하고, 애매한 입력에서는 단정하지 않고 확인 질문을 한다.

### 4.2 기본 내비게이션

- 새 설계
- 제품·기계 설계
- 공간·인프라 설계 `Beta`
- 내 프로젝트
- 예제 및 템플릿

건축·토목·조경·인테리어는 최상위 동급 메뉴에서 내리고, 공간·인프라 경로 안의 프로젝트 유형으로 선택한다.

### 4.3 경로별 완료 지점

제품·기계 경로:

`요구사항 → 형상/조립 → 정밀 편집 → 검증 → STEP/BOM/도면 → DFM/RFQ/제조 또는 전문가 승인`

공간·인프라 경로:

`요구사항/대지/현황 → 공간·시설 모델 → 분야별 검증 → IFC/도면/수량 → 전문가 검토`

두 경로의 완료 상태와 증거를 한 점수로 합치지 않는다.

## 5. 실행 원칙

1. **기계 우선:** 개발·마케팅·예제·검증 자원의 70~80%를 제품·기계에 배정한다.
2. **한 플랫폼:** 프로젝트, 권한, 개정, 증거, 파일 및 AI 대화 인프라는 공유한다.
3. **분야별 진실:** 검증기, 정확도 분모, 산출물, 법규 및 책임 범위는 분리한다.
4. **fail-closed:** 미실행과 근사를 성공으로 표시하지 않는다.
5. **증거 기반 릴리스:** 구현 여부와 독립 검증 여부를 별도 상태로 표시한다.
6. **정밀 CAD는 출구이자 복구 도구:** AI 결과를 정밀 수정하고 다시 AI 문맥으로 되돌리는 양방향 루프를 완성한다.
7. **제조 연결은 핵심 수익 경로:** 단순 생성보다 STEP/BOM/도면/DFM/RFQ까지의 완주율을 우선한다.
8. **운영 build 보존:** 관찰 중인 release artifact는 기능 개발과 분리한다.

## 6. 통합 실행 로드맵

일정은 목표 창이며, 릴리스는 날짜가 아니라 각 단계의 완료 게이트로 결정한다.

### M0 — 기준선 고정 및 작업 분리

목표 창: 즉시

작업:

- 현재 상태 정본을 제품·기술·상용 실행 기준으로 사용
- 88개 수정·64개 신규 파일을 기능 묶음별 release commit으로 분리
- 기계 evidence/gate v2 migration 설계
- 기존 readiness JSON을 보존하고 새 schema로 candidate를 별도 생성
- 6시간 운영 receipt의 웹 메모리 883.2MB 문제 분석

완료 게이트:

- 깨끗한 commit과 재현 build
- 기계 89, 로봇 143, 조립체 104 집중 테스트와 전체 typecheck 재통과
- 새 commit에 결속된 내부 receipt와 readiness candidate

### M1 — 제품·기계 중심 Beta 표면 완성

목표 창: 1~2주

작업:

- 랜딩과 사이드바를 `제품·기계 / 공간·인프라 Beta` 구조로 개편
- 통합 입력창과 도메인 자동 라우팅 추가
- 각 결과에 지원 범위, 검증 상태, 근사 여부 및 다음 행동 표시
- 제품·기계 예제와 사례를 화면의 70~80%로 재편
- 공간·인프라에는 Beta 배지와 허용 산출물·책임 한계 표시
- 비로그인 401/400 요청 제거 또는 정상적인 익명 상태로 처리
- 393px 모바일 가로 넘침 제거
- 접근성 오류를 심각도 순으로 정리하고 핵심 흐름의 차단 항목 0으로 감소
- 번들 예산 여유를 최소 10% 확보

완료 게이트:

- 랜딩 → 새 설계 → AI 분석 → 결과 → 정밀 편집 또는 내보내기 E2E 통과
- 제품·기계 및 공간·인프라의 잘못된 교차 산출물 0
- 핵심 모바일 화면 가로 스크롤 0
- 비로그인 정상 사용 중 예상 밖 4xx 요청 0
- 지원되지 않는 제조·시공 보증 문구 0

### M2 — 제품·기계 유료 파일럿

목표 창: 2~4주

초기 판매 묶음:

- 부품 설계 파일럿
- 2~20부품 조립체 설계 파일럿
- 기존 STEP 검토·수정 파일럿
- STEP/BOM/도면/DFM 검토 패키지
- 전문가 검토 또는 제조 견적 연결 옵션

작업:

- 지원 제품군별 입력 체크리스트와 authoritative input 요구
- 요구사항→부품→피처→산출물 추적 표시
- AI 생성→정밀 CAD→AI 재수정 양방향 루프 완성
- 동일 revision의 STEP/BOM/도면 hash binding
- 결제, 환불, 납품 범위, 책임 한계 및 고객 동의 흐름 E2E
- 3~5개 디자인 파트너 모집, 최소 3건의 실제 유료 파일럿 목표

완료 게이트:

- 파일럿 대상 모든 필수 gate 100% 실행
- false-verified 0
- 내보낸 STEP/BOM/도면 revision 불일치 0
- 고객이 잠근 치수와 요구사항의 비의도 변경 0
- 실패 또는 미지원이면 명시적 전문가 검토 경로로 전환

### M3 — 복잡 제품·로봇 검증형 파일럿

목표 창: 3~8주, 외부 부품 자료와 검토자 확보 시점에 따라 변동

작업 순서:

1. 로봇 22개 부품의 추적 가능한 카탈로그 확보
2. 하우징·축·베어링·감속기 적합성 계산과 exact geometry 반영
3. 156 단일 축 + 49 협조 프레임 재검증
4. exact collision, clearance, STEP roundtrip 및 제조 검증
5. 도메인 전문가와 독립 검토자의 이중 서명
6. 로봇 외 gearbox, factory equipment 등 다음 제품군으로 확장

복잡 제품 32건 확보 순서:

1. robot 11
2. gearbox 3
3. pressure vessel 9
4. turbomachinery 9

압력용기와 안전 필수 제품은 생성 데모보다 규제·검토·책임 체계가 먼저다. 충분한 증거 전에는 self-service 제조 릴리스 대상에서 제외한다.

완료 게이트:

- 로봇 exact revision의 카탈로그 미해결 0
- 서명된 동작·충돌·clearance 증거
- 제조 검증 및 이중 전문가 승인
- 해당 제품군만 `validated pilot`로 승격
- 다른 복잡 제품 전체에 결과를 일반화하지 않음

### M4 — 공간·인프라 Beta 단계 확장

목표 창: M1 이후 시작, 분야별 증거 확보에 따라 순차 공개

권장 순서:

1. 인테리어 개념설계·동선·문 스윙·수량
2. 건축 공간·개구부·피난·IFC
3. 토목 측량·지형·선형·토공·배수
4. 조경 지형·우수·식재·토양·관수

이 순서는 UI의 단순함만을 기준으로 하지 않는다. 실제 독립 원본, 전문가 및 검증기 준비 상태가 더 앞선 분야를 먼저 승격할 수 있다.

완료 게이트:

- 해당 분야 독립 case 20건과 case당 2개 서명
- 필수 축 accuracy와 coverage 각각 95% 이상
- false-verified 0
- open surface를 exact solid로 오판한 사례 0
- IFC/도면/수량의 revision 일치
- 공개 문구와 실제 지원 범위 일치

### M5 — 제품별 GA

목표 창: 증거 기반, 고정 날짜 없음

GA는 플랫폼 전체를 한 번에 선언하지 않는다. 릴리스 채널을 제품별로 분리한다.

- 제품·기계 GA
- 복잡 제품군별 validated pilot/GA
- 공간·인프라 분야별 Beta/GA

완료 게이트:

- 해당 릴리스 채널의 readiness blocker 0
- 7일 운영 정책 통과
- production smoke 및 Web/API/CLI/MCP parity 3회 연속 통과
- 해당 제품 채널의 실제 artifact, blind review와 위험 기반 승인 완료
- 지원 범위 내 제조 또는 납품 검증 완료
- 보안, 백업·복구, 결제 및 사고 대응 리허설 완료

## 7. 우선순위 백로그

### P0 — 지금 바로 진행

1. 88개 수정·64개 신규 파일을 검토 가능한 release commit 묶음으로 정리
2. 외부 C4·외부 holdout 기반 gate를 자체 실증 evidence v2로 버전업
3. 핵심 피처 30종의 실제 기준 설계와 artifact runner 구현
4. 30건 × 5표현의 150개 intent 정확도 campaign 구현
5. 로봇 22개 부품 사양을 고정하고 29부품·68 mate r+1 실행
6. 절삭·판금·적층 3건과 로봇 시제품 실증 준비

### P1 — 상용 전환 직결

1. AI↔정밀 CAD 양방향 수정 루프
2. STEP/BOM/도면/DFM 동일 revision binding
3. 부품·단순 조립체의 유료 파일럿 주문 흐름
4. 전문가 검토와 제조 견적 handoff
5. 랜딩·설계 시작·내보내기 전환 분석
6. 복잡 로봇 exact component 통합과 재검증

### P2 — 신뢰성과 확장

1. `ShapeGeneratorInner.tsx`를 작업 단위별로 분리
2. ESLint 경고를 신규 경고 0 정책으로 전환하고 기존 경고 단계 감축
3. 공간·인프라 분야별 독립 holdout
4. native worker가 필요한 형식과 대체 evidence 정책 정리
5. 브라우저·성능·접근성 회귀 게이트 자동화

### 보류

- 다섯 도메인의 동시 GA
- 기존 전문 CAD 전체 기능과의 무차별 parity 경쟁
- 증거 없는 “복잡 제품 제조 완성” 마케팅
- 압력용기·안전 필수 제품의 무검토 self-service
- 매뉴얼 PDF의 서비스 내 재배포 또는 독립 증거 대체 사용

## 8. 측정 지표

### 8.1 제품 전환

- 랜딩 방문 → 설계 시작률
- 설계 시작 → 요구사항 확정률
- 요구사항 확정 → 검증 결과 생성률
- 검증 결과 → STEP/BOM/도면 내보내기율
- 내보내기 → 견적·전문가 검토 전환율
- 파일럿 시작 → 실제 납품 완료율

### 8.2 설계 품질

- required gate 실행률 100%
- false-verified 0
- `not_run`과 근사 결과의 명시율 100%
- 제품군·Tier·필수 축별 accuracy와 coverage 별도 보고
- STEP/BOM/도면 revision 불일치 0
- 사용자 잠금값 비의도 변경 0

### 8.3 운영 품질

- HTTP 5xx 1% 미만
- 메모리 정책 한도 준수
- 168시간, 28개 관찰 창 충족
- 비로그인 정상 흐름의 예상 밖 4xx 0
- 핵심 모바일 가로 overflow 0
- 핵심 사용자 흐름의 심각한 접근성 차단 0

### 8.4 사업 검증

- 디자인 파트너 수
- 유료 파일럿 수와 재구매율
- 프로젝트당 전문가 개입 시간
- 견적 요청과 제조 주문 전환율
- 제품군별 실패·거절·수동 검토 비율

모든 지표는 제품·기계와 공간·인프라를 분리 집계한다. 한쪽의 높은 성과로 다른 쪽의 미검증 상태를 가리지 않는다.

## 9. 역할과 외부 의존성

### 시스템과 코드로 진행 가능한 작업

- IA, 라우팅, 카피, 범위 표시 및 Beta 게이트
- UX, 모바일, 접근성, 성능 및 유지보수 개선
- 자동 검증, evidence binding 및 readiness 집계
- reviewer packet, acquisition queue 및 검토 UI
- 자동 운영 receipt와 회귀 테스트

### 사람 또는 물리 입력이 반드시 필요한 작업

- blind challenge의 구현자와 분리된 내부 판정
- 고위험 기계·로봇 release 검토
- 로봇 구매 부품의 권위 datasheet와 실제 사양
- 제조 가능성 및 실제 제작 검증
- 결제·환불·보험·약관에 대한 사업자 의사결정
- 최종 GA 승인

물리 입력과 실증은 코드 작업이 끝날 때까지 기다리지 않는다. P0부터 부품 사양 확정과 제작 준비를 병행해야 전체 일정의 임계경로를 줄일 수 있다.

## 10. 의사결정 규칙

새 작업은 다음 질문 순서로 우선순위를 결정한다.

1. 제품·기계 사용자의 설계 완주, 검증 또는 제조 연결에 직접 기여하는가?
2. false-verified나 데이터 손실 같은 신뢰 위험을 줄이는가?
3. 유료 파일럿 전환 또는 운영 안정성에 기여하는가?
4. 현재 릴리스 채널의 독립 증거를 늘리는가?
5. 위 네 가지에 해당하지 않는다면 공간·인프라 Beta 또는 장기 연구 백로그로 보낸다.

기능이 구현됐다는 이유만으로 공개하지 않는다. 반대로 외부 증거가 아직 부족하더라도, 범위와 한계를 명확히 표시하고 fail-closed로 동작한다면 제한형 비공개 파일럿에서 검증할 수 있다.

## 11. 다음 실행 묶음

다음 구현 세션은 아래 순서로 시작한다.

1. mechanical evidence/gate v2 schema와 migration
2. 30개 실제 설계 case manifest와 runner
3. 150개 intent campaign과 단계별 지표
4. 로봇 고정 요구사항·22개 사양 worksheet·r+1 재현 실행
5. gearbox family golden assembly 5건
6. 깨끗한 commit에서 typecheck/build/security/336개 집중 회귀 재실행
7. 새 staging candidate의 72시간 후 7일 운영 관찰

동시에 물리 준비를 시작해야 하는 묶음:

1. 로봇 22개 구매 부품 사양과 공급 가능성 확정
2. 절삭·판금·적층 기준 부품의 제작처 또는 내부 공정 확정
3. blind challenge 검토 역할과 고위험 이중 승인 역할 분리
4. 로봇 한 축 rig와 축소/완전 시제품 제작 계획
5. 3~5개 제품·기계 디자인 파트너 모집

## 12. 관련 정본

- 현재 상태·정확도·완성도 계획: `docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`
- AI 기계 CAD 제품 전략: `docs/strategy/ai-mechanical-cad-category-dominance-plan-260811.md`
- 기계 코어 실행서: `docs/process/mechanical-core-commercialization-runbook.md`
- 로봇 실행서: `docs/process/robot-verified-product-runbook.md`
- 제품·기계 판매 범위: `docs/ai-manufacturing-sales-scope.md`
- 상용 준비도: `docs/evidence/release/commercialization-readiness-current.json`
- staging 운영 증거: `docs/evidence/release/staging-a687007b-seven-day-operations-receipt-current.json`
- 복잡 제품 범위 평가: `docs/evidence/cad-independent/complex-product-scope-assessment.json`
- 로봇 릴리스 감사: `docs/evidence/release/robot-production-completion-audit-260811-v4.json`
- 독립 도메인 검토 키트: `docs/evidence/release/independent-domain-review-kit-260810.json`
- 복잡 제품 부족분 queue: `docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json`
- 매뉴얼 요구사항: `docs/cad-program/requirements/manual-requirements.json`
- 도메인 프로필: `src/lib/ai/domainProfileRegistry.ts`
- 기존 통합 UI: `src/components/nexyfab/NexyfabUnifiedSidebar.tsx`

이 문서는 제품 방향과 우선순위의 기준이다. 개별 정확도 수치와 릴리스 판정은 각 JSON evidence 정본을 따른다. 수치가 달라지면 정본을 먼저 갱신하고 이 문서의 상태 스냅샷을 후속 버전에서 갱신한다.

## 13. 2026-08-11 구현 웨이브 결과

이번 웨이브는 배포하지 않고 로컬 후보에만 적용했다. 7일 관찰 중인
`a687007b` 스테이징 빌드와 그 운영 증거는 변경하지 않았다.

완료한 코드 범위:

- 상위 IA를 `제품·기계 설계`와 `공간·인프라 설계 Beta`로 재편하고 기존 세부 경로를 보존
- 첫 요청 자동 분류에서 한국어 중첩 키워드와 영문 부분 문자열 충돌을 제거
- 비로그인 session probe를 하나로 통합하고 정상 게스트 흐름의 알림·refresh 연쇄 4xx를 제거
- 게스트 AI 사용량을 새 스레드로 초기화할 수 없는 서버 일일 쿼터로 이동
- 393px 설계·정밀 CAD에서 데스크톱 전용 UI를 제거하고 가로 overflow를 0으로 유지
- 핵심 설계 화면의 axe critical/serious 위반을 0으로 만들고 라이트·다크 사이드바 텍스트 대비를 AA 이상으로 보정
- 생성 결과를 `개념 / 제조 전 검토 / 제조 게이트 검증`으로 분리하고, 누락된 생성 검사를 `not_run`으로 fail-closed 처리
- STEP·BOM·도면 패키지의 실제 바이트와 모든 출력 영향 입력을 동일 revision SHA-256 manifest에 결속
- 로봇 구동계 18개와 보조부품 4개의 선정·통합 상태를 분리하고, apply receipt·r+1 프로그램·정밀 보고서를 target/application hash로 교차 결속
- 독립 CAD 32건에 대해 실제 파일·라이선스·격리·native 구조·검토 서명을 검증하는 v2 인입기, pending-only 스캐폴드, JSON Schema 및 runbook 추가

검증 결과:

- 프로덕션 빌드, Next TypeScript 빌드 및 291개 정적 페이지 생성 통과
- 공유 JS 721.8 KB / 예산 781.3 KB, 최악 첫 화면 1579.3 KB / 예산 1660.2 KB
- 변경 범위 통합 Vitest 41파일 187건 통과, 최종 로봇 직접 테스트 33건 통과
- 비로그인 네트워크 E2E 3건, responsive E2E 5건, 핵심 axe E2E 4건 통과
- 전체 소스 ESLint 오류 0, route security 548개 라우트·760개 handler 누락 0
- 비밀값 스캔 6,763파일에서 탐지 0, CAD API 통제·커널 정체성·라이선스·복잡제품 범위 검사 통과

후속 재점검에서 기계 11파일 89테스트, 로봇 36파일 143테스트, 일반 복잡 조립체
13파일 104테스트와 전체 TypeScript가 통과했다. 현재 판정은 **AI 정밀 기계 CAD와
로봇 전용 파이프라인의 로컬 구현 후보 통과, 실제 artifact·제조·운영 증거 전 GA 차단
유지**다. 독립 복잡제품 32-slot 스캐폴드는 선택적 reference/상호운용성 트랙으로
보존하며 기본 기계 출시 조건으로 사용하지 않는다.

다음 임계경로:

1. 외부 C4·외부 holdout hard blocker를 자체 실증 evidence v2로 migration
2. 기계 핵심 30개 실제 설계 package와 150개 intent campaign
3. 로봇 22개 사양 입력, 29부품·68 mate r+1, exact-CAD·공차·케이블·시제품 검증
4. 절삭·판금·적층 3건 실제 제작과 실측
5. Redis·메모리 조정 후 72시간 candidate와 168시간 GA 운영 receipt
6. 깨끗한 commit에서 private-beta gate를 재실행하고, 별도 preview/canary 후에만 승격

코드가 자동으로 만들 수 없는 구매 부품 정격, 재료·공차·하중, 실제 제조 실측,
운영 시간 증거를 추정값이나 placeholder로 채우지 않는다.
