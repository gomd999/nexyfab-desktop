# M7 — 성능 예산 (초안)

**상위:** [M7_ASSEMBLY_SCALE.md](./M7_ASSEMBLY_SCALE.md), `src/lib/assemblyLoadPolicy.ts`.

아래 수치는 **제품이 채워 넣을 목표치**다. CI에서 자동으로 잠그지는 않으며, 벤치마크 후 `assemblyLoadPolicy`와 UI 카피를 함께 조정한다.

## 뷰포트 (파트 수 n = `placedParts` 기준)

| 밴드 | n 구간 | UX 기대 |
|------|--------|---------|
| light | ≤ 12 | 기본 품질·전체 간섭 쌍 검사 허용 |
| warn | 13–24 | 경고 배지·간섭 전 확인 토스트 |
| heavy | 25–48 | LOD 권장·간섭 쌍 상한 안내 |
| extreme | 49+ | 극한 모드·일부 기능 지연 허용 문구 |

정책 상수: `ASSEMBLY_VIEW_THRESHOLDS`, `assemblyViewportLoadBand` (코드 기준).

## 간섭 (쌍 수)

| 밴드 | 대략적 쌍 수 | 정책 |
|------|----------------|------|
| light | ≤ 66 | 즉시 실행 기대 |
| warn | 67–190 | 실행 전 안내 |
| heavy | 191–528 | broad-phase·타임아웃 고려 |
| extreme | 529+ | 사용자 확인 후 실행 권장 |

`assemblyPairwiseComparisonCount`, `ASSEMBLY_INTERFERENCE_THRESHOLDS`, `INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT` (=18)와 정렬.

## 프레임·작업 시간 (예시 목표 — 미확정)

| 항목 | 목표 (데스크톱 크롬, 중간 GPU) |
|------|--------------------------------|
| orbit / pan 유지 | p95 **≤ 33 ms** 프레임 (30 FPS) 이상 구간 비율 ≥ 90% |
| 간섭 1회 (light 밴드) | **≤ 5 s** (워커 완료까지) |
| `.nfab` 열기 (10MB 이하) | **≤ 3 s** 파싱+트리 적용 |

실측 후 이 표를 갱신하고 [CAD_FULLSTACK_MILESTONES.md](./CAD_FULLSTACK_MILESTONES.md) 변경 이력에 남긴다.

## 자동 스모크 (정책 함수만)

- `src/test/m7/assemblyLoadPolicyTiming.test.ts` — `assemblyViewportLoadBand` 등 대량 호출이 **1초 미만**인지 확인(로컬 CPU 기준). 워커·GPU 시간을 대체하지는 않음.

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-30 | 초안 |
