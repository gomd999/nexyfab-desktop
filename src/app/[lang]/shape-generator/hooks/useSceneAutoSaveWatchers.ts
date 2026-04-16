'use client';

import { useEffect, useRef } from 'react';
import type { AutoSaveState } from '../useAutoSave';

interface Deps {
  viewMode: 'gallery' | 'workspace';
  selectedId: string;
  params: Record<string, number>;
  features: ReadonlyArray<unknown>;
  isSketchMode: boolean;
  sketchProfile: { closed: boolean };
  sketchConfig: unknown;
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
  viewMode,
  selectedId,
  params,
  features,
  isSketchMode,
  sketchProfile,
  sketchConfig,
  scheduleSave,
  autoSave,
  buildAutoSaveState,
  markNfabDirty,
}: Deps) {
  // Debounced scheduled save
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    scheduleSave(buildAutoSaveState());
  }, [selectedId, params, features, isSketchMode, viewMode, scheduleSave, buildAutoSaveState]);

  // Immediate save on shape / feature-count transitions
  const prevSelectedIdRef = useRef(selectedId);
  const prevFeaturesLenRef = useRef(features.length);
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    const sc = prevSelectedIdRef.current !== selectedId;
    const fc = prevFeaturesLenRef.current !== features.length;
    prevSelectedIdRef.current = selectedId;
    prevFeaturesLenRef.current = features.length;
    if (sc || fc) autoSave(buildAutoSaveState());
  }, [selectedId, features.length, viewMode, autoSave, buildAutoSaveState]);

  // Immediate save when sketch profile closes
  const prevSketchClosedRef = useRef(sketchProfile.closed);
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    if (!prevSketchClosedRef.current && sketchProfile.closed) autoSave(buildAutoSaveState());
    prevSketchClosedRef.current = sketchProfile.closed;
  }, [sketchProfile.closed, viewMode, autoSave, buildAutoSaveState]);

  // .nfab dirty flag on scene change
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    markNfabDirty();
  }, [selectedId, params, features, isSketchMode, sketchProfile, sketchConfig, viewMode, markNfabDirty]);
}
