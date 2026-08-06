# NexyFab 다음 통합 CAD 구축계획 — 2026-08-04

## 1. 기준선과 자료 반영 상태

이 계획은 다음 자료를 동시에 기준으로 사용한다.

- `document(manuals)` 20권: SHA-256 인덱스와 12개 추적 요구사항으로 등록됨.
- CAD 통합 백과사전 최종판: 좌표·단위·공차·B-rep·파라메트릭 모델·역학 계산과 fail-closed 검증 원칙.
- PBAS 0.7.3: 접촉, 커넥터, 메이트, Jacobian mobility, Native SI, 좌굴·구조 증거 모델.
- `참고파일들`: MeArm, Epson C4, Cycloidal 50, C5055, NIST PMI, IFC4.3, 판금·용접·중장비 실물 회귀 코퍼스.
- NX-JET-SHAPE: 제트엔진 외형·컷어웨이의 시각 목표만 제공하며 공학 정답으로 사용하지 않음.
- SolidWorks/Fusion/Rhino/Grasshopper 매뉴얼: 일반 사용자와 전문가가 같은 문서에서 단계적으로 깊이를 올리는 UX 기준.
- Civil 3D/MicroStation/Vectorworks 자료: 공장·부지의 대좌표, grid/level, reference federation 기준.

현재 매뉴얼 추적 기준은 `implemented_verified` 3개, `partial` 6개,
`implemented_unverified` 1개, `not_implemented` 2개다. 따라서 자료는 계획과 검증 체계에
반영됐지만 전체 기능이 완성됐다고 판정하지 않는다.

## 2. 다음 목표

다음 완료점은 “복잡한 형상이 화면에 보임”이 아니다. 아래를 모두 만족하는 첫 번째
실제 복합 제품 골든 릴리스를 만든다.

1. 자연어 요구에서 독립 부품·구매품·서브어셈블리 구조가 생성된다.
2. 모든 제작품은 편집 가능한 FeatureTree와 실제 B-rep을 가진다.
3. 면·선·축·점 선택 후 채팅 수정과 메이트가 영구 토폴로지 참조로 유지된다.
4. 메이트, DoF, 정적·동작 간섭, 조립·정비 경로가 검증된다.
5. 부품별 STEP과 계층형 조립 STEP, BOM, PMI가 왕복 검증된다.
6. Web·API·CLI·MCP가 동일 IR, 오류 코드, 증거를 반환한다.
7. 견적·RFQ는 생성하거나 전송하지 않는다.

첫 번째 제품은 6축 로봇으로 고정하고, 통과 후 제트엔진과 공장으로 확장한다.

## 3. 통합 묶음 A — OCCT 영구 토폴로지 피킹

### 구현

- OCCT tessellation 결과의 triangle/edge를 원본 face/edge persistent id와 연결한다.
- 평면뿐 아니라 원통, 원뿔, 구, 토러스, NURBS face를 분류한다.
- 홀 원통면은 `hole_axis`, 원형 edge, 입구/출구 face와 연결한다.
- 클릭 후보가 겹치면 depth, 화면 거리, topology signature로 순위를 매긴다.
- 재생성 전후 signature mapping을 수행하고 단일 확정 후보만 자동 재연결한다.
- 복수 후보·소실 참조는 사용자 검토 상태로 보내며 임의 재연결하지 않는다.
- Face/Edge/Point/Axis/Part 선택을 `SelectionContext` 하나로 통합한다.

### 합격 기준

- 표준 피처 수정 후 참조 유지율 98% 이상.
- 잘못된 자동 재연결 0건.
- 홀 원통면 선택 → 동심 메이트 → 치수 변경 → 재해석 E2E 통과.

## 4. 통합 묶음 B — 선택 채팅의 원자적 CAD 편집

### 구현

- 선택 컨텍스트와 자연어를 `EditIntent`로 변환한다.
- `계획 → 미리보기 → 검증 → 적용` 네 단계를 분리한다.
- 면 이동, offset, hole diameter/depth, fillet/chamfer, pattern count/spacing,
  shell thickness, 부품 pose, mate value를 우선 지원한다.
- confirmed 치수, 고정부품, 안전 핵심 부품은 자동 변경하지 않는다.
- 실패 시 해당 피처부터만 rollback하고 정상 상류 FeatureTree는 보존한다.
- 적용 전후 topology mapping, 치수, 질량, mate residual, 간섭 차이를 기록한다.

### 합격 기준

- 선택 대상이 없는 지시와 다중 해석 지시는 질문 또는 명시 실패.
- 한 번의 편집이 한 번의 Undo로 완전히 복구.
- Web·API·CLI·MCP의 동일 fixture 결과 hash 일치.

## 5. 통합 묶음 C — 제조 Feature/B-rep 정확도

### 구현

- 완전구속 sketch와 단위·공차 정규화.
- Extrude/Revolve/Sweep/Loft/Hole/Pattern/Shell/Rib/Draft/Fillet/Chamfer의
  OCCT 실행 경로를 하나로 통합한다.
- 자기교차, 영두께, 비다양체, 작은 edge, 실패 Boolean을 사전 검사한다.
- 실패 시 tolerance 확대가 아닌 입력 수정, 피처 분할, 순서 변경 후보를 검증한다.
- 구매품은 형상을 새로 만들어 흉내 내지 않고 catalog instance로 유지한다.

### 합격 기준

- 골든 제작품 closed single solid 99% 이상.
- 주요 치수 허용오차 통과 95% 이상.
- Feature 종류·개수 일치 90% 이상.
- 실패 피처를 성공으로 보고하는 경우 0건.

## 6. 통합 묶음 D — 결합·접촉·조립 정확도

### 구현

- 평면/축/원통/거리/각도/힌지/슬롯/기어/랙/접선 메이트를 공통 residual로 계산한다.
- Jacobian rank로 자유도, 중복구속, 과구속, 미구속을 판정한다.
- bolt stack, shaft-bearing, key/spline, press-fit, flange, weld 표준 연결을 확장한다.
- 접촉, 간극, 압입, 용접 겹침, 나사 체결을 별도 의미 객체로 관리한다.
- 삽입 방향, 공구 접근, 분해·정비 envelope를 경로 단위로 검사한다.

### 합격 기준

- 골든 어셈블리 메이트 수렴 98% 이상.
- DoF 오판 1% 이하.
- 고정부품 자동 이동 0건.
- 의도되지 않은 정밀 중첩 0건.

## 7. 통합 묶음 E — 동작·애니메이션·결과물

### 구현

- 기존 0~N frame timeline을 mate/joint driven animation과 연결한다.
- 위치·속도·가속도·jerk 제한을 키프레임·경로 모두에 적용한다.
- 모든 검사 frame에서 broad phase 후 OCCT/triangle narrow phase를 수행한다.
- 실제 메시 GLB, 독립 HTML, JSON 프로젝트, frame PNG를 지원한다.
- MP4는 브라우저 지원 코덱 탐지 후만 제공하고, 미지원 환경은 명시적으로 차단한다.
- 내보낸 GLB의 부품 노드 수, animation channel, duration을 재가져와 검증한다.

### 합격 기준

- 누락된 frame 검사 0건.
- 충돌 경로를 합격 처리 0건.
- GLB 재가져오기 후 부품 수·이름·동작 종료 pose 일치.

## 8. 통합 묶음 F — 6축 로봇 골든 릴리스

### 제품 구조

- base, J1~J6 housing/link, motor, reducer, bearing, brake, encoder,
  harness, flange를 독립 부품·구매품으로 생성한다.
- motor/reducer/bearing는 catalog selector와 MechanicalInterface로 결정한다.

### 공학 및 검증

- DH/POE, FK, DLS IK, Jacobian singularity, workspace.
- joint limit, payload별 torque/inertia, 속도·가속도·jerk.
- self/environment/tool collision, cable bend/twist/tension.
- 조립·분해·정비 경로, 공구 접근.
- 제작품 G0~G9, 부품별 STEP, 계층형 AP242, BOM/PMI 왕복.

### 코퍼스

- Epson C4: 외형·계층·workspace.
- MeArm: 부품 분해·메이트·동작.
- Cycloidal 50: 감속기 내부 관계.
- C5055: motor 구조와 interface.

### 릴리스 기준

- 독립 부품 누락·병합 0건.
- 선언 DoF 6, 미지원 constraint 0.
- 정적·전 경로 정밀 충돌 0.
- torque/cable/service/manufacturing/STEP 검증 통과.

## 9. 통합 묶음 G — 제트엔진과 공장 확장

### 제트엔진

- station/mean-line IR, Brayton cycle.
- fan/LPC/HPC/combustor/HPT/LPT/shaft/bearing/case/nozzle 독립 계층.
- airfoil loft/pattern, tip clearance, rotor critical speed, bearing load,
  thermal expansion clearance.
- NX-JET-SHAPE는 시각 비교에만 사용한다.
- CFD, 연소, 고온 피로가 미실행이면 engineering complete로 승격하지 않는다.

### 공장

- robot cell, conveyor, table, fence, sensor, control cabinet 독립 객체.
- grid/level/대좌표와 IFC reference federation.
- 전기·공압·배관·cable tray port graph와 routing.
- 작업자·지게차·정비 envelope, cycle time, throughput, buffer.
- IFC4.3 GUID·hierarchy·material·quantity·georeference 왕복.

## 10. 통합 묶음 H — 실제 자료 KPI와 배포 게이트

### 자료 운영

- 외부 CAD는 read-only quarantine에서 hash·provenance를 기록한다.
- STEP/STL/DXF/IFC/SCAD만 지원 loader로 실행한다.
- SLDPRT/SLDASM, Inventor, CATIA, DWG, RVT, PDF는 loader가 없으면 `not_run`이다.
- train/eval/holdout을 제품 단위로 분리하고 원본 파일을 prompt에 넣지 않는다.

### KPI

- 필수 부품 precision/recall.
- 주요 치수·bbox 오차.
- feature 종류·개수.
- mate/DoF/joint axis.
- 정밀 충돌 precision/recall.
- STEP/PMI/IFC 왕복.
- 생성시간, 자동수리 횟수, 사용자 개입 횟수.

### 배포 순서

1. 전체 테스트, TypeScript, lint, production build.
2. API rate limit, 입력 크기, NaN/Infinity, sample 상한 검증.
3. 운영 DB·견적·RFQ 부작용 없음 확인.
4. staging에서 AI SSE, WebGL, API, CLI, MCP smoke.
5. 로봇 골든 fixture를 네 인터페이스에서 실행해 결과 hash 비교.
6. 사용자 승인 후에만 production 배포.
7. 배포 후 health, 5xx, latency, AI transport를 관찰하고 실패 시 이전 배포 유지.

## 11. 권장 실제 실행 순서

1. A: OCCT 영구 토폴로지 피킹.
2. B: 선택 채팅 원자 편집.
3. C: B-rep 피처 정확도와 국소 복구.
4. D: 메이트·접촉·조립성.
5. E: joint animation, GLB 재검증, frame export.
6. F: 6축 로봇 골든 릴리스.
7. H: 실제 코퍼스 KPI와 staging 검증.
8. G: 제트엔진 J1부터, 이후 공장 F1부터 확장.

각 묶음은 코드, 단위 테스트, 골든 fixture, API/CLI/MCP/Web parity,
증거 문서가 함께 끝나야 완료다. 일부만 끝난 묶음은 완료로 표시하지 않는다.

## 12. 2026-08-04 실행 기록 — 선택 편집/Shell 통합 1차

- 매뉴얼 추적 검증: 20 manuals, 12 baseline requirements 통과.
- `shell`을 정식 `FeatureKind`/`FeaturePayload`로 승격.
- reference-aware Shell 재생, 저장·역직렬화, legacy snapshot promotion,
  통계, 설계 의도 설명, FeatureTree UI 아이콘을 연결.
- 선택 채팅에서 Shell 생성, 두께 변경, 선택한 위·아래 cap 열기를 원자
  트랜잭션으로 지원.
- 선택 편집 공통 엔진을 Web, REST `/api/cad/v1/assembly/selection-edit`,
  CLI `assembly edit`, MCP `preview_assembly_selection_edit`에 연결.
- capability/OpenAPI에 동일 계약과 RFQ 부작용 없음 명시.
- 관련 단위·저장·마이그레이션·CLI·MCP 테스트 94개, Shell 관련 전체 묶음
  165개, AssemblyBrowserModal 회귀 245개 및 TypeScript 검사를 통과.
- 남은 범위: arbitrary-face OCCT Shell/Offset, 개별 edge fillet/chamfer,
  다중 EditIntent, 실제 B-rep diff preview와 공학 evidence graph.

## 13. 2026-08-04 실행 기록 — 원자 편집/개별 edge 2차

- `그리고/and then/then`, 세미콜론, 줄바꿈으로 분리되는 다중 편집을
  임시 상태에 순차 적용하고 하나라도 실패하면 결과 전체를 반환하지 않는
  원자 batch transaction으로 연결.
- FeatureTree 전후 volume, bbox, changed/added/removed feature를
  `feature-tree-estimate` evidence로 반환하고 UI Preview에 표시.
- 정확한 B-rep/topology 검사가 실행되지 않은 상태는 `not_run`으로 표시하며
  계산된 것처럼 승격하지 않음.
- Fillet/Chamfer에 선택된 persistent `edgeRefs`를 저장하고 OCCT command에
  그대로 전달. SCAD fallback은 범주 전체로 확대하지 않고 명시 실패.
- capability에 현재 미지원인 arbitrary-face OCCT Shell/Offset과 exact B-rep
  diff를 `unavailable`로 공개.
- 선택 편집·OCCT 계획·API·CLI·MCP·어셈블리 UI 통합 회귀 296개 및 전체
  TypeScript 검사 통과.

## 14. 2026-08-04 실행 기록 — OCCT 열린 Shell 실커널 연결

- FeatureTree의 reference-aware Shell을 OCCT 명령 IR과 공통 executor에 연결했다.
- extrude의 안정 면 이름 `f.cap.top`/`f.cap.bottom`을 정확히 해석하며 누락·중복 시
  임의의 면으로 확대하지 않고 명시적으로 실패한다.
- Node OCCT 브리지는 `BRepOffsetAPI_MakeThickSolid_2`로 선택 cap을 제거하고 inward
  offset을 우선한다. 닫힌 완전 중공 셸은 기존 정확 SCAD subtraction 경로를 유지한다.
- 실제 WASM 커널에서 10×10×5 상자의 윗면을 열고 1 mm 벽을 적용해 이론 체적
  `500 - 8×8×4 = 244 mm³`와 일치함을 회귀 테스트로 고정했다.
- capability에 `occt-exact-cap-shell`을 추가했다. 임의 면 Shell/Offset 및 exact
  B-rep diff는 아직 `unavailable` 상태를 유지한다.

## 15. 2026-08-05 실행 기록 — 선택 편집 exact B-rep evidence

- 동기식 편집 계획과 무거운 커널 검증을 분리하고 `verifyBrep` 선택 옵션을 추가했다.
- 전후 FeatureTree를 실제 Node OCCT에서 독립 재생하여 volume, bbox, solid/face/edge
  개수와 `BRepCheck_Analyzer` 유효성을 반환한다.
- 하나라도 OCCT 미지원 노드가 있거나 커널 재생·검사가 실패하면 정확값으로 승격하지
  않고 `topologyValidation: failed`와 `kernelError`를 반환한다.
- REST/OpenAPI, CLI `assembly edit --verify-brep`, MCP
  `preview_assembly_selection_edit({ verifyBrep:true })`가 동일 계약을 사용한다.
- 10×10×5 → 깊이 8 mm 편집에서 실커널 체적 500 → 800 mm³, delta 300 mm³,
  전후 각 1 solid/6 faces/12 edges 및 B-rep valid를 회귀 테스트로 고정했다.
- capability에서 `exact-brep-diff`를 지원 항목으로 승격했다. 임의 면 Shell/Offset은
  여전히 별도 커널 의미와 안정 위상 참조가 필요하므로 미지원으로 유지한다.

## 16. 2026-08-05 실행 기록 — extrude 선택 side face 정확 Offset

- `f.side.i`를 extrude 원본 프로파일의 i번째 edge까지 역추적하여 선택한 면 하나만
  평행 이동하는 파라메트릭 편집을 추가했다.
- 프로파일 방향을 이용해 양수=외측, 음수=내측으로 정의하고 인접 edge와의 새 교점을
  계산하므로 topology 이름 순서와 FeatureTree 편집 가능성을 유지한다.
- offset 후 면적 붕괴, 방향 반전, 자기교차, 0 길이 edge, stale side index를 fail-closed
  차단한다.
- 10×10×5 상자의 `f.side.1`을 외측 2 mm 이동한 결과를 실제 OCCT로 재생해 volume
  500→600 mm³, delta 100 mm³, 전후 6 faces 및 valid B-rep임을 검증했다.
- 일반 non-extrude B-rep 면 이동과 extrude bottom cap 이동은 별도 transform/replace-face
  IR이 필요하므로 capability에서 구체적인 미지원 항목으로 유지한다.

## 17. 2026-08-05 실행 기록 — extrude bottom cap 정확 Offset

- Extrude IR에 선택적 `profileOffsetZ`를 추가하여 스케치 평면의 실제 Z 위치를 보존한다.
- one-sided extrude의 bottom cap을 이동할 때 top cap은 고정하고 `profileOffsetZ`와 depth를
  함께 변경하므로 반대쪽 면이 의도치 않게 이동하지 않는다.
- SCAD 직렬화, OCCT B-rep 생성, FeatureMesh, 통계 bbox, Shell 내부 cavity, 저장 검증,
  assembly geometry resolver와 topology picking이 같은 Z 범위를 사용하도록 통합했다.
- 10×10×5 상자의 bottom cap을 +2 mm 이동한 결과를 실제 OCCT에서 z=[2,5], volume
  300 mm³ 및 valid B-rep으로 검증했다.
- capability의 `extrude-exact-cap-offset`을 지원으로 승격했다. non-extrude 임의 면 이동은
  여전히 replace-face/재봉합과 안정 위상 이력 연결이 필요하므로 미지원이다.

## 18. 2026-08-05 실행 기록 — Revolve/Boolean 생성 이력 면 Offset

- revolve의 `f.side.i`를 canonical 회전 프로파일 edge로 역추적하여 원통·원뿔·일반
  회전체의 선택 면을 파라메트릭하게 이동한다.
- 이동 결과가 회전축을 통과하거나 프로파일을 축 위로 붕괴시키면 fail-closed 처리한다.
- 원통 R10×H20의 외벽을 +2 mm 이동하여 R12가 된 결과의 실커널 체적이 각각
  `π·10²·20`, `π·12²·20`과 일치하고 전후 B-rep valid임을 검증했다.
- boolean 결과의 `base/f.side.1` 같은 kernel-history 이름에서 실제 원본 node id와
  로컬 face 이름을 분리하여 원본 feature만 편집하고 boolean 전체를 재생한다.
- base box-minus-tool 사례에서 inherited face +2 mm 편집 후 delta 100 mm³ 및 valid
  boolean B-rep을 확인했다.
- imported STEP처럼 생성 이력이 없는 B-rep의 직접 면 이동은 replace-face, 인접 면
  연장/트림, sewing, healing, 이름 재조정이 모두 필요하므로 별도 미지원으로 명시한다.

## 19. 2026-08-05 실행 기록 — 가져온 STEP 평면 Push/Pull

- 생성 이력이 없는 STEP도 OCCT에서 면 중심 좌표 순으로 정렬해, 매 재빌드마다 결정적인
  `f.import.i` 평면 참조를 부여한다. 결과 응답에는 편집 후 다시 생성한 참조 목록도 포함한다.
- 선택 평면을 거리만큼 프리즘화하고 양쪽 법선 후보를 모두 계산한다. 양수는 체적 증가 후보를
  Fuse로, 음수는 체적 감소 후보를 Cut으로 선택하므로 STEP의 뒤집힌 면 방향을 추측하지 않는다.
- 결과는 `BRepCheck_Analyzer`, solid/face/edge 수, bbox와 전후 체적으로 검증하며 실패·무변화·곡면은
  성공으로 승격하지 않는다. 성공할 때만 편집된 STEP을 base64 산출물로 반환한다.
- REST `/api/cad/v1/brep/push-pull`, CLI `brep push-pull`, MCP `push_pull_step_face`가 같은 계약을
  사용하며 견적 또는 RFQ 부작용은 없다.
- 실제 10×10×5 STEP 왕복 fixture에서 `f.import.5`의 +2 mm는 500→600 mm³,
  -1 mm는 500→450 mm³이고 두 결과 모두 유효한 B-rep임을 커널 회귀 테스트로 고정했다.
- 현재 참조는 한 재빌드 안에서는 결정적이지만 임의의 큰 형상 변경을 가로질러 영구적인 위상 ID를
  보장하지 않는다. 곡면 push/pull은 radius/profile 재구성 및 replace-face/healing이 필요해 명시적
  미지원으로 유지한다.
