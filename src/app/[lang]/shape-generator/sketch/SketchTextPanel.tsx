'use client';

// G6 — Sketch text panel (UI for F1).
//
// Lazy-loads Three.js Helvetiker font from /fonts/helvetiker.json (or any
// caller-supplied URL), converts user-typed text to closed sketch loops via
// textToSketchSegments, and emits them to the parent's onProfileChange so
// the existing extrude path can engrave / emboss the result.
//
// Caveat: requires `/fonts/helvetiker.json` (or another Three.js Font JSON)
// to be served from the app's public root. The Three.js examples ship a
// compatible file at three/examples/fonts/helvetiker_regular.typeface.json
// — copy it into `public/fonts/` for production.

import React, { useEffect, useRef, useState } from 'react';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import type { SketchProfile, SketchSegment } from './types';
import { textToSketchSegments, textBoundingBox } from './textToSketch';

interface SketchTextPanelProps {
  open: boolean;
  /** URL of a Three.js Font JSON. Defaults to /fonts/helvetiker.json. */
  fontUrl?: string;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
  onApply: (profile: SketchProfile) => void;
  onClose: () => void;
}

const dict = {
  ko: { title: '스케치 텍스트', text: '텍스트', size: '글자 크기 (mm)', x: 'X 위치', y: 'Y 위치', preview: '미리보기 크기', loading: '폰트 로딩 중…', loadFailed: '폰트 파일을 찾을 수 없습니다 (/fonts/helvetiker.json)', apply: '스케치에 추가', cancel: '취소' },
  en: { title: 'Sketch Text', text: 'Text', size: 'Size (mm)', x: 'X position', y: 'Y position', preview: 'Preview size', loading: 'Loading font…', loadFailed: 'Font file not found (/fonts/helvetiker.json)', apply: 'Add to Sketch', cancel: 'Cancel' },
  ja: { title: 'スケッチテキスト', text: 'テキスト', size: 'サイズ (mm)', x: 'X 位置', y: 'Y 位置', preview: 'プレビューサイズ', loading: 'フォント読込中…', loadFailed: 'フォントファイルがありません', apply: 'スケッチに追加', cancel: 'キャンセル' },
  zh: { title: '草图文本', text: '文本', size: '大小 (mm)', x: 'X 位置', y: 'Y 位置', preview: '预览大小', loading: '加载字体…', loadFailed: '字体文件未找到', apply: '添加到草图', cancel: '取消' },
  es: { title: 'Texto del Boceto', text: 'Texto', size: 'Tamaño (mm)', x: 'Posición X', y: 'Posición Y', preview: 'Tamaño previo', loading: 'Cargando fuente…', loadFailed: 'Archivo de fuente no encontrado', apply: 'Añadir al Boceto', cancel: 'Cancelar' },
  ar: { title: 'نص الرسم', text: 'النص', size: 'الحجم (مم)', x: 'موضع X', y: 'موضع Y', preview: 'حجم المعاينة', loading: 'جارٍ تحميل الخط…', loadFailed: 'لم يتم العثور على ملف الخط', apply: 'إضافة إلى الرسم', cancel: 'إلغاء' },
};

const C = {
  bg: 'var(--nx-panel)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent-2)',
  cellBg: 'var(--nx-bg)',
};

export default function SketchTextPanel({
  open, fontUrl = '/fonts/helvetiker.json', lang, onApply, onClose,
}: SketchTextPanelProps) {
  const t = dict[lang] ?? dict.en;
  const [fontState, setFontState] = useState<{ font: Font | null; error: string | null; loading: boolean }>(
    { font: null, error: null, loading: false },
  );
  const [text, setText] = useState('TEXT');
  const [size, setSize] = useState(10);
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (loadedFor.current === fontUrl) return;
    loadedFor.current = fontUrl;
    setFontState({ font: null, error: null, loading: true });
    const loader = new FontLoader();
    loader.load(
      fontUrl,
      (font) => setFontState({ font, error: null, loading: false }),
      undefined,
      () => setFontState({ font: null, error: t.loadFailed, loading: false }),
    );
  }, [open, fontUrl, t.loadFailed]);

  if (!open) return null;

  const previewBbox = fontState.font
    ? textBoundingBox(fontState.font, text, size)
    : { width: 0, height: 0 };

  const handleApply = () => {
    if (!fontState.font) return;
    const segments: SketchSegment[] = textToSketchSegments(fontState.font, text, {
      size, x: posX, y: posY,
    });
    onApply({ segments, closed: true });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.bg, color: C.text, borderRadius: 10,
          padding: 20, width: 460, border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🅰️ {t.title}</h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: C.muted,
            fontSize: 18, cursor: 'pointer',
          }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, color: C.muted }}>
            {t.text}
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              style={{
                width: '100%', marginTop: 4, padding: '8px 10px',
                background: C.cellBg, color: C.text, borderRadius: 6,
                border: `1px solid ${C.border}`, fontSize: 14,
              }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <label style={{ fontSize: 12, color: C.muted }}>
              {t.size}
              <input
                type="number" value={size} step={1} min={1}
                onChange={e => setSize(Math.max(1, Number(e.target.value)))}
                style={inputStyle}
              />
            </label>
            <label style={{ fontSize: 12, color: C.muted }}>
              {t.x}
              <input type="number" value={posX} step={1} onChange={e => setPosX(Number(e.target.value))} style={inputStyle} />
            </label>
            <label style={{ fontSize: 12, color: C.muted }}>
              {t.y}
              <input type="number" value={posY} step={1} onChange={e => setPosY(Number(e.target.value))} style={inputStyle} />
            </label>
          </div>

          <div style={{
            background: C.cellBg, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: 10, fontSize: 11, color: C.muted, minHeight: 36,
          }}>
            {fontState.loading && <span>{t.loading}</span>}
            {fontState.error && <span style={{ color: 'var(--nx-error)' }}>{fontState.error}</span>}
            {fontState.font && (
              <span>
                {t.preview}: {previewBbox.width.toFixed(1)} × {previewBbox.height.toFixed(1)} mm
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 14px', borderRadius: 6, border: 'none',
                background: '#374151', color: C.text, fontSize: 13, cursor: 'pointer',
              }}
            >{t.cancel}</button>
            <button
              onClick={handleApply}
              disabled={!fontState.font}
              style={{
                padding: '8px 14px', borderRadius: 6, border: 'none',
                background: fontState.font ? C.accent : '#374151',
                color: 'var(--nx-text)', fontSize: 13, fontWeight: 700,
                cursor: fontState.font ? 'pointer' : 'not-allowed',
              }}
            >{t.apply}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '6px 8px',
  background: C.cellBg, color: C.text, borderRadius: 6,
  border: `1px solid ${C.border}`, fontSize: 13,
};
