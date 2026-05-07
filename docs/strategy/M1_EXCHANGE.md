# M1 — 교환(Exchange) v1 **완료 기준**

**목표:** 다른 CAD·제조 툴과 손을 맞출 **최소 신뢰** + **클라우드에 안전하게 저장**할 수 있는 경로를 제품 기준으로 고정한다.

**고객·협력사용 요약(1p):** [M1_STEP_CUSTOMER_LIMITS.md](./M1_STEP_CUSTOMER_LIMITS.md)

---

## 1. CAD 교환 (파일 포맷)

### 단위·좌표

| 구간 | 정책 |
|------|------|
| 내부 모델링 | **mm** (Shape Generator 기본) |
| STEP **내보내기** | `stepExporter.ts` — 일반 메시: **AP242** tessellated(mm). **`THREE.BoxGeometry`만** AP214 `MANIFOLD_SOLID_BREP` 템플릿 경로(OCCT 라운드트립 호환). |
| STEP **가져오기** | OCCT가 B-rep를 **삼각 메시**로 변환. `stepImporter`에서 **바운딩 중심을 원점으로 이동** (뷰 정렬) |
| STL/OBJ/PLY | 정점은 **mm**로 가정 (메타 없음) |

### 포맷 역할

| 포맷 | 방향 | 구현 |
|------|------|------|
| STEP/STP, IGES, BREP | In | `occt-import-js` WASM (`stepImporter`, `importers.parseOCCT`) |
| STL, OBJ, PLY, DXF | In | `importers.ts` |
| STEP | Out | 기본: AP242 tessellation; 박스: AP214 B-rep(`remapAp214NxCubeToBox`). 제조 ZIP은 `manufacturingPackage` 등 별 경로 |
| STL/OBJ/PLY | Out | `exporters.ts` |

### 한계 (고객·내부 공유)

1. 가져온 STEP/IGES는 **메시**로 취급 — 피처 트리 B-rep 편집과 별개.  
2. 대용량 STEP은 WASM 메모리·시간 한계 가능.  
3. 빈 메시/파싱 실패 → `formatCadImportError`로 토스트.

### STEP 교환 한계 (요약표 — 고객·지원 안내)

| 항목 | 설명 |
|------|------|
| 가져오기 결과 | STEP/IGES/BREP **가져오기**는 **삼각 메시** 결과 — 피처 히스토리 B-rep 편집과 별개 |
| 대용량 | 브라우저 WASM **메모리·시간** 한계; 초대형 파일은 실패·느림 가능 |
| STEP보내기 (AP242) | 일반 `BufferGeometry`는 **테셀레이션 STEP(AP242)** — 수입 CAD·OCCT 버전에 따라 거절될 수 있음 |
| STEP보내기 (AP214) | **`THREE.BoxGeometry`만** 고정 템플릿 **MANIFOLD_SOLID_BREP** 경로(라운드트립 검증 대상) |
| 조립 STEP | 다본 `.nfab` 어셈블리 전체를 단일 STEP 조립으로 보내는 것은 **별 로드맵**(Phase B3 심화) |

### 코드

| 역할 | 경로 |
|------|------|
| Import 오류 문구 | `io/formatCadImportError.ts` — 메인 가져오기·스케치 참조 메시 |
| STEP in | `io/stepImporter.ts`, `io/importers.ts` |
| STEP out | `io/stepExporter.ts` |
| 코드 CAD (브라우저) | `openscad/OpenScadPanel.tsx` — **JSCAD**; API `POST /api/nexyfab/jscad-gen`; OpenSCAD `.scad` CLI는 [JSCAD_OPENSCAD_BRIDGE.md](./JSCAD_OPENSCAD_BRIDGE.md) |

---

## 2. 클라우드 저장 (Cloudflare R2 + 프로젝트 API)

**원칙:** 사용자가 말한 대로 **저장은 Cloudflare 연동** — 구현은 **S3 호환 API로 R2**를 쓰고, **CAD 프로젝트 본문**은 API를 통해 영속화한다.

### 두 가지 저장 층

| 층 | 용도 | 구현 |
|----|------|------|
| **프로젝트 스냅샷 (.nfab JSON)** | Shape Generator 전체 상태 (`serializeProject` → `sceneData`) | `PATCH/POST /api/nexyfab/projects` — DB 필드 `scene_data` (문자열, 상한 약 5MB). `useNfabFileIO` · `useProjectsStore.saveProject`. |
| **임의 파일 (STEP/ZIP/이미지 등)** | 대시보드 업로드, RFQ 첨부, 파트너 업로드 | `POST /api/nexyfab/files` → **`getStorage()`** (`src/lib/storage.ts`) — **`S3_ENDPOINT`에 Cloudflare R2 엔드포인트** + `S3_*` 키로 **R2 버킷**에 객체 저장, 메타는 `nf_files`. |

로컬 개발은 동일 인터페이스로 **로컬 디스크**(`public/…`) 스토리지를 쓸 수 있음.

### 환경 변수 (R2 = S3 호환)

배포 시 예시 (실제 값은 비밀 저장소):

- `S3_ENDPOINT` — `https://<account_id>.r2.cloudflarestorage.com`
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (R2는 종종 `auto`)
- 선택: `S3_PUBLIC_URL` — 퍼블릭 읽기 URL

### 사용자 플로우 (M1 완료 관점)

1. **로컬:** `.nfab` 다운로드/저장 — `projectFile.downloadProjectFile` (Tauri/웹).  
2. **클라우드:** 로그인 후 **클라우드 저장** — `sceneData`가 API로 올라가고, 대시보드 프로젝트 목록에서 재열기 (`parseProject`).  
3. **대용량 첨부:** 필요 시 `/api/nexyfab/files`로 R2에 올리고 DB에 키 연결 (용량·플랜은 `PLAN_LIMITS`).

개인정보 문구는 `src/lib/commercial/dataProcessors.ts` — R2·API 언급과 일치.

---

## 3. 자동화

```bash
npm run m1
```

- `typecheck`  
- Vitest: `src/test/m0/nfabGolden.test.ts` + `src/test/m1/exchange.test.ts` (M0 기준선 + M1 교환 회귀)

**상용 Phase A (CI `test` 잡과 동일 선상):** `npm run commercial:gate-a` — 병렬 스모크(`verify:integration-smoke`) 후 전체 `verify` + Vitest 전체. 이어서 A→D 체크리스트까지 보려면 `npm run commercial:sequential`. 근거: [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md).

## 4. 수동 검증

릴리스 전: **[M1_RELEASE_CHECKLIST.md](./M1_RELEASE_CHECKLIST.md)**

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | M1 초안 — 교환, formatCadImportError, exchange 테스트 |
| 2026-04-30 | **M1 완료** — R2·프로젝트 API 문서화, 체크리스트, `npm run m1`에 M0 테스트 포함 |
| 2026-05-06 | Phase A 정합: §3에 `commercial:gate-a`·`commercial:sequential` 안내; STEP 표와 `stepExporter.ts`(AP242 tess / 박스 AP214) 동기 확인 |
