/**
 * migrateFromV1.ts — hot-swap helper: legacy `NfabConfigurationV1[]` →
 * `ConfigurationTable` instance.
 *
 * Wave 2 Phase 2 Track A Week 3 (A3). The host carries both runtimes
 * simultaneously while the `?configs=v2` flag is in the soak phase
 * (W3 → W6). When the flag flips on, we need a way to take the
 * legacy session state and load it into a fresh `ConfigurationTable`
 * so the user doesn't lose their work mid-session.
 *
 * **Mapping decisions** (see spec §5 + §13.10 for the legacy schema):
 *
 *   - `NfabConfigurationV1.id`        → `ConfigEntry.id`
 *   - `NfabConfigurationV1.name`      → `ConfigEntry.name`
 *   - `NfabConfigurationV1.params`    → `ConfigEntry.expressionVars`
 *     The legacy `params` field is a snapshot of `sceneStore.params`
 *     (global numeric parameters of the part — NOT per-feature
 *     overrides). The closest A2 equivalent is `expressionVars`, which
 *     also live at the config scope and are shadowed by per-feature
 *     overrides when the EquationManager resolves a string expression.
 *     This mapping preserves the values on disk and lets the user's
 *     existing expression-driven features resolve against them.
 *   - `NfabConfigurationV1.paramExpressions` → `ConfigEntry.expressionVars`
 *     (string entries merged in alongside the numeric ones).
 *   - `NfabConfigurationV1.featureEnabled` → per-feature `suppressed`
 *     overrides. `enabled: false` becomes `suppressed: true`. Features
 *     missing from the legacy map default to "not suppressed" (the
 *     legacy `normalizeConfigurations` convention: missing = no opinion).
 *   - Parent inheritance: legacy V1 has no parent chain — every
 *     migrated entry has `parentId = undefined`.
 *
 * The migration is **lossy in one direction**: a V1 config that
 * stored a global param value the user authored at the config level
 * is mapped to an `expressionVars` entry, NOT a per-feature override.
 * This matches the legacy runtime behaviour (`handleConfigurationSelect`
 * writes into `sceneStore.params`, not into feature params), so the
 * pipeline output is unchanged when the flag flips. The user can later
 * convert global params to per-feature overrides via the A4 UI.
 *
 * Pure function — no React, no I/O, no module-level state. Callers
 * decide where to install the result (`setConfigurationTable` etc.).
 */

import { ConfigurationTable } from './ConfigurationTable';
import type { NfabConfigurationV1 } from '../io/nfabFormat';

/** Convert a legacy V1 configuration list into a fresh `ConfigurationTable`.
 *
 *  @param configs   Legacy configurations array (may be empty or undefined).
 *  @param activeId  The legacy `activeConfigurationId`. When provided and
 *                   resolvable, the resulting table activates that id;
 *                   otherwise it activates the master (null).
 *  @returns A new `ConfigurationTable` with one entry per legacy config.
 *           Always returns a fresh instance — callers own the lifetime. */
export function migrateFromV1(
  configs: readonly NfabConfigurationV1[] | undefined,
  activeId?: string | null,
): ConfigurationTable {
  const table = new ConfigurationTable();
  if (!configs || configs.length === 0) {
    // Empty migration — still consistent: master active by default,
    // no entries. The caller can `add()` later.
    return table;
  }

  for (const v1 of configs) {
    // Skip malformed entries — `nfabFormat.normalizeConfigurations`
    // would have already dropped these, but be defensive.
    if (!v1 || typeof v1.id !== 'string' || typeof v1.name !== 'string') {
      continue;
    }
    const entry = table.add(v1.name, { id: v1.id });

    // featureEnabled → per-feature suppressed overrides.
    if (v1.featureEnabled && typeof v1.featureEnabled === 'object') {
      for (const [featureId, enabled] of Object.entries(v1.featureEnabled)) {
        // Only emit a suppress override when the legacy entry says
        // `enabled: false` — an `enabled: true` is the default and
        // doesn't need an explicit override.
        if (enabled === false) {
          table.setSuppressed(v1.id, featureId, true);
        }
      }
    }

    // params (numeric) → expressionVars at the config scope. These
    // are sceneStore globals in the legacy runtime; storing them in
    // `expressionVars` lets EquationManager resolve string-typed
    // feature params against them once the pipeline is re-evaluated.
    if (v1.params && typeof v1.params === 'object') {
      for (const [name, value] of Object.entries(v1.params)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          table.setExpressionVar(v1.id, name, value);
        }
      }
    }

    // paramExpressions (string) → expressionVars (string-typed).
    // Spec §13.10: paramExpressions never actually evaluated in v1;
    // we preserve them verbatim so the user can re-author in v3.
    if (v1.paramExpressions && typeof v1.paramExpressions === 'object') {
      for (const [name, expr] of Object.entries(v1.paramExpressions)) {
        if (typeof expr === 'string' && expr.trim().length > 0) {
          table.setExpressionVar(v1.id, name, expr);
        }
      }
    }

    // Touch `entry` to keep the unused-var lint quiet — the entry is
    // already inside the table; we just confirmed the add() returned.
    void entry;
  }

  // Activate the legacy active id if it exists in the new table;
  // otherwise leave the table at master (the first `add()` above
  // auto-activated whichever entry came first, so we must explicitly
  // clear it back to master when the caller wants that).
  if (activeId !== null && activeId !== undefined && table.get(activeId) !== null) {
    table.activate(activeId);
  } else {
    table.activate(null);
  }

  return table;
}
