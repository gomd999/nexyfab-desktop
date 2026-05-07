# M2 — 히스토리·모델링 신뢰 (Feature 파이프)

**목표:** Sketch–Feature–History **재생성**이 예측 가능하고, 실패 시 **어느 피처에서 왜** 문제인지 사용자에게 전달한다.

---

## 1. 파이프라인 흐름

| 단계 | 역할 | 코드 |
|------|------|------|
| 오케스트레이션 | 피처 루프, 캐시, 스케치 익스트루드, 실패 시 **이전 고체로 롤백** | `features/pipelineManager.ts` (`runPipeline` / `runPipelineAsync`) |
| UI 통합 | 워커에서 비동기 실행, `errors` → `pipelineErrors` | `workers/usePipelineWorker.ts`, `ShapeGeneratorInner.tsx` |
| 트리 표시 | `pipelineErrors`를 히스토리 노드 `error`에 **머지** | `ShapeGeneratorInner`의 `featureHistoryWithErrors` |
| 사용자 힌트 | 원시 메시지 → 분류 코드 + 한/영 힌트 | `features/featureDiagnostics.ts` — `classifyFeatureError` (`features/index.ts` 재수출) |

실패 시에도 뷰포트는 가능한 한 **마지막 유효 메시**를 유지한다(빈 화면 방지).

---

## 2. 에러 분류 (`classifyFeatureError`)

- **코드**는 피처 트리·토스트에서 `[code]`로 노출될 수 있다.
- 주요 분류: `emptyOutput`, `emptySketch`, `empty`, `nonManifold`, `indexedMesh`, `minimalGeometry`, `nan`, `paramRange`, `selfIntersect`, `timeout`, `booleanOp`, `mergeFail`, `bounds`, `occtInit`, `workerFail`, `cancelled`, `unknown`.

원시 OCCT/메시/워커 메시지가 추가되면 이 함수에 **패턴을 보강**하는 것이 M2의 기본 반복 작업이다.

### OCCT·워커·스케치에서 자주 쓰는 문자열 (참고)

| 출처 | 예시 메시지 | 분류 코드 |
|------|-------------|-----------|
| `OcctNotReadyError` | `OCCT engine not initialized — …` | `occtInit` |
| CSG / 파이프라인 워커 | `CSG worker timed out (30s)`, `Pipeline worker error`, `Failed to start CSG: …` | `timeout` / `workerFail` |
| `occtEngine` / 스케치 | `Geometry has no bounding box`, `Missing bounding box` | `bounds` |
| `pipelineManager` | `Feature produced empty geometry` | `emptyOutput` |
| `importers` / STEP | `… no meshes produced` | `emptyOutput` |
| `usePipelineWorker` | `Pipeline superseded`, `Pipeline cancelled` | `cancelled` |
| `sheetmetal` / 프로파일 | `Profile produced no geometry segments`, `Profile must have at least 2 points` | `emptySketch` / `paramRange` |
| 익스포트 / 파이프 워커 | `Geometry has no position attribute`, `… no position buffer … serialise mesh` | `minimalGeometry` |
| `importers` | DXF 빈 엔티티, `Unsupported format` | `emptyOutput` / `unknown` |
| `ExpressionEngine` | 빈 수식, 0으로 나눔, 토큰 오류 등 | `paramRange` |
| `geometryCache` | `IndexedDB not available` | `workerFail` |
| FEA/DFM/간섭 워커 | `Failed to start FEA` 등 | `workerFail` |

---

## 3. 지원 피처(맵 기반)

`FEATURE_DEFS`에 등록된 타입이 UI “추가 피처”와 파이프라인에 대응한다.  
타입 목록은 `features/index.ts`의 `FEATURE_DEFS`와 `features/types.ts`의 `MapBackedFeatureType`을 기준으로 한다.

**한계(요약)**

- `sketchExtrude`는 스케치 데이터 기반 **인라인** 경로이며, 다른 피처는 `FEATURE_MAP` 디스패치.
- 가져온 STEP 등 **외부 메시**는 B-rep 피처 트리와 다른 경로로 섞일 수 있음 — M1 문서의 교환 한계와 함께 본다.

---

## 4. 자동화

```bash
npm run m2
```

- `typecheck`
- Vitest: M0 골든 nfab + M1 교환 + M2 진단·시나리오 + 텔레메트리 평탄화(`src/lib/__tests__/featurePipelineTelemetry.test.ts`) + `runPipeline` 회귀(`shape-generator/__tests__/pipeline.test.ts`)

수동 스모크는 [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md)를 따른다.

---

## 5. 완료 정의 (M2 v1 제품 기준선)

**문서·자동화 기준으로 M2 v1 완료 처리됨 (2026-04-30).** 팀 릴리스 승인 시 [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md) A절 서명만 추가하면 된다.

- `npm run m2` 통과(타입체크 + 회귀 테스트 전부).
- [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md) **릴리스 게이트** 완료.
- 재생성 실패 시 트리/토스트에 **피처 단위** 메시지·`[code]`·힌트가 보이는 것 확인.
- “지원/한계”는 본 문서 + `FEATURE_DEFS` / `types`와 함께 유지하고, 큰 동작 변경 시 갱신.

**릴리스 이후(롤링):** 필드에서 자주 뜨는 원시 메시지 → `classifyFeatureError` 패턴만 추가. 팀 OKR로 **시나리오 통과율**을 두었다면 별도 시트로 트래킹.

---

## 6. 제품 품질 (텔레메트리·운영)

- **분류 모듈:** `features/featureDiagnostics.ts` — `classifyFeatureError` 단일 소스. `features/index.ts`에서 재내보냄.
- **파이프라인 이벤트:** `reportError('feature_pipeline', …)` 호출 시 `context`에 `diagnosticCode`(위 분류의 `code`)와 `featureId` / `featureType`을 넣음. 스케치 익스트루드 빈 기하·머지 실패도 동일하게 기록.
- **소비:** 클라이언트는 `lib/telemetry.ts` → `/api/nexyfab/telemetry`로 배치 전송. 대시보드/로그에서 **`context.diagnosticCode`로 집계**하면 원시 문자열 없이도 실패 유형별 비율을 볼 수 있다.
- **UI 힌트 언어:** 한국어 UI는 `hintKo`, 그 외 로케일은 현재 **영문 `hintEn`**을 사용한다(`FeatureTree`). 일본어·중국어 전용 힌트는 필요 시 `featureDiagnostics`에 필드를 추가하는 방식으로 확장한다.
- **패턴 보강 루프:** 프로덕션/스테이징에서 자주 뜨는 **원시 메시지**를 샘플링해 `classifyFeatureError`에만 분기 추가 — UI 문구 변경 없이 운영 지표가 정리된다.

**감사 로그·Sentry**

- `POST /api/nexyfab/telemetry`는 `logAudit` 메타데이터에 `diagnosticCode`, `featureId`, `featureType`, **`stage`**, **`enabledFeatureCount`**(숫자)를 **최상위**로 넣는다(`nf_audit_log.metadata` JSON — `audit.ts`는 중첩 객체만으로는 저장하지 않음). `stage` 예: `occt_init`, `shape_generator_worker`.
- Sentry 전달 시 동일 값을 **태그**(`diagnosticCode`, `featureType`, `pipelineStage`)로도 붙여 이슈 필터링이 쉽다.
- SQLite 예시(메타데이터가 JSON 문자열인 경우):

```sql
SELECT created_at, user_id, json_extract(metadata, '$.diagnosticCode') AS code
FROM nf_audit_log
WHERE action LIKE 'telemetry.feature_pipeline.%'
  AND json_extract(metadata, '$.diagnosticCode') IS NOT NULL
ORDER BY created_at DESC
LIMIT 100;
```

---

## 7. 운영 런북 (요약)

**주간 (15분)**

1. Sentry: `pipelineStage` / `diagnosticCode` 태그로 **신규 이슈·스파이크** 확인.  
2. DB 사용 시: §6 SQL로 상위 `diagnosticCode` 비율 확인(샘플 100건).  
3. `workerFail`·`timeout` 비율이 전주 대비 급증하면 워커 타임아웃·복잡도·네트워크부터 의심.

**월간**

- 상위 `unknown` 원시 메시지 텍스트를 몇 건 샘플링해 `featureDiagnostics.ts`에 분기 추가.  
- 클라이언트 `telemetry.ts`는 동일 메시지라도 **`diagnosticCode`·`stage`가 다르면 별도 이벤트**로 dedupe한다(운영 집계 왜곡 방지).

**릴리스 직전**

- [M2_RELEASE_CHECKLIST.md](./M2_RELEASE_CHECKLIST.md) + `npm run m2` + `npm run m1` 회귀.
