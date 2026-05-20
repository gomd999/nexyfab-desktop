/**
 * multiConfigPartVariant.ts — Manage multiple configurations of the
 * same part (sometimes called "design tables" in SolidWorks).
 *
 * A part can have variants:
 *   - Default: full feature set.
 *   - Lightened: some features suppressed (for mass reduction).
 *   - Service: extra features for maintenance access.
 *   - Different sizes parameterised by a "size key".
 *
 * Module:
 *   - Manages feature suppression flags per configuration.
 *   - Manages parameter values (dimension overrides) per config.
 *   - Computes diff between configurations.
 *   - Validates consistency (every feature in default exists).
 */

export interface FeatureRef {
  id: string;
  /** Suppressed in this configuration? */
  suppressed: boolean;
}

export interface Configuration {
  name: string;
  /** Inherited from a parent (or '' for root). */
  parent: string;
  /** Per-feature suppression overrides relative to parent. */
  featureOverrides: Map<string, FeatureRef>;
  /** Per-parameter value overrides. */
  parameterOverrides: Map<string, number>;
  /** Configuration-specific metadata (description, intended use). */
  metadata: Record<string, string>;
}

export interface PartModel {
  /** Master feature list. */
  features: FeatureRef[];
  /** Master parameter list (name → value). */
  parameters: Map<string, number>;
  configurations: Configuration[];
}

// ── Resolve a configuration ──────────────────────────────────

export interface ResolvedConfig {
  name: string;
  features: FeatureRef[];
  parameters: Map<string, number>;
}

export function resolveConfig(model: PartModel, configName: string): ResolvedConfig {
  const cfg = model.configurations.find(c => c.name === configName);
  if (!cfg) {
    return { name: configName, features: model.features.slice(), parameters: new Map(model.parameters) };
  }
  // Walk parent chain.
  const chain: Configuration[] = [];
  let cur: Configuration | undefined = cfg;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.name)) {
    chain.unshift(cur);
    seen.add(cur.name);
    cur = cur.parent ? model.configurations.find(c => c.name === cur!.parent) : undefined;
  }
  // Apply overrides in order.
  const featuresMap = new Map(model.features.map(f => [f.id, { ...f }]));
  const params = new Map(model.parameters);
  for (const c of chain) {
    for (const [id, ref] of c.featureOverrides) {
      featuresMap.set(id, { ...ref });
    }
    for (const [name, val] of c.parameterOverrides) {
      params.set(name, val);
    }
  }
  return { name: configName, features: Array.from(featuresMap.values()), parameters: params };
}

// ── Diff two configurations ──────────────────────────────────

export interface ConfigDiff {
  configA: string;
  configB: string;
  /** Features suppressed in A but not B. */
  suppressedInA: string[];
  /** Features suppressed in B but not A. */
  suppressedInB: string[];
  /** Parameters that differ in value. */
  paramDeltas: { name: string; valueA: number; valueB: number }[];
}

export function diffConfigs(model: PartModel, a: string, b: string): ConfigDiff {
  const ra = resolveConfig(model, a);
  const rb = resolveConfig(model, b);
  const supA: string[] = [];
  const supB: string[] = [];
  const featMap = new Map(ra.features.map(f => [f.id, f]));
  for (const fb of rb.features) {
    const fa = featMap.get(fb.id);
    if (!fa) continue;
    if (fa.suppressed && !fb.suppressed) supA.push(fa.id);
    if (!fa.suppressed && fb.suppressed) supB.push(fb.id);
  }
  const deltas: ConfigDiff['paramDeltas'] = [];
  for (const [name, va] of ra.parameters) {
    const vb = rb.parameters.get(name);
    if (vb !== undefined && vb !== va) deltas.push({ name, valueA: va, valueB: vb });
  }
  return { configA: a, configB: b, suppressedInA: supA, suppressedInB: supB, paramDeltas: deltas };
}

// ── Validation ───────────────────────────────────────────────

export interface ValidationIssue {
  configName: string;
  message: string;
  severity: 'error' | 'warn';
}

export function validateModel(model: PartModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const masterIds = new Set(model.features.map(f => f.id));
  const masterParams = new Set(model.parameters.keys());
  for (const cfg of model.configurations) {
    // All feature overrides reference master features.
    for (const id of cfg.featureOverrides.keys()) {
      if (!masterIds.has(id)) {
        issues.push({ configName: cfg.name, severity: 'error', message: `Override references unknown feature ${id}.` });
      }
    }
    for (const name of cfg.parameterOverrides.keys()) {
      if (!masterParams.has(name)) {
        issues.push({ configName: cfg.name, severity: 'error', message: `Parameter override "${name}" not in master.` });
      }
    }
    // Parent must exist.
    if (cfg.parent && !model.configurations.some(c => c.name === cfg.parent)) {
      issues.push({ configName: cfg.name, severity: 'error', message: `Parent config "${cfg.parent}" not found.` });
    }
  }
  // Detect parent cycles.
  for (const cfg of model.configurations) {
    if (hasCycle(model, cfg.name)) {
      issues.push({ configName: cfg.name, severity: 'error', message: 'Parent inheritance cycle detected.' });
    }
  }
  return issues;
}

function hasCycle(model: PartModel, start: string): boolean {
  const seen = new Set<string>();
  let cur: string | null = start;
  while (cur !== null) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    const cfg = model.configurations.find(c => c.name === cur);
    cur = cfg?.parent ?? null;
    if (cur === '') cur = null;
  }
  return false;
}

// ── Summary ────────────────────────────────────────────────────

export interface ModelSummary {
  featureCount: number;
  parameterCount: number;
  configurationCount: number;
  validationIssueCount: number;
}

export function summarize(model: PartModel): ModelSummary {
  return {
    featureCount: model.features.length,
    parameterCount: model.parameters.size,
    configurationCount: model.configurations.length,
    validationIssueCount: validateModel(model).length,
  };
}
