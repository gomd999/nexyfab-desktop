/**
 * 무거운 테스트의 벽시계 예산 — **격리 실행 실측치에서 유도**한다 (260728 §6-4).
 *
 * 배경 (실측):
 * 전체 스위트(1,792파일 · 23,673테스트)를 병렬로 돌리면 몇몇 FEA/퍼즈 테스트가
 * `Error: Test timed out` 으로 죽는다. 260727 인수인계는 이걸 "예산에 걸려 반복이 잘린 것
 * (converged:false)" 으로 추정했으나 **틀렸다** — 실패 문구는 vitest 의 testTimeout 이고,
 * 이 경로들은 `runFEM` 에 `solveDeadlineMs` 를 넘기지 않아 솔버의 벽시계 가드가 비활성이다.
 * 즉 **FEA 예산 상수를 올려도 이 실패는 그대로다.**
 *
 * 관측된 규칙(격리 실행 실측 / vitest 전역 캡 60s):
 *   | 테스트                          | 격리   | 여유   | 전체 병렬에서 |
 *   | plate-hole Kt (A5, voxel)      | 38.9s | 1.54× | 죽음 |
 *   | plate-hole Kt (M1, graded)     | 38.9s | 1.54× | 죽음 |
 *   | buckling steel>ABS             | 37.8s | 1.59× | 죽음 |
 *   | featurePipelineFuzz            | 85.0s | 1.41× | 죽음 (캡 120s) |
 *   | buckling 패널 어댑터            | 18.1s | 3.3×  | 삶  |
 *   | buckling 미지 키 폴백           | 17.8s | 3.4×  | 삶  |
 * → 경합 배수가 대략 **1.6배 이상**이고, 여유 1.6배 이하인 것들이 정확히 넘친다.
 *
 * 그래서 전역 캡을 올리지 않는다 — 60s 는 나머지 23,000여 테스트의 행(hang) 가드로 유효하고,
 * 그걸 낮추면 진짜 무한루프가 CI 를 붙잡는다. 대신 무거운 테스트만 **자기 실측치를 근거로**
 * 예산을 선언한다. 인자가 "격리 실행에서 몇 ms 걸렸나" 하나뿐인 것이 핵심이다:
 * 매직 넘버 대신 **측정치**가 코드에 남고, 값을 바꾸려면 다시 재야 한다.
 */

/**
 * 경합 여유 배수. 실측 경합 배수(≥1.6)에 넉넉한 안전여유를 더한 값이다.
 * 이 상수를 내리려면 전체 스위트 병렬 실행으로 먼저 재현/반증할 것 —
 * "테스트가 느리다"는 체감으로 내리면 플레이크가 그대로 돌아온다.
 */
export const CONTENTION_MARGIN = 6;

/**
 * 격리 실행 실측 ms → 전체 스위트 병렬 실행에서 쓸 벽시계 예산 ms.
 * @param isolatedMs 이 테스트만 단독 실행했을 때의 실측 소요(ms). 추정치가 아니라 **실측**.
 */
export function heavyTestBudgetMs(isolatedMs: number): number {
  if (!Number.isFinite(isolatedMs) || isolatedMs <= 0) {
    throw new RangeError(`heavyTestBudgetMs: 격리 실측치(ms)가 필요하다 — 받은 값 ${isolatedMs}`);
  }
  return Math.ceil(isolatedMs * CONTENTION_MARGIN);
}
