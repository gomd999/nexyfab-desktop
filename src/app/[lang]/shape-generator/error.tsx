'use client';

import { useEffect } from 'react';

const i18n: Record<string, { title: string; desc: string; retry: string }> = {
  ko: { title: '3D 도구 오류', desc: '3D 도구를 불러오는 중 오류가 발생했습니다.', retry: '다시 시도' },
  en: { title: '3D Tool Error', desc: 'An error occurred while loading the 3D tool.', retry: 'Try again' },
  ja: { title: '3D ツールエラー', desc: '3D ツールの読み込み中にエラーが発生しました。', retry: '再試行' },
  zh: { title: '3D 工具错误', desc: '加载 3D 工具时发生错误。', retry: '重试' },
  es: { title: 'Error de la herramienta 3D', desc: 'Se ha producido un error al cargar la herramienta 3D.', retry: 'Reintentar' },
  ar: { title: 'خطأ في أداة 3D', desc: 'حدث خطأ أثناء تحميل أداة 3D.', retry: 'إعادة المحاولة' },
};

function detectLang(): string {
  if (typeof window === 'undefined') return 'en';
  const seg = window.location.pathname.split('/')[1] || '';
  // ⚠ 260802: 경로·브라우저 모두 ko 만 봤다 — 사전에 4언어를 넣어도 **선택될 수 없었다.**
  if (seg === 'kr' || seg === 'ko') return 'ko';
  if (seg === 'ja') return 'ja';
  if (seg === 'cn' || seg === 'zh') return 'zh';
  if (seg === 'es') return 'es';
  if (seg === 'ar') return 'ar';
  if (typeof navigator !== 'undefined') {
    const l = navigator.language?.toLowerCase() ?? '';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('ar')) return 'ar';
  }
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
    void fetch('/api/nexyfab/telemetry/', {
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
      background: 'var(--nx-bg)', color: 'var(--nx-text)',
      fontFamily: 'system-ui, sans-serif', textAlign: 'center',
      padding: '40px 24px',
    }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
        {t.title}
      </h2>
      <p style={{ fontSize: '14px', color: 'var(--nx-text-2)', marginBottom: '24px' }}>
        {process.env.NODE_ENV === 'development' ? error.message : t.desc}
      </p>
      {error.digest && (
        <p style={{ fontSize: '12px', color: 'var(--nx-border-strong)', fontFamily: 'monospace', marginBottom: '16px' }}>
          Error ID: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        style={{
          padding: '10px 24px', background: 'var(--nx-accent-2)', color: 'var(--nx-text)',
          border: 'none', borderRadius: '8px', cursor: 'pointer',
          fontWeight: 600, fontSize: '14px',
        }}
      >
        {t.retry}
      </button>
    </div>
  );
}
