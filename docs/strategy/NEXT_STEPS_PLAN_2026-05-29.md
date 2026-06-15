# 다음 단계 계획서 (2026-05-29 기준)

**Context:** Z8 → Phase B → Phase C → Phase D 라운드 1-5 완료. 38 commit, 180+ 회귀, 26 task 완료. 상용 CAD 격차의 코드 측은 대부분 닫혔고 남은 작업은 **(A) 사용자 hands-on 측정**과 **(B) 코드 측 마무리**로 양분된다.

이 문서는:
- §1 남은 작업을 분류 (자동화 가능 vs 사용자 측정 필수)
- §2 코드 측 작업의 의존도 + 파일 충돌 분석
- §3 병렬 실행 계획 (몇 개 agent에 무엇을 맡길지)
- §4 순서 (병렬 묶음 → 직렬 통합)
- §5 종료 기준

---

## 1. 남은 작업 분류

### 1A. 자동화 불가 (사용자 hands-on)

| ID | 작업 | 차단 사유 | 산출물 위치 |
|---|---|---|---|
| H1 | Phase 3 viewer 매트릭스 (5 viewer × 20 fixture) | Onshape/Fusion/SolidWorks/FreeCAD UI 작업 | `docs/wave-1-compat-matrix.md` 매트릭스 셀 채움 |
| H2 | M5 FEA/CAM 실측 1건 | 실제 가공기 + 측정 장비 필요 | `docs/field-validation/<date>-<part>.md` (worksheet 채움) |
| H3 | Awareness latency Playwright 실행 | 빌드+서버+credential | `docs/wave-2-phase-3-awareness-latency-runbook.md` 결과 기록 |

이 3건은 본 계획에서 **차단으로 표시**하고, 코드 측 보조 자료 (체크리스트·자동화 도우미)만 본 라운드에서 다룬다.

### 1B. 자동화 가능 (코드/문서)

| ID | 작업 | 추정 LoC | 파일 영역 |
|---|---|---|---|
| C1 | applySubtractBody host wire (viewport raycaster + scene tool-body 제거 callback) | ~200 | `ShapeGeneratorInner.tsx` (high-touch) |
| C2 | F11-F15 OCCT fillet/chamfer fixture 활성화 | ~150 | `src/test/m1/wave1CompatFixtures.ts` |
| C3 | F18/F20 sketch/circular-pattern fixture 활성화 | ~120 | `src/test/m1/wave1CompatFixtures.ts` |
| C4 | Viewer matrix 자동화 도우미 (viewer별 import 절차 체크리스트 + 결과 입력 양식) | ~150 | `docs/wave-1-compat-matrix-viewer-runbook.md` (신규) |
| C5 | STEP classifier whitelist 확장 (telemetry로 식별된 unknown entity 추가) | ~50 | `src/app/[lang]/shape-generator/stepImport/entityClassifier.ts` |
| C6 | Sub-assembly nested UI (assembly tree 편집기) | ~400 | 신규 컴포넌트 |
| C7 | configurations export (각 config별 STEP/도면 일괄) | ~250 | `src/app/[lang]/shape-generator/configurations/` |
| C8 | Drawing v1 GD&T datum frame symbol | ~150 | `src/app/[lang]/shape-generator/analysis/drawingExport.ts` |

---

## 2. 의존도 + 파일 충돌

```
C1 (host wire) ──── 의존: applySubtractBody (있음), DirectEditController (있음)
                    충돌: ShapeGeneratorInner.tsx (single high-touch file)
                    blast radius: HIGH (10K+ LoC 파일)

C2 (F11-F15)   ──┐
C3 (F18/F20)   ──┴── 공유 파일: wave1CompatFixtures.ts → 직렬화 필요 (한 agent)

C4 (viewer runbook) — 의존 없음. 완전 독립.
C5 (classifier whitelist) — entityClassifier.ts 단독. C2/C3과 무관.
C6 (sub-assembly UI) — 신규 파일. 다른 작업과 무충돌.
C7 (configurations export) — 신규 컴포넌트 + configurations/ 폴더. C8과 무관.
C8 (GD&T datum) — drawingExport.ts. C7과 무관.
```

**충돌 그래프:**

| Pair | 충돌 여부 |
|---|---|
| C2 ↔ C3 | YES — 같은 파일 `wave1CompatFixtures.ts` |
| C1 ↔ 기타 | NO (다른 파일) but HIGH RISK (host 파일 큼) |
| C4 / C5 / C6 / C7 / C8 | 서로 무충돌 |
| 모든 코드 작업 ↔ H1/H2/H3 | 무충돌 (H는 사용자 측 결과 입력만) |

---

## 3. 병렬 실행 계획

5개 agent로 병렬화 가능. 각 agent는 충돌 없는 영역만 담당.

| Agent | 담당 | 파일 영역 | 산출 |
|---|---|---|---|
| **A1** | C2 + C3 (F11-F15 + F18/F20 fixture 활성화) | `wave1CompatFixtures.ts` 단일 | 6 추가 fixture PASS, OCCT 게이트 명시 |
| **A2** | C4 (viewer runbook) | 신규 doc | 5 viewer × import 절차 체크리스트 |
| **A3** | C5 (classifier whitelist 확장) | `entityClassifier.ts` | CORE/PMI set 확장, 추가 분류 회귀 |
| **A4** | C6 (sub-assembly UI 컴포넌트) | 신규 `AssemblyTreeEditor.tsx` | nested AssemblySubNode 빌더 UI + tests |
| **A5** | C8 (GD&T datum frame export) | `drawingExport.ts` | DXF/SVG에 datum frame symbol 추가 + 회귀 |

**메인 (직렬)**: C1 + C7 — 두 작업 모두 HIGH-touch 파일 (`ShapeGeneratorInner.tsx` 또는 `configurations/`) 또는 host 통합 작업이라 메인 스레드에서 신중하게 진행.

| 단계 | 메인이 하는 것 |
|---|---|
| Step 1 | 5 agent 병렬 dispatch (A1~A5) |
| Step 2 | Agent 결과 검증 + 통합 commit (각 agent별 별도 commit으로 격리) |
| Step 3 | C1 host wire (메인 단독, single-thread) |
| Step 4 | C7 configurations export (메인 단독) |
| Step 5 | 통합 회귀 (npm test) + 메모리 갱신 |

---

## 4. 순서 + 타임라인

```
T0 ─┬─ A1 (fixtures) ────────────┐
    ├─ A2 (viewer runbook) ──────┤
    ├─ A3 (classifier whitelist)─┤
    ├─ A4 (sub-assembly UI) ─────┤
    └─ A5 (GD&T datum) ──────────┤
                                  ▼
                                메인 통합 (commits per agent)
                                  │
                                  ▼
                              C1 host wire (메인)
                                  │
                                  ▼
                              C7 configurations export (메인)
                                  │
                                  ▼
                              통합 회귀 + 메모리 갱신
```

추정:
- T0..T1: agent 병렬 ~10-15 min
- T1..T2: 통합 + per-agent commit ~5 min
- T2..T3: C1 host wire ~15-20 min
- T3..T4: C7 configurations export ~15-20 min
- 합계: ~50-60 min

---

## 5. 종료 기준

- ✅ 모든 agent commit 통합 + tsc clean
- ✅ npm test 회귀 0 fail
- ✅ 각 agent의 신규 회귀 ≥ 5 PASS
- ✅ 메모리 갱신
- ✅ 남은 차단(H1/H2/H3)은 명시적으로 "사용자 측 대기"로 표기

H1/H2/H3 완료 후 별도 라운드에서 flag-graduation PR 작성.

---

## 6. 위험 / 트레이드오프

| 위험 | 완화 |
|---|---|
| Agent가 동일 파일을 건드림 (충돌) | §2 분석에 따라 영역 분리. agent별로 단일 파일 또는 신규 파일만 |
| C1 host wire가 ShapeGeneratorInner.tsx (10K LoC) 깨뜨림 | 메인에서 직렬. 최소 침습 (props 추가만). 사전에 기존 callback 패턴 확인 |
| Agent 결과 품질 편차 | 메인이 검증 후 통합 (직접 commit 안 함, agent 결과 review) |
| OCCT 게이트 필요한 fixture (C2)가 RUN_OCCT_FEASIBILITY 없이 실패 | gated suite로 처리 (기존 패턴) |

---

## 7. 후속 (이 계획 완료 후)

- H1 viewer matrix 결과 입력 → flag-graduation PR draft
- H2 M5 field validation 결과 → roadmap §Phase C3 update
- H3 awareness latency 결과 → exit memo update
- (옵션) C6/C7/C8 결과 기반 UX polish 라운드

---

## 8. 참고

- 이전 라운드: `docs/wave-2-phase-3-exit.md`, `docs/wave-2-phase-3-w11-burnin.md`, `docs/wave-2-phase-3-awareness-latency-runbook.md`
- 매트릭스: `docs/wave-1-compat-matrix.md`
- 직접편집: `src/app/[lang]/shape-generator/directEdit/`
- STEP I/O: `src/app/[lang]/shape-generator/io/`, `src/app/[lang]/shape-generator/stepImport/`
