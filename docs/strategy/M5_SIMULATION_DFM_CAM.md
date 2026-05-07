# M5 — 시뮬레이션·DFM·CAM 브리지 v0 (준비 문서)

**상위 로드맵:** [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) §M5.

## 자동 게이트

- `npm run m5` — `scripts/m5-bridge.mjs`: 타입체크 + `src/test/m5/*.test.ts`.
- `npm run verify`에 M5 단계 포함(M4와 M7 사이).

## 코드 맵 (현재 스모크가 건드리는 경로)

| 영역 | 파일 |
|------|------|
| 선형 정적 FEA(메인 스레드) | `analysis/simpleFEA.ts` — `runSimpleFEA` → `femSolver.runFEM` / 빔 폴백 |
| FEA 워커 | `workers/feaWorker.ts` — `runSimpleFEA` 동적 import |
| DFM 규칙 | `analysis/dfmAnalysis.ts` — `analyzeDFM` |
| CAM 라이트 툴패스 | `analysis/camLite.ts` — `generateCAMToolpaths` |
| G-code / 포스트 | `analysis/gcodeEmitter.ts` — `toGcode`, `analysis/postProcessors/*` |

**보조 문서:** [M5_FEA_TUTORIAL.md](./M5_FEA_TUTORIAL.md), [M5_CAM_EXPORT.md](./M5_CAM_EXPORT.md).

## 완료 정의 (v0 롤링)

- [x] **자동 스모크:** 박스 메시에 대해 DFM 1공정 + FEA 1케이스 + face-mill → G-code 최소 문자열(`m5BridgeSmoke.test.ts`).
- [x] **확장 스모크:** 전 공정 DFM(`m5DfmAllProcesses.test.ts`), 포스트 전종(`m5PostProcessors.test.ts`), FEA 지오메트리 클론(`m5FeaGeometryRoundtrip.test.ts`), CAM contour/pocket(`m5CamOperations.test.ts`).
- [x] FEA **워크플로 UI·재료·하중** 고정 및 튜토리얼 1개 — [M5_FEA_TUTORIAL.md](./M5_FEA_TUTORIAL.md).
- [x] DFM 규칙 ↔ 파라미터 힌트 **통합** 범위 확대 — `analysis/dfmParamMapper.ts` 이슈 타입 ↔ `DFMPanel` `FIX_SUGGESTIONS` 키 정렬 + 추가 이슈 타입 매핑/적용 힌트.
- [x] CAM **STEP/공구 기준 문서** 및 프리셋 출하 정책 — [M5_CAM_EXPORT.md](./M5_CAM_EXPORT.md).

## 수동

- FEA 결과가 물리적으로 타당한지(고정·하중·응력 분포) 샘플 파트로 눈 검증.
- 컨트롤러별 `.nc`를 시뮬레이터/기계에서 1회 이상 검증.
