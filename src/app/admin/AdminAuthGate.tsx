'use client';

import { useEffect, useState } from 'react';

/**
 * Gates EVERY /admin/* page behind the shared admin password. Until this landed,
 * the admin layout rendered nav + page for anyone — only the per-page /admin/users
 * form gated, so /admin/factories (and the rest) were fully visible without login.
 * APIs were already verifyAdmin-protected, but the UI itself leaked. This is the
 * single client-side gate; it checks the session via GET /api/admin/auth and shows
 * the password form when absent.
 */
export default function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'in' | 'out'>('checking');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/auth', { method: 'GET' })
      .then((r) => r.json())
      .then((d) => { if (alive) setStatus(d?.authed ? 'in' : 'out'); })
      .catch(() => { if (alive) setStatus('out'); });
    return () => { alive = false; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        setStatus('in');
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d?.error || '비밀번호가 올바르지 않습니다.');
      }
    } catch {
      setErr('로그인 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'checking') {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>확인 중…</div>;
  }

  if (status === 'out') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28, width: 340, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#111827', marginBottom: 4 }}>NexyFab Admin</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18 }}>관리자 비밀번호를 입력하세요.</div>
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

  return <>{children}</>;
}
