'use client';

import { useEffect } from 'react';

const i18n: Record<string, { title: string; desc: string; retry: string }> = {
  ko: { title: '3D 도구 오류', desc: '3D 도구를 불러오는 중 오류가 발생했습니다.', retry: '다시 시도' },
  en: { title: '3D Tool Error', desc: 'An error occurred while loading the 3D tool.', retry: 'Try again' },
};

function detectLang(): string {
  if (typeof window === 'undefined') return 'en';
  const seg = window.location.pathname.split('/')[1] || '';
  if (seg === 'kr' || seg === 'ko') return 'ko';
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('ko')) return 'ko';
  return 'en';
}

export default function ShapeGeneratorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = i18n[detectLang()];

  useEffect(() => {
    console.error('Shape generator error:', error);
    void fetch('/api/nexyfab/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        events: [{
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          ts: Date.now(),
          level: 'error',
          source: 'render',
          message: error.message || 'ShapeGeneratorError',
          stack: error.stack,
          context: { digest: error.digest },
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          sessionId: 'shape-generator',
        }],
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0d1117', color: '#e6edf3',
      fontFamily: 'system-ui, sans-serif', textAlign: 'center',
      padding: '40px 24px',
    }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
        {t.title}
      </h2>
      <p style={{ fontSize: '14px', color: '#8b949e', marginBottom: '24px' }}>
        {process.env.NODE_ENV === 'development' ? error.message : t.desc}
      </p>
      {error.digest && (
        <p style={{ fontSize: '12px', color: '#484f58', fontFamily: 'monospace', marginBottom: '16px' }}>
          Error ID: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        style={{
          padding: '10px 24px', background: '#8b9cf4', color: '#fff',
          border: 'none', borderRadius: '8px', cursor: 'pointer',
          fontWeight: 600, fontSize: '14px',
        }}
      >
        {t.retry}
      </button>
    </div>
  );
}
