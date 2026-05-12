'use client';

// M3 — Sketch input cluster.
//
// Bundles the hidden file <input> for sketch reference image upload, the
// SketchRadialMenu (Alt-press radial picker), and the global ContextMenu
// (right-click). They share the `handleContextSelect`/`handleContextClose`
// callbacks because the radial menu and context menu both emit Command
// Palette-style action ids back to the same dispatcher.

import React from 'react';
import SketchRadialMenu from '../sketch/SketchRadialMenu';
import {
  getSketchRadialMainItems,
  getSketchRadialInnerItems,
  getSketchRadialLinearItems,
} from '../sketch/sketchRadialItems';
import ContextMenu, { type ContextMenuItem } from '../ContextMenu';

interface SketchInputClusterProps {
  lang: string;
  // Hidden file input
  sketchRefInputRef: React.RefObject<HTMLInputElement | null>;
  onSketchRefFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // Radial menu state
  sketchRadial: { visible: boolean; x: number; y: number };
  // Right-click context menu state
  ctxMenu: { x: number; y: number; visible: boolean; items: ContextMenuItem[] };
  // Shared dispatchers
  onContextSelect: (id: string) => void;
  onContextClose: () => void;
}

export default function SketchInputCluster({
  lang,
  sketchRefInputRef,
  onSketchRefFileChange,
  sketchRadial,
  ctxMenu,
  onContextSelect,
  onContextClose,
}: SketchInputClusterProps) {
  return (
    <>
      {/* Hidden file input for sketch-reference image / STEP drop */}
      <input
        ref={sketchRefInputRef}
        type="file"
        accept="image/*,.stl,.stp,.step,.dxf,model/stl,application/sla"
        style={{ display: 'none' }}
        aria-hidden
        onChange={onSketchRefFileChange}
      />
      <SketchRadialMenu
        x={sketchRadial.x}
        y={sketchRadial.y}
        visible={sketchRadial.visible}
        items={getSketchRadialMainItems(lang)}
        innerItems={getSketchRadialInnerItems(lang)}
        linearItems={getSketchRadialLinearItems(lang)}
        onSelect={onContextSelect}
        onClose={onContextClose}
      />
      <ContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        visible={ctxMenu.visible}
        items={ctxMenu.items}
        onSelect={onContextSelect}
        onClose={onContextClose}
      />
    </>
  );
}
