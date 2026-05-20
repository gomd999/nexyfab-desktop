'use client';

/**
 * SampleTemplatePicker.tsx
 *
 * Empty-state surface for new users. Replaces the "blank canvas →
 * which feature do I add first?" friction with a grid of 5 starter
 * templates that one click → loaded feature pipeline → first STL in
 * < 5 minutes.
 *
 * Shown when:
 *   - User opens shape-generator with zero features in the pipeline
 *   - User clicks "New from template" in the empty-state CTA
 *
 * Skip path: every card has an "이 템플릿 사용" button, plus a
 * "빈 캔버스로 시작" link at the bottom for users who want the
 * legacy blank start.
 */

import React from 'react';
import { SAMPLE_TEMPLATES, type SampleTemplate, type SampleTemplateId } from './sampleTemplates';

interface SampleTemplatePickerProps {
  lang: string;
  /** Fired with the picked template's feature list ready to load. */
  onPick: (template: SampleTemplate) => void;
  /** "Blank canvas" escape hatch. */
  onSkip?: () => void;
}

const isKo = (lang: string) => lang === 'ko' || lang === 'kr';
const isJa = (lang: string) => lang === 'ja' || lang === 'jp';

function nameFor(t: SampleTemplate, lang: string): string {
  if (isKo(lang)) return t.nameKo;
  if (isJa(lang)) return t.nameJa;
  return t.nameEn;
}
function descFor(t: SampleTemplate, lang: string): string {
  if (isKo(lang)) return t.descKo;
  if (isJa(lang)) return t.descJa;
  return t.descEn;
}

const ICONS: Record<SampleTemplateId, string> = {
  bracket:    '🔩',
  enclosure:  '📦',
  box:        '🟦',
  disk:       '⚙️',
  rod:        '➖',
};

export default function SampleTemplatePicker({
  lang, onPick, onSkip,
}: SampleTemplatePickerProps) {
  const ko = isKo(lang);
  const ja = isJa(lang);
  const t = ko
    ? { title: '템플릿으로 시작', subtitle: '5분 안에 첫 부품을 만들어 다운로드해보세요', timeLabel: '약', minLabel: '분', useBtn: '이 템플릿 사용', skip: '빈 캔버스로 시작' }
    : ja
      ? { title: 'テンプレートで開始', subtitle: '5分以内に最初の部品を作成してダウンロード', timeLabel: '約', minLabel: '分', useBtn: 'このテンプレートを使用', skip: '空白のキャンバスで開始' }
      : { title: 'Start from a template', subtitle: 'Make your first part and download it in under 5 minutes', timeLabel: '~', minLabel: 'min', useBtn: 'Use this template', skip: 'Start with a blank canvas' };

  return (
    <div
      role="dialog"
      aria-labelledby="sample-template-picker-title"
      style={{
        maxWidth: 960,
        margin: '24px auto',
        padding: '28px 24px',
        background: '#0f172a',
        color: '#e5e7eb',
        borderRadius: 12,
        boxShadow: '0 12px 30px rgba(0,0,0,0.3)',
      }}
    >
      <h2
        id="sample-template-picker-title"
        style={{
          margin: '0 0 8px',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}
      >
        {t.title}
      </h2>
      <p style={{ margin: '0 0 24px', color: '#94a3b8', fontSize: 14 }}>
        {t.subtitle}
      </p>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        }}
      >
        {SAMPLE_TEMPLATES.map(sample => (
          <div
            key={sample.id}
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'border-color 120ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155'; }}
          >
            <div style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>
              {ICONS[sample.id]}
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {nameFor(sample, lang)}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, flex: 1 }}>
              {descFor(sample, lang)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {t.timeLabel} {sample.timeToExportMin} {t.minLabel}
              </span>
              <button
                type="button"
                onClick={() => onPick(sample)}
                style={{
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t.useBtn}
              </button>
            </div>
          </div>
        ))}
      </div>

      {onSkip && (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button
            type="button"
            onClick={onSkip}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: 13,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {t.skip}
          </button>
        </div>
      )}
    </div>
  );
}
