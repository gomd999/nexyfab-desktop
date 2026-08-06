# NexyFab 복합 CAD 다음 실행계획 — 로봇 ReleaseReady부터 제트엔진·공장까지

## 0. 현재 기준선

현재 가능한 것:

- 자연어 제품 분해와 독립 FeatureTree 부품 생성
- 조립 메이트, 다성분 constraint Jacobian rank, 정밀 간섭, 생성 완료 인증
- 6축 로봇 구조부품 7개와 힌지 6개 생성
- DH 순기구학, 작업공간, 속도 Jacobian 특이점, 자세 샘플 자체충돌
- 중력 정적 토크, 케이블 굽힘·비틀림 검사
- Web·API·CLI·MCP 공통 계약

현재 로봇이 `releaseReady=false`인 이유:

1. 모터·감속기·베어링·브레이크·엔코더가 실제 부품 인스턴스로 선택되지 않았다.
2. 구조 링크가 단순 Extrude 기반 개념 형상이다.
3. 구매품 장착면·축·볼트 패턴과 구조부품 인터페이스가 완성되지 않았다.
4. 역기구학과 연속 경로 계획이 없다.
5. 링크 충돌은 캡슐 근사이며 실제 B-rep 동작 충돌 검증까지 연결되지 않았다.
6. 케이블은 굽힘·비틀림 규칙만 있고 실제 3D 경로와 간섭이 없다.
7. 부품별 G0–G9와 STEP AP242 조립 왕복 증거가 없다.
8. 실제 로봇 참고 CAD에 대한 정량 정확도 측정이 없다.

## 1. 최우선 원칙

- 한 번에 상세 외형을 생성하지 않는다. 성능 → 부품 선정 → 인터페이스 → 형상 순서로 진행한다.
- 구매품은 AI가 임의 치수를 만들지 않고 카탈로그 데이터와 artifact hash를 가진 인스턴스로 넣는다.
- 구조부품만 생성 대상으로 두고 모터·베어링·감속기는 구매품으로 구분한다.
- 모든 자동 수정은 메이트, 위상 참조, BOM, 검증 증거를 함께 갱신한다.
- 근사 충돌이나 미실행 해석을 통과로 표시하지 않는다.
- 로봇 하나가 실제 STEP 패키지까지 통과하기 전 제트엔진·공장 전체 자동 완성을 주장하지 않는다.

## 2. 실행 묶음 R1 — 카탈로그와 부품 선정

### R1-1. 공통 카탈로그 스키마

`CatalogComponent`에 다음을 정의한다.

- manufacturer, model, revision, source URL/문서, artifact hash
- envelope와 mass/inertia
- rated/peak torque, speed, voltage, efficiency
- 입력/출력축과 장착면의 persistent reference
- 볼트 원/패턴, 파일럿 지름, 축 지름, 키/스플라인
- STEP artifact와 단순화 collision shape
- 허용 온도·하중과 데이터 provenance

### R1-2. 선정기

- 모터: RMS/peak torque, 속도, 관성비, duty cycle, 열 여유로 선별
- 감속기: ratio, rated/peak torque, torsional stiffness, backlash, 허용 모멘트로 선별
- 베어링: bore, 동/정정격, 수명 L10, 회전수, 하중 방향으로 선별
- 브레이크·엔코더: 유지 토크, 분해능, 속도, 안전 요구조건으로 선별

### R1-3. 합격 조건

- J1–J6 각 축에 motor/reducer/bearing이 실제 catalog instance로 존재
- 선정 근거와 탈락 후보 기록
- 정격 초과·데이터 누락 시 자동 대체하지 않고 차단
- 동일 입력에서 결정론적으로 같은 부품 선택

## 3. 실행 묶음 R2 — 장착 인터페이스와 상세 구조부품

### R2-1. Interface IR

- axis, mounting_plane, pilot, bolt_pattern, shoulder, keyway, spline, connector, service_clearance
- shaft-bearing, motor-reducer, reducer-housing, bearing-housing, tool-flange 연결 템플릿
- 끼워맞춤 등급, 축방향 고정 방식, 조립 방향과 공구 접근

### R2-2. 구조 형상 생성

- 베이스: 앵커 패턴, J1 베어링 시트, 감속기 장착면
- 숄더/링크: 중공 리브 구조, 케이블 통로, 검사 커버
- 손목: 동축·직교 축 하우징, 얇은 단면과 베어링 간격
- 툴 플랜지: ISO 9409-1 계열 인터페이스를 명시적 입력으로 선택
- 각 형상은 스케치 구속 → Extrude/Revolve → Hole/Pattern → Rib/Shell → Fillet 순으로 생성

### R2-3. 형상 수리

- 작은 필렛 실패: 반경 축소 후보를 제시하되 확인된 반경은 자동 변경 금지
- Shell 실패: 문제 면과 최소 두께를 보고하고 국부 중실 대안 생성
- Boolean 실패: 연산 순서·공차·도구체를 단계별 재검증
- 영두께·비다양체: 해당 피처까지만 rollback

### R2-4. 합격 조건

- 모든 구매품과 구조부품이 독립 인스턴스
- 장착 reference 100% 해석
- 부품 병합 0건
- 고정부품을 제외한 미구속 부품 0건
- 의도되지 않은 B-rep 중첩 0건

## 4. 실행 묶음 R3 — IK·경로·운동 정확도

### R3-1. 역기구학

- 수치 damped least squares IK
- 관절 한계, seed pose, 자세 우선순위, 위치/방향 오차 분리
- 다해 후보 수집 후 관절 이동량·특이점 거리·충돌 여유로 순위화
- 도달 불가능, 한계 초과, 특이점 근접을 별도 오류로 반환

### R3-2. 작업공간

- 현재 bbox 외에 voxel/point cloud reachability map 생성
- 위치별 도달 가능한 자세 수와 manipulability 저장
- payload별 작업공간 감소를 별도 계산

### R3-3. 경로 계획

- joint-space interpolation과 Cartesian waypoint 경로
- 속도·가속도·jerk 제한 시간 파라미터화
- RRT-Connect 또는 동등한 충돌 회피 경로를 결정론적 seed로 실행
- 모든 경로 프레임에서 관절 한계·특이점·토크·충돌 검사

### R3-4. 합격 조건

- 골든 목표점 IK 성공률 99% 이상
- 도달 불가능 목표의 거짓 성공 0건
- 경로 프레임 누락 0건
- 충돌 경로 채택 0건

## 5. 실행 묶음 R4 — 정밀 충돌·케이블·조립성

### R4-1. 정밀 동작 충돌

- 캡슐 검사는 broad phase로만 유지
- 각 후보 프레임에서 FeatureTree/OCCT tessellation narrow phase 실행
- 로봇-자기충돌, 로봇-환경, 공구-공작물 충돌을 분리
- 안전거리와 실제 접촉을 구분

### R4-2. 케이블·호스

- base에서 tool까지 connector graph 작성
- 관절별 guide/clip/slack loop와 3D spline 경로 생성
- 굽힘반경, 누적 비틀림, 장력, 링크/커버 간섭 검사
- 교체 가능한 service loop와 분해 순서 기록

### R4-3. 조립·정비 경로

- 모터, 감속기, 베어링의 삽입 방향과 제거 envelope
- 볼트 공구 접근 cone/cylinder
- 커버를 열지 않고 교체 가능한 부품과 불가능한 부품 구분

### R4-4. 합격 조건

- 전 골든 자세 정밀 충돌 0건
- broad-phase 과탐이 최종 판정을 끌어내리지 않음
- 케이블 경로 미생성 상태는 통과 불가
- 주요 구매품 제거 경로 100% 확인

## 6. 실행 묶음 R5 — 제조·STEP 릴리스

### R5-1. 부품별 제조 게이트

- G0 provenance, G1 intent, G2 program, G3 kernel, G4 topology
- G5 dimensions, G6 feature fidelity, G7 DFM, G8 STEP roundtrip, G9 release evidence
- 가공부품의 공구 접근, 최소 코너 반경, 홀 깊이/직경비, 벽 두께
- 주조부품의 draft, 균일 벽, 가공 allowance

### R5-2. 조립 산출물

- 부품별 STEP AP242
- 조립 STEP AP242와 NAUO 계층
- BOM, material/process, 구매/제작 구분
- PMI/GD&T와 안정 위상 참조
- 조립도, 분해도, 메이트·간섭·운동 보고서

### R5-3. 왕복 검증

- 재가져오기 후 부품 수·이름·인스턴스·계층 비교
- 핵심 치수와 질량 비교
- PMI 대상 면 참조 비교
- 별도 부품이 하나의 Body로 합쳐지면 실패

### R5-4. 최종 로봇 합격 조건

- `releaseReady=true`
- 독립 부품/구매품 누락 0
- rank DoF=6, 미지원 constraint 0
- 정적·경로 정밀 충돌 0
- torque/cable/assembly/service 검사 통과
- 모든 제작품 G0–G9 통과
- STEP 왕복 계층·치수 통과

## 7. 실행 묶음 R6 — 실제 자료 정확도 평가

### 평가 세트

- Epson C4: 전체 로봇 외형·부품 구조·작업 범위
- MeArm: 부품 분해와 조립 관계
- Cycloidal 50: 감속기 내부 부품과 회전 관계
- C5055: 모터 housing/mount/stator/rotor 구조

### KPI

- 필수 부품 precision/recall
- bbox와 주요 치수 오차
- feature 종류·개수 일치율
- 메이트 관계 precision/recall
- DoF와 joint axis 일치
- 정밀 충돌 precision/recall
- STEP 왕복 성공률
- 생성 시간, 자동수리 횟수, 사용자 개입 횟수

평가 파일은 제품 단위 holdout으로 유지하고 프롬프트 예제에 넣지 않는다.

## 8. 배포 순서

1. 현재 로컬 변경 전체 회귀와 production build.
2. 로봇 API rate-limit, 입력 크기, NaN/Infinity, 과도한 sample 수 검증.
3. 운영 DB 변경이 없음을 확인.
4. 운영 배포 전 smoke fixture 실행.
5. 배포 후 health, AI SSE, robot API, shape-generator WebGL 확인.
6. 오류·5xx·지연시간을 관찰하고 문제 시 이전 배포 유지.

현재 변경은 이 안정화 단계가 끝날 때까지 운영 배포하지 않는다.

## 9. 로봇 이후의 확장

### 제트엔진 J1–J5

1. 축대칭 station/mean-line IR과 Brayton cycle.
2. fan/compressor/combustor/turbine/shaft/bearing/case 독립 어셈블리.
3. blade airfoil-loft-pattern과 tip clearance.
4. rotor critical speed, bearing load, 열팽창과 case clearance.
5. STEP·컷어웨이·회전 어셈블리. CFD/연소/고온피로 미실행은 공학 완료로 승격하지 않음.

### 공장 F1–F5

1. 로봇 셀: robot, conveyor, table, fence, sensor, control cabinet.
2. cycle-time/throughput/buffer와 설비 port graph.
3. 작업자·지게차·정비 envelope 및 안전거리.
4. 전기·공압·배관·케이블 트레이 라우팅.
5. IFC/STEP federation, grid/level/대좌표와 공정 검증.

## 10. 바로 다음 통합 작업 순서

1. `CatalogComponent`와 카탈로그 검증기.
2. J1–J6 모터·감속기·베어링 결정론 선정기.
3. `MechanicalInterface` IR과 표준 장착 reference.
4. 생성 로봇에 구매품 인스턴스와 장착 메이트 추가.
5. DLS IK와 reachability map.
6. 실제 B-rep 동작 충돌 연결.
7. 3D 케이블 경로와 정비 envelope.
8. 부품별 제조 게이트와 조립 STEP 패키지.
9. Epson/MeArm/Cycloidal/C5055 정량 KPI.
10. production build·smoke 후 운영 배포 승인 요청.
