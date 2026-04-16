'use client';

import React, { useState, useRef, useEffect } from 'react';
import { encodeShareLink, copyToClipboard } from './io/shareLink';
import { analytics } from '@/lib/analytics';

// ─── Theme constants (match CommandToolbar) ──────────────────────────────────
const C = {
  bg: '#161b22',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  hover: '#30363d',
  dropBg: '#21262d',
};

interface ShareButtonProps {
  shape: string;
  params: Record<string, number>;
  material: string;
  /** When this value changes, the popover opens and copies the link (triggered externally). */
  autoOpenKey?: number;
  color: string;
  lang: string;
  /** Optional label override (falls back to i18n key or 'Share') */
  label?: string;
}

export default function ShareButton({
  shape,
  params,
  material,
  color,
  lang,
  label,
  autoOpenKey,
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [copiedView, setCopiedView] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [viewOnlyUrl, setViewOnlyUrl] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerViewRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAutoOpenKeyRef = useRef(autoOpenKey);
  const isKo = lang === 'ko';

  // Build URLs lazily when popover opens or copy is triggered
  function buildUrl() {
    return encodeShareLink(shape, params, material, color, lang);
  }

  function buildViewOnlyUrl() {
    const base = encodeShareLink(shape, params, material, color, lang);
    return base + '&readonly=1';
  }

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverOpen]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (timerViewRef.current) clearTimeout(timerViewRef.current);
    };
  }, []);

  // External trigger: open popover when autoOpenKey changes
  useEffect(() => {
    if (autoOpenKey === undefined) return;
    if (autoOpenKey === prevAutoOpenKeyRef.current) return;
    prevAutoOpenKeyRef.current = autoOpenKey;
    const url = buildUrl();
    const viewUrl = buildViewOnlyUrl();
    setShareUrl(url);
    setViewOnlyUrl(viewUrl);
    setPopoverOpen(true);
    handleCopy(url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenKey]);

  async function handleCopy(url?: string) {
    const link = url ?? buildUrl();
    try {
      await copyToClipboard(link);
      analytics.modelShare();
    } catch {
      // ignore clipboard errors
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyView() {
    const link = viewOnlyUrl || buildViewOnlyUrl();
    try {
      await copyToClipboard(link);
    } catch { /* ignore */ }
    setCopiedView(true);
    if (timerViewRef.current) clearTimeout(timerViewRef.current);
    timerViewRef.current = setTimeout(() => setCopiedView(false), 2000);
  }

  function handleButtonClick() {
    const url = buildUrl();
    const viewUrl = buildViewOnlyUrl();
    setShareUrl(url);
    setViewOnlyUrl(viewUrl);
    setPopoverOpen(v => !v);
    if (!popoverOpen) {
      handleCopy(url);
    }
  }

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 5,
    border: 'none',
    background: popoverOpen ? C.accent : 'transparent',
    color: popoverOpen ? '#fff' : C.text,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.1s',
    flexShrink: 0,
  };

  const urlRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: '6px 8px',
  };

  const urlTextStyle: React.CSSProperties = {
    flex: 1,
    fontSize: 11,
    color: C.accent,
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    userSelect: 'all',
  };

  const copyBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${C.border}`,
    background: active ? '#16a34a' : C.hover,
    color: active ? '#fff' : C.text,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.15s',
  });

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: C.textDim,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    marginBottom: 4,
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Main share button */}
      <button
        style={btnStyle}
        onClick={handleButtonClick}
        onMouseEnter={e => { if (!popoverOpen) e.currentTarget.style.background = C.hover; }}
        onMouseLeave={e => { if (!popoverOpen) e.currentTarget.style.background = 'transparent'; }}
        title={label ?? 'Share design link'}
      >
        🔗 {copied ? (isKo ? '복사됨!' : 'Copied!') : (label ?? (isKo ? '공유' : 'Share'))}
      </button>

      {/* Popover */}
      {popoverOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          background: C.dropBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 12,
          zIndex: 300,
          minWidth: 340,
          maxWidth: 440,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>

          {/* ── Edit Link ── */}
          <div>
            <div style={sectionLabelStyle}>
              ✏️ {isKo ? '편집 링크' : 'Edit Link'}
            </div>
            <div style={urlRowStyle}>
              <span style={urlTextStyle}>{shareUrl}</span>
              <button style={copyBtnStyle(copied)} onClick={() => handleCopy(shareUrl)}>
                {copied ? (isKo ? '✓ 복사됨' : '✓ Copied') : (isKo ? '복사' : 'Copy')}
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
              {isKo
                ? '이 링크를 열면 동일한 형상, 파라미터, 재료가 복원됩니다.'
                : 'Opening this link restores the exact shape, parameters, and material.'}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: `1px solid ${C.border}` }} />

          {/* ── View-Only Link ── */}
          <div>
            <div style={sectionLabelStyle}>
              🔒 {isKo ? '뷰어 전용 링크' : 'View-Only Link'}
            </div>
            <div style={urlRowStyle}>
              <span style={{ ...urlTextStyle, color: '#f59e0b' }}>{viewOnlyUrl}</span>
              <button style={copyBtnStyle(copiedView)} onClick={handleCopyView}>
                {copiedView ? (isKo ? '✓ 복사됨' : '✓ Copied') : (isKo ? '복사' : 'Copy')}
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
              {isKo
                ? '편집 기능 없이 3D 뷰어만 열립니다. 팀원이나 고객과 공유하세요.'
                : 'Opens 3D viewer only — no editing. Share with teammates or clients.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
