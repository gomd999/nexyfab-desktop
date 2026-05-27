'use client';

// Guest-mode expiry countdown — shown only when the user is not logged in
// but is using the modeler (typically arrived from Hub's "새 디자인" with
// ?guest=1). Pulls the demo session's createdAt timestamp from localStorage
// (set by /api/nexyfab/demo/start) and counts down to the 24h TTL.
//
// Visual tone:
//   - > 6h remaining:  subtle pill bottom-right
//   - ≤ 6h remaining:  yellow with stronger CTA
//   - ≤ 1h remaining:  red urgent
//
// Dispatches `nexyfab:require-signup` when the user clicks "지금 가입".

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

const GUEST_DEMO_START_KEY = 'nexyfab.guest-demo-started-at';
const TTL_MS = 24 * 60 * 60 * 1000;

export interface GuestExpiryBannerProps {
  isKo: boolean;
}

export function GuestExpiryBanner({ isKo }: GuestExpiryBannerProps) {
  const user = useAuthStore(s => s.user);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (user || typeof window === 'undefined') return;
    // Seed the start timestamp on first guest visit so subsequent reloads
    // share the same countdown rather than restarting every page load.
    let started = parseInt(window.localStorage.getItem(GUEST_DEMO_START_KEY) ?? '0', 10);
    if (!started || Number.isNaN(started)) {
      started = Date.now();
      try { window.localStorage.setItem(GUEST_DEMO_START_KEY, String(started)); } catch { /* ignore */ }
    }
    const tick = () => {
      const elapsed = Date.now() - started;
      const remaining = TTL_MS - elapsed;
      setRemainingMs(remaining > 0 ? remaining : 0);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [user]);

  if (user || remainingMs === null || dismissed) return null;

  // Urgency tiers.
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const urgency =
    remainingMs <= 60 * 60 * 1000 ? 'urgent'
    : remainingMs <= 6 * 60 * 60 * 1000 ? 'soon'
    : 'normal';
  const colorMap = {
    urgent: { bg: 'rgba(239, 68, 68, 0.95)',  fg: '#fff', border: '#7f1d1d' },
    soon:   { bg: 'rgba(255, 168, 0, 0.95)',  fg: '#0f0f0f', border: '#7c5e00' },
    normal: { bg: 'rgba(15, 23, 42, 0.92)',   fg: '#e2e8f0', border: 'rgba(255,255,255,0.1)' },
  } as const;
  const c = colorMap[urgency];

  const requireSignup = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:require-signup', { detail: { feature: 'guest-expiry' } }));
    }
  };

  const timeLabel = remainingMs <= 0
    ? (isKo ? '만료됨' : 'Expired')
    : hours > 0
      ? (isKo ? `${hours}시간 ${minutes}분 남음` : `${hours}h ${minutes}m left`)
      : (isKo ? `${minutes}분 남음` : `${minutes}m left`);

  return (
    <div
      role="status"
      aria-live={urgency === 'urgent' ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 7500,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
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
      <span style={{ fontSize: 16 }}>{urgency === 'urgent' ? '⚠' : urgency === 'soon' ? '⏳' : '👤'}</span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        <div>
          {isKo
            ? <>게스트 데모 · <strong>{timeLabel}</strong></>
            : <>Guest demo · <strong>{timeLabel}</strong></>}
        </div>
        <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>
          {isKo
            ? '가입하면 작업물이 영구 저장됩니다.'
            : 'Sign up to keep your work forever.'}
        </div>
      </div>
      <button
        onClick={requireSignup}
        style={{
          padding: '6px 12px', height: 28, border: 0, borderRadius: 6,
          background: urgency === 'soon' ? '#0f0f0f' : '#fff',
          color: urgency === 'soon' ? '#fff' : '#0f0f0f',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {isKo ? '지금 가입' : 'Sign up'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          width: 22, height: 22, padding: 0, border: 0, background: 'transparent',
          color: c.fg, fontSize: 16, cursor: 'pointer', opacity: 0.7,
        }}
      >×</button>
    </div>
  );
}
