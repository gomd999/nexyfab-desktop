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
          background: '#161b22', border: '1px solid #30363d', borderRadius: 14,
          padding: '28px 24px', width: 360, boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>
          🔒 {labels.ipProtectedShare}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 11, color: '#6e7681' }}>
          {labels.ipShareInfo}
        </p>
        <div style={{
          background: '#0d1117', border: '1px solid #21262d', borderRadius: 8,
          padding: '10px 12px', fontSize: 11, color: '#58a6ff', wordBreak: 'break-all',
          marginBottom: 12, fontFamily: 'monospace',
        }}>{shareUrl}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={async () => { await onCopy(); onCopied(); }}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: '#388bfd', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >📋 {labels.copyLabel}</button>
          <button
            onClick={() => { onClose(); onReset(); }}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #30363d',
              background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer',
            }}
          >{labels.closeLabel}</button>
        </div>
      </div>
    </div>
  );
}
