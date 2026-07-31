'use client';

import { useState } from 'react';

/**
 * Admin password form. Rendered by the SERVER admin layout only when there's no
 * valid admin session — so the protected pages are never server-rendered for an
 * unauthenticated visitor (a client-only gate still ships their HTML). On success
 * we reload so the server re-evaluates the cookie and renders the real content.
 */
export default function AdminLoginForm() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * ★ 2단계 (260802) — 종전엔 **비밀번호 하나로 40페이지 콘솔이 열렸다.**
   * 서버가 `requiresOtp` 를 주면 코드 입력 단계로 넘어간다.
   * ⚠ 서버만 고치고 화면을 안 고치면 `requiresOtp` 를 못 읽어 **로그인이 막힌다** —
   *   그건 보안이 아니라 고장이다.
   */
  const [stage, setStage] = useState<'password' | 'otp'>('password');
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stage === 'otp' ? { password: pw, otp } : { password: pw }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; requiresOtp?: boolean; message?: string; warning?: string;
      };
      if (res.ok && d.requiresOtp) {
        // 비밀번호는 맞았고 코드가 발송됐다 — **아직 세션은 없다.**
        setStage('otp');
        setInfo(d.message ?? '운영 이메일로 인증 코드를 보냈습니다.');
        setBusy(false);
        return;
      }
      if (res.ok) {
        // ⚠ 2단계가 **설정 부재로 적용되지 않은** 경우를 조용히 넘기지 않는다.
        if (d.warning) console.warn('[admin] ' + d.warning);
        window.location.reload();
      } else {
        setErr(d?.error || (stage === 'otp' ? '인증 코드가 올바르지 않습니다.' : '비밀번호가 올바르지 않습니다.'));
        setBusy(false);
      }
    } catch {
      setErr('로그인 중 오류가 발생했습니다.');
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28, width: 340, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#111827', marginBottom: 4 }}>NexyFab Admin</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18 }}>
          {stage === 'otp' ? '운영 이메일로 보낸 6자리 코드를 입력하세요.' : '관리자 비밀번호를 입력하세요.'}
        </div>
        {info && (
          <div style={{ fontSize: 12, color: '#065f46', background: '#ecfdf5', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
            {info}
          </div>
        )}
        {stage === 'otp' && (
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="000000"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 12px', fontSize: 20, letterSpacing: '.3em', textAlign: 'center', marginBottom: 12 }}
          />
        )}
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="비밀번호"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 12px', fontSize: 14, marginBottom: 12 }}
        />
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <button type="submit" disabled={busy || !pw} style={{ width: '100%', padding: '11px', borderRadius: 10, background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', opacity: busy || !pw ? 0.6 : 1 }}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
