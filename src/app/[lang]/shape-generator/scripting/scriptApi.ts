/**
 * scriptApi.ts — Public API surface that user scripts call.
 *
 * SolidWorks exposes COM via `SldWorks.Application`. Onshape uses
 * FeatureScript. NexyFab uses a JS-flavored surface that maps 1:1
 * to feature-store operations + geometry inspection.
 *
 * The API is provided to the sandbox as a frozen `nf` global. All
 * methods are sync (returning Promise where IO is required) and
 * side-effects only mutate the feature store via well-known
 * dispatch functions — no direct state mutation from scripts.
 *
 * Stability promise: this is the *public* API. Names are stable
 * across versions; only additive changes are allowed without
 * version bump. Internal implementation can change freely.
 */

import type { FeatureInstance, FeatureType } from '../features/types';

export interface NexyFabScriptApi {
  /** Library metadata. */
  readonly version: string;

  /** ── Feature operations ───────────────────────────────────────── */

  /** Return the list of features in the current pipeline. */
  listFeatures(): readonly FeatureInstance[];

  /** Add a feature with the given type and parameter overrides. */
  addFeature(type: FeatureType, params?: Record<string, number>): string;

  /** Add a sketch-extrude feature (rect / circle / polygon helpers). */
  addExtrude(opts: {
    profile: 'rect' | 'circle' | 'polygon';
    width?: number; height?: number; radius?: number; sides?: number;
    depth: number;
    plane?: 'xy' | 'xz' | 'yz';
    operation?: 'add' | 'subtract';
  }): string;

  /** Update a parameter on an existing feature. */
  updateParam(featureId: string, paramKey: string, value: number): void;

  /** Remove a feature by id. */
  removeFeature(featureId: string): void;

  /** Move a feature to a new index in the pipeline. */
  reorderFeature(featureId: string, newIndex: number): void;

  /** Toggle a feature on/off without removing it. */
  toggleFeature(featureId: string, enabled: boolean): void;

  /** Clear the entire pipeline. */
  clearAll(): void;

  /** ── Geometry inspection ──────────────────────────────────────── */

  /** Get the bounding box (mm) of the current pipeline output. */
  getBbox(): { min: [number, number, number]; max: [number, number, number] } | null;

  /** Get triangle / vertex counts for the current geometry. */
  getMeshStats(): { vertices: number; triangles: number } | null;

  /** ── Export ───────────────────────────────────────────────────── */

  /** Export current geometry as STL — returns a Promise of a Blob URL. */
  exportStl(): Promise<string>;

  /** ── Logging ──────────────────────────────────────────────────── */

  /** Log a message to the script console. */
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Implementation contract — the host provides these callbacks when
 *  constructing the API for a sandbox. The script never touches the
 *  underlying store directly. */
export interface ScriptApiHost {
  listFeatures: () => readonly FeatureInstance[];
  dispatchAdd: (type: FeatureType, params: Record<string, number>) => string;
  dispatchExtrude: (
    profileKind: 'rect' | 'circle' | 'polygon',
    config: {
      width?: number; height?: number; radius?: number; sides?: number;
      depth: number;
      plane: 'xy' | 'xz' | 'yz';
      operation: 'add' | 'subtract';
    },
  ) => string;
  dispatchUpdateParam: (id: string, key: string, value: number) => void;
  dispatchRemove: (id: string) => void;
  dispatchReorder: (id: string, newIndex: number) => void;
  dispatchToggle: (id: string, enabled: boolean) => void;
  dispatchClearAll: () => void;
  getBbox: () => { min: [number, number, number]; max: [number, number, number] } | null;
  getMeshStats: () => { vertices: number; triangles: number } | null;
  exportStl: () => Promise<string>;
  logSink: (level: 'info' | 'warn' | 'error', args: unknown[]) => void;
}

export const SCRIPT_API_VERSION = '1.0.0';

/** Build a frozen script API surface bound to the given host. */
export function createScriptApi(host: ScriptApiHost): NexyFabScriptApi {
  const api: NexyFabScriptApi = {
    version: SCRIPT_API_VERSION,
    listFeatures: () => host.listFeatures(),
    addFeature: (type, params = {}) => host.dispatchAdd(type, params),
    addExtrude: (opts) => host.dispatchExtrude(opts.profile, {
      width: opts.width, height: opts.height, radius: opts.radius, sides: opts.sides,
      depth: opts.depth,
      plane: opts.plane ?? 'xy',
      operation: opts.operation ?? 'add',
    }),
    updateParam: (id, key, value) => host.dispatchUpdateParam(id, key, value),
    removeFeature: (id) => host.dispatchRemove(id),
    reorderFeature: (id, idx) => host.dispatchReorder(id, idx),
    toggleFeature: (id, enabled) => host.dispatchToggle(id, enabled),
    clearAll: () => host.dispatchClearAll(),
    getBbox: () => host.getBbox(),
    getMeshStats: () => host.getMeshStats(),
    exportStl: () => host.exportStl(),
    log: (...args) => host.logSink('info', args),
    warn: (...args) => host.logSink('warn', args),
    error: (...args) => host.logSink('error', args),
  };
  return Object.freeze(api);
}
