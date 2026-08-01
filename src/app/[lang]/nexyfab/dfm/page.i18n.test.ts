/**
 * page.i18n.test.ts — regression for the unbranched-Korean / lost-locale bug
 * class (same class as commit 7fa0516e, simulator RISK_SCENARIOS; see also
 * nexyfab/orders/page.i18n.test.tsx, nexyfab/billing/page.i18n.test.tsx,
 * nexyfab/rfq/page.i18n.test.tsx).
 *
 * This page gates virtually all of its text on `isKo` (isKorean(lang), binary
 * ko/en — the established convention for nexyfab pages). One exception was
 * found: the module-level `LEVEL_COLORS` map (used to render each DFM issue's
 * error/warning/info badge) hardcoded a single Korean `label` ('오류' / '경고'
 * / '정보') with no language branch at all, so ja/cn/es/ar/en users saw
 * Korean badges regardless of locale.
 *
 * Fixed by splitting `label` into `labelKo`/`labelEn` and adding an exported
 * pure `levelLabel(level, isKo)` helper, tested here directly (the page's
 * default export consumes `params` via `use()`, which this test environment
 * cannot resolve inside a Suspense boundary).
 */

import { describe, it, expect } from 'vitest';
import { levelLabel } from './levelLabel';

describe('levelLabel — DFM issue badge label is language-branched', () => {
  it('isKo=true: Korean labels', () => {
    expect(levelLabel('error', true)).toBe('오류');
    expect(levelLabel('warning', true)).toBe('경고');
    expect(levelLabel('info', true)).toBe('정보');
  });

  it('isKo=false: English labels, no leaked Korean', () => {
    expect(levelLabel('error', false)).toBe('Error');
    expect(levelLabel('warning', false)).toBe('Warning');
    expect(levelLabel('info', false)).toBe('Info');
    for (const level of ['error', 'warning', 'info'] as const) {
      expect(levelLabel(level, false)).not.toMatch(/[가-힣]/);
    }
  });
});
