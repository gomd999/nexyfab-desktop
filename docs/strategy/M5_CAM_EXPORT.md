# M5 — CAM 라이트·STEP·공구 기준 (v0 출하 정책)

**상위:** [M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md).

Nexyfab **M5 CAM 라이트**는 외부 CAM 대신 **앱 내부 메시**에서 바로 툴패스를 생성하는 경로다. STEP과의 관계·공구·G-code 정책을 문서화해 롤링 완료 조건을 만족한다.

## 1. 기하 입력: 메시 vs STEP

| 구분 | 역할 |
|------|------|
| **CAM 라이트 (`camLite.ts`)** | `THREE.BufferGeometry`(삼각 메시)를 입력으로 **waterline 스타일** 슬라이스 후 폴리라인 툴패스 생성. |
| **STEP보내기** | `ShapeGeneratorInner`의 STEP 파이프(리본/보내기)로 **B-rep 교환용** 파일 생성. 외부 CAM(마스터캠, Fusion 등)으로 넘길 때 사용. |

**정책(v0):** 앱 내 **CAM 라이트는 STEP을 직접 읽지 않는다.** STEP은 **설계 교환·외부 가공**용이고, 앱 안 가공 미리보기는 **현재 뷰포트 메시**가 단일 소스다.

## 2. 공구·가공 프리셋 (기본값)

`CAMOperation` 필드(`analysis/camLite.ts`)가 공구·절삭 조건의 계약이다.

| 필드 | 단위 | v0 기본 권장(스모크와 동일 계열) |
|------|------|----------------------------------|
| `type` | — | `face_mill` · `contour` · `pocket` · `drill` |
| `toolDiameter` | mm | 예: **8** (소형 박스 피니시) |
| `stepover` | 툴 지름 대비 % | 예: **45** |
| `stepdown` | mm/패스 | 예: **3** |
| `feedRate` | mm/min | 예: **600** |
| `spindleSpeed` | RPM | 예: **2400** |

**출하 정책:** 제품 UI에서 CAM을 처음 열 때 위와 **동일 오더 오브 매그니튜드**의 프리셋을 쓰거나, 사용자 저장 프리셋으로 덮어쓴다. 회귀 테스트 `m5BridgeSmoke.test.ts`는 `face_mill` + 위 수치로 **LinuxCNC** 방언 G-code가 생성되는지 검증한다.

## 3. G-code·포스트프로세서

- **엔진:** `analysis/gcodeEmitter.ts`의 `toGcode(camResult, operation, options)`.
- **좌표:** mm, 절대 좌표, XY 평면; Three.js **Y-up** 메시를 출력 시 **기계 축(X,Y,Z)** 로 매핑한다(파일 상단 주석 참고).
- **포스트:** `analysis/postProcessors/*` — `linuxcnc` · `fanuc` · `mazak` · `haas`. 기본값은 **`linuxcnc`**.
- **확장자:** `toGcode` 반환의 `fileExtension`을 따른다(방언별 권장 확장자).

**정책(v0):** 기본보내기는 **LinuxCNC** 호환을 1순위로 두고, 다른 제어기는 사용자가 명시적으로 선택한다.

## 4. 검증 체크리스트(수동)

- 컨트롤러별 `.nc`를 시뮬레이터 또는 실기에서 **1회 이상** 확인([M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md)).
- STEP으로 넘긴 뒤 외부 CAM에서 **공구 직경·스텝다운**을 이 문서 프리셋과 맞추는지 확인한다.

## 5. 코드 맵

| 항목 | 파일 |
|------|------|
| 툴패스 | `analysis/camLite.ts` — `generateCAMToolpaths` |
| G-code | `analysis/gcodeEmitter.ts` — `toGcode` |
| 포스트 | `analysis/postProcessors/` |
