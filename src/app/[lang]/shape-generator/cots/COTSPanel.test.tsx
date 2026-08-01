// @vitest-environment jsdom
/**
 * COTSPanel — i18n regression.
 *
 * Two hardcoded-English/Korean spots leaked out of the file's own 6-language `dict`:
 *  1. The drawer's close button used a raw `aria-label="Close"` instead of `tt.close`
 *     (every sibling panel in this tree — e.g. ToleranceStackupPanel, ConfigurationsManagerPanel —
 *     routes its close aria-label through the dict).
 *  2. `formatKRW()` appended the literal Korean word '원' after the number, so every
 *     language (en/ja/zh/es/ar) showed prices as e.g. "45원" instead of a currency symbol.
 *     Locks the fix: the ₩ symbol (locale-neutral, same convention as SupplierPanel/CostPanel)
 *     replaces the Korean-only suffix.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import COTSPanel from './COTSPanel';

vi.mock('next/navigation', () => ({ usePathname: () => '/ar/shape-generator' }));

describe('COTSPanel i18n', () => {
  it('localizes the close button aria-label instead of leaving it hardcoded English', () => {
    const { getByLabelText, queryByLabelText } = render(
      <COTSPanel open onClose={() => {}} onInsert={() => {}} lang="ar" />,
    );
    expect(queryByLabelText('Close')).toBeNull();
    expect(getByLabelText('إغلاق')).toBeTruthy();
  });

  it('does not append the Korean word 원 to prices for non-Korean languages', () => {
    const { container } = render(
      <COTSPanel open onClose={() => {}} onInsert={() => {}} lang="ar" />,
    );
    expect(container.textContent).not.toContain('원');
    expect(container.textContent).toContain('₩');
  });
});
