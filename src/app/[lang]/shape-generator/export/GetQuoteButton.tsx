'use client';

/**
 * GetQuoteButton.tsx
 *
 * Lay-conversion CTA: once a model exists, surface a plain-language
 * "make it real → get a quote" button floating over the viewport, stacked
 * above the STL download button. This is the highest-intent lay moment — the
 * user just got a model and may want it manufactured — so it routes into the
 * existing RFQ flow (gated: free users hit the upgrade prompt, which is the
 * conversion ask; Pro users open the RFQ panel).
 *
 * Persistent (unlike QuickExportButton it does not self-hide on click, since
 * the click opens the RFQ/upgrade flow) but dismissable.
 */

import React, { useEffect, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';

const HIDE_KEY = 'nexyfab_get_quote_dismissed_v1';

export interface GetQuoteButtonProps {
  lang: string;
  /** True when the pipeline has rendered geometry. */
  hasGeometry: boolean;
  /** Opens the RFQ flow (caller wraps in the rfq plan gate). */
  onRequestQuote: () => void;
}

const COPY = {
  ko: { label: '실물로 만들기', sub: '견적 받기', dismissAria: '견적 버튼 숨기기' },
  en: { label: 'Get it made', sub: 'Request a quote', dismissAria: 'Hide quote button' },
  ja: { label: '実物をつくる', sub: '見積を依頼', dismissAria: '見積ボタンを隠す' },
  zh: { label: '做成实物', sub: '申请报价', dismissAria: '隐藏报价按钮' },
  es: { label: 'Fabricarlo', sub: 'Solicitar presupuesto', dismissAria: 'Ocultar el botón de presupuesto' },
  ar: { label: 'اصنعه فعلياً', sub: 'طلب عرض سعر', dismissAria: 'إخفاء زر عرض السعر' },
} as const;

export default function GetQuoteButton({ lang, hasGeometry, onRequestQuote }: GetQuoteButtonProps) {
  const [dismissed, setDismissed] = useState(true); // start hidden; flip after mount

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(HIDE_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!hasGeometry || dismissed) return null;
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: `ko ? COPY.ko : COPY.en` 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 84,
        right: 28,
        zIndex: 800,
        display: 'flex',
        gap: 6,
        alignItems: 'stretch',
      }}
    >
      <button
        type="button"
        onClick={onRequestQuote}
        aria-label={`${t.label} — ${t.sub}`}
        style={{
          background: '#16a34a',
          color: 'white',
          border: 'none',
          borderRadius: 10,
          padding: '12px 20px',
          cursor: 'pointer',
          boxShadow: '0 8px 22px rgba(22,163,74,0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>🏭</span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{t.label}</span>
          <span style={{ fontSize: 11, opacity: 0.9 }}>{t.sub}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          try { window.localStorage.setItem(HIDE_KEY, 'true'); } catch { /* ok */ }
          setDismissed(true);
        }}
        aria-label={t.dismissAria}
        title={t.dismissAria}
        style={{
          background: '#1e293b',
          color: '#94a3b8',
          border: 'none',
          borderRadius: 10,
          padding: '0 10px',
          cursor: 'pointer',
          fontSize: 16,
        }}
      >
        ✕
      </button>
    </div>
  );
}
