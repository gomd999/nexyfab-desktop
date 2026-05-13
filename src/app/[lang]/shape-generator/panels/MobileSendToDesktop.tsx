'use client';

import React, { useState, useEffect } from 'react';

/**
 * Item 1 of the usability action items
 * (docs/strategy/... see commit message).
 *
 * The 3D modeler is desktop-only by design (mouse + keyboard required), so
 * mobile users used to land on a dead-end "Mobile view" screen with no way
 * to recover the in-flight URL onto a PC. This component gives them three
 * concrete recovery paths:
 *
 *   1. QR — scan with a PC webcam / a phone-to-PC tool
 *   2. Copy URL — share via any messenger to the user's own desktop
 *   3. Email — mailto: with the URL prefilled
 *
 * Renders inline (no modal) so the affordances are immediately visible.
 * QR generation uses api.qrserver.com to avoid a dependency add — the call
 * is a single `<img>` tag, no JS runtime cost. If the service is ever
 * unreliable the QR just fails to load; the copy + email actions still work.
 */
interface Props {
  labels: {
    title: string;
    body: string;
    qrAlt: string;
    copyUrl: string;
    copyUrlDone: string;
    emailSelf: string;
    emailSubject: string;
    emailBody: string;
  };
}

export default function MobileSendToDesktop({ labels }: Props) {
  const [pageUrl, setPageUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // window.location is only meaningful client-side, and SSR would mismatch.
    if (typeof window === 'undefined') return;
    setPageUrl(window.location.href);
  }, []);

  const onCopy = async () => {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback for browsers without clipboard API
      const tmp = document.createElement('textarea');
      tmp.value = pageUrl;
      document.body.appendChild(tmp);
      tmp.select();
      try { document.execCommand('copy'); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* swallow */ }
      tmp.remove();
    }
  };

  const mailto = pageUrl
    ? `mailto:?subject=${encodeURIComponent(labels.emailSubject)}&body=${encodeURIComponent(`${labels.emailBody}\n\n${pageUrl}`)}`
    : 'mailto:';

  const qrSrc = pageUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=4&data=${encodeURIComponent(pageUrl)}`
    : '';

  return (
    <div
      role="region"
      aria-label={labels.title}
      style={{
        width: '100%', maxWidth: 320, marginBottom: 24, padding: '18px 16px',
        background: '#0d1b3a', border: '1px solid #1f3469', borderRadius: 12,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#7fa9ff', marginBottom: 8 }}>
        {labels.title}
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#9bb1d8', lineHeight: 1.65 }}>
        {labels.body}
      </p>

      {pageUrl && (
        <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
          <img
            src={qrSrc}
            alt={labels.qrAlt}
            width={200}
            height={200}
            style={{ borderRadius: 8, background: '#fff', padding: 4 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={onCopy}
          disabled={!pageUrl}
          style={{
            padding: '11px 14px', borderRadius: 8, border: '1px solid #2553a8',
            background: copied ? '#1d6f47' : '#1c3a78', color: '#e6edf3',
            fontSize: 13, fontWeight: 700, cursor: pageUrl ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {copied ? labels.copyUrlDone : labels.copyUrl}
        </button>
        <a
          href={mailto}
          style={{
            padding: '11px 14px', borderRadius: 8, border: '1px solid #30363d',
            background: 'transparent', color: '#c9d1d9', textDecoration: 'none',
            fontSize: 13, fontWeight: 700, display: 'block',
          }}
        >
          {labels.emailSelf}
        </a>
      </div>
    </div>
  );
}
