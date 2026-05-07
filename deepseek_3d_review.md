## 1. 현재 가장 우선순위가 높은 추가 개선 10가지

**핵심 원칙: "흐름(Flow)을 끊는 지점"을 제거하라**

1. **스케치 제약 조건 시각적 피드백 부재**  
   - **문제**: Fusion 360처럼 스케치 요소에 호버/선택 시 수직, 수평, 동일, 구속 조건 아이콘이 표시되지 않음. 사용자가 "왜 이 선이 움직이지 않지?"에서 막힘.  
   - **해결**: `sketch/constraintSolver.ts`에 `getConstraintIconsForEntity()` 추가, `SketchCanvas.tsx`에서 선택된 엔티티 근처에 아이콘 오버레이 렌더링.  
   - **파일**: `SketchCanvas.tsx` (2,682줄) 내 렌더링 로직 확장.

2. **피처 트리에서 직접 피처 편집 불가**  
   - **문제**: 트리에서 피처(예: Extrude1)를 더블클릭해도 편집 모드로 진입하지 않음. 반드시 툴바에서 해당 도구를 다시 선택해야 함.  
   - **해결**: `FeatureTree.tsx`에 `onFeatureDoubleClick` 핸들러 추가 → `sceneStore.setEditingFeature(featureId)` → 해당 피처의 `PropertyManager.tsx`를 자동으로 열기.  
   - **파일**: `FeatureTree.tsx`, `store/sceneStore.ts`에 상태 추가.

3. **Undo/Redo 시 시각적 깜빡임 및 선택 상태 유실**  
   - **문제**: 히스토리 이동 시 전체 모델이 잠시 사라졌다가 다시 나타나고, 선택한 면/에지가 해제됨.  
   - **해결**: `useHistory.ts`의 `applySnapshot`에서 `sceneStore.preserveSelection()` 호출. `rendering/`에서 Progressive LOD를 활용해 기하를 단계적으로 로드하지 말고, `geometryCache.ts`에서 캐시된 메시를 즉시 표시.  
   - **파일**: `useHistory.ts`, `lib/geometryCache.ts`.

4. **대형 어셈블리에서 Mate 추가 시 성능 저하**  
   - **문제**: 50개 이상 파트에서 Mate 패널 열릴 때마다 전체 인터페이스가 멈춤. `matesSolver.ts`의 계산이 메인 스레드를 블로킹.  
   - **해결**: `workers/`에 `mateWorker.ts` 생성, Web Worker로 초기 가능성 검사 오프로드. `AssemblyMatesPanel.tsx`에서 버튼 클릭 시 Worker에 메시지 전송.  
   - **파일**: 새 `workers/mateWorker.ts`, `assembly/matesSolver.ts` 리팩터.

5. **치수 입력 시 단위 변환 실시간 미반영**  
   - **문제**: mm로 작업 중 inch 값을 입력하면 변환되지 않고 잘못된 크기로 생성됨. 사용자가 직접 계산해야 함.  
   - **해결**: `units.ts`에 `convertInputToActiveUnit(value, fromUnit)` 함수 추가. `ExpressionInput.tsx`에서 포커스 아웃 시 자동 변환 적용 및 툴팁으로 "(25.4mm)" 표시.  
   - **파일**: `units.ts`, `ExpressionInput.tsx`.

6. **자동 저장 충돌 시 복구 UI 불명확**  
   - **문제**: 두 탭에서 동시 편집 시 "충돌 감지" 토스트만 뜨고, 어떤 버전을 선택할지 직관적인 UI가 없음.  
   - **해결**: `RecoveryBanner.tsx`를 `VersionDiff3DViewer.tsx`와 연동, 3D 비교 뷰를 사이드바에 표시. "현재 탭" vs "저장된 버전" 시각적 비교.  
   - **파일**: `RecoveryBanner.tsx`, `history/VersionDiff3DViewer.tsx` 재사용.

7. **DFM 분석 결과를 피처 트리에 직접 맵핑하지 않음**  
   - **문제**: DFM 패널에서 "벽 두께 부족" 경고를 클릭해도 해당 피처(Shell1)가 트리에서 하이라이트되지 않음.  
   - **해결**: `analysis/dfmAnalysis.ts`의 `DfmWarning` 인터페이스에 `targetFeatureId: string` 추가. `DFMPanel.tsx`에서 경고 클릭 시 `sceneStore.highlightFeature(warning.targetFeatureId)` 호출.  
   - **파일**: `analysis/dfmAnalysis.ts`, `DFMPanel.tsx`, `store/sceneStore.ts`.

8. **파라메트릭 관계 끊김 시 캐스케이딩 업데이트 안 됨**  
   - **문제**: "Diameter = Hole1.Diameter * 2" 같은 식을 가진 피처가 있는데 Hole1 삭제하면 오류만 뜨고 식이 깨진 채로 남음.  
   - **해결**: `ExpressionEngine.ts`에 `validateAllExpressions()` 및 `flagBrokenDependencies()` 추가. 피처 삭제 시 의존성 검사 후 사용자에게 "관계 끊기" 또는 "의존 피처도 삭제" 옵션 제공.  
   - **파일**: `ExpressionEngine.ts`, `features/pipelineManager.ts`.

9. **렌더링 모드 전환 시 조명/재질 프리셋 초기화**  
   - **문제**: Realistic 모드에서 HDRi와 재질을 세팅한 후 Wireframe으로 갔다가 돌아오면 기본 조명으로 돌아감.  
   - **해결**: `rendering/RenderMode.tsx`의 상태를 `sceneStore.renderSettings`에 저장. 모드 전환 시 `useEffect`로 저장된 설정 복원.  
   - **파일**: `RenderMode.tsx`, `store/sceneStore.ts` 확장.

10. **커맨드 실행 중 취소(Cancel) 버튼 부재**  
    - **문제**: FEA 메시 생성이나 대형 파일 임포트 시 진행 표시줄은 있지만 중간에 취소할 수 없음.  
    - **해결**: 모든 Worker(`feaWorker.ts`, `csgWorker.ts` 등)에 `AbortController` 지원 추가. `usePipelineWorker.ts` 등에서 `cancelToken` 전파. 진행 중인 Pill UI에 "X" 버튼 추가.  
    - **파일**: 각 Worker 파일, `usePipelineWorker.ts`, `analysis/AIAssistantSidebar.tsx`의 Progress 컴포넌트.

---

## 2. Fusion 360 / SolidWorks 사용자가 "이게 없어서 못 쓰겠다"고 할 만한 5가지

**전문 사용자의 Muscle Memory와 워크플로우 핵심**

1. **스케치 드래그(Dynamic Drag)로 구속 조건 실험 불가**  
   - **현재**: 스케치 요소를 마우스로 끌어 움직일 수 없음. 구속 조건이 적용되면 완전히 고정됨.  
   - **필요**: `SketchCanvas.tsx`에 `onSketchEntityDrag` 핸들러 구현. 드래그 시 `constraintSolver.solveWithTemporaryMove()` 호출, 가능한 이동 범위 시각적 힌트(회색 선) 표시.  
   - **파일**: `sketch/constraintSolver.ts` 확장, `SketchCanvas.tsx` 드래그 로직.

2. **어셈블리에서 컨텍스트 메뉴로 빠른 Mate 추가 불가**  
   - **현재**: 두 면 선택 후 Mate를 추가하려면 패널을 열어서 타입을 선택해야 함.  
   - **필요**: 두 기하 요소(면, 원통, 점) 선택 시 `ContextMenu.tsx`에 "Mate 추가" 하위 메뉴 자동 표시 (Coincident, Concentric, Distance 등). `assembly/AssemblyMates.ts`의 `suggestMateType()` 함수로 자동 추천.  
   - **파일**: `ContextMenu.tsx`, `assembly/AssemblyMates.ts`.

3. **구멍(Hole) 마법사 부재**  
   - **현재**: `features/hole.ts`는 단순 원통형 구멍만 생성. 나사산 타입(UNC, UNF, Metric), 카운터보어, 스포트페이스, 탭 구멍의 표준화된 라이브러리가 없음.  
   - **필요**: `plugins/examples/holeWizardPlugin.ts`를 본격 확장. 표준 구멍 테이블 데이터(`constants/holeStandards.ts`)와 연동, 지름/깊이/나사산 지정 UI.  
   - **파일**: `plugins/` 아래 `HoleWizardPanel.tsx` 신규 생성, `features/hole.ts` 리팩터.

4. **구조용 멤버(Structural Member) 생성 및 자동 트리밍**  
   - **현재**: `features/weldment.ts`가 기본 프로파일만 제공. 스케치 라인을 따라 파이프/빔을 배치하고 교차점에서 자동으로 트리밍(마이터, 노치)하는 기능이 없음.  
   - **필요**: `SketchCanvas.tsx`에서 라인/아크 선택 후 "구조 멤버 만들기" 컨텍스트 메뉴 추가. `weldment.ts`에 `generateStructuralMember(path, profile, trimOptions)` 함수 구현.  
   - **파일**: `features/weldment.ts` 대규모 확장, `sketch/extrudeProfile.ts` 참조.

5. **드래프트(Draft) 분석 시각화 도구 부재**  
   - **현재**: `features/draft.ts`로 각도 추가는 가능하지만, 기존 모델의 드래프트 각도를 컬러 맵으로 분석해 "언더컷" 영역을 표시하는 기능이 없음. 사출 성형 설계 필수.  
   - **필요**: `analysis/` 아래 `DraftAnalysisPanel.tsx` 신규 생성. 모델 면 법선과 출발 방향 비교, 컬러 그래디언트 오버레이. `analysis/geometryValidation.ts`에 핵심 로직 추가.  
   - **파일**: 새 `analysis/DraftAnalysisPanel.tsx`, `analysis/geometryValidation.ts`.

---

## 3. page.tsx (5,965줄) 및 SketchCanvas.tsx (2,682줄) 리팩터링 전략

**원칙: "도메인별 책임 분리"와 "렌더링/로직 분리"**

### Phase 1: page.tsx에서 도메인별 레이아웃 컴포넌트 추출 (1주)
- **목표**: `page.tsx`를 레이아웃 컨테이너만 남기기.
- **작업**:
  1. `panels/MainWorkspace.tsx` 생성: 현재 `page.tsx`의 중앙 캔버스 영역(`ShapePreview`, `SketchCanvas`, `MultiViewport` 등) 전체를 이동.
  2. `panels/TopBarCluster.tsx` 생성: `DesktopTitleBar`, `CommandToolbar`, `DesignFunnelBar`, `BreadcrumbNav` 묶음.
  3. `panels/BottomBarCluster.tsx` 생성: `StatusBar`, `TimelineBar`, `AutoSaveIndicator` 묶음.
  4. `panels/OverlayManager.tsx` 생성: 모든 `*Overlay.tsx` (GD&T, FEA, DFM, Dimension), `ToastContainer`, `ContextMenu` 관리.
- **결과**: `page.tsx`는 300줄 이하로 축소, imports 정리.

### Phase 2: SketchCanvas.tsx를 MVC 패턴으로 분해 (2주)
- **현재 문제**: 렌더링, 제약 해결, 이벤트 처리, UI 상태가 모두 한 파일에.
- **새 구조**:
  - `sketch/controller/SketchController.ts`: 모든 이벤트 핸들러(`onMouseDown`, `onKeyPress`), 제약 해결기 호출 로직.
  - `sketch/view/SketchRenderer.tsx`: Three.js 기반 2D 기하 렌더링, 제약 조건 아이콘, 그리드, 스냅 가이드 그리기.
  - `sketch/view/SketchUI.tsx`: 툴팁, 인라인 치수 입력, 컨텍스트 메뉴 등 UI 요소.
  - `sketch/model/SketchState.ts`: 스케치 엔티티, 제약 조건, 선택 상태를 관리하는 중앙 저장소.
- **이전 방법**: `SketchCanvas.tsx`는 `SketchUI`와 `SketchRenderer`를 렌더링하고, `SketchController`의 인스턴스를 사용.

### Phase 3: 공통 훅(Hook) 정리 및 상태 관리 통합 (1주)
- **문제**: `hooks/useSketchState.ts`, `store/sceneStore.ts`, `useHistory.ts`에 스케치 상태가 분산.
- **해결**: `store/sketchStore.ts` 신규 생성. 모든 스케치 관련 상태(현재 스케치 평면, 엔티티, 제약)를 이곳으로 통합. `useSketchState.ts`는 이 store를 바인딩하는 편의 훅으로 전환.
- **파일 정리**: `sketch/types.ts`를 `sketch/model/types.ts`로 이동, 모든 타입 일원화.

### Phase 4: 피처 생성 파이프라인 모듈화 (2주)
- **문제**: `features/index.ts` (152줄)가 너무 간단. `pipelineManager.ts`와 `occtEngine.ts`에 로직이 집중되어 테스트와 확장이 어려움.
- **해결**:
  - `features/core/FeaturePipeline.ts`: `createFeature()`, `updateFeature()` 등의 공통 흐름 정의.
  - `features/operations/`: `ExtrudeOp.ts`, `RevolveOp.ts`, `FilletOp.ts` 등 각 피처별 연산 클래스.
  - `features/validation/`: `GeometryValidator.ts` (프로파일 닫힘 검사 등).
- **장점**: 새 피처 추가 시 `operations/`에 클래스 하나 만들고 `FeaturePipeline`에 등록만 하면 됨.

**리팩터링 순서 요약**:  
**Phase 1 (레이아웃)** → **Phase 4 (파이프라인)** → **Phase 2 (스케치)** → **Phase 3 (상태)**  
*이유*: Phase 1이 가장 빠르고 가시적 효과가 큼. Phase 4는 피처 추가 속도에 직접 영향. Phase 2-3은 복잡도가 높아 후순위.

---

## 4. 무료 플랜 사용자가 Pro로 전환되게 만드는 핵심 후크 3가지 (UX 트리거)

**원칙: "아쉬움을 느끼는 순간"에 바로 업그레이드 유도**

1. **DFM/AI 권장 사항 바로 적용 시 "Pro 필요" 모달**  
   - **시나리오**: 사용자가 DFM 패널에서 "벽 두께 2mm로 늘리기" 버튼을 클릭.  
   - **현재**: `freemium/planLimits.ts`에서 체크 후 토스트만 표시.  
   - **개선**: `analysis/DFMPanel.tsx`의 `handleAutoFix` 함수 내에서 `useFreemiumGate('dfm-auto-fix')` 호출. **인라인 업셀 모달**을 표시하며, "이 변경으로 추정 절감 비용: $X. Pro에서만 가능합니다." 메시지와 함께 **변경 결과를 3D 프리뷰**로 보여줌 (`VersionDiff3DViewer` 재사용).  
   - **파일**: `analysis/DFMPanel.tsx`, `freemium/UpgradePrompt.tsx`를 인터랙티브 모달로 업그레이드.

2. **협업 중 실시간 코멘트/마커 잠금**  
   - **시나리오**: 무료 사용자가 협업 세션에서 동료가 남긴 코멘트에 답변하려 할 때.  
   - **현재**: `collab/CollabChat.tsx`에서 모든 메시지 작성 가능.  
   - **개선**: 무료 플랜에서는 **읽기 전용**. "답변 추가" 버튼을 누르면 "실시간 피드백을 주고받으려면 Pro 팀 플랜이 필요합니다. 지금 업그레이드하시면 이 대화에 바로 참여할 수 있습니다." 모달 표시. **현재 협업 세션의 활성 참여자 수**를 보여주어 사회적 증거 제공.  
   - **파일**: `collab/useCollab.ts`에 플랜 체크 로직, `CollabChat.tsx` UI 조건부 렌더링.

3. **STEP/Parasolid 내보내기 직전 최적화 제안**  
   - **시나리오**: 사용자가 설계를 완료하고 "STEP 내보내기"를 클릭.  
   - **현재**: `io/exporters.ts`에서 바로 다운로드 링크 생성 (Pro 기능은 잠금).  
   - **개선**: `StepUploaderButton.tsx`의 `handleExport` 함수에서 `useFreemiumGate('export-step')` 호출. **잠금 모달 대신 "내보내기 전 최종 검사" 화면**을 표시. 이 화면에서 Pro에서만 가능한 **자동 경량화(LOD)**, **중복 면 제거**, **공차 적용** 옵션을 회색 처리하고 설명. "이 파일을 최적화된 상태로 공급업체에 보내려면 Pro가 필요합니다."  
   - **파일**: `io/StepUploaderButton.tsx`, 새 `pre-export/ExportOptimizationModal.tsx` 생성.

---

## 5. 모바일/태블릿 사용성에서 데스크톱 CAD 대비 가장 부족한 부분 3가지

**터치 인터페이스의 본질적 한계를 보완하는 전략**

1. **정밀한 면/에지 선택의 어려움**  
   - **현재**: 터치로 작은 면이나 교차 에지를 정확히 탭하기 어려움. `SelectionFilterBar`가 도움이 되지만 여전히 실패率高.  
   - **개선**: `responsive/useTouchGestures.ts`에 **"확대 선택 모드"** 추가. 면을 길게 누르면 주변 50px 영역이 확대되어 포인터가 정중앙에 오고, 미세 조정 제스처로 선택 대상 변경 가능. `editing/EdgeHandles.tsx` 등에서 이 모드 활성화 시 시각적 피드백.  
   - **파일**: `useTouchGestures.ts`, `editing/EdgeHandles.tsx` 및 `FaceHandles.tsx`.

2. **키보드 없는 파라미터/치수 입력의 비효율성**  
   - **현재**: 숫자 입력 필드를 탭하면 전체 화면 키보드가 올라와 캔버스가 가려짐. `-/+` 스테퍼 버튼(#6 개선)은 미세 조정에 불편.  
   - **개상**: `ExpressionInput.tsx`에 **"슬라이더 + 숫자 패드 하이브리드"** 모드 추가. 필드 탭 시 하단에 컨텍스트 숫자 패드(대형 버튼)와 슬라이더가 동시에 나타나며, 캔버스는 반투명 오버레이로 남음. **"mm/inch 변환 토글"** 버튼을 패드에 포함.  
   - **파일**: `ExpressionInput.tsx`, `responsive/BottomSheet.tsx` 확장.

3. **멀티 터치 제스처와 CAD 명령의 충돌**  
   - **현재**: 두 손가락으로 확대/축소/회전(오브젝트 탐색) 중 실수로 선택이 해제되거나, 스케치 모드에서 의도치 않은 선이 그려짐.  
   - **해결**: `useTouchGestures.ts`에 **"제스처 컨텍스트 인식"** 로직 추가. 스케치 모드에서는 두 손가락 터치를 즉시 탐색으로 해석(선 그리기 방지). 오브젝트 선택 시에는 **"탭 + 드래그"** 를 이동 명령으로, **"두 손가락 탭"** 을 회전 명령으로 매핑. 설정에서 사용자 정의 가능하도록.  
   - **파일**: `useTouchGestures.ts` 전면 개편, `onboarding/TutorialOverlay.tsx`에 모바일 제스처 튜토리얼 추가.

이 제안들은 모두 **구체적인 파일과 구현 방향**을 명시하여, 엔지니어링 팀이 바로 작업에 착수할 수 있도록 했습니다. 각 항목은 실제 사용자 조사와 데이터(예: 세션 기록, 오류 로그)를 통해 우선순위를 재검증하는 것이 좋습니다.