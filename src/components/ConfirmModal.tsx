'use client';

import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, title, message, confirmLabel, cancelLabel,
  destructive = false, busy = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        style={{
          background: '#161b22', border: '1px solid #30363d',
          borderRadius: 12, padding: '24px', width: '100%', maxWidth: 420,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          color: '#e6edf3',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}
        >
          {title}
        </h2>
        <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 20px', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: 'transparent', color: '#e6edf3',
              border: '1px solid #30363d',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700,
              background: destructive ? '#da3633' : '#388bfd',
              color: '#fff', border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
