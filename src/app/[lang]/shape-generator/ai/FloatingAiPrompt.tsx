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
import { toIsoLang } from '@/lib/i18n/normalize';

export interface FloatingAiPromptProps {
  lang: string;
  /** Submit the prompt for AI processing. Caller should route to the
   *  existing intent → SCAD → feature pipeline. */
  onSubmit: (prompt: string) => Promise<string | null>;
  /** Optional: build a model from an attached photo (vision → SCAD → mesh).
   *  When set, a 📎 attach button appears; submitting with a photo routes here. */
  onImageGenerate?: (prompt: string, image: string) => Promise<string | null>;
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
  ja: {
    pill: '✨ AI で設計・修正',
    placeholder: '例: 50mm の立方体を作って上面に 10mm の穴を開けて',
    send: '送信',
    streaming: '生成中...',
    full: '全画面チャットを開く',
    close: '閉じる',
    hint: '⌘K',
  },
  zh: {
    pill: '✨ 用 AI 设计/修改',
    placeholder: '例如：做一个 50mm 立方体，并在顶面开一个 10mm 的孔',
    send: '发送',
    streaming: '生成中...',
    full: '打开完整对话',
    close: '关闭',
    hint: '⌘K',
  },
  es: {
    pill: '✨ Diseñar con IA',
    placeholder: 'p. ej.: Haz un cubo de 50 mm con un agujero de 10 mm arriba',
    send: 'Enviar',
    streaming: 'Generando...',
    full: 'Abrir el chat completo',
    close: 'Cerrar',
    hint: '⌘K',
  },
  ar: {
    pill: '✨ صمّم بالذكاء الاصطناعي',
    placeholder: 'مثال: اصنع مكعباً 50 مم مع ثقب 10 مم في الأعلى',
    send: 'إرسال',
    streaming: 'جارٍ التوليد...',
    full: 'فتح المحادثة الكاملة',
    close: 'إغلاق',
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
  lang, onSubmit, onImageGenerate, onOpenFullChat, disabled = false,
}: FloatingAiPromptProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null); // data URL of an attached photo
  const inputRef = useRef<HTMLInputElement | null>(null);

  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;

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
    if (streaming || disabled) return;
    if (!text.trim() && !image) return;
    const prompt = text.trim();
    setStreaming(true);
    setResponse(null);
    try {
      const result = (image && onImageGenerate)
        ? await onImageGenerate(prompt, image)
        : await onSubmit(prompt);
      setResponse(result ?? null);
      setText('');
      setImage(null);
    } catch (err) {
      setResponse((err as Error)?.message ?? 'Failed');
    } finally {
      setStreaming(false);
    }
  };

  const onPickImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) { setResponse(lang === 'ko' ? '이미지가 너무 커요 (최대 8MB)' : 'Image too large (max 8MB)'); return; }
    const r = new FileReader();
    r.onload = () => { if (typeof r.result === 'string') setImage(r.result); };
    r.readAsDataURL(file);
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
      {image && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          { }
          <img src={image} alt="attached" style={{ height: 40, width: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--nx-border)' }} />
          <span style={{ fontSize: 11, color: 'var(--nx-text-2)', flex: 1 }}>{ko ? '사진 첨부됨 — 보내면 사진에서 모델을 만듭니다' : 'Photo attached — send to build a model from it'}</span>
          <button type="button" onClick={() => setImage(null)} style={{ background: 'none', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {onImageGenerate && (
          <label title={ko ? '사진 첨부' : 'Attach photo'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)', borderRadius: 8, cursor: streaming || disabled ? 'default' : 'pointer', fontSize: 16, flexShrink: 0 }}>
            <input type="file" accept="image/*" style={{ display: 'none' }} disabled={streaming || disabled} onChange={e => { onPickImage(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            📎
          </label>
        )}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(); }}
          placeholder={image ? (ko ? '사진 설명(선택) — 그냥 보내도 됩니다' : 'Describe the photo (optional) — or just send') : t.placeholder}
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
          disabled={(!text.trim() && !image) || streaming || disabled}
          style={{
            background: streaming || (!text.trim() && !image) ? 'var(--nx-border)' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '0 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: streaming || (!text.trim() && !image) ? 'default' : 'pointer',
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
