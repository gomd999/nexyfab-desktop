/**
 * moduleResolver.ts — Resolve a registry entry's `entryHint` to a module
 * specifier, and (client-side) dynamically import the implementation.
 *
 * `entryHint` is stored relative to the shape-generator directory (the
 * parent of featureCatalog/). This module is the single place that knows
 * that convention, so the rest of the app never hard-codes paths.
 *
 * The registry-integrity test (registry.entryHints.test.ts) uses
 * `entryHintToRelativeSpecifier` to verify every entry points at a real
 * source file — that check caught 4 stale pointers when it was added.
 *
 * NOTE on dynamic import: a fully-variable `import()` is fragile under
 * bundlers (it forces a context module over the whole subtree, and a
 * `../../../lib` hint escapes a single-level context). Until a concrete
 * UI consumer needs lazy loading, callers should register their own
 * importer map via `registerLoader` rather than rely on a blanket
 * dynamic import. `loadModule` consults that map.
 */

import { FEATURE_REGISTRY, type FeatureRegistryEntry } from './registry';

/**
 * Convert an entryHint (relative to shape-generator/) into a specifier
 * relative to THIS file (featureCatalog/). featureCatalog is one level
 * below shape-generator, so we prepend a single `../`.
 */
export function entryHintToRelativeSpecifier(entryHint: string): string {
  return `../${entryHint}`;
}

/** Look up the entryHint for a registry id. */
export function entryHintForId(id: string): string | null {
  return FEATURE_REGISTRY.find(e => e.id === id)?.entryHint ?? null;
}

// ── Loader registry (opt-in, bundler-safe) ──────────────────────────

export type ModuleLoader = () => Promise<Record<string, unknown>>;

const LOADERS = new Map<string, ModuleLoader>();

/**
 * Register an explicit importer for a feature id. UI code that wants a
 * feature lazy-loadable provides `() => import('../cam/turningToolpath')`
 * — a static specifier the bundler can analyse — keeping chunk splitting
 * correct and avoiding blanket context modules.
 */
export function registerLoader(id: string, loader: ModuleLoader): void {
  LOADERS.set(id, loader);
}

/** Register many at once (e.g. from a generated loader map). */
export function registerLoaders(map: Record<string, ModuleLoader>): void {
  for (const [id, loader] of Object.entries(map)) LOADERS.set(id, loader);
}

export function hasLoader(id: string): boolean {
  return LOADERS.has(id);
}

/** Number of features that currently have a registered loader. */
export function registeredLoaderCount(): number {
  return LOADERS.size;
}

/**
 * Load a feature module by registry id. Resolves via the opt-in loader
 * map; throws a descriptive error if no loader is registered (so the
 * caller can surface "not yet wired" rather than a cryptic bundler
 * failure).
 */
export async function loadModule(id: string): Promise<Record<string, unknown>> {
  const loader = LOADERS.get(id);
  if (!loader) {
    const entry = FEATURE_REGISTRY.find(e => e.id === id);
    if (!entry) throw new Error(`loadModule: unknown feature id "${id}".`);
    throw new Error(
      `loadModule: no loader registered for "${id}" (entryHint "${entry.entryHint}"). ` +
      `Call registerLoader('${id}', () => import('${entryHintToRelativeSpecifier(entry.entryHint)}')).`,
    );
  }
  return loader();
}

/** Registry ids that have no loader yet — the integration backlog. */
export function unwiredFeatureIds(): string[] {
  return FEATURE_REGISTRY.filter(e => !LOADERS.has(e.id)).map(e => e.id);
}

/** Coverage: fraction of registry entries with a registered loader. */
export function loaderCoverage(): { wired: number; total: number; fraction: number } {
  const total = FEATURE_REGISTRY.length;
  const wired = LOADERS.size;
  return { wired, total, fraction: total > 0 ? wired / total : 0 };
}

export function describeEntry(entry: FeatureRegistryEntry): string {
  return `${entry.id} → ${entryHintToRelativeSpecifier(entry.entryHint)} [${entry.license}]`;
}
