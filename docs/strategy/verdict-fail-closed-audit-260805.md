# CAD 판정 `pass/fail/not_run` 전역 감사 — 2026-08-05

## 범위와 방법

- `src/lib`, `src/app/api/cad/v1`, `scripts/reference`, CLI/MCP에서 `pass`, `fail`, `not_run`, `releaseReady`, `designOk`, `passed` 생성·집계 지점을 `rg`로 조사했다.
- 테스트를 포함해 593개 텍스트 일치가 있었으며, 그중 릴리스 판정에 직접 연결되는 Evidence v1/v2, reference 분석·batch·shard, 제조 G0~G9, AI 생성, assembly/motion, PMI·공차 API를 코드와 기존 테스트로 대조했다.
- `ok:true`는 호출 성공일 뿐 설계 합격이 아니므로 `designOk`, `releaseReady`, Evidence status를 별도로 추적했다.
- 이번 감사에서는 OCCT bridge, reference analyzer, STEP header repair 구현을 변경하지 않았다.

## 우선순위 결과

### P0 — 즉시 차단 기준에 넣을 항목

1. **유효하지만 solid가 아닌 STEP이 전체 분석 `pass`가 될 수 있다.**
   - 근거: `cadReferenceAnalyze.ts`의 `measurementAssertions`는 `counts`, bbox, volume, area, centroid를 측정됐다는 이유만으로 `pass` 처리한다. `geometry.valid`만 실제 fail 조건이다.
   - 재현 조건: `valid=true`, `solidCount=0`, `absoluteVolume=0`, 양수 bbox/area, histogram available인 shell 또는 face 형상.
   - 영향: 제조 가능한 solid 증거로 오인될 수 있다.
   - 조치: `geometry.solid` assertion을 추가해 `solidCount>=1`, `absoluteVolume>relativeTolerance`, finite centroid/bbox를 요구한다. 단일 부품 profile에서는 `solidCount===1`을 요구한다.

2. **공개 shard summary 함수를 직접 호출하면 부분 결과가 release 가능처럼 보일 수 있다.**
   - 근거: `buildCadCorpusSummaryReportV2`는 전달된 record만 집계하고 `releaseBlocking = fail || notRun`으로 계산한다. 누락 fixture를 세지 않는다.
   - 완화: 정상 `mergeCadCorpusShardResultsV2` 경로는 `MISSING_FIXTURE`와 `MISSING_SHARD`를 throw한다.
   - 영향: 직접 호출 또는 향후 다른 consumer가 부분 pass 결과를 전체 pass로 오인할 수 있다.
   - 조치: summary builder를 비공개로 만들거나 manifest 대비 누락을 `not_run`으로 넣고 `releaseBlocking=true`로 한다.

### P1 — 다음 정확도 묶음에서 수정

3. **Legacy corpus STEP `geometry_import`가 solid 0개에도 pass할 수 있다.**
   - 근거: `cadCorpusEvidence.ts` pure-TS 경로는 parser 성공 후 `solids` 값을 기록하지만 상태를 무조건 `pass`로 만든다.
   - 영향: 형식 파싱 성공과 제조 형상 성공이 섞인다.
   - 조치: import syntax와 solid evidence를 분리하고 solid 0은 `fail` 또는 surface 전용 profile의 명시적 `not_run`으로 처리한다.

4. **통합 `step_roundtrip`의 PMI 0→0 비교는 PMI 보존을 vacuous pass로 만든다.**
   - 근거: semantic, graphical, topology count가 각각 같은지만 보고 geometry pass와 결합한다. 세 원본 count가 모두 0이어도 동일성은 true다.
   - 완화: 독립 `pmi_semantic_roundtrip`은 원본 semantic PMI가 0이면 pass하지 않는다.
   - 조치: PMI가 요구된 scenario에서 원본 PMI evidence가 0이면 `not_run/fail`; geometry-only roundtrip과 AP242 PMI roundtrip assertion을 분리한다.

5. **Assembly의 legacy `designOk`는 precise interference가 없어도 true가 될 수 있다.**
   - 근거: assembly verify route의 `designOk`는 solver success, AABB supplied, flagged 0, motion만 요구한다.
   - 완화: 같은 응답의 `releaseReady`는 authoritative DoF와 precise completion까지 요구해 fail-closed다. 기존 테스트도 `designOk=true`, `releaseReady=false`를 구분한다.
   - 조치: UI·CLI가 제조 릴리스에 `designOk`를 사용하지 못하도록 타입/이름을 `previewOk`로 축소하고 `releaseReady`만 릴리스 조건으로 사용한다.

6. **제조 G6 feature fidelity는 `requested=0, verified=0`이면 passed다.**
   - 근거: G6 조건은 두 count 동일, skipped/mismatch 0뿐이다.
   - 영향: feature 검증이 실질적으로 비어 있어도 호출자가 빈 객체를 제출하면 `not_run`이 아닌 passed가 된다.
   - 조치: 일반 제조 artifact에는 `requested>0`을 요구하거나 `applicable:false`를 명시하는 별도 N/A 상태를 도입한다.

### P2 — 계약 명료화와 방어 강화

7. Evidence v2 validator는 unknown top-level fields를 유지한다. 현재 주석대로 governed 필드는 엄격하지만, 외부 consumer가 unknown `releaseReady:true` 같은 필드를 신뢰하지 않도록 canonical consumer allowlist가 필요하다.
8. `not_run`과 not-applicable이 같은 또는 서로 다른 방식으로 표현된다. 예를 들어 hole gate는 구멍 없음에 `pass:true`, motion은 `not_required`, Evidence는 `not_run`을 쓴다. 공통 `not_applicable` 의미 계약이 필요하다.
9. Batch summary의 `error`는 Evidence status 밖의 별도 상태다. merge/shard report와 baseline delta가 동일한 severity 순서 `pass < not_run < fail < error < missing`을 공유해야 한다.
10. DFM G7은 호출자가 제공한 `passed` boolean을 신뢰한다. producer identity와 artifact hash를 G7 입력에 연결하지 않으면 자기신고 evidence가 될 수 있다.

## 확인된 fail-closed 경로

- Evidence v2: assertion 0개 또는 하나라도 `not_run`이면 document status는 `not_run`; fail이 우선한다.
- 제조 G0~G9: evidence object 자체가 없으면 모두 `not_run`, 전체 `passed=false`다.
- AI 생성: assembly, interference, STEP roundtrip 누락은 `blocked`; conservative interference는 `review_required`다.
- Assembly release: exact/authoritative DoF와 precise interference가 없으면 `releaseReady=false`다.
- Animation: collision box가 없으면 `verified=false`, `collisionFree=false`다.
- PMI API: unresolved topology target은 review로 이동하며 `designOk=false`다.
- Tolerance API: lower/upper specification 둘 다 없으면 `designOk=false`다.
- Baseline delta: candidate의 fail/error/not_run/missing과 assertion non-pass는 release blocker다.
- Batch resume: signature mismatch와 source hash/size 변경은 성공으로 재사용되지 않는다.

## 실행 순서

1. P0 두 항목을 release gate 수정과 회귀 테스트로 먼저 처리한다.
2. STEP geometry/PMI assertion 의미를 분리한다.
3. `designOk`와 `releaseReady` consumer 전수 검색 후 릴리스 조건을 후자로 통일한다.
4. G6 empty evidence와 G7 self-attestation을 차단한다.
5. 공통 verdict vocabulary와 severity helper를 도입하고 shard, batch, delta, UI가 공유한다.

## 추가된 감사 회귀

`src/lib/reference/verdictFailClosedAudit.test.ts`가 다음 최소 불변식을 고정한다.

- 빈 Evidence는 pass가 아니다.
- 빈 제조 evidence는 전부 `not_run`이고 전체 실패다.
- 미지원 corpus format은 `not_run`이다.
- AI 생성에서 assembly 누락은 blocked다.
- animation collision geometry 누락은 verified/collisionFree가 모두 false다.
