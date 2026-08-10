/**
 * Feature beta status — a single source of truth for "this feature works
 * but has known limitations" labeling. Surfaced in API responses (so
 * clients can render a beta banner) and in plan/limits docs (so partners
 * know what to expect).
 *
 * Add a feature here when:
 *   - Implementation is functional but incomplete (e.g., scad_agent's
 *     JS solver fallback handles only a subset of constraints)
 *   - You want to set explicit expectations rather than fail silently
 *
 * Remove when the limitation is resolved. Don't leave entries here as a
 * permanent disclaimer — that defeats the purpose.
 */

export interface BetaFeature {
  feature: string;
  reason: string;
  limitations: string[];
  workaround?: string;
}

export const BETA_FEATURES: Record<string, BetaFeature> = {
  complex_product_design: {
    feature: 'Complex Product AI Design',
    reason: 'Expert-assisted closed beta while exact CAD, drawing release, and broad-product evidence are completed',
    limitations: [
      'Gate-passed output is an engineering review package, not a manufacturing release certificate',
      'Generated geometry is not yet applied to an editable workspace revision automatically',
      'Exact CAD, full assembly motion/collision, manufacturing drawings, and independent approval remain mandatory for release',
      'Only approved product families and reference fixtures may be used for governed pilots',
    ],
    workaround: 'Use the reference fixtures for evaluation and route real products through the expert review and precision-CAD handoff workflow',
  },
  scad_agent: {
    feature: 'AI SCAD Agent',
    reason: 'Constraint solver runs JS fallback — WASM (Solvespace) port pending',
    limitations: [
      'Handles 4 constraint types: distance, angle, parallel, perpendicular',
      'Complex 3D sketches (curves, splines, advanced fillets) may fail to converge',
      'Residual tolerance 1e-2; tighter requirements unsupported',
    ],
    workaround: 'Use parametric library shapes for now; complex models can be uploaded as STEP/STL via /dfm',
  },
  // Add more entries as features ship in beta state.
};

export function getBetaFeature(name: string): BetaFeature | null {
  return BETA_FEATURES[name] ?? null;
}

export function isBeta(name: string): boolean {
  return name in BETA_FEATURES;
}

/**
 * Resolve the runtime enable/disable state for a feature.
 *
 * Lookup order:
 *   1. nf_admin_settings key `feature.<name>.enabled` (operator override)
 *   2. Default: true (every feature on unless explicitly disabled)
 *
 * Operators can flip a feature off from /admin/settings without a
 * redeploy — useful when scad_agent has a runaway, or to dark-launch a
 * new endpoint behind an off-by-default flag.
 */
export async function isFeatureEnabled(name: string, defaultValue = true): Promise<boolean> {
  const { getSetting } = await import('./admin-settings');
  const v = await getSetting(`feature.${name}.enabled`);
  if (v == null) return defaultValue;
  return v === 'true' || v === '1';
}

/** Sync version using the in-memory cache + env. Use in hot paths only. */
export function isFeatureEnabledSync(name: string, defaultValue = true): boolean {
  // Lazily call the sync settings reader. Avoid cyclic imports by
  // requiring at use-time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSettingSync } = require('./admin-settings') as typeof import('./admin-settings');
  const v = getSettingSync(`feature.${name}.enabled`);
  if (v == null) return defaultValue;
  return v === 'true' || v === '1';
}

/**
 * Effective beta status — DB override can mark a non-listed feature as
 * beta, or hide an in-code beta entry from the UI. Returns the feature
 * descriptor with optional override applied.
 */
export async function getEffectiveBetaFeature(name: string): Promise<BetaFeature | null> {
  const { getSetting } = await import('./admin-settings');
  const dbBeta = await getSetting(`feature.${name}.beta`);
  if (dbBeta === 'false' || dbBeta === '0') return null;        // operator suppressed beta tag
  const code = BETA_FEATURES[name];
  if (code) return code;
  if (dbBeta === 'true' || dbBeta === '1') {
    return {
      feature: name,
      reason: 'Marked as beta by operator (DB override)',
      limitations: [],
    };
  }
  return null;
}
