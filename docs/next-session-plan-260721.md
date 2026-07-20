# 다음 세션 인수인계 — 2026-07-21 (Wave 4 도면 트랙 완결 + 스위트 행 근본수정)

**전임 문서**: `next-session-plan-260720.md` (Wave 1~3 완결)
**이 세션의 궤도**: Wave 4 (W4-A~D, → G2 게이트) + ⚠️미완 검증(스위트 무종료) 규명

## 0. 전략 컨텍스트 (불변 — 전임 문서 §0과 동일)

- Path A(OCCT+planegcs), 5도메인×일반인/전문가, 생성≠검증·날조 금지·근사 명시·거부는 이유와 함께
- 커밋 규칙: 800줄/15파일, `[P0/P1/P2]` 접두사, Co-Authored-By 트레일러

## 1. 완료 (이 세션, 전부 커밋됨 — HEAD `0dbaa73a`)

### ★ 스위트 무종료 근본원인 규명 + 수정 (`7dfcaa27`)
- **원인**: `features/meshCompare.ts` `sampleIndices()` — `state * 1103515245`가
  2^53 초과 → 부동소수점 정밀도 손실로 LCG가 짧은 사이클로 붕괴 → 거부표본
  while이 이미 뽑은 인덱스만 순환(n=24, k=10 재현). **동기 루프라 vitest 60s
  testTimeout 무력** → 러너 전체 행.
- **특정 경로**: 배치 분할+타임아웃+트리킬 헌트 → b01 배치 미완료 파일 diff
  정확히 1건 → 단독 실행 240s 행 재현 → node로 LCG 사이클 시뮬레이션 확정.
- **수정**: `Math.imul` 정확 32비트 LCG + 부분 Fisher–Yates(O(n) 종료 보장,
  고정 시드 결정성 유지).
- **검증**: 전체 `src/app/[lang]/shape-generator` 스위트가 **1,121파일 /
  14,198 테스트 / 247초**로 정상 종료 (이전: 1시간+ 무종료).
- ⚠️ 동일 LCG 패턴 9곳 잔존(topologyOptimizer·hausdorffDistance·
  decimationAccuracy·monteCarloPosition·ssaoConfig·proceduralTexture·
  particleSystem·inverseProblem·booleanStressTest). 전부 유한 루프라 행은
  불가능하고 난수 품질 저하만. imul 수정 시 시퀀스가 바뀌므로 골든값
  테스트 영향 검토 후 별도 배치로 정리할 것.

### W4-A 치수 렌더 배선 (`c93c16c5`)
- SheetRenderer `topologies` prop: 표준뷰+topo 공급 시 `measureDimension`
  실측값을 라벨로(⌀/R/° 관례 장식). 실패는 `<kind>` 플레이스홀더 유지 +
  `data-dim-measured`=reason + `<title>` 진단. valueOverride 우선 유지.
- `lib/drawing/associativeUpdate.ts` 신설: `measureSheetDimension`(캔버스·
  리스트 공용 단일 해석 규칙)·`auditSheetDimensions`·`formatMeasuredValue`·
  `reanchorCuttingPlane`.
- face 앵커 렌더러 경로 실측 확인(f.side 쌍 linear=50) — 정직기록 #2 부분 해소.

### W4-B 연관 도면 (`cb289e47`)
- 파트 전환 시 단면뷰 **삭제 → 재앵커**(같은 노멀, bbox 상대 위치 보존) —
  로드맵 정직감사 "갱신이 아니라 삭제" 해소.
- 주석 리스트에 실측 상태 표시: `= 50` / `⚠ unresolved-ref` (dimensionAudit).
- 모델 편집→치수 자동 재실측 검증: depth 50→80 → 값 50→80, 사라진 ref는
  명시적 unresolved-ref (stale 숫자 불가).

### W4-C 상세도·파단도 (`14f0baec`+`b40555ce`)
- IR: `BrokenProjection`(view+axis+band+gap, 검증 포함) 추가.
- projectView 뷰연산: `clipSegmentsToCircle`(해석적 선-원 교차),
  `applyViewBreak`(밴드 제거+원측 슬라이드, 정확 절단).
- 렌더러: DetailGeometry(소스뷰를 원으로 클리핑, 기존 링에 정합),
  BrokenGeometry(붕괴 라인워크+지그재그 파단선), 소스 뷰포트 위 상세원
  마커(레터 연동). 지오메트리 미공급 시 스텁 유지.
- 페이지: 상세도/파단도 추가 버튼. 위치를 **front뷰 bbox 프랙션**으로 저장
  → 파트 전환 시 자동 재유도(연관성 원칙 통일).

### W4-D 표면거칠기·용접기호 작성 UI (`0dbaa73a`)
- 모달 kind 4종(치수/GD&T/표면거칠기/용접기호). ISO 1302·AWS 필드 폼,
  lib 검증기 통과 후에만 onAdd. `DrawingAnnotation` 유니언.
- 리스트 라벨 = 캔버스와 동일 lib 포맷터(⌵/⊳). (GD&T 작성 UI는 기존 완비
  확인 — W4-D의 실제 공백은 표면/용접 producer였음, 로드맵 B등급 4번.)

### 회귀 (이 세션 실측)
- tsc 클린 · 도면 트랙(src/test/drawing + shape-generator/drawing) **93파일
  /1,294** · **전체 shape-generator 1,121파일/14,198 (247s 종결)** · 신규
  테스트 55종(측정 배선 6·연관 14·뷰연산/상세파단 18·표면용접 4 + lib 13)

## 2. 다음 작업

1. **배포 배치 (사용자 신호 시)** — Wave 4는 사용자 가시 변화(도면 페이지
   실측 치수·상세/파단 뷰·표면/용접 작성). 절차: Dockerfile CACHEBUST 범프 →
   `npx @railway/cli up --service nexyfab.com --detach` →
   `node scripts/e2e/smoke-3surface.mjs --base https://nexyfab.com`
2. **G2 판정** — G2 = R1(하류 재생성, Wave 2) + R3(실측 치수, W3-C+W4-A) 모두
   랜딩. REPLACEMENT_ROADMAP §5 기준으로 "기계 단품 제작도" 시나리오 실증
   (실부품 도면 1장을 치수 실측으로 완성 → PDF/DXF 출력) 후 게이트 표 갱신.
3. **Wave 5** (8트랙): F14 어셈블리 API 표면(W5-F), loft/thread/draft/pattern
   실체화, 인터롭, 브라우저 워커 seamKeys 공급.
4. 태스크 #23 "R3 실측 치수" → W4-A 완료로 completed 처리.

## 3. 정직 기록 잔여

1. LCG 9곳 정밀도 손실(§1 참조) — 행 불가, 품질 저하만. 별도 배치.
2. face 앵커: 렌더러 경로 f.side linear 실측 확인. 원 face(radial/diametric)
   앵커의 W4-A 배선 검증은 cylinder ⌀50으로 완료. 3D-skew face 조합은 미실측.
3. 파단도는 의도적으로 치수 측정 불가(뷰가 길이를 왜곡) — measure는
   standard 뷰만 수용, 파단뷰 치수는 명시 플레이스홀더.
4. 상세도 center/radius는 "소스 뷰-플레인 mm" 해석으로 구현(IR 주석의
   "drawing coords"를 이렇게 확정). DXF/PDF 내보내기에는 상세/파단 뷰
   전용 처리 없음(표준 경로로만 나감) — Wave 5 인터롭에서 정리.
5. `childExtrude` 완전 제거 SCHEMA_VERSION 2 대기 · 브라우저 워커 심 명명
   legacy(Wave 5) · System B S6 rows[55] 1행 (전임 문서 §3 이월분 유지).

## 4. 검증 명령 (재현)

```bash
npx vitest run "src/app/[lang]/shape-generator/features/meshCompare.test.ts"  # 11/11, ~1s (행 재발 감지)
npx vitest run src/test/drawing "src/app/[lang]/shape-generator/drawing"       # 93파일/1,294
npx vitest run "src/app/[lang]/shape-generator"                                # 전체 1,121파일/14,198 — ~4분 종결 확인
npx tsc --noEmit
```
