'use client';

// Item 5 of the usability cleanup. This banner used to be a binary
// "Simple mode on / Keep full workspace" suggestion. Now it offers three
// role presets that the uiStore's applyUserPreset() action handles:
//   - basic    : same as old simple mode (analyses hidden)
//   - designer : prototyping panels visible, validation analyses hidden
//   - engineer : everything available (= old default)
//
// The dismiss key is bumped to v2 so previously-dismissed users see the
// new picker once. After they choose, the v2 key is set and the banner
// stays hidden — the workspace selector remains the durable entry point
// for changing preset later.

import React, { useEffect, useState } from 'react';

const LS_KEY = 'nexyfab_user_preset_picker_dismissed_v2';

export type UserPreset = 'basic' | 'designer' | 'engineer';

export interface SimpleModeOfferLabels {
  title: string;
  desc: string;
  /** Back-compat (unused now — kept so Inner.tsx call site needn't change). */
  enable: string;
  dismiss: string;
  regionLabel: string;
  presetPickTitle: string;
  presetPickDesc: string;
  presetBasic: string;
  presetDesigner: string;
  presetEngineer: string;
}

interface SimpleModeOfferBannerProps {
  /** True if the user is already in basic preset — banner should not show. */
  simpleMode: boolean;
  /** Existing call site provides this (= applyUserPreset('basic')). Kept for
   *  back-compat; new code should pass onApplyPreset instead. */
  onEnableSimpleMode: () => void;
  /** New 3-way dispatcher. Falls back to onEnableSimpleMode when preset='basic'
   *  and the caller didn't supply this prop, so existing mounts keep working. */
  onApplyPreset?: (preset: UserPreset) => void;
  labels: SimpleModeOfferLabels;
}

export default function SimpleModeOfferBanner({
  simpleMode,
  onEnableSimpleMode,
  onApplyPreset,
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

  const choose = (preset: UserPreset) => {
    if (onApplyPreset) {
      onApplyPreset(preset);
    } else if (preset === 'basic') {
      onEnableSimpleMode();
    }
    dismiss(true);
  };

  const presetBtn = (preset: UserPreset, label: string, accent: string): React.CSSProperties => ({
    padding: '8px 12px', borderRadius: 6, border: 'none',
    background: accent, color: 'var(--nx-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    transition: 'transform 0.1s, filter 0.1s',
    minHeight: 32,
  });

  return (
    <div
      role="region"
      aria-label={labels.regionLabel}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 8,
        padding: '10px 14px',
        background: 'linear-gradient(90deg, rgba(63,185,80,0.12), rgba(56,139,253,0.08))',
        borderBottom: '1px solid rgba(63,185,80,0.25)',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.45, textAlign: 'center', maxWidth: 640 }}>
        <strong style={{ color: 'var(--nx-text)' }}>{labels.presetPickTitle}</strong>
        {' — '}
        {labels.presetPickDesc}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" style={presetBtn('basic', labels.presetBasic, '#238636')}
          onClick={() => choose('basic')}>
          {labels.presetBasic}
        </button>
        <button type="button" style={presetBtn('designer', labels.presetDesigner, '#1f6feb')}
          onClick={() => choose('designer')}>
          {labels.presetDesigner}
        </button>
        <button type="button" style={presetBtn('engineer', labels.presetEngineer, 'var(--nx-text-3)')}
          onClick={() => choose('engineer')}>
          {labels.presetEngineer}
        </button>
        <button
          type="button"
          onClick={() => dismiss(true)}
          style={{
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {labels.dismiss}
        </button>
      </div>
    </div>
  );
}
