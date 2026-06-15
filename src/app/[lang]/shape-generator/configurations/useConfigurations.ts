/**
 * useConfigurations.ts — React hook that exposes a `ConfigStore` to
 * components with reactive re-renders.
 *
 * MANAGER layer (lightweight). Wraps the existing `ConfigStore` adapter
 * (local or Yjs mode) — does NOT introduce a second source of truth.
 * The heavy Excel-style `ConfigurationTableV2` and the legacy
 * `panels/ConfigurationTable.tsx` continue to use the same `ConfigStore`
 * / `ConfigurationTable` runtime, so this hook is a sibling consumer
 * not a competing state container.
 *
 * Why a hook (and not zustand): the underlying `ConfigStore` already
 * has a subscribe/notify pattern and is the authoritative state. A
 * zustand store on top would duplicate state and risk drift (the W1
 * configurations corruption class of bug, per `ConfigStore.ts` ln 230
 * comment). A `useSyncExternalStore` wrapper is the textbook React 18
 * way to bridge an imperative store to render.
 *
 * Usage:
 *
 *     const cfgs = useConfigurations(configStoreRef.current);
 *     cfgs.list                 // ConfigEntry[]
 *     cfgs.activeId             // string | null
 *     cfgs.add('Small')         // create + auto-activate
 *     cfgs.switchTo('cfg-2')    // null = master
 *
 * The hook is a thin façade: it surfaces ONLY the manager-level ops
 * (add / remove / rename / switchTo / updateParamOverrides). Per-cell
 * suppress / expression-var edits stay in the heavy table V2 panel —
 * the manager UX intentionally doesn't try to be a grid.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ConfigEntry } from './types';
import type { ConfigStore } from './ConfigStore';

/** Read-only snapshot returned by the hook. Computed in the
 *  subscriber so each re-render gets a stable reference until the
 *  underlying store mutates. */
export interface ConfigurationsSnapshot {
  /** All configs in insertion order. */
  readonly list: readonly ConfigEntry[];
  /** Active config id; `null` = master (no overlay). */
  readonly activeId: string | null;
  /** Convenience: active config entry, or `null` for master. */
  readonly active: ConfigEntry | null;
}

/** Mutator surface — the manager's contract. */
export interface ConfigurationsActions {
  /** Create a new configuration. Auto-activates if it's the first one
   *  (mirrors `ConfigurationTable.add` behaviour). Param overrides
   *  may be supplied as a flat `{featureId: {paramKey: value}}` map. */
  add(
    name: string,
    paramOverrides?: Record<string, Record<string, number | string>>,
  ): ConfigEntry;
  /** Delete a configuration. Returns `true` on success. */
  remove(id: string): boolean;
  /** Rename a configuration. Returns `true` on success. */
  rename(id: string, name: string): boolean;
  /** Switch to a configuration; pass `null` to return to master. */
  switchTo(id: string | null): boolean;
  /** Bulk-apply param overrides for one config. Each entry is
   *  `[featureId, paramKey, value]`. Use this from a "duplicate config"
   *  workflow that copies the current snapshot. */
  updateParamOverrides(
    configId: string,
    overrides: ReadonlyArray<readonly [string, string, number | string]>,
  ): void;
}

/** Full hook return — snapshot + actions. Split as two objects so
 *  callers can destructure cleanly. */
export interface UseConfigurationsResult extends ConfigurationsSnapshot, ConfigurationsActions {
  /** Direct reference to the store — escape hatch for the heavy table
   *  panel which needs the underlying `ConfigurationTable` instance. */
  readonly store: ConfigStore;
}

/**
 * Bind to a `ConfigStore`. Re-renders the calling component whenever
 * the store notifies a mutation.
 *
 * Passing `null` returns an inert hook (empty list, no-op actions) —
 * useful for components that mount before the store is initialised.
 * This is a deliberate choice: throwing on `null` would force callers
 * to add a conditional render, which complicates the
 * `ShapeGeneratorInner` mount path where the store lazily initialises
 * inside a ref.
 */
export function useConfigurations(store: ConfigStore | null): UseConfigurationsResult {
  // Snapshot cache so useSyncExternalStore returns a stable reference
  // when the store hasn't mutated — required to avoid the "infinite
  // re-render" loop React DevTools warns about.
  const cacheRef = useRef<{ store: ConfigStore | null; snap: ConfigurationsSnapshot } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (!store) return () => {};
      return store.subscribe(() => {
        // Invalidate the snapshot cache then notify React.
        cacheRef.current = null;
        onChange();
      });
    },
    [store],
  );

  const getSnapshot = useCallback((): ConfigurationsSnapshot => {
    if (!store) {
      // Inert snapshot — frozen singleton-equivalent.
      if (cacheRef.current?.store === null) return cacheRef.current.snap;
      const snap: ConfigurationsSnapshot = { list: [], activeId: null, active: null };
      cacheRef.current = { store: null, snap };
      return snap;
    }
    if (cacheRef.current?.store === store) return cacheRef.current.snap;
    const list = store.list();
    const activeId = store.getActiveId();
    const active = store.getActive();
    const snap: ConfigurationsSnapshot = { list, activeId, active };
    cacheRef.current = { store, snap };
    return snap;
  }, [store]);

  // Server snapshot — SSR returns an inert shape so first paint
  // doesn't blow up. Hydration immediately replaces with the live one.
  const getServerSnapshot = useCallback(
    (): ConfigurationsSnapshot => ({ list: [], activeId: null, active: null }),
    [],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Actions — stable identities so callers can pass them into deps
  // arrays without thrashing memos.
  const actions = useMemo<ConfigurationsActions>(() => {
    return {
      add(name, paramOverrides) {
        if (!store) {
          throw new Error('useConfigurations: store is null; cannot add');
        }
        const entry = store.add(name);
        if (paramOverrides) {
          for (const [fid, params] of Object.entries(paramOverrides)) {
            for (const [k, v] of Object.entries(params)) {
              store.setOverride(entry.id, fid, k, v);
            }
          }
        }
        return entry;
      },
      remove(id) {
        if (!store) return false;
        return store.remove(id);
      },
      rename(id, name) {
        if (!store) return false;
        return store.rename(id, name);
      },
      switchTo(id) {
        if (!store) return false;
        return store.activate(id);
      },
      updateParamOverrides(configId, overrides) {
        if (!store) return;
        for (const [fid, k, v] of overrides) {
          store.setOverride(configId, fid, k, v);
        }
      },
    };
  }, [store]);

  // Combine — `store` is required by callers that need to drop down
  // to the heavy table; supply a sentinel when null to keep the type
  // honest. Callers MUST check `store !== null` before drilling in.
  const result: UseConfigurationsResult = {
    ...snapshot,
    ...actions,
    store: store as ConfigStore, // see doc note above on null handling
  };
  return result;
}
