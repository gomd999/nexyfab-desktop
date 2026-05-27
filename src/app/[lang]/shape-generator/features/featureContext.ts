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
 */

import type { ConfigurationManager } from '../config/configurationManager';
import type { EquationManager } from '../equations/equationManager';
import type { FeatureInstance } from './types';

let configManager: ConfigurationManager | null = null;
let equationManager: EquationManager | null = null;

export function setConfigurationManager(m: ConfigurationManager | null): void {
  configManager = m;
}

export function getConfigurationManager(): ConfigurationManager | null {
  return configManager;
}

export function setEquationManager(m: EquationManager | null): void {
  equationManager = m;
}

export function getEquationManager(): EquationManager | null {
  return equationManager;
}

export function resetFeatureContext(): void {
  configManager = null;
  equationManager = null;
}

/** Pre-process a feature list using the active managers — applied
 *  immediately before pipeline evaluation. Idempotent when managers
 *  are null. */
export function applyFeatureContext(features: FeatureInstance[]): FeatureInstance[] {
  let out = features;
  if (configManager) {
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
