/**
 * page.i18n.test.tsx — regression for the unbranched-Korean bug class
 * (same class as commit 7fa0516e, simulator RISK_SCENARIOS; see also
 * nexyfab/billing/page.i18n.test.tsx, FabPanel.i18n.test.tsx).
 *
 * This page gates virtually all of its text on `isKo` (isKorean(lang),
 * binary ko/en — the established convention for nexyfab pages). Two
 * exceptions were found with no language branch at all:
 *
 *  1. `DEMO_ORDERS` (the unauthenticated fallback demo dataset) had its
 *     `partName`/`manufacturerName` hardcoded in Korean with no English
 *     counterpart, so en/ja/cn/es/ar visitors browsing without an account
 *     saw raw Korean product/company names. `getDemoOrders(lang)` now selects
 *     a locale-specific demo product/manufacturer set.
 *  2. `OrderCard`'s `fmtKRW()` unconditionally appended the Korean word '원'
 *     to every amount (same bug class already fixed once in
 *     nexyfab/billing/page.tsx's own `fmtKRW`). Fixed the same way, and
 *     hoisted to module scope (exported) so it's directly testable without
 *     going through the page's `use(params)` Suspense render path (which
 *     this test env can't resolve — see billing/page.i18n.test.tsx's note).
 */

import { describe, it, expect } from 'vitest';
import { fmtKRW, getDemoOrders } from './orderHelpers';

describe('fmtKRW — currency unit suffix is language-branched', () => {
  it.each(['ja', 'cn', 'es', 'ar', 'en'] as const)('isKo=false (lang=%s): "KRW" suffix, no 원', () => {
    expect(fmtKRW(4_500_000, false)).toBe('4,500,000 KRW');
    expect(fmtKRW(4_500_000, false)).not.toMatch(/원/);
  });

  it('isKo=true: keeps the original 원 suffix', () => {
    expect(fmtKRW(4_500_000, true)).toBe('4,500,000원');
  });
});

describe('getDemoOrders — demo part/manufacturer names are language-branched', () => {
  it('isKo=true: returns the original Korean names unchanged', () => {
    const orders = getDemoOrders(true);
    expect(orders.map(o => o.partName)).toEqual([
      '알루미늄 브라켓 A-100',
      '스테인리스 플랜지 SUS304',
      'CNC 선삭 축 φ25×300',
    ]);
    expect(orders.map(o => o.manufacturerName)).toEqual([
      '대우정밀 주식회사',
      '한국정밀가공 협동조합',
      '삼성정밀 기계',
    ]);
  });

  it('isKo=false: returns English names, no Korean (Hangul) leakage', () => {
    const orders = getDemoOrders(false);
    const hangul = /[가-힣]/;
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(o.partName).not.toMatch(hangul);
      expect(o.manufacturerName).not.toMatch(hangul);
    }
    expect(orders.map(o => o.partName)).toEqual([
      'Aluminum Bracket A-100',
      'Stainless Flange SUS304',
      'CNC Turned Shaft φ25×300',
    ]);
    expect(orders.map(o => o.manufacturerName)).toEqual([
      'Daewoo Precision Co., Ltd.',
      'Korea Precision Machining Cooperative',
      'Samsung Precision Machinery',
    ]);
  });

  it('isKo=false: every other order field is unchanged from the ko dataset', () => {
    const ko = getDemoOrders(true);
    const en = getDemoOrders(false);
    expect(en.map(o => ({ ...o, partName: undefined, manufacturerName: undefined })))
      .toEqual(ko.map(o => ({ ...o, partName: undefined, manufacturerName: undefined })));
  });

  it('localizes product names for every supported non-English locale', () => {
    expect(getDemoOrders('ja')[0]?.partName).toBe('アルミブラケット A-100');
    expect(getDemoOrders('cn')[1]?.partName).toBe('不锈钢法兰 SUS304');
    expect(getDemoOrders('es')[2]?.partName).toBe('Eje torneado CNC φ25×300');
    expect(getDemoOrders('ar')[0]?.partName).toBe('حامل ألمنيوم A-100');
  });
});
