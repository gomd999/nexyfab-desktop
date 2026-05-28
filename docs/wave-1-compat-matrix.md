# Wave 1 GA — STEP Roundtrip 호환성 매트릭스 (20 × 5)

**Status:** draft, not yet executed.  
**Owner:** Wave 1 GA gate keeper (ADR-009 §3 — gate #3).  
**Pre-condition:** Wave 1 PR merged + worker deployed + `canExportStepCleanly()`
가 fixture 20개 모두에서 enabled. 이 조건이 충족되기 전까지는 매트릭스를 실행
하지 않는다 (false negative 방지).  
**Pass criterion:** 20 × 5 = 100 cell 중 **≥ 70 cell** 이 `✓` 면 gate pass.

> 참조: `docs/strategy/step-export-gating.md` (현재 게이팅 정책),
> `docs/strategy/M1_STEP_CUSTOMER_LIMITS.md` (고객 1p 안내),
> `docs/strategy/b1-face-provenance.md` (face provenance).

---

## 1. 5 viewer (1 row · 한 row 결과 = 5 cell)

| Slot | Viewer | Version (lock) | Channel | 단위 import | 비고 |
|---|---|---|---|---|---|
| V1 | **Onshape** (web) | latest stable as of 2026-05-28 | Free public document | mm | STEP AP242 직접 import |
| V2 | **Fusion 360** | 2026.5+ | desktop trial OK | mm | "Insert → Insert Derive → STEP" |
| V3 | **SolidWorks** | 2026 SP3 | 30-day eval | mm | "Open as Part" 옵션 사용, feature 변환은 끔 |
| V4 | **FreeCAD** | 1.0.x stable | OSS | mm | OCCT 7.8 기반, B-rep 분석 가능 |
| V5 | **Onshape Mobile** (iOS/Android) | 동일 빌드 | tablet only | mm | 모바일 mesh 한계 확인 |

> Viewer 버전은 매트릭스 실행 직전에 한 번 동결한다. 동결 정보는 결과
> 보고서 §0 (Environment lock) 에 기록한다.

---

## 2. 20 Fixture 정의

### 2.1 작성 원칙
- 모든 fixture 는 **Shape Generator UI** 안에서 op 시퀀스만으로 재현 가능해야
  한다 (수동 SCAD/CAD 외부 도구 금지).
- 모든 길이 단위는 **mm**, 모든 각도 단위는 **deg**.
- 각 fixture 는 `predicted` (Shape Generator 자체 측정) 와 `tolerance`
  (viewer 측정 허용 오차) 두 값을 명시한다.
- 가능한 fixture 는 export 직후 `canExportStepCleanly() === true` 여야 한다.
  False 인 fixture 는 Wave 1 범위 밖이므로 매트릭스에서 제외하고
  Wave 2 backlog 로 넘긴다.

### 2.2 Basic primitives (5 fixture)

| ID | 이름 | Op sequence | Predicted | Tolerance |
|---|---|---|---|---|
| **F01** | `cube-50` | `New Box` (W50 D50 H50) | V = 125,000 mm³ · 6 face · 8 vertex | ±0.02 mm · ±0.05% V |
| **F02** | `cylinder-d40-h60` | `New Cylinder` (D40 H60) | V = π·20²·60 ≈ 75,398 mm³ · 3 face · 측면 1 cylinder face | D = 40±0.05 · H = 60±0.05 |
| **F03** | `sphere-r25` | `New Sphere` (R25, seg 32) | V = (4/3)π·25³ ≈ 65,449 mm³ · 1 face (B-rep) / 1024 tri (mesh) | R = 25±0.10 |
| **F04** | `box-with-hole-M8` | `New Box` (W60 D40 H10) → `Hole` (D8 through, center) | V = 60·40·10 − π·4²·10 = 24,000 − 502.65 ≈ 23,497 mm³ · hole 직경 측정 | D_hole = 8.0±0.05 · 위치 ±0.02 |
| **F05** | `L-bracket` | `New Box` (W60 D60 H10) → `Subtract Box` (W40 D40 H10, offset +20 +20 0) | V = 3,600·10 − 1,600·10 = 20,000 mm³ · 내부 코너 90° sharp | 폭 ±0.05 · 코너 sharp (chamfer 0) |

### 2.3 Boolean operations (5 fixture)

| ID | 이름 | Op sequence | Predicted | Tolerance |
|---|---|---|---|---|
| **F06** | `bool-union-cube-cyl` | `Box` (W30 D30 H30) `Union` `Cylinder` (D20 H40, center) — pierce both ends | V = 27,000 + π·10²·40 − π·10²·30 = 27,000 + 12,566 − 9,425 ≈ 30,141 mm³ | V ±0.5% |
| **F07** | `bool-subtract-pocket` | `Box` (W80 D60 H20) `Subtract` `Box` (W40 D30 H10, center, top half) — 내부 pocket | V = 96,000 − 12,000 = 84,000 mm³ · 내부 코너 sharp | 깊이 = 10±0.05 |
| **F08** | `bool-intersect-cyl-cube` | `Cube` (50³) `Intersect` `Cylinder` (D50 H50, center, vertical) | V = π·25²·50 ≈ 98,175 mm³ (cube가 cyl을 완전히 포함하므로 cyl 부피와 동일) | V ±1% · 면 = 3 (top, bottom, side) |
| **F09** | `bool-multi-tool-subtract` | `Box` (W100 D50 H20) `Subtract Pattern` 3×`Cylinder` (D10 H20, x=20/50/80, y=25) — 3 hole | V = 100,000 − 3·π·5²·20 = 100,000 − 4,712 ≈ 95,288 mm³ | 각 hole D = 10±0.05 · pitch = 30±0.02 |
| **F10** | `bool-tee-union` | `Cylinder` (D20 H80, X축) `Union` `Cylinder` (D20 H80, Z축, 중점 교차) — T 분기 | V = 2·π·10²·80 − π·10²·20 = 50,265 − 6,283 ≈ 43,982 mm³ · 교차부에서 smooth blend 없음 | V ±1% · 교차 부위 sharp intersection |

### 2.4 Fillet / Chamfer (5 fixture)

| ID | 이름 | Op sequence | Predicted | Tolerance |
|---|---|---|---|---|
| **F11** | `fillet-cube-1edge-r5` | `Box` (40³) → `Fillet` (top front edge, R5) | V = 64,000 − (40·(25 − π·5²/4)) = 64,000 − (40·(25 − 19.635)) ≈ 63,786 mm³ · 1 fillet face (cylindrical, R5) | R_fillet = 5.0±0.01 · face 개수 = 7 |
| **F12** | `fillet-cube-allvert-r3` | `Box` (50³) → `Fillet` (all 12 edges, R3) | 부피 감소 ≈ 12·50·(9 − π·9/4) + 8 corner 보정 → V ≈ 122,500 mm³ (predicted by Shape Generator) | R = 3.0±0.01 · 모든 12 edge blend |
| **F13** | `chamfer-cube-4topedge` | `Box` (40³) → `Chamfer` (top 4 edges, 5mm × 45°) | V = 64,000 − 4·40·12.5 ≈ 62,000 mm³ · 4 chamfer face (planar, 45°) | chamfer 폭 = 5.0±0.02 · 각도 = 45±0.5° |
| **F14** | `fillet-different-radii` | `Box` (60×40×20) → `Fillet` (top 4 edges, R3) + `Fillet` (bottom 4 edges, R8) | V = 48,000 − (계산값, Shape Generator export 시 확정) | top R = 3.0±0.01 · bottom R = 8.0±0.01 · 두 radius 가 별개 face label 보존 |
| **F15** | `fillet-on-boolean` | F07 (`bool-subtract-pocket`) → `Fillet` (pocket bottom 4 edge, R2) | V = 84,000 − (pocket 4 edge에 R2 → ≈ 84,000 + 4·(40 or 30)·(4 − π·4/4)) · Shape Generator 측정값으로 확정 | R = 2.0±0.01 · pocket 바닥 내부 4 edge 모두 blend |

### 2.5 Extrude / Revolve (3 fixture)

| ID | 이름 | Op sequence | Predicted | Tolerance |
|---|---|---|---|---|
| **F16** | `extrude-simple-rect` | `Sketch` (rect 60×40 on XY) → `Extrude` (height 25) | V = 60,000 mm³ · 6 면 (cube 와 동치) | 치수 ±0.02 mm |
| **F17** | `extrude-circle-with-hole` | `Sketch` (outer circle D80, inner circle D40, both on XY) → `Extrude` (height 15) | V = π·(40² − 20²)·15 = π·1200·15 ≈ 56,549 mm³ · 4 면 (top ring, bottom ring, outer cyl, inner cyl) | OD = 80±0.05 · ID = 40±0.05 · H = 15±0.05 |
| **F18** | `revolve-profile-bowl` | `Sketch` (Z축 우측 절반: 사다리꼴 outer 50→30 height 40, inner 45→25 height 40) → `Revolve` (360° around Z) | 부피 = revolved trapezoid · Shape Generator 측정값으로 확정 (≈ 60,000–80,000 mm³ 범위) | top OD = 100±0.10 · bottom OD = 60±0.10 · 두께 5±0.05 · revolve 축 일치 |

> Extrude/Revolve fixture 는 sketch dependency 가 있어 sketch system 이
> 머지된 후에만 추가 가능. 머지 전 단계에서는 F16/F17 만 box/cylinder
> 등치로 대체 가능하며, F18 은 Wave 2 로 deferral 후보.

### 2.6 Pattern / Mirror (2 fixture)

| ID | 이름 | Op sequence | Predicted | Tolerance |
|---|---|---|---|---|
| **F19** | `linear-pattern-holes` | `Box` (200×40×10) → `Hole` (D6 through, x=20, y=20) → `Linear Pattern` (X 방향, 9 copy, pitch = 20) | V = 80,000 − 9·π·3²·10 = 80,000 − 2,545 ≈ 77,455 mm³ · 9 hole | pitch = 20±0.02 · 각 hole D = 6±0.05 |
| **F20** | `circular-pattern-+-mirror` | `Cylinder` (D80 H10, base) → `Hole` (D8 through, x=30, y=0) → `Circular Pattern` (Z축, 6 copy, 360°) → `Mirror` (XY plane, depth +20) — flange 양면 | V = 2·(π·40²·10 − 6·π·4²·10) = 2·(50,265 − 3,016) ≈ 94,500 mm³ · 12 hole | hole pitch radius = 30±0.05 · 각도 = 60±0.1° · mirror plane 대칭 |

---

## 3. 매트릭스 (20 × 5)

각 cell 값:
- **✓** = 열림 + 모든 측정값이 §2 의 tolerance 안 + 시각적 artifact 없음
- **⚠️** = 열림 but 측정값 일부가 tolerance 밖 / face 누락 / B-rep 이 mesh
  로만 들어옴 (사용 가능하지만 의도된 정확도 미달)
- **✗** = import 실패 / viewer crash / "Unknown error" / 빈 파트

| Fixture | V1 Onshape | V2 Fusion 360 | V3 SolidWorks | V4 FreeCAD | V5 Onshape Mobile |
|---|---|---|---|---|---|
| F01 cube-50 |   |   |   |   |   |
| F02 cylinder-d40-h60 |   |   |   |   |   |
| F03 sphere-r25 |   |   |   |   |   |
| F04 box-with-hole-M8 |   |   |   |   |   |
| F05 L-bracket |   |   |   |   |   |
| F06 bool-union-cube-cyl |   |   |   |   |   |
| F07 bool-subtract-pocket |   |   |   |   |   |
| F08 bool-intersect-cyl-cube |   |   |   |   |   |
| F09 bool-multi-tool-subtract |   |   |   |   |   |
| F10 bool-tee-union |   |   |   |   |   |
| F11 fillet-cube-1edge-r5 |   |   |   |   |   |
| F12 fillet-cube-allvert-r3 |   |   |   |   |   |
| F13 chamfer-cube-4topedge |   |   |   |   |   |
| F14 fillet-different-radii |   |   |   |   |   |
| F15 fillet-on-boolean |   |   |   |   |   |
| F16 extrude-simple-rect |   |   |   |   |   |
| F17 extrude-circle-with-hole |   |   |   |   |   |
| F18 revolve-profile-bowl |   |   |   |   |   |
| F19 linear-pattern-holes |   |   |   |   |   |
| F20 circular-pattern-+-mirror |   |   |   |   |   |

**합계:** ✓ ___ / ⚠️ ___ / ✗ ___  (= ___% pass)

---

## 4. 한 row 실행 절차 (≤ 20 분 / fixture, ≤ 5 분 / viewer)

> 한 사람이 fixture 한 개를 5 viewer 모두에서 검증하는 walk-through.
> 매트릭스 전체 (20 fixture × 5 viewer) 는 ≈ 6-7 시간 / 1 명, 또는
> viewer 별 분담 시 ≈ 1.5 시간 × 5 명.

### 4.0 Pre-flight (한 번만, 매트릭스 시작 시 1 회)

1. Wave 1 PR 머지 + worker 배포 확인 — `https://nexyfab.com/shape-generator`
   에서 `?build=` query 가 머지 커밋 SHA 와 일치.
2. 5 viewer 의 버전을 §1 표에 기록 (lock).
3. 결과 파일 폴더 생성:
   `~/wave1-roundtrip/<YYYY-MM-DD>/<F##>/` (per-fixture STEP + screenshot).

### 4.1 Fixture 생성 + export (≤ 5 분)

1. Shape Generator UI 진입, blank document 새로 만들기.
2. §2 의 op sequence 그대로 입력 (UI 상에서 op 명/파라미터를 그대로
   입력 — 외부 SCAD/콘솔 사용 금지).
3. UI 우상단 **Measure** 패널에서 Volume / Bounding box / Face count
   기록 → fixture markdown 의 `predicted (in-app)` 열에 입력.
4. **Export → STEP** 버튼 클릭. 버튼이 disabled 면:
   - tooltip 캡처 → fixture 를 `excluded (gating)` 로 표시 후 매트릭스에서
     해당 row 5 cell 모두 `✗` 로 채우지 말고 **`—` (out of scope)** 로
     기록. Pass rate 계산 시 분모에서도 제외한다.
5. 다운로드된 `.step` 파일을
   `~/wave1-roundtrip/<date>/F##/F##.step` 로 저장.

### 4.2 5 viewer 각각에서 검증 (≤ 3 분 / viewer)

각 viewer 공통 절차:

1. **Import:** STEP 파일을 새 문서에 import. 단위는 mm 로 고정.
2. **시각:** 모델 트리에 part 가 들어오고, 화면에 모델이 보이면 그 자체로
   "열림" 통과. 화면이 비어 있거나 import dialog 가 error 를 띄우면 `✗`.
3. **측정 (3 항목, 90 초 안에 끝낼 것):**
   - Volume / Mass properties: §2 의 predicted 와 비교.
   - 대표 길이 1 개 (예: F04 의 hole 직경, F11 의 fillet R) — measure
     도구로 확인.
   - Face count: feature tree 가 있으면 face/surface 개수 확인.
4. **판정:**
   - 3 측정 모두 tolerance 안 + 시각적 artifact 없음 → `✓`
   - 열렸으나 1 개 이상 측정이 tolerance 밖 / face 누락 / B-rep 이 mesh
     로만 들어옴 → `⚠️` (caveat 한 줄 기록)
   - import 실패 / crash / 빈 파트 → `✗` (error 메시지 캡처)
5. **증거 캡처:** Volume 값이 보이는 스크린샷 1 장을
   `~/wave1-roundtrip/<date>/F##/V#-<viewer>.png` 로 저장.

### 4.3 Viewer 별 quirk (사전 인지)

| Viewer | Quirk | 대응 |
|---|---|---|
| Onshape | "Translate" tab 에서 STEP→Onshape part conversion 옵션 활성화 필수 | 옵션 켜고 import, 안 켜면 mesh-only 로 들어와 `⚠️` 판정 가능 |
| Fusion 360 | `Insert → Insert Derive` 가 아니라 `File → Upload` 사용 시 cloud translation 대기 발생 | Upload 사용, 변환 완료까지 대기 후 측정 |
| SolidWorks | "Open as Part" vs "Open as Assembly" 선택 dialog → Part 선택 | feature 변환 옵션 끔 (B-rep 그대로) |
| FreeCAD | STEP 의 OCCT version mismatch 시 "Surface tolerance" 경고 — 무시 가능 | 경고는 캡처만 하고 `✓`/`⚠️` 판정은 측정값으로 |
| Onshape Mobile | 모바일에서는 measure 도구가 일부 제한 (3D distance only) | Volume 확인 어려우면 BBox 1 변 + face count 로 대체 |

---

## 5. 결과 보고 양식

> 매트릭스 실행이 완료되면 이 파일에 §6 결과 섹션을 추가하거나, 별도
> `docs/wave-1-compat-matrix-result-<YYYY-MM-DD>.md` 를 작성한다.

### 5.1 통과율 계산

```
denominator = 100 − ("—" out-of-scope cell 수)
numerator   = ✓ cell 수
pass_rate   = numerator / denominator
```

- **Gate pass:** `pass_rate ≥ 0.70` AND out-of-scope 수 ≤ 15 (즉
  matrix denominator ≥ 85). out-of-scope 가 너무 많으면 "통과율은 좋아
  보이지만 실제 coverage 가 낮음" 함정이므로 별도 alert.

### 5.2 실패 패턴 분류

`✗` 와 `⚠️` cell 은 다음 카테고리 중 하나로 태깅한다:

| Tag | 의미 | 추정 원인 |
|---|---|---|
| `P-EMIT-AP242` | export 자체 실패 (gating 통과했는데 file 이 broken) | stepExporter 의 tessellation emit 결함 |
| `P-EMIT-AP214` | NX-cube fast path 가 잘못된 STEP 생성 | `remapAp214NxCubeToBox` regression |
| `P-IMPORT-OCCT` | viewer 가 OCCT kernel 인데 reject | AP242 형식이 strict 하지 않음 |
| `P-IMPORT-PARASOLID` | viewer 가 Parasolid (SolidWorks/Onshape) 인데 reject | Parasolid 가 우리 STEP variant 를 모름 |
| `P-PRECISION` | 열렸으나 측정값이 tolerance 밖 | 메시 tessellation density 부족 / B-rep round-trip drift |
| `P-FACE-LABEL` | face count / face label 손실 | face provenance 미보존 — B1 작업 영향 |
| `P-MESH-ONLY` | viewer 가 mesh 로만 import (B-rep 아님) | Route A (OCCT B-rep) 미완성 |
| `P-MOBILE` | mobile viewer 의 mesh 한계 / measure 도구 한계 | Wave 1 범위 밖 가능성 — Wave 2 mobile track |

각 실패 cell 은 `(Tag, fixture, viewer, 한 줄 메모)` 로 행 추가.

### 5.3 결과 표 템플릿

```markdown
## 6. Result — <YYYY-MM-DD>

### 6.0 Environment lock
- Wave 1 build SHA: <git sha>
- Worker deploy ID: <id>
- Viewer versions: V1 ___ · V2 ___ · V3 ___ · V4 ___ · V5 ___

### 6.1 Final matrix
(§3 표 그대로, cell 채워서)

### 6.2 Tally
- ✓: __ / ⚠️: __ / ✗: __ / —: __
- Denominator: __
- Pass rate: __%
- **Gate verdict:** PASS / FAIL

### 6.3 Failure breakdown
| Cell | Tag | Note |
|---|---|---|
| F##.V# | P-... | ... |
...

### 6.4 다음 단계
- 통과 → ADR-009 §3 gate #3 closed, Wave 1 GA 진행 가능.
- 미통과 → 가장 빈도 높은 Tag 부터 우선 수정:
  - `P-IMPORT-OCCT` 다발 → step-export-gating.md Route A (OCCT B-rep emit) 착수.
  - `P-IMPORT-PARASOLID` 다발 → SolidWorks/Onshape import 옵션 가이드
    추가 + AP214 fast path 확장.
  - `P-PRECISION` 다발 → tessellation density / OCCT precision 파라미터
    재튜닝.
  - `P-FACE-LABEL` 다발 → b1-face-provenance 작업 가속.
  - `P-MOBILE` 만 다발 → V5 를 Wave 1 gate denominator 에서 제외하는
    것을 ADR-009 amendment 로 제안 (mobile 은 Wave 2 mobile track).
- Partial pass (50–70%) → fixture 별 caveat 를
  `docs/strategy/M1_STEP_CUSTOMER_LIMITS.md` 의 알려진 한계 표에 반영.
```

---

## 6. 운영 메모

- 매트릭스는 **머지 + 배포 후** 한 번에 실행. 실행 도중 hotfix 가
  나가면 build SHA 가 바뀌어 결과의 reproducibility 가 깨지므로, 실행
  windows 동안에는 main 머지 freeze.
- Fixture 정의 (§2) 는 실행 결과로 확정된 `predicted` 값을 그대로
  덮어쓰지 않는다. 실측이 predicted 와 어긋나면 그것이 곧 결함의 단서.
- F18 (revolve) 와 F19/F20 (pattern) 은 Shape Generator 의 해당 op
  가 production-shipped 가 아니면 매트릭스 실행 전에 "—" 로 마킹하고
  Wave 2 backlog 로 정리. 이때 denominator 가 85 미만으로 떨어지면
  §5.1 의 두 번째 조건에 걸려 gate 자체가 무효.
- 결과는 `project_nexyfab_3d_burnin.md` memory entry 에 한 줄 추가
  (`2026-MM-DD Wave1 roundtrip matrix: __% pass, gate ___`).

---

## 7. Per-fixture 검증 체크리스트 (실행자용)

> §4 가 walk-through 절차라면, 본 §7 은 fixture 마다 "무엇을 측정하고
> 어디서 ✗ 가 나오기 쉬운지" 의 좁은 가이드. 한 fixture × 한 viewer 가
> 5 분 안에 안 끝나면 거의 항상 측정 방법을 잘못 잡은 것 — 본 표 참조.

### 7.1 Basic primitives

- **F01 cube-50** — Volume + 3 변 길이 (mass props). 이 fixture 가 한
  viewer 에서 `✗` 면 export 파이프라인 전반 회의 (AP214 fast path 가
  basic case 부터 깨졌다는 뜻).
- **F02 cylinder-d40-h60** — Diameter (cylinder face select → measure),
  Height (top↔bottom face distance). face count = 3 확인 — 측면이
  여러 planar face 로 쪼개져 들어오면 `⚠️` (mesh-only 가능성).
- **F03 sphere-r25** — viewer 에 따라 sphere 를 단일 spherical face 로
  받지 못하고 mesh patch 로 받음 — `⚠️` 흔함. radius 측정은 3 점 fit
  도구로.
- **F04 box-with-hole-M8** — hole 직경, 위치 (origin → hole center),
  through 여부 (양쪽 면에서 hole 가 보이는지).
- **F05 L-bracket** — 내부 코너 sharp 여부 (코너에 fillet/chamfer 가
  잘못 생겼으면 boolean 가공 중 round-off — `⚠️`). 두 다리 길이 1 개씩
  측정.

### 7.2 Boolean operations

- **F06 bool-union-cube-cyl** — cylinder 와 cube 가 한 body 로 보이는지
  (assembly 로 분해되면 `✗`). 교차 edge 가 둥글지 않고 sharp 인지.
- **F07 bool-subtract-pocket** — pocket 깊이, pocket 바닥 face flatness.
- **F08 bool-intersect-cyl-cube** — face count = 3 (cube 모서리가 남아
  있으면 intersect 가 실제로 적용 안 됨 → `✗`).
- **F09 bool-multi-tool-subtract** — hole 3 개 모두 있는지, 3 hole 의
  pitch 가 동일한지.
- **F10 bool-tee-union** — 두 cylinder 가 한 body 로 보이는지, T 교차
  부의 edge 가 viewer 측에서 정상 evaluate 되는지 (FreeCAD 에서 자주
  깨짐 — `P-IMPORT-OCCT`).

### 7.3 Fillet / Chamfer

- **F11 fillet-cube-1edge-r5** — fillet face 가 1 개의 cylindrical face
  로 들어오는지 (mesh patch 로 들어오면 `⚠️`). R = 5 ±0.01 측정.
- **F12 fillet-cube-allvert-r3** — 12 edge 모두 blend 되었는지. corner
  3-blend (3 fillet 이 만나는 corner) 의 정상 evaluate 가 핵심 — corner
  에 hole/gap 이 보이면 `⚠️` (`P-PRECISION`).
- **F13 chamfer-cube-4topedge** — chamfer face 가 planar 인지 (실수로
  fillet 으로 변환되면 `⚠️`). 폭, 각도 측정.
- **F14 fillet-different-radii** — 두 radius 가 서로 섞이지 않는지
  (face label 손실 시 한쪽 radius 로 전부 통일되어 들어오면
  `P-FACE-LABEL`).
- **F15 fillet-on-boolean** — pocket 내부 4 edge 모두 R2 blend 되었는지
  (boolean → fillet 순서가 viewer 측에서 깨지면 일부 edge sharp
  → `⚠️`).

### 7.4 Extrude / Revolve

- **F16 extrude-simple-rect** — F01 과 동치이므로 결과가 F01 과
  차이나면 sketch path 자체가 다른 STEP 을 만들고 있음 — 두 row 비교가
  진단 단서.
- **F17 extrude-circle-with-hole** — OD/ID 가 모두 cylindrical face 로
  들어오는지. inner cylinder 가 mesh 로 들어오면 `⚠️`.
- **F18 revolve-profile-bowl** — revolve 축이 viewer 측에서 z 축과
  일치하는지 (transform 누락 시 비스듬히 들어옴 → `⚠️`). 두께 측정.

### 7.5 Pattern / Mirror

- **F19 linear-pattern-holes** — 9 hole 모두 존재, pitch 일정, 각
  hole diameter 일정. 한 hole 만 측정 후 visual inspection 으로 나머지
  8 개 확인 (시간 절약).
- **F20 circular-pattern-+-mirror** — 12 hole 합계, 6 hole 의 각도
  60°, mirror plane 대칭. 한 평면만 확인 후 반대 평면은 시각 확인.

---

## 8. Viewer 별 Import recipe (재현 가능한 클릭 시퀀스)

> 매번 다른 사람이 매트릭스를 돌리면 viewer UI 변형 때문에 결과가
> 흔들린다. 본 §8 은 viewer 별 "정해진 클릭" 만 추렸다. 다른 경로로
> import 했다면 결과 보고서에 그 사실을 명시한다.

### 8.1 V1 — Onshape (web)

1. document.onshape.com 로그인 → "Create" → "Document" → 빈 문서.
2. 좌측 하단 "+" → "Import" → STEP 파일 선택.
3. Import dialog: "Import as a Part Studio" 선택 (Assembly 아님).
4. "Translate to Onshape format" 체크 켜기. 끄면 mesh-only 로 들어와서
   measure 불가 → `⚠️` 처리.
5. Tab 상단의 part 클릭 → 우측 panel "Mass properties" 에서 Volume 확인.
6. Measure tool (M) 로 대표 길이 1 개 측정.

### 8.2 V2 — Fusion 360

1. Fusion 360 desktop 실행 → "New Design".
2. 좌측 data panel → "Upload" → STEP 파일 → cloud translation 대기
   (보통 30 초 ~ 2 분). translation 실패는 그 자체로 `✗`.
3. Upload 완료 후 data panel 에서 더블클릭 → 새 탭에서 열림.
4. Browser tree 의 part 우클릭 → "Properties" → Volume 확인.
5. Inspect → "Measure" 로 대표 길이.

### 8.3 V3 — SolidWorks

1. SolidWorks 실행 → File → Open → STEP 파일 선택.
2. Dialog: "Import as Part" 선택. "Run Import Diagnostics" 체크 켜기.
   diagnostic 이 error 를 보고하면 `⚠️` 또는 `✗`.
3. "Tools → Mass Properties" 또는 단축키 Ctrl+B → Volume 확인.
4. "Smart Dimension" 또는 Measure tool 로 대표 길이.

### 8.4 V4 — FreeCAD

1. FreeCAD 1.0 실행 → File → Open → STEP 파일.
2. Tree 패널에서 part 선택 → 우측 "Data" tab 의 Shape 항목 펴서
   Volume/Area 확인.
3. Part workbench 의 "Measure" 로 대표 길이.
4. 콘솔 (View → Panels → Report view) 에 OCCT 경고가 뜨면 캡처
   (P-PRECISION 단서).

### 8.5 V5 — Onshape Mobile (iOS/Android)

1. Onshape mobile 앱 로그인 → 위에서 만든 동일 document (V1 결과 재
   사용 가능, 또는 새 import).
2. Part 탭 진입 → "..." → "Mass Properties" → Volume 확인.
3. Measure 도구 → 3D distance 로 대표 길이.
4. Face count 등 트리 조작이 어려우므로 §4.2 의 3 측정 중 face count
   는 BBox 1 변 측정으로 대체 가능.

---

## 9. 매트릭스 raw 데이터 (CSV-ready)

결과 입력은 다음 CSV 와 동일한 column 으로 마크다운 표를 채워도
되고, 별도 CSV 파일을 작성해도 된다.

```csv
fixture,viewer,verdict,measured_volume_mm3,measured_keylen_mm,measured_keylen_target_mm,face_count,tag,screenshot_path,note
F01,V1,,,,50.00,,,,
F01,V2,,,,50.00,,,,
F01,V3,,,,50.00,,,,
F01,V4,,,,50.00,,,,
F01,V5,,,,50.00,,,,
F02,V1,,,,40.00,,,,
F02,V2,,,,40.00,,,,
F02,V3,,,,40.00,,,,
F02,V4,,,,40.00,,,,
F02,V5,,,,40.00,,,,
...
F20,V5,,,,30.00,,,,
```

> 100 row 의 raw CSV 는 매트릭스 실행자가 채워서 `~/wave1-roundtrip/
> <date>/matrix.csv` 로 저장. §3 의 마크다운 표는 CSV 의 `verdict`
> column 을 그대로 옮기면 된다.

---

## 10. 매트릭스 실행 전 sanity check (실행자 self-test)

매트릭스를 시작하기 전에 아래 3 가지를 먼저 확인한다. 하나라도
실패하면 매트릭스는 무효 — 환경부터 고치고 다시 시작.

1. **Smoke test:** F01 (cube-50) 만 export → V4 (FreeCAD) 에서 import.
   Volume 이 125,000 ±0.5 mm³ 안에 들어와야 한다. 안 들어오면 export
   pipeline 자체가 broken 상태이므로 매트릭스 의미 없음.
2. **Gating 정합성:** F03 (sphere) export 버튼이 disabled 여부 — 현재
   step-export-gating.md 정책상 sphere 는 OCCT handle 없이는 export
   안 됨. Wave 1 PR 이 이 동작을 바꿨는지 (Route A 머지 여부) 와
   일관되어야 한다.
3. **Build 동기화:** 5 viewer 각각에서 import 직전에 Shape Generator
   `?build=` SHA 확인 → 모두 동일. 매트릭스 도중 hot deploy 가
   발생하면 진행 중단.

상기 sanity check 까지 통과하면 비로소 §3 의 100 cell 을 채우러 들어
간다.
