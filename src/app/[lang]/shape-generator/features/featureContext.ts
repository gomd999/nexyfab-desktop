/**
 * featureContext.ts — Module-level context for cross-cutting feature managers.
 *
 * `ConfigurationTable` (Wave 2 Phase 2 A2 runtime) and `EquationManager`
 * (global parameter table) sit *between* the feature list and the pipeline.
 * They are needed both from React UI (panels) and from non-React
 * pipeline call-sites — having a single module-level slot avoids
 * threading them through every signature.
 *
 * Lifecycle:
 *   1. Host (`ShapeGeneratorInner`) calls `setConfigurationTable(t)` when
 *      the v2 runtime is enabled (`?configs=v2`). `null` clears.
 *   2. Pipeline (`applyFeaturePipelineDetailed`) calls
 *      `getConfigurationTable()` (and `getEquationManager()`) and applies
 *      the active config + equation overrides on every run.
 *   3. Tests reset via `resetFeatureContext()`.
 *
 * The slot is "one per tab" — multiple project tabs would each have
 * their own JS module instance.
 *
 * **Wave 2 Phase 2 W6 (Track A6) cleanup** — the legacy `ConfigurationManager`
 * runtime slot and its `applyConfig` fallback were removed in this PR.
 * That class was never wired in the host (`useConfigurationManager()` was
 * dead code, see configurations-spec §1.1.B). The legacy non-flag
 * configuration path in `ShapeGeneratorInner` keeps working through direct
 * scene-store mutation — it does NOT go through this seam.
 */

import type { ConfigurationTable } from '../configurations/ConfigurationTable';
import type { EquationManager } from '../equations/equationManager';
import type { FeatureInstance } from './types';

let configurationTable: ConfigurationTable | null = null;
let equationManager: EquationManager | null = null;

/** A3 — register the new `ConfigurationTable` runtime. Pass `null` to
 *  clear (flag flipped off, tab closed, etc.). When a table is set
 *  AND has an active configuration, `applyFeatureContext` resolves
 *  through it; otherwise features pass through unchanged. */
export function setConfigurationTable(t: ConfigurationTable | null): void {
  configurationTable = t;
}

export function getConfigurationTable(): ConfigurationTable | null {
  return configurationTable;
}

export function setEquationManager(m: EquationManager | null): void {
  equationManager = m;
}

export function getEquationManager(): EquationManager | null {
  return equationManager;
}

export function resetFeatureContext(): void {
  configurationTable = null;
  equationManager = null;
}

/** Pre-process a feature list using the active managers — applied
 *  immediately before pipeline evaluation. Idempotent when managers
 *  are null.
 *
 *  Resolution priority:
 *    1. `ConfigurationTable.resolveActive` when a table is registered
 *       AND has an active configuration.
 *    2. Else features pass through unchanged.
 *
 *  EquationManager always runs last (when present) so configs can emit
 *  expression-typed param overrides that resolve against the global
 *  variable table. */
export function applyFeatureContext(features: FeatureInstance[]): FeatureInstance[] {
  let out = features;
  if (configurationTable && configurationTable.getActiveId() !== null) {
    out = configurationTable.resolveActive(out);
  }
  if (equationManager) {
    // EquationManager only operates on string params; cast widens the
    // params union so the resolver can see them.
    type AnyParamFeature = { params: Record<string, number | string> };
    const widened = out as unknown as AnyParamFeature[];
    const resolved = equationManager.resolveFeatures(widened);
    out = resolved as unknown as FeatureInstance[];
  }
  return out;
}
