'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export interface CollabReconnectBannerProps {
  /** 'retrying' → show countdown, 'failed' → show retry button, others → hide. */
  state: 'idle' | 'connecting' | 'connected' | 'retrying' | 'failed';
  /** Seconds until next automatic retry. */
  countdown: number;
  /** Manual reconnect handler (triggered on "Retry now"). */
  onRetry: () => void;
  /** UI language code. */
  lang: string;
}

const dict: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', { retrying: (s: number) => string; failed: string; retry: string; now: string }> = {
  ko: {
    retrying: (s) => `⚡ 협업 연결 끊김 — ${s}초 후 재시도...`,
    failed: '⚠ 협업 연결 실패. 네트워크 확인 후 재시도하세요.',
    retry: '재연결',
    now: '지금 재시도',
  },
  en: {
    retrying: (s) => `⚡ Collaboration disconnected — retrying in ${s}s...`,
    failed: '⚠ Could not reconnect. Check your network and try again.',
    retry: 'Retry',
    now: 'Retry now',
  },
  ja: {
    retrying: (s) => `⚡ 切断されました — ${s}秒後に再接続...`,
    failed: '⚠ 再接続に失敗しました。',
    retry: '再接続',
    now: '今すぐ再試行',
  },
  zh: {
    retrying: (s) => `⚡ 协作连接断开 — ${s}秒后重试...`,
    failed: '⚠ 无法重新连接。请检查网络后再试。',
    retry: '重新连接',
    now: '立即重试',
  },
  es: {
    retrying: (s) => `⚡ Colaboración desconectada — reintentando en ${s}s...`,
    failed: '⚠ No se pudo reconectar. Verifica tu red e inténtalo de nuevo.',
    retry: 'Reintentar',
    now: 'Reintentar ahora',
  },
  ar: {
    retrying: (s) => `⚡ انقطع الاتصال التعاوني — إعادة المحاولة خلال ${s} ثانية...`,
    failed: '⚠ تعذر إعادة الاتصال. تحقق من شبكتك وحاول مرة أخرى.',
    retry: 'إعادة المحاولة',
    now: 'إعادة المحاولة الآن',
  },
};

export default function CollabReconnectBanner({ state, countdown, onRetry, lang }: CollabReconnectBannerProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  if (state !== 'retrying' && state !== 'failed') return null;

  const isFailed = state === 'failed';

  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9500, padding: '8px 14px', borderRadius: 8,
        background: isFailed ? '#7a1d1d' : '#5c3a0d',
        color: '#fff',
        border: `1px solid ${isFailed ? '#f85149' : '#d29922'}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, fontWeight: 500,
        maxWidth: '90vw',
      }}
    >
      <span>{isFailed ? t.failed : t.retrying(countdown)}</span>
      <button
        onClick={onRetry}
        style={{
          background: '#fff', color: isFailed ? '#7a1d1d' : '#5c3a0d',
          border: 'none', borderRadius: 4, padding: '3px 10px',
          cursor: 'pointer', fontSize: 11, fontWeight: 700,
        }}
      >
        {isFailed ? t.retry : t.now}
      </button>
    </div>
  );
}
