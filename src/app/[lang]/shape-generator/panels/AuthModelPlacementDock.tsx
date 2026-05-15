'use client';

// O3 — Auth + Model Parameters + Part Placement + Plugin/Script dock.
//
// Bundles five small modal/panel mounts that share the same "secondary
// utility" theme: authentication, named model parameters editor, assembly
// part placement, plugin manager, and the NexyScript panel. Each was a
// 5-15 line block in Inner.tsx.

import React from 'react';
import dynamic from 'next/dynamic';
import type { ModelVar } from '../ModelParametersPanel';
import type { PlacedPart } from '../assembly/PartPlacementPanel';

// Cast to a permissive type because PluginManager doesn't export its props
// shape; we mirror the original Inner.tsx call pattern exactly.
const PluginManager = dynamic(
  () => import('../plugins/PluginManager') as Promise<{ default: React.ComponentType<{ visible: boolean; onClose: () => void; isKo: boolean }> }>,
  { ssr: false },
);
const ScriptPanel = dynamic(() => import('../ScriptPanel'), { ssr: false });
const AuthModal = dynamic(() => import('@/components/nexyfab/AuthModal'), { ssr: false });
const ModelParametersPanel = dynamic(() => import('../ModelParametersPanel'), { ssr: false });
const PartPlacementPanel = dynamic(() => import('../assembly/PartPlacementPanel'), { ssr: false });

interface AuthModelPlacementDockProps {
  lang: string;
  isKo: boolean;
  simpleMode: boolean;

  // Plugin manager
  showPluginManager: boolean;
  setShowPluginManager: (v: boolean) => void;
  // Script panel
  showScriptPanel: boolean;
  setShowScriptPanel: (v: boolean) => void;
  // Auth modal
  showAuthModal: boolean;
  setShowAuthModal: (v: boolean) => void;
  authModalMode: 'login' | 'signup';
  // Model parameters
  showModelParams: boolean;
  modelVars: ModelVar[];
  setModelVars: (vars: ModelVar[]) => void;
  // Part placement
  showPartPlacement: boolean;
  placedParts: PlacedPart[];
  setPlacedParts: React.Dispatch<React.SetStateAction<PlacedPart[]>>;
  selectedId: string;
  params: Record<string, number>;
  setHighlightedPartId: (id: string | null) => void;
}

export default function AuthModelPlacementDock({
  lang, isKo, simpleMode,
  showPluginManager, setShowPluginManager,
  showScriptPanel, setShowScriptPanel,
  showAuthModal, setShowAuthModal, authModalMode,
  showModelParams, modelVars, setModelVars,
  showPartPlacement, placedParts, setPlacedParts,
  selectedId, params, setHighlightedPartId,
}: AuthModelPlacementDockProps) {
  return (
    <>
      <PluginManager
        visible={showPluginManager && !simpleMode}
        onClose={() => setShowPluginManager(false)}
        isKo={isKo}
      />
      <ScriptPanel
        visible={showScriptPanel}
        onClose={() => setShowScriptPanel(false)}
        lang={lang}
      />
      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        defaultMode={authModalMode}
      />
      {showModelParams && (
        <ModelParametersPanel
          vars={modelVars}
          onChange={setModelVars}
          lang={lang}
        />
      )}
      {showPartPlacement && (
        <div style={{
          position: 'fixed', top: 48, right: 320, zIndex: 900,
          width: 300, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          background: 'rgba(22,27,34,0.97)', backdropFilter: 'blur(12px)',
          border: '1px solid var(--nx-border)', borderRadius: 12,
          padding: '12px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <PartPlacementPanel
            parts={placedParts}
            onChange={setPlacedParts}
            isKo={isKo}
            currentShapeId={selectedId}
            currentParams={params}
            onHighlightPart={setHighlightedPartId}
          />
        </div>
      )}
    </>
  );
}
