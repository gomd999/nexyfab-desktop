/**
 * ConfigStore.ts — adapter that gives one API for both
 * "local in-memory ConfigurationTable" and "Y.Doc-backed ConfigurationTable".
 *
 * Wave 2 Phase 2 Track A Week 5 (A5).
 *
 * The two modes:
 *
 *   - **local mode** — wraps an in-memory `ConfigurationTable` directly.
 *     Same semantics as today's A2 runtime. Used in offline single-user
 *     sessions and pre-collab tabs. Mutations go straight to the table.
 *
 *   - **Yjs mode** — wraps a `Y.Doc`. Every mutation is routed through
 *     `applyConfigOp` so it lands inside a single Y transact (CRDT
 *     consistency). Reads are computed by re-reading the doc and
 *     reconstructing a `ConfigurationTable` snapshot — this keeps the
 *     resolve / parentChain / diff code paths unchanged.
 *
 * Both modes expose the same `ConfigStore` interface, which is a strict
 * subset of `ConfigurationTable`'s surface — the methods the host pipeline
 * actually calls (see `ShapeGeneratorInner.tsx`). Anything the host
 * doesn't call (eg. raw `getOverride` for the per-feature debug panel) is
 * still reachable via `getTable()` for tests and tooling.
 *
 * **Why an adapter instead of inserting Yjs into ConfigurationTable?**
 * - A2 finalised the ConfigurationTable class. Touching it risks breaking
 *   the 155 W4 tests (master tracker constraint).
 * - The class itself is pure (no Yjs imports). Keeping it that way means
 *   .nfab v3 codec, validateModel, diffConfigs all stay synchronous and
 *   testable without a Y.Doc instance.
 * - The adapter is small (~250 lines), the Yjs-side reads/writes are
 *   already in configStoreYjs.ts.
 *
 * **Yjs read strategy:** on every Y.Doc update event we rebuild the
 * underlying `ConfigurationTable` from the doc snapshot. This is O(N
 * configs) but N is small (UI hint is 50 configs max in the spec; soak
 * test goes to 150 ops total). Worst-case soak overhead is ~150 rebuilds
 * × ~50 configs × 5 features = trivial vs. an OCCT pipeline tick.
 */

import * as Y from 'yjs';
import { ConfigurationTable, type ConfigurationTableSnapshot } from './ConfigurationTable';
import type { ConfigEntry, ConfigOpResult, MasterFeatures } from './types';
import type { FeatureInstance } from '../features/types';
import {
  applyConfigOp,
  readActiveConfigId,
  readAllConfigs,
  readGlobalVars,
  populateDoc,
} from './configStoreYjs';

/** The minimum API the host pipeline + UI needs from a config store. Both
 *  local and Yjs modes implement this. */
export interface ConfigStore {
  /** Is this store backed by a Y.Doc (collab) or just in-memory (offline)? */
  readonly mode: 'local' | 'yjs';

  /** List all configs in insertion order. */
  list(): ConfigEntry[];

  /** Lookup by id. */
  get(id: string): ConfigEntry | null;

  /** Add a new config (auto-id if no opts.id). Returns the created entry. */
  add(name: string, opts?: { id?: string; parentId?: string }): ConfigEntry;

  /** Remove by id; returns true on success. */
  remove(id: string): boolean;

  /** Rename. */
  rename(id: string, name: string): boolean;

  /** Activate one config (null = master). */
  activate(id: string | null): boolean;

  /** Get the active config entry; null when in master mode. */
  getActive(): ConfigEntry | null;

  /** Cheaper active-id getter. */
  getActiveId(): string | null;

  /** Set parent (with cycle detection). */
  setParent(id: string, parentId: string | null): ConfigOpResult;

  /** Set a single per-feature param override. */
  setOverride(configId: string, featureId: string, paramKey: string, value: number | string): boolean;

  /** Clear a single per-feature param override. */
  clearOverride(configId: string, featureId: string, paramKey: string): boolean;

  /** Suppress a feature in a config. */
  setSuppressed(configId: string, featureId: string, suppressed: boolean): boolean;

  /** Set a config-scoped expression variable. */
  setExpressionVar(configId: string, name: string, value: number | string): boolean;

  /** Set a table-wide global var. */
  setGlobalVar(name: string, value: number | string): void;

  /** Read-only global var snapshot. */
  getGlobalVars(): Record<string, number | string>;

  /** Resolve the master feature list against the active config. */
  resolveActive(features: MasterFeatures): FeatureInstance[];

  /** Get an underlying ConfigurationTable instance (always fresh in yjs
   *  mode, the wrapped one in local mode). Tests + tooling only. */
  getTable(): ConfigurationTable;

  /** Snapshot the whole store as JSON. */
  toJSON(): ConfigurationTableSnapshot;

  /** Subscribe to changes (any mutation). Used by host components that
   *  want to re-render when the underlying state changes. Returns
   *  unsubscribe. */
  subscribe(listener: () => void): () => void;

  /** For Yjs mode only — the underlying doc. Useful for transport hooks. */
  getDoc?(): Y.Doc;
}

// ─── Local mode ────────────────────────────────────────────────────────────

class LocalConfigStore implements ConfigStore {
  readonly mode = 'local' as const;
  private table: ConfigurationTable;
  private listeners = new Set<() => void>();

  constructor(initial?: ConfigurationTable | ConfigurationTableSnapshot) {
    if (initial === undefined) {
      this.table = new ConfigurationTable();
    } else if (initial instanceof ConfigurationTable) {
      this.table = initial;
    } else {
      this.table = ConfigurationTable.fromJSON(initial);
    }
  }

  list(): ConfigEntry[] { return this.table.list(); }
  get(id: string): ConfigEntry | null { return this.table.get(id); }

  add(name: string, opts?: { id?: string; parentId?: string }): ConfigEntry {
    const e = this.table.add(name, opts);
    this.notify();
    return e;
  }
  remove(id: string): boolean {
    const ok = this.table.remove(id);
    if (ok) this.notify();
    return ok;
  }
  rename(id: string, name: string): boolean {
    const ok = this.table.rename(id, name);
    if (ok) this.notify();
    return ok;
  }
  activate(id: string | null): boolean {
    const ok = this.table.activate(id);
    if (ok) this.notify();
    return ok;
  }
  getActive(): ConfigEntry | null { return this.table.getActive(); }
  getActiveId(): string | null { return this.table.getActiveId(); }

  setParent(id: string, parentId: string | null): ConfigOpResult {
    const r = this.table.setParent(id, parentId);
    if (r.ok) this.notify();
    return r;
  }
  setOverride(configId: string, featureId: string, paramKey: string, value: number | string): boolean {
    const ok = this.table.setOverride(configId, featureId, paramKey, value);
    if (ok) this.notify();
    return ok;
  }
  clearOverride(configId: string, featureId: string, paramKey: string): boolean {
    const ok = this.table.clearOverride(configId, featureId, paramKey);
    if (ok) this.notify();
    return ok;
  }
  setSuppressed(configId: string, featureId: string, suppressed: boolean): boolean {
    const ok = this.table.setSuppressed(configId, featureId, suppressed);
    if (ok) this.notify();
    return ok;
  }
  setExpressionVar(configId: string, name: string, value: number | string): boolean {
    const ok = this.table.setExpressionVar(configId, name, value);
    if (ok) this.notify();
    return ok;
  }
  setGlobalVar(name: string, value: number | string): void {
    this.table.setGlobalVar(name, value);
    this.notify();
  }
  getGlobalVars(): Record<string, number | string> { return this.table.getGlobalVars(); }
  resolveActive(features: MasterFeatures): FeatureInstance[] { return this.table.resolveActive(features); }
  getTable(): ConfigurationTable { return this.table; }
  toJSON(): ConfigurationTableSnapshot { return this.table.toJSON(); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

// ─── Yjs mode ──────────────────────────────────────────────────────────────

class YjsConfigStore implements ConfigStore {
  readonly mode = 'yjs' as const;
  private doc: Y.Doc;
  private listeners = new Set<() => void>();
  private observer: (() => void) | null = null;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    // Subscribe to ANY change on the doc — listeners only care that
    // something moved.
    const handler = () => this.notify();
    doc.on('update', handler);
    this.observer = () => doc.off('update', handler);
  }

  // ── Reads — rebuild ConfigurationTable from doc on each call ────────────
  //
  // Cheap at sketch scale (50 configs × tens of features). We deliberately
  // do NOT cache here — caching invalidation under concurrent Y updates is
  // the same class of bug as the configurations corruption fix from
  // masterSnapshot.ts. Recompute is the safe default.

  private snapshotTable(): ConfigurationTable {
    return ConfigurationTable.fromJSON({
      configs: readAllConfigs(this.doc),
      activeConfigId: readActiveConfigId(this.doc),
      globalVars: readGlobalVars(this.doc),
    });
  }

  list(): ConfigEntry[] { return readAllConfigs(this.doc); }
  get(id: string): ConfigEntry | null {
    return readAllConfigs(this.doc).find(e => e.id === id) ?? null;
  }

  add(name: string, opts?: { id?: string; parentId?: string }): ConfigEntry {
    const id = opts?.id ?? this.nextId();
    const entry: ConfigEntry = {
      id,
      name,
      parentId: opts?.parentId,
      overrides: {},
      expressionVars: {},
    };
    applyConfigOp(this.doc, { kind: 'addConfig', entry });
    return entry;
  }
  remove(id: string): boolean {
    const r = applyConfigOp(this.doc, { kind: 'removeConfig', id });
    return r.applied;
  }
  rename(id: string, name: string): boolean {
    const r = applyConfigOp(this.doc, { kind: 'renameConfig', id, name });
    return r.applied;
  }
  activate(id: string | null): boolean {
    const r = applyConfigOp(this.doc, { kind: 'setActive', id });
    return r.applied;
  }
  getActive(): ConfigEntry | null {
    const id = readActiveConfigId(this.doc);
    return id ? this.get(id) : null;
  }
  getActiveId(): string | null { return readActiveConfigId(this.doc); }

  setParent(id: string, parentId: string | null): ConfigOpResult {
    // Mirror ConfigurationTable.setParent's diagnostic-rich result so
    // callers can render the cycle path. The Y-side cycle check uses
    // the same depSolver routine.
    if (!this.has(id)) return { ok: false, error: 'unknown_config' };
    if (parentId !== null && !this.has(parentId)) return { ok: false, error: 'unknown_parent' };
    if (parentId === id) return { ok: false, error: 'cycle', cyclePath: [id, id] };
    const r = applyConfigOp(this.doc, { kind: 'setParent', id, parentId });
    if (r.applied) return { ok: true };
    if (r.notes?.includes('cycle')) {
      // Reconstruct the cycle path for the UI.
      const path = this.findParentChainTo(parentId!, id);
      return { ok: false, error: 'cycle', cyclePath: path };
    }
    return { ok: false, error: 'unknown_config' };
  }

  setOverride(configId: string, featureId: string, paramKey: string, value: number | string): boolean {
    const r = applyConfigOp(this.doc, { kind: 'setOverride', configId, featureId, paramKey, value });
    return r.applied;
  }
  clearOverride(configId: string, featureId: string, paramKey: string): boolean {
    const r = applyConfigOp(this.doc, { kind: 'clearOverride', configId, featureId, paramKey });
    return r.applied;
  }
  setSuppressed(configId: string, featureId: string, suppressed: boolean): boolean {
    const r = applyConfigOp(this.doc, { kind: 'setSuppressed', configId, featureId, suppressed });
    return r.applied;
  }
  setExpressionVar(configId: string, name: string, value: number | string): boolean {
    const r = applyConfigOp(this.doc, { kind: 'setExpressionVar', configId, varName: name, value });
    return r.applied;
  }
  setGlobalVar(name: string, value: number | string): void {
    applyConfigOp(this.doc, { kind: 'setGlobalVar', name, value });
  }
  getGlobalVars(): Record<string, number | string> { return readGlobalVars(this.doc); }

  resolveActive(features: MasterFeatures): FeatureInstance[] {
    // Reconstruct the table on demand — keeps the proven resolution path.
    return this.snapshotTable().resolveActive(features);
  }

  getTable(): ConfigurationTable { return this.snapshotTable(); }
  toJSON(): ConfigurationTableSnapshot { return this.snapshotTable().toJSON(); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getDoc(): Y.Doc { return this.doc; }

  /** Detach from the doc. Idempotent. */
  dispose(): void {
    if (this.observer) this.observer();
    this.observer = null;
    this.listeners.clear();
  }

  // ── private ─────────────────────────────────────────────────────────────

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private has(id: string): boolean {
    return readAllConfigs(this.doc).some(e => e.id === id);
  }

  private nextId(): string {
    const ids = new Set(readAllConfigs(this.doc).map(e => e.id));
    for (let i = 0; i < ids.size + 1; i += 1) {
      const id = `cfg-${i}`;
      if (!ids.has(id)) return id;
    }
    /* c8 ignore next */
    return `cfg-${ids.size}`;
  }

  private findParentChainTo(start: string, target: string): readonly string[] {
    const entries = readAllConfigs(this.doc);
    const byId = new Map(entries.map(e => [e.id, e]));
    const path: string[] = [];
    let cur: string | undefined = start;
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      path.push(cur);
      seen.add(cur);
      if (cur === target) break;
      cur = byId.get(cur)?.parentId;
    }
    return [target, ...path];
  }
}

// ─── Factory + migration ───────────────────────────────────────────────────

/** Construct a local-mode store (no Y.Doc). Mirrors `new ConfigurationTable()`. */
export const ConfigStore = {
  local(initial?: ConfigurationTable | ConfigurationTableSnapshot): ConfigStore {
    return new LocalConfigStore(initial);
  },

  /** Construct a Yjs-mode store backed by the given doc. */
  fromYDoc(doc: Y.Doc): ConfigStore {
    return new YjsConfigStore(doc);
  },
};

/** Hot-swap from local mode to Yjs mode without losing state. Writes the
 *  whole local snapshot into the provided doc in one transact. The
 *  resulting `ConfigStore` is a fresh Yjs-mode store wrapping `doc`. */
export function migrateToYjs(local: ConfigStore, doc: Y.Doc): ConfigStore {
  if (local.mode !== 'local') {
    throw new Error('[ConfigStore] migrateToYjs: source store must be in local mode');
  }
  const snap = local.toJSON();
  populateDoc(doc, snap);
  return ConfigStore.fromYDoc(doc);
}

/** Internal type guard for tests/tooling that need to call `.dispose()`. */
export function disposeYjsStore(store: ConfigStore): void {
  if (store.mode === 'yjs') {
    (store as unknown as { dispose: () => void }).dispose();
  }
}
