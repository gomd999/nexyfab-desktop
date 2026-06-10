'use client';

// Guest-mode sign-in nudge — shown only when the user is not logged in but is
// using the modeler. Calm and persistent, with NO countdown.
//
// The previous version showed a fake 24h timer seeded from a client-side
// localStorage timestamp and escalated to a red "Expired" state. But the real
// server demo session TTL is 7 days AND the guest's work lives in localStorage
// autosave that never expires — so the countdown manufactured false data-loss
// urgency. Replaced with an honest "your work is local-only, sign in to save
// to the cloud" nudge. (2026-06-09 de-mock.)
//
// Dispatches `nexyfab:require-signup` when the user clicks "지금 가입".

import { useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

export interface GuestExpiryBannerProps {
  isKo: boolean;
}

export function GuestExpiryBanner({ isKo }: GuestExpiryBannerProps) {
  const user = useAuthStore(s => s.user);
  const [dismissed, setDismissed] = useState(false);

  if (user || dismissed) return null;

  const requireSignup = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:require-signup', { detail: { feature: 'guest-save' } }));
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'fixed',
        bottom: 16,
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
      }}
    >
      <span style={{ fontSize: 16 }}>👤</span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        <div>{isKo ? '게스트 모드' : 'Guest mode'}</div>
        <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>
          {isKo
            ? '작업물은 이 브라우저에만 저장돼요. 로그인하면 클라우드에 영구 저장됩니다.'
            : 'Your work is saved in this browser only. Sign in to save it to the cloud.'}
        </div>
      </div>
      <button
        onClick={requireSignup}
        style={{
          padding: '6px 12px', height: 28, border: 0, borderRadius: 6,
          background: '#fff', color: '#0f0f0f',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {isKo ? '지금 가입' : 'Sign in'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          width: 22, height: 22, padding: 0, border: 0, background: 'transparent',
          color: '#e2e8f0', fontSize: 16, cursor: 'pointer', opacity: 0.7,
        }}
      >×</button>
    </div>
  );
}
