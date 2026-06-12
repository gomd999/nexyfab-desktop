'use client';

// P3 — Generative Design + Thermal FEA + ECAD PCB dock + their overlay
// toggle buttons.
//
// All three panels float top-right with z-500. Thermal slides left when
// the ECAD panel is also open (right: 620 vs 310). The two bottom-right
// overlay toggle buttons (PCB heat / Gen Design overlay) are co-located
// here because they belong to the same analysis chain.

import React from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import type { TopologyResult } from '../analysis/topologyOptimization';

const GenerativeDesignPanel = dynamic(() => import('../analysis/GenerativeDesignPanel'), { ssr: false });
const ECADImportPanel = dynamic(() => import('../analysis/ECADImportPanel'), { ssr: false });
const ThermalFEAPanel = dynamic(() => import('../analysis/ThermalFEAPanel'), { ssr: false });

interface AdvancedAnalysisDockProps {
  lang: string;
  /** SCAD agent horizontal shift only — used for Thermal / ECAD / overlay toggles */
  dockInsetBase?: number;
  /** First-column Gen Design panel — stack-aware inset from host (falls back to dockInsetBase) */
  dockInsetGen?: number;
  effectiveResultGeometry: THREE.BufferGeometry | null;

  // Generative design
  showGenDesign: boolean;
  setShowGenDesign: (v: boolean) => void;
  setGenDesignResult: (geo: THREE.BufferGeometry) => void;
  setShowGenOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  genDesignResult: THREE.BufferGeometry | null;
  showGenOverlay: boolean;
  toastOptimalStructureDone: string;

  // Thermal FEA
  showThermalPanel: boolean;
  setShowThermalPanel: (v: boolean) => void;
  setThermalOverlayGeo: (geo: THREE.BufferGeometry) => void;
  setShowThermalOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  thermalOverlayGeo: THREE.BufferGeometry | null;
  showThermalOverlay: boolean;
  toastThermalFeaDone: string;
  toastPcbHeatMappingDone: string;

  // ECAD
  showECADPanel: boolean;
  setShowECADPanel: (v: boolean) => void;

  // Toast
  addToast: (kind: 'info' | 'success' | 'warning' | 'error', msg: string) => void;

  // i18n labels
  showOriginalLabel: string;
  showPcbHeatMapLabel: string;
  showOptimizedLabel: string;
}

export default function AdvancedAnalysisDock(props: AdvancedAnalysisDockProps) {
  const {
    lang, dockInsetBase = 0, dockInsetGen, effectiveResultGeometry,
    showGenDesign, setShowGenDesign, setGenDesignResult, setShowGenOverlay,
    genDesignResult, showGenOverlay, toastOptimalStructureDone,
    showThermalPanel, setShowThermalPanel, setThermalOverlayGeo, setShowThermalOverlay,
    thermalOverlayGeo, showThermalOverlay, toastThermalFeaDone, toastPcbHeatMappingDone,
    showECADPanel, setShowECADPanel,
    addToast,
    showOriginalLabel, showPcbHeatMapLabel, showOptimizedLabel,
  } = props;

  const genInset = dockInsetGen ?? dockInsetBase;

  return (
    <>
      {showGenDesign && (
        /* 336 = right pane (320) + margin, so the panel clears the inspector */
        <div style={{ position: 'fixed', top: 60, right: 336 + genInset, zIndex: 500 }}>
          <GenerativeDesignPanel
            geometry={effectiveResultGeometry}
            lang={lang}
            onResult={(geo, _result: TopologyResult) => {
              setGenDesignResult(geo);
              setShowGenOverlay(true);
              addToast('success', toastOptimalStructureDone);
            }}
            onClose={() => setShowGenDesign(false)}
          />
        </div>
      )}

      {showThermalPanel && (
        <div style={{ position: 'fixed', top: 60, right: (showECADPanel ? 620 : 310) + dockInsetBase, zIndex: 500 }}>
          <ThermalFEAPanel
            geometry={effectiveResultGeometry}
            lang={lang}
            onResult={(coloredGeo) => {
              setThermalOverlayGeo(coloredGeo);
              setShowThermalOverlay(true);
              addToast('success', toastThermalFeaDone);
            }}
            onClose={() => setShowThermalPanel(false)}
          />
        </div>
      )}

      {showECADPanel && (
        <div style={{ position: 'fixed', top: 60, right: 310 + dockInsetBase, zIndex: 500 }}>
          <ECADImportPanel
            geometry={effectiveResultGeometry}
            lang={lang}
            onThermalResult={(geo) => {
              setThermalOverlayGeo(geo);
              setShowThermalOverlay(true);
              setShowECADPanel(false);
              addToast('success', toastPcbHeatMappingDone);
            }}
            onClose={() => setShowECADPanel(false)}
          />
        </div>
      )}

      {thermalOverlayGeo && !showECADPanel && (
        <div style={{ position: 'fixed', bottom: 110, right: 16 + dockInsetBase, zIndex: 500 }}>
          <button
            onClick={() => setShowThermalOverlay(prev => !prev)}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: '1px solid var(--nx-warn)',
              background: showThermalOverlay ? 'var(--nx-warn)' : 'var(--nx-panel)',
              color: showThermalOverlay ? '#000' : 'var(--nx-warn)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {showThermalOverlay ? showOriginalLabel : showPcbHeatMapLabel}
          </button>
        </div>
      )}

      {genDesignResult && !showGenDesign && (
        <div style={{ position: 'fixed', bottom: 80, right: 16 + dockInsetBase, zIndex: 500 }}>
          <button
            onClick={() => setShowGenOverlay(prev => !prev)}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: '1px solid var(--nx-accent)',
              background: showGenOverlay ? 'var(--nx-accent)' : 'var(--nx-panel)',
              color: showGenOverlay ? 'var(--nx-text)' : 'var(--nx-accent)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {showGenOverlay ? showOriginalLabel : showOptimizedLabel}
          </button>
        </div>
      )}
    </>
  );
}
