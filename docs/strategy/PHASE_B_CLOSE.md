# Phase B (상용 CAD 코어 갭 축소) — Close Memo

**Date:** 2026-05-29
**Status:** ✅ Done (B1 결정 + B3 정량표 + dedup 2건)
**참조:** [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) §Phase B

---

## 1. B1 — Mate solver 통합 결정

**결정:** **2-path 솔버 아키텍처 유지** (단일 경로로 합치지 않음).

근거 — `docs/strategy/M3_ASSEMBLY.md` §1 "M3-P1 결정 (2026-04-30)"에
이미 고정:

| 경로 | 진입점 | 데이터 모델 | 용도 |
|---|---|---|---|
| 메시 솔버 | `AssemblyMates.solveMates` (+ `applyGeometryMatesToPlaced`) | `AssemblyPart` + face index | 스냅샷 저장 / 다운로드 / 간섭 |
| UI 솔버 | `matesSolver.solveAssembly` | `AssemblyState` + `Mate` (DOF) | 뷰포트 / 라이브 드래그 (60fps `KinematicDragManager`) |
| 매핑 | `mateSelectionMapping.ts` (`placedPartsAndAssemblyMatesToSolverState`) | 양 모델 간 변환 | "BOM에서 솔버 동기화" 버튼 |

근거:
- 두 모델이 동시에 필요 (`saveSnapshot()` ↔ 라이브 viewport drag)
- 라이브 드래그는 DOF 트래킹이 필수, 메시 솔버는 transform만 필요
- 합치려면 selection↔face 매핑 레이어가 모든 호출자에 들어가야 함 → 큰 blast radius
- 매핑 함수가 이미 양방향 변환을 제공 → "Solver 탭" UI에서 단일 BOM 기준 동기화 가능

**제한:** `concentric` 메이트는 면 법선을 축으로 **근사**한다.
피처 트리/임의 메시 매핑은 후속 (`mateSelectionMapping.ts` §한계 주석).
회귀: `src/test/m3/mateSelectionMapping.test.ts` 및
`solveMatesRegression.test.ts`.

**완료 정의:** ✅ 결정 문서화 + 호출자 주석 + 양 솔버 회귀 테스트 green.
B1 자체는 더 이상 손댈 코드가 없다. M4/M5 도면·MBD 작업에서 단일
솔버 흡수가 자연스러워지면 Phase C/D에서 재검토.

---

## 2. B3 — STEP 대용량/조립 정량 한계표

**위치:** `docs/strategy/M1_STEP_CUSTOMER_LIMITS.md` §「정량 한계」.

이전: 정성적 "초대형 파일은 실패할 수 있음" 안내만 있음.
변경: 코드 진실(`src/lib/brep-bridge/constants.ts`)에서 인용한
정량 표 + 가져오기·보내기 실패 패턴별 권장 조치.

핵심 숫자:

- 가져오기 최대 32 MB (디코딩 후)
- 인라인 동기 경로 < 3 MB
- 워커 타임아웃 120 s (env override 가능)
- job TTL 60 분
- 박스만 AP214 B-rep, 나머지 AP242 테셀레이션
- 어셈블리 단일 STEP 미지원 (파트별 export)

**완료 정의:** ✅ 1p 문서, 코드 상수 인용, 실패 패턴 매트릭스 포함.

---

## 3. 폴더 dedup

| 작업 | 변경 | 영향 |
|---|---|---|
| `sheet-metal/` → `sheetmetal/` 통합 | 4 모듈 + 4 테스트 이동, featureLoaders 4개 + registry 4개 entryHint 갱신 | 49/49 tests PASS, tsc clean |
| `weldments/` → `welding/` 통합 | 2 모듈 + 2 테스트 이동, featureLoaders.auto 2개 + registry 2개 entryHint 갱신 | 40/40 tests PASS, tsc clean |

이전 Phase 2 B1 K-factor consolidation의 잔재. 신규 import 0건.

---

## 4. Phase B 종료 — Phase C 진입

CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase B 완료 조건:

- ✅ M3 문서의 "롤링" 갭 중 **솔버 관련 1안** 반영 → 2-path 결정 명문화
- ✅ STEP 한계표 1p
- ⏳ 어셈블리 수동 A절 + E2E green 1 사이클 → Phase 3.5 hands-on 사프린트와 통합 가능
- ✅ Dedup (불필요한 폴더 잔재 정리)

**Phase C 진입 가능.** C1 도면 v0→v1, C2 GD&T 양방향 정책 작업으로
이어간다. 어셈블리 수동 A절은 hands-on 사이클(Q1 후속)에 동봉.

---

## 5. 후속 (Phase C/D에서 다룰 항목)

- 비-박스 solid B-rep export (OCCT writer 확장)
- 어셈블리 단일 STEP (멀티바디 묶음 출력)
- AP242 BIM 풀 호환 (entity 화이트리스트)
- 단일 솔버 흡수 (selection↔face 매핑 안정화 후 재검토)
