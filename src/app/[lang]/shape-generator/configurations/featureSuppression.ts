/**
 * featureSuppression.ts — Phase 5f helper.
 *
 * Pure mapper from `NfabConfigurationV1.featureEnabled` (or any
 * `Record<featureId, boolean>` shape) to a featureStack snapshot
 * with per-feature `enabled` flags overridden.
 *
 * Used by the ConfigurationsExportBridge host wire to replay a
 * config's suppression state without mutating the live featureStack:
 *
 *   const baseFeatures = useFeatureStack().features;
 *   const cfg = configurations.find(c => c.id === id);
 *   const suppressed = applyFeatureEnabledMap(baseFeatures, cfg.featureEnabled);
 *   const result = runPipeline(baseGeometry, suppressed, FEATURE_MAP);
 *
 * Semantics — for each feature in `features`:
 *   - if `enabledMap[feature.id]` is `true`  → feature.enabled = true
 *   - if `enabledMap[feature.id]` is `false` → feature.enabled = false
 *   - if `feature.id` is NOT in the map      → feature unchanged
 *
 * `enabledMap` undefined / null → returns the input array reference
 * unchanged (no-op fast path).
 *
 * Returns a NEW array; never mutates the input. Each per-feature
 * object is cloned only when its enabled flag actually changes —
 * unchanged features pass through by reference (cheap for the common
 * case where most features aren't suppressed).
 */

import type { FeatureInstance } from '../features/types';

export function applyFeatureEnabledMap(
  features: readonly FeatureInstance[],
  enabledMap: Readonly<Record<string, boolean>> | undefined | null,
): FeatureInstance[] {
  if (!enabledMap) return features.slice();
  return features.map((f) => {
    if (!(f.id in enabledMap)) return f;
    const nextEnabled = enabledMap[f.id] === true;
    if (f.enabled === nextEnabled) return f;
    return { ...f, enabled: nextEnabled };
  });
}

/** Same as `applyFeatureEnabledMap` but ALSO drops disabled features
 *  from the result. Use when the downstream consumer doesn't honor
 *  `feature.enabled` and just iterates the array.
 *
 *  pipelineManager.runPipeline DOES honor `enabled` (skips disabled
 *  features), so most callers should prefer the regular variant —
 *  this is for legacy code paths that don't filter. */
export function applyAndPruneFeatureEnabledMap(
  features: readonly FeatureInstance[],
  enabledMap: Readonly<Record<string, boolean>> | undefined | null,
): FeatureInstance[] {
  const overlaid = applyFeatureEnabledMap(features, enabledMap);
  return overlaid.filter((f) => f.enabled !== false);
}

/** Count how many features in the stack would be flipped by the map
 *  vs the live state. Useful for UI hints ("3 features will be
 *  suppressed in this config"). */
export function countSuppressionDelta(
  features: readonly FeatureInstance[],
  enabledMap: Readonly<Record<string, boolean>> | undefined | null,
): { flipped: number; suppressed: number; restored: number } {
  if (!enabledMap) return { flipped: 0, suppressed: 0, restored: 0 };
  let suppressed = 0;
  let restored = 0;
  for (const f of features) {
    if (!(f.id in enabledMap)) continue;
    const nextEnabled = enabledMap[f.id] === true;
    if (f.enabled === nextEnabled) continue;
    if (nextEnabled) restored++;
    else suppressed++;
  }
  return { flipped: suppressed + restored, suppressed, restored };
}
