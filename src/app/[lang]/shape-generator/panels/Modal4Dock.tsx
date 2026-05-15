'use client';

// J1 — 4-modal dock for AR / Screenshot / FeatureGraph / Nesting.
//
// Each is a self-contained overlay with low coupling — pulled out of
// ShapeGeneratorInner to keep the bottom of the JSX tree quieter.

import React from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import type { HistoryNode } from '../useFeatureStack';

const ARViewer = dynamic(() => import('../rendering/ARViewer'), { ssr: false });
const ScreenshotShareModal = dynamic(() => import('../rendering/ScreenshotShareModal'), { ssr: false });
const FeatureDependencyGraph = dynamic(() => import('./FeatureDependencyGraph'), { ssr: false });
const NestingTool = dynamic(() => import('../manufacturing/NestingTool'), { ssr: false });

interface Modal4DockProps {
  lang: string;
  // AR
  showARViewer: boolean;
  setShowARViewer: (v: boolean) => void;
  arGeometry: THREE.BufferGeometry | null;
  // Screenshot
  screenshot: { canvas: HTMLCanvasElement } | null;
  setScreenshot: (s: { canvas: HTMLCanvasElement } | null) => void;
  shapeName: string;
  onScreenshotDownload: (canvas: HTMLCanvasElement) => void;
  // Feature dependency graph
  showFeatureGraph: boolean;
  setShowFeatureGraph: (v: boolean) => void;
  nodes: HistoryNode[];
  activeNodeId: string;
  onSelectNode: (id: string) => void;
  // Nesting tool
  showNestingTool: boolean;
  setShowNestingTool: (v: boolean) => void;
}

export default function Modal4Dock({
  lang,
  showARViewer, setShowARViewer, arGeometry,
  screenshot, setScreenshot, shapeName, onScreenshotDownload,
  showFeatureGraph, setShowFeatureGraph, nodes, activeNodeId, onSelectNode,
  showNestingTool, setShowNestingTool,
}: Modal4DockProps) {
  return (
    <>
      {/* WebXR AR viewer */}
      {showARViewer && arGeometry && (
        <ARViewer
          geometry={arGeometry}
          color="#8b9cf4"
          lang={lang}
          onClose={() => setShowARViewer(false)}
        />
      )}

      {/* Screenshot share modal */}
      {screenshot && (
        <ScreenshotShareModal
          canvas={screenshot.canvas}
          shapeName={shapeName}
          isKo={lang === 'ko'}
          onClose={() => setScreenshot(null)}
          onDownload={() => onScreenshotDownload(screenshot.canvas)}
        />
      )}

      {/* Feature dependency graph (modal-wrapped) */}
      {showFeatureGraph && (
        <div
          onClick={() => setShowFeatureGraph(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 8000,
            background: 'var(--nx-glass-input)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 640, height: 480, borderRadius: 12, overflow: 'hidden',
              border: '1px solid var(--nx-panel-2)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
          >
            <FeatureDependencyGraph
              nodes={nodes}
              activeNodeId={activeNodeId}
              onSelectNode={(id) => { onSelectNode(id); setShowFeatureGraph(false); }}
              lang={lang}
            />
          </div>
        </div>
      )}

      {/* Nesting tool (modal-wrapped) */}
      {showNestingTool && (
        <div
          onClick={() => setShowNestingTool(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 8000,
            background: 'var(--nx-glass-input)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 800, height: 560, borderRadius: 12, overflow: 'hidden',
              border: '1px solid var(--nx-panel-2)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)', position: 'relative',
            }}
          >
            <NestingTool lang={lang} />
          </div>
        </div>
      )}
    </>
  );
}
