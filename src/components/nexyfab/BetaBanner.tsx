'use client';

/**
 * BetaBanner — surfaces a feature's known limitations to the user.
 *
 * Mounted on tool pages whose backend has been beta-gated. Reads the
 * server-side BETA_FEATURES registry via /api/feature-flags so adding a
 * new beta feature only requires touching one file.
 *
 * Design intent: explicit, dismissible-per-session, and never blocks the
 * UI. Users can keep using the feature; they just know what to expect.
 */
import React, { useEffect, useState } from 'react';

interface BetaFeature {
  feature: string;
  reason: string;
  limitations: string[];
  workaround?: string;
}

interface ApiResp {
  features?: Record<string, BetaFeature>;
}

const DISMISS_KEY_PREFIX = 'beta-banner-dismissed:';

export default function BetaBanner({ feature, lang = 'ko' }: { feature: string; lang?: 'ko' | 'en' }) {
  const [info, setInfo] = useState<BetaFeature | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissedAt = sessionStorage.getItem(DISMISS_KEY_PREFIX + feature);
    if (dismissedAt) return;
    queueMicrotask(() => setDismissed(false));
    void (async () => {
      try {
        const res = await fetch('/api/feature-flags');
        if (!res.ok) return;
        const data = await res.json() as ApiResp;
        const f = data.features?.[feature];
        if (f) setInfo(f);
      } catch { /* silent */ }
    })();
  }, [feature]);

  if (dismissed || !info) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY_PREFIX + feature, String(Date.now()));
    setDismissed(true);
  };

  const t = lang === 'ko' ? {
    badge: 'BETA',
    limitations: '알려진 제약',
    workaround: '대안',
    dismiss: '닫기',
  } : {
    badge: 'BETA',
    limitations: 'Known limitations',
    workaround: 'Workaround',
    dismiss: 'Dismiss',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={badgeStyle}>{t.badge}</span>
        <strong style={featureStyle}>{info.feature}</strong>
        <button onClick={dismiss} style={dismissBtnStyle} aria-label={t.dismiss}>×</button>
      </div>
      <div style={reasonStyle}>{info.reason}</div>
      <div style={limitsHeaderStyle}>{t.limitations}:</div>
      <ul style={limitsListStyle}>
        {info.limitations.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {info.workaround && (
        <div style={workaroundStyle}>
          <strong>{t.workaround}:</strong> {info.workaround}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  margin: '12px 0',
  padding: 14,
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 10,
  fontSize: 12,
  color: '#78350f',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
};
const badgeStyle: React.CSSProperties = {
  padding: '2px 8px', fontSize: 10, fontWeight: 800,
  background: '#f59e0b', color: '#fff', borderRadius: 4, letterSpacing: 0.5,
};
const featureStyle: React.CSSProperties = { flex: 1, fontSize: 13, color: '#92400e' };
const dismissBtnStyle: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#92400e',
  fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1, width: 24,
};
const reasonStyle: React.CSSProperties = { marginBottom: 6, lineHeight: 1.5 };
const limitsHeaderStyle: React.CSSProperties = { fontWeight: 700, marginBottom: 2 };
const limitsListStyle: React.CSSProperties = {
  margin: '0 0 6px 18px', padding: 0, lineHeight: 1.6, fontSize: 11,
};
const workaroundStyle: React.CSSProperties = {
  marginTop: 6, padding: 8, background: '#fef3c7', borderRadius: 6, fontSize: 11,
};
