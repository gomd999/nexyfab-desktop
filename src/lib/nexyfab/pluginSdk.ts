// NexyFab Plugin SDK — minimal first-party API surface that third-party
// integrators can target. The full SDK will live in its own npm package;
// this in-repo module establishes the contract.
//
// Two integration points are exposed:
//   1. Custom tool registration — plugins register a ribbon button that
//      runs their handler when clicked.
//   2. Geometry observers — plugins receive a callback whenever the active
//      geometry changes (mesh, bbox, units).
//
// All plugin code runs in the main thread for v1. Worker-isolated execution
// is on the roadmap once the geometry handle is stabilized.

import type { BufferGeometry, Vector3 } from 'three';

// ─── Plugin manifest ───────────────────────────────────────────────────────

export interface PluginManifest {
  id: string; // dotted reverse-domain: 'com.acme.gear-wizard'
  name: string;
  version: string; // semver
  description?: string;
  author?: string;
  homepage?: string;
  permissions: PluginPermission[];
}

export type PluginPermission =
  | 'geometry:read'      // observe active geometry
  | 'geometry:write'     // emit new geometry into the modeler
  | 'tool:register'      // appear as a ribbon button
  | 'export:invoke'      // trigger STEP / STL / PDF export
  | 'project:read';      // read project metadata (name, tags, owner)

// ─── Lifecycle ─────────────────────────────────────────────────────────────

export interface PluginContext {
  readonly manifest: PluginManifest;
  registerTool(tool: ToolRegistration): () => void;
  onGeometryChange(cb: (geo: GeometrySnapshot) => void): () => void;
  emitGeometry(geo: BufferGeometry, opts?: EmitOptions): void;
  toast(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface ToolRegistration {
  id: string;
  label: string;
  /** Where the tool button appears. */
  placement: 'ribbon-modeling' | 'ribbon-sketch' | 'ribbon-assembly' | 'right-panel';
  /** Optional icon (CSS class or SVG component name). */
  icon?: string;
  /** Called when the user clicks the button. */
  onClick: (ctx: PluginContext) => void | Promise<void>;
}

export interface GeometrySnapshot {
  /** Read-only — modifying violates `geometry:write` permission. */
  geometry: BufferGeometry;
  bbox: { min: Vector3; max: Vector3 };
  triangleCount: number;
  units: 'mm' | 'in';
}

export interface EmitOptions {
  /** Replace the active part (true) or add as a new body (false). */
  replace?: boolean;
  /** Label shown in the feature tree. */
  label?: string;
}

// ─── Host adapter ──────────────────────────────────────────────────────────

export interface PluginHost {
  /** Activate a plugin. Throws if a required permission is missing. */
  activate(manifest: PluginManifest, factory: PluginFactory): PluginContext;
  /** Deactivate a plugin and unregister its tools. */
  deactivate(pluginId: string): void;
  /** Snapshot of all currently active plugins. */
  list(): PluginManifest[];
}

export type PluginFactory = (ctx: PluginContext) => void | Promise<void>;

// ─── Reference implementation ──────────────────────────────────────────────

interface ActivePlugin {
  manifest: PluginManifest;
  context: PluginContext;
  unregisters: (() => void)[];
}

export function createPluginHost(
  emitToast: (level: 'info' | 'warn' | 'error', message: string) => void,
  applyGeometry: (geo: BufferGeometry, opts: EmitOptions) => void,
  subscribeGeometry: (cb: (g: GeometrySnapshot) => void) => () => void,
  registerToolWithModeler: (t: ToolRegistration) => () => void,
): PluginHost {
  const active = new Map<string, ActivePlugin>();

  return {
    activate(manifest, factory) {
      if (active.has(manifest.id)) {
        throw new Error(`Plugin ${manifest.id} already active`);
      }
      const unregisters: (() => void)[] = [];
      const ctx: PluginContext = {
        manifest,
        registerTool: (tool) => {
          if (!manifest.permissions.includes('tool:register')) {
            throw new Error(`Plugin ${manifest.id} lacks tool:register permission`);
          }
          const off = registerToolWithModeler(tool);
          unregisters.push(off);
          return off;
        },
        onGeometryChange: (cb) => {
          if (!manifest.permissions.includes('geometry:read')) {
            throw new Error(`Plugin ${manifest.id} lacks geometry:read permission`);
          }
          const off = subscribeGeometry(cb);
          unregisters.push(off);
          return off;
        },
        emitGeometry: (geo, opts) => {
          if (!manifest.permissions.includes('geometry:write')) {
            throw new Error(`Plugin ${manifest.id} lacks geometry:write permission`);
          }
          applyGeometry(geo, opts ?? {});
        },
        toast: emitToast,
      };
      active.set(manifest.id, { manifest, context: ctx, unregisters });
      Promise.resolve(factory(ctx)).catch(err => {
        emitToast('error', `Plugin ${manifest.id} failed: ${err?.message ?? err}`);
        active.delete(manifest.id);
      });
      return ctx;
    },
    deactivate(pluginId) {
      const p = active.get(pluginId);
      if (!p) return;
      for (const off of p.unregisters) {
        try { off(); } catch { /* ignore */ }
      }
      active.delete(pluginId);
    },
    list() {
      return [...active.values()].map(p => p.manifest);
    },
  };
}
