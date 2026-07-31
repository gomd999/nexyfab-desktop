'use client';

import { useEffect } from 'react';

const i18n: Record<string, { title: string; desc: string; retry: string }> = {
  ko: { title: '계정 오류', desc: '계정 정보를 불러오는 중 오류가 발생했습니다.', retry: '다시 시도' },
  en: { title: 'Account Error', desc: 'An error occurred while loading account information.', retry: 'Try again' },
  ja: { title: 'アカウントエラー', desc: 'アカウント情報の読み込み中にエラーが発生しました。', retry: '再試行' },
  zh: { title: '账户错误', desc: '加载账户信息时发生错误。', retry: '重试' },
  es: { title: 'Error de cuenta', desc: 'Se ha producido un error al cargar la información de la cuenta.', retry: 'Reintentar' },
  ar: { title: 'خطأ في الحساب', desc: 'حدث خطأ أثناء تحميل معلومات الحساب.', retry: 'إعادة المحاولة' },
};

function detectLang(): string {
  if (typeof navigator === 'undefined') return 'en';
  const l = navigator.language?.toLowerCase() ?? '';
  // ⚠ 260802: 여기가 ko/en 만 돌려줘, 사전에 4언어를 넣어도 **선택될 수 없었다.**
  //   사전을 채우는 것과 고르는 곳을 고치는 것은 다르다.
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('ar')) return 'ar';
  return 'en';
}

export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = i18n[detectLang()];

  useEffect(() => {
    console.error('Account error:', error);
    void fetch('/api/nexyfab/telemetry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ events: [{ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), ts: Date.now(), level: 'error', source: 'unknown', message: error.message || 'AccountError', stack: error.stack, context: { digest: error.digest }, url: typeof window !== 'undefined' ? window.location.href : undefined, sessionId: 'account' }] }),
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
