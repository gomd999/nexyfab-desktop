// @vitest-environment jsdom
/**
 * page.i18n.test.tsx — regression for the unbranched-Korean / lost-locale bug
 * class (same class as commit 7fa0516e, simulator RISK_SCENARIOS; see also
 * nexyfab/orders/page.i18n.test.tsx, nexyfab/billing/page.i18n.test.tsx).
 *
 * This page gates virtually all of its text on `isKo` (isKorean(lang), binary
 * ko/en — the established convention for nexyfab pages). Two exceptions were
 * found:
 *
 *  1. `QuoteAcceptSection`'s inline quote-amount line unconditionally
 *     appended the Korean word '원' with no language branch at all (same bug
 *     class already fixed once in nexyfab/billing/page.tsx's `fmtKRW`).
 *     Extracted to a module-level `formatQuoteAmount(n, isKo)`, tested here
 *     as a pure function.
 *  2. The "View order progress" link (shown after accepting a quote) built
 *     its locale segment as `isKo ? 'kr' : 'en'` instead of using the real
 *     `lang` route param, so ja/cn/es/ar users who accepted a quote were
 *     bounced to the **English** order-tracking page instead of their own
 *     locale. Fixed by threading `lang` down from RFQContent -> RFQCard ->
 *     QuoteAcceptSection and using it directly in the href.
 *
 * `QuoteAcceptSection` is rendered directly (not through the page's default
 * export) because the page consumes `params` via React's `use()`, which this
 * test environment cannot resolve inside a Suspense boundary (see
 * billing/page.i18n.test.tsx's note on the abandoned page-render attempt).
 * `QuoteAcceptSection` itself takes plain props and has no such dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatQuoteAmount, QuoteAcceptSection } from './QuoteAcceptSection';

describe('formatQuoteAmount — currency unit suffix is language-branched', () => {
  it.each(['ja', 'cn', 'es', 'ar', 'en'] as const)('isKo=false (lang=%s): "KRW" suffix, no 원', () => {
    expect(formatQuoteAmount(1_000_000, false)).toBe('1,000,000 KRW');
    expect(formatQuoteAmount(1_000_000, false)).not.toMatch(/원/);
  });

  it('isKo=true: keeps the original 원 suffix', () => {
    expect(formatQuoteAmount(1_000_000, true)).toBe('1,000,000원');
  });
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

const QUOTES = { quotes: [{
  id: 'Q1', factoryName: 'Acme Precision', estimatedAmount: 1_000_000,
  estimatedDays: 14, note: null, status: 'pending', validUntil: null,
}] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u === '/api/nexyfab/rfq/RFQ1/quotes' && method === 'GET') return Promise.resolve(jsonResponse(QUOTES));
    if (u === '/api/nexyfab/rfq/RFQ1/quotes' && method === 'PATCH') return Promise.resolve(jsonResponse({ orderId: 'ORD1' }));
    return Promise.resolve(jsonResponse({}, false));
  }));
});

describe('QuoteAcceptSection — quote amount currency unit is language-branched', () => {
  it.each(['en', 'ja', 'cn', 'es', 'ar'])('lang=%s (isKo=false): quote amount shows a "KRW" suffix, not the Korean word 원', async (lang) => {
    const { container } = render(
      <QuoteAcceptSection rfqId="RFQ1" isKo={false} lang={lang} onAccepted={() => {}} />,
    );
    await screen.findByText('Acme Precision');
    expect(container.textContent).toContain('KRW');
    expect(container.textContent).not.toMatch(/원/);
  });

  it('lang=kr (isKo=true): quote amount keeps the original 원 suffix', async () => {
    const { container } = render(
      <QuoteAcceptSection rfqId="RFQ1" isKo={true} lang="kr" onAccepted={() => {}} />,
    );
    await screen.findByText('Acme Precision');
    expect(container.textContent).toMatch(/원/);
  });
});

describe('QuoteAcceptSection — post-accept order link preserves the real route locale', () => {
  it.each(['en', 'ja', 'cn', 'es', 'ar', 'kr'])('lang=%s: "view order progress" link uses the real lang segment, not a hardcoded kr/en split', async (lang) => {
    const isKo = lang === 'kr';
    render(<QuoteAcceptSection rfqId="RFQ1" isKo={isKo} lang={lang} onAccepted={() => {}} />);
    const acceptButton = await screen.findByRole('button', { name: isKo ? '✓ 수락' : '✓ Accept' });
    fireEvent.click(acceptButton);
    const link = await screen.findByRole('link', { name: isKo ? /주문 진행 상황/ : /view order progress/i });
    expect(link.getAttribute('href')).toBe(`/${lang}/nexyfab/orders/ORD1`);
  });
});
