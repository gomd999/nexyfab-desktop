'use client';

import React, { useEffect, useState } from 'react';

const LS_KEY = 'nexyfab_simple_mode_offer_dismissed_v1';

export interface SimpleModeOfferLabels {
  title: string;
  desc: string;
  enable: string;
  dismiss: string;
  regionLabel: string;
}

interface SimpleModeOfferBannerProps {
  simpleMode: boolean;
  onEnableSimpleMode: () => void;
  labels: SimpleModeOfferLabels;
}

export default function SimpleModeOfferBanner({
  simpleMode,
  onEnableSimpleMode,
  labels,
}: SimpleModeOfferBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (simpleMode) {
      setVisible(false);
      return;
    }
    try {
      if (localStorage.getItem(LS_KEY)) return;
    } catch {
      /* private mode */
    }
    const id = window.setTimeout(() => setVisible(true), 2200);
    return () => window.clearTimeout(id);
  }, [simpleMode]);

  if (!visible || simpleMode) return null;

  const dismiss = (remember: boolean) => {
    if (remember) {
      try {
        localStorage.setItem(LS_KEY, '1');
      } catch {
        /* ignore */
      }
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={labels.regionLabel}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        flexWrap: 'wrap', padding: '8px 14px',
        background: 'linear-gradient(90deg, rgba(63,185,80,0.12), rgba(56,139,253,0.08))',
        borderBottom: '1px solid rgba(63,185,80,0.25)',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.45, textAlign: 'center', maxWidth: 520 }}>
        <strong style={{ color: '#e6edf3' }}>{labels.title}</strong>
        {' — '}
        {labels.desc}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
            onEnableSimpleMode();
            dismiss(true);
          }}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: '#238636', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {labels.enable}
        </button>
        <button
          type="button"
          onClick={() => dismiss(true)}
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid #30363d', background: '#21262d', color: '#8b949e',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {labels.dismiss}
        </button>
      </div>
    </div>
  );
}
