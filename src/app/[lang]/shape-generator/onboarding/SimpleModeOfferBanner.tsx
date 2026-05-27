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
      role="dialog"
      aria-modal="true"
      aria-label={labels.regionLabel}
      onClick={() => dismiss(false)}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9000,
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)',
          borderRadius: 12,
          boxShadow: 'var(--nx-shadow)',
          padding: '24px 28px',
          maxWidth: 560,
          width: 'min(560px, 90vw)',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 22 }}>👋</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--nx-text)', marginBottom: 6 }}>
              {labels.presetPickTitle}
            </div>
            <div style={{ fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.5 }}>
              {labels.presetPickDesc}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button
            type="button"
            onClick={() => choose('basic')}
            style={{
              padding: '14px 12px', borderRadius: 8, border: '1px solid var(--nx-accent-line)',
              background: 'var(--nx-accent-soft)', color: 'var(--nx-text)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
              transition: 'transform 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
          >
            <span style={{ fontSize: 20 }}>🌱</span>
            <span>{labels.presetBasic}</span>
          </button>
          <button
            type="button"
            onClick={() => choose('designer')}
            style={{
              padding: '14px 12px', borderRadius: 8, border: '1px solid var(--nx-accent-line)',
              background: 'var(--nx-accent-soft)', color: 'var(--nx-text)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
              transition: 'transform 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
          >
            <span style={{ fontSize: 20 }}>🎨</span>
            <span>{labels.presetDesigner}</span>
          </button>
          <button
            type="button"
            onClick={() => choose('engineer')}
            style={{
              padding: '14px 12px', borderRadius: 8, border: '1px solid var(--nx-border)',
              background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
              transition: 'transform 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
          >
            <span style={{ fontSize: 20 }}>⚙️</span>
            <span>{labels.presetEngineer}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => dismiss(true)}
          style={{
            alignSelf: 'flex-end',
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid var(--nx-border)', background: 'transparent', color: 'var(--nx-text-2)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {labels.dismiss}
        </button>
      </div>
    </div>
  );
}
