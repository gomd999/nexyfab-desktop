'use client';

import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
    this.props.onError?.(error, info);
    // Default Sentry forward — runs even when no onError prop is provided so
    // unhandled subtree crashes always reach the Issues feed. Lazy-import to
    // keep the ErrorBoundary fallback path on the critical render path while
    // still benefiting from instrumentation-client.ts's PII scrub.
    void import('@sentry/nextjs')
      .then(sentry => {
        sentry.captureException?.(error, {
          tags: { source: 'ErrorBoundary' },
          extra: { componentStack: info.componentStack },
        });
      })
      .catch(() => { /* SDK unavailable — fallback already logged above */ });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const boundaryI18n: Record<string, { title: string; desc: string; retry: string }> = {
        ko: { title: '오류가 발생했습니다', desc: '예상치 못한 오류가 발생했습니다.', retry: '다시 시도' },
        en: { title: 'Something went wrong', desc: 'An unexpected error occurred', retry: 'Try again' },
        ja: { title: 'エラーが発生しました', desc: '予期しないエラーが発生しました', retry: 'もう一度試す' },
        zh: { title: '出现错误', desc: '发生了意外错误', retry: '重试' },
        es: { title: 'Algo salió mal', desc: 'Ocurrió un error inesperado', retry: 'Reintentar' },
        ar: { title: 'حدث خطأ', desc: 'حدث خطأ غير متوقع', retry: 'إعادة المحاولة' },
      };
      // Prefer URL path segment over navigator.language — the user picked
      // their site language explicitly, e.g. /kr/... outranks a JP-default
      // browser locale.
      const URL_LANG_MAP: Record<string, string> = {
        kr: 'ko', ko: 'ko', en: 'en', ja: 'ja',
        cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
      };
      let detectedLang = 'en';
      if (typeof window !== 'undefined') {
        const seg = window.location.pathname.split('/').filter(Boolean)[0] || '';
        if (URL_LANG_MAP[seg]) detectedLang = URL_LANG_MAP[seg];
        else if (typeof navigator !== 'undefined') {
          const nav = navigator.language?.slice(0, 2) || 'en';
          detectedLang = boundaryI18n[nav] ? nav : 'en';
        }
      }
      const lang = boundaryI18n[detectedLang] ? detectedLang : 'en';
      const t = boundaryI18n[lang];

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', minHeight: 200,
          padding: 24, background: '#0d1117', color: '#e6edf3',
          fontFamily: 'system-ui, sans-serif', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            {t.title}
          </div>
          <div style={{ fontSize: 13, color: '#6e7681', marginBottom: 20 }}>
            {this.state.error?.message ?? t.desc}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#388bfd', color: '#fff', fontSize: 13,
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t.retry}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
