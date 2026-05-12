'use client';

// P2 — CAM/Mold/RFQ/Sheet Metal panel dock.
//
// Four manufacturing-side panels share the same fixed-floating wrapper
// (top: 60, right: 16). Mold Design has the heaviest callback set (6
// actions), RFQ and CAM Sim are simpler. Sheet Metal renders without the
// floating wrapper since it positions itself.

import React from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import type { Theme } from '../theme';
import type { CAMOperation, CAMResult } from '../analysis/camLite';

const CAMSimPanel = dynamic(() => import('../analysis/CAMSimPanel'), { ssr: false });
const MoldDesignPanel = dynamic(() => import('../analysis/MoldDesignPanel'), { ssr: false });
const RfqPanel = dynamic(() => import('../io/RfqPanel'), { ssr: false });
const SheetMetalPanel = dynamic(() => import('../SheetMetalPanel'), { ssr: false });

function floatWrapMfg(inset: number): React.CSSProperties {
  return { position: 'fixed', top: 60, right: 16 + inset, zIndex: 600 };
}

export type MfgDockPanelId = 'cam' | 'mold' | 'rfq';

interface ManufacturingPanelDockProps {
  lang: string;
  dockInsetForPanel?: (id: MfgDockPanelId) => number;
  dockInsetRight?: number;
  simpleMode: boolean;
  theme: Theme;
  effectiveResultGeometry: THREE.BufferGeometry | null;
  effectiveResultBoundingBox: THREE.Box3 | null;

  // CAM Sim
  showCAMSimPanel: boolean;
  setShowCAMSimPanel: (v: boolean) => void;
  camSimResult: { result: CAMResult; operation: CAMOperation } | null;

  // Mold Design
  showMoldDesignPanel: boolean;
  setShowMoldDesignPanel: (v: boolean) => void;
  onGenerateCavity: (margin: number) => void;
  onShowDraftAnalysis: (minAngle: number) => void;
  onMoldSplitBody: () => void;
  onOpenStandardParts: () => void;
  onExportSTEP: () => void;

  // RFQ
  showRfqPanel: boolean;
  setShowRfqPanel: (v: boolean) => void;
  selectedId: string;
  materialId: string;
  rfqVolumeCm3: number;

  // Sheet Metal — callback signatures mirror SheetMetalPanel props.
  showSheetMetalPanel: boolean;
  setShowSheetMetalPanel: (v: boolean) => void;
  onSmBend: (angle: number, radius: number, position: number, direction: 'up' | 'down') => void | Promise<void>;
  onSmFlange: (height: number, angle: number, radius: number, edgeIndex: number) => void | Promise<void>;
  onSmFlatPattern: (thickness: number, kFactor: number) => void | Promise<void>;
}

export default function ManufacturingPanelDock(props: ManufacturingPanelDockProps) {
  const {
    lang, dockInsetForPanel, dockInsetRight = 0, simpleMode, theme,
    effectiveResultGeometry,
    showCAMSimPanel, setShowCAMSimPanel, camSimResult,
    showMoldDesignPanel, setShowMoldDesignPanel,
    onGenerateCavity, onShowDraftAnalysis, onMoldSplitBody, onOpenStandardParts, onExportSTEP,
    showRfqPanel, setShowRfqPanel, selectedId, materialId, rfqVolumeCm3,
    showSheetMetalPanel, setShowSheetMetalPanel, onSmBend, onSmFlange, onSmFlatPattern,
  } = props;

  const inset = (id: MfgDockPanelId) =>
    dockInsetForPanel?.(id) ?? dockInsetRight;

  return (
    <>
      {showCAMSimPanel && camSimResult && (
        <div style={floatWrapMfg(inset('cam'))}>
          <CAMSimPanel
            lang={lang}
            result={camSimResult.result}
            operation={camSimResult.operation}
            onClose={() => setShowCAMSimPanel(false)}
          />
        </div>
      )}

      {showMoldDesignPanel && (
        <div style={floatWrapMfg(inset('mold'))}>
          <MoldDesignPanel
            lang={lang}
            geometry={effectiveResultGeometry}
            onClose={() => setShowMoldDesignPanel(false)}
            onGenerateCavity={onGenerateCavity}
            onShowDraftAnalysis={onShowDraftAnalysis}
            onSplitBody={onMoldSplitBody}
            onOpenStandardParts={onOpenStandardParts}
            onExportPackage={onExportSTEP}
          />
        </div>
      )}

      {showRfqPanel && (
        <div style={floatWrapMfg(inset('rfq'))}>
          { }
          <RfqPanel
            lang={lang}
            geometry={effectiveResultGeometry}
            partLabel={selectedId ?? 'NexyFab_Part'}
            materialKey={materialId}
            volume_cm3={rfqVolumeCm3}
            onClose={() => setShowRfqPanel(false)}
          />
        </div>
      )}

      {!simpleMode && showSheetMetalPanel && (
        <SheetMetalPanel
          lang={lang}
          onBend={onSmBend}
          onFlange={onSmFlange}
          onFlatPattern={onSmFlatPattern}
          onClose={() => setShowSheetMetalPanel(false)}
          geometry={effectiveResultGeometry}
          theme={theme}
        />
      )}
    </>
  );
}
