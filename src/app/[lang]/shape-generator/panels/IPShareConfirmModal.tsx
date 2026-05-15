'use client';

import React from 'react';

interface Props {
  shareUrl: string;
  onCopy: () => Promise<unknown>;
  onClose: () => void;
  onReset: () => void;
  onCopied: () => void;
  labels: {
    ipProtectedShare: string;
    ipShareInfo: string;
    copyLabel: string;
    closeLabel: string;
  };
}

/**
 * Confirmation modal shown after generating an IP-protected share link.
 * Extracted from ShapeGeneratorInner.tsx so the host file does not carry
 * 28 lines of inline modal markup.
 */
export default function IPShareConfirmModal({
  shareUrl, onCopy, onClose, onReset, onCopied, labels,
}: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 14,
          padding: '28px 24px', width: 360, boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--nx-text)' }}>
          🔒 {labels.ipProtectedShare}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 11, color: 'var(--nx-text-3)' }}>
          {labels.ipShareInfo}
        </p>
        <div style={{
          background: 'var(--nx-bg)', border: '1px solid var(--nx-panel-2)', borderRadius: 8,
          padding: '10px 12px', fontSize: 11, color: 'var(--nx-accent-2)', wordBreak: 'break-all',
          marginBottom: 12, fontFamily: 'monospace',
        }}>{shareUrl}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={async () => { await onCopy(); onCopied(); }}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: 'var(--nx-accent)', color: 'var(--nx-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >📋 {labels.copyLabel}</button>
          <button
            onClick={() => { onClose(); onReset(); }}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--nx-border)',
              background: 'transparent', color: 'var(--nx-text-2)', fontSize: 12, cursor: 'pointer',
            }}
          >{labels.closeLabel}</button>
        </div>
      </div>
    </div>
  );
}
