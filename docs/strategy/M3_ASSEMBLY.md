# M3 — 어셈블리 단일 파이프 (준비 문서)

**목표(로드맵):** 배치·메이트·솔버·간섭이 **하나의 데이터 모델**에서 일관되게 동작한다.  
**의존:** M2 v1 완료(파트 파이프 안정). **이 문서는 구현 전 현황·갭·권장 순서를 고정한다.**

---

## 1. 현재 구현 스냅샷

| 영역 | 역할 | 주요 코드 |
|------|------|-----------|
| 스냅샷 저장 | `placedParts` + `mates` + (선택) `bodies` | `io/nfabFormat.ts` — `NfabAssemblySnapshotV1` |
| 배치 UI | XYZ·회전, BOM | `assembly/PartPlacementPanel.tsx` — `PlacedPart` |
| 메이트 정의 | `coincident` 등, face 인덱스 | `assembly/AssemblyMates.ts` — `AssemblyMate` |
| 메이트 솔버(메시) | 반복 `solveMates` → 파트 B 변형 | `AssemblyMates.ts` + `applyGeometryMatesToPlaced.ts` |
| 대체 솔버 | Gauss-Seidel 어셈블리 상태 | `assembly/matesSolver.ts` — `solveAssembly` (별도 경로) |
| 상태 훅 | 메이트·간섭 결과 state | `hooks/useAssemblyState.ts` |
| 간섭 | 워커 기반 검사; 월드 행렬 `bomPartWorldMatrixFromBom` | `assembly/bomPartWorldMatrix.ts`, `workers/interferenceWorker.ts` |
| 뷰 | 멀티 파트·하이라이트 등 | `ShapePreview.tsx`, `ShapeGeneratorInner.tsx` |

**요약:** 저장 포맷과 UI는 있으나, **메이트 솔버가 두 계열**(간단 반복 vs `matesSolver`)이고, **파트 기하 출처**(라이브러리 `shapeId` vs 사용자 피처 트리 바디)와 **간섭 입력 메시**가 항상 동일 경로인지는 **검증·문서화가 필요**하다. **M3-P2(2026-04-30):** `placedParts.length ≥ 2`일 때 간섭은 `placedPartsToBomResults(placedParts)`에서 직접 파생(메이트 적용 후 배치 = 스냅샷과 동일). 테스트: `interferencePipeline.test.ts`.

**품질(2026-04-30):** `placedPartsToBomResults`가 **회전을 도(°)·위치를 mm**로 통일(이전: X만 ÷1000·회전 라디안으로 뷰·간섭 불일치). 간섭 소스 우선순위: `placedParts` → **`bodyBomParts`(멀티 바디)** → `bomParts`. 회귀: `bomConsistency.test.ts`.

**간섭 성능·품질(롤링):** `InterferenceDetection`에서 **월드 AABB를 파트당 1회**만 계산하고, 파트 수 ≥ `INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT`(`assemblyLoadPolicy`)일 때 **X축 sweep-and-prune**으로 AABB 후보 쌍만 좁힌다. 워커 불가 시 메인 스레드 폴백은 `detectInterferenceCooperative`(후보마다·narrow 삼각 예산 루프마다 `requestIdleCallback` 양보, `AbortSignal`로 중단). 어셈블리 패널에서 로딩 중 **취소** 시 `useInterferenceWorker().cancel`이 cooperative·워커 대기를 함께 끊음. 설계 탭 **타임라인 바**에도 간섭 진행·취소(✕)가 표시된다(`ShapeGeneratorInner` + `TimelineBar`). 워커는 `recommendedMaxTriPairsForPartCount`로 narrow-phase 예산을 넣음. 회귀: `interferenceBroadPhase.test.ts`.

**M3-P1 결정(2026-04-30):** 두 솔버는 **데이터 모델이 다름** (`AssemblyMate`+면 인덱스 vs `Mate`+selection). 제품 저장·배치 경로는 **`solveMates` + `applyGeometryMatesToPlaced`만** 사용. 뷰포트 패널은 **`solveAssembly`**. 합치려면 selection↔face 매핑 레이어가 선행된다 — 코드 주석: `AssemblyMates.ts`, `matesSolver.ts`, `applyGeometryMatesToPlaced.ts`; 회귀: `src/test/m3/solveMatesRegression.test.ts`.

**selection↔face 매핑(롤링):** `assembly/mateSelectionMapping.ts` — `placedPartsAndAssemblyMatesToSolverState`, `assemblyMateToSolverMate`, `mateSelectionFromPlacedFace`, **`reportPlacedAssemblyMateMapping` / `classifyPlacedAssemblyMateMappingFailure`**(매핑 실패 진단). 라이브러리 `shapeId` 기하 + `PlacedPart` 위치·회전을 `AssemblyState`로 올려 `solveAssembly`와 연결. **한계:** 피처 트리/임의 메시는 미포함; `concentric`는 면 법선을 축으로 **근사**. UI: `AssemblyPanel` Solver 탭 **「BOM에서 솔버 동기화」** — 동기화 시 매핑되지 않은 메이트가 있으면 **주황 안내 문구**(약 14초 후 자동 해제). 회귀: `src/test/m3/mateSelectionMapping.test.ts`.

**배치 적용 ↔ Solver 탭(Phase B1):** 메이트를 배치에 적용(`handleApplyMatesToPlacement`)한 뒤 **nonce**를 올려 `AssemblyPanel`이 `runSolverSyncFromBom()`을 자동 호출 — 뷰의 `solveMates` 결과와 Solver 탭 `solveAssembly` 상태가 같은 BOM 기준으로 다시 맞춰진다(`ShapeGeneratorInner` → `RightPanel` → `solverResyncNonce`). **명령 히스토리 Undo/Redo**에도 nonce가 포함되어 취소·재적용 시 Solver 탭이 배치와 함께 리싱크된다.

---

## 2. 로드맵 대비 갭 (M3 완료 정의)

`CAD_FULLSTACK_MILESTONES.md` M3 항목과 매핑:

1. **동기화된 스키마** — `NfabAssemblySnapshotV1` 단일 소스 + JSON 왕복·비정상 메이트 필터 회귀: `assemblySnapshotRoundTrip.test.ts`(2026-04-30).
2. **솔버 이원화** — ~~표·결정 필요~~ → **P1 완료:** 역할 고정(§1 요약). **매핑 1차(롤링):** `mateSelectionMapping.ts` + Solver 탭 동기화 버튼 — 완전 단일 솔버·피처 기하는 후속.
3. **간섭 = 배치 기하** — ~~파이프 고정 필요~~ → **P2 완료:** `ShapeGeneratorInner` + 주석 + `bomPartWorldMatrixFromBom` 단일 행렬 빌더 + Vitest.
4. **자동·수동 검증** — Vitest 시나리오(P0–P2) + 브라우저 E2E: 골든 열기·재열기 + **웹 Ctrl+S 다운로드 후 재열기**(`e2e/m3-assembly-load.spec.ts`); 저장 대화상자(Tauri)·클라우드는 [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md) 수동 A절.

---

## 3. 권장 구현 순서 (스프린트 단위)

| 단계 | 내용 | 산출 |
|------|------|------|
| **M3-P0** | 스키마·이름 규칙(`partA`/`partB` ↔ `PlacedPart.name`) 문서 + 단위 테스트 | `src/test/m3/` 또는 `assembly/__tests__` |
| **M3-P1** | 솔버 역할 문서화 + `solveMates` 회귀 테스트 | 주석 3곳 + `solveMatesRegression.test.ts` |
| **M3-P2** | 간섭 파이프: `placedParts` 직접 파생 + `bomPartWorldMatrixFromBom` | `interferencePipeline.test.ts` |
| **M3-P3** | 저장/재로드 E2E 스모크(체크리스트) | [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md) |
| **M3-P4** | 스냅샷 JSON 왕복·강건성(Vitest) | `assemblySnapshotRoundTrip.test.ts` |
| **M3-P5** | 전체 프로젝트 `parseProject` 골든(어셈블리 블록) | `tests/golden/m3-assembly-minimal.nfab.json` + `nfabAssemblyGolden.test.ts` |

---

## 4. 다음 액션 (이 저장소)

1. ~~솔버 호출 그래프~~ — P1에서 문서·주석으로 고정. 후속: selection↔face 매핑 시 `solveAssembly` 흡수 검토.  
2. ~~간섭 시점/파이프~~ — P2 + 멀티 바디 `bodyBomParts` 분기.  
3. ~~스키마 JSON 왕복~~ — `assemblySnapshotRoundTrip.test.ts`.  
4. **`npm run m3`** — `typecheck` + `src/test/m3/*.test.ts`.  
5. ~~**M3-P3**~~ — [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md) 수동 A절은 릴리스 직전.  
6. ~~**parseProject 골든**~~ — `m3-assembly-minimal.nfab.json`(2026-04-30).  
7. **브라우저 E2E:** `e2e/m3-assembly-load.spec.ts` — 골든 Ctrl+O → `(2)` → reload·재열기; **웹** Ctrl+S로 `.nfab` 저장(다운로드) → reload 후 해당 파일 재열기 → `(2)`. 로컬은 `E2E_BASE_URL`에 맞춤; Turbopack `dev`가 500이면 `npm run test:e2e:m3:serve` 후 `E2E_BASE_URL=http://127.0.0.1:3334 npm run test:e2e:m3`. CI는 `playwright.config`가 **:3333**에 빌드+`next start`.  
8. **후속:** Tauri 네이티브 저장 대화상자 E2E; `solveAssembly`↔`solveMates` selection↔face 매핑 후 단일 솔버 검토; M4는 [M4_DRAWING.md](./M4_DRAWING.md) — `npm run m4` + 출하 포맷·불일치 UI는 롤링.  
9. **상용 게이트(2026-05-06):** `npm run verify` + `npm run verify:integration-smoke` + `npm run test` 로컬 green; 형상·파이프라인 골든은 `UPDATE_GOLDENS=1`로 재생성 후 커밋.

---

## 5. 참고

- M2 완료 기준: [M2_MODELING.md](./M2_MODELING.md) §5, [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md)  
- M3 수동 게이트: [M3_RELEASE_CHECKLIST.md](./M3_RELEASE_CHECKLIST.md)  
- 로드맵 상위: [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) — M3 섹션
