'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { encodeShareLink, copyToClipboard } from './io/shareLink';
import { analytics } from '@/lib/analytics';

// ─── i18n dict ───────────────────────────────────────────────────────────────
const dict = {
  ko: {
    share: '공유', copied: '복사됨!', copy: '복사', copyDone: '✓ 복사됨',
    editLink: '편집 링크', viewOnlyLink: '뷰어 전용 링크', collabLink: '실시간 협업 링크',
    editHint: '이 링크를 열면 동일한 형상, 파라미터, 재료가 복원됩니다.',
    viewHint: '편집 기능 없이 3D 뷰어만 열립니다. 팀원이나 고객과 공유하세요.',
    collabHint: '이 링크를 받은 사람과 같은 캔버스에서 동시 작업합니다 (Yjs CRDT 자동 동기화).',
    titleShare: '디자인 링크 공유',
  },
  en: {
    share: 'Share', copied: 'Copied!', copy: 'Copy', copyDone: '✓ Copied',
    editLink: 'Edit Link', viewOnlyLink: 'View-Only Link', collabLink: 'Live Collab Link',
    editHint: 'Opening this link restores the exact shape, parameters, and material.',
    viewHint: 'Opens 3D viewer only — no editing. Share with teammates or clients.',
    collabHint: 'Everyone with this link works on the same canvas in real time (Yjs CRDT auto-sync).',
    titleShare: 'Share design link',
  },
  ja: {
    share: '共有', copied: 'コピー済み!', copy: 'コピー', copyDone: '✓ コピー済み',
    editLink: '編集リンク', viewOnlyLink: 'ビューア専用リンク', collabLink: 'リアルタイム共同編集リンク',
    editHint: 'このリンクを開くと、同じ形状・パラメータ・素材が復元されます。',
    viewHint: '3Dビューアのみ開きます。編集はできません。チームや顧客と共有してください。',
    collabHint: 'このリンクを共有した人と同じキャンバスで同時編集します (Yjs CRDT 自動同期)。',
    titleShare: 'デザインリンクを共有',
  },
  zh: {
    share: '分享', copied: '已复制!', copy: '复制', copyDone: '✓ 已复制',
    editLink: '编辑链接', viewOnlyLink: '仅查看链接', collabLink: '实时协作链接',
    editHint: '打开此链接将恢复相同的形状、参数和材料。',
    viewHint: '仅打开3D查看器 — 不可编辑。与团队或客户共享。',
    collabHint: '收到此链接的人在同一画布上实时协作 (Yjs CRDT 自动同步)。',
    titleShare: '分享设计链接',
  },
  es: {
    share: 'Compartir', copied: '¡Copiado!', copy: 'Copiar', copyDone: '✓ Copiado',
    editLink: 'Enlace de edición', viewOnlyLink: 'Enlace solo de vista', collabLink: 'Enlace de colaboración en vivo',
    editHint: 'Abrir este enlace restaura la forma, parámetros y material exactos.',
    viewHint: 'Abre solo el visor 3D — sin edición. Comparte con tu equipo o clientes.',
    collabHint: 'Quien tenga este enlace edita el mismo lienzo en tiempo real (sincronización Yjs CRDT).',
    titleShare: 'Compartir enlace del diseño',
  },
  ar: {
    share: 'مشاركة', copied: 'تم النسخ!', copy: 'نسخ', copyDone: '✓ تم النسخ',
    editLink: 'رابط التحرير', viewOnlyLink: 'رابط العرض فقط', collabLink: 'رابط التعاون المباشر',
    editHint: 'فتح هذا الرابط يستعيد نفس الشكل والمعلمات والمادة.',
    viewHint: 'يفتح عارض ثلاثي الأبعاد فقط — بدون تحرير. شاركه مع الفريق أو العملاء.',
    collabHint: 'يتعاون كل من لديه هذا الرابط على نفس اللوحة في الوقت الفعلي (مزامنة Yjs CRDT).',
    titleShare: 'مشاركة رابط التصميم',
  },
} as const;

/**
 * Generate a stable, URL-safe room ID for live collaboration. The Yjs
 * WebsocketProvider in hooks/useAssemblyState.ts picks up `?room=...` from
 * the URL and any client joining the same room sees the same CRDT state.
 *
 * 9 hex chars (~36 bits of entropy) is enough to avoid practical
 * collisions across simultaneous rooms while keeping the URL short.
 */
function generateCollabRoomId(): string {
  const bytes = new Uint8Array(5);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 5; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 9);
}

// ─── Theme constants (match CommandToolbar) ──────────────────────────────────
const C = {
  bg: 'var(--nx-panel)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  textDim: 'var(--nx-text-2)',
  accent: 'var(--nx-accent)',
  hover: 'var(--nx-border)',
  dropBg: 'var(--nx-panel-2)',
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
  const [copiedCollab, setCopiedCollab] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [viewOnlyUrl, setViewOnlyUrl] = useState('');
  const [collabUrl, setCollabUrl] = useState('');
  // Collab room id is generated lazily once per ShareButton mount so the
  // same Share popover always offers a stable room URL — pressing copy
  // multiple times shouldn't rotate the link out from under invitees.
  const collabRoomIdRef = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerViewRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerCollabRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAutoOpenKeyRef = useRef(autoOpenKey);
  // Honesty gate (round-4 dogfooding): the "Live Collab Link" copy claims
  // real-time Yjs sync unconditionally, in every locale. useAssemblyState's
  // WebsocketProvider only actually connects when this env var is set — and
  // in every current deployment it is NOT (no producer anywhere in the repo:
  // no .env.example entry, no deploy config). Without this gate, a second
  // person opening the link gets a silently-isolated local document with zero
  // indication collab never connected. Hide the section entirely rather than
  // show a link that looks like it works but doesn't.
  const collabAvailable =
    typeof process !== 'undefined' && !!process.env.NEXT_PUBLIC_ASSEMBLY_COLLAB_WS_URL;

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

  /**
   * Build a collab link. Appends `?room=<roomId>` so useAssemblyState's
   * Yjs WebsocketProvider auto-joins the room. The roomId is generated
   * once on first request and cached on `collabRoomIdRef` so re-copying
   * the link doesn't rotate the room out from under invitees.
   */
  function buildCollabUrl() {
    if (!collabRoomIdRef.current) collabRoomIdRef.current = generateCollabRoomId();
    const base = encodeShareLink(shape, params, material, color, lang);
    return `${base}&room=${collabRoomIdRef.current}`;
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
      if (timerCollabRef.current) clearTimeout(timerCollabRef.current);
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

  async function handleCopyCollab() {
    const link = collabUrl || buildCollabUrl();
    try {
      await copyToClipboard(link);
    } catch { /* ignore */ }
    setCopiedCollab(true);
    if (timerCollabRef.current) clearTimeout(timerCollabRef.current);
    timerCollabRef.current = setTimeout(() => setCopiedCollab(false), 2000);
  }

  function handleButtonClick() {
    const url = buildUrl();
    const viewUrl = buildViewOnlyUrl();
    const collab = buildCollabUrl();
    setShareUrl(url);
    setViewOnlyUrl(viewUrl);
    setCollabUrl(collab);
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
    color: popoverOpen ? 'var(--nx-text)' : C.text,
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
    color: active ? 'var(--nx-text)' : C.text,
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
              <span style={{ ...urlTextStyle, color: 'var(--nx-warn)' }}>{viewOnlyUrl}</span>
              <button style={copyBtnStyle(copiedView)} onClick={handleCopyView}>
                {copiedView ? t.copyDone : t.copy}
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
              {t.viewHint}
            </div>
          </div>

          {/* ── Collab Link — Item 4 of usability cleanup. Yjs picks up the
                 `?room=` URL param and joins the same CRDT room automatically.
                 Only rendered when a real WS endpoint is actually configured
                 (see collabAvailable above) — never advertise a link that
                 silently isolates a second visitor instead of syncing. */}
          {collabAvailable && (
            <>
              <div style={{ borderTop: `1px solid ${C.border}` }} />
              <div>
                <div style={sectionLabelStyle}>
                  👥 {t.collabLink}
                </div>
                <div style={urlRowStyle}>
                  <span style={{ ...urlTextStyle, color: '#7fa9ff' }}>{collabUrl}</span>
                  <button style={copyBtnStyle(copiedCollab)} onClick={handleCopyCollab}>
                    {copiedCollab ? t.copyDone : t.copy}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
                  {t.collabHint}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
