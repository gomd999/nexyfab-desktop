# NexyFab 5개 분야 완성형 CAD 구축 마스터 계획

- 기준일: 2026-08-20
- 대상: 기계·제품, 건축, 인테리어, 토목, 조경
- 실행 원칙: **점검 → 구현 → 자동·수동 검증 → 조정 → 다음 단계**
- 배포 원칙: 각 단계가 모두 끝난 뒤 사용자가 배포를 요청할 때만 배포

### 실행 역할과 반복 사이클

- **Sol**: 기존 구현·중복·위험 점검, 구현 패킷 설계, 완료 게이트 정의, 구현 후 독립 검증과 필요한 조정
- **Luna**: 승인된 패킷을 빠르게 구현하고 focused test·typecheck·scoped lint 수행
- **통합 관리**: dirty worktree와 사용자 변경 보존, 패킷 간 의존성·회귀 확인, 다음 단계 진입 및 배포 보류 관리

각 패킷은 `Sol 계획/점검 → Luna 구현 → Sol 검증/조정 → 통합 게이트`를 통과해야 완료된다. 실패하거나 부분 구현된 항목은 완료율에 포함하지 않고 같은 패킷에서 조정하거나 명시적으로 후속 패킷으로 이관한다.

## 1. 결론

다섯 분야가 같은 화면을 쓰는 것만으로 완성형 CAD가 되지는 않는다. 공통 작업 셸과 프로젝트·AI·검증 계약은 공유하되, 각 분야는 서로 다른 의미 모델, 직접 편집 도구, 검증기와 산출물을 가져야 한다.

현재 기계 CAD는 피처 기반 정밀 편집과 조립·도면·제조 흐름이 가장 앞서 있다. 건축·토목·조경·인테리어는 의미 문서와 일부 파라미터 편집·검증이 있으나 아직 `개념 CAD Beta`에 가깝다. 특히 공간 분야는 객체 직접 선택, 좌표 배치, Undo/Redo·복구, AI 변경의 revision-bound 적용, 분야별 산출 흐름을 더 완성해야 한다.

### 현재 기준선과 승급 조건

| 분야 | 현재 기준선 | 다음 승급을 막는 핵심 항목 | 완성 판정의 대표 증거 |
|---|---|---|---|
| 기계·제품 | 정밀 피처·조립·도면 기반이 있는 상용 후보 | Surface/Sheet Metal/대형 Assembly/도면 연쇄 갱신/PDM 회귀 자격 | 복합 단품·조립체를 직접/AI 편집하고 STEP·DXF·PDF·BOM을 동일 revision에서 재생성 |
| 건축 | 파라미터형 개념 모델과 일부 검증 | 벽·공간·개구부 stable object 편집, 평·입·단 동기화, IFC/DXF/PDF | 다층 건물을 객체 단위로 편집하고 뷰·스케줄·교환 파일이 함께 갱신 |
| 인테리어 | 가구 배치와 일부 공간 검증 | host-aware 객체, 모든 배치 transaction, 문 스윙·피난·조도, 도면·FF&E | 실제 공간에서 가구·마감·조명을 배치/복구하고 도면·수량을 생성 |
| 토목 | CRS·배수 등 파라미터형 미리보기 | 측량/TIN, 선형·종단·횡단, corridor/grading, 좌표 roundtrip | 승인 좌표에서 선형·지형·배수를 편집하고 종횡단·수량을 재현 |
| 조경 | 지형·식재 파라미터형 미리보기 | terrain revision, 포장/식재 직접 편집, 관수·배수, 수량 | 지형 위 포장·식재·관수를 직접 편집하고 도면·수량·유지관리표 생성 |

공통 UI는 기계의 새 설계 채팅처럼 `AI 입력 + 직접 수정 + 객체/부품 라이브러리 + 2D/3D 뷰 + Inspector` 구조를 공유한다. 다만 프롬프트, 선택 객체, 도구 registry, 검증기와 산출물은 각 분야 계약으로 분리한다.

## 2. “완성형 CAD”의 공통 완료 조건

각 분야는 아래 8개 축을 모두 통과해야 `완성형`으로 판정한다.

| 축 | 완료 조건 |
|---|---|
| 의미 모델 | 안정 ID를 가진 분야 객체·관계·단위·좌표계·revision을 정본 문서로 보유 |
| 형상 커널 | 객체 변경이 실제 2D/3D 형상에 결정론적으로 반영되고 재생성 가능 |
| 인간 편집 | 선택, 추가, 삭제, 이동, 회전, 치수·속성 수정, 스냅·구속, 다중 선택 가능 |
| 이력·복구 | 모든 변경이 단일 transaction이며 Undo/Redo, 자동저장, 재접속 복구, 충돌 처리를 지원 |
| AI 에이전트 | 현재 revision·선택 scope·잠금값을 읽고 계획→확인→원자 적용→실패 복구 수행 |
| 검증 | 계산 실행 여부와 PASS/FAIL/NOT_RUN/BLOCKED를 과장 없이 분리하고 근거 보존 |
| 산출물 | 분야별 도면·표·수량·교환 파일이 현재 revision에서 재생성되고 추적 가능 |
| 상용 자격화 | 6개 언어/RTL, 접근성, 성능, 보안, 권한, PDM, 실제 사용자 시나리오를 통과 |

공통 금지 사항:

- HTTP 성공을 공학 검증 PASS로 표시하지 않는다.
- AI가 승인·해석·제조·시공 결과를 임의로 확정하지 않는다.
- 선택되지 않은 객체를 추측해 수정하지 않는다.
- 지원하지 않는 드래그, 내보내기, 해석을 동작하는 것처럼 표시하지 않는다.
- 기계 STEP/DFM 흐름을 공간 CAD의 검증·산출에 재사용하지 않는다.

## 3. 공통 기반 우선 작업

### F0. 인간 사용 가능한 공통 작업 셸

1. AI 입력, 직접 수정, 객체 라이브러리를 모든 분야에서 같은 위치와 방식으로 제공한다.
2. 이모지와 임시 텍스트 아이콘을 자체 `currentColor` SVG 아이콘 체계로 교체한다.
3. 선택 객체를 하이라이트하고 stable ID, 타입, 좌표, 주요 치수를 Inspector에 표시한다.
4. 수치 입력, 슬라이더, XYZ 이동, 회전, 스냅, 단위 변환, 범위·제조/시공 한계를 공통 컴포넌트로 제공한다.
5. 6개 언어와 아랍어 RTL에서 패널 방향, 논리 CSS 속성, 키보드 순서, 슬라이더 의미를 검증한다.

완료 게이트:

- 다섯 분야에서 `선택 → 수정 → 미리보기 → 적용 → Undo → Redo → 재접속 복구` E2E 통과
- 객체 추가 버튼은 실제 정본 문서와 2D/3D 뷰를 함께 변경
- 키보드만으로 주요 작업 수행, 포커스 복귀·Escape 취소 가능

### F1. 공통 transaction·PDM 계약

1. 분야별 전체 의미 문서를 transaction snapshot으로 저장한다.
2. 객체 ID·배치·관계·검증 상태·산출물 무효화 목록을 한 revision에 묶는다.
3. AI, 직접 편집, 객체 배치, reset, handoff 복귀가 모두 동일한 commit 경로를 사용한다.
4. Checkout 시 피처/객체 트리와 3D 모델을 복원하고, stale revision 적용은 차단한다.
5. 공간 CAD도 파일명만 표시하는 수준을 넘어 프로젝트 저장·버전·branch·권한과 연결한다.

### F2. 공통 AI 설계 계약

1. 요청을 신규 설계, 선택 범위 수정, 질문/제안으로 분류한다.
2. base revision/hash, stable object ID, 선택 scope, 사용자 잠금값, 현재 검증 상태를 입력에 포함한다.
3. AI 결과를 canonical candidate patch로 만들고 실제 변경점·영향·산출물 무효화를 먼저 보여준다.
4. 사용자가 승인해야 원자 적용하며, 오류·모델 변경·scope 불일치 시 자동 rollback한다.
5. 템플릿이 없거나 어휘가 낯설어도 generic planner로 계획을 제안하되 임의 적용하지 않는다.
6. 모델 장애 시 다른 모델로 fallback하고, 관리자 경보는 최초와 24시간 간격으로 제한한다.

### F3. 분야별 workflow와 산출 진실성

1. 공간 CAD의 Verify를 기계 DFM과 분리한다.
2. Export는 현재 분야에서 실제 구현된 형식만 활성화한다.
3. 검증 미실행·권위 자료 누락·실패 상태에서는 release를 BLOCKED로 유지한다.
4. AI·직접 수정 후 영향받는 도면, 수량, BOM/스케줄, 검증을 자동 무효화·재생성한다.

## 4. 분야별 완성 계획

## 4.1 기계·제품 CAD

### 보유 기반

- 피처 트리와 B-rep/메시 형상, 스케치, 선택 기반 Inspector
- Extrude/Revolve/Sweep/Loft/Hole/Fillet/Chamfer/Shell/Draft/Pattern 등 주요 피처
- 직접 편집 Push/Pull, Delete Face, Offset Face
- Assembly, Mate, 간섭, Drawing, Sheet Metal, Surface, PDM/버전 기반
- STEP/DXF/PDF/SCAD 등 제조 전달 경로

### 남은 완성 작업

1. 스케치 구속의 대형·복합 사례와 과구속 해결 UX를 상용 수준으로 자격화한다.
2. 자유곡면·Class-A 연속성, trim/heal, surface-solid 전환의 Exact 커널 경로를 마무리한다.
3. 다중 절곡 Sheet Metal, flat pattern, bend allowance와 도면 연계를 실부품으로 검증한다.
4. Nested/Flexible Assembly, configuration, 대형 조립 점진 로딩과 mate 재계산을 완성한다.
5. 피처 수정 후 Mate·Drawing·BOM·GD&T 자동 갱신과 실패 위치 표시를 완성한다.
6. CAM/DFM/FEA는 실제 입력·지원 범위·근거가 있는 항목만 release evidence에 포함한다.
7. PDM Checkout/branch/merge/lock/reconnect 복구를 실제 피처 트리·3D와 자격화한다.

완료 산출물: STEP, DXF, PDF 제조도면, BOM, SCAD/내부 정본, 검증·변경 이력 패키지.

완료 시험: 단품 30건, 조립체 20건, Sheet Metal 10건, Surface 10건, 도면/GD&T 10건, PDM 복구 10건.

## 4.2 건축 CAD

### 목표 의미 모델

Site/CRS → Level/Grid → Space → Wall/Slab/Ceiling/Roof → Door/Window/Opening → Stair/Ramp → Zone → MEP opening/reference.

### 남은 완성 작업

1. 벽·슬래브·지붕·개구부를 개별 선택하고 그립/치수/구속으로 직접 생성·이동·분할·결합한다.
2. 층·그리드·공간 경계 변경 시 호스트 객체와 개구부가 안정 ID를 유지하며 재생성되게 한다.
3. 문·창·계단·기둥·보·가구/설비 객체 라이브러리와 평면 드롭·스냅·호스트 연결을 구현한다.
4. 평면·입면·단면·3D를 동일 문서에서 동기화한다.
5. 공간 폐합, 문 스윙, 피난, 접근성, 계단·동선, 구조 하중경로를 검증 계약에 연결한다.
6. 축선, 치수, 태그, 룸 스케줄, 문·창 스케줄, 면적·수량표를 revision 기반으로 생성한다.
7. DXF/PDF를 우선 완성하고, 건축 CAD 완성 선언 전 IFC roundtrip을 필수 자격화한다.

완료 시험: 소형 건물 10건, 다층 10건, 개구부/계단 10건, 평·입·단 동기화 10건, IFC/DXF/PDF roundtrip 10건.

## 4.3 인테리어 CAD

### 목표 의미 모델

건축 host revision → Room/Zone → Door/Clearance → Furniture/Equipment → Finish/Millwork → Ceiling/Lighting/MEP → Egress/Acoustic.

### 남은 완성 작업

1. 현장 실측과 건축 host revision을 명시하고 변경 충돌을 검토한다.
2. 가구·집기·밀워크·조명·천장 객체를 2D/3D에서 선택, 드래그, 회전, 복제, 정렬, 간격 배치한다.
3. 벽·문·마감·천장고를 직접 수정하고 종속 가구·조명·도면 영향을 표시한다.
4. 객체 배치 전체를 transaction에 포함해 Undo/Redo·자동저장·재접속 복구한다.
5. 공간 폐합, 문 스윙, 통로 폭, 최단 피난, 접근성, 조도, 마감 수량, 필요 시 음향 검증을 분리 실행한다.
6. 개별 gate 실패가 전체 PREVIEW로 보이지 않도록 BLOCKED/FAIL을 정확히 합산한다.
7. 가구 배치도, 천장도, 마감도, 입면, FF&E, 마감·조명 스케줄과 DXF/PDF를 생성한다.

완료 시험: 주거 10건, 사무실 10건, 상업공간 10건, 가구 drag/undo/restore 20건, 피난·문 스윙·조도 20건.

## 4.4 토목 CAD

### 목표 의미 모델

CRS/Datum → Survey Control/Point → Existing TIN/Breakline → Alignment(line/arc/spiral) → Profile → Cross Section → Corridor/Grading → Drainage/Catchment → Structure/Stage.

### 남은 완성 작업

1. 측량점·브레이크라인·TIN을 직접 import/edit하고 출처와 좌표 권위를 유지한다.
2. 선형 line/arc/spiral, PI·곡선 반경·완화곡선, 종단 PVI·수직곡선을 직접 편집한다.
3. 횡단 template, corridor target, daylight, superelevation과 grading feature line을 구현한다.
4. 배수구·맨홀·관로·유역을 평면/종단에서 좌표 배치하고 관저고·경사·직경을 편집한다.
5. 토공량, 종·횡단, 배수 네트워크 검증을 승인 측량·수직 datum과 분리해 fail-closed 실행한다.
6. 선형도, 종단도, 횡단도, 토공량·배수 수량표, 단계 계획을 생성한다.
7. DXF/PDF를 우선 완성하고, 완성 선언 전 LandXML/GeoJSON 중 필요한 토목 교환 계약을 자격화한다.

완료 시험: 도로 선형 10건, 부지 정지 10건, 배수 10건, TIN/종횡단 10건, 좌표·단위 roundtrip 10건.

## 4.5 조경 CAD

### 목표 의미 모델

토목 terrain revision → Site/Grade → Hardscape → Planting Zone/Plant → Soil Volume → Irrigation → Drainage → Furniture/Lighting → Maintenance.

### 남은 완성 작업

1. 토목 지형 revision을 참조하고 표고·경사·절성토 변경을 충돌 없이 추적한다.
2. 포장·경계석·계단·데크·옹벽·시설물을 직접 그리기·오프셋·분할·재질 편집한다.
3. 수목·관목·지피를 개별/행렬/영역으로 배치하고 간격·성숙 수관·근권·수량을 편집한다.
4. 관수 zone, 밸브, 관로, 수두·유량과 표면 배수 경로를 연결한다.
5. 접근성 경사, 배수 저점, 식재 간격, 토심·토양량, 포장·목구조·풍하중 검토를 분리 실행한다.
6. 식재 배치도, 포장·레벨도, 관수도, 수목·자재 수량표와 유지관리표를 생성한다.
7. DXF/PDF를 우선 완성하고, 지형·자산 전달에 필요한 GeoJSON/LandXML 연계를 제한적으로 자격화한다.

완료 시험: 공원 10건, 주거 외부공간 10건, 식재 10건, 포장·배수 10건, 관수·수량 10건.

## 5. 순차 실행 계획

각 단계는 다음 단계로 자동 넘어가지 않는다. 해당 단계의 검사와 조정이 모두 통과돼야 다음 단계로 이동한다.

### Wave 0 — 현재 치명 오류 제거

1. 인테리어 검증 false-PREVIEW 차단
2. 인테리어·토목 객체 transaction/Undo/Redo/복구 연결
3. 공간 CAD의 기계 DFM/STEP 오배선 차단
4. 허위 drag affordance 제거 또는 실제 좌표 drop 구현
5. 6개 언어·RTL·접근성 기본 수정

### Wave 1 — 공통 인간 직접 편집

1. stable object selection과 분야별 Inspector
2. 공통 transform/치수/스냅/구속
3. 객체 라이브러리와 실제 배치
4. 영향 표시·미리보기·적용/취소
5. transaction·PDM·재접속 복구

### Wave 2 — 기계 완성 및 공간 의미 커널

1. 기계 Surface/Sheet Metal/Assembly/Drawing/PDM 잔여 자격화
2. 건축 객체 커널과 평·입·단 동기화
3. 인테리어 host-aware 객체·배치
4. 토목 TIN/선형/종횡단/corridor
5. 조경 terrain/식재/포장/관수

### Wave 3 — AI agent 완전 배선

1. 분야별 tool/capability registry
2. canonical candidate와 exact scope
3. 현재 revision 기반 계획·diff review
4. 원자 적용·rollback·Undo
5. 모호한 지시 확인, generic planner, 모델 fallback

### Wave 4 — 검증·산출물

1. 분야별 계산·검증기의 진실성 게이트
2. 변경 영향 기반 자동 재검증
3. 도면·스케줄·수량·BOM 자동 갱신
4. DXF/PDF/STEP 최소 호환성
5. 필요한 분야에 한해 IFC/LandXML/GeoJSON 제한 자격화

### Wave 5 — 상용 자격화

1. 6개 언어 전체 화면·산출물·오류 문구 검증
2. Arabic RTL desktop/mobile 검증
3. 대형 모델 점진 로딩·성능 예산
4. 계정·권한·감사·PDM·백업/복구 훈련
5. 분야별 실제 사용자 시나리오와 전문가 승인
6. 기계와 공간 분야의 release channel을 별도 판정

## 6. 검증 매트릭스

각 기능은 아래 증거가 모두 있어야 완료로 표시한다.

1. 단위 테스트: 파서, 정규화, 의미 문서, transaction, 검증 진실성
2. 통합 테스트: UI 명령 → 문서 → 형상 → 검증 무효화 → 산출 갱신
3. E2E: 신규 설계 → 직접 수정 → AI 수정 → Undo/Redo → 저장 → 재접속 → export
4. Roundtrip: 지원 교환 형식 import/export 후 ID·단위·좌표·치수 보존
5. 성능: 소형/중형/대형 기준 데이터에서 입력 지연·재생성·메모리 예산 통과
6. 사용자 시험: 초보자와 전문가가 동일 과제를 도움 없이 완료
7. 정직성 시험: 미입력·미검증·실패·권한 없음·외부 서비스 장애가 성공처럼 보이지 않음

## 7. 출시 판정

- 기계·제품: 위 기계 시험과 운영 자격을 통과하면 정식 CAD 후보.
- 건축·토목·조경·인테리어: Wave 0~4와 분야별 시험을 통과하기 전까지 `Space Design Labs Beta` 유지.
- 각 공간 분야는 독립적으로 승급한다. 한 분야의 통과가 다른 분야를 자동 인증하지 않는다.
- 결제 활성화 여부와 CAD 기술 완성 판정은 분리한다.

## 8. 바로 다음 실행 순서

1. 현재 진행 중인 Wave 0 구현을 Luna가 완료한다.
2. Sol이 코드·UX·검증 진실성을 독립 재검토한다.
3. 지적 사항을 조정하고 focused test, typecheck, 6언어/RTL 테스트를 통과한다.
4. Wave 1의 stable object selection + 분야별 Inspector를 건축 → 인테리어 → 토목 → 조경 순으로 구현한다.
5. 동시에 기계 정밀 CAD는 Surface/Sheet Metal/Assembly/Drawing/PDM 회귀 자격화를 진행한다.
