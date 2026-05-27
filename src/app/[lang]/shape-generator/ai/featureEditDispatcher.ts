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

export type FeatureEditIntent =
  | { kind: 'add_feature'; featureType: FeatureType; params: Record<string, number> }
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
