/**
 * bm-matrix.md §1.2 — 기능 번호별 Stage 컬럼 셀(📌/🔓/🔒)과 최소 해금 Stage.
 * UI·API 게이트에서 공통으로 쓰기 위한 단일 출처(문서와 lockstep 유지).
 */

import type { Stage } from './stage-engine';

const STAGES: readonly Stage[] = ['A', 'B', 'C', 'D', 'E', 'F'];

function stageRank(s: Stage): number {
  return STAGES.indexOf(s);
}

/**
 * §1.2 표의 한 행(기능번호 → A..F 셀 문자열).
 * 행 개수·번호 집합은 docs/strategy/bm-matrix.md 표와 lockstep — 단일 출처는 본 배열.
 */
const BM_MATRIX_UI_ROWS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [1,  ['📌', '📌', '📌', '📌', '📌', '📌']],
  [2,  ['📌', '📌', '📌', '📌', '📌', '📌']],
  [3,  ['📌', '📌', '📌', '📌', '📌', '📌']],
  [5,  ['📌', '📌', '📌', '📌', '📌', '📌']],
  [7,  ['📌', '📌', '📌', '📌', '📌', '📌']],
  [23, ['📌', '📌', '📌', '📌', '📌', '📌']],
  [8,  ['🔒', '🔓', '🔓', '🔓', '🔓', '🔓']],
  [25, ['🔒', '🔓', '🔓', '🔓', '🔓', '🔓']],
  [12, ['🔒', '🔒', '🔓', '🔓', '🔓', '🔓']],
  [21, ['🔒', '🔒', '🔓 티저', '🔓', '🔓', '🔓']],
  [22, ['🔒', '🔒', '🔓', '🔓', '🔓', '🔓']],
  [13, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [14, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [15, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [17, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [20, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [16, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [11, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [9,  ['🔒', '🔒', '🔓', '🔓', '🔓', '🔓']],
  [10, ['🔒', '🔒', '🔒', '🔓', '🔓', '🔓']],
  [18, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [19, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [27, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [28, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [35, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [36, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [37, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [24, ['🔒', '🔒', '🔒', '🔒', '🔓', '🔓']],
  [38, ['🔒', '🔒', '🔒', '🔒', '🔒', '🔓']],
  [39, ['🔒', '🔒', '🔒', '🔒', '🔒', '🔓']],
  [40, ['🔒', '🔒', '🔒', '🔒', '🔒', '🔓']],
  [41, ['🔒', '🔒', '🔒', '🔒', '🔒', '🔓']],
] as const;

/** Stage 컬럼이 있는 기능 번호 목록(표 행 수 = 매트릭스 게이트 적용 기능 수). */
export const BM_MATRIX_STAGE_UI_FEATURE_IDS: readonly number[] = BM_MATRIX_UI_ROWS.map(([id]) => id);

const CELL_BY_FEATURE = new Map<number, readonly string[]>(
  BM_MATRIX_UI_ROWS.map(([id, cells]) => [id, cells]),
);

/**
 * 표에 없는 기능 번호 → null (호출부에서 “매트릭스 외 기능”으로 처리).
 * 티저 열(예: 21번 C열)은 **완전 해금** 기준으로 다음 비티저 🔓 열을 쓴다.
 */
export function minFullUnlockStageForBmMatrixFeature(featureId: number): Stage | null {
  const cells = CELL_BY_FEATURE.get(featureId);
  if (!cells || cells.length !== 6) return null;

  for (let i = 0; i < 6; i++) {
    const cell = cells[i];
    if (cell.includes('📌')) return STAGES[i];
    if (cell.includes('🔓') && !cell.includes('티저')) return STAGES[i];
  }
  for (let i = 0; i < 6; i++) {
    if (cells[i].includes('🔓')) return STAGES[i];
  }
  return 'F';
}

/** `userStage`가 해당 기능의 완전 해금에 도달했는지(동일 Stage면 허용). */
export function userMeetsBmMatrixFeatureStage(userStage: Stage, featureId: number): boolean {
  const min = minFullUnlockStageForBmMatrixFeature(featureId);
  if (min == null) return true;
  return stageRank(userStage) >= stageRank(min);
}
