/**
 * configurationManager.ts — Design variants within a single file.
 *
 * SolidWorks "Configurations" let one model file represent
 * multiple sizes / states without duplicating the geometry. NexyFab
 * equivalent: a base feature pipeline + a set of *configurations*,
 * each overriding parameter values on specific features.
 *
 * Examples:
 *   - "Small / Medium / Large" sizes of a bracket
 *   - "Open / Closed" states of a clamshell
 *   - "Customer A / B variant" with different mounting holes
 *
 * State machine:
 *   - Active configuration: which one's currently applied
 *   - Switching: walks the override map, applies via dispatcher
 *
 * Persistence: configs serialize to nfab file format alongside
 * features. Phase-3 starter keeps in-memory only.
 */

import type { FeatureInstance } from '../features/types';

export interface Configuration {
  id: string;
  name: string;
  /** Optional human description. */
  description?: string;
  /** Map of featureId → paramKey → override value. */
  overrides: Map<string, Map<string, number>>;
  /** Optional feature suppressions per config — these features
   *  are skipped when this config is active. */
  suppressedFeatures: Set<string>;
  /** Parent config — inherited overrides, then merged. */
  parentId?: string;
}

export class ConfigurationManager {
  private configs = new Map<string, Configuration>();
  private activeId: string | null = null;

  /** Add a new configuration. */
  add(config: Omit<Configuration, 'overrides' | 'suppressedFeatures'> & {
    overrides?: Map<string, Map<string, number>>;
    suppressedFeatures?: Set<string>;
  }): Configuration {
    if (this.configs.has(config.id)) {
      throw new Error(`Configuration "${config.id}" already exists`);
    }
    const full: Configuration = {
      id: config.id,
      name: config.name,
      description: config.description,
      overrides: config.overrides ?? new Map(),
      suppressedFeatures: config.suppressedFeatures ?? new Set(),
      parentId: config.parentId,
    };
    this.configs.set(config.id, full);
    if (!this.activeId) this.activeId = config.id;
    return full;
  }

  /** Remove a configuration. */
  remove(id: string): boolean {
    if (this.activeId === id) {
      const next = Array.from(this.configs.keys()).find(k => k !== id);
      this.activeId = next ?? null;
    }
    return this.configs.delete(id);
  }

  /** Set the active configuration. */
  activate(id: string): void {
    if (!this.configs.has(id)) throw new Error(`Unknown config: ${id}`);
    this.activeId = id;
  }

  /** Get active configuration. */
  active(): Configuration | null {
    return this.activeId ? this.configs.get(this.activeId) ?? null : null;
  }

  /** List all configurations. */
  list(): Configuration[] {
    return Array.from(this.configs.values());
  }

  /** Set an override on a configuration. */
  setOverride(configId: string, featureId: string, paramKey: string, value: number): void {
    const c = this.configs.get(configId);
    if (!c) throw new Error(`Unknown config: ${configId}`);
    let featOverrides = c.overrides.get(featureId);
    if (!featOverrides) {
      featOverrides = new Map();
      c.overrides.set(featureId, featOverrides);
    }
    featOverrides.set(paramKey, value);
  }

  /** Remove a specific override. */
  clearOverride(configId: string, featureId: string, paramKey: string): boolean {
    const c = this.configs.get(configId);
    if (!c) return false;
    const featOverrides = c.overrides.get(featureId);
    if (!featOverrides) return false;
    const ok = featOverrides.delete(paramKey);
    if (featOverrides.size === 0) c.overrides.delete(featureId);
    return ok;
  }

  /** Suppress / unsuppress a feature in a config. */
  setSuppressed(configId: string, featureId: string, suppressed: boolean): void {
    const c = this.configs.get(configId);
    if (!c) throw new Error(`Unknown config: ${configId}`);
    if (suppressed) c.suppressedFeatures.add(featureId);
    else c.suppressedFeatures.delete(featureId);
  }

  /** Resolve effective overrides for a config by walking up the
   *  parent chain. Cycles are detected — return what we've gathered. */
  resolveOverrides(configId: string): Map<string, Map<string, number>> {
    const seen = new Set<string>();
    const merged = new Map<string, Map<string, number>>();
    const stack: string[] = [];
    let cur: string | undefined = configId;
    while (cur) {
      if (seen.has(cur)) break;
      seen.add(cur);
      stack.push(cur);
      cur = this.configs.get(cur)?.parentId;
    }
    // Apply root-first so child overrides win.
    for (let i = stack.length - 1; i >= 0; i--) {
      const c = this.configs.get(stack[i]!)!;
      for (const [fid, fparams] of c.overrides) {
        let target = merged.get(fid);
        if (!target) { target = new Map(); merged.set(fid, target); }
        for (const [k, v] of fparams) target.set(k, v);
      }
    }
    return merged;
  }

  /** Apply config's overrides on top of the feature list, returning
   *  the resolved features for the active config. */
  applyConfig(baseFeatures: FeatureInstance[]): FeatureInstance[] {
    const active = this.active();
    if (!active) return baseFeatures.map(f => ({ ...f }));
    const overrides = this.resolveOverrides(active.id);
    const suppressed = this.collectSuppressions(active.id);
    return baseFeatures
      .filter(f => !suppressed.has(f.id))
      .map(f => {
        const ov = overrides.get(f.id);
        if (!ov) return { ...f };
        const newParams = { ...f.params };
        for (const [k, v] of ov) newParams[k] = v;
        return { ...f, params: newParams };
      });
  }

  /** Walk parent chain collecting suppressions. */
  private collectSuppressions(configId: string): Set<string> {
    const result = new Set<string>();
    const seen = new Set<string>();
    let cur: string | undefined = configId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const c = this.configs.get(cur);
      if (!c) break;
      for (const fid of c.suppressedFeatures) result.add(fid);
      cur = c.parentId;
    }
    return result;
  }
}
