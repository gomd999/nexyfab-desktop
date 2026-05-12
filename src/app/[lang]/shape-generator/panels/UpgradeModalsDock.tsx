'use client';

// Centralized mount point for all UpgradeModal dialogs.
//
// Why this file exists: ShapeGeneratorInner.tsx had 8 near-identical UpgradeModal
// JSX blocks scattered across 200 lines, each pulling its own show*/setShow* pair
// from uiStore. Each new paywall feature added another duplicated block.
//
// Now: each modal is one row in MODAL_DEFS, and Inner.tsx mounts a single
// <UpgradeModalsDock />. Adding a new upgrade gate = one line here + the
// matching uiStore boolean. No JSX touched in Inner.

import React from 'react';
import dynamic from 'next/dynamic';
import { useUIStore } from '../store/uiStore';
import type { FreemiumFeature } from '@/hooks/useFreemium';

const UpgradeModal = dynamic(() => import('@/components/nexyfab/UpgradeModal'), {
  ssr: false,
});

interface ModalDef {
  /** uiStore key for the open flag. */
  showKey:
    | 'showCamUpgrade'
    | 'showDFMFixUpgrade'
    | 'showDFMInsightsUpgrade'
    | 'showProcessRouterUpgrade'
    | 'showAISupplierMatchUpgrade'
    | 'showCostCopilotUpgrade'
    | 'showCollabEditUpgrade'
    | 'showExportOptimizeUpgrade';
  /** uiStore setter for the open flag. */
  setterKey:
    | 'setShowCamUpgrade'
    | 'setShowDFMFixUpgrade'
    | 'setShowDFMInsightsUpgrade'
    | 'setShowProcessRouterUpgrade'
    | 'setShowAISupplierMatchUpgrade'
    | 'setShowCostCopilotUpgrade'
    | 'setShowCollabEditUpgrade'
    | 'setShowExportOptimizeUpgrade';
  /** Feature key passed to UpgradeModal — drives the copy/CTA inside the modal. */
  feature: FreemiumFeature;
}

const MODAL_DEFS: readonly ModalDef[] = [
  { showKey: 'showCamUpgrade',                setterKey: 'setShowCamUpgrade',                feature: 'cam_export' },
  { showKey: 'showDFMFixUpgrade',             setterKey: 'setShowDFMFixUpgrade',             feature: 'dfm_autofix' },
  { showKey: 'showDFMInsightsUpgrade',        setterKey: 'setShowDFMInsightsUpgrade',        feature: 'dfm_insights' },
  { showKey: 'showProcessRouterUpgrade',      setterKey: 'setShowProcessRouterUpgrade',      feature: 'process_router' },
  { showKey: 'showAISupplierMatchUpgrade',    setterKey: 'setShowAISupplierMatchUpgrade',    feature: 'ai_supplier_match' },
  { showKey: 'showCostCopilotUpgrade',        setterKey: 'setShowCostCopilotUpgrade',        feature: 'cost_copilot' },
  { showKey: 'showCollabEditUpgrade',         setterKey: 'setShowCollabEditUpgrade',         feature: 'collaboration_edit' },
  { showKey: 'showExportOptimizeUpgrade',     setterKey: 'setShowExportOptimizeUpgrade',     feature: 'export_optimize' },
];

interface UpgradeModalsDockProps {
  lang: string;
}

export default function UpgradeModalsDock({ lang }: UpgradeModalsDockProps) {
  const ui = useUIStore();
  return (
    <>
      {MODAL_DEFS.map(({ showKey, setterKey, feature }) => {
        const open = ui[showKey] as boolean;
        const setter = ui[setterKey] as (v: boolean) => void;
        return (
          <UpgradeModal
            key={feature}
            open={open}
            feature={feature}
            lang={lang}
            onClose={() => setter(false)}
          />
        );
      })}
    </>
  );
}
