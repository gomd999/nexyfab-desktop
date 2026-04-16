// ─── Plugin API — Interface definitions for shape-generator plugin system ────
// Plugins extend the CAD tool with custom shapes, toolbar buttons, panels, and analysis.

import type * as THREE from 'three';
import type React from 'react';

/* ─── Manifest ────────────────────────────────────────────────────────────── */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
}

/* ─── UI Extension Points ─────────────────────────────────────────────────── */

export interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  category?: string;
  tooltip?: string;
}

export interface PanelDefinition {
  id: string;
  title: string;
  position: 'left' | 'right' | 'bottom';
  render: () => React.ReactNode;
}

export interface CustomShapeParam {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
}

export interface CustomShapeDefinition {
  id: string;
  name: string;
  icon: string;
  params: CustomShapeParam[];
  generate: (params: Record<string, number>) => THREE.BufferGeometry;
}

/* ─── Plugin Context — provided to plugins at init ────────────────────────── */

export interface PluginContext {
  // Read-only access to current state
  getSelectedShape(): string;
  getParams(): Record<string, number>;
  getGeometry(): THREE.BufferGeometry | null;

  // Actions
  setParam(key: string, value: number): void;
  addFeature(type: string, params?: Record<string, number>): void;
  showToast(type: 'success' | 'error' | 'info' | 'warning', message: string): void;

  // UI extension points
  registerToolbarButton(button: ToolbarButton): void;
  registerPanel(panel: PanelDefinition): void;
  registerShape(shape: CustomShapeDefinition): void;
}

/* ─── Plugin Init Function ────────────────────────────────────────────────── */

export type PluginInitFn = (ctx: PluginContext) => void | (() => void);

/* ─── Registered Plugin Entry ─────────────────────────────────────────────── */

export interface RegisteredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  cleanup?: () => void;
  toolbarButtons: ToolbarButton[];
  panels: PanelDefinition[];
  shapes: CustomShapeDefinition[];
}
