'use client';

/**
 * AdminElevationGate — **관리자 화면을 이메일 코드 뒤에 둔다** (260802).
 *
 * ## ⚠ 이 컴포넌트는 **보안 경계가 아니다**
 * 판정은 서버가 각 API 에서 한다(`requireAdmin`). 여기서 `elevated` 를 흉내 내도
 * 데이터는 오지 않는다. 이 화면의 역할은 **무엇을 해야 하는지 알려 주는 것**이다 —
 * 화면 없이 강제만 켜면 사용자는 「관리자인데 아무것도 안 보인다」만 겪는다.
 *
 * ## 어디에 세우나 — `admin/layout.tsx`
 * `page.tsx` 만 감싸면 `email-logs`·`email-templates`·`quotes`·`rfq-matching` 이
 * **열린 채 남는다.** 하위 경로까지 덮으려면 layout 이어야 한다.
 */
import { useCallback, useEffect, useState } from 'react';

type Status =
  | { phase: 'loading' }
  | { phase: 'not-admin' }
  | { phase: 'ready' }                                   // 상승 완료 또는 강제 꺼짐
  | { phase: 'need-code'; email: string; sent: boolean; error: string | null; sending: boolean };

const LANG_FALLBACK = {
  title: '관리자 인증',
  desc: '관리자 콘솔은 이메일 코드를 한 번 더 확인합니다.',
  send: '인증 코드 받기',
  sending: '보내는 중…',
  resend: '코드 다시 받기',
  codeLabel: '6자리 코드',
  verify: '확인',
  sentTo: (e: string) => `${e} 로 코드를 보냈습니다. 5분 안에 입력하세요.`,
  notAdmin: '관리자 권한이 없습니다.',
};

export default function AdminElevationGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>({ phase: 'loading' });
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/admin-otp/status', { credentials: 'include' });
      const j = (await r.json()) as { admin?: boolean; required?: boolean; elevated?: boolean; email?: string };
      if (!r.ok || !j.admin) { setStatus({ phase: 'not-admin' }); return; }
      if (!j.required || j.elevated) { setStatus({ phase: 'ready' }); return; }
      setStatus({ phase: 'need-code', email: j.email ?? '', sent: false, error: null, sending: false });
    } catch {
      // ⚠ 상태를 못 읽었을 때 **통과시키지 않는다.** 여기서 열어 주면 화면은 열리고
      //   API 는 전부 428 로 막혀 사용자는 이유를 모른 채 빈 화면을 본다.
      setStatus({ phase: 'need-code', email: '', sent: false, error: '상태를 확인하지 못했습니다.', sending: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const sendCode = async () => {
    setStatus((s) => (s.phase === 'need-code' ? { ...s, sending: true, error: null } : s));
    try {
      const r = await fetch('/api/auth/admin-otp/request', { method: 'POST', credentials: 'include' });
      const j = (await r.json()) as { ok?: boolean; error?: string; sentTo?: string };
      setStatus((s) => (s.phase === 'need-code'
        ? { ...s, sending: false, sent: !!j.ok, email: j.sentTo ?? s.email, error: j.ok ? null : (j.error ?? '코드를 보내지 못했습니다.') }
        : s));
    } catch {
      setStatus((s) => (s.phase === 'need-code' ? { ...s, sending: false, error: '네트워크 오류' } : s));
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const r = await fetch('/api/auth/admin-otp/verify', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (j.ok) { setCode(''); await refresh(); return; }
      setStatus((s) => (s.phase === 'need-code' ? { ...s, error: j.error ?? '확인에 실패했습니다.' } : s));
    } catch {
      setStatus((s) => (s.phase === 'need-code' ? { ...s, error: '네트워크 오류' } : s));
    } finally { setVerifying(false); }
  };

  if (status.phase === 'loading') {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>확인 중…</div>;
  }
  if (status.phase === 'ready') return <>{children}</>;
  if (status.phase === 'not-admin') {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#b91c1c' }}>{LANG_FALLBACK.notAdmin}</div>;
  }

  const t = LANG_FALLBACK;
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 420, border: '1px solid #e2e8f0', borderRadius: 12, padding: '2rem', background: '#fff' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{t.title}</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>{t.desc}</p>

        {!status.sent ? (
          <button
            onClick={sendCode} disabled={status.sending}
            style={{ width: '100%', padding: '12px', borderRadius: 8, border: 0, background: '#0b5cff', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {status.sending ? t.sending : t.send}
          </button>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#334155', margin: '0 0 12px' }}>{t.sentTo(status.email)}</p>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t.codeLabel}</label>
            <input
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
              style={{ width: '100%', padding: '12px', fontSize: 20, letterSpacing: '.3em', textAlign: 'center', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 12 }}
            />
            <button
              onClick={verify} disabled={code.length !== 6 || verifying}
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: 0, background: code.length === 6 ? '#0b5cff' : '#94a3b8', color: '#fff', fontWeight: 700, cursor: code.length === 6 ? 'pointer' : 'not-allowed' }}
            >
              {verifying ? '확인 중…' : t.verify}
            </button>
            <button
              onClick={sendCode} disabled={status.sending}
              style={{ width: '100%', marginTop: 8, padding: '10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', cursor: 'pointer' }}
            >
              {status.sending ? t.sending : t.resend}
            </button>
          </>
        )}

        {status.error && (
          <p style={{ marginTop: 12, color: '#b91c1c', fontSize: 13 }}>{status.error}</p>
        )}
      </div>
    </div>
  );
}
