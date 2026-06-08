'use client';

// P1 — Floating analysis panel dock.
//
// Six analysis panels share the same fixed top-right floating wrapper +
// onClose pattern: TopologicalMap, MotionStudy, ModalAnalysis,
// ToleranceStackup, SurfaceQuality, ManufacturingPipeline. Bundling them
// removes ~80 lines of repeated wrapper JSX from Inner.tsx.

import React from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import TopoMapPanel from './TopoMapPanel';
import type { UseTopologicalMapReturn } from '../topology/useTopologicalMap';

const MotionStudyPanel = dynamic(() => import('../analysis/MotionStudyPanel'), { ssr: false });
const ModalAnalysisPanel = dynamic(() => import('../analysis/ModalAnalysisPanel'), { ssr: false });
const BucklingAnalysisPanel = dynamic(() => import('../analysis/BucklingAnalysisPanel'), { ssr: false });
const ToleranceStackupPanel = dynamic(() => import('../analysis/ToleranceStackupPanel'), { ssr: false });
const SurfaceQualityPanel = dynamic(() => import('../analysis/SurfaceQualityPanel'), { ssr: false });
const ManufacturingPipelinePanel = dynamic(() => import('../analysis/ManufacturingPipelinePanel'), { ssr: false });

function floatWrapRight(inset: number): React.CSSProperties {
  return { position: 'fixed', top: 60, right: 16 + inset, zIndex: 500 };
}

export type FloatingDockPanelId = 'motion' | 'modal' | 'buckling' | 'tol' | 'surf' | 'mfgpipe';

interface FloatingAnalysisDockProps {
  lang: string;
  /** Per-panel stack inset (SCAD base + slot index). Fallback: dockInsetRight. */
  dockInsetForPanel?: (id: FloatingDockPanelId) => number;
  dockInsetRight?: number;
  effectiveResultGeometry: THREE.BufferGeometry | null;
  partIds: string[];
  paramsForModal: { x: number; y: number; z: number };
  topoMap: UseTopologicalMapReturn;
  // i18n / toast — provided by host so the dock stays renderless of i18n logic
  toastModalDone: string;
  toastSurfaceDone: string;
  toastQuoteRequested: (mfgId: string) => string;
  addToast: (kind: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
  // Manufacturing pipeline data
  showMfgPipeline: boolean;
  mfgVolumeCm3: number;
  mfgSurfaceAreaCm2: number;
  mfgMaterial: string;
  mfgComplexity: number;

  // Per-panel show flags + setters
  showMotionStudy: boolean;
  setShowMotionStudy: (v: boolean) => void;
  setMotionPartTransforms: (transforms: Record<string, THREE.Matrix4> | null) => void;

  showModalAnalysis: boolean;
  setShowModalAnalysis: (v: boolean) => void;

  showBucklingAnalysis: boolean;
  setShowBucklingAnalysis: (v: boolean) => void;

  showToleranceStackup: boolean;
  setShowToleranceStackup: (v: boolean) => void;

  showSurfaceQuality: boolean;
  setShowSurfaceQuality: (v: boolean) => void;

  setShowMfgPipeline: (v: boolean) => void;
}

export default function FloatingAnalysisDock({
  lang,
  dockInsetForPanel,
  dockInsetRight = 0,
  effectiveResultGeometry,
  partIds,
  paramsForModal,
  topoMap,
  toastModalDone, toastSurfaceDone, toastQuoteRequested, addToast,
  showMfgPipeline, mfgVolumeCm3, mfgSurfaceAreaCm2, mfgMaterial, mfgComplexity,
  showMotionStudy, setShowMotionStudy, setMotionPartTransforms,
  showModalAnalysis, setShowModalAnalysis,
  showBucklingAnalysis, setShowBucklingAnalysis,
  showToleranceStackup, setShowToleranceStackup,
  showSurfaceQuality, setShowSurfaceQuality,
  setShowMfgPipeline,
}: FloatingAnalysisDockProps) {
  const inset = (id: FloatingDockPanelId) =>
    dockInsetForPanel?.(id) ?? dockInsetRight;
  return (
    <>
      {topoMap.map.generation > 0 && (
        <TopoMapPanel topoMap={topoMap} lang={lang} />
      )}

      {showMotionStudy && (
        <div style={floatWrapRight(inset('motion'))}>
          <MotionStudyPanel
            lang={lang}
            partIds={partIds}
            onFrameUpdate={(transforms) => setMotionPartTransforms({ ...transforms })}
            onClose={() => { setShowMotionStudy(false); setMotionPartTransforms(null); }}
          />
        </div>
      )}

      {showModalAnalysis && (
        <div style={floatWrapRight(inset('modal'))}>
          <ModalAnalysisPanel
            lang={lang}
            geometry={effectiveResultGeometry}
            dimensions={paramsForModal}
            onResult={() => addToast('success', toastModalDone)}
            onClose={() => setShowModalAnalysis(false)}
          />
        </div>
      )}

      {showBucklingAnalysis && (
        <div style={floatWrapRight(inset('buckling'))}>
          <BucklingAnalysisPanel
            lang={lang}
            geometry={effectiveResultGeometry}
            onClose={() => setShowBucklingAnalysis(false)}
          />
        </div>
      )}

      {showToleranceStackup && (
        <div style={floatWrapRight(inset('tol'))}>
          <ToleranceStackupPanel
            lang={lang}
            onClose={() => setShowToleranceStackup(false)}
          />
        </div>
      )}

      {showSurfaceQuality && (
        <div style={floatWrapRight(inset('surf'))}>
          <SurfaceQualityPanel
            lang={lang}
            geometry={effectiveResultGeometry}
            onResult={() => addToast('success', toastSurfaceDone)}
            onClose={() => setShowSurfaceQuality(false)}
          />
        </div>
      )}

      {showMfgPipeline && effectiveResultGeometry && (
        <div style={floatWrapRight(inset('mfgpipe'))}>
          <ManufacturingPipelinePanel
            lang={lang}
            volumeCm3={mfgVolumeCm3}
            surfaceAreaCm2={mfgSurfaceAreaCm2}
            material={mfgMaterial}
            complexity={mfgComplexity}
            onGetQuote={(mfgId) => addToast('info', toastQuoteRequested(mfgId))}
            onClose={() => setShowMfgPipeline(false)}
          />
        </div>
      )}
    </>
  );
}
