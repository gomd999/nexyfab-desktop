# NexyFab 3D — B-rep / 위상추적 브라우저 QA 체크리스트

세션 누적 작업(미배포 커밋 `8d21e96`~)의 브라우저 검증용. 항목별로 ✅/❌/메모를 채워 가며 계속 수정.

## 준비
- shape-generator 진입 → **OCCT 엔진은 자동으로 ON** (Wave 1 W3 / ADR-003 — `ShapeGeneratorInner` mount 시점에 `setOcctMode(true)` 자동 호출). 우상단 StatusFooter pill을 보고 `OCCT: ON` 으로 표시되는지 확인.
- 회귀 비교용으로 OCCT OFF 상태가 필요하면 StatusFooter pill을 클릭하여 수동 토글 (디버깅용; 일반 사용자에게는 보이지 않음).
- 이 체크리스트는 Wave 1 **W16** 시점에 본격 실행 — 그 전 단계 (W6-8 모놀리식 분리, W9-12 server OCCT)에서 변경된 동작을 모두 반영하여 검증.

## 체크리스트

| # | 항목 | 커밋 | 기대 결과 | 상태 | 메모 |
|---|------|------|-----------|------|------|
| 1 | base 프리미티브 B-rep fillet | 8d21e96, 038990f, 1b3cbe4 | pipe/torus/disk/cone에 fillet → **실제 형상** 모서리가 둥글어짐(bbox 아님) | ⬜ | |
| 2 | 선택적 fillet/chamfer | 8af773a | 모서리 1개 클릭 → fillet → **그 모서리만** | ⬜ | |
| 3 | sweep/loft/helix 정렬 | 2f78f2b, 1fe7478, 697b8d7, 25a8524 | OCCT ON/OFF에서 **같은 위치·방향**(튐·회전 없음) | ⬜ | |
| 4a | 위상 생존(치수 변경) | 17f9f48, 6aac91d | 모서리 fillet → base 치수 변경 → **같은 모서리 유지** | ⬜ | |
| 4b | 위상 생존(위상 변경) | 6aac91d | 다른 곳 hole 추가 → fillet **유지** | ⬜ | |
| 5a | sketch-on-face 압출 | 8085504, 6af709a | 기울어진 면 클릭 → 스케치 → 사각 압출 → 그 면에 보스/포켓 | ⬜ | |
| 5b | sketch-on-face 원 | 6af709a | 면에 원 스케치 → 실린더 보스/홀 | ⬜ | |
| 5c | sketch-on-face 회전 | 6af709a | 면에 프로파일 → 회전체 | ⬜ | |
| 6 | shell 면 제거 | 2f93e91, fa8ab3a | 면 1개 클릭 → Shell → **그 면이 열림**(top/bottom 고정 아님) | ⬜ | |
| 7 | 선형/원형 패턴 B-rep | 5d6fcac | linear/circular pattern 후에도 fillet 등 B-rep 체인 유지(핸들 보존) | ⬜ | |
| 8 | 미러 B-rep | 5d6fcac | mirror 후에도 B-rep 체인 유지 | ⬜ | |
| 9 | 회귀(OCCT OFF) | — | 기존 mesh 동작 그대로, loft/sweep/pattern/mirror 무변경, 깨짐 없음 | ⬜ | |

## 알려진 비차단 이슈
- `meshTopology.test.ts` 2건 사전 존재 실패(box manifold 분석) — 내 세션 작업과 무관, 빌드/런타임 영향 없음.

## 후속(브라우저 확인 후 결정)
- 축 정렬 측면(yz/xz 평면) 스케치 extrude는 현재 xy만 B-rep, 나머지는 mesh — 필요 시 확장.
- 배포: QA 통과 후 `railway up --service nexyfab.com --detach`.
