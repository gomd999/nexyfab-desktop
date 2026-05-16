'use client';

// Email verification banner — non-blocking notice with inline 6-digit code
// entry. Shown when the authenticated user has emailVerified === false.
// Hidden once verified or if the user dismisses it for the current session.

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

const DISMISS_KEY = 'nexyfab.verify-banner-dismissed.v1';

export interface EmailVerifyBannerProps {
  isKo: boolean;
}

export function EmailVerifyBanner({ isKo }: EmailVerifyBannerProps) {
  const user = useAuthStore(s => s.user);
  const refreshUser = useAuthStore(s => s.refreshPlan);
  // Optimistic UI fallback — mark user verified locally on success so the
  // banner hides instantly without waiting for refreshPlan.
  const setUser = useAuthStore.setState;
  const [dismissed, setDismissed] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(DISMISS_KEY) === '1') setDismissed(true);
  }, []);

  if (!user || user.emailVerified || dismissed) return null;

  const dismiss = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    }
    setDismissed(true);
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setInfo(isKo ? '인증 코드를 재발송했습니다 — 메일함 확인하세요.' : 'Verification code resent — check your inbox.');
        setShowInput(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? (isKo ? '재발송 실패' : 'Resend failed'));
      }
    } catch {
      setError(isKo ? '네트워크 오류' : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError(isKo ? '6자리 숫자 코드를 입력하세요.' : 'Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId: user.id }),
      });
      if (res.ok) {
        setInfo(isKo ? '✓ 이메일 인증 완료' : '✓ Email verified');
        // Optimistic local update — emailVerified true so the banner hides
        // immediately. refreshPlan also runs to sync the token claim.
        setUser((s) => ({ ...s, user: s.user ? { ...s.user, emailVerified: true } : null }));
        setTimeout(() => { void refreshUser?.(); }, 200);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? (isKo ? '인증 실패' : 'Verification failed'));
      }
    } catch {
      setError(isKo ? '네트워크 오류' : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 8500,
        background: 'linear-gradient(90deg, rgba(255, 168, 0, 0.95), rgba(255, 200, 60, 0.95))',
        color: '#0f0f0f',
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 13, fontWeight: 600,
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.25)',
      }}
    >
      <span style={{ fontSize: 16 }}>✉</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {isKo
          ? <>이메일 인증이 필요합니다 — <strong>{user.email}</strong> 로 발송된 6자리 코드를 입력해주세요.</>
          : <>Email verification needed — enter the 6-digit code sent to <strong>{user.email}</strong>.</>}
        {info && <span style={{ marginLeft: 10, color: '#0a4f1f', fontWeight: 700 }}>{info}</span>}
        {error && <span style={{ marginLeft: 10, color: '#7a2222', fontWeight: 700 }}>{error}</span>}
      </span>
      {showInput && (
        <>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter') verify(); }}
            disabled={busy}
            style={{
              height: 28, padding: '0 10px',
              border: '1px solid rgba(0, 0, 0, 0.3)', borderRadius: 4,
              background: '#fff', color: '#0f0f0f',
              fontSize: 14, fontFamily: 'ui-monospace, monospace',
              letterSpacing: '4px', width: 90, textAlign: 'center',
              fontWeight: 700,
            }}
          />
          <button
            onClick={verify}
            disabled={busy || code.length !== 6}
            style={{
              padding: '0 12px', height: 28, border: 0, borderRadius: 4,
              background: '#0f0f0f', color: '#fff',
              fontSize: 12, fontWeight: 700,
              cursor: busy || code.length !== 6 ? 'not-allowed' : 'pointer',
              opacity: code.length !== 6 ? 0.5 : 1,
            }}
          >
            {isKo ? '인증' : 'Verify'}
          </button>
        </>
      )}
      {!showInput && (
        <button
          onClick={() => setShowInput(true)}
          style={{
            padding: '0 12px', height: 28, border: 0, borderRadius: 4,
            background: '#0f0f0f', color: '#fff',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {isKo ? '코드 입력' : 'Enter code'}
        </button>
      )}
      <button
        onClick={resend}
        disabled={busy}
        style={{
          padding: '0 10px', height: 28, border: '1px solid rgba(0, 0, 0, 0.3)', borderRadius: 4,
          background: 'transparent', color: '#0f0f0f',
          fontSize: 11, fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {isKo ? '재발송' : 'Resend'}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          width: 24, height: 24, padding: 0, border: 0, background: 'transparent',
          color: '#0f0f0f', fontSize: 18, cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
