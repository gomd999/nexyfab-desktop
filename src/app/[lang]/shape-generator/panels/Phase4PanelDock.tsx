'use client';

// A3 — Phase 4 panel cluster (UserParts / SessionTimelapse / StockOptimizer).
//
// These three panels share the `captureFrame` pattern (read a thumbnail
// from the viewport for save/preview). Bundling them keeps the captureRef
// plumbing in one place and trims another ~40 lines from Inner.tsx.

import React from 'react';
import dynamic from 'next/dynamic';
import { SHAPE_MAP, applySceneParamsToSetters } from '../shapes';

const UserPartsPanel = dynamic(() => import('../library/UserPartsPanel'), { ssr: false });
const SessionTimelapse = dynamic(() => import('../rendering/SessionTimelapse'), { ssr: false });
const StockOptimizerPanel = dynamic(() => import('../manufacturing/StockOptimizerPanel'), { ssr: false });

interface UserPart {
  shapeId: string;
  name: string;
  params: Record<string, number>;
}

interface Phase4PanelDockProps {
  lang: string;
  // User Parts Panel
  showUserPartsPanel: boolean;
  setShowUserPartsPanel: (v: boolean) => void;
  selectedId: string;
  setSelectedId: (id: string) => void;
  params: Record<string, number>;
  setParams: (p: Record<string, number>) => void;
  setParamExpressions: (e: Record<string, string>) => void;
  // Session Timelapse
  showSessionTimelapse: boolean;
  setShowSessionTimelapse: (v: boolean) => void;
  // Stock Optimizer
  showStockOptimizer: boolean;
  setShowStockOptimizer: (v: boolean) => void;
  // Shared
  captureFrame: () => string | null;
  onUserPartLoaded: (name: string) => void;
}

export default function Phase4PanelDock({
  lang,
  showUserPartsPanel,
  setShowUserPartsPanel,
  selectedId,
  setSelectedId,
  params,
  setParams,
  setParamExpressions,
  showSessionTimelapse,
  setShowSessionTimelapse,
  showStockOptimizer,
  setShowStockOptimizer,
  captureFrame,
  onUserPartLoaded,
}: Phase4PanelDockProps) {
  return (
    <>
      {showUserPartsPanel && (
        <UserPartsPanel
          lang={lang}
          onClose={() => setShowUserPartsPanel(false)}
          currentShapeId={selectedId}
          currentParams={params}
          captureThumbnail={captureFrame}
          onLoadPart={(part: UserPart) => {
            if (part.shapeId !== selectedId) setSelectedId(part.shapeId);
            applySceneParamsToSetters(SHAPE_MAP[part.shapeId], part.params, {
              setParams,
              setParamExpressions,
            });
            setShowUserPartsPanel(false);
            onUserPartLoaded(part.name);
          }}
        />
      )}
      {showSessionTimelapse && (
        <SessionTimelapse
          lang={lang}
          captureFrame={captureFrame}
          onClose={() => setShowSessionTimelapse(false)}
        />
      )}
      {showStockOptimizer && (
        <StockOptimizerPanel
          lang={lang}
          onClose={() => setShowStockOptimizer(false)}
        />
      )}
    </>
  );
}
