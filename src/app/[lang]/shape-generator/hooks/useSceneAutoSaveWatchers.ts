'use client';

import { useEffect, useRef } from 'react';
import type { AutoSaveState } from '../useAutoSave';

interface Deps {
  /** False for share/read-only sessions. No dirty, local or cloud persistence may run. */
  enabled?: boolean;
  viewMode: 'gallery' | 'workspace';
  selectedId: string;
  params: Record<string, number>;
  features: ReadonlyArray<unknown>;
  isSketchMode: boolean;
  sketchProfile: { closed: boolean };
  sketchConfig: unknown;
  /** Triggers .nfab dirty + debounced autosave when assembly layout changes */
  placedParts?: ReadonlyArray<unknown>;
  assemblyMates?: ReadonlyArray<unknown>;
  bodies?: ReadonlyArray<unknown>;
  assemblyHiddenParts?: Set<string>;
  assemblyTransparentParts?: Set<string>;
  assemblyPartColors?: Record<string, string>;
  explodeFactor?: number;
  sketchViewMode?: string;
  ribbonTheme?: string;
  sectionActive?: boolean;
  sectionAxis?: string;
  sectionOffset?: number;
  sketchPalSlice?: boolean;
  sketchSlicePlaneMm?: number;
  multiView?: boolean;
  viewportCameraPersisted?: { position: [number, number, number]; target: [number, number, number] } | null;
  /** Stable fingerprint of named configurations list + active id */
  configurationsSig?: string;
  cadWorkspace?: string;
  renderMode?: 'standard' | 'photorealistic';
  scheduleSave: (s: AutoSaveState) => void;
  autoSave: (s: AutoSaveState) => void;
  buildAutoSaveState: () => AutoSaveState;
  markNfabDirty: () => void;
}

/**
 * Wires scene-state changes to autosave + .nfab dirty tracking.
 * - Debounced scheduleSave on any scene change
 * - Immediate autoSave on shape-id / feature-count / sketch-closed transitions
 * - markDirty on any meaningful scene change (drives desktop dirty + cloud auto-flush)
 */
export function useSceneAutoSaveWatchers({
  enabled = true,
  viewMode,
  selectedId,
  params,
  features,
  isSketchMode,
  sketchProfile,
  sketchConfig,
  placedParts,
  assemblyMates,
  bodies,
  explodeFactor,
  sketchViewMode,
  ribbonTheme,
  sectionActive,
  sectionAxis,
  sectionOffset,
  sketchPalSlice,
  sketchSlicePlaneMm,
  multiView,
  viewportCameraPersisted,
  configurationsSig,
  cadWorkspace,
  renderMode,
  scheduleSave,
  autoSave,
  buildAutoSaveState,
  markNfabDirty,
  assemblyHiddenParts,
  assemblyTransparentParts,
  assemblyPartColors,
}: Deps) {
  // Debounced scheduled save
  useEffect(() => {
    if (!enabled || viewMode !== 'workspace') return;
    scheduleSave(buildAutoSaveState());
  }, [enabled, selectedId, params, features, isSketchMode, placedParts, assemblyMates, bodies, explodeFactor, sketchViewMode, ribbonTheme, sectionActive, sectionAxis, sectionOffset, sketchPalSlice, sketchSlicePlaneMm, multiView, viewportCameraPersisted, configurationsSig, cadWorkspace, renderMode, viewMode, scheduleSave, buildAutoSaveState, assemblyHiddenParts, assemblyTransparentParts, assemblyPartColors]);

  // Immediate save on shape / feature-count transitions
  const prevSelectedIdRef = useRef(selectedId);
  const prevFeaturesLenRef = useRef(features.length);
  useEffect(() => {
    if (!enabled) {
      prevSelectedIdRef.current = selectedId;
      prevFeaturesLenRef.current = features.length;
      return;
    }
    if (viewMode !== 'workspace') return;
    const sc = prevSelectedIdRef.current !== selectedId;
    const fc = prevFeaturesLenRef.current !== features.length;
    prevSelectedIdRef.current = selectedId;
    prevFeaturesLenRef.current = features.length;
    if (sc || fc) autoSave(buildAutoSaveState());
  }, [enabled, selectedId, features.length, viewMode, autoSave, buildAutoSaveState]);

  // Immediate save when sketch profile closes
  const prevSketchClosedRef = useRef(sketchProfile.closed);
  useEffect(() => {
    if (!enabled) {
      prevSketchClosedRef.current = sketchProfile.closed;
      return;
    }
    if (viewMode !== 'workspace') return;
    if (!prevSketchClosedRef.current && sketchProfile.closed) autoSave(buildAutoSaveState());
    prevSketchClosedRef.current = sketchProfile.closed;
  }, [enabled, sketchProfile.closed, viewMode, autoSave, buildAutoSaveState]);

  // .nfab dirty flag on scene change
  useEffect(() => {
    if (!enabled || viewMode !== 'workspace') return;
    markNfabDirty();
  }, [enabled, selectedId, params, features, isSketchMode, sketchProfile, sketchConfig, placedParts, assemblyMates, bodies, explodeFactor, sketchViewMode, ribbonTheme, sectionActive, sectionAxis, sectionOffset, sketchPalSlice, sketchSlicePlaneMm, multiView, viewportCameraPersisted, configurationsSig, cadWorkspace, renderMode, viewMode, markNfabDirty, assemblyHiddenParts, assemblyTransparentParts, assemblyPartColors]);
}
