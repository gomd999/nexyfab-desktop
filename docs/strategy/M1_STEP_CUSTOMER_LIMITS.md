# STEP 교환 — 고객·협력사 안내 (1p)

**상세 스펙:** [M1_EXCHANGE.md](./M1_EXCHANGE.md) · 기술 한계 표: 동 파일 §「STEP 교환 한계 (요약표)」
**Phase B (상용 갭 축소) 정량표:** 본 문서 §「정량 한계」.

## 기대할 수 있는 것

- **가져오기:** STEP/STP, IGES, BREP 등은 브라우저에서 **삼각 메시**로 열립니다. 단위는 **mm**를 가정합니다.
- **보내기:** 대부분의 메시는 **AP242 테셀레이션 STEP**으로 보냅니다. **박스(`BoxGeometry`)** 는 **AP214 B-rep** 경로로 보내 OCCT 라운드트립 검증이 가능합니다.

## 기대하기 어려운 것

- 가져온 모델을 **피처 히스토리(스케치·돌출)** 와 같은 방식으로 편집하는 것 — 수입 기하는 메시로 취급됩니다.
- 모든 상용 CAD의 STEP 변형을 **100% 호환**하는 것 — 수입 측 OCCT/버전에 따라 거절될 수 있습니다.
- **어셈블리 전체**를 단일 멀티바디 STEP으로 자동 보내기 — 별도 로드맵입니다 (아래 표 참고).

## 정량 한계 (Phase B 기준; 코드 진실은 `src/lib/brep-bridge/constants.ts`)

| 항목 | 한계 | 동작 |
|---|---|---|
| STEP 가져오기 파일 크기 (디코딩 후) | **32 MB** | 초과 시 워커에서 거부, 에러 코드 반환 |
| STEP 가져오기 인라인 동기 경로 | **3 MB** | 미만은 메인 스레드 즉시 처리, 이상은 워커 큐로 비동기 |
| 워커 처리 타임아웃 | **120 s** (env `BREP_WORKER_TIMEOUT_MS`로 override) | 초과 시 job 실패, 재업로드 권장 |
| 워커 job TTL | **60 분** | 완료 안 한 job은 만료 |
| 박스 보내기 (AP214 B-rep, 인스턴트) | OCCT 라운드트립 검증됨 | `BoxGeometry`는 즉시 B-rep export |
| 비-박스 보내기 (OCCT 핸들 보유) | AP214/AP242 B-rep | OCCT 피처(extrude/revolve/fillet 등) 결과는 즉시 B-rep |
| 비-박스 보내기 (메시만 보유, OCCT 브리지) | AP214/AP242 B-rep | 임포트된 메시도 `meshToOcctShapeHandle` 브리지로 B-rep export 가능 (변환 ~100-300 ms, cold start ~1 s; UI에서 "Converting via OCCT…" 표시) |
| 어셈블리 STEP 보내기 (멀티바디 단일 파일, v1) | **지원** | `exportAssemblyToStepAsync` 가 OCCT compound 로 묶어서 단일 STEP export. 파트별 transform (translate + rotate). 단일 PRODUCT 'Compound'. 파브리케이션 CAM (Mastercam/Fusion) 호환 |
| 어셈블리 STEP 계층 (v2, NAUO) | **지원** | `stitchAssemblyHierarchy` 가 per-part STEP을 stitching → 1 root PRODUCT + per-part NEXT_ASSEMBLY_USAGE_OCCURRENCE + ITEM_DEFINED_TRANSFORMATION. SolidWorks / Onshape / Fusion 어셈블리 트리 재구성 가능 |
| 어셈블리 STEP 서브어셈블리 (v2.1, nested) | **지원** | `stitchNestedAssemblyHierarchy` — root → sub-asm → (sub-asm \| leaf) recursion. 임의 깊이, 서브어셈블리 자체에 transform 적용 가능, 부분 실패 diagnostics |
| FreeCAD/SOLIDWORKS 출처 STEP | OCCT WASM이 파싱 가능한 범위까지 | AP203/AP214/AP242 일반 지원; AP242 BIM/Edition 2는 일부 entity 거부 가능 |

## 가져올 때 자주 보는 실패 패턴

| 증상 | 의심 원인 | 권장 조치 |
|---|---|---|
| "File exceeds N bytes" | 32 MB 초과 | CAD에서 절단(simplify) 또는 STL로 분할 export |
| "Worker timeout" | 면 수가 많아 120 s 초과 | feature 단순화 또는 LOD 낮춰 export |
| 가져왔는데 비어 보임 | 단위 mismatch (m 또는 inch 가정) | 원본 CAD에서 mm로 통일 export |
| "Invalid STEP entity" | OCCT가 해당 AP242 BIM entity 거부 | AP214로 다시 export |
| 가져온 모델이 메시로만 보임 | 정상 — B-rep 재구성은 박스 외 미지원 | 메시 측정·간섭은 가능, feature edit는 불가 |

## 보낼 때 자주 보는 실패 패턴

| 증상 | 의심 원인 | 권장 조치 |
|---|---|---|
| 비-박스 객체 export가 느림 | OCCT 브리지 경로 (cold start 1 s, hot 100-300 ms) | 정상 — UI "Converting via OCCT…" 진행 표시 활용 |
| 비-박스 객체가 메시(AP242 tessellated)로 나옴 | Route A WASM 로드 실패로 legacy emitter 경로로 fallback | 페이지 reload 후 재시도; 지속 시 지원팀에 worker job id 전달 |
| 어셈블리 단일 STEP export가 일부 파트만 포함 | 일부 파트의 OCCT 브리지 실패 | 반환된 diagnostics 배열의 partId 확인; 메시가 non-manifold/degenerate면 modeling 단계에서 healing 후 재시도 |
| 받는 측이 단위가 다르다고 함 | STEP UNIT은 mm로 고정 | 받는 측 CAD에서 import 시 mm로 지정 |

## 문제가 생기면

1. **파일 크기·면 수를 줄이거나**, 다른 포맷(STL 등)을 병행해 보세요.
2. **오류 메시지를 캡처**해 지원팀에 전달하세요 (`formatCadImportError` 문구 + worker job id).
3. **CAD 측 STEP 변형(AP)** 정보를 알고 있다면 함께 전달하세요 — OCCT 호환성 판별에 도움됩니다.

## 후속 로드맵 (Phase C·D)

- ~~**비-박스 solid B-rep export**~~ — 2026-05-29 OCCT 브리지로 완료. Route A 회귀: `src/app/[lang]/shape-generator/io/__tests__/stepExporterRouting.test.ts`
- ~~**어셈블리 단일 STEP**~~ — 2026-05-29 멀티바디 단일-PRODUCT v1 완료. `exportAssemblyToStepAsync` + 11 회귀: `src/app/[lang]/shape-generator/io/__tests__/assemblyStepExport.test.ts`. NEXT_ASSEMBLY_USAGE_OCCURRENCE 계층 (per-instance) 은 Phase D+
- **AP242 BIM 풀 호환** — entity 화이트리스트 확장 (Phase D)
- ~~**STEP 라운드트립 가시화**~~ — 2026-05-29 `stepRoundtripReport.ts` 완료. `computeRoundtripDrift` (pure math) + `runStepRoundtripReport` (WASM chain). verdict 4단계: clean (<0.5%) / minor (<2%) / lossy (<10%) / broken. 회귀 13/13.
