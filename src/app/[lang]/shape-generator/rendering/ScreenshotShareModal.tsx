'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { captureHighRes, copyScreenshotToClipboard } from './useScreenshot';

const C = {
  bg: '#0d1117',
  surface: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
};

const dict = {
  ko: {
    title: '스크린샷 공유',
    rendering: '렌더링 중...',
    download: '다운로드 (PNG)',
    copied: '복사됨!',
    copy: '클립보드 복사',
    hint: '고해상도 2x PNG (렌더링 캔버스 기준)',
  },
  en: {
    title: 'Share Screenshot',
    rendering: 'Rendering...',
    download: 'Download PNG',
    copied: 'Copied!',
    copy: 'Copy to Clipboard',
    hint: 'High-resolution 2x PNG from the render canvas',
  },
  ja: {
    title: 'スクリーンショットを共有',
    rendering: 'レンダリング中...',
    download: 'PNGをダウンロード',
    copied: 'コピーしました!',
    copy: 'クリップボードにコピー',
    hint: '高解像度2x PNG (レンダーキャンバスから)',
  },
  zh: {
    title: '分享截图',
    rendering: '渲染中...',
    download: '下载 PNG',
    copied: '已复制!',
    copy: '复制到剪贴板',
    hint: '来自渲染画布的高分辨率 2x PNG',
  },
  es: {
    title: 'Compartir Captura',
    rendering: 'Renderizando...',
    download: 'Descargar PNG',
    copied: '¡Copiado!',
    copy: 'Copiar al Portapapeles',
    hint: 'PNG 2x de alta resolución del lienzo de renderizado',
  },
  ar: {
    title: 'مشاركة لقطة الشاشة',
    rendering: 'جاري التصيير...',
    download: 'تنزيل PNG',
    copied: 'تم النسخ!',
    copy: 'نسخ إلى الحافظة',
    hint: 'PNG عالي الدقة 2x من لوحة التصيير',
  },
};

interface ScreenshotShareModalProps {
  canvas: HTMLCanvasElement;
  shapeName?: string;
  isKo?: boolean;
  onClose: () => void;
  onDownload: () => void;
}

export default function ScreenshotShareModal({
  canvas,
  shapeName,
  onClose,
  onDownload,
}: ScreenshotShareModalProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [clipboardSupported, setClipboardSupported] = useState(false);

  useEffect(() => {
    const url = captureHighRes(canvas, 2);
    setDataUrl(url);
    setClipboardSupported(!!navigator.clipboard?.write);
  }, [canvas]);

  const handleCopy = async () => {
    const ok = await copyScreenshotToClipboard(canvas, 2);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 99999, padding: 24,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 560, overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>📸</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>
              {t.title}
            </p>
            {shapeName && (
              <p style={{ margin: 0, fontSize: 11, color: C.textDim }}>{shapeName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: C.textDim, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Preview */}
        <div style={{ background: C.bg, padding: 16, textAlign: 'center' }}>
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="Screenshot preview"
              style={{
                maxWidth: '100%', maxHeight: 300, borderRadius: 8,
                border: `1px solid ${C.border}`,
                objectFit: 'contain',
              }}
            />
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontSize: 12 }}>
              {t.rendering}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ padding: '14px 18px', display: 'flex', gap: 10 }}>
          {/* Download */}
          <button
            onClick={() => { onDownload(); }}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: 'none', background: C.accent, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            ⬇ {t.download}
          </button>

          {/* Copy to clipboard */}
          {clipboardSupported && (
            <button
              onClick={handleCopy}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8,
                border: `1px solid ${copied ? C.green : C.border}`,
                background: copied ? `${C.green}15` : C.card,
                color: copied ? C.green : C.text,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {copied ? '✓' : '📋'} {copied ? t.copied : t.copy}
            </button>
          )}

          {/* Native share (mobile) */}
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              onClick={async () => {
                if (!dataUrl) return;
                try {
                  const res = await fetch(dataUrl);
                  const blob = await res.blob();
                  const file = new File([blob], `nexyfab-${Date.now()}.png`, { type: 'image/png' });
                  await navigator.share({ files: [file], title: shapeName ?? 'NexyFab Design' });
                } catch { /* user cancelled */ }
              }}
              style={{
                padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.card,
                color: C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ↗
            </button>
          )}
        </div>

        {/* Hint */}
        <div style={{ padding: '0 18px 14px', fontSize: 10, color: '#484f58', textAlign: 'center' }}>
          {t.hint}
        </div>
      </div>
    </div>
  );
}
