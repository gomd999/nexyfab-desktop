/**
 * featureContext.ts — Module-level context for cross-cutting feature managers.
 *
 * ConfigurationManager (design variants) and EquationManager (global
 * parameter table) sit *between* the feature list and the pipeline.
 * They are needed both from React UI (panels) and from non-React
 * pipeline call-sites — having a single module-level slot avoids
 * threading them through every signature.
 *
 * Lifecycle:
 *   1. Panel (or app init) calls `setConfigurationManager(m)` once.
 *   2. Pipeline (`applyFeaturePipelineDetailed`) calls `getConfigurationManager()`
 *      and applies the active config + equation overrides on every run.
 *   3. Tests reset via `resetFeatureContext()`.
 *
 * The slot is "one per tab" — multiple project tabs would each have
 * their own JS module instance.
 *
 * **W3 / A3 addition — `ConfigurationTable` slot.** Wave 2 Phase 2 W3
 * wires the new A2 `ConfigurationTable` runtime through this seam
 * UNDER A FLAG (`?configs=v2`). When a `ConfigurationTable` instance is
 * registered, `applyFeatureContext` prefers it over the legacy
 * `ConfigurationManager` path. The two paths are mutually exclusive
 * by design — the host wires up exactly one at a time depending on
 * the flag. The legacy path stays for back-compat soak until W6
 * cleanup (see master tracker Track A row "W6").
 */

import type { ConfigurationManager } from '../config/configurationManager';
import type { ConfigurationTable } from '../configurations/ConfigurationTable';
import type { EquationManager } from '../equations/equationManager';
import type { FeatureInstance } from './types';

let configManager: ConfigurationManager | null = null;
let configurationTable: ConfigurationTable | null = null;
let equationManager: EquationManager | null = null;

export function setConfigurationManager(m: ConfigurationManager | null): void {
  configManager = m;
}

export function getConfigurationManager(): ConfigurationManager | null {
  return configManager;
}

/** A3 — register the new `ConfigurationTable` runtime. Pass `null` to
 *  clear (flag flipped off, tab closed, etc.). When a table is set it
 *  TAKES PRECEDENCE over `ConfigurationManager` in `applyFeatureContext`. */
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
  configManager = null;
  configurationTable = null;
  equationManager = null;
}

/** Pre-process a feature list using the active managers — applied
 *  immediately before pipeline evaluation. Idempotent when managers
 *  are null.
 *
 *  Resolution priority (A3):
 *    1. `ConfigurationTable.resolveActive` when a table is registered
 *       AND has an active configuration. The table is canonical when
 *       set — it does NOT chain into `ConfigurationManager`. Equation
 *       resolution still runs afterwards (string-param expressions in
 *       the resolved feature list).
 *    2. Else `ConfigurationManager.applyConfig` for legacy callers.
 *    3. Else features pass through unchanged.
 *
 *  EquationManager always runs last (when present) so configs can emit
 *  expression-typed param overrides that resolve against the global
 *  variable table. */
export function applyFeatureContext(features: FeatureInstance[]): FeatureInstance[] {
  let out = features;
  if (configurationTable && configurationTable.getActiveId() !== null) {
    out = configurationTable.resolveActive(out);
  } else if (configManager) {
    out = configManager.applyConfig(out);
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
