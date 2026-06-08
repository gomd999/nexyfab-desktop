'use client';

// N4 — Canvas gizmo overlays.
//
// Three small viewport overlays that render on top of the canvas: the
// in-viewport dimension gizmo, the dimension lines (bbox tape measure),
// and the DFM warning badges. Pulled out of ShapeGeneratorInner so the
// monolith doesn't keep their props inline.

import React from 'react';
import InViewportGizmo from '../InViewportGizmo';
import DimensionLinesOverlay from '../DimensionLinesOverlay';
import DFMWarningBadges from '../DFMWarningBadges';
import DowngradeBanner from '../features/DowngradeBanner';
import type { DFMResult } from '../analysis/dfmAnalysis';
import type { MeshDowngradeNotice } from '../features/downgradeNotice';

interface ParamDef {
  key: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  labelKey: string;
}

interface CanvasGizmoOverlaysProps {
  /** Master visibility flag — viewport must have geometry and not be in
   *  sketch mode for any of these to make sense. */
  visible: boolean;
  lang: string;

  // InViewportGizmo
  shapeId: string;
  params: Record<string, number>;
  paramDefs: ParamDef[];
  labelDict: Record<string, string>;
  onParamChange: (key: string, value: number) => void;

  // DimensionLinesOverlay
  bbox: { w: number; h: number; d: number } | null;

  // DFMWarningBadges
  dfmResults: DFMResult[] | null;

  // DowngradeBanner — OCCT→mesh downgrades on the displayed geometry. Defaults
  // to empty (inert) until the call-site threads `collectDowngrades(geometry)`.
  downgradeNotices?: readonly MeshDowngradeNotice[];
}

export default function CanvasGizmoOverlays({
  visible, lang,
  shapeId, params, paramDefs, labelDict, onParamChange,
  bbox,
  dfmResults,
  downgradeNotices = [],
}: CanvasGizmoOverlaysProps) {
  return (
    <>
      <InViewportGizmo
        shapeId={shapeId}
        params={params}
        paramDefs={paramDefs}
        labelDict={labelDict}
        onParamChange={onParamChange}
        visible={visible}
      />
      <DimensionLinesOverlay
        bbox={bbox}
        visible={visible}
        lang={lang}
      />
      <DFMWarningBadges
        dfmResults={dfmResults}
        visible={visible}
        lang={lang}
      />
      <DowngradeBanner
        notices={downgradeNotices}
        visible={visible}
        lang={lang}
      />
    </>
  );
}
