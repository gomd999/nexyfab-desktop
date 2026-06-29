'use client';

/**
 * FloatingAiPrompt.tsx
 *
 * AI prompt bar floating over the viewport — Phase-2 Week-2 surface.
 * Replaces the "AI lives in a sidebar" pattern with always-on quick
 * input that doesn't steal screen real estate.
 *
 * Three states:
 *   - **collapsed** (default): pill button "✨ AI" at bottom-right
 *   - **typing**: pill expands to single-line input + send
 *   - **streaming**: input replaced with "..." indicator until done
 *
 * The full conversation history lives in the existing
 * `AIAssistantSidebar` — clicking the inline result link opens the
 * sidebar with the full thread.
 *
 * Submit routes via prop callback so the parent can hand off to the
 * existing intent-parser / SCAD generator pipeline. No new chat
 * brain — this is purely an *input* surface.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface FloatingAiPromptProps {
  lang: string;
  /** Submit the prompt for AI processing. Caller should route to the
   *  existing intent → SCAD → feature pipeline. */
  onSubmit: (prompt: string) => Promise<string | null>;
  /** Optional callback when user wants to open the full sidebar. */
  onOpenFullChat?: () => void;
  /** Optional: disable the prompt (e.g. while WASM loads). */
  disabled?: boolean;
}

const STORAGE_KEY = 'nexyfab_floating_ai_open_v1';

const COPY = {
  ko: {
    pill: '✨ AI로 설계·수정',
    placeholder: '예: 50mm 정육면체 만들고 위쪽에 10mm 구멍 뚫어줘',
    send: '보내기',
    streaming: '생성 중...',
    full: '전체 대화 열기',
    close: '닫기',
    hint: '⌘K',
  },
  en: {
    pill: '✨ Design with AI',
    placeholder: 'e.g. Make a 50mm cube with a 10mm hole on top',
    send: 'Send',
    streaming: 'Generating...',
    full: 'Open full chat',
    close: 'Close',
    hint: '⌘K',
  },
} as const;

/** One-click starting points — clicking fills the input with a ready, editable
 *  prompt so a beginner designs by tweaking an example instead of facing a blank
 *  box (and never needs the hard manual sketch→extrude flow). */
const TEMPLATES: { icon: string; ko: string; en: string; promptKo: string; promptEn: string }[] = [
  { icon: '📐', ko: '브래킷', en: 'Bracket', promptKo: 'L자 브래킷, 다리 60mm, 폭 30mm, 두께 5mm, ⌀6 구멍', promptEn: 'L-bracket, 60mm legs, 30mm wide, 5mm thick, ⌀6 holes' },
  { icon: '📦', ko: '박스/케이스', en: 'Box', promptKo: '80×60×30 케이스, 벽 2mm, 모서리 라운드 3mm', promptEn: '80×60×30 enclosure, 2mm walls, 3mm rounded corners' },
  { icon: '⚙️', ko: '기어', en: 'Gear', promptKo: '스퍼기어 24톱니, 두께 10mm, ⌀8 보어', promptEn: 'Spur gear, 24 teeth, 10mm thick, ⌀8 bore' },
  { icon: '🔘', ko: '플랜지', en: 'Flange', promptKo: '플랜지 외경 80, 보어 30, 두께 8, ⌀8 볼트 6개 PCD 60', promptEn: 'Flange, ⌀80 outer, ⌀30 bore, 8mm thick, 6× ⌀8 bolts on PCD 60' },
  { icon: '🥤', ko: '컵/화병', en: 'Cup', promptKo: '컵, 지름 50, 높이 80, 벽 2mm', promptEn: 'Cup, ⌀50, 80mm tall, 2mm walls' },
  { icon: '🔩', ko: '스탠드오프', en: 'Standoff', promptKo: '스탠드오프 높이 15, 외경 8, ⌀3.2 보어', promptEn: 'Standoff, 15mm tall, ⌀8 outer, ⌀3.2 bore' },
];

export default function FloatingAiPrompt({
  lang, onSubmit, onOpenFullChat, disabled = false,
}: FloatingAiPromptProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;

  // Restore last open state. On a FIRST visit (no stored preference) open it, so
  // new users meet the "just describe it" front door instead of the full ribbon.
  useEffect(() => {
    try { const v = window.localStorage.getItem(STORAGE_KEY); setOpen(v === null ? true : v === 'true'); } catch { /* ok */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, String(open)); } catch { /* ok */ }
  }, [open]);

  // ⌘K / Ctrl+K opens the prompt and focuses input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && open && document.activeElement === inputRef.current) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSubmit = async () => {
    if (!text.trim() || streaming || disabled) return;
    const prompt = text.trim();
    setStreaming(true);
    setResponse(null);
    try {
      const result = await onSubmit(prompt);
      setResponse(result ?? null);
      setText('');
    } catch (err) {
      setResponse((err as Error)?.message ?? 'Failed');
    } finally {
      setStreaming(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        aria-label={t.pill}
        style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          zIndex: 850,
          background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
          color: 'white',
          border: 'none',
          borderRadius: 999,
          padding: '12px 18px',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 10px 24px rgba(139,92,246,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>{t.pill}</span>
        <span
          aria-hidden
          style={{
            fontSize: 10, opacity: 0.85,
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 4, padding: '1px 5px',
            fontFamily: 'monospace',
          }}
        >
          {t.hint}
        </span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={t.pill}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 850,
        width: 'min(440px, calc(100vw - 48px))',
        background: 'var(--nx-panel)',
        color: 'var(--nx-text)',
        borderRadius: 12,
        boxShadow: '0 16px 36px rgba(0,0,0,0.4)',
        padding: '12px',
        fontFamily: 'system-ui, sans-serif',
        border: '1px solid var(--nx-panel-2)',
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(); }}
          placeholder={t.placeholder}
          disabled={streaming || disabled}
          style={{
            flex: 1,
            background: 'var(--nx-panel-2)',
            color: 'var(--nx-text)',
            border: '1px solid var(--nx-border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!text.trim() || streaming || disabled}
          style={{
            background: streaming || !text.trim() ? 'var(--nx-border)' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '0 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: streaming || !text.trim() ? 'default' : 'pointer',
          }}
        >
          {streaming ? '…' : t.send}
        </button>
      </div>

      {!streaming && !response && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 5 }}>
            {ko ? '예시로 시작 (눌러서 채우고 수정):' : 'Start from a template (click to fill, then edit):'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TEMPLATES.map(tpl => (
              <button
                key={tpl.en}
                type="button"
                onClick={() => { setText(ko ? tpl.promptKo : tpl.promptEn); setTimeout(() => inputRef.current?.focus(), 0); }}
                style={{
                  background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                  borderRadius: 999, padding: '4px 10px', fontSize: 11,
                  color: 'var(--nx-text)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {tpl.icon} {ko ? tpl.ko : tpl.en}
              </button>
            ))}
          </div>
        </div>
      )}

      {streaming && (
        <div style={{ marginTop: 10, padding: '8px 12px', fontSize: 12, color: 'var(--nx-text-2)' }}>
          {t.streaming}
        </div>
      )}

      {response && !streaming && (
        <div
          style={{
            marginTop: 10, padding: '10px 12px',
            background: 'var(--nx-panel-2)', borderRadius: 8,
            fontSize: 13, lineHeight: 1.55, color: 'var(--nx-text)',
            maxHeight: 220, overflowY: 'auto',
          }}
        >
          {response}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        {onOpenFullChat ? (
          <button
            type="button"
            onClick={onOpenFullChat}
            style={{
              background: 'transparent', border: 'none', color: 'var(--nx-text-2)',
              fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            {t.full}
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--nx-text-2)',
            fontSize: 11, cursor: 'pointer',
          }}
        >
          {t.close}
        </button>
      </div>
    </div>
  );
}
