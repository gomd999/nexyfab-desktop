'use client';

import { useEffect, useState } from 'react';

const errorI18n: Record<string, { title: string; desc: string; retry: string }> = {
  ko: { title: '오류가 발생했습니다', desc: '예상치 못한 오류가 발생했습니다. 다시 시도해 주세요.', retry: '다시 시도' },
  en: { title: 'Something went wrong', desc: 'An unexpected error occurred. Please try again.', retry: 'Try again' },
  ja: { title: 'エラーが発生しました', desc: '予期しないエラーが発生しました。もう一度お試しください。', retry: 'もう一度試す' },
  zh: { title: '出现错误', desc: '发生了意外错误。请重试。', retry: '重试' },
  es: { title: 'Algo salió mal', desc: 'Ocurrió un error inesperado. Por favor, inténtelo de nuevo.', retry: 'Reintentar' },
  ar: { title: 'حدث خطأ', desc: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.', retry: 'إعادة المحاولة' },
};

function detectErrorLang(): string {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language?.slice(0, 2) || 'en';
  return errorI18n[lang] ? lang : 'en';
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang, setLang] = useState('en');

  useEffect(() => {
    setLang(detectErrorLang());
  }, []);

  useEffect(() => {
    console.error('[GlobalError]', error);
    // Forward to Sentry via telemetry ingestion endpoint
    void fetch('/api/nexyfab/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        events: [{
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          ts: Date.now(),
          level: 'error',
          source: 'unknown',
          message: error.message || 'GlobalError',
          stack: error.stack,
          context: { digest: error.digest },
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          sessionId: 'global',
        }],
      }),
    }).catch(() => {/* telemetry must not throw */});
  }, [error]);

  const t = errorI18n[lang];

  return (
    <html>
      <body style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0d1117',
        color: '#e6edf3',
        gap: '16px',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{t.title}</h2>
        <p style={{ color: '#8b949e', fontSize: '14px' }}>
          {process.env.NODE_ENV === 'development' ? error.message : t.desc}
        </p>
        {error.digest && (
          <p style={{ color: '#8b949e', fontSize: '12px', fontFamily: 'monospace' }}>
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            padding: '8px 20px',
            background: '#8b9cf4',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '14px',
          }}
        >
          {t.retry}
        </button>
      </body>
    </html>
  );
}
