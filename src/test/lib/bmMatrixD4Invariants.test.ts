/**
 * BM Matrix D4 — invariant guard tests.
 *
 * Phase D D4 close target per
 *   docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase D4
 *   docs/strategy/BM_MATRIX_CODE_GAP.md §1-§3
 *
 * Asserts the **lockstep invariants** that any future change must
 * preserve OR explicitly bump:
 *
 *   - BM_MATRIX_STAGE_UI_FEATURE_IDS has exactly 32 unique entries
 *     (bm-matrix.md §1.2 row count contract).
 *   - BM_MATRIX_PLAN_STAGE_GATE_REVISION is a positive integer.
 *   - The gate table structural fingerprint (featureId + planKey only,
 *     in declaration order) is stable — changing it without bumping
 *     the REVISION constant triggers a test failure.
 *
 * The fingerprint approach is intentionally cheap: we don't snapshot
 * the UI matrix cells (those are tested by `bmMatrixStageUi.test.ts`).
 * We only fence the plan-gate hookup so cache invalidation discipline
 * (G-U2) survives refactors.
 */

import { describe, it, expect } from 'vitest';
import {
  BM_MATRIX_PLAN_STAGE_GATE_REVISION,
  BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS,
} from '@/app/[lang]/shape-generator/freemium/planLimits';
import { BM_MATRIX_STAGE_UI_FEATURE_IDS } from '@/lib/bm-matrix-stage-ui';

/** Snapshot encoding the gate table as a single canonical string. */
function gateTableFingerprint(): string {
  return BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS
    .map((g) => `${g.featureId}:${g.planKey}`)
    .join(',');
}

describe('BM matrix D4 invariants', () => {
  it('§1.2 row count = 32 (lockstep with bm-matrix.md, also asserted in bmMatrixStageUi.test.ts)', () => {
    expect(BM_MATRIX_STAGE_UI_FEATURE_IDS.length).toBe(32);
  });

  it('BM_MATRIX_PLAN_STAGE_GATE_REVISION is a positive integer', () => {
    expect(Number.isInteger(BM_MATRIX_PLAN_STAGE_GATE_REVISION)).toBe(true);
    expect(BM_MATRIX_PLAN_STAGE_GATE_REVISION).toBeGreaterThan(0);
  });

  it('Plan-gate table fingerprint is unchanged at REVISION=1 (bump on change)', () => {
    // If you edit BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS, you MUST also:
    //   1. Bump BM_MATRIX_PLAN_STAGE_GATE_REVISION in planLimits.ts
    //   2. Update this snapshot string
    //   3. Update docs/strategy/BM_MATRIX_CODE_GAP.md G-U2 row
    // The triple-touch enforces the §1.2 cache-invalidation discipline.
    const EXPECTED_AT_REV_1 = '17:collaboration,27:ipShareLink,9:branchCompare';
    expect(gateTableFingerprint()).toBe(EXPECTED_AT_REV_1);
  });

  it('Every plan-gate featureId maps into the §1.2 UI matrix (G-U2 cross-table)', () => {
    const ui = new Set(BM_MATRIX_STAGE_UI_FEATURE_IDS);
    for (const { featureId } of BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS) {
      expect(ui.has(featureId)).toBe(true);
    }
  });

  it('Plan-gate planKey enum stays within the documented subset (collaboration/ipShareLink/branchCompare)', () => {
    const allowed = new Set(['collaboration', 'ipShareLink', 'branchCompare']);
    for (const { planKey } of BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS) {
      expect(allowed.has(planKey)).toBe(true);
    }
  });

  it('No duplicate (featureId, planKey) pairs in plan-gate table', () => {
    const seen = new Set<string>();
    for (const { featureId, planKey } of BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS) {
      const k = `${featureId}:${planKey}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});
