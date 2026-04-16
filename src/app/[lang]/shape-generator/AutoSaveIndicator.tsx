'use client';

import React, { useEffect, useState } from 'react';
import type { CloudSyncStatus } from './useCloudSaveFlow';

interface Props {
  isSaving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  lang: string;
  /** Cloud sync status — shown as a ☁ badge when logged in */
  cloudStatus?: CloudSyncStatus;
  cloudSavedAt?: number | null;
}

const MSG = {
  saving: { ko: '저장 중…', en: 'Saving…', ja: '保存中…', cn: '保存中…', es: 'Guardando…', ar: 'جاري الحفظ…' },
  saved: { ko: '저장됨', en: 'Saved', ja: '保存済み', cn: '已保存', es: 'Guardado', ar: 'محفوظ' },
  justNow: { ko: '방금', en: 'just now', ja: 'たった今', cn: '刚刚', es: 'ahora', ar: 'الآن' },
  secondsAgo: {
    ko: (n: number) => `${n}초 전`,
    en: (n: number) => `${n}s ago`,
    ja: (n: number) => `${n}秒前`,
    cn: (n: number) => `${n}秒前`,
    es: (n: number) => `hace ${n}s`,
    ar: (n: number) => `قبل ${n}ث`,
  },
  minutesAgo: {
    ko: (n: number) => `${n}분 전`,
    en: (n: number) => `${n}m ago`,
    ja: (n: number) => `${n}分前`,
    cn: (n: number) => `${n}分钟前`,
    es: (n: number) => `hace ${n}m`,
    ar: (n: number) => `قبل ${n}د`,
  },
  error: { ko: '저장 실패', en: 'Save failed', ja: '保存失敗', cn: '保存失败', es: 'Fallo', ar: 'فشل' },
} as const;

function pick<T>(m: Record<string, T>, lang: string): T {
  return m[lang] ?? m.en;
}

function formatRelative(ts: number, lang: string, now: number): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 3) return pick(MSG.justNow, lang);
  if (diffSec < 60) return pick(MSG.secondsAgo, lang)(diffSec);
  const diffMin = Math.floor(diffSec / 60);
  return pick(MSG.minutesAgo, lang)(diffMin);
}

const CLOUD_MSG = {
  syncing: { ko: '클라우드 저장 중…', en: 'Syncing…' },
  synced:  { ko: '클라우드 저장됨', en: 'Cloud saved' },
  error:   { ko: '클라우드 저장 실패', en: 'Cloud sync failed' },
} as const;

export default function AutoSaveIndicator({ isSaving, lastSavedAt, saveError, lang, cloudStatus, cloudSavedAt }: Props) {
  const [now, setNow] = useState(Date.now());

  // lastSavedAt이 있으면 1초 간격으로 now 업데이트해서 "N초 전" 갱신
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  const showCloud = cloudStatus && cloudStatus !== 'idle';
  if (!isSaving && !lastSavedAt && !saveError && !showCloud) return null;

  const color = saveError ? '#f85149' : isSaving ? '#e3b341' : '#3fb950';
  const label = saveError
    ? pick(MSG.error, lang)
    : isSaving
    ? pick(MSG.saving, lang)
    : pick(MSG.saved, lang);
  const relative = !isSaving && !saveError && lastSavedAt ? formatRelative(lastSavedAt, lang, now) : null;

  return (
    <div style={{
      position: 'fixed', top: 64, right: 16, zIndex: 45,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 8,
      background: 'rgba(13,17,23,0.88)',
      border: `1px solid ${color}55`,
      color,
      fontSize: 11, fontWeight: 600,
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        animation: isSaving ? 'nf-save-pulse 1s ease-in-out infinite' : 'none',
      }} />
      <span>{label}</span>
      {relative && <span style={{ color: '#6e7681', fontWeight: 400 }}>· {relative}</span>}
      {showCloud && (
        <>
          <span style={{ color: '#30363d', margin: '0 2px' }}>|</span>
          <span style={{
            color: cloudStatus === 'error' ? '#f85149' : cloudStatus === 'syncing' ? '#e3b341' : '#58a6ff',
            animation: cloudStatus === 'syncing' ? 'nf-save-pulse 1s ease-in-out infinite' : 'none',
          }}>
            ☁ {(CLOUD_MSG[cloudStatus as keyof typeof CLOUD_MSG] ?? CLOUD_MSG.synced)[lang === 'ko' ? 'ko' : 'en']}
            {cloudStatus === 'synced' && cloudSavedAt && (
              <span style={{ color: '#6e7681', fontWeight: 400 }}>
                {' '}· {formatRelative(cloudSavedAt, lang, now)}
              </span>
            )}
          </span>
        </>
      )}
      <style>{`@keyframes nf-save-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}
