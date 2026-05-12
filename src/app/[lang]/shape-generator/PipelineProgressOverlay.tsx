import React from 'react';

export default function PipelineProgressOverlay({
  loading,
  progress,
  label,
}: {
  loading: boolean;
  progress: number;
  label: string;
}) {
  if (!loading) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(22, 27, 34, 0.85)',
      backdropFilter: 'blur(10px)',
      border: '1px solid #30363d',
      borderRadius: 8,
      padding: '12px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      zIndex: 9999,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      minWidth: 250,
      animation: 'fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>
          {label || 'Calculating...'}
        </span>
        <span style={{ fontSize: 11, color: '#388bfd', fontWeight: 700 }}>
          {progress}%
        </span>
      </div>
      <div style={{ width: '100%', height: 6, background: '#0d1117', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #388bfd, #58a6ff)',
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  );
}
