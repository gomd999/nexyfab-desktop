'use client';

// Guest-mode sign-in nudge — shown only when the user is not logged in but is
// using the modeler. Calm, non-blocking, and auto-dismissed without a countdown.
//
// The previous version showed a fake 24h timer seeded from a client-side
// localStorage timestamp and escalated to a red "Expired" state. But the real
// server demo session TTL is 7 days AND the guest's work lives in localStorage
// autosave that never expires — so the countdown manufactured false data-loss
// urgency. Replaced with an honest "your work is local-only, sign in to save
// to the cloud" nudge. (2026-06-09 de-mock.)
//
// Dispatches `nexyfab:require-signup` when the user clicks "지금 가입".

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { pickShellDict } from './shellDict';
import { shellChromeText } from './shellChromeI18n';

export interface GuestExpiryBannerProps {
  lang: string;
}

export const GUEST_NUDGE_AUTO_DISMISS_MS = 15_000;

export function GuestExpiryBanner({ lang }: GuestExpiryBannerProps) {
  const d = pickShellDict(lang);
  const sessionStatus = useAuthStore(s => s.sessionStatus);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (sessionStatus !== 'anonymous' || dismissed) return;
    const timeoutId = window.setTimeout(() => setDismissed(true), GUEST_NUDGE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [dismissed, sessionStatus]);

  if (sessionStatus !== 'anonymous' || dismissed) return null;

  const requireSignup = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:require-signup', { detail: { feature: 'guest-save' } }));
    }
  };

  return (
    <div
      data-testid="guest-mode-nudge"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'fixed',
        // Raised to the top of the bottom-right stack (AI FAB at ~24, toasts at
        // ~88) so this one-shot sign-in nudge no longer overlaps either.
        // (2026-06-12 corner declutter)
        bottom: 152,
        right: 16,
        zIndex: 7500,
        background: 'rgba(15, 23, 42, 0.92)',
        color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        fontWeight: 600,
        maxWidth: 360,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(8px)',
        // The nudge must never block CAD dialogs or inspector controls below it.
        // Its own explicit actions opt back into pointer interaction.
        pointerEvents: 'none',
      }}
    >
      <span style={{ fontSize: 16 }}>👤</span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        <div>{d.guestMode}</div>
        <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>
          {d.guestLocalOnly}
        </div>
      </div>
      <button
        onClick={requireSignup}
        style={{
          padding: '6px 12px', height: 28, border: 0, borderRadius: 6,
          background: '#fff', color: '#0f0f0f',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
        }}
      >
        {d.signUpNow}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label={shellChromeText(lang, 'dismiss')}
        style={{
          width: 22, height: 22, padding: 0, border: 0, background: 'transparent',
          color: '#e2e8f0', fontSize: 16, cursor: 'pointer', opacity: 0.7,
          pointerEvents: 'auto',
        }}
      >×</button>
    </div>
  );
}
