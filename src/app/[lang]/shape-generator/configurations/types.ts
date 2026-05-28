/**
 * configurations/types.ts — shared runtime types for the
 * `ConfigurationTable` class + its helpers (`diffConfigs`,
 * `validateModel`).
 *
 * Wave 2 Phase 2 Track A Week 2 (A2). Pure data — no React, no
 * Zustand, no Yjs. The shapes mirror `NfabConfigurationV2` from the
 * spec (§3.1) but stay decoupled from `nfabFormat.ts` so the runtime
 * can predate the v3 schema bump (A3) and not block on it.
 *
 * **Important:** these are runtime shapes, not wire shapes. The
 * .nfab v3 round-trip will add a separate codec (A3). Keeping the two
 * apart lets us extend the runtime (e.g. add a `notes?: string`) without
 * a file-format migration.
 */
import type { FeatureInstance } from '../features/types';

/** Per-feature override slot inside a config entry. */
export interface ConfigOverride {
  /** When `true` the feature is suppressed (excluded from the pipeline)
   *  while this config is the resolved chain top. */
  suppressed?: boolean;
  /** Per-feature param overrides. Literal numbers fast-path; string
   *  expressions (resolved by EquationManager at pipeline time, see
   *  spec §4.2) are accepted at the type level and stored verbatim. The
   *  W2 runtime does *not* evaluate expressions — that wires up in A3.
   *  For W2, string values are passed through unchanged into the
   *  resolved feature's `params`, which keeps `FeatureInstance.params`
   *  typed `Record<string, number>`; A3 will branch on `typeof v`. */
  params?: Record<string, number | string>;
}

/** A single configuration row. */
export interface ConfigEntry {
  id: string;
  name: string;
  /** Optional parent — child inherits parent's overrides then layers
   *  its own on top (§5 spec resolution order). */
  parentId?: string;
  /** featureId → { suppressed?, params? } */
  overrides: Record<string, ConfigOverride>;
  /** Config-scoped variables. Shadow `ConfigurationTable.globalVars`
   *  and the EquationManager table when this config is active (§4.2). */
  expressionVars: Record<string, number | string>;
}

/** Result of `ConfigurationTable.setParent` etc. — explicit pass/fail
 *  result type instead of throwing, so the UI can render the cycle
 *  path in a toast (spec §7.4 cycleError i18n). */
export type ConfigOpResult =
  | { ok: true }
  | { ok: false; error: 'unknown_config' | 'unknown_parent' | 'cycle'; cyclePath?: readonly string[] };

/** Diff between two resolved configs (port of
 *  `multiConfigPartVariant.ConfigDiff` shape, generalised to support
 *  the new param-keyed-by-featureId model). */
export interface ConfigDiff {
  configA: string;
  configB: string;
  /** Feature ids suppressed in A but not B (i.e. visible in B only). */
  suppressedInA: string[];
  /** Feature ids suppressed in B but not A (i.e. visible in A only). */
  suppressedInB: string[];
  /** Per-feature param value deltas (resolved values; A vs B). */
  paramDeltas: ConfigParamDelta[];
}

export interface ConfigParamDelta {
  featureId: string;
  paramKey: string;
  /** `undefined` when the feature does not exist in that side's chain
   *  (i.e. only present on one side because the feature isn't in the
   *  master tree — should not happen if model is validated). */
  valueA: number | string | undefined;
  valueB: number | string | undefined;
}

/** A validation error surfaces a single problem; multiple errors are
 *  returned together so the UI can list them. */
export interface ConfigValidationError {
  configId: string;
  kind:
    | 'unknown_feature'      // override.featureId not in master tree
    | 'unknown_parent'       // parentId not in table
    | 'parent_cycle'         // setParent created a cycle (caught at load)
    | 'undefined_var';       // expression references a var not in scope
  /** Human-readable detail; for `undefined_var` the missing var name. */
  detail: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ConfigValidationError[] };

/** Subset of `FeatureInstance` the resolver needs. The exported helpers
 *  accept the full `FeatureInstance` so callers don't have to project
 *  manually; this alias just documents the contract. */
export type MasterFeatures = readonly FeatureInstance[];
