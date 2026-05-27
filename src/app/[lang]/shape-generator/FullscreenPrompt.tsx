import React from 'react';

interface FullscreenPromptProps {
  show: boolean;
  onDismiss: (goFullscreen: boolean) => void;
  texts: {
    title: string;
    hint: string;
    goFullscreen: string;
    dismiss: string;
  };
}

export default function FullscreenPrompt({ show, onDismiss, texts }: FullscreenPromptProps) {
  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
      padding: '14px 20px',
      background: 'rgba(13,17,23,0.96)',
      borderTop: '1px solid var(--nx-border)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
      animation: 'nf-slide-up 0.3s ease-out' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--nx-warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
      </svg>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nx-text)', marginBottom: 2 }}>
          {texts.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {texts.hint}
        </div>
      </div>
      <button
        onClick={() => onDismiss(true)}
        style={{
          padding: '8px 18px', borderRadius: 8,
          background: 'linear-gradient(135deg, var(--nx-accent), #8b5cf6)',
          border: 'none', color: 'var(--nx-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          flexShrink: 0 }}
      >
        {texts.goFullscreen}
      </button>
      <button
        onClick={() => onDismiss(false)}
        style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'transparent', border: '1px solid var(--nx-border)',
          color: 'var(--nx-text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          flexShrink: 0 }}
      >
        {texts.dismiss}
      </button>
    </div>
  );
}
