'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';

export default function OrgJoinPage() {
  const { lang } = useParams<{ lang: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token: authToken } = useAuthStore();

  const inviteToken = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'ready' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!inviteToken) {
      setStatus('error');
      setMessage('초대 링크가 유효하지 않습니다.');
      return;
    }
    if (!authToken) {
      setStatus('error');
      setMessage('로그인이 필요합니다. 로그인 후 다시 시도해주세요.');
      return;
    }
    setStatus('ready');
  }, [inviteToken, authToken]);

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
        setMessage(data.error || '초대 수락에 실패했습니다.');
        return;
      }
      setStatus('success');
      setMessage(`${data.org?.name ?? '조직'}에 합류했습니다!`);
      setTimeout(() => router.push(`/${lang}/nexyfab/settings/billing`), 2000);
    } catch {
      setStatus('error');
      setMessage('네트워크 오류가 발생했습니다.');
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
          {status === 'success' ? '합류 완료' : status === 'error' ? '오류' : '조직 초대'}
        </h1>
        {status === 'ready' && (
          <>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
              조직에 초대되었습니다. 아래 버튼을 클릭하여 합류하세요.
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
              {joining ? '처리 중...' : '초대 수락'}
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
            로그인 페이지로 이동
          </a>
        )}
      </div>
    </div>
  );
}
