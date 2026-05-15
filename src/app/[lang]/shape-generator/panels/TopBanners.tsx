'use client';

// A3 — Top banners cluster.
//
// Renders the stack of small status banners that appear under the top
// toolbar: AI Preview hint, email verification, autosave recovery (with
// optional 3D-diff modal trigger), read-only viewer notice, and the
// simple-mode offer for first-time users. Bundling them removes ~75 lines
// of JSX from ShapeGeneratorInner.

import React from 'react';
import dynamic from 'next/dynamic';
import VerificationBanner from '@/components/nexyfab/VerificationBanner';
import RecoveryBanner from '../RecoveryBanner';
import type { FeatureInstance } from '../features/types';

const RecoveryCompareModal = dynamic(() => import('../RecoveryCompareModal'), { ssr: false });
const SimpleModeOfferBanner = dynamic(() => import('../onboarding/SimpleModeOfferBanner'), {
  ssr: false,
  loading: () => null,
});

interface RecoverySnapshot {
  selectedId: string;
  params: Record<string, number>;
  features: Array<{ type: string; params: Record<string, number>; enabled?: boolean }>;
  timestamp: number;
}

interface TopBannersProps {
  lang: string;
  isPreviewMode: boolean;
  isReadOnly: boolean;
  onCancelPreview: () => void;

  // Recovery flow
  showRecovery: boolean;
  recoveryData: RecoverySnapshot | null;
  recoveredFromCrash?: boolean;
  onRestoreRecovery: () => void;
  onDismissRecovery: () => void;
  showRecoveryCompare: boolean;
  setShowRecoveryCompare: (v: boolean) => void;
  currentSelectedId: string;
  currentParams: Record<string, number>;
  currentFeatures: FeatureInstance[];

  // Simple-mode offer
  simpleMode: boolean;
  onEnableSimpleMode: () => void;
  /** Item 5 — 3-preset role picker. If omitted, banner falls back to the
   *  binary basic/dismiss path via onEnableSimpleMode. */
  onApplyPreset?: (preset: 'basic' | 'designer' | 'engineer') => void;

  // i18n
  lt: {
    aiPreviewMode: string;
    aiPreviewHint: string;
    cancelLabel: string;
    viewerOnlyMode: string;
    simpleModeOfferTitle: string;
    simpleModeOfferDesc: string;
    simpleModeOfferEnable: string;
    simpleModeOfferDismiss: string;
    simpleModeOfferRegion: string;
    presetPickTitle: string;
    presetPickDesc: string;
    presetBasic: string;
    presetDesigner: string;
    presetEngineer: string;
  };
}

export default function TopBanners({
  lang,
  isPreviewMode,
  isReadOnly,
  onCancelPreview,
  showRecovery,
  recoveryData,
  recoveredFromCrash,
  onRestoreRecovery,
  onDismissRecovery,
  showRecoveryCompare,
  setShowRecoveryCompare,
  currentSelectedId,
  currentParams,
  currentFeatures,
  simpleMode,
  onEnableSimpleMode,
  onApplyPreset,
  lt,
}: TopBannersProps) {
  return (
    <>
      {/* AI preview banner */}
      {isPreviewMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '6px 20px',
          background: 'linear-gradient(90deg, var(--nx-panel-2) 0%, var(--nx-panel) 100%)',
          borderBottom: '1px solid #1f6feb', flexShrink: 0,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--nx-warn)',
            animation: 'genSpin 2s linear infinite', boxShadow: '0 0 8px var(--nx-warn)',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-warn)' }}>{lt.aiPreviewMode}</span>
          <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{lt.aiPreviewHint}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onCancelPreview}
            style={{
              padding: '3px 12px', borderRadius: 6, border: '1px solid var(--nx-border)',
              background: 'var(--nx-panel-2)', color: 'var(--nx-error)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#3d1519'; e.currentTarget.style.borderColor = 'var(--nx-error)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; e.currentTarget.style.borderColor = 'var(--nx-border)'; }}
          >
            {lt.cancelLabel} (Esc)
          </button>
        </div>
      )}

      {/* Email verification banner */}
      <VerificationBanner lang={lang} />

      {/* Autosave recovery banner */}
      {showRecovery && recoveryData && (
        <RecoveryBanner
          timestamp={recoveryData.timestamp}
          lang={lang}
          onRestore={onRestoreRecovery}
          onDismiss={onDismissRecovery}
          onCompare={() => setShowRecoveryCompare(true)}
          fromCrash={recoveredFromCrash}
        />
      )}

      {/* Recovery 3D diff modal */}
      {showRecoveryCompare && recoveryData && (
        <RecoveryCompareModal
          recoveryData={recoveryData}
          currentSelectedId={currentSelectedId}
          currentParams={currentParams}
          currentFeatures={currentFeatures}
          lang={lang}
          onClose={() => setShowRecoveryCompare(false)}
        />
      )}

      {/* Read-only viewer notice */}
      {isReadOnly && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '6px 16px', background: 'rgba(245,158,11,0.12)',
          borderBottom: '1px solid rgba(245,158,11,0.3)',
          fontSize: 12, color: 'var(--nx-warn)', fontWeight: 600, flexShrink: 0,
        }}>
          {lt.viewerOnlyMode}
        </div>
      )}

      {/* Simple-mode offer (first-time users only) */}
      {!isReadOnly && (
        <SimpleModeOfferBanner
          simpleMode={simpleMode}
          onEnableSimpleMode={onEnableSimpleMode}
          onApplyPreset={onApplyPreset}
          labels={{
            title: lt.simpleModeOfferTitle,
            desc: lt.simpleModeOfferDesc,
            enable: lt.simpleModeOfferEnable,
            dismiss: lt.simpleModeOfferDismiss,
            regionLabel: lt.simpleModeOfferRegion,
            presetPickTitle: lt.presetPickTitle,
            presetPickDesc: lt.presetPickDesc,
            presetBasic: lt.presetBasic,
            presetDesigner: lt.presetDesigner,
            presetEngineer: lt.presetEngineer,
          }}
        />
      )}
    </>
  );
}
