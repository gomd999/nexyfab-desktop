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
| `extract_drawing` | 도면 PNG 경로 → 파라메트릭 intent | 필요 |
| `edit_drawing` | intent + 자연어 지시 → 편집본(게이트 검증) | 필요 |
| `reconstruct_3d` | intent → OpenSCAD + ComponentIntent + 게이트 | 결정론 |

**체인 검증됨**: extract(이미지→intent) → edit("두께 20, 구멍 ⌀10") → reconstruct(→SCAD) 전 구간 MCP 통해 작동. 잘못된 편집은 reconstruct 게이트가 거부. 범위=어휘 5종·깨끗한 도면. (입력이 텍스트가 아니라 **도면 이미지** — 텍스트→도면 입구 B는 미구현)

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
