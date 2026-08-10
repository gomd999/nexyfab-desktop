# NexyFab 복잡 제품 AI 생성 정확도 개선

- 기준일: 2026-08-09
- 목표: 초안 생성률이 아니라 `요구사항 → 독립 부품 → 인터페이스 → 정밀 형상 → 조립 → 제조·왕복`의 정확도를 높인다.
- 보호 기준: Closed Beta 계정·비밀번호 해시·DB 행·업로드·저작물은 수정하지 않는다.
- 참고자료 기준: `C:\Users\gomd9\Downloads\참고파일들`은 읽기 전용 평가 코퍼스다. 사용권 승인 전 학습 데이터나 상용 ground truth로 사용하지 않는다.

## 1. 확인한 기존 취약점

기존 다단계 refinement는 AI가 제출한 `completeness`와 `confidence`를 단계 진입 판단에 사용했다. 최종 ProductDecompositionPlan의 타입 구조는 검사했지만 다음 의미 오류가 숨겨진 경우 geometry 단계 진입을 완전히 차단하지 못했다.

- plan 내부의 assumption/unresolved와 draft 최상위 unresolved 불일치
- 재료·공정·구매품 catalog provenance 미확정
- 요구사항이 어느 부품에도 할당되지 않은 상태
- 고하중·운동·안전 요구사항의 측정 가능한 acceptance 누락
- 비고정 부품이 fixed root까지 mate로 연결되지 않은 상태
- 동일 definition의 반복 인스턴스가 서로 다른 형상·제조 메타데이터를 가진 상태
- 비단위 quaternion 또는 10개 이상 occurrence의 평면화된 조립 구조
- AI가 임의 문자열을 evidenceRefs로 제출한 상태

## 2. 구현한 독립 정확도 게이트

`ProductDecompositionPlan`이 geometry 단계로 넘어가려면 서버가 다음 8개 게이트를 모두 직접 통과시킨다. 모델의 confidence 100%는 이 판정을 대체하지 못한다.

1. `structure`: 기존 구조·ID·FeatureTree·mate·subassembly 검증
2. `requirements`: 명시 요구사항, sourceRef, 중요 요구사항 acceptance 확인
3. `traceability`: 모든 요구사항이 한 개 이상의 편집 가능한 component definition에 할당됐는지 확인
4. `authoritative-inputs`: assumption, unresolved, assumed metadata, 재료·공정, 구매품 catalog provenance 확인
5. `editable-definitions`: 불투명 placeholder 대신 독립 FeatureTree 또는 승인된 catalog geometry 요구
6. `assembly-connectivity`: 모든 movable occurrence가 active mate 경로로 fixed root에 연결됐는지 확인
7. `hierarchy`: 10개 이상 occurrence 제품의 기능적 subassembly 계층 요구
8. `transforms`: 위치 유한값과 orientation 단위 quaternion 확인

판정 결과는 API 응답의 `accuracyAssessment`와 generation stage metrics의 `accuracyGatesPassed / accuracyGatesTotal`에 기록된다. 실패 원인은 다음 AI 시도의 structured feedback으로 전달되며, 이미 검증된 상위 stage를 전부 다시 만들지 않는다.

## 3. 권위 입력과 증거 경계

- `concept_only` 또는 unresolved가 남은 프로그램은 kernel geometry 시작 전에 `AUTHORITATIVE_INPUT_REQUIRED`로 차단한다.
- `review_required` 프로그램 안의 assumed component metadata도 거부한다.
- 반복 definition은 FeatureTree, part number, material, process fingerprint가 같아야 한다.
- AI가 새 evidence 문자열을 발명할 수 없다. `user:prompt`, 서버가 전달한 immutable ref, 실제 checkpoint hash, 현재 요청에 해당하는 승인 매뉴얼 requirement id만 허용한다.
- 형상만 보고 native mate, 설계압력, 공차, 재료, 제조공정 또는 catalog identity를 추정하지 않는다.

## 4. 참고 코퍼스에서 반영한 제품군 가이드

참고 원본 형상을 생성 입력으로 복제하지 않고, 전체 manifest/회귀 결과에서 확인한 제품군별 검증 항목만 prompt gate로 반영했다.

- gearbox: ratio, torque/speed, backlash, center distance, bearing/shaft fit, lubrication, service life
- pressure vessel: pressure/temperature, code basis, allowable, corrosion allowance, weld efficiency, nozzle load, test condition
- turbomachinery: operating envelope, fluid, RPM/direction, balance, blade count, clearance, shaft/bearing interface
- factory equipment/conveyor: payload, duty cycle, speed, drive sizing, reaction, guarding, maintenance/service clearance
- 공통: 요구사항 sourceRef와 부품 할당, 독립 occurrence, 조립 mate 연결, STEP hierarchy 왕복

## 5. 검증 결과

- 대상 Vitest: 10개 파일, 42개 테스트 통과
- model confidence 100% + 숨겨진 assumption 차단
- concept-only kernel 진입 차단 및 assembly verifier 미호출 확인
- 동일 definition 형상 divergence 차단 확인
- 끊긴 mate graph와 비단위 quaternion 차단 확인
- 제품군별 reference guidance 선택 확인
- 복잡 제품 scope 증적과 kernel-stack identity 재생성·일치 검사 통과
- TypeScript 통과
- production build 통과: 634개 정적 페이지 생성, 번들 예산 충족
- CAD API 제어 증거 통과: 57/57 handler, issue 0
- OCCT commercial readiness 통과: warning 0, error 0
- Closed Beta 최종 무결성 통과: 기준 스냅샷과 보호 테이블·행·파일·DB 경로 해시·DB 크기 모두 동일
  - 보호 테이블 17개, 보호 행 13개
  - 보호 파일 15개, 15,429,420 bytes
  - 검사 source는 readonly 유지

운영 배포 전 남은 환경 조건은 `REDIS_URL` 설정이다. 현재 production build는 통과하지만, 미설정 상태의 in-memory rate limit은 다중 인스턴스에서 공유되지 않는다.

## 6. 정확도 수치에 대한 정직한 판정

이번 변경은 오류 결과가 geometry 단계로 진입하는 비율과 false verification 위험을 낮추는 구조적 개선이다. 이것만으로 실제 복잡 제품 생성 정확도가 몇 퍼센트 상승했다고 주장할 수는 없다.

상용 정확도 수치는 승인된 holdout case를 제품군별 최소 20개, campaign 3회, campaign별 repeat 5회로 실행하고 다음 조건을 만족한 뒤에만 제시한다.

- 축별 micro/macro accuracy ≥ 95%
- coverage ≥ 95%
- required gate pass rate = 100%
- false verified = 0
- false clearance = 0
- destructive part merge = 0

현재 참고 코퍼스 전체는 활용 queue에 연결됐지만 라이선스·ground truth·native semantics 승인이 끝나지 않은 자료는 KPI 분모나 학습 데이터로 승격하지 않는다.
