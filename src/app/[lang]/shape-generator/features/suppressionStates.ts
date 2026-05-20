/**
 * suppressionStates.ts — Per-configuration feature suppression states.
 *
 * In SolidWorks/Inventor, a part has a feature tree (extrude, hole,
 * fillet, ...) and a set of *configurations* (S/M/L variants of the
 * same part). For each configuration, individual features can be
 * **suppressed** (skipped from the model) or **unsuppressed**. This
 * lets one part definition serve multiple SKUs:
 *
 *   - Long variant: all features on.
 *   - Short variant: trailing extrude + fillet suppressed.
 *   - Mounting-hole variant: holes 1-4 on, holes 5-8 suppressed.
 *
 * The state model:
 *
 *   - **SuppressionState**: per (configurationId, featureId) → boolean.
 *   - **Override inheritance** — a "default" config sets baseline, named
 *     configs only diff from baseline.
 *   - **Group operations** — suppress a tagged group (e.g. all
 *     "decorative-fillets") in one call.
 *
 * The feature-tree resolver applies the active config's suppression
 * before generating geometry.
 */

export interface FeatureSuppression {
  featureId: string;
  /** Suppressed in this configuration? */
  suppressed: boolean;
  /** Source: default inheritance or per-config override. */
  source: 'default' | 'override';
}

export interface SuppressionConfig {
  id: string;
  /** Display name. */
  name: string;
  /** Inherits from another config; null = root. */
  inheritsFrom: string | null;
  /** Explicit overrides for this config: featureId → suppressed. */
  overrides: Map<string, boolean>;
}

export class SuppressionManager {
  private configs = new Map<string, SuppressionConfig>();
  /** Default suppression per feature (used when no config overrides). */
  private defaults = new Map<string, boolean>();
  /** Feature → group tags. */
  private featureTags = new Map<string, Set<string>>();

  // ── Config CRUD ─────────────────────────────────────────────

  createConfig(opts: { id: string; name: string; inheritsFrom?: string | null }): SuppressionConfig {
    const cfg: SuppressionConfig = {
      id: opts.id,
      name: opts.name,
      inheritsFrom: opts.inheritsFrom ?? null,
      overrides: new Map(),
    };
    this.configs.set(cfg.id, cfg);
    return cfg;
  }

  deleteConfig(id: string): void {
    this.configs.delete(id);
    // Re-parent children to null.
    for (const c of this.configs.values()) {
      if (c.inheritsFrom === id) c.inheritsFrom = null;
    }
  }

  getConfig(id: string): SuppressionConfig | null {
    return this.configs.get(id) ?? null;
  }

  listConfigs(): SuppressionConfig[] {
    return [...this.configs.values()];
  }

  // ── Default suppression (applies when no override) ──────────

  setDefaultSuppression(featureId: string, suppressed: boolean): void {
    this.defaults.set(featureId, suppressed);
  }

  getDefaultSuppression(featureId: string): boolean {
    return this.defaults.get(featureId) ?? false;
  }

  // ── Per-config overrides ─────────────────────────────────────

  setOverride(configId: string, featureId: string, suppressed: boolean): void {
    const cfg = this.configs.get(configId);
    if (!cfg) return;
    cfg.overrides.set(featureId, suppressed);
  }

  clearOverride(configId: string, featureId: string): void {
    const cfg = this.configs.get(configId);
    if (!cfg) return;
    cfg.overrides.delete(featureId);
  }

  // ── Resolution (walks inheritance) ──────────────────────────

  /** Resolve the suppression for a feature in a given config, walking
   *  the inheritance chain. */
  resolve(configId: string | null, featureId: string): FeatureSuppression {
    let cfg = configId ? this.configs.get(configId) : null;
    while (cfg) {
      const override = cfg.overrides.get(featureId);
      if (override !== undefined) {
        return { featureId, suppressed: override, source: 'override' };
      }
      cfg = cfg.inheritsFrom ? this.configs.get(cfg.inheritsFrom) ?? null : null;
    }
    return {
      featureId,
      suppressed: this.defaults.get(featureId) ?? false,
      source: 'default',
    };
  }

  /** Resolve every feature for a config. */
  resolveAll(configId: string | null, featureIds: string[]): Map<string, FeatureSuppression> {
    const map = new Map<string, FeatureSuppression>();
    for (const fid of featureIds) {
      map.set(fid, this.resolve(configId, fid));
    }
    return map;
  }

  /** Active (non-suppressed) feature ids. */
  activeFeatures(configId: string | null, featureIds: string[]): string[] {
    return featureIds.filter(fid => !this.resolve(configId, fid).suppressed);
  }

  // ── Tag-based group ops ──────────────────────────────────────

  tagFeature(featureId: string, ...tags: string[]): void {
    const set = this.featureTags.get(featureId) ?? new Set<string>();
    for (const t of tags) set.add(t);
    this.featureTags.set(featureId, set);
  }

  untagFeature(featureId: string, tag: string): void {
    this.featureTags.get(featureId)?.delete(tag);
  }

  /** Suppress all features with the given tag in a config. */
  suppressByTag(configId: string, tag: string, suppressed: boolean): number {
    const cfg = this.configs.get(configId);
    if (!cfg) return 0;
    let count = 0;
    for (const [fid, tags] of this.featureTags) {
      if (tags.has(tag)) {
        cfg.overrides.set(fid, suppressed);
        count++;
      }
    }
    return count;
  }

  // ── Diff between configs ─────────────────────────────────────

  /** Features that differ between two configs (active in A, suppressed in B, or vice-versa). */
  diff(configA: string, configB: string, featureIds: string[]): {
    onlyInA: string[];
    onlyInB: string[];
    bothActive: string[];
    bothSuppressed: string[];
  } {
    const onlyInA: string[] = [];
    const onlyInB: string[] = [];
    const bothActive: string[] = [];
    const bothSuppressed: string[] = [];
    for (const fid of featureIds) {
      const aSup = this.resolve(configA, fid).suppressed;
      const bSup = this.resolve(configB, fid).suppressed;
      if (aSup && bSup) bothSuppressed.push(fid);
      else if (!aSup && !bSup) bothActive.push(fid);
      else if (!aSup) onlyInA.push(fid);
      else onlyInB.push(fid);
    }
    return { onlyInA, onlyInB, bothActive, bothSuppressed };
  }

  // ── Serialization ───────────────────────────────────────────

  serialize(): SerializedSuppression {
    return {
      version: 1,
      defaults: [...this.defaults],
      configs: [...this.configs.values()].map(c => ({
        id: c.id,
        name: c.name,
        inheritsFrom: c.inheritsFrom,
        overrides: [...c.overrides],
      })),
      tags: [...this.featureTags].map(([fid, set]) => ({ featureId: fid, tags: [...set] })),
    };
  }

  load(data: SerializedSuppression): void {
    if (data.version !== 1) throw new Error(`Unsupported version ${data.version}`);
    this.configs.clear();
    this.defaults.clear();
    this.featureTags.clear();
    for (const [fid, sup] of data.defaults) this.defaults.set(fid, sup);
    for (const c of data.configs) {
      this.configs.set(c.id, {
        id: c.id, name: c.name, inheritsFrom: c.inheritsFrom,
        overrides: new Map(c.overrides),
      });
    }
    for (const t of data.tags) this.featureTags.set(t.featureId, new Set(t.tags));
  }
}

export interface SerializedSuppression {
  version: number;
  defaults: Array<[string, boolean]>;
  configs: Array<{
    id: string;
    name: string;
    inheritsFrom: string | null;
    overrides: Array<[string, boolean]>;
  }>;
  tags: Array<{ featureId: string; tags: string[] }>;
}

// ── Summary ─────────────────────────────────────────────────────

export interface SuppressionSummary {
  configCount: number;
  totalOverrides: number;
  taggedFeatureCount: number;
  inheritanceDepth: number;
}

export function summarize(manager: SuppressionManager): SuppressionSummary {
  const configs = manager.listConfigs();
  let depth = 0;
  for (const c of configs) {
    let d = 0;
    let cur = c;
    while (cur.inheritsFrom) {
      const parent = manager.getConfig(cur.inheritsFrom);
      if (!parent) break;
      d++;
      cur = parent;
      if (d > 100) break; // safety
    }
    if (d > depth) depth = d;
  }
  return {
    configCount: configs.length,
    totalOverrides: configs.reduce((s, c) => s + c.overrides.size, 0),
    taggedFeatureCount: 0,
    inheritanceDepth: depth,
  };
}
