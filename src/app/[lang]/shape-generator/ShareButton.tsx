'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { encodeShareLink, copyToClipboard } from './io/shareLink';
import { analytics } from '@/lib/analytics';

// ─── i18n dict ───────────────────────────────────────────────────────────────
const dict = {
  ko: {
    share: '공유', copied: '복사됨!', copy: '복사', copyDone: '✓ 복사됨',
    editLink: '편집 링크', viewOnlyLink: '뷰어 전용 링크',
    editHint: '이 링크를 열면 동일한 형상, 파라미터, 재료가 복원됩니다.',
    viewHint: '편집 기능 없이 3D 뷰어만 열립니다. 팀원이나 고객과 공유하세요.',
    titleShare: '디자인 링크 공유',
  },
  en: {
    share: 'Share', copied: 'Copied!', copy: 'Copy', copyDone: '✓ Copied',
    editLink: 'Edit Link', viewOnlyLink: 'View-Only Link',
    editHint: 'Opening this link restores the exact shape, parameters, and material.',
    viewHint: 'Opens 3D viewer only — no editing. Share with teammates or clients.',
    titleShare: 'Share design link',
  },
  ja: {
    share: '共有', copied: 'コピー済み!', copy: 'コピー', copyDone: '✓ コピー済み',
    editLink: '編集リンク', viewOnlyLink: 'ビューア専用リンク',
    editHint: 'このリンクを開くと、同じ形状・パラメータ・素材が復元されます。',
    viewHint: '3Dビューアのみ開きます。編集はできません。チームや顧客と共有してください。',
    titleShare: 'デザインリンクを共有',
  },
  zh: {
    share: '分享', copied: '已复制!', copy: '复制', copyDone: '✓ 已复制',
    editLink: '编辑链接', viewOnlyLink: '仅查看链接',
    editHint: '打开此链接将恢复相同的形状、参数和材料。',
    viewHint: '仅打开3D查看器 — 不可编辑。与团队或客户共享。',
    titleShare: '分享设计链接',
  },
  es: {
    share: 'Compartir', copied: '¡Copiado!', copy: 'Copiar', copyDone: '✓ Copiado',
    editLink: 'Enlace de edición', viewOnlyLink: 'Enlace solo de vista',
    editHint: 'Abrir este enlace restaura la forma, parámetros y material exactos.',
    viewHint: 'Abre solo el visor 3D — sin edición. Comparte con tu equipo o clientes.',
    titleShare: 'Compartir enlace del diseño',
  },
  ar: {
    share: 'مشاركة', copied: 'تم النسخ!', copy: 'نسخ', copyDone: '✓ تم النسخ',
    editLink: 'رابط التحرير', viewOnlyLink: 'رابط العرض فقط',
    editHint: 'فتح هذا الرابط يستعيد نفس الشكل والمعلمات والمادة.',
    viewHint: 'يفتح عارض ثلاثي الأبعاد فقط — بدون تحرير. شاركه مع الفريق أو العملاء.',
    titleShare: 'مشاركة رابط التصميم',
  },
} as const;

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

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

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
        title={label ?? t.titleShare}
      >
        🔗 {copied ? t.copied : (label ?? t.share)}
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
              ✏️ {t.editLink}
            </div>
            <div style={urlRowStyle}>
              <span style={urlTextStyle}>{shareUrl}</span>
              <button style={copyBtnStyle(copied)} onClick={() => handleCopy(shareUrl)}>
                {copied ? t.copyDone : t.copy}
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
              {t.editHint}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: `1px solid ${C.border}` }} />

          {/* ── View-Only Link ── */}
          <div>
            <div style={sectionLabelStyle}>
              🔒 {t.viewOnlyLink}
            </div>
            <div style={urlRowStyle}>
              <span style={{ ...urlTextStyle, color: '#f59e0b' }}>{viewOnlyUrl}</span>
              <button style={copyBtnStyle(copiedView)} onClick={handleCopyView}>
                {copiedView ? t.copyDone : t.copy}
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
              {t.viewHint}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
