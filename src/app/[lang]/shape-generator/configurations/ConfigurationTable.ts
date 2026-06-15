/**
 * ConfigurationTable.ts — runtime class managing a list of named
 * configurations (parametric part variants).
 *
 * Wave 2 Phase 2 Track A Week 2 (A2). Pure runtime — no React, no
 * Yjs, no pipeline wire-in. The host/UI/pipeline integrations land in
 * A3 (W3) and later.
 *
 * Replaces both `config/configurationManager.ts` (runtime "B") and
 * `assembly/multiConfigPartVariant.ts` (runtime "C") with a single,
 * JSON-serialisable runtime backed by plain objects (spec §3.1 "Why
 * not Maps?").
 *
 * **Resolution model (spec §5 + §4.2):**
 *
 * 1. Start with the master feature list (caller passes it in).
 * 2. Walk the active config's parent chain *root → leaf*.
 * 3. For each link in the chain, layer its overrides on top — last
 *    write wins per `(featureId, paramKey)` and per `featureId`
 *    suppress flag. Feature defaults survive when neither parent nor
 *    child overrides them.
 * 4. Suppressed features are dropped from the resolved list.
 *
 * **Cycle handling (spec §4.3, §13.1):**
 *
 * `setParent` refuses to install a parent that would create a cycle
 * (returns `{ ok: false, error: 'cycle' }`). Cycle detection reuses
 * `referenceGeometry/depSolver.wouldCreateCycle` so the algorithm is
 * exercised by the ref-geom tests too. We model the parent chain as a
 * dep graph where each config's `dependsOn = [parentId]` (≤1 dep).
 *
 * **Out of scope for A2:**
 *
 *   - Expression evaluation (A3 — wires EquationManager into
 *     `resolveActive`).
 *   - `.nfab` v3 round-trip (A3).
 *   - Yjs backing store (A5 — DI seam in spec §9.4).
 *   - UI (A4).
 *
 * Anything string-typed in `params: Record<string, number | string>`
 * is passed through to the resolved feature unchanged. The pipeline
 * cast at `FeatureInstance.params` is satisfied at runtime today only
 * for literal-number overrides; A3 will lower expressions to numbers
 * before this point. Tests use literal numbers exclusively.
 */

import { wouldCreateCycle, type DepGraph } from '../referenceGeometry/depSolver';
import { EquationManager } from '../equations/equationManager';
import type { FeatureInstance } from '../features/types';
import type {
  ConfigEntry,
  ConfigOpResult,
  ConfigOverride,
  MasterFeatures,
} from './types';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class ConfigurationTable {
  private entries = new Map<string, ConfigEntry>();
  private activeId: string | null = null;
  private globalVars: Record<string, number | string> = {};

  /** Generate a stable id for a new config. Format: `cfg-{n}` where n
   *  is the smallest non-negative integer not currently in use. We
   *  deliberately avoid timestamps / `Math.random()` so unit tests are
   *  deterministic. */
  private nextId(): string {
    for (let i = 0; i < this.entries.size + 1; i += 1) {
      const id = `cfg-${i}`;
      if (!this.entries.has(id)) return id;
    }
    // Unreachable: loop guaranteed to find a slot.
    /* c8 ignore next */
    return `cfg-${this.entries.size}`;
  }

  // ── List / inspect ─────────────────────────────────────────────

  /** Snapshot the current entries in insertion order. Returned
   *  objects are shallow-frozen clones — callers should not mutate. */
  list(): ConfigEntry[] {
    return Array.from(this.entries.values()).map(cloneEntry);
  }

  /** Lookup by id; `null` when missing (mirrors `Map.get` semantics
   *  but with a clearer signature). */
  get(id: string): ConfigEntry | null {
    const e = this.entries.get(id);
    return e ? cloneEntry(e) : null;
  }

  /** Convenience — id-only set, useful for parent dropdowns. */
  ids(): string[] {
    return Array.from(this.entries.keys());
  }

  // ── Mutate: add / remove / rename ─────────────────────────────

  /** Add a new configuration. Optionally accepts a pre-baked entry
   *  (e.g. on `.nfab` load); without one a blank entry is created. */
  add(name: string, opts?: { id?: string; parentId?: string }): ConfigEntry {
    const id = opts?.id ?? this.nextId();
    if (this.entries.has(id)) {
      throw new Error(`ConfigurationTable: id "${id}" already exists`);
    }
    const entry: ConfigEntry = {
      id,
      name,
      parentId: opts?.parentId,
      overrides: {},
      expressionVars: {},
    };
    this.entries.set(id, entry);
    if (this.activeId === null) this.activeId = id;
    return cloneEntry(entry);
  }

  /** Remove a configuration. Children's `parentId` is *cleared* —
   *  inlining of overrides (spec §13.3) is a UI-level decision and
   *  belongs in A4. Returns `true` on success. */
  remove(id: string): boolean {
    if (!this.entries.has(id)) return false;
    // Detach children — they survive but lose inheritance.
    for (const c of this.entries.values()) {
      if (c.parentId === id) c.parentId = undefined;
    }
    this.entries.delete(id);
    if (this.activeId === id) {
      // Pick the first remaining entry, else `null` (master).
      const next = this.entries.keys().next();
      this.activeId = next.done ? null : next.value;
    }
    return true;
  }

  /** Rename a configuration. Name uniqueness is *not* enforced — two
   *  configs may share a name (ids are the identity). Mirrors
   *  Onshape / SolidWorks behaviour. */
  rename(id: string, name: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    e.name = name;
    return true;
  }

  // ── Active config ──────────────────────────────────────────────

  /** Activate a configuration. Passing `null` activates the *master*
   *  (no overlay). Returns `false` if `id` doesn't exist. */
  activate(id: string | null): boolean {
    if (id === null) {
      this.activeId = null;
      return true;
    }
    if (!this.entries.has(id)) return false;
    this.activeId = id;
    return true;
  }

  /** Get the active config entry; `null` for master. */
  getActive(): ConfigEntry | null {
    if (this.activeId === null) return null;
    const e = this.entries.get(this.activeId);
    return e ? cloneEntry(e) : null;
  }

  /** Get the active id directly (cheaper than `getActive()` when the
   *  caller only needs the id). */
  getActiveId(): string | null {
    return this.activeId;
  }

  // ── Mutate: parent / cycle detection ──────────────────────────

  /** Reparent a config. Refuses (returns `{ ok: false, error: 'cycle' }`)
   *  if the new parent reaches the child along the existing parent
   *  graph, which would close a loop. Pass `null` to detach. */
  setParent(id: string, parentId: string | null): ConfigOpResult {
    const e = this.entries.get(id);
    if (!e) return { ok: false, error: 'unknown_config' };
    if (parentId === null) {
      e.parentId = undefined;
      return { ok: true };
    }
    if (!this.entries.has(parentId)) {
      return { ok: false, error: 'unknown_parent' };
    }
    if (parentId === id) {
      // Self-loop is the trivial cycle. Surface the path explicitly so
      // the UI can render `id → id`.
      return { ok: false, error: 'cycle', cyclePath: [id, id] };
    }
    // Use depSolver's reachability check. Build a graph where each
    // config "depends on" its parent (≤1 dep). We test whether
    // `id`'s new dep list `[parentId]` would create a cycle.
    const graph = this.buildParentGraph();
    if (wouldCreateCycle(graph, id, [parentId])) {
      // Reconstruct the cycle path for the UI: walk parentId's chain
      // until we hit `id`, then close the loop.
      const cyclePath = this.findParentChainTo(parentId, id);
      return { ok: false, error: 'cycle', cyclePath };
    }
    e.parentId = parentId;
    return { ok: true };
  }

  /** Build the parent dep graph (id → [parentId]) for depSolver. */
  private buildParentGraph(): DepGraph {
    const g = new Map<string, readonly string[]>();
    for (const [id, entry] of this.entries) {
      g.set(id, entry.parentId !== undefined ? [entry.parentId] : []);
    }
    return g;
  }

  /** Walk the parent chain from `start` collecting ids until we hit
   *  `target`; returns `[target, ..., start, target]` (closed). Used
   *  only for the cycle-path UI hint after `wouldCreateCycle` agrees
   *  there is one. */
  private findParentChainTo(start: string, target: string): readonly string[] {
    const path: string[] = [];
    let cur: string | undefined = start;
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      path.push(cur);
      seen.add(cur);
      if (cur === target) break;
      cur = this.entries.get(cur)?.parentId;
    }
    // Close the loop with `target → … → start → target` for the UI.
    return [target, ...path];
  }

  // ── Mutate: overrides ─────────────────────────────────────────

  /** Set a single per-feature param override on a config. Use the
   *  literal `'__suppressed__'` key to flip the suppress flag instead
   *  of writing into `params`. We expose suppression as a separate
   *  method below; the keyed form is reserved for the v3 codec. */
  setOverride(
    configId: string,
    featureId: string,
    paramKey: string,
    value: number | string,
  ): boolean {
    const e = this.entries.get(configId);
    if (!e) return false;
    let slot = e.overrides[featureId];
    if (!slot) {
      slot = {};
      e.overrides[featureId] = slot;
    }
    if (!slot.params) slot.params = {};
    slot.params[paramKey] = value;
    return true;
  }

  /** Clear a single per-feature param override. When the param dict
   *  drains the override slot is *not* deleted — the suppress flag may
   *  still be set. A cleanly empty slot (no params + no suppress) is
   *  removed on the next save (spec §13.4). */
  clearOverride(configId: string, featureId: string, paramKey: string): boolean {
    const e = this.entries.get(configId);
    if (!e) return false;
    const slot = e.overrides[featureId];
    if (!slot || !slot.params) return false;
    if (!(paramKey in slot.params)) return false;
    delete slot.params[paramKey];
    if (Object.keys(slot.params).length === 0) delete slot.params;
    if (isOverrideEmpty(slot)) delete e.overrides[featureId];
    return true;
  }

  /** Suppress / unsuppress a feature in a config. Returns `true` if
   *  the entry exists; `false` for unknown configs. */
  setSuppressed(configId: string, featureId: string, suppressed: boolean): boolean {
    const e = this.entries.get(configId);
    if (!e) return false;
    let slot = e.overrides[featureId];
    if (!slot) {
      slot = {};
      e.overrides[featureId] = slot;
    }
    slot.suppressed = suppressed;
    return true;
  }

  /** Lookup helper — current effective override slot for a config +
   *  feature *without* parent resolution. Returns a clone. Null when
   *  no override exists. */
  getOverride(configId: string, featureId: string): ConfigOverride | null {
    const e = this.entries.get(configId);
    if (!e) return null;
    const slot = e.overrides[featureId];
    if (!slot) return null;
    return cloneOverride(slot);
  }

  // ── Expression / global vars (storage only in A2) ──────────────

  /** Set a config-scoped expression variable. A3 wires this into
   *  `resolveActive` for evaluation. */
  setExpressionVar(configId: string, name: string, value: number | string): boolean {
    const e = this.entries.get(configId);
    if (!e) return false;
    e.expressionVars[name] = value;
    return true;
  }

  /** Set a table-wide global variable. Shadows the EquationManager
   *  table when active (resolution priority order per spec §4.2). */
  setGlobalVar(name: string, value: number | string): void {
    this.globalVars[name] = value;
  }

  /** Read-only snapshot of global vars. */
  getGlobalVars(): Record<string, number | string> {
    return { ...this.globalVars };
  }

  // ── Resolution ────────────────────────────────────────────────

  /** Resolve the master feature list against the active config. When
   *  no config is active the master is returned (shallow-cloned so
   *  callers can't mutate our state).
   *
   *  Spec §5: master tree is NEVER mutated by a config switch; the
   *  returned list is a fresh array of fresh `FeatureInstance` clones.
   *
   *  Expression resolution is deferred to A3 — string-typed param
   *  values are coerced to `number` via `Number(v)`, producing `NaN`
   *  on non-numeric strings. The pipeline's existing NaN diagnostic
   *  surfaces this. Tests in A2 use literal numbers exclusively.
   */
  resolveActive(features: MasterFeatures): FeatureInstance[] {
    if (this.activeId === null) {
      return features.map(f => cloneFeature(f));
    }
    return this.getResolved(this.activeId, features);
  }

  /** Resolve a specific config (not necessarily the active one).
   *  Returns master features when `configId` is unknown — same
   *  fallback as `resolveConfig` in `multiConfigPartVariant`. */
  getResolved(configId: string, features: MasterFeatures): FeatureInstance[] {
    const chain = this.parentChain(configId);
    if (chain.length === 0) {
      // Unknown id — return master so the pipeline still produces a
      // result instead of NaN-ing on a missing config.
      return features.map(f => cloneFeature(f));
    }
    // Build a flattened (featureId → ConfigOverride) by walking root → leaf.
    const merged = new Map<string, ConfigOverride>();
    for (const cfg of chain) {
      for (const [featureId, slot] of Object.entries(cfg.overrides)) {
        const existing = merged.get(featureId);
        if (!existing) {
          merged.set(featureId, cloneOverride(slot));
        } else {
          // Layer last-write-wins per key. Suppress flag override only
          // when explicitly set (`undefined` means "no opinion").
          if (slot.suppressed !== undefined) existing.suppressed = slot.suppressed;
          if (slot.params) {
            existing.params = { ...(existing.params ?? {}), ...slot.params };
          }
        }
      }
    }
    // A3: build the equation context (table-wide globalVars + chain-merged
    // config expressionVars) so a string override like "2*width + 5" lowers to
    // a number instead of NaN-ing through Number().
    const em = this.buildEquationManager(chain);
    const evalParam = (v: number | string): number => {
      if (typeof v === 'number') return v;
      try {
        const n = em.evaluateExpression(v);
        return Number.isFinite(n) ? n : Number(v); // unknown vars → fall back
      } catch {
        return Number(v); // parse error → old A2 coercion
      }
    };

    // Project onto features. Suppressed features drop out.
    const out: FeatureInstance[] = [];
    for (const f of features) {
      const ov = merged.get(f.id);
      if (ov?.suppressed) continue;
      if (!ov || !ov.params) {
        out.push(cloneFeature(f));
        continue;
      }
      const newParams: Record<string, number> = { ...f.params };
      for (const [k, v] of Object.entries(ov.params)) {
        newParams[k] = evalParam(v);
      }
      out.push({ ...cloneFeature(f), params: newParams });
    }
    return out;
  }

  /**
   * A3: seed an EquationManager with the table-wide `globalVars` + the config
   * chain's `expressionVars` (root → leaf, so a leaf can shadow a root). The
   * EquationManager owns the dependency DAG + cycle detection; a var with an
   * invalid name or a cyclic expression is skipped (best-effort) rather than
   * failing the whole resolve.
   */
  private buildEquationManager(chain: ConfigEntry[]): EquationManager {
    const em = new EquationManager();
    const seed = (name: string, value: number | string): void => {
      if (!IDENT_RE.test(name)) return; // EquationManager rejects invalid names
      try { em.set(name, String(value)); } catch { /* cycle / parse error — skip this var */ }
    };
    for (const [name, value] of Object.entries(this.globalVars)) seed(name, value);
    for (const cfg of chain) {
      for (const [name, value] of Object.entries(cfg.expressionVars)) seed(name, value);
    }
    return em;
  }

  /** Walk a config's parent chain root → leaf. Returns `[]` when the
   *  start id is unknown. Cycle-safe (defensive — `setParent` already
   *  refuses cycles, but a hand-crafted JSON load could slip one in;
   *  see A3's `validateModel`). */
  parentChain(configId: string): ConfigEntry[] {
    const out: ConfigEntry[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = configId;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const e = this.entries.get(cur);
      if (!e) {
        // Mid-chain missing parent → stop and return what we have. If
        // this is the start (out is empty), we'll return [] — the
        // contract "unknown id means master".
        break;
      }
      out.unshift(e);  // root-first ordering
      cur = e.parentId;
    }
    return out;
  }

  // ── Serialisation (for A3's .nfab v3 codec) ───────────────────

  /** Plain-object snapshot. JSON-safe; ready for spec §9.4 Y-backed
   *  store DI in A5. */
  toJSON(): ConfigurationTableSnapshot {
    return {
      configs: this.list(),
      activeConfigId: this.activeId,
      globalVars: { ...this.globalVars },
    };
  }

  /** Restore from a snapshot. Used by the .nfab v3 codec (A3) and the
   *  Y-backed store (A5). Skips entries whose `parentId` is missing —
   *  matches `nfabFormat.normalizeConfigurations`'s drop-malformed
   *  forward-compat policy. */
  static fromJSON(snap: ConfigurationTableSnapshot): ConfigurationTable {
    const t = new ConfigurationTable();
    for (const c of snap.configs) {
      t.entries.set(c.id, cloneEntry(c));
    }
    // Drop dangling parentIds (defensive — should be caught by
    // validateModel but the codec is a separate path).
    for (const e of t.entries.values()) {
      if (e.parentId !== undefined && !t.entries.has(e.parentId)) {
        e.parentId = undefined;
      }
    }
    t.activeId = snap.activeConfigId !== null && t.entries.has(snap.activeConfigId)
      ? snap.activeConfigId
      : null;
    t.globalVars = { ...snap.globalVars };
    return t;
  }
}

/** JSON-serialisable snapshot of a `ConfigurationTable` instance. */
export interface ConfigurationTableSnapshot {
  configs: ConfigEntry[];
  activeConfigId: string | null;
  globalVars: Record<string, number | string>;
}

// ── Helpers (file-local) ──────────────────────────────────────────

function cloneEntry(e: ConfigEntry): ConfigEntry {
  return {
    id: e.id,
    name: e.name,
    parentId: e.parentId,
    overrides: cloneOverrides(e.overrides),
    expressionVars: { ...e.expressionVars },
  };
}

function cloneOverrides(o: Record<string, ConfigOverride>): Record<string, ConfigOverride> {
  const out: Record<string, ConfigOverride> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = cloneOverride(v);
  }
  return out;
}

function cloneOverride(o: ConfigOverride): ConfigOverride {
  const out: ConfigOverride = {};
  if (o.suppressed !== undefined) out.suppressed = o.suppressed;
  if (o.params) out.params = { ...o.params };
  return out;
}

function cloneFeature(f: FeatureInstance): FeatureInstance {
  return { ...f, params: { ...f.params } };
}

function isOverrideEmpty(o: ConfigOverride): boolean {
  return o.suppressed === undefined && (o.params === undefined || Object.keys(o.params).length === 0);
}
