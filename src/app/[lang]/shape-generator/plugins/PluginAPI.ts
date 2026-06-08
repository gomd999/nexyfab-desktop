// ─── Plugin API — Interface definitions for shape-generator plugin system ────
// Plugins extend the CAD tool with custom shapes, toolbar buttons, panels, and analysis.

import type * as THREE from 'three';
import type React from 'react';

/* ─── Manifest ────────────────────────────────────────────────────────────── */

/**
 * The host's current plugin-API version. Plugins declare the `apiVersion` they
 * target; the registry rejects a plugin whose MAJOR differs (a breaking host
 * change bumps the major) or whose required minor exceeds the host's. Bump this
 * when the `PluginContext` / extension-point surface changes.
 */
export const PLUGIN_API_VERSION = '1.0.0';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Host plugin-API version this plugin targets (semver). Major must match. */
  apiVersion: string;
  /** Ids of other plugins that must be registered before this one. */
  dependencies?: string[];
}

export interface PluginRegistrationResult {
  ok: boolean;
  reason?: string;
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Parse `major.minor` from a semver string; NaN parts on malformed input. */
function semverMajorMinor(v: string): { major: number; minor: number } {
  const [maj, min] = v.split('.');
  return { major: parseInt(maj ?? '', 10), minor: parseInt(min ?? '0', 10) || 0 };
}

/**
 * A plugin's required API version is compatible with the host when the MAJOR
 * matches and the required MINOR ≤ the host minor (the host is backward-
 * compatible within a major).
 */
export function isApiCompatible(required: string, host: string = PLUGIN_API_VERSION): boolean {
  const r = semverMajorMinor(required);
  const h = semverMajorMinor(host);
  if (!Number.isFinite(r.major) || !Number.isFinite(h.major)) return false;
  return r.major === h.major && r.minor <= h.minor;
}

/** Validate a manifest's required fields + API compatibility (pure). */
export function validateManifest(m: PluginManifest, host: string = PLUGIN_API_VERSION): PluginRegistrationResult {
  if (!m.id || !PLUGIN_ID_RE.test(m.id)) return { ok: false, reason: `invalid plugin id "${m.id}"` };
  if (!m.name) return { ok: false, reason: 'manifest.name is required' };
  if (!m.version) return { ok: false, reason: 'manifest.version is required' };
  if (!m.apiVersion) return { ok: false, reason: 'manifest.apiVersion is required' };
  if (!isApiCompatible(m.apiVersion, host)) {
    return { ok: false, reason: `apiVersion ${m.apiVersion} incompatible with host ${host}` };
  }
  return { ok: true };
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
