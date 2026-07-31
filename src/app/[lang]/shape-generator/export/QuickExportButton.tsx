'use client';

/**
 * QuickExportButton.tsx
 *
 * Phase-2 first-time UX: a single visible "Download STL" button
 * floating over the viewport, plus a `Ctrl+E` shortcut, so the
 * user's first export takes one click rather than menu hunting.
 *
 * Shown only when:
 *   - geometry is present (pipeline produced output)
 *   - user has not dismissed the floating CTA permanently (LS flag)
 *
 * The full Export menu still lives in CommandToolbar — this button
 * is the "fast path" for the most common action (STL download).
 * Once a user exports once, the prominent floating variant is
 * hidden in favour of the menu (LS flag set on first click).
 */

import React, { useEffect, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';

const HIDE_FLOATING_KEY = 'nexyfab_quick_export_dismissed_v1';

export interface QuickExportButtonProps {
  lang: string;
  /** True when the pipeline has rendered geometry. */
  hasGeometry: boolean;
  /** STL export — caller wires to actual exporter. */
  onExportStl: () => void | Promise<void>;
}

const COPY = {
  ko: {
    label: 'STL 다운로드',
    hint: 'Ctrl+E',
    dismissAria: 'Quick Export 버튼 숨기기',
  },
  en: {
    label: 'Download STL',
    hint: 'Ctrl+E',
    dismissAria: 'Hide Quick Export button',
  },
  ja: { label: 'STL をダウンロード', hint: 'Ctrl+E', dismissAria: 'クイックエクスポートボタンを隠す' },
  zh: { label: '下载 STL', hint: 'Ctrl+E', dismissAria: '隐藏快速导出按钮' },
  es: { label: 'Descargar STL', hint: 'Ctrl+E', dismissAria: 'Ocultar el botón de exportación rápida' },
  ar: { label: 'تنزيل STL', hint: 'Ctrl+E', dismissAria: 'إخفاء زر التصدير السريع' },
} as const;

export default function QuickExportButton({
  lang, hasGeometry, onExportStl,
}: QuickExportButtonProps) {
  const [dismissed, setDismissed] = useState(true); // start hidden; flip after mount

  // Initialize from localStorage on mount. SSR-safe.
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(HIDE_FLOATING_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Ctrl+E shortcut — works regardless of `dismissed`.
  useEffect(() => {
    if (!hasGeometry) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        // Avoid swallowing form field "End-of-line" shortcuts.
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement | null)?.isContentEditable) return;
        e.preventDefault();
        void onExportStl();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasGeometry, onExportStl]);

  if (!hasGeometry || dismissed) return null;
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;

  const handleClick = () => {
    // First-use Education pattern: the FIRST click triggers export AND
    // sets the LS flag so subsequent visits use the menu (less visual
    // noise once the user knows the button exists).
    try { window.localStorage.setItem(HIDE_FLOATING_KEY, 'true'); } catch { /* ok */ }
    void onExportStl();
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 28,
        // Sit to the LEFT of the AI FAB (corner, ~right:28, ~110px wide) so the
        // two no longer overlap. (2026-06-12 bottom-right declutter)
        right: 150,
        zIndex: 800,
        display: 'flex',
        gap: 6,
        alignItems: 'stretch',
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={t.label}
        style={{
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: 10,
          padding: '14px 22px',
          fontSize: 15,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 8px 22px rgba(59,130,246,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>⬇</span>
        <span>{t.label}</span>
        <span
          aria-hidden
          style={{
            fontSize: 11, opacity: 0.85,
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 4, padding: '1px 6px',
            fontFamily: 'monospace',
          }}
        >
          {t.hint}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          try { window.localStorage.setItem(HIDE_FLOATING_KEY, 'true'); } catch { /* ok */ }
          setDismissed(true);
        }}
        aria-label={t.dismissAria}
        title={t.dismissAria}
        style={{
          background: '#1e293b',
          color: '#94a3b8',
          border: 'none',
          borderRadius: 10,
          padding: '0 10px',
          cursor: 'pointer',
          fontSize: 16,
        }}
      >
        ✕
      </button>
    </div>
  );
}
