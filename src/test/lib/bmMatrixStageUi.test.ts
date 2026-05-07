import { describe, it, expect } from 'vitest';
import {
  BM_MATRIX_STAGE_UI_FEATURE_IDS,
  minFullUnlockStageForBmMatrixFeature,
  userMeetsBmMatrixFeatureStage,
} from '@/lib/bm-matrix-stage-ui';

describe('bm-matrix-stage-ui §1.2', () => {
  it('§1.2 Stage 매트릭스 행 수·번호 유일 — 문서 bm-matrix.md 표와 lockstep', () => {
    expect(BM_MATRIX_STAGE_UI_FEATURE_IDS.length).toBe(32);
    const sorted = [...BM_MATRIX_STAGE_UI_FEATURE_IDS].sort((a, b) => a - b);
    const unique = new Set(sorted);
    expect(unique.size).toBe(32);
  });

  it('항상 노출 기능은 A부터', () => {
    expect(minFullUnlockStageForBmMatrixFeature(1)).toBe('A');
  });

  it('8 HS Code — B부터 해금', () => {
    expect(minFullUnlockStageForBmMatrixFeature(8)).toBe('B');
    expect(userMeetsBmMatrixFeatureStage('A', 8)).toBe(false);
    expect(userMeetsBmMatrixFeatureStage('B', 8)).toBe(true);
  });

  it('21 마진 분해 — 티저 다음 열(D)이 완전 해금', () => {
    expect(minFullUnlockStageForBmMatrixFeature(21)).toBe('D');
    expect(userMeetsBmMatrixFeatureStage('C', 21)).toBe(false);
    expect(userMeetsBmMatrixFeatureStage('D', 21)).toBe(true);
  });

  it('38 Webhook — F만', () => {
    expect(minFullUnlockStageForBmMatrixFeature(38)).toBe('F');
    expect(userMeetsBmMatrixFeatureStage('E', 38)).toBe(false);
    expect(userMeetsBmMatrixFeatureStage('F', 38)).toBe(true);
  });

  it('표에 없는 번호는 null → 게이트 미적용', () => {
    expect(minFullUnlockStageForBmMatrixFeature(999)).toBe(null);
    expect(userMeetsBmMatrixFeatureStage('A', 999)).toBe(true);
  });
});
