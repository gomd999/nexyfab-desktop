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
import { langDir, toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import { loc } from '@/lib/i18n/loc';

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
  /** Undo the last committed AI transaction as one operation. */
  onUndo?: () => void | Promise<void>;
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

type DetailCopy = {
  ko: string;
  en: string;
  ja: string;
  zh: string;
  es: string;
  ar: string;
};

/** Secondary labels that used to be Korean/English-only in this surface. */
const DETAIL_COPY: Record<string, DetailCopy> = {
  imageAttached: {
    ko: '사진 첨부됨 — 보내면 사진에서 모델을 만듭니다',
    en: 'Photo attached — send to build a model from it',
    ja: '写真を添付しました — 送信すると写真からモデルを作成します',
    zh: '已附加照片 — 发送后将从照片创建模型',
    es: 'Foto adjunta — envíala para crear un modelo a partir de ella',
    ar: 'تم إرفاق صورة — أرسلها لإنشاء نموذج منها',
  },
  removeImage: {
    ko: '첨부 사진 제거',
    en: 'Remove attached photo',
    ja: '添付写真を削除',
    zh: '移除附加照片',
    es: 'Quitar la foto adjunta',
    ar: 'إزالة الصورة المرفقة',
  },
  attachPhoto: {
    ko: '사진 첨부',
    en: 'Attach photo',
    ja: '写真を添付',
    zh: '附加照片',
    es: 'Adjuntar foto',
    ar: 'إرفاق صورة',
  },
  imageInputLabel: {
    ko: 'AI 설계 참조 사진',
    en: 'AI design reference image',
    ja: 'AI設計の参照画像',
    zh: 'AI 设计参考图片',
    es: 'Imagen de referencia para el diseño con IA',
    ar: 'صورة مرجعية لتصميم الذكاء الاصطناعي',
  },
  promptLabel: {
    ko: 'AI 설계 요청',
    en: 'AI design request',
    ja: 'AI設計リクエスト',
    zh: 'AI 设计请求',
    es: 'Solicitud de diseño con IA',
    ar: 'طلب تصميم بالذكاء الاصطناعي',
  },
  photoPrompt: {
    ko: '사진 설명(선택) — 그냥 보내도 됩니다',
    en: 'Describe the photo (optional) — or just send',
    ja: '写真の説明（任意）— そのまま送信もできます',
    zh: '描述照片（可选）— 也可以直接发送',
    es: 'Describe la foto (opcional) — o envíala directamente',
    ar: 'صف الصورة (اختياري) — أو أرسلها مباشرة',
  },
  imageTooLarge: {
    ko: '이미지가 너무 커요 (최대 8MB)',
    en: 'Image too large (max 8MB)',
    ja: '画像が大きすぎます（最大8MB）',
    zh: '图片过大（最大 8MB）',
    es: 'La imagen es demasiado grande (máximo 8 MB)',
    ar: 'الصورة كبيرة جدًا (الحد الأقصى 8 ميجابايت)',
  },
  undoHint: {
    ko: '마지막 AI 변경을 한 번에 되돌릴 수 있습니다.',
    en: 'The last AI transaction can be undone atomically.',
    ja: '最後のAI変更を一度に元に戻せます。',
    zh: '可以一次撤销上一次 AI 更改。',
    es: 'Puedes deshacer de una vez la última transacción de IA.',
    ar: 'يمكن التراجع عن آخر تعديل للذكاء الاصطناعي دفعة واحدة.',
  },
  undoDone: {
    ko: 'AI 변경을 되돌렸습니다.',
    en: 'The AI edit was undone.',
    ja: 'AIの変更を元に戻しました。',
    zh: '已撤销 AI 更改。',
    es: 'Se deshizo el cambio de IA.',
    ar: 'تم التراجع عن تعديل الذكاء الاصطناعي.',
  },
  undoAction: {
    ko: 'AI 변경 되돌리기',
    en: 'Undo AI edit',
    ja: 'AI変更を元に戻す',
    zh: '撤销 AI 更改',
    es: 'Deshacer cambio de IA',
    ar: 'التراجع عن تعديل الذكاء الاصطناعي',
  },
  templatesHint: {
    ko: '예시로 시작 (눌러서 채우고 수정):',
    en: 'Start from a template (click to fill, then edit):',
    ja: 'テンプレートから開始（クリックして入力後に編集）:',
    zh: '从模板开始（点击填充，然后编辑）：',
    es: 'Empieza con una plantilla (haz clic para rellenar y editar):',
    ar: 'ابدأ بقالب (انقر للتعبئة ثم عدّل):',
  },
  failed: {
    ko: '실패했습니다',
    en: 'Failed',
    ja: '失敗しました',
    zh: '失败',
    es: 'Falló',
    ar: 'فشلت العملية',
  },
};

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

type TemplateText = { label: string; prompt: string };

const TEMPLATE_COPY: Record<IsoLang, TemplateText[]> = {
  ko: TEMPLATES.map(t => ({ label: t.ko, prompt: t.promptKo })),
  en: TEMPLATES.map(t => ({ label: t.en, prompt: t.promptEn })),
  ja: [
    { label: 'ブラケット', prompt: 'L字ブラケット、脚60mm、幅30mm、厚さ5mm、⌀6穴' },
    { label: 'ボックス/ケース', prompt: '80×60×30ケース、壁厚2mm、角R3mm' },
    { label: 'ギア', prompt: '平歯車、24歯、厚さ10mm、⌀8ボア' },
    { label: 'フランジ', prompt: 'フランジ、外径⌀80、ボア⌀30、厚さ8mm、PCD60に⌀8ボルト6個' },
    { label: 'カップ', prompt: 'カップ、⌀50、高さ80mm、壁厚2mm' },
    { label: 'スペーサー', prompt: 'スペーサー、高さ15、外径⌀8、ボア⌀3.2' },
  ],
  zh: [
    { label: '支架', prompt: 'L 形支架，支腿 60mm，宽 30mm，厚 5mm，⌀6 孔' },
    { label: '盒子/外壳', prompt: '80×60×30 外壳，壁厚 2mm，圆角 3mm' },
    { label: '齿轮', prompt: '直齿轮，24 齿，厚 10mm，⌀8 轴孔' },
    { label: '法兰', prompt: '法兰，外径⌀80，孔⌀30，厚 8mm，PCD 60 上 6 个⌀8 螺栓' },
    { label: '杯子', prompt: '杯子，⌀50，高 80mm，壁厚 2mm' },
    { label: '支柱', prompt: '支柱，高 15，外径⌀8，孔⌀3.2' },
  ],
  es: [
    { label: 'Soporte', prompt: 'Soporte en L, patas de 60 mm, ancho 30 mm, grosor 5 mm, agujeros ⌀6' },
    { label: 'Caja/carcasa', prompt: 'Carcasa 80×60×30, paredes de 2 mm, esquinas redondeadas 3 mm' },
    { label: 'Engranaje', prompt: 'Engranaje recto, 24 dientes, grosor 10 mm, taladro ⌀8' },
    { label: 'Brida', prompt: 'Brida, exterior ⌀80, taladro ⌀30, grosor 8 mm, 6 pernos ⌀8 en PCD 60' },
    { label: 'Vaso', prompt: 'Vaso, ⌀50, altura 80 mm, paredes de 2 mm' },
    { label: 'Separador', prompt: 'Separador, altura 15, exterior ⌀8, taladro ⌀3,2' },
  ],
  ar: [
    { label: 'حامل L', prompt: 'حامل L، ساقان 60 مم، عرض 30 مم، سماكة 5 مم، ثقوب ⌀6' },
    { label: 'صندوق/غلاف', prompt: 'غلاف 80×60×30، جدران 2 مم، زوايا مستديرة 3 مم' },
    { label: 'ترس', prompt: 'ترس مستقيم، 24 سنًا، سماكة 10 مم، تجويف ⌀8' },
    { label: 'شفة', prompt: 'شفة، قطر خارجي ⌀80، تجويف ⌀30، سماكة 8 مم، 6 مسامير ⌀8 على PCD 60' },
    { label: 'كوب', prompt: 'كوب، ⌀50، ارتفاع 80 مم، جدران 2 مم' },
    { label: 'مباعد', prompt: 'مباعد، ارتفاع 15، قطر خارجي ⌀8، تجويف ⌀3.2' },
  ],
};

export default function FloatingAiPrompt({
  lang, onSubmit, onImageGenerate, onOpenFullChat, disabled = false, onUndo,
}: FloatingAiPromptProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null); // data URL of an attached photo
  const inputRef = useRef<HTMLInputElement | null>(null);

  const locale = toIsoLang(lang);
  const rtl = langDir(lang) === 'rtl';
  // Keep every visible secondary label on the same six-locale path as the
  // primary prompt copy; this also handles legacy /ko and /zh route values.
  const t = COPY[locale] ?? COPY.en;
  const detail = Object.fromEntries(
    Object.entries(DETAIL_COPY).map(([key, value]) => [key, loc(lang, value)]),
  ) as Record<keyof typeof DETAIL_COPY, string>;

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
      setResponse((err as Error)?.message ?? detail.failed);
    } finally {
      setStreaming(false);
    }
  };

  const onPickImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) { setResponse(detail.imageTooLarge); return; }
    const r = new FileReader();
    r.onload = () => { if (typeof r.result === 'string') setImage(r.result); };
    r.readAsDataURL(file);
  };

  if (!open) {
    return (
      <button
        type="button"
        dir={rtl ? 'rtl' : 'ltr'}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        aria-label={t.pill}
        style={{
          position: 'fixed',
          bottom: 28,
          insetInlineEnd: 28,
          direction: rtl ? 'rtl' : 'ltr',
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
      dir={rtl ? 'rtl' : 'ltr'}
      aria-label={t.pill}
      style={{
        position: 'fixed',
        bottom: 24,
        insetInlineEnd: 24,
        direction: rtl ? 'rtl' : 'ltr',
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
          <img src={image} alt={detail.imageAttached} style={{ height: 40, width: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--nx-border)' }} />
          <span style={{ fontSize: 11, color: 'var(--nx-text-2)', flex: 1 }}>{detail.imageAttached}</span>
          <button type="button" aria-label={detail.removeImage} onClick={() => setImage(null)} style={{ background: 'none', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {onImageGenerate && (
          <label htmlFor="floating-ai-image-input" title={detail.attachPhoto} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)', borderRadius: 8, cursor: streaming || disabled ? 'default' : 'pointer', fontSize: 16, flexShrink: 0 }}>
            <input id="floating-ai-image-input" name="floatingAiImage" aria-label={detail.imageInputLabel} type="file" accept="image/*" style={{ display: 'none' }} disabled={streaming || disabled} onChange={e => { onPickImage(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            📎
          </label>
        )}
        <input
          ref={inputRef}
          id="floating-ai-prompt-input"
          name="floatingAiPrompt"
          aria-label={detail.promptLabel}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(); }}
          placeholder={image ? detail.photoPrompt : t.placeholder}
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

      {onUndo && !streaming && !response && (
        <div style={{
          marginTop: 8, padding: '7px 9px', borderRadius: 7,
          border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          fontSize: 11, color: 'var(--nx-text-2)',
        }}>
          <span>{detail.undoHint}</span>
          <button
            type="button"
            onClick={async () => {
              await onUndo();
              setResponse(detail.undoDone);
            }}
            style={{
              flexShrink: 0, background: 'transparent', border: '1px solid var(--nx-border)',
              borderRadius: 6, padding: '5px 9px', color: 'var(--nx-text)', cursor: 'pointer',
            }}
          >
            ↶ {detail.undoAction}
          </button>
        </div>
      )}

      {!streaming && !response && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 5 }}>
            {detail.templatesHint}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TEMPLATES.map((tpl, index) => {
              const template = (TEMPLATE_COPY[locale] ?? TEMPLATE_COPY.en)[index]!;
              return (
              <button
                key={tpl.en}
                type="button"
                onClick={() => { setText(template.prompt); setTimeout(() => inputRef.current?.focus(), 0); }}
                style={{
                  background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                  borderRadius: 999, padding: '4px 10px', fontSize: 11,
                  color: 'var(--nx-text)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {tpl.icon} {template.label}
              </button>
              );
            })}
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
          <div style={{ whiteSpace: 'pre-wrap' }}>{response}</div>
          {onUndo && (
            <button
              type="button"
              onClick={async () => {
                await onUndo();
                setResponse(detail.undoDone);
              }}
              style={{
                marginTop: 8, background: 'transparent', border: '1px solid var(--nx-border)',
                borderRadius: 6, padding: '5px 9px', color: 'var(--nx-text)', cursor: 'pointer',
              }}
            >
              ↶ {detail.undoAction}
            </button>
          )}
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
