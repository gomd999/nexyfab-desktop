/**
 * configStoreYjs.ts — Wave 2 Phase 2 Track A Week 5 (A5).
 *
 * Y.Map-backed CRDT layer for the `ConfigurationTable` runtime (A2).
 * Mirrors `collab/sketchYjs.ts` (Phase 1 Week 2) — same pattern, applied
 * to the configurations sub-tree of the doc.
 *
 * Y.Doc structure (spec §9.1, deliberately flattened from the spec's
 * informal sketch — see "Spec ambiguities resolved" below):
 *
 *   Y.Doc
 *   ├── configs:           Y.Map<configId, Y.Map>     ← top-level (one entry per config)
 *   │     └── (one config Y.Map) {
 *   │           id:             string,
 *   │           name:           string,
 *   │           parentId:       string | '' (empty string = no parent),
 *   │           overrideParams: Y.Map<'<featureId>/<paramKey>', number | string>,  ← FLAT, per-key LWW
 *   │           overrideSuppressed: Y.Map<featureId, boolean>,                     ← FLAT, per-feature LWW
 *   │           expressionVars: Y.Map<varName, number | string>,
 *   │         }
 *   ├── configTableMeta:   Y.Map<string, string | null>   ← single-key map for activeConfigId
 *   │     └── activeConfigId: string | null
 *   └── globalVars:        Y.Map<varName, number | string>
 *
 * **Spec ambiguities resolved:**
 *
 * - **Y.Map vs Y.Array for the `configs` root.** The spec §9.1 sketch
 *   shows `Y.Map<configId, ...>`. Two reasons we kept it that way (same
 *   reasoning as sketchYjs.ts:18-26):
 *     - Configs have no inherent ordering — the UI lists them by
 *       insertion order, which Y.Map preserves via the underlying
 *       struct-store sequence. Y.Array would force a position which
 *       concurrent adds dedupe poorly.
 *     - "Add config with id X" on two peers concurrently is set(X, _) +
 *       set(X, _) → LWW on the same key; with Y.Array we'd get TWO
 *       entries for the same id and a manual merge step.
 * - **Flat override params (deviation from spec §9.1).** The spec sketches
 *   a 2-level `Y.Map<featureId, Y.Map<paramKey, value>>`. We discovered
 *   during convergence testing that two peers concurrently setting the
 *   FIRST override on the same featureId would each create a fresh
 *   intermediate Y.Map, then LWW-resolve the slot itself — losing one
 *   peer's params entirely. Flattening to a single `Y.Map<'feat/key', _>`
 *   gives per-(feature,key) LWW the spec actually intends in §9.2 row 2
 *   ("Two users edit same param of same config | LWW on Y.Map value").
 *   Suppress flag gets its own flat `Y.Map<featureId, bool>` for the
 *   same reason.
 * - **`parentId: undefined` mapping.** Yjs values cannot be `undefined`
 *   (the Y.Map serializer rejects it). We map `parentId === undefined`
 *   (no parent) to the empty string `''` on the wire, and translate back
 *   on read. This is symmetric and avoids the JSON-LWW workaround the
 *   sketch CRDT uses for `faceFrame`.
 * - **`activeConfigId` storage.** The spec sketch puts it on a separate
 *   top-level Y.Map (`configTableMeta`). We follow the spec — a sibling
 *   to `configs`. A single-key Y.Map<string, string | null> gives us LWW
 *   on the "current active" with the smallest CRDT footprint. Why not a
 *   nested key on each config entry (e.g. `isActive: true`)? Because then
 *   "switch active from X to Y" requires writing 2 entries inside one
 *   transact, and a concurrent peer could see X with both `isActive:true`
 *   and `isActive:false` mid-merge. The top-level single-key map keeps
 *   activeConfigId atomic.
 *
 * **Origins** (mirror sketchYjs.ts):
 *   - ORIGIN_LOCAL_UI       — user typed in the UI
 *   - ORIGIN_REMOTE_UPDATE  — `Y.applyUpdate` from a peer
 *   - ORIGIN_IMPORT_NFAB    — bootstrap from `.nfab` v3 file load
 *
 * All mutating ops route through `applyConfigOp`, which wraps each op
 * in exactly one `doc.transact()` block. Multi-key writes (e.g. setting
 * `parentId` + `name` together is not a single op — those are separate
 * `setParent` + `renameConfig` ops at the wire level).
 */

import * as Y from 'yjs';
import { wouldCreateCycle, type DepGraph } from '../referenceGeometry/depSolver';
import type { ConfigEntry, ConfigOverride } from './types';

// ─── Shared keys (string constants, kept here as the wire-format contract) ──

const CONFIGS_ROOT_KEY = 'configs';
const META_ROOT_KEY = 'configTableMeta';
const GLOBAL_VARS_ROOT_KEY = 'globalVars';

const META_KEYS = {
  activeConfigId: 'activeConfigId',
} as const;

const CONFIG_FIELDS = {
  id: 'id',
  name: 'name',
  parentId: 'parentId',
  /** Flat key: `<featureId>/<paramKey>` → value. Per-key LWW. */
  overrideParams: 'overrideParams',
  /** Flat key: `<featureId>` → boolean. Per-feature LWW. */
  overrideSuppressed: 'overrideSuppressed',
  expressionVars: 'expressionVars',
} as const;

// Sentinel for "no parent" — Y.Map cannot store `undefined`, so we use the
// empty string on the wire. No real configId can be `''` (the runtime
// generator is `cfg-N`), so this is unambiguous.
const NO_PARENT = '';

/** Compose / split the flat overrideParams key. `featureId` cannot contain '/'
 *  in current usage (UUIDs / cfg-N), but we encode defensively in case future
 *  ids include slashes. */
function joinOvKey(featureId: string, paramKey: string): string {
  return `${featureId}:${paramKey}`;
}
function splitOvKey(joined: string): { featureId: string; paramKey: string } | null {
  const idx = joined.indexOf(':');
  if (idx < 0) return null;
  return { featureId: joined.slice(0, idx), paramKey: joined.slice(idx + 1) };
}

// ─── Origins (see Wave 2 doc §3.2) ─────────────────────────────────────────

export const ORIGIN_LOCAL_UI = 'local-ui';
export const ORIGIN_REMOTE_UPDATE = 'remote-update';
export const ORIGIN_IMPORT_NFAB = 'import-nfab';

export type ConfigOpOrigin =
  | typeof ORIGIN_LOCAL_UI
  | typeof ORIGIN_REMOTE_UPDATE
  | typeof ORIGIN_IMPORT_NFAB;

// ─── Op union — every mutation goes through one of these ──────────────────

export type ConfigOp =
  | { kind: 'addConfig'; entry: ConfigEntry }
  | { kind: 'removeConfig'; id: string }
  | { kind: 'renameConfig'; id: string; name: string }
  | { kind: 'setParent'; id: string; parentId: string | null }
  | { kind: 'setActive'; id: string | null }
  | { kind: 'setOverride'; configId: string; featureId: string; paramKey: string; value: number | string }
  | { kind: 'clearOverride'; configId: string; featureId: string; paramKey: string }
  | { kind: 'setSuppressed'; configId: string; featureId: string; suppressed: boolean }
  | { kind: 'setGlobalVar'; name: string; value: number | string }
  | { kind: 'unsetGlobalVar'; name: string }
  | { kind: 'setExpressionVar'; configId: string; varName: string; value: number | string };

export interface ApplyOpResult {
  applied: boolean;
  notes?: string;
}

// ─── Public accessors ──────────────────────────────────────────────────────

/** Get (creating if needed) the shared `configs` Y.Map on a doc. Each entry
 *  is one config keyed by configId. */
export function getConfigsRoot(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(CONFIGS_ROOT_KEY);
}

/** Get the single-key meta map holding `activeConfigId`. */
export function getActiveConfigMap(doc: Y.Doc): Y.Map<string | null> {
  return doc.getMap<string | null>(META_ROOT_KEY);
}

/** Get the global vars map (table-wide vars, shadows EquationManager when
 *  any config is active per spec §4.2). */
export function getGlobalVarsMap(doc: Y.Doc): Y.Map<number | string> {
  return doc.getMap<number | string>(GLOBAL_VARS_ROOT_KEY);
}

/** Read the current active config id (null when master / unset). */
export function readActiveConfigId(doc: Y.Doc): string | null {
  const meta = getActiveConfigMap(doc);
  const v = meta.get(META_KEYS.activeConfigId);
  return v ?? null;
}

/** Read the global vars as a plain JS object. */
export function readGlobalVars(doc: Y.Doc): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  getGlobalVarsMap(doc).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/** Snapshot all configs on the doc as plain ConfigEntry[] (insertion order). */
export function readAllConfigs(doc: Y.Doc): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  getConfigsRoot(doc).forEach(m => {
    out.push(yMapToConfigEntry(m));
  });
  return out;
}

/** Lookup one config entry by id; null when not present. */
export function readConfig(doc: Y.Doc, id: string): ConfigEntry | null {
  const m = getConfigsRoot(doc).get(id);
  return m ? yMapToConfigEntry(m) : null;
}

// ─── Encoders (typed → Y.Map) ──────────────────────────────────────────────

function configEntryToYMap(e: ConfigEntry): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(CONFIG_FIELDS.id, e.id);
  m.set(CONFIG_FIELDS.name, e.name);
  m.set(CONFIG_FIELDS.parentId, e.parentId ?? NO_PARENT);

  // Flat per-key params: avoids the "two peers create disjoint sub-Y.Maps,
  // one LWW-wins, the other peer's params disappear" anomaly. See module
  // header "Spec ambiguities resolved" §3.
  const overrideParams = new Y.Map<number | string>();
  const overrideSuppressed = new Y.Map<boolean>();
  for (const [featureId, slot] of Object.entries(e.overrides)) {
    if (slot.suppressed !== undefined) {
      overrideSuppressed.set(featureId, slot.suppressed);
    }
    if (slot.params) {
      for (const [paramKey, value] of Object.entries(slot.params)) {
        overrideParams.set(joinOvKey(featureId, paramKey), value);
      }
    }
  }
  m.set(CONFIG_FIELDS.overrideParams, overrideParams);
  m.set(CONFIG_FIELDS.overrideSuppressed, overrideSuppressed);

  const expressionVars = new Y.Map<number | string>();
  for (const [k, v] of Object.entries(e.expressionVars)) {
    expressionVars.set(k, v);
  }
  m.set(CONFIG_FIELDS.expressionVars, expressionVars);

  return m;
}

// ─── Decoders (Y.Map → typed) ──────────────────────────────────────────────

function yMapToConfigEntry(m: Y.Map<unknown>): ConfigEntry {
  const parentRaw = (m.get(CONFIG_FIELDS.parentId) as string | undefined) ?? NO_PARENT;

  // Rebuild the nested ConfigOverride shape that the resolution path
  // expects. featureIds visible in either the params or the suppressed
  // map appear in the result.
  const overrides: Record<string, ConfigOverride> = {};
  const paramsMap = m.get(CONFIG_FIELDS.overrideParams) as Y.Map<number | string> | undefined;
  const suppressedMap = m.get(CONFIG_FIELDS.overrideSuppressed) as Y.Map<boolean> | undefined;
  if (paramsMap) {
    paramsMap.forEach((value, joined) => {
      const split = splitOvKey(joined);
      if (!split) return;
      let slot = overrides[split.featureId];
      if (!slot) { slot = {}; overrides[split.featureId] = slot; }
      if (!slot.params) slot.params = {};
      slot.params[split.paramKey] = value;
    });
  }
  if (suppressedMap) {
    suppressedMap.forEach((value, featureId) => {
      let slot = overrides[featureId];
      if (!slot) { slot = {}; overrides[featureId] = slot; }
      slot.suppressed = value;
    });
  }

  const expressionVars: Record<string, number | string> = {};
  const varsMap = m.get(CONFIG_FIELDS.expressionVars) as Y.Map<number | string> | undefined;
  if (varsMap) {
    varsMap.forEach((v, k) => {
      expressionVars[k] = v;
    });
  }
  const entry: ConfigEntry = {
    id: (m.get(CONFIG_FIELDS.id) as string) ?? '',
    name: (m.get(CONFIG_FIELDS.name) as string) ?? '',
    overrides,
    expressionVars,
  };
  if (parentRaw !== NO_PARENT) entry.parentId = parentRaw;
  return entry;
}

// ─── Cycle-detection helpers (mirror ConfigurationTable internals) ────────

function buildParentGraphFromDoc(doc: Y.Doc): DepGraph {
  const g = new Map<string, readonly string[]>();
  getConfigsRoot(doc).forEach((cfg, id) => {
    const parent = (cfg.get(CONFIG_FIELDS.parentId) as string | undefined) ?? NO_PARENT;
    g.set(id, parent === NO_PARENT ? [] : [parent]);
  });
  return g;
}

// ─── Mutation API — applyConfigOp ──────────────────────────────────────────

/** Apply one configuration op to the doc inside a single transact() block.
 *
 *  Returns `{ applied, notes? }` — `applied: false` for no-ops (unknown id,
 *  cycle refusal, etc.). Cycle detection runs BEFORE the transact opens so
 *  the doc is never half-written.
 */
export function applyConfigOp(
  doc: Y.Doc,
  op: ConfigOp,
  origin: ConfigOpOrigin = ORIGIN_LOCAL_UI,
): ApplyOpResult {
  // Cycle detection MUST run before the transact opens — wouldCreateCycle
  // reads the doc state, and we want a clean "refuse before mutate" path.
  if (op.kind === 'setParent' && op.parentId !== null) {
    if (op.parentId === op.id) {
      return { applied: false, notes: 'cycle: self-loop refused' };
    }
    const root = getConfigsRoot(doc);
    if (!root.has(op.id)) return { applied: false, notes: 'unknown config' };
    if (!root.has(op.parentId)) return { applied: false, notes: 'unknown parent' };
    const graph = buildParentGraphFromDoc(doc);
    if (wouldCreateCycle(graph, op.id, [op.parentId])) {
      return { applied: false, notes: 'cycle: refused before transact' };
    }
  }

  let result: ApplyOpResult = { applied: false };
  doc.transact(() => {
    result = applyOpInner(doc, op);
  }, origin);
  return result;
}

function applyOpInner(doc: Y.Doc, op: ConfigOp): ApplyOpResult {
  const root = getConfigsRoot(doc);

  switch (op.kind) {
    case 'addConfig': {
      // Overwrites any prior entry under that id — caller responsibility
      // (mirrors sketchYjs.ts:417). Two peers calling addConfig with the
      // same id concurrently will LWW-merge on the Y.Map key.
      root.set(op.entry.id, configEntryToYMap(op.entry));
      // Auto-activate when this is the first config on the doc — matches
      // ConfigurationTable.add() semantics.
      const meta = getActiveConfigMap(doc);
      if (meta.get(META_KEYS.activeConfigId) == null && root.size === 1) {
        meta.set(META_KEYS.activeConfigId, op.entry.id);
      }
      return { applied: true };
    }

    case 'removeConfig': {
      if (!root.has(op.id)) return { applied: false };
      // Detach children — they survive but lose inheritance. Mirrors
      // ConfigurationTable.remove(). Same transact so observers never
      // see "dangling parentId" mid-merge.
      root.forEach(cfg => {
        if ((cfg.get(CONFIG_FIELDS.parentId) as string | undefined) === op.id) {
          cfg.set(CONFIG_FIELDS.parentId, NO_PARENT);
        }
      });
      root.delete(op.id);
      // If we removed the active one, pick the first remaining (or null).
      const meta = getActiveConfigMap(doc);
      if (meta.get(META_KEYS.activeConfigId) === op.id) {
        const next = root.keys().next();
        meta.set(META_KEYS.activeConfigId, next.done ? null : next.value);
      }
      return { applied: true };
    }

    case 'renameConfig': {
      const cfg = root.get(op.id);
      if (!cfg) return { applied: false };
      cfg.set(CONFIG_FIELDS.name, op.name);
      return { applied: true };
    }

    case 'setParent': {
      // Cycle check ran in the outer wrapper.
      const cfg = root.get(op.id);
      if (!cfg) return { applied: false };
      if (op.parentId === null) {
        cfg.set(CONFIG_FIELDS.parentId, NO_PARENT);
      } else {
        if (!root.has(op.parentId)) {
          return { applied: false, notes: 'unknown parent' };
        }
        cfg.set(CONFIG_FIELDS.parentId, op.parentId);
      }
      return { applied: true };
    }

    case 'setActive': {
      // Allow setting null (master) even when no configs exist.
      if (op.id !== null && !root.has(op.id)) {
        return { applied: false, notes: 'unknown config' };
      }
      getActiveConfigMap(doc).set(META_KEYS.activeConfigId, op.id);
      return { applied: true };
    }

    case 'setOverride': {
      const cfg = root.get(op.configId);
      if (!cfg) return { applied: false };
      // Flat per-key write — no intermediate Y.Map to LWW-merge.
      const params = cfg.get(CONFIG_FIELDS.overrideParams) as Y.Map<number | string>;
      params.set(joinOvKey(op.featureId, op.paramKey), op.value);
      return { applied: true };
    }

    case 'clearOverride': {
      const cfg = root.get(op.configId);
      if (!cfg) return { applied: false };
      const params = cfg.get(CONFIG_FIELDS.overrideParams) as Y.Map<number | string>;
      const k = joinOvKey(op.featureId, op.paramKey);
      if (!params.has(k)) return { applied: false };
      params.delete(k);
      return { applied: true };
    }

    case 'setSuppressed': {
      const cfg = root.get(op.configId);
      if (!cfg) return { applied: false };
      const suppressed = cfg.get(CONFIG_FIELDS.overrideSuppressed) as Y.Map<boolean>;
      suppressed.set(op.featureId, op.suppressed);
      return { applied: true };
    }

    case 'setGlobalVar': {
      getGlobalVarsMap(doc).set(op.name, op.value);
      return { applied: true };
    }

    case 'unsetGlobalVar': {
      const m = getGlobalVarsMap(doc);
      if (!m.has(op.name)) return { applied: false };
      m.delete(op.name);
      return { applied: true };
    }

    case 'setExpressionVar': {
      const cfg = root.get(op.configId);
      if (!cfg) return { applied: false };
      const vars = cfg.get(CONFIG_FIELDS.expressionVars) as Y.Map<number | string>;
      vars.set(op.varName, op.value);
      return { applied: true };
    }

    default: {
      const _never: never = op;
      void _never;
      return { applied: false };
    }
  }
}

// ─── Bootstrap helper ──────────────────────────────────────────────────────

/** Bootstrap a fresh Y.Doc from a plain snapshot (used on .nfab import or
 *  when migrating from local-only ConfigurationTable to collab). Runs in
 *  one transact so peers see the whole table land atomically. */
export function snapshotToYDoc(snap: {
  configs: ConfigEntry[];
  activeConfigId: string | null;
  globalVars: Record<string, number | string>;
}): Y.Doc {
  const doc = new Y.Doc();
  populateDoc(doc, snap);
  return doc;
}

/** Write a snapshot into an EXISTING Y.Doc inside one transact. Used by
 *  `ConfigStore.migrateToYjs` to lift local-mode state up to collab mode
 *  without losing it. Existing keys with the same id are overwritten —
 *  callers should ensure the doc is fresh / empty for predictable behaviour. */
export function populateDoc(
  doc: Y.Doc,
  snap: {
    configs: ConfigEntry[];
    activeConfigId: string | null;
    globalVars: Record<string, number | string>;
  },
  origin: ConfigOpOrigin = ORIGIN_IMPORT_NFAB,
): void {
  doc.transact(() => {
    const root = getConfigsRoot(doc);
    for (const e of snap.configs) {
      root.set(e.id, configEntryToYMap(e));
    }
    const meta = getActiveConfigMap(doc);
    meta.set(META_KEYS.activeConfigId, snap.activeConfigId);
    const vars = getGlobalVarsMap(doc);
    for (const [k, v] of Object.entries(snap.globalVars)) {
      vars.set(k, v);
    }
  }, origin);
}

// ─── Sync helper ───────────────────────────────────────────────────────────

/** Exchange Yjs state vectors between two docs so each receives the other's
 *  updates. Used by multi-peer tests. Returns byte counts for telemetry. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB, ORIGIN_REMOTE_UPDATE);
  Y.applyUpdate(a, updateForA, ORIGIN_REMOTE_UPDATE);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}

/** Star-of-stars sync for N peers — every peer receives every other peer's
 *  state. O(N²) updates but stable and order-independent (Yjs is CRDT). */
export function syncAll(docs: readonly Y.Doc[]): void {
  for (const from of docs) {
    const update = Y.encodeStateAsUpdate(from);
    for (const to of docs) {
      if (to === from) continue;
      Y.applyUpdate(to, update, ORIGIN_REMOTE_UPDATE);
    }
  }
}

// ─── Equality helper for convergence tests ─────────────────────────────────

/** Canonical-form JSON comparison of two config entry arrays. Order-
 *  insensitive (configs sorted by id, overrides by featureId, params by
 *  paramKey, expressionVars by varName). Returns true when the two lists
 *  represent the same state. */
export function configsEqual(a: readonly ConfigEntry[], b: readonly ConfigEntry[]): boolean {
  return canonicalConfigs(a) === canonicalConfigs(b);
}

/** Stable canonical JSON for a config entry list. Sorts every keyed
 *  collection so that Y.Map iteration-order differences don't trip
 *  equality checks. */
export function canonicalConfigs(list: readonly ConfigEntry[]): string {
  const sorted = [...list].sort((x, y) => x.id.localeCompare(y.id));
  return JSON.stringify(sorted.map(canonicalEntry));
}

function canonicalEntry(e: ConfigEntry): unknown {
  const overrides: Record<string, unknown> = {};
  for (const key of Object.keys(e.overrides).sort()) {
    const slot = e.overrides[key]!;
    const sortedParams: Record<string, number | string> = {};
    if (slot.params) {
      for (const pk of Object.keys(slot.params).sort()) sortedParams[pk] = slot.params[pk]!;
    }
    overrides[key] = {
      suppressed: slot.suppressed,
      params: Object.keys(sortedParams).length > 0 ? sortedParams : undefined,
    };
  }
  const sortedVars: Record<string, number | string> = {};
  for (const vk of Object.keys(e.expressionVars).sort()) {
    sortedVars[vk] = e.expressionVars[vk]!;
  }
  return {
    id: e.id,
    name: e.name,
    parentId: e.parentId ?? null,
    overrides,
    expressionVars: sortedVars,
  };
}
