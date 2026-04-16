'use client';

import React, { useEffect, useState } from 'react';
import type { Toast } from './useToast';

interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: string) => void;
}

const TOAST_STYLES: Record<Toast['type'], { bg: string; accent: string; icon: string }> = {
  success: { bg: '#0d2818', accent: '#3fb950', icon: '✓' },
  error:   { bg: '#3d1519', accent: '#f85149', icon: '✕' },
  warning: { bg: '#2a2013', accent: '#d29922', icon: '⚠' },
  info:    { bg: '#1a2332', accent: '#58a6ff', icon: 'ℹ' },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const style = TOAST_STYLES[toast.type];

  useEffect(() => {
    // Trigger enter animation
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    // Start exit animation before removal
    const exitDelay = toast.duration - 300;
    if (exitDelay <= 0) return;
    const timer = setTimeout(() => setExiting(true), exitDelay);
    return () => clearTimeout(timer);
  }, [toast.duration]);

  const handleClose = () => {
    setExiting(true);
    setTimeout(onRemove, 300);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        background: style.bg,
        border: `1px solid #30363d`,
        borderLeft: `3px solid ${style.accent}`,
        borderRadius: 8,
        padding: 0,
        minWidth: 280,
        maxWidth: 380,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        opacity: visible && !exiting ? 1 : 0,
        transform: visible && !exiting ? 'translateX(0)' : 'translateX(40px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Icon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        minHeight: 44,
        fontSize: 14,
        fontWeight: 700,
        color: style.accent,
        flexShrink: 0,
      }}>
        {style.icon}
      </div>

      {/* Message */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        padding: '10px 4px 10px 0',
        fontSize: 13,
        fontWeight: 500,
        color: '#c9d1d9',
        lineHeight: 1.4,
        wordBreak: 'break-word',
        gap: 8,
      }}>
        <span>{toast.message}</span>
        {toast.action && (
          <button
            onClick={() => { toast.action!.onClick(); handleClose(); }}
            style={{
              flexShrink: 0, padding: '3px 10px', borderRadius: 6,
              border: `1px solid ${style.accent}`, background: 'transparent',
              color: style.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          border: 'none',
          background: 'transparent',
          color: '#8b949e',
          cursor: 'pointer',
          fontSize: 14,
          flexShrink: 0,
          padding: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; }}
      >
        ✕
      </button>

      {/* Progress bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 2,
        background: 'rgba(255,255,255,0.05)',
      }}>
        <div style={{
          height: '100%',
          background: style.accent,
          opacity: 0.6,
          animation: `toast-progress ${toast.duration}ms linear forwards`,
        }} />
      </div>
    </div>
  );
}

export default function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
      }}>
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onRemove={() => removeToast(toast.id)}
          />
        ))}
      </div>
      <style>{`
        @keyframes toast-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </>
  );
}
