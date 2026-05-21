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

import React, { useState } from 'react';
import { SAMPLE_TEMPLATES, EVERYDAY_PRESETS, type SampleTemplate, type SampleTemplateId, type EverydayPreset } from './sampleTemplates';

interface SampleTemplatePickerProps {
  lang: string;
  /** Fired with the picked template's feature list ready to load. */
  onPick: (template: SampleTemplate) => void;
  /** "Blank canvas" escape hatch. */
  onSkip?: () => void;
  /** AI front door: fired with a natural-language prompt when the user types a
   *  request or clicks an everyday-product preset. When omitted, the AI
   *  section is hidden (keeps the picker usable where no AI host is wired). */
  onAiPrompt?: (prompt: string) => void;
}

const isKo = (lang: string) => lang === 'ko' || lang === 'kr';
const isJa = (lang: string) => lang === 'ja' || lang === 'jp';

function presetName(p: EverydayPreset, lang: string): string {
  if (isKo(lang)) return p.nameKo;
  if (isJa(lang)) return p.nameJa;
  return p.nameEn;
}
function presetDesc(p: EverydayPreset, lang: string): string {
  if (isKo(lang)) return p.descKo;
  if (isJa(lang)) return p.descJa;
  return p.descEn;
}
function presetPrompt(p: EverydayPreset, lang: string): string {
  return isKo(lang) ? p.promptKo : p.promptEn;
}

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
  lang, onPick, onSkip, onAiPrompt,
}: SampleTemplatePickerProps) {
  const ko = isKo(lang);
  const ja = isJa(lang);
  const [aiInput, setAiInput] = useState('');
  const t = ko
    ? { title: '템플릿으로 시작', subtitle: '5분 안에 첫 부품을 만들어 다운로드해보세요', timeLabel: '약', minLabel: '분', useBtn: '이 템플릿 사용', skip: '빈 캔버스로 시작',
        aiTitle: 'AI로 만들기', aiHint: '만들고 싶은 것을 말로 적어보세요', aiPlaceholder: '예: 폭 85mm 휴대폰 거치대', aiBtn: '생성', everydayTitle: '일상 제품으로 시작', templatesTitle: '엔지니어링 템플릿' }
    : ja
      ? { title: 'テンプレートで開始', subtitle: '5分以内に最初の部品を作成してダウンロード', timeLabel: '約', minLabel: '分', useBtn: 'このテンプレートを使用', skip: '空白のキャンバスで開始',
          aiTitle: 'AIで作成', aiHint: '作りたいものを言葉で入力', aiPlaceholder: '例: 幅85mmのスマホスタンド', aiBtn: '生成', everydayTitle: '日用品から始める', templatesTitle: 'エンジニアリングテンプレート' }
      : { title: 'Start from a template', subtitle: 'Make your first part and download it in under 5 minutes', timeLabel: '~', minLabel: 'min', useBtn: 'Use this template', skip: 'Start with a blank canvas',
          aiTitle: 'Make it with AI', aiHint: 'Describe what you want to make', aiPlaceholder: 'e.g. a phone stand 85mm wide', aiBtn: 'Generate', everydayTitle: 'Start from an everyday product', templatesTitle: 'Engineering templates' };

  const submitAi = () => {
    const p = aiInput.trim();
    if (!p || !onAiPrompt) return;
    onAiPrompt(p);
    setAiInput('');
  };

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

      {/* ── AI front door: natural-language input + everyday-product presets ── */}
      {onAiPrompt && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>✨ {t.aiTitle}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>{t.aiHint}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              type="text"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAi(); }}
              placeholder={t.aiPlaceholder}
              aria-label={t.aiHint}
              style={{
                flex: 1, background: '#1e293b', border: '1px solid #334155', color: '#e5e7eb',
                borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={submitAi}
              disabled={!aiInput.trim()}
              style={{
                background: aiInput.trim() ? '#3b82f6' : '#1e293b', color: 'white', border: 'none',
                padding: '0 18px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: aiInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              {t.aiBtn}
            </button>
          </div>

          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>{t.everydayTitle}</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {EVERYDAY_PRESETS.map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onAiPrompt(presetPrompt(preset, lang))}
                style={{
                  background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
                  padding: 14, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer',
                  textAlign: 'left', color: '#e5e7eb', transition: 'border-color 120ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155'; }}
              >
                <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden>{preset.icon}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{presetName(preset, lang)}</span>
                <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>{presetDesc(preset, lang)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {onAiPrompt && (
        <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1', margin: '0 0 10px' }}>{t.templatesTitle}</div>
      )}

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
