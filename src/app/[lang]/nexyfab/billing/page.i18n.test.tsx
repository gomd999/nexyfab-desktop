/**
 * page.i18n.test.tsx — regression for the unbranched-Korean bug class
 * (same class as commit 7fa0516e, simulator RISK_SCENARIOS; see also
 * FabPanel.i18n.test.tsx).
 *
 * This page gates virtually all of its text on `isKo` (isKorean(lang),
 * binary ko/en — the established convention for nexyfab/design-series
 * pages). `fmtKRW()` was the one exception: it appended the Korean word
 * '원' to every plan price with no language branch at all, so en/ja/cn/es/ar
 * visitors saw prices like "49,000원" — Korean text with no English
 * rendering of the currency unit whatsoever. Fixed by gating the suffix on
 * `isKo`, matching the ternary convention used everywhere else in this file,
 * and hoisting the function to module scope (exported) so it's directly
 * testable without going through the page's `use(params)` Suspense render
 * path (which this test env can't resolve — see abandoned page-render
 * attempt in history).
 */

import { describe, it, expect } from 'vitest';
import { fmtKRW } from './fmtKRW';

describe('fmtKRW — currency unit suffix is language-branched', () => {
  it.each(['ja', 'cn', 'es', 'ar', 'en'] as const)('isKo=false (lang=%s): "KRW" suffix, no 원', () => {
    expect(fmtKRW(49_000, false)).toBe('49,000 KRW');
    expect(fmtKRW(49_000, false)).not.toMatch(/원/);
  });

  it('isKo=true: keeps the original 원 suffix', () => {
    expect(fmtKRW(49_000, true)).toBe('49,000원');
  });

  it('zero/null price still branches on isKo (무료/Free), not currency-suffixed', () => {
    expect(fmtKRW(0, true)).toBe('무료');
    expect(fmtKRW(0, false)).toBe('Free');
    expect(fmtKRW(null, true)).toBe('무료');
    expect(fmtKRW(null, false)).toBe('Free');
  });
});
