'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { CloudSyncStatus } from './useCloudSaveFlow';

interface Props {
  isSaving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  lang: string;
  /** Cloud sync status — shown as a ☁ badge when logged in */
  cloudStatus?: CloudSyncStatus;
  cloudSavedAt?: number | null;
  /** PATCH 409 버전 충돌 시 서버 최신본으로 리로드 버튼 */
  versionConflictNeedsReload?: boolean;
  onReloadForCloudConflict?: () => void;
}

const dict = {
  ko: {
    saving: '저장 중…',
    saved: '저장됨',
    justNow: '방금',
    secondsAgo: (n: number) => `${n}초 전`,
    minutesAgo: (n: number) => `${n}분 전`,
    error: '저장 실패',
    cloudSyncing: '클라우드 저장 중…',
    cloudSynced: '클라우드 저장됨',
    cloudError: '클라우드 저장 실패',
    reloadFromServer: '서버에서 다시 불러오기',
  },
  en: {
    saving: 'Saving…',
    saved: 'Saved',
    justNow: 'just now',
    secondsAgo: (n: number) => `${n}s ago`,
    minutesAgo: (n: number) => `${n}m ago`,
    error: 'Save failed',
    cloudSyncing: 'Syncing…',
    cloudSynced: 'Cloud saved',
    cloudError: 'Cloud sync failed',
    reloadFromServer: 'Load latest from server',
  },
  ja: {
    saving: '保存中…',
    saved: '保存済み',
    justNow: 'たった今',
    secondsAgo: (n: number) => `${n}秒前`,
    minutesAgo: (n: number) => `${n}分前`,
    error: '保存失敗',
    cloudSyncing: 'クラウド保存中…',
    cloudSynced: 'クラウド保存済み',
    cloudError: 'クラウド保存失敗',
    reloadFromServer: 'サーバーから再読込',
  },
  zh: {
    saving: '保存中…',
    saved: '已保存',
    justNow: '刚刚',
    secondsAgo: (n: number) => `${n}秒前`,
    minutesAgo: (n: number) => `${n}分钟前`,
    error: '保存失败',
    cloudSyncing: '云同步中…',
    cloudSynced: '已云保存',
    cloudError: '云同步失败',
    reloadFromServer: '从服务器重新加载',
  },
  es: {
    saving: 'Guardando…',
    saved: 'Guardado',
    justNow: 'ahora',
    secondsAgo: (n: number) => `hace ${n}s`,
    minutesAgo: (n: number) => `hace ${n}m`,
    error: 'Fallo',
    cloudSyncing: 'Sincronizando…',
    cloudSynced: 'Guardado en la nube',
    cloudError: 'Error en la nube',
    reloadFromServer: 'Cargar último del servidor',
  },
  ar: {
    saving: 'جاري الحفظ…',
    saved: 'محفوظ',
    justNow: 'الآن',
    secondsAgo: (n: number) => `قبل ${n}ث`,
    minutesAgo: (n: number) => `قبل ${n}د`,
    error: 'فشل',
    cloudSyncing: 'جاري المزامنة…',
    cloudSynced: 'محفوظ في السحابة',
    cloudError: 'فشلت المزامنة السحابية',
    reloadFromServer: 'إعادة التحميل من الخادم',
  },
} as const;

function formatRelative(ts: number, t: (typeof dict)[keyof typeof dict], now: number): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 3) return t.justNow;
  if (diffSec < 60) return t.secondsAgo(diffSec);
  const diffMin = Math.floor(diffSec / 60);
  return t.minutesAgo(diffMin);
}

export default function AutoSaveIndicator({
  isSaving,
  lastSavedAt,
  saveError,
  lang,
  cloudStatus,
  cloudSavedAt,
  versionConflictNeedsReload,
  onReloadForCloudConflict,
}: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

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
    ? t.error
    : isSaving
    ? t.saving
    : t.saved;
  const relative = !isSaving && !saveError && lastSavedAt ? formatRelative(lastSavedAt, t, now) : null;

  const cloudLabel =
    cloudStatus === 'syncing' ? t.cloudSyncing :
    cloudStatus === 'error' ? t.cloudError :
    t.cloudSynced;

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
            ☁ {cloudLabel}
            {cloudStatus === 'synced' && cloudSavedAt && (
              <span style={{ color: '#6e7681', fontWeight: 400 }}>
                {' '}· {formatRelative(cloudSavedAt, t, now)}
              </span>
            )}
            {cloudStatus === 'error' && versionConflictNeedsReload && onReloadForCloudConflict && (
              <button
                type="button"
                onClick={onReloadForCloudConflict}
                style={{
                  pointerEvents: 'auto',
                  marginLeft: 8,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: '1px solid #58a6ff',
                  background: 'rgba(88,166,255,0.15)',
                  color: '#79c0ff',
                  cursor: 'pointer',
                }}
              >
                {t.reloadFromServer}
              </button>
            )}
          </span>
        </>
      )}
    </div>
  );
}
