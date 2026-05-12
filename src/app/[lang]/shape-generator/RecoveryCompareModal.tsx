'use client';

// E2 — Recovery conflict 3D diff modal.
//
// Wraps VersionDiff3DViewer so the user can visually compare the auto-saved
// snapshot ("recovered") against their current scene before deciding to
// Restore or Dismiss. Adapts the recovery snapshot shape to a synthetic
// DesignVersion since the diff viewer's data model is version-history-based.

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import type { DesignVersion } from './history/useVersionHistory';
import type { FeatureInstance } from './features/types';

const VersionDiff3DViewer = dynamic(
  () => import('./history/VersionDiff3DViewer'),
  { ssr: false },
);

// Minimal shape of recoveryData — keep it loose so we don't depend on the
// (currently large) RecoverySnapshot interface. We only need the fields the
// viewer actually consumes.
interface RecoverySnapshotMin {
  selectedId: string;
  params: Record<string, number>;
  features: Array<{ type: string; params: Record<string, number>; enabled?: boolean }>;
  timestamp: number;
}

interface Props {
  recoveryData: RecoverySnapshotMin;
  currentSelectedId: string;
  currentParams: Record<string, number>;
  currentFeatures: FeatureInstance[];
  lang: string;
  onClose: () => void;
}

export default function RecoveryCompareModal({
  recoveryData,
  currentSelectedId,
  currentParams,
  currentFeatures,
  lang,
  onClose,
}: Props) {
  const [currentSideTimestamp] = useState(() => Date.now());
  const versionA: DesignVersion = {
    id: 'recovery-a',
    timestamp: recoveryData.timestamp,
    label: 'Saved',
    autoLabel: 'Auto-saved',
    shapeId: recoveryData.selectedId,
    params: recoveryData.params,
    features: recoveryData.features.map(f => ({
      type: f.type,
      params: f.params,
      enabled: f.enabled !== false,
    })),
  };
  const versionB: DesignVersion = {
    id: 'recovery-b',
    timestamp: currentSideTimestamp,
    label: 'Current',
    autoLabel: 'Current edit',
    shapeId: currentSelectedId,
    params: currentParams,
    features: currentFeatures.map(f => ({
      type: f.type,
      params: f.params,
      enabled: f.enabled !== false,
    })),
  };

  return (
    <VersionDiff3DViewer
      versionA={versionA}
      versionB={versionB}
      lang={lang}
      onClose={onClose}
    />
  );
}
