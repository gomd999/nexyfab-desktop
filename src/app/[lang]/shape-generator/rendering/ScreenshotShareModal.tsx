'use client';

import React, { useState, useEffect } from 'react';
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

interface ScreenshotShareModalProps {
  canvas: HTMLCanvasElement;
  shapeName?: string;
  isKo: boolean;
  onClose: () => void;
  onDownload: () => void;
}

export default function ScreenshotShareModal({
  canvas,
  shapeName,
  isKo,
  onClose,
  onDownload,
}: ScreenshotShareModalProps) {
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
              {isKo ? '스크린샷 공유' : 'Share Screenshot'}
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
              {isKo ? '렌더링 중...' : 'Rendering...'}
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
            ⬇ {isKo ? '다운로드 (PNG)' : 'Download PNG'}
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
              {copied ? '✓' : '📋'} {copied
                ? (isKo ? '복사됨!' : 'Copied!')
                : (isKo ? '클립보드 복사' : 'Copy to Clipboard')}
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
          {isKo
            ? '고해상도 2x PNG (렌더링 캔버스 기준)'
            : 'High-resolution 2x PNG from the render canvas'}
        </div>
      </div>
    </div>
  );
}
