'use client';

// O1 — Status footer cluster.
//
// Bundles the AutoSaveIndicator (top-center) and the OCCT engine toggle
// (bottom-right). Both only render in workspace view, share the workspace
// gating check, and are status-line UX siblings.

import React from 'react';
import AutoSaveIndicator from '../AutoSaveIndicator';
import type { CloudSyncStatus } from '../useCloudSaveFlow';

interface StatusFooterProps {
  visible: boolean;
  lang: string;

  // Auto-save state
  isSaving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  cloudStatus?: CloudSyncStatus;
  cloudSavedAt?: number | null;
  versionConflictNeedsReload?: boolean;
  onReloadForCloudConflict?: () => void;

  // OCCT engine toggle
  occtMode: boolean;
  occtInitPending: boolean;
  occtInitError: string | null;
  setOcctMode: (on: boolean) => void;
  occtToggleTitle: string;
}

export default function StatusFooter({
  visible, lang,
  isSaving, lastSavedAt, saveError,
  cloudStatus, cloudSavedAt,
  versionConflictNeedsReload, onReloadForCloudConflict,
  occtMode, occtInitPending, occtInitError,
  setOcctMode, occtToggleTitle,
}: StatusFooterProps) {
  if (!visible) return null;
  return (
    <>
      <AutoSaveIndicator
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        saveError={saveError}
        lang={lang}
        cloudStatus={cloudStatus}
        cloudSavedAt={cloudSavedAt}
        versionConflictNeedsReload={versionConflictNeedsReload}
        onReloadForCloudConflict={onReloadForCloudConflict}
      />
      <button
        type="button"
        onClick={() => setOcctMode(!occtMode)}
        disabled={occtInitPending}
        title={occtInitError ?? occtToggleTitle}
        style={{
          position: 'fixed', bottom: 12, right: 12, zIndex: 50,
          padding: '6px 10px', fontSize: 11, fontFamily: 'monospace',
          borderRadius: 6,
          border: `1px solid ${occtMode ? '#10b981' : '#4b5563'}`,
          background: occtMode ? 'rgba(16,185,129,0.15)' : 'rgba(31,41,55,0.85)',
          color: occtMode ? '#10b981' : '#9ca3af',
          cursor: occtInitPending ? 'wait' : 'pointer',
          opacity: occtInitPending ? 0.6 : 1,
        }}
      >
        OCCT: {occtInitPending ? '...' : occtMode ? 'ON' : 'OFF'}
        {occtInitError ? ' ⚠' : ''}
      </button>
    </>
  );
}
