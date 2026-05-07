'use client';

import { useEffect } from 'react';

const i18n: Record<string, { title: string; desc: string; retry: string }> = {
  ko: { title: '관리자 패널 오류', desc: '관리자 페이지를 불러오는 중 오류가 발생했습니다.', retry: '다시 시도' },
  en: { title: 'Admin Panel Error', desc: 'An error occurred while loading the admin panel.', retry: 'Try again' },
};

function detectLang(): string {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.startsWith('ko') ? 'ko' : 'en';
}

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = i18n[detectLang()];

  useEffect(() => {
    console.error('Admin error:', error);
    void fetch('/api/nexyfab/telemetry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ events: [{ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), ts: Date.now(), level: 'error', source: 'unknown', message: error.message || 'AdminError', stack: error.stack, context: { digest: error.digest }, url: typeof window !== 'undefined' ? window.location.href : undefined, sessionId: 'admin' }] }),
    }).catch(() => {});
  }, [error]);

  return (
    <div style={{
      maxWidth: '600px', margin: '120px auto', padding: '40px 24px',
      textAlign: 'center', fontFamily: 'system-ui, sans-serif',
    }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1F36', marginBottom: '8px' }}>
        {t.title}
      </h2>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
        {process.env.NODE_ENV === 'development' ? error.message : t.desc}
      </p>
      {error.digest && (
        <p style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace', marginBottom: '16px' }}>
          Error ID: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        style={{
          padding: '10px 24px', background: '#0b5cff', color: '#fff',
          border: 'none', borderRadius: '8px', cursor: 'pointer',
          fontWeight: 600, fontSize: '14px',
        }}
      >
        {t.retry}
      </button>
    </div>
  );
}
