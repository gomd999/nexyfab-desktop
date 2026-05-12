'use client';

// X3 — Mobile-only notice that the AI agent panel is desktop-exclusive.
//
// The agent panel is suppressed on mobile (it's 420px wide and
// touch-hostile) and so is the mode toggle, which means a mobile user
// has no way to discover the AI agent capability exists. This banner
// surfaces it once with a clear "open on desktop" recommendation.
//
// Dismissal persists in localStorage. We don't gate by viewport width
// inside the component — the parent decides when to mount us via
// `isMobile`, which already captures viewport + UA heuristics.

import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'nexyfab.shape-gen.mobile-agent-notice.v1';

const dict = {
  ko: { title: '🤖 AI 에이전트는 데스크톱에서',
    body: 'OpenSCAD 코드를 직접 작성하고 자가 수정하는 AI 에이전트는 큰 화면이 필요해 데스크톱 전용입니다. PC/맥에서 같은 링크를 다시 열어보세요.',
    dismiss: '알겠어요', copy: '링크 복사', copied: '복사됨' },
  en: { title: '🤖 AI Agent on desktop',
    body: 'The OpenSCAD AI agent (writes & self-corrects code in a 420px panel) is desktop-only. Open this same URL on a laptop or desktop browser.',
    dismiss: 'Got it', copy: 'Copy link', copied: 'Copied' },
  ja: { title: '🤖 AIエージェントはデスクトップで',
    body: 'OpenSCADコードを書いて自己修正するAIエージェントは大きな画面が必要なため、デスクトップ専用です。PC/Macで同じリンクを開いてください。',
    dismiss: '了解', copy: 'リンクをコピー', copied: 'コピー済み' },
  zh: { title: '🤖 AI 代理需在桌面端',
    body: '编写并自我修正 OpenSCAD 代码的 AI 代理需要更大屏幕，仅限桌面端。请在 PC/Mac 上打开同一链接。',
    dismiss: '知道了', copy: '复制链接', copied: '已复制' },
  es: { title: '🤖 Agente IA en escritorio',
    body: 'El agente IA de OpenSCAD (escribe y autocorrige código en un panel de 420px) es solo para escritorio. Abre esta URL en un portátil o de escritorio.',
    dismiss: 'Entendido', copy: 'Copiar enlace', copied: 'Copiado' },
  ar: { title: '🤖 وكيل الذكاء الاصطناعي على سطح المكتب',
    body: 'وكيل OpenSCAD AI (يكتب ويصحح الكود تلقائيًا في لوحة 420 بكسل) متاح على سطح المكتب فقط. افتح نفس الرابط على كمبيوتر محمول أو سطح مكتب.',
    dismiss: 'حسناً', copy: 'نسخ الرابط', copied: 'تم النسخ' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface MobileAgentNoticeProps {
  lang: string;
}

export default function MobileAgentNotice({ lang }: MobileAgentNoticeProps) {
  const t = dict[langMap[lang] ?? 'en'];
  const [show, setShow] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch { /* localStorage unavailable — show once per page load */ }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch { /* clipboard blocked — fall through */ }
  };

  return (
    <div style={containerStyle} role="dialog" aria-label={t.title}>
      <div style={headerStyle}>{t.title}</div>
      <p style={bodyStyle}>{t.body}</p>
      <div style={btnRowStyle}>
        <button onClick={copyLink} style={btnSecondary}>
          {copyState === 'copied' ? t.copied : t.copy}
        </button>
        <button onClick={dismiss} style={btnPrimary}>{t.dismiss}</button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 12, left: 12, right: 12,
  padding: 14,
  background: '#161b22',
  border: '1px solid #1f6feb',
  borderRadius: 10,
  color: '#e6edf3',
  zIndex: 800,
  boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
};
const headerStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700,
  color: '#79c0ff',
  marginBottom: 6,
};
const bodyStyle: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.4,
  color: '#c9d1d9',
  margin: '0 0 10px 0',
};
const btnRowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end',
};
const btnSecondary: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11, fontWeight: 600,
  borderRadius: 6,
  border: '1px solid #30363d',
  background: 'transparent',
  color: '#c9d1d9',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11, fontWeight: 700,
  borderRadius: 6,
  border: '1px solid #1f6feb',
  background: '#1f6feb',
  color: '#fff',
  cursor: 'pointer',
};
