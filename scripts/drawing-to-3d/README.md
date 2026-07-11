# 2D→3D v1 — 도면을 읽어 3D 재구성 (Gemini Vision)

`docs/strategy/drawing-annotation-schema.md` 방법론의 첫 구현. 원칙: **AI=이해, 결정론=형상·검증**.

```
합성 도면 생성(GT 보유) → Gemini 추출(intent JSON) → 기하 게이트 → 결정론 재구성(OpenSCAD) → GT 채점
   gen-drawing.mjs          extract.mjs               reconstruct.mjs(gate)   reconstruct.mjs        run-e2e.mjs
```

## 첫 평가 결과 (2026-07-12, gemini-2.5-flash, temperature 0)

| 지표 | 결과 |
|---|---|
| 외곽 치수 (±0.5mm) | **15/15 (100%)** |
| 구멍 개수 | 5/5 |
| 구멍 위치 (±1mm) — 치수 미기입 구멍의 대칭·축척 추론 포함 | **16/16 (100%)** |
| 구멍 지름 | 16/16 |
| 기하 게이트 통과 | 5/5 |

상세: `e2e-report.json` / 산출 SCAD: `out/*.scad`

## 구성

- `gen-drawing.mjs [count] [seed]` — 3각법 3면도 SVG→PNG(sharp) + GT JSON. 결정론 PRNG로 재현 가능
- `extract.mjs <png>` — Gemini responseSchema 강제 구조화 추출. "치수 숫자를 읽어라, 픽셀 추정 금지 / 비치수 구멍은 대칭·축척으로 계산" 프롬프트
- `reconstruct.mjs` — `gate()`: 범위·판재성·구멍 내접 검사 (AI 산출물은 게이트 통과 후에만 형상화) / `toOpenScad()` / `analyticViews()` (재투영 검증용)
- `run-e2e.mjs` — 전체 평가 파이프라인 + 리포트

## 정직한 한계 (v1)

- **어휘 1종**(plate_with_holes) — 확장 순서: 단차판 → L브래킷 → 플랜지 → 절곡판금
- **깨끗한 합성 도면** — 스캔·손도면·복잡 주석 미검증 (다음: 노이즈·회전·스캔열화 증강)
- 검증 루프 ④(재구성→재투영→drawing-diff 픽셀 대조)는 analyticViews까지만 — SheetRenderer 연동 잔여
- Gemini 호출 비용·키는 `.env` GEMINI_API_KEY, ~1.2k tokens/도면

## 다음 단계

1. 어휘 확장 + 케이스 50장 증강(노이즈·스케일 변형) 평가
2. shape-generator intent 스키마와 정식 연결 (현 v1 스키마는 축소판)
3. 실패 케이스 수집 → 프롬프트/스키마 보강 → 필요 시 합성 GT 파인튜닝
