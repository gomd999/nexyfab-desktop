# NexyFab 3D 툴 / CAD 스위트

> Last updated: 2026-05-06
> Scope: 브라우저 기반 파라메트릭 CAD + FEA + DFM + 토폴로지 최적화 통합 모듈

---

## 1. 진입 경로 (Routes)

| 경로 | 역할 |
|------|------|
| `/[lang]/shape-generator/page.tsx` | 메인 3D 에디터 (스케치 → 3D 모드 토글, 341KB 모놀리식) |
| `/[lang]/shape-generator/sketch/` | 서버 리다이렉트 → `/shape-generator?entry=sketch` (스케치 모드·design 워크스페이스) |
| `/[lang]/shape-generator/assembly/` | 리다이렉트 → `?entry=assembly` (design + 조립 패널) |
| `/[lang]/shape-generator/topology/` | 리다이렉트 → `?entry=topology` (`generative` 워크스페이스) |
| `/[lang]/shape-generator/analysis/` | 리다이렉트 → `?entry=analysis` (`simulation` 워크스페이스 — FEA 계열) |
| `/[lang]/shape-generator/openscad/` | 폴더명 유지 — 런타임은 **JSCAD** (`OpenScadPanel` → `jscadRunner`). OpenSCAD(.scad) CLI는 [JSCAD_OPENSCAD_BRIDGE.md](./strategy/JSCAD_OPENSCAD_BRIDGE.md) |

---

## 2. API 엔드포인트

### 2.1 DFM·기하 변환
| 엔드포인트 | 동작 |
|------------|------|
| `POST /api/nexyfab/dfm-check` | DFM 룰 엔진 실행 (anonymous + auth, `nf_dfm_check` 기록) |
| `POST /api/nexyfab/shape-to-jscad` | 3D 모델 → JSCAD 파라미터 변환 |
| `POST /api/nexyfab/jscad-gen` | 자연어·면 연산 → **JSCAD** 코드 (**권장**) |
| `POST /api/nexyfab/openscad-gen` | 위와 동일(레거시 별칭 — 클라이언트는 `jscad-gen` 사용) |
| `POST /api/nexyfab/openscad-render` | **OpenSCAD CLI** `.scad` → STL (동기/비동기); `GET .../openscad-render/job/[id]` 폴링. 다중 인스턴스 시 `REDIS_URL`로 큐 공유, 큰 메시는 `S3_BUCKET` 설정 시 `artifactUrl`, 샌드박스는 `OPENSCAD_USE_DOCKER=1` |
| `POST /api/nexyfab/brep/step-import` | **STEP** 서버 임포트(동기/비동기); `input.inlineBase64` 또는 `input.objectKey`, `GET …/brep/step-import/job/[id]`. OCCT는 `BREP_WORKER_URL` 워커(`…/tessellate`). 다중 인스턴스는 `REDIS_URL` + 키 `nf:brep:*` |
| (클라이언트) | STEP 선택 시 API 우선 → 실패 시 브라우저 WASM. 비활성: `NEXT_PUBLIC_SERVER_STEP_IMPORT=0` |
| `POST /api/nexyfab/analyze-step` | 분석 스텝 디스패치 (FEA / Modal / Thermal / Print) |

### 2.2 협업·공유
| 엔드포인트 | 동작 |
|------------|------|
| `*/api/nexyfab/comments/*` | Figma 스타일 핀 코멘트 |
| `*/api/nexyfab/share/*` | 뷰 전용 공유 링크 (IP 보호) |
| `*/api/nexyfab/share/extend/` | 만료 연장 |

---

## 3. 핵심 컴포넌트

| 파일 | 크기 | 역할 |
|------|------|------|
| `ShapePreview.tsx` | 74KB | Three.js 뷰포트 + 렌더 루프 |
| `FeatureTree.tsx` | 30KB | CAD 피처 히스토리 트리 (extrude·fillet·draft·assembly) |
| `ShapeGeneratorToolbar.tsx` | 27KB | 명령 팔레트 + 스케치/3D 모드 토글 |
| `CommandToolbar.tsx` | 54KB | 기하 작업 (pad·pocket·hole·chamfer·fillet) |
| `CommandPalette.tsx` | 14KB | 검색 + 키보드 내비 |
| `ContextMenu.tsx` | 15KB | 우클릭 기하 선택 메뉴 |
| `DimensionOverlay.tsx` | – | 파라메트릭 치수 주석 |
| `SnapAlignGuides.tsx` | – | 스케치 제약 인디케이터 |
| `MeasureTool.tsx` | 18KB | 거리·각도·반지름 측정 + 오버레이 |
| `ViewCube.tsx` | 17KB | 표준 뷰 회전 (ISO·front·top 등) |
| `MultiViewport.tsx` | – | 어셈블리·단면 분할 뷰 |

---

## 4. 기하·해석 라이브러리

### 4.1 메시 처리
- `mesh/meshProcessing.ts` — 정점·면 조작, 클린업
- `lod/meshSimplify.ts` — Quadric edge collapse (공유 링크용 폴리곤 축소)
- `extraction/featureExtraction.ts` — B-Rep 으로부터 피처(엣지·면·볼륨) 검출

### 4.2 해석 솔버 (`analysis/`)
| 모듈 | 크기 | 역할 |
|------|------|------|
| `topologyOptimization.ts` | 28KB | Generative design (응력 기반 재료 제거, SIMP) |
| `femSolver.ts` | 24KB | 선형 FEA (응력·변위·안전계수) |
| `thermalFEA.ts` | 14KB | 과도 열전달 (경계조건·온도 구배) |
| `modalAnalysis.ts` | 16KB | 고유진동수 솔버 (진동 모드) |
| `simpleFEA.ts` | – | 빠른 프리뷰용 단순 FEA |
| `printAnalysis.ts` | 21KB | FDM 프린팅 가능성 (서포트·오버행 검출) |
| `workers/feaWorker.ts` | – | 비동기 FEA 계산용 Web Worker |

### 4.3 DFM 룰 엔진
- `src/lib/dfm-rules.ts` — 10+ 보수적 룰
  - 벽 두께 (wall thickness)
  - 구멍 직경 (hole diameter)
  - 드래프트 각도 (draft angle)
  - 필렛 반경 (fillet radius)
  - 종횡비 (aspect ratio)
  - 표면 마감 (surface finish)
- 결과는 `nf_dfm_check` 테이블에 영속 (사용자 히스토리)

---

## 5. 3D 프레임워크 통합

| 라이브러리 | 사용 여부 |
|-----------|----------|
| **Three.js** | ✅ 메인 렌더러 (ShapePreview, 모든 분석 오버레이, 카메라 컨트롤) |
| Babylon.js | ❌ 미사용 |
| Spline | ❌ 미사용 |
| Replicad | ✅ STEP 출력 |
| **JSCAD (@jscad/modeling)** | ✅ 브라우저 파라메트릭 코드 CAD |
| **OpenSCAD** (`.scad` 언어) | ❌ 미내장 — CLI 브리지 [JSCAD_OPENSCAD_BRIDGE.md](./strategy/JSCAD_OPENSCAD_BRIDGE.md) |

---

## 6. 지원 파일 포맷

### 6.1 입력
- **STEP** (.step, .stp)
- **IGES** (.iges, .igs)
- **JSCAD** (`.js` — `@jscad/modeling` API, 제품 내 AI 생성 코드와 동일 패밀리)
- **OpenSCAD** (`.scad`) — 제품 기본 경로 아님; CLI 브리지는 별도 로드맵

### 6.2 출력
- **STL** (테셀레이션)
- **STEP** (replicad 경유)
- **Drawing PDF** (기술 도면 2D 투영)

### 6.3 검증·문서
- **DXF** — 도면 분석
- **OBJ** — 메시
- **PNG / JPG** — 문서화 이미지

---

## 7. 고급 3D 기능 (현재 라이브)

| 기능 | 구현 모듈 | 출력 |
|------|----------|------|
| **DFM 분석** | `dfmAnalysis.ts` (35KB) | 위반 룰·심각도·수정 제안 |
| **토폴로지 최적화** | `topologyOptimization.ts` | 응력 제약 재료 제거, 컴플라이언스 최소화 |
| **모달 분석** | `modalAnalysis.ts` | 고유 주파수, 모드 셰이프 |
| **열 FEA** | `thermalFEA.ts` | 정상상태·과도 열전달 + 경계조건 |
| **드래프트 분석** | `analysis/draft*` | 사출용 분할면 검증 |
| **표면 품질** | `analysis/surface*` | 마감 예측, 폴리싱 가능성 점수 |
| **공차·스택업** | `analysis/tolerance*` | 치수 체인 분석 |
| **파라메트릭 스윕** | DOE 솔버 (35KB 패널) | 일괄 실험계획 |

---

## 8. 협업·공유

- 실시간 협업 세션 — `nf_collab_sessions` 테이블 기반
- IP 보호 공유 링크 — 메시 단순화(LOD) 후 view-only
- 핀 코멘트 — Figma 스타일, 3D 좌표에 고정
- 버전 비교 — `ShapeVersionDiff.tsx` 시각 diff

---

## 9. 알려진 이슈 / 기술 부채

- **shape-generator/page.tsx 모놀리식 (341KB)** — 성능 위해 모듈 분리 필요
- **서버사이드 B-Rep API 부재** — 모든 기하 작업 클라이언트 전용 (Phase 4 미래 작업)
- **다국어 UI 문자열** — analysis 패널 일부 영어 고정, i18n 미적용

---

## 10. 다음 단계 (계획)

상세 상태·수용 기준: [`docs/strategy/3D_SEQUENTIAL_IMPLEMENTATION.md`](./strategy/3D_SEQUENTIAL_IMPLEMENTATION.md)

1. 모놀리식 shape-generator 분리 (sketch / 3d-edit / analysis 라우트)
2. 서버 사이드 B-Rep 솔버 도입 (OpenCascade.js WASM 또는 자체 백엔드)
3. CAM 툴패스 시뮬레이션 (G-code 미리보기)
4. 어셈블리 제약 솔버 강화 (mate, contact, hinge)
