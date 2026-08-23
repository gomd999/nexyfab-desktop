'use client';

import { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

function OrgJoinInner() {
  const { lang } = useParams<{ lang: string }>();
  const L = createCommercialLocalizer(lang);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token: authToken } = useAuthStore();

  const inviteToken = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'ready' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const localize = createCommercialLocalizer(lang);
    if (!inviteToken) {
      setStatus('error');
      setMessage(localize('초대 링크가 유효하지 않습니다.', 'This invitation link is invalid.'));
      return;
    }
    if (!authToken) {
      setStatus('error');
      setMessage(localize('로그인이 필요합니다. 로그인 후 다시 시도해주세요.', 'Please sign in and try again.'));
      return;
    }
    setStatus('ready');
  }, [inviteToken, authToken, lang]);

  async function handleJoin() {
    if (!inviteToken) return;
    setJoining(true);
    try {
      const res = await fetch('/api/nexyfab/orgs/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || L('초대 수락에 실패했습니다.', 'Failed to accept the invitation.'));
        return;
      }
      setStatus('success');
      setMessage(`${data.org?.name ?? L('조직', 'organization')} ${L('에 합류했습니다!', 'joined successfully!')}`);
      setTimeout(() => router.push(`/${lang}/nexyfab/settings/billing`), 2000);
    } catch {
      setStatus('error');
      setMessage(L('네트워크 오류가 발생했습니다.', 'A network error occurred.'));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>
          {status === 'success' ? '🎉' : status === 'error' ? '⚠️' : '📨'}
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          {status === 'success' ? L('합류 완료', 'Joined') : status === 'error' ? L('오류', 'Error') : L('조직 초대', 'Organization invitation')}
        </h1>
        {status === 'ready' && (
          <>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
              {L('조직에 초대되었습니다. 아래 버튼을 클릭하여 합류하세요.', 'You have been invited to an organization. Click below to join.')}
            </p>
            <button
              onClick={() => void handleJoin()}
              disabled={joining}
              style={{
                width: '100%', padding: '12px 24px', fontSize: 14, fontWeight: 700,
                borderRadius: 10, border: 'none', cursor: 'pointer',
                background: joining ? '#9ca3af' : '#7c3aed', color: '#fff',
                transition: 'background 0.15s',
              }}
            >
              {joining ? L('처리 중...', 'Processing...') : L('초대 수락', 'Accept invitation')}
            </button>
          </>
        )}
        {(status === 'success' || status === 'error') && (
          <p style={{ fontSize: 14, color: status === 'success' ? '#059669' : '#dc2626', marginTop: 8 }}>
            {message}
          </p>
        )}
        {status === 'error' && !authToken && (
          <a href={`/${lang}/nexyfab`} style={{ display: 'inline-block', marginTop: 16, fontSize: 13, color: '#3b82f6' }}>
            {L('로그인 페이지로 이동', 'Go to sign-in')}
          </a>
        )}
      </div>
    </div>
  );
}

export default function OrgJoinPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#f9fafb' }} />}>
      <OrgJoinInner />
    </Suspense>
  );
}
