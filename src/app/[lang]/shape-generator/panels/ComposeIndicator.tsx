'use client';

// M2 — compose loading overlay.
//
// Shown during the AI design-compose call (Idea → Design wizard pipeline).
// Pure visual; no state or callbacks beyond a refining/searching toggle.

import React from 'react';

interface ComposeIndicatorProps {
  visible: boolean;
  /** When `true`, display the "refining" copy (second pass on a swap call). */
  refining: boolean;
  labels: {
    composeSearching: string;
    composeRefining: string;
    composeSubtitle: string;
  };
}

export default function ComposeIndicator({
  visible, refining, labels,
}: ComposeIndicatorProps) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--nx-bg)', padding: '28px 40px', borderRadius: 12,
          border: '1px solid #334155', color: '#f1f5f9',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}
      >
        <div style={{ fontSize: 32 }}>⚙️</div>
        <div style={{ fontWeight: 600 }}>
          {refining ? labels.composeRefining : labels.composeSearching}
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{labels.composeSubtitle}</div>
      </div>
    </div>
  );
}
