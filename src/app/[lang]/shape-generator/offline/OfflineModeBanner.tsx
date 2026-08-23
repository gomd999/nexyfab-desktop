'use client';

/**
 * OfflineModeBanner.tsx
 *
 * Shows a thin banner above the viewport when the user goes offline.
 * Two variants based on environment:
 *
 *   - Tauri desktop: "Offline — AI 비활성, sketch/export 사용 가능"
 *   - Web: "Offline — 작업이 저장되지 않을 수 있습니다"
 *
 * Auto-hides 4s after coming back online (with a brief "다시 연결됨"
 * green flash for confirmation).
 */

import React, { useEffect, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { bcp47 } from '@/lib/i18n/format';

export interface OfflineModeBannerProps {
  lang: string;
  isOffline: boolean;
  isTauri: boolean;
  lastOnlineAt: number | null;
  onRecheck?: () => void;
}

const COPY = {
  ko: {
    tauriOffline: '오프라인 — 스케치 / Export 사용 가능. AI 기능 비활성.',
    webOffline:   '오프라인 — 일부 기능이 제한됩니다. 작업이 저장되지 않을 수 있어요.',
    reconnect: '다시 연결됨',
    recheck: '재확인',
    sinceLabel: '마지막 연결',
  },
  en: {
    tauriOffline: 'Offline — sketch / export still work. AI features disabled.',
    webOffline:   'Offline — some features unavailable. Your work may not be saved.',
    reconnect: 'Reconnected',
    recheck: 'Re-check',
    sinceLabel: 'Last online',
  },
  ja: {
    tauriOffline: 'オフライン — スケッチ / エクスポートは使用できます。AI 機能は無効です。',
    webOffline:   'オフライン — 一部の機能が制限されます。作業が保存されない場合があります。',
    reconnect: '再接続しました',
    recheck: '再確認',
    sinceLabel: '最終接続',
  },
  zh: {
    tauriOffline: '离线 — 草图 / 导出仍可使用。AI 功能已停用。',
    webOffline:   '离线 — 部分功能受限。您的工作可能不会被保存。',
    reconnect: '已重新连接',
    recheck: '重新检查',
    sinceLabel: '最后在线',
  },
  es: {
    tauriOffline: 'Sin conexión: el boceto y la exportación siguen funcionando. Funciones de IA desactivadas.',
    webOffline:   'Sin conexión: algunas funciones no están disponibles. Puede que su trabajo no se guarde.',
    reconnect: 'Conexión restablecida',
    recheck: 'Volver a comprobar',
    sinceLabel: 'Última conexión',
  },
  ar: {
    tauriOffline: 'غير متصل — الرسم والتصدير ما زالا يعملان. مزايا الذكاء الاصطناعي معطّلة.',
    webOffline:   'غير متصل — بعض المزايا غير متاحة. قد لا يُحفظ عملك.',
    reconnect: 'تمت إعادة الاتصال',
    recheck: 'إعادة الفحص',
    sinceLabel: 'آخر اتصال',
  },
} as const;

export default function OfflineModeBanner({
  lang, isOffline, isTauri, lastOnlineAt, onRecheck,
}: OfflineModeBannerProps) {
  const [showReconnectedFlash, setShowReconnectedFlash] = useState(false);
  const [prevOffline, setPrevOffline] = useState(isOffline);

  // Trigger reconnect flash when transitioning offline → online.
  useEffect(() => {
    if (prevOffline && !isOffline) {
      setShowReconnectedFlash(true);
      const id = window.setTimeout(() => setShowReconnectedFlash(false), 3500);
      setPrevOffline(false);
      return () => window.clearTimeout(id);
    }
    if (!prevOffline && isOffline) setPrevOffline(true);
  }, [isOffline, prevOffline]);

  if (!isOffline && !showReconnectedFlash) return null;
  const t = COPY[toIsoLang(lang)] ?? COPY.en;

  const message = isOffline
    ? (isTauri ? t.tauriOffline : t.webOffline)
    : t.reconnect;

  const sinceText = lastOnlineAt
    ? `${t.sinceLabel}: ${new Date(lastOnlineAt).toLocaleTimeString(bcp47(lang))}`
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 900,
        padding: '8px 16px',
        background: isOffline ? '#f59e0b' : '#22c55e',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: 600,
        textAlign: 'center',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span aria-hidden>{isOffline ? '⚠' : '✓'}</span>
      <span>{message}</span>
      {sinceText && isOffline && (
        <span style={{ opacity: 0.85, fontWeight: 400 }}>· {sinceText}</span>
      )}
      {isOffline && onRecheck && (
        <button
          type="button"
          onClick={onRecheck}
          style={{
            background: 'rgba(255,255,255,0.25)',
            border: 'none',
            color: 'white',
            padding: '2px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {t.recheck}
        </button>
      )}
    </div>
  );
}
