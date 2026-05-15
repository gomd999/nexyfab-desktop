import React from 'react';

interface ImportLoadingOverlayProps {
  isImporting: boolean;
  loadingFileText: string;
}

export default function ImportLoadingOverlay({ isImporting, loadingFileText }: ImportLoadingOverlayProps) {
  if (!isImporting) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(13,17,23,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: 'var(--nx-text)' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--nx-border)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 15, fontWeight: 700 }}>{loadingFileText}</div>
      </div>
    </div>
  );
}
