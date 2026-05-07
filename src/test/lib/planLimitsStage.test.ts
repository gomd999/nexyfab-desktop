import { describe, it, expect } from 'vitest';
import {
  BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS,
  getPlanLimits,
  mergePlanLimitsWithBmStage,
} from '@/app/[lang]/shape-generator/freemium/planLimits';
import { BM_MATRIX_STAGE_UI_FEATURE_IDS } from '@/lib/bm-matrix-stage-ui';

describe('mergePlanLimitsWithBmStage', () => {
  const team = getPlanLimits('team');

  it('플랜×Stage 게이트 행 번호는 §1.2 매트릭스에 존재(G-U2 중복 방지)', () => {
    const ui = new Set(BM_MATRIX_STAGE_UI_FEATURE_IDS);
    for (const { featureId } of BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS) {
      expect(ui.has(featureId)).toBe(true);
    }
  });

  it('Stage C — 팀 플랜이어도 협업·IP는 §1.2 D/E 미만이면 off (견적 비교 9번은 C부터)', () => {
    const m = mergePlanLimitsWithBmStage(team, 'C');
    expect(m.collaboration).toBe(false);
    expect(m.ipShareLink).toBe(false);
    expect(m.branchCompare).toBe(true);
  });

  it('Stage E — 협업·IP·견적 비교 해금', () => {
    const m = mergePlanLimitsWithBmStage(team, 'E');
    expect(m.collaboration).toBe(true);
    expect(m.ipShareLink).toBe(true);
    expect(m.branchCompare).toBe(true);
  });
});
