'use client';

// P4 — Version + Branch + History + Diff dock.
//
// Bundles five history-related mounts that share the same domain:
// • VersionPanel (left list of design versions)
// • HistoryPanel (command history)
// • BranchCompare modal
// • VersionDiff3DViewer (when versionDiffPair is set)
// • ShapeVersionDiff (when explicit diffGeometries A/B exist)
//
// Each was a 5-30 line block in Inner.tsx. None overlap visually so
// rendering them as siblings is safe.

import React from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import type { DesignVersion } from '../history/useVersionHistory';
import type { BranchDiff, DesignBranch } from '../history/DesignBranch';
import type { Theme } from '../theme';

const VersionPanel = dynamic(() => import('../history/VersionPanel'), { ssr: false });
const VersionDiff3DViewer = dynamic(() => import('../history/VersionDiff3DViewer'), { ssr: false });
const HistoryPanel = dynamic(() => import('../history/HistoryPanel'), { ssr: false });
const BranchCompare = dynamic(() => import('../history/BranchCompare'), { ssr: false });
const ShapeVersionDiff = dynamic(() => import('../ShapeVersionDiff'), { ssr: false });

interface VersionDiffDockProps {
  lang: string;
  theme: Theme;
  simpleMode: boolean;

  // Version list
  showVersionPanel: boolean;
  setShowVersionPanel: (v: boolean) => void;
  versions: DesignVersion[];
  onSaveSnapshot: () => void;
  onRestore: (version: DesignVersion) => void;
  onDeleteVersion: (id: string) => void;
  onRenameVersion: (id: string, label: string) => void;

  // Branches
  branches: DesignBranch[];
  activeBranch: string;
  onCreateBranch: (name: string) => void;
  onSwitchBranch: (id: string) => void;
  onDeleteBranch: (id: string) => void;
  setShowBranchCompare: (v: boolean) => void;
  setVersionDiffPair: (pair: [DesignVersion, DesignVersion] | null) => void;

  // Branch compare
  showBranchCompare: boolean;
  onCompareBranches: (branchAId: string, branchBId: string) => BranchDiff | null;
  onMergeBranch: (sourceId: string, targetId: string) => void;

  // Command history
  showHistoryPanel: boolean;
  setShowHistoryPanel: (v: boolean) => void;

  // Version 3D diff
  versionDiffPair: [DesignVersion, DesignVersion] | null;

  // Shape version diff
  showVersionDiff: boolean;
  setShowVersionDiff: (v: boolean) => void;
  diffGeometries: {
    a: THREE.BufferGeometry;
    b: THREE.BufferGeometry;
    labelA?: string;
    labelB?: string;
  } | null;
}

export default function VersionDiffDock(props: VersionDiffDockProps) {
  const {
    lang, theme, simpleMode,
    showVersionPanel, setShowVersionPanel, versions,
    onSaveSnapshot, onRestore, onDeleteVersion, onRenameVersion,
    branches, activeBranch,
    onCreateBranch, onSwitchBranch, onDeleteBranch,
    setShowBranchCompare, setVersionDiffPair,
    showBranchCompare, onCompareBranches, onMergeBranch,
    showHistoryPanel, setShowHistoryPanel,
    versionDiffPair,
    showVersionDiff, setShowVersionDiff, diffGeometries,
  } = props;

  return (
    <>
      <VersionPanel
        visible={showVersionPanel}
        versions={versions}
        onClose={() => setShowVersionPanel(false)}
        onSaveSnapshot={onSaveSnapshot}
        onRestore={onRestore}
        onDelete={onDeleteVersion}
        onRename={onRenameVersion}
        theme={theme}
        lang={lang}
        branches={branches}
        activeBranch={activeBranch}
        onCreateBranch={onCreateBranch}
        onSwitchBranch={onSwitchBranch}
        onDeleteBranch={onDeleteBranch}
        onShowCompare={() => setShowBranchCompare(true)}
        onShow3DDiff={(a, b) => setVersionDiffPair([a, b])}
      />

      {showHistoryPanel && (
        <HistoryPanel lang={lang} onClose={() => setShowHistoryPanel(false)} />
      )}

      <BranchCompare
        visible={showBranchCompare && !simpleMode}
        branches={branches}
        activeBranch={activeBranch}
        onCompare={onCompareBranches}
        onMerge={onMergeBranch}
        onClose={() => setShowBranchCompare(false)}
        theme={theme}
        lang={lang}
      />

      {versionDiffPair && (
        <VersionDiff3DViewer
          versionA={versionDiffPair[0]}
          versionB={versionDiffPair[1]}
          lang={lang}
          onClose={() => setVersionDiffPair(null)}
        />
      )}

      {showVersionDiff && diffGeometries && (
        <ShapeVersionDiff
          lang={lang}
          geometryA={diffGeometries.a}
          geometryB={diffGeometries.b}
          labelA={diffGeometries.labelA}
          labelB={diffGeometries.labelB}
          onClose={() => setShowVersionDiff(false)}
        />
      )}
    </>
  );
}
