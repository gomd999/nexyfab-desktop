'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface RecoveryBannerProps {
  timestamp: number;
  lang: string;
  onRestore: () => void;
  onDismiss: () => void;
  /** Optional: open a 3D side-by-side diff between saved and current state.
   *  Lets the user verify what changed before committing to restore. */
  onCompare?: () => void;
  /** When true the banner uses a stronger label — "previous session ended
   *  unexpectedly" — to nudge the user to restore rather than dismiss. */
  fromCrash?: boolean;
}

const dict = {
  ko: { recovered: '미저장 작업 복구됨', crashRecovered: '비정상 종료된 작업 복구',
        restore: '복원', dismiss: '무시', compare: '비교',
        just: '방금 전', d: '일 전', h: '시간 전', m: '분 전' },
  en: { recovered: 'Unsaved work recovered', crashRecovered: 'Recovered after unexpected exit',
        restore: 'Restore', dismiss: 'Dismiss', compare: 'Compare',
        just: 'just now', d: ' day', h: ' hour', m: ' minute' },
  ja: { recovered: '未保存の作業を復元しました', crashRecovered: '異常終了後の復元',
        restore: '復元', dismiss: '閉じる', compare: '比較',
        just: 'たった今', d: '日前', h: '時間前', m: '分前' },
  zh: { recovered: '已恢复未保存的工作', crashRecovered: '异常退出后恢复',
        restore: '恢复', dismiss: '忽略', compare: '比较',
        just: '刚刚', d: '天前', h: '小时前', m: '分钟前' },
  es: { recovered: 'Trabajo sin guardar recuperado', crashRecovered: 'Recuperado tras cierre inesperado',
        restore: 'Restaurar', dismiss: 'Descartar', compare: 'Comparar',
        just: 'ahora mismo', d: ' día atrás', h: ' hora atrás', m: ' min atrás' },
  ar: { recovered: 'تم استرداد العمل غير المحفوظ', crashRecovered: 'استرداد بعد إغلاق غير متوقع',
        restore: 'استعادة', dismiss: 'تجاهل', compare: 'مقارنة',
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

  // English keeps the unit + plural 's' + " ago" separate ("3 days ago"); other
  // languages bake the suffix into d/h/m ("3日前", "3일 전") so append nothing.
  const ago = isEn ? ' ago' : '';
  if (days > 0) return `${days}${tt.d}${isEn && days > 1 ? 's' : ''}${ago}`;
  if (hours > 0) return `${hours}${tt.h}${isEn && hours > 1 ? 's' : ''}${ago}`;
  if (minutes > 0) return `${minutes}${tt.m}${isEn && minutes > 1 ? 's' : ''}${ago}`;
  return tt.just;
}

export default function RecoveryBanner({ timestamp, lang, onRestore, onDismiss, onCompare, fromCrash }: RecoveryBannerProps) {
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
    // In-flow banner strip (sibling of the other TopBanners) so it sits BELOW
    // the ribbon instead of a fixed top:56 that overlapped the taller shell-v2
    // chrome. Right-aligned compact pill; overflow-hidden contains the slide-in.
    <div
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '6px 16px 0',
        boxSizing: 'border-box',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px 6px 12px',
        background: 'var(--nx-panel-2)',
        border: '1px solid var(--nx-warn)55',
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
        background: 'var(--nx-warn)',
        boxShadow: '0 0 8px rgba(245, 158, 11, 0.5)',
        flexShrink: 0,
      }} />

      {/* Message */}
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-warn)', whiteSpace: 'nowrap' }}>
        {fromCrash ? t.crashRecovered : t.recovered}
      </span>
      <span style={{ fontSize: 11, color: 'var(--nx-text-2)', whiteSpace: 'nowrap' }}>
        {timeAgo}
      </span>

      {/* Compare button (optional) — opens 3D diff viewer */}
      {onCompare && (
        <button
          onClick={onCompare}
          style={{
            padding: '3px 10px',
            borderRadius: 5,
            border: '1px solid var(--nx-accent-2)',
            background: 'rgba(88, 166, 255, 0.12)',
            color: 'var(--nx-accent-2)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(88, 166, 255, 0.24)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(88, 166, 255, 0.12)'; }}
        >
          {t.compare}
        </button>
      )}

      {/* Restore button */}
      <button
        onClick={handleRestore}
        style={{
          padding: '3px 10px',
          borderRadius: 5,
          border: '1px solid var(--nx-warn)',
          background: 'rgba(245, 158, 11, 0.15)',
          color: 'var(--nx-warn)',
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
          color: 'var(--nx-text-2)',
          fontSize: 16, lineHeight: 1,
          fontWeight: 400,
          cursor: 'pointer',
          transition: 'color 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--nx-text)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--nx-text-2)'; }}
      >
        ×
      </button>
    </div>
    </div>
  );
}
