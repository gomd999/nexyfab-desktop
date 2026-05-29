# Phase C2 — GD&T 방향 정책 (v1)

**Status:** Decision doc (코드 작업 전 정책 고정)
**Date:** 2026-05-29
**상위:** [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) §Phase C2
**관련:** [M4_DRAWING.md](./M4_DRAWING.md) §Phase C1 (조립 도면 v1)

---

## 1. 결정 한 줄 요약

**Phase C 범위에서 GD&T는 모델 → 도면 단방향 export만 한다.** 도면에서
모델로의 양방향 동기화는 Phase D에서 다룬다.

근거:
- C1 조립 도면 v1이 막 들어옴 → 양방향 동기 추가 시 도면 코드 surface
  blast radius가 큼.
- 단방향 export만으로도 PDF/DXF/SVG 출하 + 외부 뷰어 가독성 회귀를
  닫을 수 있다 (상용 게이트 통과의 load-bearing 부분).
- 양방향은 도면의 GD&T edit이 모델 ToleranceSpec/RoughnessSpec에 반영
  돼야 하므로 (a) UI 양방향, (b) 충돌 처리 정책, (c) revision 자동
  bump 정책이 세트로 필요 → Phase D 일감.

---

## 2. v1 단방향 contract

`autoDrawing.DrawingConfig.tolerance` (ToleranceSpec) + `roughness`
(RoughnessSpec[]) 는 이미 model-side에서 도면 생성 시 텍스트로 export
된다. C2 v1 추가:

| 항목 | 동작 |
|---|---|
| 모델 ToleranceSpec 변경 → 다음 도면 생성 시 반영 | ✅ 기존 동작 유지 |
| 도면에서 dimension 텍스트 수동 편집 | ⚠️ UI에서 차단 (read-only); 편집은 모델 ToleranceSpec에서 해야 함 |
| GD&T 심볼 입력 (datum frame, FCF) | model-side `ToleranceSpec` 확장 → export | 
| 리비전 자동 bump | titleBlock.revision 변경 시 도면 재생성 권장 표시 (drawingStaleHint와 별도 채널) |

---

## 3. PDF/DXF/SVG 일관성 회귀 (C2 완료 정의의 일부)

CAD_COMMERCIAL_COMPLETION_ROADMAP §Phase C2 요구: "PDF/DXF/SVG 일관성
회귀 확대". 현행 스모크는 형태 존재만 확인. C2 v1 추가:

- [ ] 동일 모델에 대해 PDF/DXF/SVG 각각의 dimension text가 한 줄씩
      정확히 같은 문자열인지 (대소문자·단위 기호 포함)
- [ ] roughness 심볼이 세 포맷에서 동일 위치(상대좌표)에 있는지
- [ ] revision 문자열이 세 포맷에서 동일한지

이 회귀는 Vitest로 가능 — `drawingExport.ts` 함수들을 호출해 결과
문자열/바이트를 비교한다.

---

## 4. 양방향 흡수 시점 (Phase D candidate)

Phase D 진입 시 다음 트리거 중 하나가 충족되면 양방향을 검토한다:

- 고객 N명이 "도면에서 GD&T 수정 안 됨" 피드백을 누적적으로 제기
- M5 FEA/CAM workflow에서 도면 ToleranceSpec → 모델 fit 검사가
  필요해짐
- MBD (Model-Based Definition) 요구사항이 신규 고객 contracts에 들어옴

양방향이 들어오면:
- DrawingConfig에 `editMode: 'readonly' | 'sync'` 필드 추가
- editMode=sync일 때 도면 텍스트 편집 → model ToleranceSpec patch 통과
- 자동 revision bump 정책 결정 (수동 vs 자동)
- 충돌 처리 (도면이 stale인데 사용자가 편집 시도) 정책 결정

---

## 5. 회귀 / 게이트

- 단방향 export 회귀: `src/test/m4/drawingExportSmoke.test.ts` + 신규
  `phaseC2ConsistencyMatrix.test.ts` (PDF/DXF/SVG 문자열 동일성)
- 자동 게이트: `npm run m4`
- 수동 게이트: 외부 PDF 뷰어 (Acrobat, macOS Preview) + AutoCAD/
  LibreCAD에서 DXF가 깨지지 않는지 (M4_DRAWING.md §수동 항목)

---

## 6. 후속 (Phase D)

| 항목 | Phase D 트리거 |
|---|---|
| 도면→모델 양방향 sync | 고객 피드백 누적 또는 MBD 계약 |
| Auto-balloon 배치 | 조립 도면 사용량 증가 |
| Section view / detail view | 비-박스 솔리드 export 후 |
| 멀티 sheet 출력 | 대형 어셈블리 (>10 parts) 출시 직전 |

C2는 v1에서 **단방향 + 일관성 회귀 닫기**가 전부. Over-engineering
없이 게이트만 깔끔하게 통과한다.
