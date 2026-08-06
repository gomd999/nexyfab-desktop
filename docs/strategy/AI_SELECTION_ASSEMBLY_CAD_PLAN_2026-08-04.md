# AI 선택·채팅 기반 다부품 CAD 통합 계획

## 1. 제품 목표

일반 사용자는 자연어와 화면 선택으로 설계하고, 전문가는 같은 결과를 Feature Tree, Mate, 공차, 계산 및 도면에서 직접 검토·수정한다. 정식 결과는 단일 메시가 아니라 다음 계층을 유지한다.

```text
Project → Assembly → Subassembly → Part → Body → Feature
                                      └→ Sketch / Face / Edge / Vertex
```

AI는 기존 `FeatureTree`, `AssemblyState`, B-rep/OCCT, Mate solver, 간섭 검사, BOM, 도면 및 STEP 경로를 사용한다. OpenSCAD/STL은 빠른 개념 미리보기 또는 교환 형식이며 정식 파라메트릭 원본이 아니다.

## 2. 참고 원칙

`CAD_통합_백과사전_공학이론_수학과학_공식_계산체계_최종판.md`와 `document(manuals)`의 CAD 사용 흐름을 다음 제품 원칙으로 변환한다.

1. 모델 정확도를 시각·기하·관계·속성·검증 정확도로 분리한다.
2. 좌표계, 단위, 공차 및 리비전을 모든 편집과 계산에 명시한다.
3. Face/Edge 선택은 배열 인덱스가 아니라 의미기하와 생성 피처를 추적한다.
4. 계산은 공식, 입력 출처, 가정, 적용범위, 버전 및 증거를 포함한다.
5. 형상 변경 시 의존 계산·Mate·도면을 `stale`로 만들고 자동 재평가한다.
6. AI의 관찰, 추론, 가정 및 미확정을 분리한다.
7. 고위험 변경과 제조 승인에는 사람의 명시적 승인을 요구한다.

## 3. 핵심 데이터 계약

### 3.1 Selection Context

```ts
type SelectionContext = {
  projectRevision: string;
  assemblyPath: string[];
  partInstanceId?: string;
  bodyId?: string;
  featureId?: string;
  topology?: {
    kind: 'face' | 'edge' | 'vertex';
    persistentRef: string;
    semanticRole?: string; // mounting_face, bore_axis, outer_edge 등
    geometrySignature: string;
  };
  sketchEntityIds?: string[];
  mateIds?: string[];
  coordinateFrame: string;
  units: 'mm';
};
```

화면에서 선택한 삼각형이나 임시 face index를 AI에 직접 전달하지 않는다. `persistentRef + semanticRole + geometrySignature + producer feature`를 전달한다.

### 3.2 AI Edit Transaction

```ts
type AiEditTransaction = {
  id: string;
  baseRevision: string;
  userCommand: string;
  selection: SelectionContext;
  observations: string[];
  assumptions: string[];
  unresolved: string[];
  operations: CadEditOperation[];
  affected: { parts: string[]; features: string[]; mates: string[]; drawings: string[] };
  preconditions: RuleCheck[];
  rollbackSnapshot: string;
};
```

지원 연산은 스케치 치수·구속 변경, Extrude/Revolve/Sweep/Loft 파라미터 변경, Hole/Fillet/Chamfer 추가·수정·삭제, Body 분리·결합, 부품 이동·복제·교체·억제, Mate 생성·수정·삭제로 제한한다. 임의 코드 실행은 편집 계약이 아니다.

### 3.3 Calculation Record

백과사전의 계산 명세 형식을 제품 계약으로 사용한다.

- 계산 ID와 Formula Registry 버전
- 목적과 물리/수학 모델
- 입력값, SI 단위, 출처, 유효 범위
- 가정과 적용 불가 조건
- 출력과 허용 기준
- 손계산·Golden·독립 도구 검증
- 불확도와 한계
- geometry/material/rule/engine revision

계산 상태는 `valid | stale | warning | failed | waived`로 관리한다.

## 4. 실행 파이프라인

```text
선택/채팅
→ Selection Context 고정
→ 의도 분석 및 미확정 질문
→ AI Edit Transaction 생성
→ 단위·범위·참조·권한 preflight
→ 변경 Diff와 영향 범위 미리보기
→ 사용자 적용
→ Feature Tree 국소 재생성
→ 위상 참조 재매핑
→ Mate 재풀이
→ 간섭·clearance·운동 검사
→ DFM 및 관련 계산 그래프 갱신
→ BOM·도면·질량특성 갱신
→ 리비전·증거·감사 기록 저장
```

중간 단계가 실패하면 트랜잭션 전체를 롤백한다. 일부 피처만 적용된 상태를 저장하지 않는다.

## 5. 구현 단계와 완료 기준

### P0 — 제품 경계 정리

- CAD의 견적/RFQ 버튼과 자동 전달 제거
- 설계, 검증, 다운로드, NexyFab 별도 문의만 유지
- 완료 기준: CAD 런타임에서 견적 API 호출 0건

### P1 — 공통 선택 계층

- Assembly/Part/Body/Feature/Face/Edge/Vertex/Sketch 선택을 단일 계약으로 통합
- 다중 선택, 선택 집합 이름, 좌표 프레임과 단위 포함
- 완료 기준: 선택 후 저장·재로드 및 경미한 파라미터 변경 뒤 동일 의미 대상을 재식별

### P2 — 선택 기반 채팅 편집 MVP

- Face push/pull은 원본 피처 치수 수정으로 변환
- Edge fillet/chamfer, 원통면 hole diameter, 스케치 선 길이·수평/수직 구속
- 변경 Diff, 확인, 취소, Undo/Redo
- 완료 기준: 대표 명령 30개에서 전체 모델 재생성 없이 관련 피처만 변경

### P3 — 부품·어셈블리 채팅

- 제품 요구를 부품/서브어셈블리로 분해
- 각 인스턴스에 독립 Feature Tree, 부품번호, 리비전, 재질, 수량 부여
- 선택 부품 이동·대칭·복제·교체·억제
- 두 선택 대상 사이 Mate 생성과 한계 설정
- 완료 기준: 최소 10부품 제품을 채팅으로 생성하고 저장·재로드 후 구조 보존

### P4 — 안정적 B-rep 참조

- producer feature, geometry signature, adjacency, semantic role 기반 재매핑
- 참조 신뢰도와 ambiguous/broken 상태
- 끊긴 참조는 조용히 다른 면으로 대체하지 않고 사용자 재선택 요청
- 완료 기준: 치수 변경·피처 삽입·순서 변경 corpus에서 참조 생존율을 측정하고 보고

### P5 — 조립 검증 폐루프

- Mate solver 잔차, 자유도, 과구속·부족구속 진단
- 정적/동적 간섭, 최소 간격, 공구 접근, 조립 순서 검사
- 운동 scrub 중 충돌 위치와 관련 부품 표시
- 완료 기준: 변형 전후 Mate/간섭 결과가 동일 geometry revision을 참조

### P6 — Formula Registry와 계산 그래프

- 우선순위: CAD-011~025, MECH-001~040, MFG-001~008
- SI 단위 안전 API, 공식 버전, 입력 출처와 적용범위
- 형상/재질/하중 변경 시 하류 결과 `stale` 처리 및 재계산
- 완료 기준: 단위 불일치·범위 초과·비수렴·보존 실패가 구조화 오류 코드로 반환

### P7 — 연관 BOM·도면·내보내기

- 변경된 부품의 BOM, 질량, 도면 치수, 풍선 번호 자동 갱신
- 부품별 STEP과 계층 Assembly STEP, DXF, 도면 출력
- 완료 기준: 내보낸 STEP 재가져오기 후 부품 수·이름·변환·체적 비교

### P8 — 일반/전문 UX 통합

- 일반 모드: 목적 질문, 선택+채팅, 자동 미리보기
- 전문가 모드: Feature Tree, Mate, 공차, 계산 가정과 솔버 설정 노출
- 두 모드는 동일 프로젝트 데이터와 리비전을 사용
- 완료 기준: 일반 모드 변경을 전문가 모드에서 열어 동일 Feature/Mate로 편집 가능

### P9 — V&V 및 현장 검증

- 단위, 경계값, 분석해, 불변식, 수렴, 독립 구현의 Verification 6단계
- SolidWorks/Fusion/Inventor/FreeCAD 왕복 매트릭스
- CMM/스캔/실물 조립 및 가공 결과 Validation
- 완료 기준: 버전·입력 해시·자동시험·독립 비교·한계가 포함된 증거 번들 생성

## 6. 우선 인수 시나리오

1. 브래킷 면 선택 → “이 면을 10mm 늘려줘” → Extrude 치수 변경과 Hole 위치 유지.
2. 네 Edge 선택 → “R3 필렛” → 선택 Edge만 변경, 참조 실패 시 적용 중단.
3. 축과 베어링 선택 → “동심으로 조립하고 축방향 이동은 막아줘” → Mate 2개 생성 및 DoF 보고.
4. 모터 부품 선택 → “반대편으로 옮겨줘” → 변환·Mate 수정 후 간섭 재검사.
5. 프레임 선택 → “길이 200mm 증가” → 관련 패널·축·커버 위치와 BOM/도면 영향 Diff 표시.
6. “소형 벨트 컨베이어 설계” → 독립 부품 10개 이상, Mate, BOM, 분해도 및 계층 STEP 생성.

## 7. 비승인 조건

- 단위·좌표·재질·하중 출처 불명
- 선택 참조가 ambiguous 또는 broken
- 미확정 치수가 기능/안전/조립을 좌우함
- 형상 재생성 후 Mate·도면 참조가 끊김
- 간섭, 비수렴, 평형/보존 실패
- 계산 공식 적용범위 또는 공학 가정 위반
- 변경 후 이전 계산이 유효한 것처럼 남아 있음

이 경우 결과는 `concept_only` 또는 `review_required`로 남고 제조 승인 상태가 되지 않는다.
