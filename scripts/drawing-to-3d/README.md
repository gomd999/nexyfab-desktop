# 2D→3D v1 — 도면을 읽어 3D 재구성 (Gemini Vision)

`docs/strategy/drawing-annotation-schema.md` 방법론의 첫 구현. 원칙: **AI=이해, 결정론=형상·검증**.

```
합성 도면 생성(GT 보유) → Gemini 추출(intent JSON) → 기하 게이트 → 결정론 재구성(OpenSCAD) → GT 채점
   gen-drawing.mjs          extract.mjs               reconstruct.mjs(gate)   reconstruct.mjs        run-e2e.mjs
```

## v1 첫 평가 (5장 plate, gemini-2.5-flash, temp 0)
외곽 치수 15/15·구멍 위치 16/16·게이트 5/5 = 100% (단일 어휘·깨끗한 도면)

## v2 평가 — 어휘 5종 × 증강 50장 (2026-07-12, 정직 결과)

**JSON 리페어+재시도3 적용 전→후 (측정된 개선):**

| 지표 | v2.0 | **v2.1 (리페어)** |
|---|---|---|
| **추출 실패(malformed JSON)** | 13/50 (26%) | **7/50 (14%)** ↓ |
| 타입 분류 | 37/50 (74%) | **43/50 (86%)** ↑ |
| 파라미터 정확도(추출 성공분) | 92.3% | **91.6%** |
| 구멍 위치 (±1mm) | 17/19 | **30/30 (100%)** ↑ |
| 기하 게이트 통과 | 33/50 | **37/50** ↑ |

리페어: `80.00..142e-1500000`(정상 만티사+쓰레기 지수) → 지수만 제거해 복구.
정상 소수(1.5e-3)는 불변. 잔여 7건 = 스캔 열화 극단 케이스(리페어·재시도로도 실패) = 정직한 하한.

**버킷별 (clean vs scan)** — 깨끗한 도면은 거의 완벽, 스캔 열화가 갉아먹음:
- clean:bent_sheet 20/20 · clean:flange 30/30 · clean:stepped 20/20 (완벽)
- scan:bent_sheet 14/20 · scan:flange 24/30 (스캔 시 작은 주석 `t=`·치수 누락)
- l_bracket thickness·flange의 boreDia/bcd가 자주 undefined (도면 표기 방식 문제)

### 잔여 갭 (14%) — 스캔 열화 극단 케이스
리페어로 26%→14% 감축. 남은 7건은 스캔 열화가 심해 추출 자체가 실패하는 케이스 + l_bracket scan 타입분류 약함(1/5). 실도면은 더 낮을 것 — 프로덕션 전 실스캔 baseline 필요.

## MCP 서버 — Claude/CLI에서 호출 (`mcp-server.mjs`)

```
claude mcp add nexyfab-drawing -- node <절대경로>/mcp-server.mjs
```

| 도구 | 입력 → 출력 | Gemini |
|---|---|---|
| `text_to_intent` | 자연어 텍스트 → 도면 intent (입구 B) | 필요(2단계) |
| `text_to_assembly` | 자연어 → 복합 다부품 어셈블리(배치+간섭) | 필요 |
| `build_assembly` | 어셈블리 계획 → OpenSCAD+간섭 | 결정론 |
| `extract_drawing` | 도면 PNG → 파라메트릭 intent (입구 A) | 필요 |
| `edit_drawing` | intent + 자연어 지시 → 편집본(게이트) | 필요 |
| `reconstruct_3d` | intent → OpenSCAD + ComponentIntent | 결정론 |
| **`verify_3d`** | **intent → 실렌더 STL bbox·manifold 대조** | 결정론 |

**입력 3경로**(이미지A/텍스트B/계획) → 공통 게이트·재구성. 잘못된 편집·불완전 계획은 게이트가 거부·롤백.

### 어휘 7종
plate_with_holes / stepped_plate / l_bracket / flange / bent_sheet / **tube**(원형파이프) / **rect_tube**(각관) — 뒤 2종은 프레임/랙/스키드 형강용.

### 신뢰성: 2단계 추출 (핵심 픽스)
gemini-2.5-flash/pro가 union 스키마(전 필드)에서 엉뚱한 필드를 채우려다 degenerate-number로 폭주(MAX_TOKENS)하는 실패 → **분류(작은 스키마) → 타입별 최소 스키마 추출** 2단계로 원천 차단. bent_sheet·tube·rect_tube 텍스트 전부 flash로 gate PASS. + flash→pro 폴백 + 503 백오프 + JSON 리페어(폭주 지수·긴소수).

### 정확성 검증 (`verify_3d`)
재구성 SCAD를 **실제 openscad-wasm으로 렌더 → STL bbox·manifold를 기대 치수와 대조**. 전 어휘 **오차 0mm·manifold** 확인. 치수 정확도엔 VLM보다 결정론 대조가 강함(VLM 왕복 재-추출은 후속).

### 자유배치
회전 배치 시 로컬 박스 8코너를 회전변환해 **정확한 AABB** 산출 → 임의 각도 간섭검사 정확(축정렬 한정 아님). 단 어셈블리 관절/자유곡선 결합은 미대응.

### 정직한 한계
- 어휘 7종·**축정렬+회전 배치**(관절·유기결합 아님).
- 입구 B=**계획서**(오라클 아님): 치수 미기입 시 통상값+confidence↓, 사람 승인 전제.
- 복합 어셈블리는 부품↑일수록 AI 불완전계획↑ → 게이트가 막지만 재시도/수정 필요.

## 대화형 편집 (`edit.mjs`) — AI와 소통하며 수정
자연어 지시로 도면을 고친다. **AI는 구조화 패치만 제안, 형상 변경·검증은 결정론 코드** (방법론 §1.3):
```
현재 도면 + "두께 12로, 구멍 전부 ⌀10, (90,45)에 ⌀6 추가"
  → Gemini EditPatch(setParams/holes.add/removeNearest/setDiameterAll)
  → applyPatch(순수함수: 미지필드·음수·판밖 방어) → gate 검증 → 통과분만 채택
```
- 잘못된 편집(판 밖 구멍 등)은 **게이트가 거부·롤백** — 나쁜 지시가 형상을 못 깬다
- `edit.test.mjs` 5/5 (결정론 적용부, Gemini 불필요) + 라이브 루프 검증

상세(케이스별 증거): `e2e-report.json` / 산출 SCAD: `out/*.scad` (재생성) / 재실행: `node run-e2e.mjs`

## 구성

- `gen-drawing.mjs [count] [seed]` — 3각법 3면도 SVG→PNG(sharp) + GT JSON. 결정론 PRNG로 재현 가능
- `extract.mjs <png>` — Gemini responseSchema 강제 구조화 추출. "치수 숫자를 읽어라, 픽셀 추정 금지 / 비치수 구멍은 대칭·축척으로 계산" 프롬프트
- `reconstruct.mjs` — `gate()`: 범위·판재성·구멍 내접 검사 (AI 산출물은 게이트 통과 후에만 형상화) / `toOpenScad()` / `analyticViews()` (재투영 검증용)
- `run-e2e.mjs` — 전체 평가 파이프라인 + 리포트

## 정직한 한계 (v2)

- **어휘 5종**(plate/stepped/l_bracket/flange/bent_sheet) — 실제 조립도·복잡 부품 미대응
- **합성 도면 한정** — 실스캔·손도면 미검증. 증강 스캔열화는 반영(위 scan 버킷)
- **추출 신뢰성 26% 실패** — 최대 리스크(위 ★). 실도면은 더 낮을 것
- 검증 루프 ④는 analyticViews/픽셀 대조까지 — shape-generator SheetRenderer 정식 연동 잔여
- Gemini 키 `.env` GEMINI_API_KEY, ~1.2k tokens/도면

## 다음 단계 (우선순위)

1. **★ 추출 하드닝** — malformed JSON 26% 감축: 재시도 3회+지수백오프, JSON 리페어(degenerate float 교정), 대안 모델(gemini-2.5-pro/구조화 강한 모델) A/B
2. l_bracket thickness·flange BCD 표기 프롬프트 보강 (undefined 다발 구간)
3. shape-generator intent 스키마 정식 연결 (`to-intent.mjs`가 op:subtract 브리지 — 이미 있음)
4. 실도면(AK 랙 DWG 등) 소량 수기 GT로 실환경 baseline

## 위시빌더 교훈 일반화 배치 (2026-07-17 — #2~#9)

위시빌더 스키드/탱크 실전(260717)에서 사람이 잡던 결함을 제품 경로가 잡도록 이식:

- **설계 타당성 그물 상시 배선(#2)**: `buildAssembly`가 `supportCheck`(부유=설치 불가)·배관 관통/교차를 항상 실행 — `{ support, pipes, designOk }` 반환. preset/assemble/package 라우트와 /design 그물 패널(④b 지지)에 노출.
- **routeGate 비우회화(#3)**: `normalizeRoute`(중복 제거·대각 축분해·동일축 병합, startAxis/endAxis=스텁 축방향 진입 엘보 자동) — `routeFeatures` 기본 적용, 백트랙(역주행) 게이트 추가. 남는 문제는 여전히 거부(adjustments로 정직 보고).
- **부재별 장애물(#4)**: `obstaclesFromAssembly`(부품=부재별, cylinder/tube 축정렬은 round x|y|z 실린더 인식 — y축 추가). 다본 장비 단일 env 근사 금지 규칙의 코드화.
- **면접촉 매립 제안(#5)**: supportCheck가 0겹침 얹힘 쌍에 `faceContacts[].suggestTzMm`(-2mm) 반환. autoPlaceCorrect 드롭도 부품 위엔 0.5mm 매립 착지.
- **배관 어셈블리 승격(#6)**: `assembly.pipes[] = { id, from:'부품id.면', to, d, service }` → `autoRoutePipes`(직결 순열+오버헤드 코리도 후보 → 게이트·관통·교차 전수 검사, 전부 불합격=정직 에러) → GA 3D 계통색·2D 폴리라인·SCAD·STEP 자동 포함. textToAssembly 스키마에도 pipes(+box/cylinder·service) 개방 — AI는 연결 계획만, 경로는 결정론.
- **산출물 정합 게이트(#7)**: package 라우트가 전 HTML에 `nf-basis` 메타+REV 푸터 스탬프(`packageStamp`) 후 `packageConsistencyCheck`로 각 문서가 실제 인쇄한 질량·외형(H)을 회수해 기준과 대조(유체 포함 어셈블리는 자재↔운전질량 차이 정직 스킵). 위시빌더 "카드=REV B vs 도면=REV C" 재발 방지.
- **질량 자기정합(#8)**: structuralCheck `massBreakdown`(최대잔여법 — 표시값 합계=총계 보장)+구조 리포트 ② 질량 내역 표. 845≠835류 자기모순 차단.
- **생성기 스캐폴드(#9)**: 패키지 zip에 `generator.mjs` 동봉 — 어셈블리 JSON 내장 단일 소스, 실행하면 공개 API로 전 산출물 재생성(수기 전사 드리프트 0).

테스트: `pipe-route.test.ts` 40+ (vitest) · `assembly.test.mjs` 8 (node --test). ⚠ scripts 테스트는 `.test.ts`만 vitest가 수집.
