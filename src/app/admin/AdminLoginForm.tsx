'use client';

import { useEffect, useState } from 'react';
import { useAdminI18n } from './AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

type Stage = 'email' | 'code';

interface AuthResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  to?: string;
  reason?: string;
  attemptsLeft?: number;
  retryAfter?: number;
}

export default function AdminLoginForm() {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    if (!email.trim() || busy || cooldown > 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', email }),
      });
      const data = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) {
        if (response.status === 429) setCooldown(data.retryAfter ?? 60);
        setError((locale === 'ko' ? data.error : undefined)
          ?? L('인증 코드를 요청하지 못했습니다.', 'Could not request a verification code.'));
        return;
      }
      setMaskedEmail(data.to ?? email);
      setNotice(data.message ?? L('허용된 관리자 이메일이면 인증 코드를 발송했습니다.', 'If this is an approved administrator email, a verification code has been sent.'));
      setStage('code');
      setCooldown(60);
    } catch {
      setError(L('인증 요청 중 네트워크 오류가 발생했습니다.', 'A network error occurred while requesting verification.'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', email, code }),
      });
      const data = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) {
        setCode('');
        setError(typeof data.attemptsLeft === 'number'
          ? L(
            `${data.error ?? '인증 코드가 올바르지 않습니다.'} (남은 시도 ${data.attemptsLeft}회)`,
            `The verification code is incorrect. (${data.attemptsLeft} attempts remaining)`,
          )
          : (locale === 'ko' ? data.error : undefined)
            ?? L('인증 코드가 올바르지 않습니다.', 'The verification code is incorrect.'));
        if (data.reason === 'expired' || data.reason === 'too_many_attempts') setStage('email');
        return;
      }
      window.location.reload();
    } catch {
      setError(L('로그인 중 네트워크 오류가 발생했습니다.', 'A network error occurred while signing in.'));
    } finally {
      setBusy(false);
    }
  }

  function resetEmail() {
    setStage('email');
    setCode('');
    setMaskedEmail('');
    setNotice('');
    setError('');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#f8fafc,#eff6ff)', padding: 20 }}>
      <form
        onSubmit={(event) => { event.preventDefault(); void (stage === 'email' ? requestCode() : verifyCode()); }}
        style={{ background: '#fff', border: '1px solid #dbe3ef', borderRadius: 18, padding: 30, width: 360, boxShadow: '0 18px 50px rgba(15,23,42,0.10)' }}
      >
        <div style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 12, background: '#eff6ff', color: '#2563eb', fontSize: 20, marginBottom: 14 }}>✉</div>
        <div style={{ fontWeight: 900, fontSize: 20, color: '#111827', marginBottom: 5 }}>NexyFab Admin</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 22, lineHeight: 1.55 }}>
          {stage === 'email'
            ? L('허용된 관리자 이메일로 일회용 인증 코드를 받아 로그인합니다.', 'Request a one-time code using an approved administrator email.')
            : L(`${maskedEmail}로 보낸 6자리 코드를 입력하세요.`, `Enter the 6-digit code sent to ${maskedEmail}.`)}
        </div>

        {notice && <div style={{ fontSize: 12, color: '#065f46', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 9, padding: '9px 11px', marginBottom: 12, lineHeight: 1.5 }}>{notice}</div>}

        {stage === 'email' ? (
          <>
            <label htmlFor="admin-email" style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 7 }}>{L('관리자 이메일', 'Administrator email')}</label>
            <input
              id="admin-email"
              type="email"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: '11px 12px', fontSize: 14, marginBottom: 12, outlineColor: '#2563eb' }}
            />
          </>
        ) : (
          <>
            <label htmlFor="admin-code" style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 7 }}>{L('이메일 인증 코드', 'Email verification code')}</label>
            <input
              id="admin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px', fontSize: 22, letterSpacing: '.28em', textAlign: 'center', marginBottom: 12, outlineColor: '#2563eb' }}
            />
          </>
        )}

        {error && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '9px 11px', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>{error}</div>}

        <button
          type="submit"
          disabled={busy || (stage === 'email' ? !email.trim() || cooldown > 0 : code.length !== 6)}
          style={{ width: '100%', padding: '12px', borderRadius: 10, background: '#2563eb', color: '#fff', fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer', opacity: busy || (stage === 'email' ? !email.trim() || cooldown > 0 : code.length !== 6) ? 0.55 : 1 }}
        >
          {busy
            ? L('확인 중…', 'Verifying…')
            : stage === 'email'
              ? cooldown > 0 ? `${cooldown}s` : L('인증 코드 요청', 'Request code')
              : L('관리자 로그인', 'Administrator sign in')}
        </button>

        {stage === 'code' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 13 }}>
            <button type="button" onClick={resetEmail} style={{ border: 0, background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>← {L('이메일 변경', 'Change email')}</button>
            <button type="button" disabled={busy || cooldown > 0} onClick={() => { setStage('email'); setNotice(''); setError(''); }} style={{ border: 0, background: 'transparent', color: '#2563eb', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: cooldown > 0 ? .5 : 1 }}>
              {cooldown > 0 ? `${cooldown}s` : L('코드 다시 요청', 'Request another code')}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
