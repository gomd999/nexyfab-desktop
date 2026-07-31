'use client';

/**
 * InlineSuggestionOverlay.tsx
 *
 * Renders inline suggestion badges + a quick-fix popup. Subscribes
 * to the suggestions emitted by `computeInlineSuggestions` after
 * each pipeline run, and shows them as tooltip indicators next to
 * each feature in the feature tree.
 *
 * Click → popover with details + "Apply fix" button when the
 * suggestion carries an autoFix. Apply routes through the same
 * featureEditDispatcher used by the AI shell so undo / origin
 * tracking stays consistent.
 */

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import type { InlineSuggestion } from './inlineSuggestion';
import { getSuggestionColor } from './inlineSuggestion';

export interface InlineSuggestionOverlayProps {
  lang: string;
  suggestions: InlineSuggestion[];
  /** Apply the autoFix value to the named feature param. */
  onApplyFix: (suggestion: InlineSuggestion) => void;
  /** Dismiss a suggestion without acting. */
  onDismiss?: (suggestionId: string) => void;
}

const COPY = {
  ko: { apply: '자동 수정', dismiss: '닫기', details: '상세' },
  en: { apply: 'Auto-fix',  dismiss: 'Dismiss', details: 'Details' },
  ja: { apply: '自動修正', dismiss: '閉じる', details: '詳細' },
  zh: { apply: '自动修复', dismiss: '关闭', details: '详情' },
  es: { apply: 'Corregir', dismiss: 'Descartar', details: 'Detalles' },
  ar: { apply: 'إصلاح تلقائي', dismiss: 'إغلاق', details: 'التفاصيل' },
} as const;

export default function InlineSuggestionOverlay({
  lang, suggestions, onApplyFix, onDismiss,
}: InlineSuggestionOverlayProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (suggestions.length === 0) return null;
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: `ko ? COPY.ko : COPY.en` 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;

  // Group suggestions per featureId so we badge once per feature.
  const byFeature = new Map<string, InlineSuggestion[]>();
  for (const s of suggestions) {
    if (!byFeature.has(s.featureId)) byFeature.set(s.featureId, []);
    byFeature.get(s.featureId)!.push(s);
  }

  return (
    <>
      {/* Render one floating panel listing all suggestions. The actual
          per-feature tree badges are rendered by the feature tree
          component reading the same suggestions list. */}
      <div
        style={{
          position: 'fixed',
          top: 80, left: 20,
          zIndex: 650,
          width: 320,
          maxHeight: '60vh',
          overflowY: 'auto',
          background: 'var(--nx-panel)',
          color: 'var(--nx-text)',
          borderRadius: 10,
          boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
          padding: '8px 0',
        }}
      >
        <div style={{ padding: '4px 14px 8px', fontSize: 11, color: 'var(--nx-text-2)', fontWeight: 600, letterSpacing: '0.04em' }}>
          {ko ? '제안' : 'SUGGESTIONS'} ({suggestions.length})
        </div>
        {suggestions.map(s => (
          <div
            key={s.id}
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--nx-panel-2)',
              cursor: s.autoFix ? 'pointer' : 'default',
            }}
            onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: getSuggestionColor(s.severity),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{s.title}</span>
            </div>
            {expandedId === s.id && (
              <>
                <p style={{ margin: '6px 0 8px', fontSize: 11, color: 'var(--nx-text-2)', lineHeight: 1.5 }}>
                  {s.recommendation}
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {s.autoFix && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onApplyFix(s); }}
                      style={{
                        background: '#3b82f6', color: 'white', border: 'none',
                        padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {t.apply}
                    </button>
                  )}
                  {onDismiss && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDismiss(s.id); }}
                      style={{
                        background: 'transparent', color: 'var(--nx-text-2)', border: 'none',
                        padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      {t.dismiss}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
