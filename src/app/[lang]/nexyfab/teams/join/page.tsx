'use client';

import { useCallback, useEffect, useState, use, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import AuthModal from '@/components/nexyfab/AuthModal';
import { isKorean } from '@/lib/i18n/normalize';

function JoinTeamInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, token } = useAuthStore();
  const isKo = isKorean(lang);

  const inviteToken = searchParams.get('token') ?? '';

  type Status = 'idle' | 'joining' | 'success' | 'error' | 'expired' | 'invalid';
  const [status, setStatus] = useState<Status>('idle');
  const [teamId, setTeamId] = useState('');
  const [role, setRole] = useState('');
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!inviteToken) setStatus('invalid');
  }, [inviteToken]);

  const handleJoin = useCallback(async () => {
    if (!token || !inviteToken) return;
    setStatus('joining');
    try {
      const res = await fetch('/api/nexyfab/teams/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Origin: window.location.origin,
        },
        body: JSON.stringify({ token: inviteToken }),
      });
      const data = await res.json() as { ok?: boolean; teamId?: string; role?: string; error?: string };
      if (res.ok && data.ok) {
        setTeamId(data.teamId ?? '');
        setRole(data.role ?? '');
        setStatus('success');
      } else if (res.status === 410) {
        setStatus('expired');
      } else if (res.status === 404) {
        setStatus('invalid');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }, [token, inviteToken]);

  // Auto-join once user is logged in
  useEffect(() => {
    if (user && token && inviteToken && status === 'idle') {
      void handleJoin();
    }
  }, [user, token, inviteToken, status, handleJoin]);

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>📬</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#e6edf3' }}>
            {isKo ? '팀 초대를 받으셨습니다' : "You've been invited to a team"}
          </h2>
          <p style={{ color: '#8b949e', marginBottom: 28, lineHeight: 1.6 }}>
            {isKo
              ? '초대를 수락하려면 NexyFab에 로그인하세요.'
              : 'Sign in to NexyFab to accept the invitation.'}
          </p>
          <button
            onClick={() => setShowAuth(true)}
            style={primaryBtn}
          >
            {isKo ? '로그인 / 회원가입' : 'Sign in / Sign up'}
          </button>
        </div>
        <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
      </div>
    );
  }

  // ── Joining ────────────────────────────────────────────────────────────────
  if (status === 'idle' || status === 'joining') {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>⏳</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#e6edf3' }}>
            {isKo ? '초대 처리 중...' : 'Processing invite...'}
          </h2>
        </div>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#3fb950' }}>
            {isKo ? '팀 가입 완료!' : 'Joined the team!'}
          </h2>
          <p style={{ color: '#8b949e', marginBottom: 8 }}>
            {isKo ? `역할: ` : `Role: `}
            <strong style={{ color: '#e6edf3' }}>
              {role === 'manager' ? (isKo ? '매니저' : 'Manager') : (isKo ? '뷰어' : 'Viewer')}
            </strong>
          </p>
          <p style={{ color: '#6e7681', marginBottom: 28, fontSize: 13 }}>
            {isKo ? '팀 대시보드에서 팀원들과 협업하세요.' : 'Collaborate with your team in the team dashboard.'}
          </p>
          <button
            onClick={() => router.push(`/${lang}/nexyfab/team`)}
            style={primaryBtn}
          >
            {isKo ? '팀 대시보드로 이동' : 'Go to Team Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  // ── Expired ────────────────────────────────────────────────────────────────
  if (status === 'expired') {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>⏰</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#f0883e' }}>
            {isKo ? '초대 링크가 만료되었습니다' : 'Invite link expired'}
          </h2>
          <p style={{ color: '#8b949e', marginBottom: 28 }}>
            {isKo
              ? '초대 링크는 7일 후 만료됩니다. 팀 소유자에게 재초대를 요청하세요.'
              : 'Invite links expire after 7 days. Ask the team owner to send a new one.'}
          </p>
          <button onClick={() => router.push(`/${lang}/nexyfab`)} style={secondaryBtn}>
            {isKo ? '홈으로' : 'Go home'}
          </button>
        </div>
      </div>
    );
  }

  // ── Invalid / Error ────────────────────────────────────────────────────────
  return (
    <div style={outerStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#f85149' }}>
          {isKo
            ? (status === 'invalid' ? '유효하지 않은 초대 링크입니다' : '오류가 발생했습니다')
            : (status === 'invalid' ? 'Invalid invite link' : 'Something went wrong')}
        </h2>
        <p style={{ color: '#8b949e', marginBottom: 28 }}>
          {isKo ? '올바른 초대 링크를 사용하거나 팀 소유자에게 문의하세요.' : 'Use a valid invite link or contact the team owner.'}
        </p>
        <button onClick={() => router.push(`/${lang}/nexyfab`)} style={secondaryBtn}>
          {isKo ? '홈으로' : 'Go home'}
        </button>
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const outerStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#0d1117',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const cardStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d',
  borderRadius: 16, padding: '48px 40px',
  textAlign: 'center', maxWidth: 440, width: '100%',
  margin: '0 16px',
};

const primaryBtn: React.CSSProperties = {
  padding: '11px 32px', borderRadius: 9, border: 'none',
  background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '10px 28px', borderRadius: 9,
  border: '1px solid #30363d', background: 'transparent',
  color: '#8b949e', fontSize: 14, cursor: 'pointer',
};

export default function JoinTeamPage({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0d1117' }} />}>
      <JoinTeamInner params={params} />
    </Suspense>
  );
}
