# NexyFab AI 기계 CAD + 정밀 CAD 카테고리 장악 계획

작성일: 2026-08-11  
상태: 제품 전략 실행 정본  
적용 우선순위: 이 문서의 제품 계층과 자원 배분은 기존 다분야·두 경로 전략보다 우선한다.

> **현재 상태 갱신:** 구현 수치, 증거 정책과 다음 실행 게이트는
> `docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`를
> 우선한다. 이 문서는 제품 포지셔닝과 장기 자원 배분의 정본이다.

## 1. 최종 결정

NexyFab의 주력 제품은 다분야 설계 플랫폼이 아니다.

> **NexyFab은 요구사항에서 제조 검토 가능한 기계 제품을 만들고, AI와 정밀 CAD 사이를 손실 없이 반복 수정하는 AI Mechanical CAD 제품이다.**

고객이 구매하는 하나의 핵심 제품은 다음 폐루프다.

`요구사항·도면·기존 STEP → AI 기계 설계 → 편집 가능한 정밀 CAD → AI 재수정 → 검증 → STEP/BOM/도면/제조 연결`

건축·토목·조경·인테리어는 이 제품과 동급인 설계 분야가 아니다. 공통 AI·기하·검증 기술을 재사용하는 **Space Design Labs 부가 서비스**로 분리한다.

- 제품·기계·장비·로봇·복잡 조립체: 주력 상용 제품
- 정밀 CAD: 주력 제품 내부의 편집·검증 엔진
- DFM·도면·BOM·견적·제조 연결: 주력 제품의 하류 단계
- 건축·토목·조경·인테리어: 별도 Labs/Beta, 독립 약관·지표·릴리스 게이트

기존 공간 분야 코드를 삭제하지 않는다. 다만 핵심 랜딩, 기본 온보딩, 요금제, 사례, 검증 자원과 출시 판정에서 분리한다.

## 2. 현재 상태 감사

### 2.1 이미 강한 기반

1. 자연어와 도면·스케치에서 기계 설계 intent를 만들고 SCAD/STEP까지 연결하는 흐름이 있다.
2. AI 출력 뒤에 결정론 형상·조립·간섭·제조 게이트를 두는 구조가 있다.
3. 정밀 CAD 작업공간에는 파트, 스케치, 피처, 어셈블리, 도면, 해석, CAM/PDM 관련 광범위한 기능 카탈로그가 있다. 현재 registry 항목은 648개다. 단, 카탈로그 등록 수는 상용 완성도나 AI 폐루프 지원 수와 동일하지 않다.
4. AI 결과를 정밀 CAD로 열고, 정밀 CAD 모델을 다시 AI 문맥으로 보내는 양방향 진입점이 존재한다.
5. 결과 revision과 STEP/BOM/도면 byte hash를 결속하고, 제조 승인과 단순 생성 성공을 구분한다.
6. 로봇 18개 구동계와 4개 보조 부품의 적용 영수증·사후 검증 구조가 있다.
7. 게스트 세션, 모바일, 접근성, 라우트 보안 및 비밀정보 검사는 상용 후보 기준으로 정리됐다.

### 2.2 전략과 화면의 현재 일치도

이번 구현 wave에서 다음 불일치는 해소됐다.

1. 상위 IA는 `제품·기계 설계`를 주력으로, `공간·인프라 설계 Beta`를 보조 그룹으로 분리했다.
2. 한국어·영어 부분 문자열 충돌을 제거해 명확한 공간 요청이 기계 기본값으로 잘못 라우팅되는 문제를 수정했다.
3. 기계 release channel을 공간 분야 증거와 분리하는 readiness v2 preview를 만들었다.
4. 결과 화면은 생성 성공, 제조 전 검토와 제조 검증을 서로 다른 상태로 표시한다.

남은 불일치는 제품 카피보다 release gate/schema에 있다. 현재 일부 정본은 외부 C4, 외부 holdout과 이전 5도메인 조건을 계속 요구한다. 이 조건은 새 자체 실증 정책 v2로 버전업해야 하며 JSON을 손으로 완화하지 않는다.

### 2.3 가장 큰 기술 병목: 실제 산출물 기반 폐루프

Mechanical Design Graph, 핵심 30개 피처 계약과 NFAB/STEP 3회 왕복이 구현됐다. 최신 집중 검증에서는 38개 runtime 피처 중 35개가 단독 형상을 생성하고, 문맥이 필요한 3개는 fail-closed 처리됐다. 빈 형상과 apply 누락은 0이다.

따라서 현재 병목은 더 이상 단순 adapter 존재 여부가 아니다.

1. 30개 피처가 실제 제조 맥락의 서로 다른 기준 설계에서 완주하는가?
2. 한국어·영어·혼합 단위·누락·모순 요구사항에서도 올바르게 질문하거나 거부하는가?
3. 긴 편집 체인과 context 피처에서 stable selection과 잠금값이 유지되는가?
4. STEP, 도면과 BOM이 사용자가 받는 실제 package에서 같은 revision을 가리키는가?

카테고리 장악의 최우선 과제는 **지원 피처 수를 실제 30개 설계 package와 150개 intent 평가로 전환하는 것**이다.

### 2.4 제조 신뢰의 현재 한계

- 자체 OCCT STEP 3회 왕복과 revision consistency는 통과했다.
- 상용 manifest는 실제 제조 증거가 없을 때 `manufacturingAllowed: false`, `review_required`를 유지한다.
- 상용 CAD 제품별 C4와 외부 CAD 32건은 기본 출시 조건에서 제외하기로 결정했다.
- 절삭·판금·적층의 실제 제조 3건과 실측 결과는 아직 없다.
- 로봇 최신 코드는 29부품·68 mate·22 occurrence·unresolved 0 경로를 갖지만 해당 실제 r+1 정본과 시제품 evidence가 없다.

판정: **내부 정확성 기반은 강하고 외부 CAD 의존성은 제거됐지만, 물리 제조와 최신 artifact 실행 증거는 아직 부족하다.**

## 3. 경쟁 구도와 이길 수 있는 자리

### 3.1 경쟁자가 강한 영역

- SOLIDWORKS: 검증된 파트·대형 어셈블리·도면·시뮬레이션·CAM·클라우드 데이터 관리와 확장 중인 기계 설계 AI
- Autodesk Fusion: CAD/CAM/CAE/PCB/PDM과 제조 워크플로의 통합
- Onshape: 클라우드 네이티브 CAD/PDM, 협업, 브랜치·머지, Simulation 및 CAM
- Zoo: 자연어→B-rep/KCL, 코드·포인트앤클릭·AI 편집을 한 모델에서 연결

NexyFab이 이들을 단기간에 모든 수동 CAD 기능으로 앞서려는 전략은 실패 확률이 높다.

### 3.2 NexyFab의 승리 조건

NexyFab은 다음 다섯 가지를 하나의 감사 가능한 revision에서 제공해야 한다.

1. 긴 요구사항을 부품·인터페이스·공차·하중·제조 조건으로 구조화
2. 단일 부품이 아니라 실제 복잡 조립체와 동작 구조 생성
3. AI 변경과 사람의 정밀 편집을 피처·구속·메이트 손실 없이 반복
4. 모든 결과에 계산 근거, 누락 입력, 근사, 실패 gate와 artifact lineage 표시
5. STEP/BOM/도면/DFM/견적을 동일 revision에서 파생

포지셔닝은 `AI가 CAD를 대신 그려준다`가 아니라 다음이어야 한다.

> **AI가 제품 설계를 실행하고, 정밀 CAD가 모든 결정을 보존하며, 검증 체인이 무엇을 믿어도 되는지 증명한다.**

## 4. 목표 제품 구조

### 4.1 외부 정보구조

핵심 내비게이션:

1. 새 기계 설계
2. AI CAD
3. 정밀 CAD
4. 프로젝트
5. 검토·제조
6. 부품·템플릿

보조 내비게이션 또는 앱 스위처:

- Space Design Labs `Beta`
  - 건축
  - 토목
  - 조경
  - 인테리어

공간 분야를 핵심 랜딩의 동급 CTA로 두지 않는다. 랜딩 하단의 `다른 설계 도구` 또는 앱 스위처에서만 진입시키고, 별도 배경·배지·책임 범위를 적용한다.

### 4.2 핵심 사용자 흐름

```text
요구사항/도면/STEP
        ↓
요구사항 그래프와 누락 입력 확인
        ↓
AI 파트·조립체·동작 설계
        ↓
정밀 CAD에서 치수·피처·공차·메이트 편집
        ↓
AI가 현재 revision에 patch 제안
        ↓
사람이 diff 검토 후 적용/거부
        ↓
형상·동작·공차·DFM·STEP roundtrip 검증
        ↓
동일 revision의 STEP/BOM/도면/증거 패키지
        ↓
전문가 승인 또는 제조 견적
```

AI와 정밀 CAD는 서로 다른 제품이 아니라 같은 설계 revision을 보는 두 작업 방식이다.

### 4.3 단일 설계 정본

새로운 중심 계약을 `Mechanical Design Graph`로 정의한다.

필수 노드:

- requirements와 authoritative inputs
- sketches, constraints, dimensions, parameters와 units
- ordered features와 stable topology references
- parts, subassemblies, mates, motion와 interfaces
- material, process, tolerance, GD&T와 finish
- catalog component identity와 datasheet lineage
- analysis assumptions, boundary conditions와 gate results
- drawings, BOM, STEP와 모든 artifact hash
- AI patch, manual edit, approval와 rollback history

원칙:

- AI는 전체 모델 문자열을 다시 만드는 대신 그래프 patch를 제안한다.
- 정밀 CAD 편집은 동일 그래프의 명령으로 기록한다.
- 적용 전 예상 diff와 영향받는 요구사항·산출물을 보여준다.
- 미지원 노드가 하나라도 있으면 전체 재생성을 막고 부분 patch 또는 사람 편집으로 전환한다.
- export 성공과 roundtrip 검증, 제조 승인 상태를 분리한다.

## 5. 실행 로드맵

### P0 — 제품 초점과 출시 계약 분리

상태: IA·라우팅·결과 신뢰 표시는 구현 완료, gate/schema migration 진행 필요

1. 완료: 사이드바를 `제품·기계 설계` 주력과 `공간·인프라 설계 Beta` 보조 그룹으로 재편
2. 완료: 명확한 기계·공간 요청의 자동 라우팅 충돌 제거
3. 완료: 생성·제조 전 검토·제조 검증 상태를 결과 화면에서 분리
4. 완료: `mechanical-core`가 공간 분야를 요구하지 않는 readiness v2 preview
5. 남음: 외부 C4·외부 holdout hard blocker를 자체 실증 정책 v2로 schema와 validator까지 버전업
6. 남음: 깨끗한 release commit에서 current readiness 정본 재생성

완료 기준:

- 신규 사용자가 첫 30초 안에 NexyFab을 기계 제품 CAD로 인식
- 핵심 화면에서 건축·토목·조경·인테리어 동급 선택 0
- 기계 GA 판정이 공간 Labs의 미완성 증거에 의존하지 않음
- 공간 서비스는 URL, 분석 지표, 약관, 배지와 릴리스 상태가 분리됨

### P1 — AI↔정밀 CAD 무손실 폐루프

상태: 코어 계약과 회귀 구현 완료, 실제 설계 artifact campaign 필요

1. 완료: lossless Mechanical Design Graph와 revision-bound patch
2. 완료: 핵심 피처 30종 runtime contract와 3회 NFAB/STEP 기반
3. 완료: unknown/inline unsupported feature fail-closed
4. 남음: 30개 제조 맥락 기준 설계의 실제 NFAB/STEP/도면/BOM package
5. 남음: 한국어·영어·혼합 단위·누락·모순을 포함한 150개 intent 평가
6. 남음: context 피처와 긴 edit chain의 selection/topology 안정성 증거

핵심 피처 1차 범위:

- sketch line/arc/circle/polyline와 geometric/dimensional constraints
- extrude, cut, revolve, hole, fillet, chamfer, shell, draft
- linear/circular pattern, mirror, rib, sweep, loft
- datum plane/axis, thread metadata, sheet-metal base/flange/bend
- part occurrence, fixed/revolute/slider/fastened mate, subassembly

완료 기준:

- 지원 피처 survival 100%
- 잠금 치수·공차 drift 0
- topology reference silent remap 0
- 세 번의 AI/수동 왕복 후 동일 설계 의도와 artifact lineage 유지
- 모든 AI 수정에 적용 전 diff, undo와 revision hash 존재

### P2 — 기계 CAD 깊이와 복잡 제품

상태: 공통 조립체 엔진과 로봇 전용 경로 구현, family별 실행 증거 필요

1. 단일 파트: 스케치·히스토리·구성·판금·용접·가공 피처 완성도 집중
2. 어셈블리: 대형 구조, mate solve, motion, interference, clearance와 BOM 정합
3. 도면: associative view, section/detail, GD&T, tolerance stack와 revision 연동
4. 기존 STEP: exact import, healing, feature recognition과 editable reconstruction
5. 설계 계산: 하중·재료·경계조건의 authoritative input 요구와 결과 trace
6. 복잡 제품 사다리: bracket → housing → robot pilot → gearbox → skid/equipment
7. 실제 부품 카탈로그와 대체 부품 영향 분석

완료 기준:

- 지원 제품군별 직접 설계 golden 5건과 blind challenge 5건
- exact STEP re-import 후 필수 topology·치수·부품 수·위치 일치
- 조립 freedom, mate, collision와 motion 검사 통과
- BOM·도면·STEP revision 불일치 0

### P3 — 제조 증거와 유료 파일럿

목표: 직접 설계·실물 제작·실측

1. 절삭·판금·적층의 서로 다른 직접 설계 3건 제작
2. 로봇 22개 구매 부품의 authoritative datasheet 입력과 exact r+1 integration
3. 한 축 rig와 축소형 또는 완전한 6축 robot prototype
4. 구현자와 최종 판정 역할을 분리한 내부 검토
5. 3~5개 디자인 파트너와 유료 또는 계약형 pilot
6. 실제 가공/출력/조립 결과와 CAD·도면·BOM 교차 확인
7. 실패·재작업·리드타임·원가 추정 오차를 제품 지표로 환류

완료 기준:

- false-verified 0
- 파일럿 필수 gate 실행률 100%
- 제조 결과와 잠금 요구사항의 비의도 변경 0
- 역할이 분리된 검토와 실제 제조 receipt가 있는 제품군만 validated pilot 승격

### P4 — 확장과 시장 장악

P0~P3가 입증된 뒤 수행한다.

1. API/CLI/MCP에서 동일 Mechanical Design Graph와 patch 계약 제공
2. 팀 설계, branch/merge, review, approval와 공급망 협업 강화
3. 사내 부품·규칙·과거 설계를 사용하는 private engineering context
4. 제품군별 설계 에이전트와 반복 최적화
5. 검증된 제조 파트너 네트워크와 quote-to-order 폐루프
6. 공간 Labs는 핵심 기계 제품 자원을 침해하지 않는 범위에서 독립 성장

## 6. 자원 배분 원칙

- 90%: AI 기계 CAD, 정밀 CAD 폐루프, 어셈블리, 검증, 제조 연결
- 5%: 공통 플랫폼 보안·운영·결제·협업
- 5%: Space Design Labs 유지보수와 제한적 실험

다음 조건 전에는 새로운 공간 기능을 P0/P1로 올리지 않는다.

1. 기계 핵심 사용자 흐름의 차단 결함인가?
2. 공통 커널의 정확성·보안 문제인가?
3. 유료 공간 고객 또는 계약된 증거 확보가 있는가?

셋 다 아니면 Labs backlog로 보낸다.

## 7. 북극성 지표

### 제품 가치

- 요구사항→첫 편집 가능 B-rep까지 걸린 시간
- 프롬프트→유효 파트 및 어셈블리 생성 성공률
- 사용자가 정밀 CAD에서 수정한 뒤 AI 재수정을 완료한 비율
- 설계당 유효 AI/CAD 반복 횟수
- STEP/BOM/도면 패키지 완주율

### 정확성과 신뢰

- 지원 피처 왕복 survival
- 잠금 치수·공차 drift
- topology/reference remap 실패
- STEP roundtrip 형상·위상·치수 일치
- assembly mate/collision/motion 통과
- false-verified와 artifact revision mismatch

### 상용성

- 활성 기계 프로젝트와 주간 재방문
- 파일럿→유료 전환
- 설계 시간 단축과 재작업 감소
- 제조 견적 요청 및 실제 주문 전환
- 제품군별 독립 승인 case 수

모든 지표는 `mechanical-core`, `complex-mechanical`, `spatial-labs`를 절대 합산하지 않는다.

## 8. 즉시 실행 순서

1. 88개 수정·64개 신규 파일을 검토 가능한 release commit 묶음으로 정리
2. 현재 외부 C4·외부 holdout gate를 자체 실증 evidence v2로 버전업
3. 핵심 피처 30종의 실제 기준 설계와 artifact campaign 구현
4. 30건 × 5표현의 150개 intent 정확도 campaign 구현
5. 로봇 22개 부품 사양을 고정하고 29부품·68 mate r+1 실제 실행
6. 로봇 torque/housing/tolerance/cable/motion evidence와 시제품 검증
7. 절삭·판금·적층 각 1건 직접 제작과 실측
8. gearbox부터 family별 golden assembly 5건 구축
9. Redis와 웹 메모리 문제를 조정한 72시간 candidate 관찰
10. 깨끗한 commit에서 전체 receipt와 7일 GA 관찰을 새로 생성

## 9. 중단해야 할 것

- 다섯 분야를 한 화면에서 동급 제품처럼 판매
- 기능 카탈로그 개수를 상용 완성도로 홍보
- AI가 지원하지 않는 피처를 누락하고 전체 모델을 재생성
- STEP 파일 생성만으로 제조 가능 또는 검증 완료라고 표시
- 기계 GA를 공간 분야 holdout 완료와 결합
- 실제 artifact·blind challenge·물리 실증 없이 정확도 수치를 마케팅
- SolidWorks/Fusion 전체 대체를 먼저 주장하고 핵심 폐루프 증명을 뒤로 미루기

## 10. 시장 기준 공식 참고

- SOLIDWORKS Design: https://www.solidworks.com/product/solidworks-design
- SOLIDWORKS AI Overview: https://www.solidworks.com/product/solidworks-design/ai-overview
- Autodesk Fusion: https://www.autodesk.com/products/fusion-360/overview
- Onshape AI Advisor: https://www.onshape.com/en/features/ai-advisor
- Onshape Simulation: https://www.onshape.com/en/features/simulation
- Onshape CAM Studio: https://www.onshape.com/en/features/cam-studio
- Zoo Design Studio: https://docs.zoo.dev/docs/zoo-design-studio
- Zoo KCL: https://zoo.dev/docs/kcl

## 11. 최종 판정

현재 NexyFab은 **광범위한 기계 CAD 엔진과 신뢰성 구조를 가진 강한 상용 후보**다. 그러나 카테고리를 장악할 하나의 완성된 제품이라기보다, 강한 기능들이 여러 표면과 변환 계층에 분산된 상태다.

가장 중요한 투자 순서는 다음 하나로 수렴한다.

> **기계 제품의 전체 설계 의도를 단일 revision에 보존하고, AI와 정밀 CAD가 그 revision을 손실 없이 반복 편집하며, 검증된 산출물을 제조까지 연결한다.**

이 폐루프를 먼저 압도적으로 완성하면 공간 설계 기술은 부가 매출과 장기 확장 자산이 된다. 반대로 공간 분야를 계속 동급으로 전면 노출하면 개발·검증·마케팅 초점이 분산되어 AI 기계 CAD의 승리 가능성이 낮아진다.
