# M4 — 2D 도면·MBD v0 (준비 문서)

**상위 로드맵:** [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M4.

## 자동 게이트

- `npm run m4` — `scripts/m4-drawing.mjs`: 타입체크 + `src/test/m4/*.test.ts`.
- `npm run verify`에 M4 단계 포함.

## 코드 맵

| 영역 | 파일 |
|------|------|
| 투영·다뷰 레이아웃·타이틀 블록 | `src/app/[lang]/shape-generator/analysis/autoDrawing.ts` — `generateDrawing` |
| 3D→도면 “소스” 지문(불일치 힌트용) | 동 파일 — `computeDrawingGeometryFingerprint` |
| UI 패널 | `analysis/AutoDrawingPanel.tsx` |
| PDF / DXF / SVG 내보내기 | nalysis/drawingExport.ts — uildDrawingPdfArrayBuffer, uildDrawingDxfString, uildDrawingSvgString (+ UI는 exportDrawingPDF / exportDrawingDXF; SVG는 exportDrawingSVG 또는 패널 직렬화) |

## 완료 정의 (v0 롤링)

- [x] 대표 파트(박스 스모크) **PDF + DXF + SVG 문자열** 출하 경로: UI 다운로드와 동일 로직을 `src/test/m4/drawingExportSmoke.test.ts`·`drawingSvgSmoke.test.ts`에서 검증.
- [x] `generateDrawing` 최소 회귀: 단일 뷰 + 다중 정투영 뷰(`src/test/m4/autoDrawingSmoke.test.ts`).
- [x] 모델 변경 시 도면 **불일치 경고**: `AutoDrawingPanel`에서 생성 직후 지문 저장, 현재 지문과 다르면 주황 배너(`drawingStaleHint`).

## Phase C1 — 도면 v1 게이트 (상용 로드맵 대비 갭)

[CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) Phase **C1** 기준으로, v0와의 **의도적 갭**을 한곳에 둔다.

| 항목 | v0 (현재) | C1 목표 |
|------|-----------|---------|
| 입력 | 단일 파트 기하 지문(`computeDrawingGeometryFingerprint`) | **어셈블리·BOM** 기준 조합 도면 최소 1케이스 + 지문 정책 |
| 리비전·표제란 | UI/보내기에 기본 필드 | **리비전 블록·스케일 정책**을 문서·코드에서 단일 소스로 고정 |
| 회귀 | `npm run m4` 스모크 | 조립 도면 시나리오 Vitest(또는 E2E) **1건 이상** 추가 — 지문 최소 회귀: `src/test/m4/phaseC1GeometryFingerprint.test.ts` |

구현 시 `autoDrawing.ts`의 `generateDrawing` 시그니처·`drawingExport.ts`와 M3 `placedParts`/BOM 경로를 함께 설계한다.

## 수동 (인쇄·협업 품질)

자동 게이트가 **기능 회귀**를 보장하고, 아래는 **용지·가독성·표기** 등 눈으로 확인하는 롤링 항목이다.

1. **기준 파트** — 갤러리 박스 또는 단순 가공 파트 1건.
2. **용지·스케일** — A4/A3, 가로·세로 전환 시 시트 테두리·뷰가 잘리지 않는지.
3. **뷰** — 정투영 + 등각 선택 시 레이아웃·라벨 가독성.
4. **치수·중심선** 옵션 켠 상태에서 선·텍스트 겹침이 과하지 않은지.
5. **표제란** — 부품명·재질·스케일·리비전이 PDF/DXF/SVG에 일관되는지.
6. **내보내기** — PDF·DXF를 뷰어(브라우저·CAD)에서 열어 선이 깨지지 않는지.
7. **불일치 배너** — 도면 생성 후 파라미터를 바꾸면 주황 힌트가 뜨고, 다시 생성하면 사라지는지.

**브라우저 스모크(선택):** `npm run test:e2e:m4` 또는 `npx playwright test e2e/m4-auto-drawing.spec.ts --project=chromium`.  
전체 릴리스 검증에 포함: `VERIFY_E2E=1` + `CI=true` 또는 `E2E_BASE_URL` 로 `npm run verify:e2e` 시 위 스펙이 chromium에서 함께 실행됨(`scripts/verify-milestones.mjs`).
