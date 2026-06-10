'use client';

// Project-invite accept landing page. An email invite links here
// (/[lang]/nexyfab/invite/[token]). Shows the invite info, then lets the
// signed-in user (whose email must match the invite) accept — which adds them
// to nf_project_members and opens the shared project. (2026-06-09 follow-up #2)

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';

interface InviteInfo {
  projectId: string;
  role: 'editor' | 'viewer';
  emailHint: string;
}

export default function InviteAcceptPage({ params }: { params: Promise<{ lang: string; token: string }> }) {
  const { lang, token } = use(params);
  const isKo = isKorean(lang);
  const router = useRouter();
  const user = useAuthStore(s => s.user);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const langSeg = lang === 'ko' ? 'kr' : lang;

  const t = isKo ? {
    title: '프로젝트 초대', loading: '초대 확인 중…',
    invalid: '초대가 유효하지 않거나 만료되었습니다.',
    invitedAs: (r: string) => `${r === 'viewer' ? '보기 전용' : '편집 가능'} 권한으로 초대되었습니다.`,
    forEmail: (e: string) => `초대 이메일: ${e}`,
    signIn: '로그인하고 수락',
    signInHint: '초대받은 이메일과 같은 계정으로 로그인하세요.',
    accept: '초대 수락', accepting: '수락 중…',
    mismatch: '로그인한 이메일이 초대와 일치하지 않습니다. 초대받은 이메일로 로그인하세요.',
    backHome: '홈으로',
  } : {
    title: 'Project invitation', loading: 'Checking invite…',
    invalid: 'This invite is invalid or has expired.',
    invitedAs: (r: string) => `You've been invited as ${r}.`,
    forEmail: (e: string) => `Invited email: ${e}`,
    signIn: 'Sign in to accept',
    signInHint: 'Sign in with the same email the invite was sent to.',
    accept: 'Accept invite', accepting: 'Accepting…',
    mismatch: 'Your signed-in email does not match the invite. Sign in with the invited email.',
    backHome: 'Go home',
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/nexyfab/project-invites/${token}`);
        if (!r.ok) { if (alive) setState('invalid'); return; }
        const data = await r.json() as InviteInfo;
        if (alive) { setInfo(data); setState('ready'); }
      } catch {
        if (alive) setState('invalid');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const accept = useCallback(async () => {
    setAccepting(true);
    setErr(null);
    try {
      const r = await fetch(`/api/nexyfab/project-invites/${token}/accept`, { method: 'POST' });
      const data = await r.json().catch(() => ({})) as { ok?: boolean; projectId?: string; code?: string; error?: string };
      if (r.ok && data.projectId) {
        router.push(`/${langSeg}/shape-generator?projectId=${data.projectId}`);
        return;
      }
      setErr(data.code === 'INVITE_EMAIL_MISMATCH' ? t.mismatch : (data.error ?? `HTTP ${r.status}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  }, [token, langSeg, router, t.mismatch]);

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--nx-bg)', color: 'var(--nx-text)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24,
    }}>
      <div style={{
        width: 'min(420px, 92vw)', background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
        borderRadius: 14, padding: 28, textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>{t.title}</h1>

        {state === 'loading' && <p style={{ color: 'var(--nx-text-2)', fontSize: 14 }}>{t.loading}</p>}

        {state === 'invalid' && (
          <>
            <p style={{ color: '#f85149', fontSize: 14, marginBottom: 20 }}>{t.invalid}</p>
            <button onClick={() => router.push(`/${langSeg}/nexyfab/hub`)} style={ghostBtn}>{t.backHome}</button>
          </>
        )}

        {state === 'ready' && info && (
          <>
            <p style={{ fontSize: 14, marginBottom: 6 }}>{t.invitedAs(info.role)}</p>
            <p style={{ fontSize: 12, color: 'var(--nx-text-2)', marginBottom: 20 }}>{t.forEmail(info.emailHint)}</p>
            {err && <p style={{ fontSize: 12, color: '#f85149', marginBottom: 14 }}>{err}</p>}
            {user ? (
              <button onClick={() => void accept()} disabled={accepting} style={primaryBtn}>
                {accepting ? t.accepting : t.accept}
              </button>
            ) : (
              <>
                <button onClick={() => router.push(`/login?next=${encodeURIComponent(`/${langSeg}/nexyfab/invite/${token}`)}`)} style={primaryBtn}>
                  {t.signIn}
                </button>
                <p style={{ fontSize: 11, color: 'var(--nx-text-3)', marginTop: 12 }}>{t.signInHint}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
  background: 'linear-gradient(135deg, #388bfd, #8b5cf6)', color: '#fff',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 8, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
