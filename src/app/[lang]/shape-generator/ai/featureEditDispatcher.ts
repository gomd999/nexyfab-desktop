/**
 * featureEditDispatcher.ts — apply AI intent to a live feature tree.
 *
 * Phase-2 Week-2 surface: the user types "fillet the corners 3 mm"
 * or "make this 50 mm taller" and the AI returns an *intent* JSON
 * describing what to do to the existing model. This module
 * translates intents into the small set of feature-store API calls
 * the existing pipeline understands (`addFeatureWithParams`,
 * `updateFeatureParam`, `removeFeature`, `clearAll` + reload).
 *
 * The intent schema is a discriminated union — each kind maps to
 * exactly one store call. New kinds are easy to add; unknown kinds
 * raise a descriptive error the caller can surface as a chat reply.
 *
 * NOTE: this is the *adapter* between the AI brain and the store —
 * it does NOT call the LLM. The LLM call lives in
 * `lib/ai/scad-agent` (memory `nexyfab-scad-pipeline`). This module
 * is its action handler.
 */

import type { FeatureInstance, FeatureType } from '../features/types';
import type { FaceSelectionInfo, EdgeSelectionInfo } from '../editing/selectionInfo';

export type FeatureEditIntent =
  | { kind: 'add_feature'; featureType: FeatureType; params: Record<string, number> }
  | {
      // Add a feature that operates on the user's current face/edge selection
      // (offset/delete/draft a clicked face, fillet/chamfer a clicked edge).
      // The selection is captured client-side and embedded here so dispatch
      // stays pure + testable.
      kind: 'add_feature_on_selection';
      featureType: FeatureType;
      params: Record<string, number>;
      faceSelections?: FaceSelectionInfo[];
      edgeSelections?: EdgeSelectionInfo[];
    }
  | {
      // Set/replace the base primitive (box, cylinder, …) from the prompt —
      // "make a 50x50x30 box". Drives the scene store's shape picker, not the
      // feature tree; follow-on add_feature intents in the same batch (holes,
      // fillets) then stack on top.
      kind: 'set_base_shape';
      shapeId: string;
      params: Record<string, number>;
    }
  | {
      // Heterogeneous assembly: replace the placed-parts list with several
      // DIFFERENT parts (each its own shape + params + transform). Drives the
      // PlacedPart pipeline → real per-part geometry.
      kind: 'set_assembly_parts';
      parts: Array<{
        name?: string;
        shapeId: string;
        params: Record<string, number>;
        position?: [number, number, number];
        rotation?: [number, number, number];
      }>;
    }
  | { kind: 'add_sketch_extrude'; sketchData: NonNullable<FeatureInstance['sketchData']> }
  | { kind: 'update_param'; featureId: string; paramKey: string; value: number }
  | { kind: 'remove_feature'; featureId: string }
  | { kind: 'reorder_feature'; featureId: string; newIndex: number }
  | { kind: 'toggle_feature'; featureId: string; enabled: boolean }
  | { kind: 'clear_all' }
  | { kind: 'replace_pipeline'; features: FeatureInstance[] };

export interface FeatureStoreApi {
  features: FeatureInstance[];
  addFeatureWithParams: (type: FeatureType, overrides: Record<string, number>) => void;
  /**
   * Add a feature with params AND a face/edge selection. Optional: when a store
   * does not provide it (e.g. minimal test doubles), dispatch falls back to
   * `addFeatureWithParams` (feature applied without the selection).
   */
  addFeatureWithParamsAndSelection?: (
    type: FeatureType,
    overrides: Record<string, number>,
    edgeSelections?: EdgeSelectionInfo[],
    faceSelections?: FaceSelectionInfo[],
  ) => void;
  /** Set the base primitive (scene-store shape picker). Optional — stores that
   *  don't provide it make `set_base_shape` a reported no-op. */
  setBaseShape?: (shapeId: string, params: Record<string, number>) => void;
  /** Replace the assembly's placed parts (heterogeneous, real per-part
   *  geometry). Optional — a no-op when not provided. */
  setAssemblyParts?: (
    parts: Array<{ name?: string; shapeId: string; params: Record<string, number>; position?: [number, number, number]; rotation?: [number, number, number] }>,
  ) => void;
  addSketchFeature: (
    profile: NonNullable<FeatureInstance['sketchData']>['profile'],
    config: NonNullable<FeatureInstance['sketchData']>['config'],
    plane: 'xy' | 'xz' | 'yz',
    operation: 'add' | 'subtract',
    planeOffset?: number,
    constraints?: NonNullable<FeatureInstance['sketchData']>['constraints'],
    dimensions?: NonNullable<FeatureInstance['sketchData']>['dimensions'],
  ) => void;
  updateFeatureParam: (featureId: string, paramKey: string, value: number) => void;
  removeFeature: (featureId: string) => void;
  moveFeature: (featureId: string, newIndex: number) => void;
  toggleFeature: (featureId: string, enabled: boolean) => void;
  clearAll: () => void;
}

export interface DispatchResult {
  applied: boolean;
  summary: string;
  /** Cause when applied=false. */
  errorReason?: string;
}

export function dispatchFeatureEdit(
  intent: FeatureEditIntent,
  store: FeatureStoreApi,
): DispatchResult {
  switch (intent.kind) {
    case 'add_feature': {
      store.addFeatureWithParams(intent.featureType, intent.params);
      return { applied: true, summary: `Added ${intent.featureType}` };
    }
    case 'add_feature_on_selection': {
      if (store.addFeatureWithParamsAndSelection) {
        store.addFeatureWithParamsAndSelection(
          intent.featureType,
          intent.params,
          intent.edgeSelections,
          intent.faceSelections,
        );
      } else {
        // Graceful fallback — apply without the selection rather than no-op.
        store.addFeatureWithParams(intent.featureType, intent.params);
      }
      const n = (intent.faceSelections?.length ?? 0) + (intent.edgeSelections?.length ?? 0);
      return { applied: true, summary: `Added ${intent.featureType} on ${n} selected element(s)` };
    }
    case 'set_base_shape': {
      if (store.setBaseShape) {
        store.setBaseShape(intent.shapeId, intent.params);
        return { applied: true, summary: `Set base shape ${intent.shapeId}` };
      }
      return { applied: false, summary: 'No-op', errorReason: 'store has no setBaseShape' };
    }
    case 'set_assembly_parts': {
      if (store.setAssemblyParts) {
        store.setAssemblyParts(intent.parts);
        return { applied: true, summary: `Assembled ${intent.parts.length} parts` };
      }
      return { applied: false, summary: 'No-op', errorReason: 'store has no setAssemblyParts' };
    }
    case 'add_sketch_extrude': {
      const sd = intent.sketchData;
      store.addSketchFeature(
        sd.profile,
        sd.config,
        sd.plane,
        sd.operation,
        sd.planeOffset ?? 0,
        sd.constraints,
        sd.dimensions,
      );
      return { applied: true, summary: `Added sketch extrude (${sd.plane}, depth ${sd.config.depth})` };
    }
    case 'update_param': {
      const target = store.features.find(f => f.id === intent.featureId);
      if (!target) return { applied: false, summary: 'No-op', errorReason: `Feature ${intent.featureId} not found` };
      store.updateFeatureParam(intent.featureId, intent.paramKey, intent.value);
      return { applied: true, summary: `${target.type}.${intent.paramKey} = ${intent.value}` };
    }
    case 'remove_feature': {
      const target = store.features.find(f => f.id === intent.featureId);
      if (!target) return { applied: false, summary: 'No-op', errorReason: `Feature ${intent.featureId} not found` };
      store.removeFeature(intent.featureId);
      return { applied: true, summary: `Removed ${target.type}` };
    }
    case 'reorder_feature': {
      const target = store.features.find(f => f.id === intent.featureId);
      if (!target) return { applied: false, summary: 'No-op', errorReason: `Feature ${intent.featureId} not found` };
      if (intent.newIndex < 0 || intent.newIndex > store.features.length) {
        return { applied: false, summary: 'No-op', errorReason: `Invalid index ${intent.newIndex}` };
      }
      store.moveFeature(intent.featureId, intent.newIndex);
      return { applied: true, summary: `Moved ${target.type} → ${intent.newIndex}` };
    }
    case 'toggle_feature': {
      const target = store.features.find(f => f.id === intent.featureId);
      if (!target) return { applied: false, summary: 'No-op', errorReason: `Feature ${intent.featureId} not found` };
      store.toggleFeature(intent.featureId, intent.enabled);
      return { applied: true, summary: `${intent.enabled ? 'Enabled' : 'Disabled'} ${target.type}` };
    }
    case 'clear_all': {
      store.clearAll();
      return { applied: true, summary: 'Cleared pipeline' };
    }
    case 'replace_pipeline': {
      store.clearAll();
      for (const feat of intent.features) {
        if (feat.type === 'sketchExtrude' && feat.sketchData) {
          const sd = feat.sketchData;
          store.addSketchFeature(sd.profile, sd.config, sd.plane, sd.operation, sd.planeOffset ?? 0, sd.constraints, sd.dimensions);
        } else {
          store.addFeatureWithParams(feat.type as FeatureType, feat.params);
        }
      }
      return { applied: true, summary: `Replaced pipeline with ${intent.features.length} features` };
    }
    default: {
      // Exhaustiveness gate.
      const _exhaustive: never = intent;
      void _exhaustive;
      return { applied: false, summary: 'No-op', errorReason: 'Unknown intent kind' };
    }
  }
}

/** Batch dispatcher — runs a list of intents in order, stopping on the
 *  first hard failure. Returns per-intent results so the caller can
 *  surface partial success in the chat reply. */
export function dispatchFeatureEditBatch(
  intents: FeatureEditIntent[],
  store: FeatureStoreApi,
  options: { stopOnError?: boolean } = {},
): DispatchResult[] {
  const stopOnError = options.stopOnError ?? false;
  const results: DispatchResult[] = [];
  for (const intent of intents) {
    const r = dispatchFeatureEdit(intent, store);
    results.push(r);
    if (!r.applied && stopOnError) break;
  }
  return results;
}

export interface AtomicDispatchResult<TSnapshot> {
  committed: boolean;
  results: DispatchResult[];
  snapshot: TSnapshot;
  errorReason?: string;
}

/**
 * Executes an AI batch as one transaction. A failed action or thrown store
 * mutation restores the exact caller-owned snapshot, preventing half-applied
 * feature trees and assemblies.
 */
export async function dispatchFeatureEditBatchAtomic<TSnapshot>(
  intents: FeatureEditIntent[],
  store: FeatureStoreApi,
  capture: () => TSnapshot,
  restore: (snapshot: TSnapshot) => void | Promise<void>,
): Promise<AtomicDispatchResult<TSnapshot>> {
  const snapshot = capture();
  try {
    const results = dispatchFeatureEditBatch(intents, store, { stopOnError: true });
    const failed = results.find(result => !result.applied);
    if (failed || results.length !== intents.length) {
      await restore(snapshot);
      return {
        committed: false,
        results,
        snapshot,
        errorReason: failed?.errorReason ?? 'AI edit batch did not complete',
      };
    }
    return { committed: true, results, snapshot };
  } catch (error) {
    await restore(snapshot);
    return {
      committed: false,
      results: [],
      snapshot,
      errorReason: (error as Error)?.message ?? String(error),
    };
  }
}
