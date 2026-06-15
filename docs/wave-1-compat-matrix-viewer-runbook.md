# Wave 1 GA — STEP Roundtrip 매트릭스 Viewer Runbook

**Status:** runbook (manual execution — 사람이 각 viewer UI 에서 import / 측정 / 판정)
**Spec:** `docs/wave-1-compat-matrix.md` (20 fixture × 5 viewer = 100 cell)
**Closes:** ADR-009 §3 gate #3 — STEP roundtrip 호환성 검증
**Budget:** 100 cell × ≈ 3 분 + 측정 = **1.5 시간 × 5 명 분담** 또는 **6 ~ 7 시간 × 1 명**
**Pass criterion:** ≥ 70 cell `✓` (denominator 의 70%, denominator ≥ 85)

이 문서는 `wave-1-compat-matrix.md` 의 §4 (walk-through) 와 §8 (import recipe) 을
**실행자 입장에서 한 번에 따라가는** 절차서다. 매트릭스 spec 은 **무엇을** 측정할
지를 정의하고, 본 runbook 은 **어디서 / 어떻게** 측정할지를 정의한다. 둘 다
필요하다 — spec 만 보면 viewer 메뉴를 헤매고, runbook 만 보면 판정 기준을
잘못 잡는다.

매트릭스 실행자는 본 runbook 을 **단일 viewer 담당자 1 명당 1 본** 옆에 두고
진행한다. 5 명 분담 시 각자는 자신이 맡은 viewer 의 §1~§5 중 하나만 깊게
보면 된다.

---

## 0. Pre-flight (매트릭스 시작 전 1 회, ≤ 30 분)

매트릭스 시작 직전에 아래를 모두 통과시킨다. 하나라도 실패하면 **시작하지
않는다** — 결과 reproducibility 가 깨진다.

### 0.1 Build / deploy 동기화

- [ ] Wave 1 PR 머지 완료 + worker 배포 완료 확인.
- [ ] 5 viewer 작업자 5 명이 모두 동일한 build SHA 를 보고 있는지 확인:
      `https://nexyfab.com/shape-generator` → DevTools console → `window.__build`
      또는 page footer → SHA 일치.
- [ ] 매트릭스 실행 시작 시각부터 종료까지 **main 머지 freeze**. Slack
      `#nexyfab-eng` 에 "matrix run start <YYYY-MM-DD HH:MM>, no merge until done"
      한 줄 공지.

### 0.2 Viewer 버전 lock (§1 표에 직접 기록)

각 viewer 작업자는 **자기 담당 viewer 의 버전 문자열을** 결과 보고서
§6.0 에 그대로 적는다 (예: Onshape "release 2026-05-28", Fusion 360
"2026.5.0.123"). 매트릭스 도중 viewer 가 자동 업데이트되면 **그 row 부터
다시** 시작.

| Slot | Viewer | 버전 lock 방법 |
|---|---|---|
| V1 | Onshape (web) | 우상단 계정 아이콘 → About → release date |
| V2 | Fusion 360 | Help → About Fusion 360 → "Version X.Y.Z" |
| V3 | SolidWorks | Help → About SolidWorks → "SOLIDWORKS 2026 SP3" |
| V4 | FreeCAD | Help → About FreeCAD → "1.0.x build XXXX" |
| V5 | Onshape Mobile | 앱 설정 → About → 빌드 번호 |

### 0.3 결과 폴더 + 매트릭스 사본

```bash
# 매트릭스 실행자 한 명이 1 회만 수행
mkdir -p ~/wave1-roundtrip/$(date +%Y-%m-%d)
cd ~/wave1-roundtrip/$(date +%Y-%m-%d)

# fixture 별 폴더 (F01 ~ F20)
for i in $(seq -w 1 20); do mkdir -p F$i; done

# 매트릭스 spec + 본 runbook 사본
cp /path/to/nexyfab.com/new/docs/wave-1-compat-matrix.md ./matrix.md
cp /path/to/nexyfab.com/new/docs/wave-1-compat-matrix-viewer-runbook.md ./runbook.md

# raw CSV 템플릿 (spec §9 그대로)
touch matrix.csv
```

폴더 구조 결과:

```
~/wave1-roundtrip/2026-MM-DD/
├── matrix.md             # spec (원본 사본, cell 채워서 보고)
├── runbook.md            # 본 문서 사본
├── matrix.csv            # raw 100 row CSV
├── F01/
│   ├── F01.step          # Shape Generator export 결과
│   ├── V1-onshape.png    # V1 측정값 보이는 캡처
│   ├── V2-fusion.png
│   ├── V3-solidworks.png
│   ├── V4-freecad.png
│   └── V5-mobile.png
├── F02/
│   └── ...
└── F20/
    └── ...
```

### 0.4 Smoke test (실행자 self-test, spec §10 참조)

- [ ] **F01 cube-50** export → V4 (FreeCAD) import → Volume = 125,000 ±0.5 mm³.
      통과 못 하면 export pipeline 자체가 broken → 매트릭스 중단, 엔지니어링
      에스컬레이션.
- [ ] **F03 sphere-r25** export 버튼 disabled 여부 확인 → step-export-gating
      정책과 일관해야 함.
- [ ] 5 viewer 모두 띄워두기. SolidWorks/Fusion 은 cold start 가 1 분 이상
      걸리므로 미리 띄워두면 매트릭스 본 절차에서 시간 절약.

### 0.5 분담 결정 (5 명 분담 시)

| 담당자 | Viewer | 본 runbook 섹션 |
|---|---|---|
| A | V1 Onshape (web) | §1 |
| B | V2 Fusion 360 | §2 |
| C | V3 SolidWorks | §3 |
| D | V4 FreeCAD | §4 |
| E | V5 Onshape Mobile | §5 |

5 명 모두 동일한 20 개 STEP 파일 (`F01.step` ~ `F20.step`) 을 공유 폴더에서
받아 시작한다. 즉 fixture 생성 + export 는 **1 명이 1 회** 수행 (≈ 30 분),
이후 5 명이 병렬로 20 row × 1 viewer 씩 진행 (≈ 1 시간).

---

## 1. V1 — Onshape (web)

### 1.1 사전 세팅

1. document.onshape.com 로그인 (Free 플랜으로 충분).
2. 좌상단 "Create" → "Document" → 이름 `wave1-roundtrip-<date>` → "Public" 선택.
3. 빈 Part Studio tab 이 열린 상태로 시작.

### 1.2 한 fixture 당 절차 (≤ 3 분)

1. **Import**
   - 좌측 하단 "+" 아이콘 → "Import" → 결과 폴더의 `F##.step` 선택.
   - Import dialog:
     - "Import as a Part Studio" 선택 (Assembly 아님).
     - **"Translate to Onshape format" 체크박스 ON** ← 끄면 mesh-only 로
       들어와 measure 불가, 자동 `⚠️` 처리.
     - "Combine into single part" 는 fixture 의 의도에 따라 — F06/F10 (union)
       은 ON, 그 외는 OFF.
   - 새 tab 으로 열림. tab 이름은 `F##` 로 변경.

2. **시각 확인**
   - 화면에 모델이 보이지 않거나 import dialog 가 error 를 띄우면 → `✗`,
     dialog 캡처 후 다음 fixture.
   - Feature tree (좌측) 에 "Imported" 노드가 생기면 정상.

3. **측정 위치**
   | 측정 | 위치 |
   |---|---|
   | Volume | 우측 toolbar "Mass properties" 아이콘 (저울 모양) 클릭 → 우측 패널 "Volume" |
   | 대표 길이 | 단축키 `M` → "Measure" 도구 → 두 face/edge 선택 → 화면 하단에 distance |
   | Face count | feature tree 의 "Imported" 노드 펴기 → child face 개수 또는 part 우클릭 → "Properties" → "Surface area" 와 함께 표시 |

4. **판정** (§7 기준)
   - 3 측정 모두 spec §2 tolerance 안 + 시각적 artifact 없음 → `✓`
   - 열렸으나 1 개 이상 측정 tolerance 밖 / mesh-only / face 누락 → `⚠️`
   - Import 실패 / 빈 part → `✗`

5. **스크린샷**
   - 우측 "Mass properties" panel + 모델 함께 보이게 화면 캡처.
   - `~/wave1-roundtrip/<date>/F##/V1-onshape.png` 저장.

6. **Tab 정리**: 이 fixture tab 은 닫지 않고 둔다 (V5 모바일에서 재사용).
   대신 다음 fixture 용 새 Part Studio tab 을 추가하고 다시 Import.

### 1.3 V1 특이사항

- **"Translate" 옵션을 끄면** Onshape 가 STEP 을 mesh 로만 받아들여서
  measure 도구가 거의 동작하지 않는다. 의심되면 part 우클릭 → "Properties"
  → "Body type" 이 "Mesh" 면 다시 import.
- **무료 Public document 제약**: 한 document 에 part 수 limit 이 있으므로,
  10 fixture 이후 새 document 를 만들거나 part 를 일부 삭제한다.
- **단위 mismatch**: Onshape 기본 단위가 mm 가 아니면 setting → unit → mm
  로 변경 (한 번만).

---

## 2. V2 — Fusion 360 (desktop)

### 2.1 사전 세팅

1. Fusion 360 desktop 실행, 로그인.
2. 좌측 "Data Panel" → "New Project" → 이름 `wave1-roundtrip-<date>`.
3. 새 빈 design tab 열어두기.
4. **단위 mm 확인**: 우하단 단위 표시 클릭 → "Change Active Units" → mm.

### 2.2 한 fixture 당 절차 (≤ 3 분)

1. **Import**
   - 좌측 Data Panel → "Upload" 버튼 → `F##.step` 선택 → "Upload".
   - **Cloud translation 대기**: 보통 30 초 ~ 2 분. translation 실패 (빨간 X
     아이콘) 는 그 자체로 `✗`.
   - 대안: "Insert → Insert Mesh" 가 아니라 **"Insert → Insert Derive"** 또는
     "File → Open" 으로 STEP 을 직접 열어도 OK. 단, 절차 일관성을 위해
     본 runbook 은 Upload 경로로 고정.
   - Upload 완료 후 Data Panel 에서 더블클릭 → 새 tab 에서 열림.
   - **"Don't capture design history"** 묻는 dialog 가 뜨면 → **Yes** (history
     capture 끔 — feature 변환 대신 B-rep 그대로 받는다).

2. **시각 확인**
   - Browser tree 좌상단 "Bodies" 노드에 part 가 들어와 있어야 함.
   - 화면이 비어있고 tree 도 비어있으면 → `✗`.

3. **측정 위치**
   | 측정 | 위치 |
   |---|---|
   | Volume | Browser tree 의 body 우클릭 → "Properties" → "Volume" |
   | 대표 길이 | 상단 "Inspect" 메뉴 → "Measure" → 두 face/edge 선택 → 화면 하단 |
   | Face count | body 우클릭 → "Properties" → "Surface count" (정식 명칭은 viewer 버전마다 다소 다름) |

4. **판정**: V1 §1.2 step 4 와 동일.

5. **스크린샷**
   - Properties dialog (Volume 보이게) + 모델 함께 캡처.
   - `~/wave1-roundtrip/<date>/F##/V2-fusion.png` 저장.

6. **Design 정리**: 측정 끝나면 design tab 을 그대로 닫는다 (cloud 에 자동
   저장되므로 디스크 점유 걱정 없음). 다음 fixture 는 새 Upload.

### 2.3 V2 특이사항

- **Cloud translation 큐**: Autodesk 백엔드 부하에 따라 translation 이 5
  분 이상 걸릴 수 있다. 측정 시간을 초과하면 다음 fixture 로 넘어가고,
  나중에 그 fixture 만 batch 로 재방문.
- **"Capture Design History" ON 으로 들어왔다면** feature 가 자동 변환되어
  B-rep 검증 의미가 없어진다. 무조건 OFF 로 받는다.
- **단위 inch 로 들어오는 경우**: STEP 헤더의 unit 정보를 Fusion 이 무시한
  것. design unit 설정을 mm 로 바꿔도 part 가 변환되지 않으므로, 그 fixture
  는 `⚠️` 로 표시 + 캡처.

---

## 3. V3 — SolidWorks (desktop)

### 3.1 사전 세팅

1. SolidWorks 2026 실행 (30-day eval 라이선스 활성).
2. Tools → Options → "Document Properties" → Units → MMGS (mm, gram, second).
   기본 template 으로 저장.
3. 새 빈 part 문서를 열어두지 않는다 (STEP 을 직접 열기 때문).

### 3.2 한 fixture 당 절차 (≤ 3 분)

1. **Import**
   - File → Open → 파일 타입을 "STEP AP203/214/242 (*.step;*.stp)" 로 변경
     → `F##.step` 선택.
   - Dialog: **"Import as Part"** 선택 (Assembly 아님).
   - "Options" 버튼 → Import Options 확인:
     - "Run Import Diagnostics" 체크 ON.
     - **"Surface/solid entities"** = "BREP body".
     - **"Feature conversion"** = OFF (또는 "Do not run feature recognition").
       feature 변환을 켜면 STEP 의 B-rep 이 SolidWorks feature tree 로
       재해석되어, viewer 호환성 검증 의미가 사라진다.
   - "Open" → 변환 진행 (5 ~ 30 초).
   - Import Diagnostics dialog 가 뜨면:
     - "0 faulty faces, 0 gaps" → 그대로 close.
     - faulty face/gap > 0 → **`⚠️`** 후보, 메시지 캡처.

2. **시각 확인**
   - FeatureManager (좌측) 에 "Imported1" feature 가 보임.
   - graphics area 에 part 가 보이고 회전 가능해야 함.

3. **측정 위치**
   | 측정 | 위치 |
   |---|---|
   | Volume | Tools → "Mass Properties" 또는 단축키 **Ctrl+B** → dialog 의 "Volume" |
   | 대표 길이 | Tools → "Measure" → 두 entity 선택 → "Distance" |
   | Face count | Mass Properties dialog 의 "Surface area" 와 함께 표시되거나, FeatureManager 의 "Imported1" feature 펴서 face 개수 |

4. **판정**: V1 §1.2 step 4 와 동일.
   - 추가 caveat: Import Diagnostics 가 faulty face 를 보고했으면 측정값이
     tolerance 안에 있어도 `⚠️` (B-rep 손상 단서 — `P-FACE-LABEL`).

5. **스크린샷**
   - Mass Properties dialog + 모델 함께 캡처.
   - `~/wave1-roundtrip/<date>/F##/V3-solidworks.png` 저장.

6. **정리**: File → Close → "Save changes?" → No (저장 불필요).

### 3.3 V3 특이사항

- **Eval 라이선스 만료**: 30 일 후 SolidWorks 가 read-only 로 빠지면
  Measure / Mass Properties 가 일부 disabled 된다. 매트릭스는 라이선스 활성
  창 안에서 마쳐야 한다.
- **"Open as Assembly" 로 잘못 열면**: 매트릭스 spec 상 single body 가
  multi-body 로 들어오므로 자동 `⚠️` 가 되기 쉽다. 반드시 "Part" 로 다시 open.
- **AP242 한정 거부**: SolidWorks 가 일부 AP242 변형을 거부하는 사례가
  알려져 있다. 같은 fixture 가 다른 viewer 에서는 `✓`, V3 에서만 `✗` 면
  `P-IMPORT-PARASOLID` tag.

---

## 4. V4 — FreeCAD

### 4.1 사전 세팅

1. FreeCAD 1.0.x stable 실행.
2. Edit → Preferences → "Import-Export" → "STEP" → "Unit" = "Millimetre".
3. Edit → Preferences → "Import-Export" → "STEP" → "Read" 탭 → "Mode" =
   "Single document, single part" (default 로 충분, 다중 part STEP 은 본
   매트릭스에 없음).
4. View → Panels → "Report view" 패널 켜기 (OCCT 경고 캡처용).

### 4.2 한 fixture 당 절차 (≤ 3 분)

1. **Import**
   - File → Open (또는 File → Import) → `F##.step` 선택.
   - 변환 진행 (1 ~ 10 초 — FreeCAD 가 OCCT 위에 직접 import 하므로 보통
     viewer 중 가장 빠름).
   - Report view 패널에 경고 출력 시 캡처. 흔한 경고:
     - "Surface tolerance exceeds shape tolerance" → 무시 가능 (`✓` 가능)
     - "Cannot read shape" → `✗`

2. **시각 확인**
   - Tree view (좌측) 에 import 한 part 가 들어와 있어야 함.
   - 화면이 비어있으면 단축키 **0** (Fit all) 로 줌 맞추기. 그래도 비어있으면 `✗`.

3. **측정 위치**
   | 측정 | 위치 |
   |---|---|
   | Volume | Tree 에서 part 선택 → 우측 "Data" tab → "Shape" 항목 펴기 → "Volume" |
   | 대표 길이 | "Part" workbench 로 전환 → "Measure" → "Measure linear" → 두 vertex/edge 선택 |
   | Face count | "Data" tab → "Shape" 항목 → "Faces" 또는 part 우클릭 → "Shape info" |

4. **판정**: V1 §1.2 step 4 와 동일.

5. **스크린샷**
   - Data tab 의 Volume 값 + 모델 함께 캡처.
   - `~/wave1-roundtrip/<date>/F##/V4-freecad.png` 저장.

6. **정리**: File → Close → "Save changes?" → No. Report view 의 경고는
   복사해서 fixture 폴더 `V4-report.txt` 로 별도 저장 (P-PRECISION 분석에
   유용).

### 4.3 V4 특이사항

- **FreeCAD 가 OCCT 7.8 기반**이므로 우리 export pipeline 의 OCCT 와 동일
  kernel 이다. V4 에서 `✗` 가 나오면 그 fixture 는 본질적으로 우리 export
  자체가 broken — `P-EMIT-AP242` 우선 의심.
- **느린 startup**: cold start 가 5 ~ 10 초. 매트릭스 시작 시 한 번만 열고
  fixture 마다 File → Close 만 반복하면 빠르다.
- **OCCT 경고 다발**: tolerance 경고는 흔하나 측정값이 spec tolerance 안에
  있으면 `✓` 그대로. 경고는 P-PRECISION 단서로 캡처만.
- **B-rep face label 손실**: FreeCAD 의 "Shape" → "Faces" 가 spec §2 의
  predicted face 수와 다르면 `P-FACE-LABEL` 후보 → `⚠️`.

---

## 5. V5 — Onshape Mobile (iOS / Android)

### 5.1 사전 세팅

1. Onshape mobile 앱 설치 (App Store / Play Store) → V1 과 동일 계정
   로그인.
2. **Tablet 권장** — phone 화면에서는 measure tool 정밀도가 떨어진다.
3. V1 에서 만든 `wave1-roundtrip-<date>` document 가 이미 보이는지 확인
   (= V1 결과 재사용 가능).

### 5.2 한 fixture 당 절차 (≤ 3 분)

1. **Import (두 경로 중 택 1)**
   - **경로 A (권장, V1 결과 재사용)**: V1 에서 import 한 동일 document
     의 `F##` tab 을 모바일 앱에서 그대로 열기. 별도 STEP upload 불필요 →
     mobile 의 mesh 한계만 검증하는 데 집중할 수 있다.
   - **경로 B (독립 검증)**: 앱 우상단 "+" → "Import file" → 클라우드
     스토리지 (Files, Drive) 에서 `F##.step` 선택 → 새 document 로 import.

2. **시각 확인**
   - Part Studio tab 에 모델이 보이고 회전/pinch-zoom 가능해야 함.
   - 빈 화면이면 → `✗` (단, 경로 A 에서 V1 이 `✓` 였다면 모바일 렌더링
     문제이지 import 실패가 아님 → `⚠️`).

3. **측정 위치**
   | 측정 | 위치 | 모바일 제약 |
   |---|---|---|
   | Volume | Part 탭 진입 → 상단 "..." (more) → "Mass Properties" → "Volume" | 데스크톱과 동일하게 표시 |
   | 대표 길이 | 하단 toolbar "Measure" 아이콘 → 두 entity 탭 → distance | **3D distance only** — face-to-face / edge angle 등 일부 측정 불가 |
   | Face count | Part 우클릭(long-press) → "Properties" → "Faces" | 일부 빌드에서는 face count 표시 안 됨 → BBox 1 변 측정으로 **대체** 가능 |

4. **판정**
   - V1 §1.2 step 4 와 동일하되, **모바일 한계로 측정 자체가 불가능한
     경우는 `⚠️`** (즉 viewer 호환성은 OK 인데 도구가 모자란 경우는
     `✗` 가 아니라 `⚠️`). 대신 §8 의 `P-MOBILE` tag 부착.

5. **스크린샷**
   - 태블릿 OS 의 스크린샷 (iPad: 전원+볼륨업, Android: 전원+볼륨다운).
   - PC 로 전송 → `~/wave1-roundtrip/<date>/F##/V5-mobile.png` 저장.

### 5.3 V5 특이사항

- **Mobile mesh fallback**: 모바일은 일부 복잡한 B-rep 을 자동으로 mesh
  로 다운샘플한다. F12 (12 fillet edge) / F18 (revolve) / F20 (12 hole
  pattern) 에서 자주 발생 → 데스크톱 V1 은 `✓` 인데 V5 만 `⚠️` 인 패턴
  흔함.
- **Face count 측정 불가**: Onshape 모바일 일부 빌드는 face count 를
  드러내지 않는다. 이 경우 BBox 1 변 측정으로 대체하고 그 사실을 note 에
  기록.
- **저전력 모드**: 태블릿 저전력 모드가 켜져 있으면 렌더링이 끊겨 측정
  정확도가 떨어진다. 매트릭스 진행 동안은 끄기.
- **`P-MOBILE` 만 다발인 경우** spec §5.3 의 가이드대로 V5 를 gate
  denominator 에서 제외하는 ADR-009 amendment 를 별도 제안. V5 의 `⚠️`
  를 다른 viewer 의 `✗` 와 동급으로 다루지 말 것.

---

## 6. Fixture-by-fixture 측정 표

> §1~§5 가 viewer 별 절차라면, §6 은 **각 fixture 에서 무엇을 어디까지
> 측정하면 충분한지** 의 cheat sheet. 한 fixture 검증이 3 분을 넘으면
> 거의 항상 본 표보다 더 측정하고 있는 것 — 멈추고 본 표 기준으로 컷.

각 행: fixture ID / Volume target / 대표 길이 1 개 / 예상 face count /
viewer 별 측정값을 적을 빈 칸 5 개.

| Fixture | Vol target (mm³) | 대표 길이 target (mm) | Face | V1 측정 | V2 측정 | V3 측정 | V4 측정 | V5 측정 |
|---|---|---|---|---|---|---|---|---|
| F01 cube-50 | 125,000 ±0.05% | 변 = 50.00 ±0.02 | 6 |   |   |   |   |   |
| F02 cylinder-d40-h60 | 75,398 ±0.5% | D = 40.00 ±0.05 | 3 |   |   |   |   |   |
| F03 sphere-r25 | 65,449 ±1% | R = 25.0 ±0.10 | 1 (B-rep) |   |   |   |   |   |
| F04 box-with-hole-M8 | 23,497 ±0.1% | D_hole = 8.0 ±0.05 | 7 |   |   |   |   |   |
| F05 L-bracket | 20,000 ±0.1% | 폭 = 60.00 ±0.05 | 8 |   |   |   |   |   |
| F06 bool-union-cube-cyl | 30,141 ±0.5% | cube 변 = 30.00 ±0.05 | 5 |   |   |   |   |   |
| F07 bool-subtract-pocket | 84,000 ±0.1% | 깊이 = 10.0 ±0.05 | 10 |   |   |   |   |   |
| F08 bool-intersect-cyl-cube | 98,175 ±1% | D = 50.0 ±0.10 | 3 |   |   |   |   |   |
| F09 bool-multi-tool-subtract | 95,288 ±0.1% | hole D = 10.0 ±0.05 | 12 |   |   |   |   |   |
| F10 bool-tee-union | 43,982 ±1% | D = 20.0 ±0.05 | 4 |   |   |   |   |   |
| F11 fillet-cube-1edge-r5 | 63,786 ±0.1% | R_fillet = 5.0 ±0.01 | 7 |   |   |   |   |   |
| F12 fillet-cube-allvert-r3 | ≈ 122,500 (predicted) | R = 3.0 ±0.01 | many |   |   |   |   |   |
| F13 chamfer-cube-4topedge | 62,000 ±0.1% | 폭 = 5.0 ±0.02 | 10 |   |   |   |   |   |
| F14 fillet-different-radii | (Shape Gen 측정) | top R = 3.0 / bot R = 8.0 | many |   |   |   |   |   |
| F15 fillet-on-boolean | (Shape Gen 측정) | R = 2.0 ±0.01 | many |   |   |   |   |   |
| F16 extrude-simple-rect | 60,000 ±0.1% | 변 = 60.00 ±0.02 | 6 |   |   |   |   |   |
| F17 extrude-circle-with-hole | 56,549 ±0.5% | OD = 80 ±0.05 / ID = 40 ±0.05 | 4 |   |   |   |   |   |
| F18 revolve-profile-bowl | (Shape Gen 측정) | top OD = 100 ±0.10 | 4-8 |   |   |   |   |   |
| F19 linear-pattern-holes | 77,455 ±0.1% | hole pitch = 20.00 ±0.02 | 26 |   |   |   |   |   |
| F20 circular-pattern-+-mirror | 94,500 ±0.1% | hole pitch = 60.0° ±0.1 | 27 |   |   |   |   |   |

> `(Shape Gen 측정)` = Shape Generator UI 의 자체 Measure panel 값을
> predicted 로 사용. 즉 fixture export 직후 그 값을 본 표에 먼저 채우고,
> 그 다음 viewer 측정값을 비교.

각 viewer 측정 칸에는 **숫자만** 적는다 (단위는 표 헤더에 있음). 측정
불가는 `n/a`, 측정값이 tolerance 밖이면 숫자 뒤에 `*` 표시.

---

## 7. ✓ / ⚠ / ✗ 판정 기준 (재정의)

> spec §3 cell 표 기준을 본 runbook 실행자 입장에서 한 번 더 명시.
> 두 문서 사이에 충돌이 있다면 **spec 이 우선**, 본 §7 은 빠른 참조용.

### `✓` — Pass

다음을 **모두** 만족:

1. STEP import dialog 가 error 없이 닫힘 (warning 은 무방).
2. 모델이 화면에 보이고 회전 가능.
3. §6 의 Volume / 대표 길이 / face count 3 측정이 모두 spec §2 의
   tolerance 안.
4. 시각적 artifact (구멍, 깨진 face, mesh patch 자국, mis-oriented normal
   로 인한 검은 면) 없음.

### `⚠` — Partial / caveat

다음 중 **하나라도** 해당:

1. Import 는 성공했으나 측정 1 개 이상이 tolerance 밖.
2. B-rep 이 들어와야 할 fixture 가 mesh 로 들어옴.
3. Face count 가 §2 predicted 와 다름 (face label 손실 단서).
4. 시각적 artifact 가 있으나 전체 토폴로지는 인식 가능.
5. V5 mobile 에서 측정 도구 제약으로 1 개 이상 측정 불가 (이 경우 한정
   하여 `⚠` 처리, 다른 viewer 와 동일 기준 적용 시 `✗` 가 될 상황도 V5
   에서는 `⚠`).

`⚠` cell 은 spec §5.2 의 tag 1 개를 반드시 부착한다.

### `✗` — Fail

다음 중 하나:

1. Import dialog 가 error 메시지로 종료.
2. Viewer crash / hang.
3. Import 는 성공했으나 화면이 빈 part / 빈 assembly.
4. Feature tree 에 node 가 안 생김.

`✗` cell 도 spec §5.2 tag 부착 필수 (`P-EMIT-AP242` / `P-EMIT-AP214` /
`P-IMPORT-OCCT` / `P-IMPORT-PARASOLID` 중 하나).

### `—` — Out of scope

다음 한 가지에 해당:

1. Shape Generator UI 에서 export 버튼이 **gating 으로 disabled** (예: F03
   sphere 가 OCCT handle 미구현으로 export 불가) — 5 cell 모두 `—`.
2. Fixture op 자체가 production 미반영 (예: F18 revolve, F19/F20 pattern
   이 Wave 2 deferral) — 5 cell 모두 `—`.

`—` 는 pass_rate denominator 에서 제외. spec §5.1 의 두 번째 조건
(denominator ≥ 85) 위반 시 gate 무효.

---

## 8. 결과 종합 → `matrix.md` 셀 채우기 절차

5 명 분담 종료 후 한 명 (gate keeper) 이 1 시간 내 종합한다.

### 8.1 raw CSV 종합 (≤ 20 분)

1. 5 viewer 담당자 각자가 자기 20 row 의 verdict + 측정값을 공유 폴더의
   `matrix.csv` 에 채워 넣는다 (spec §9 의 column 그대로):
   ```
   fixture,viewer,verdict,measured_volume_mm3,measured_keylen_mm,measured_keylen_target_mm,face_count,tag,screenshot_path,note
   F01,V1,✓,125001.2,49.99,50.00,6,,F01/V1-onshape.png,
   F01,V2,✓,125000.5,50.00,50.00,6,,F01/V2-fusion.png,
   ...
   ```
2. Gate keeper 가 100 row 모두 채워졌는지 확인. 빈 cell 이 있으면 해당
   담당자에게 즉시 재실행 요청 — 빈 cell 을 `✗` 로 처리하지 말 것 (false
   negative 위험).

### 8.2 `matrix.md` §3 표 cell 기입 (≤ 10 분)

CSV `verdict` column 을 spec §3 의 마크다운 표에 그대로 복사:

```
F01 cube-50 | ✓ | ✓ | ✓ | ✓ | ⚠️
F02 cylinder-d40-h60 | ✓ | ✓ | ✗ | ✓ | ⚠️
...
```

5 cell 모두 `—` 인 row 는 row 자체를 회색 처리 (마크다운에서는 italic 또는
"out of scope" 한 줄 추가).

### 8.3 Tally + pass rate 계산 (≤ 5 분)

```
denominator = 100 − (`—` cell 수)
numerator   = ✓ cell 수
pass_rate   = numerator / denominator
```

`matrix.md` §3 표 아래의 합계 줄에 입력:
```
**합계:** ✓ 73 / ⚠️ 18 / ✗ 7 / — 2  (= 73 / 98 = 74.5% pass)
```

### 8.4 Failure breakdown 작성 (≤ 20 분)

CSV 에서 `verdict in (⚠, ✗)` 인 row 만 추출, `tag` column 으로 group by:

| Cell | Tag | Note |
|---|---|---|
| F03.V1 | P-MESH-ONLY | sphere 가 1024 tri mesh 로 들어옴 |
| F03.V3 | P-IMPORT-PARASOLID | "Cannot read shape" dialog |
| F10.V4 | P-IMPORT-OCCT | T 교차 edge evaluate 깨짐 |
| ... | ... | ... |

이 표를 `matrix.md` 의 §6.3 (또는 별도 `wave-1-compat-matrix-result-<date>.md`)
에 추가.

### 8.5 Gate verdict 기록 (≤ 5 분)

spec §5.1 기준:
- `pass_rate ≥ 0.70` AND `denominator ≥ 85` → **PASS**
- 둘 중 하나라도 실패 → **FAIL** + spec §5.3 의 다음 단계 가이드 적용.

`matrix.md` §6.2 의 "**Gate verdict:** PASS / FAIL" 줄을 확정.

### 8.6 Memory + 보고

- Memory entry `project_nexyfab_3d_burnin.md` 에 한 줄 추가:
  ```
  2026-MM-DD Wave1 roundtrip matrix: 74.5% pass (73/98), gate PASS
  ```
- Slack `#nexyfab-eng` 에 gate verdict + pass rate + 상위 3 개 failure tag
  공지.
- gate PASS 면 ADR-009 §3 gate #3 closed → Wave 1 GA 다음 단계 진입.
- gate FAIL 면 spec §5.3 의 우선 수정 가이드에 따라 backlog 생성.

---

## 9. 자주 만나는 viewer-specific 이슈 + workaround

> spec §4.3 의 quirk 표를 본 runbook 실행자 입장에서 해결 절차까지 함께
> 정리. 매트릭스 실행 도중 hit 한 이슈는 본 §9 에 한 줄 추가하여 다음
> 매트릭스 실행자가 시간을 줄일 수 있게 한다.

### 9.1 V1 Onshape

| 증상 | 원인 | Workaround |
|---|---|---|
| Import 후 part 가 grey mesh 로만 보임, measure 안 됨 | "Translate to Onshape format" 옵션이 OFF 였음 | Re-import, 옵션 ON. 그래도 mesh 면 → `⚠️` + `P-MESH-ONLY` |
| Mass Properties 가 Volume 대신 "—" 표시 | mesh-only body 라서 properties 계산 불가 | Re-import 후 동일 → `⚠️` |
| Public document 의 part limit 도달 ("Too many parts") | 무료 플랜 제한 | 새 document 만들기, 이전 document 는 archive |
| 단위가 inch 로 표시됨 | document setting | Settings → Workspace → Default units → mm |

### 9.2 V2 Fusion 360

| 증상 | 원인 | Workaround |
|---|---|---|
| Upload 후 5 분 넘게 translation 안 끝남 | Autodesk cloud 큐 부하 | 다음 fixture 로 넘기고 나중에 batch 재방문. 30 분 넘으면 `✗` |
| Body 가 여러 component 로 분해됨 | Design history capture 가 ON 인 채로 들어옴 | Re-import, "Don't capture design history" → Yes |
| Properties → Volume 이 "0 mm³" | Body 가 surface (open) 로 들어옴 | `⚠️` + `P-MESH-ONLY` |
| 단위가 inch | 우하단 단위 표시 클릭 → mm | 변경 후에도 part 가 안 변하면 design 새로 만들기 |

### 9.3 V3 SolidWorks

| 증상 | 원인 | Workaround |
|---|---|---|
| Import Diagnostics 가 "X faulty faces" 보고 | B-rep 손상 | 측정값이 tolerance 안이어도 `⚠️` + `P-FACE-LABEL` |
| "Open as Assembly" dialog 가 자동 선택 | 일부 STEP 헤더에 assembly hint | 무조건 "Part" 선택 |
| Mass Properties dialog 가 Volume 대신 "Density not set" | 단위/재질 미설정 | dialog 의 "Options" → density = 1 → 다시 계산 |
| Feature 가 자동 변환되어 SCAD-like tree 가 생김 | "Feature recognition" 이 ON | Re-import with Feature conversion OFF |
| "Cannot read file" error | AP242 strict 거부 | `✗` + `P-IMPORT-PARASOLID` |

### 9.4 V4 FreeCAD

| 증상 | 원인 | Workaround |
|---|---|---|
| Report view 에 "Surface tolerance exceeds shape tolerance" 다발 | OCCT precision mismatch | 측정값이 tolerance 안이면 `✓` 그대로, 경고는 캡처만 |
| Tree 에 part 가 있으나 화면 빈 화면 | View 미조정 | 단축키 `0` (Fit all). 그래도 비면 `✗` |
| Volume 이 음수 또는 0 | Normal orientation 깨짐 | `⚠️` + `P-PRECISION`, viewer 에서 "Part → Check geometry" 실행 후 결과 캡처 |
| Sphere (F03) 가 다각형 patch 로 들어옴 | OCCT 가 spherical face 를 fragment 함 | `⚠️` + `P-MESH-ONLY` (FreeCAD 에서 흔한 패턴) |
| FreeCAD crash | 메모리 부족 또는 corrupted STEP | 재시작 후 1 회 재시도. 재현 시 `✗` |

### 9.5 V5 Onshape Mobile

| 증상 | 원인 | Workaround |
|---|---|---|
| Mass Properties 가 메뉴에 없음 | 일부 빌드에서 미노출 | Part long-press → "Show properties" → 대체 경로 |
| Measure tool 의 face-to-face 가 안 됨 | 모바일 한정 제약 | 3D distance 로 대체, note 에 기록 |
| Pinch-zoom 이 끊김 | 저전력 모드 | 끄기 |
| Face count 가 화면에 안 나옴 | 모바일 미지원 | BBox 1 변 측정으로 대체, `P-MOBILE` tag |
| 12 hole fixture (F20) 가 6 hole 로만 보임 | 모바일 LoD (level-of-detail) 가 일부 hole 생략 | zoom-in 후 재확인. 그래도 6 hole 이면 `⚠️` + `P-MOBILE` |

### 9.6 Cross-viewer

| 증상 | 원인 | Workaround |
|---|---|---|
| 같은 fixture 가 V1/V2 는 `✓`, V3/V5 는 `✗` | Parasolid kernel viewer 가 AP242 거부 | `P-IMPORT-PARASOLID` 다발 → spec §5.3 가이드대로 Route A or AP214 fast path 확장 검토 |
| F11 ~ F15 (fillet) 만 viewer 전반 `⚠️` | B-rep face label 손실 / mesh fallback | `P-FACE-LABEL` / `P-MESH-ONLY` 분포 확인 후 b1-face-provenance 작업 가속 |
| 모든 viewer 가 `✗` 인 fixture | export 자체가 broken | `P-EMIT-AP242` 또는 `P-EMIT-AP214`. 엔지니어링 즉시 에스컬레이션 (매트릭스 결과 무효) |

---

## 10. 매트릭스 종료 후 정리 (≤ 10 분)

- [ ] `~/wave1-roundtrip/<date>/` 전체를 zip → 결과 보관소 (NexyFlow drive
      또는 GitHub release artifact) 에 업로드. 100 cell 의 스크린샷은
      추후 retro / regression 검증에 핵심 증거.
- [ ] `matrix.md` §6 (Result) 섹션을 main 브랜치에 PR 로 commit. PR
      description 에 본 runbook 의 경로 + 매트릭스 실행 일자 + gate
      verdict 명시.
- [ ] Memory entry `project_nexyfab_3d_burnin.md` 갱신.
- [ ] main 머지 freeze 해제 (Slack 한 줄).
- [ ] gate PASS 시: ADR-009 §3 gate #3 closed → Wave 1 GA 다음 단계.
- [ ] gate FAIL 시: spec §5.3 의 우선 수정 항목별로 issue 생성, 다음
      매트릭스 재실행 일자 잠정 합의.

매트릭스는 1 회성이 아니다. Wave 1 GA 출시 이후 stepExporter 의 의미 있는
변경 (Route A 완성, OCCT 업그레이드, AP214 fast path 변경) 시마다 재실행한다.
본 runbook 의 §9 issue 누적은 다음 회차 매트릭스 실행 시간을 단축시키는
가장 큰 자산이다.
