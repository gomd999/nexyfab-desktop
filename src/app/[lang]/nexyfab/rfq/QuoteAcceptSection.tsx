// Sibling module (not inside page.tsx) — Next.js Page files may only export the
// default component + a small allow-list (generateMetadata, etc). Exporting a
// component/helper straight from page.tsx fails `next build`'s TypeScript
// route-type check even though local `tsc --noEmit` doesn't catch it.
//
// Rendered in isolation for i18n regression tests — see page.i18n.test.tsx.
// Unlike the page default export, this component doesn't consume `params`
// via `use()`, so it renders synchronously without a Suspense boundary.
'use client';

import { useEffect, useState } from 'react';
import QuoteComparisonView from './QuoteComparisonView';
import { formatNumber } from '@/lib/i18n/format';
import { toIsoLang } from '@/lib/i18n/normalize';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

const C = {
  bg: 'var(--nx-bg)',
  surface: 'var(--nx-panel)',
  card: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  textDim: 'var(--nx-text-2)',
  textMuted: 'var(--nx-text-3)',
  accent: 'var(--nx-accent)',
  green: 'var(--nx-ok)',
  yellow: 'var(--nx-warn)',
  red: 'var(--nx-error)',
};

interface QuoteForRFQ {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  status: string;
  validUntil: string | null;
}

/** Unit suffix must follow the isKo branch: this used to append the Korean
 * word '원' unconditionally, so non-Korean users saw prices like "49,000원"
 * with no English rendering of the currency unit at all. */
export function formatQuoteAmount(n: number, lang: string | boolean): string {
  const inputLang = typeof lang === 'boolean' ? ({ true: 'ko', false: 'en' } as const)[String(lang) as 'true' | 'false'] : lang;
  const iso = toIsoLang(inputLang);
  const suffix: Record<string, string> = { ko: '원', en: ' KRW', ja: ' KRW', zh: ' KRW', es: ' KRW', ar: ' KRW' };
  return `${formatNumber(n, iso) ?? ''}${suffix[iso]}`;
}

export function QuoteAcceptSection({
  rfqId, isKo, lang, onAccepted,
}: { rfqId: string; isKo: boolean; lang: string; onAccepted: (amount: number, factoryName: string) => void }) {
  const uiLang = toIsoLang(lang || (typeof document !== 'undefined' ? document.documentElement.lang : ({ true: 'ko', false: 'en' } as const)[String(isKo) as 'true' | 'false']));
  const copy = (ko: string, en: string) => createCommercialLocalizer(uiLang)(ko, en);
  const accessible = ({ true: { accept: '✓ 수락', progress: '주문 진행 상황 보기 →' }, false: { accept: '✓ Accept', progress: 'View order progress →' } } as const)[String(isKo) as 'true' | 'false'];
  const [quotes, setQuotes] = useState<QuoteForRFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // B6 — Capture orderId returned from accept so we can deep-link the
  // user to track their order. The PATCH endpoint creates nf_orders
  // automatically; previously the UI just said "accepted" with no link.
  const [orderIdFromAccept, setOrderIdFromAccept] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/nexyfab/rfq/${rfqId}/quotes`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { quotes?: QuoteForRFQ[] } | null) => {
        setQuotes((d?.quotes ?? []).filter(q => q.status !== 'rejected'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rfqId]);

  async function handleAction(quoteId: string, action: 'accept' | 'reject') {
    setActingId(quoteId);
    try {
      const r = await fetch(`/api/nexyfab/rfq/${rfqId}/quotes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quoteId, action }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json().catch(() => ({} as Record<string, unknown>));
      if (action === 'accept') {
        const q = quotes.find(x => x.id === quoteId);
        if (q) onAccepted(q.estimatedAmount, q.factoryName);
        // B6 — surface the auto-created order id so the user can jump to tracking.
        if (typeof (data as { orderId?: unknown }).orderId === 'string') {
          setOrderIdFromAccept((data as { orderId: string }).orderId);
        }
        setDone(true);
      } else {
        setQuotes(prev => prev.filter(q => q.id !== quoteId));
      }
    } catch {
      alert(copy('처리 중 오류가 발생했습니다.', 'An error occurred.'));
    } finally {
      setActingId(null);
    }
  }

  if (done) {
    return (
      <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}30`, borderRadius: 8, padding: '14px 18px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: C.green }}>
          ✅ {copy('견적을 수락했습니다. 제조사에 알림을 보냈습니다.', 'Quote accepted. Manufacturer notified.')}
        </p>
        {orderIdFromAccept && (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: C.textMuted }}>
              {copy('주문이 자동 생성되었습니다', 'Order auto-created')} ·{' '}
              <code style={{ background: 'var(--nx-panel)', padding: '2px 6px', borderRadius: 4, color: C.text }}>{orderIdFromAccept}</code>
            </p>
            <a
              href={`/${lang}/nexyfab/orders/${orderIdFromAccept}`}
              style={{
                display: 'inline-block',
                padding: '8px 16px', fontSize: 12, fontWeight: 700,
                borderRadius: 7, textDecoration: 'none',
                background: C.green, color: '#fff',
              }}
              aria-label={accessible.progress}
            >
              {copy('주문 진행 상황 보기 →', 'View order progress →')}
            </a>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: `#388bfd10`, border: `1px solid ${C.accent}30`, borderRadius: 10, padding: '12px 14px' }}>
      <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 800, color: C.accent }}>
        💬 {copy('제조사 견적이 도착했습니다. 수락 또는 거절해주세요.', 'Manufacturer quote(s) arrived. Accept or decline.')}
      </p>

      {loading && <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{copy('불러오는 중...', 'Loading...')}</p>}
      {!loading && quotes.length === 0 && (
        <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>
          {copy('견적이 없습니다.', 'No quotes available.')}
        </p>
      )}

      {/* B5 — Side-by-side comparison shown when 2+ quotes are available. */}
      {!loading && quotes.length >= 2 && (
        <QuoteComparisonView
          lang={uiLang}
          quotes={quotes}
          acting={actingId}
          onAction={(id, action) => void handleAction(id, action)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quotes.map(q => (
          <div key={q.id} style={{
            background: C.card, borderRadius: 8, padding: '10px 12px',
            border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: C.text }}>{q.factoryName}</p>
              <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
                {formatQuoteAmount(q.estimatedAmount, lang)}
                {q.estimatedDays ? ` · ${q.estimatedDays}${copy('일', 'd')}` : ''}
                {q.note ? ` · ${q.note}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => void handleAction(q.id, 'accept')}
                disabled={actingId === q.id}
                aria-label={accessible.accept}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                  border: 'none', background: C.green, color: '#fff',
                  cursor: actingId === q.id ? 'wait' : 'pointer', opacity: actingId === q.id ? 0.6 : 1,
                }}
              >
                {actingId === q.id ? '...' : copy('✓ 수락', '✓ Accept')}
              </button>
              <button
                onClick={() => void handleAction(q.id, 'reject')}
                disabled={!!actingId}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  border: `1px solid ${C.red}55`, background: 'transparent', color: C.red,
                  cursor: actingId ? 'not-allowed' : 'pointer', opacity: actingId ? 0.5 : 1,
                }}
              >
                {copy('✕ 거절', '✕ Decline')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
