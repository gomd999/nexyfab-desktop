'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface RecoveryBannerProps {
  timestamp: number;
  lang: string;
  onRestore: () => void;
  onDismiss: () => void;
}

const dict = {
  ko: { recovered: '미저장 작업 복구됨', restore: '복원', dismiss: '무시',
        just: '방금 전', d: '일 전', h: '시간 전', m: '분 전' },
  en: { recovered: 'Unsaved work recovered', restore: 'Restore', dismiss: 'Dismiss',
        just: 'just now', d: ' day ago', h: ' hour ago', m: ' minute ago' },
  ja: { recovered: '未保存の作業を復元しました', restore: '復元', dismiss: '閉じる',
        just: 'たった今', d: '日前', h: '時間前', m: '分前' },
  zh: { recovered: '已恢复未保存的工作', restore: '恢复', dismiss: '忽略',
        just: '刚刚', d: '天前', h: '小时前', m: '分钟前' },
  es: { recovered: 'Trabajo sin guardar recuperado', restore: 'Restaurar', dismiss: 'Descartar',
        just: 'ahora mismo', d: ' día atrás', h: ' hora atrás', m: ' min atrás' },
  ar: { recovered: 'تم استرداد العمل غير المحفوظ', restore: 'استعادة', dismiss: 'تجاهل',
        just: 'الآن', d: ' يوم مضى', h: ' ساعة مضت', m: ' دقيقة مضت' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

function formatTimeAgo(ts: number, tt: typeof dict[keyof typeof dict], isEn: boolean): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}${tt.d}${isEn && days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours}${tt.h}${isEn && hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes}${tt.m}${isEn && minutes > 1 ? 's' : ''}`;
  return tt.just;
}

export default function RecoveryBanner({ timestamp, lang, onRestore, onDismiss }: RecoveryBannerProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const key = langMap[seg] ?? 'en';
  const t = dict[key];

  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(), 300);
  };

  const handleRestore = () => {
    setExiting(true);
    setTimeout(() => onRestore(), 300);
  };

  const timeAgo = formatTimeAgo(timestamp, t, key === 'en');

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        right: 16,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px 6px 12px',
        background: '#21262d',
        border: '1px solid #f59e0b55',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        flexShrink: 0,
        transform: visible && !exiting ? 'translateX(0)' : 'translateX(120%)',
        opacity: visible && !exiting ? 1 : 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        maxWidth: 420,
      }}
    >
      {/* Warning icon */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#f59e0b',
        boxShadow: '0 0 8px rgba(245, 158, 11, 0.5)',
        flexShrink: 0,
      }} />

      {/* Message */}
      <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', whiteSpace: 'nowrap' }}>
        {t.recovered}
      </span>
      <span style={{ fontSize: 11, color: '#8b949e', whiteSpace: 'nowrap' }}>
        {timeAgo}
      </span>

      {/* Restore button */}
      <button
        onClick={handleRestore}
        style={{
          padding: '3px 10px',
          borderRadius: 5,
          border: '1px solid #f59e0b',
          background: 'rgba(245, 158, 11, 0.15)',
          color: '#f59e0b',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(245, 158, 11, 0.3)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)';
        }}
      >
        {t.restore}
      </button>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label={t.dismiss}
        title={t.dismiss}
        style={{
          width: 22, height: 22, padding: 0,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: '#8b949e',
          fontSize: 16, lineHeight: 1,
          fontWeight: 400,
          cursor: 'pointer',
          transition: 'color 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; }}
      >
        ×
      </button>
    </div>
  );
}
