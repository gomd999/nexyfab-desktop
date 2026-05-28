/**
 * diffConfigs.ts — diff two configurations after parent-chain
 * resolution.
 *
 * Wave 2 Phase 2 Track A Week 2 (A2). Pure function. Ported from
 * `assembly/multiConfigPartVariant.diffConfigs` but generalised to the
 * new per-feature override model:
 *
 *   - Suppress diffs are keyed by featureId (was: same).
 *   - Param deltas are now `(featureId, paramKey, vA, vB)` triples
 *     instead of flat `paramName` deltas — the new model overrides
 *     params per feature, not globally.
 *
 * Resolution uses the parent chain, so a diff between a child and its
 * grandparent includes anything the intermediate parent contributed
 * (i.e. the inherited deltas are visible). This matches the
 * SolidWorks "Configuration Comparison" tool's behaviour.
 *
 * Comparison rules:
 *
 *   - **suppress**: feature suppressed on one side, not the other →
 *     appears in `suppressedInA` or `suppressedInB`.
 *   - **param value**: present on both sides with different value →
 *     `paramDeltas` entry. Identity uses strict equality (`===`),
 *     including type — so `5 !== '5'` is a diff. (Expression strings
 *     are passed through; A3 will compare resolved numeric values.)
 *   - **param presence**: present on one side only → `paramDeltas`
 *     entry with the missing side's `value*` field `undefined`.
 *   - Features in the master tree that neither side overrides are
 *     **not** in the diff (they're identical by definition).
 */

import type { ConfigurationTable } from './ConfigurationTable';
import type { ConfigDiff, ConfigParamDelta, MasterFeatures } from './types';

export function diffConfigs(
  table: ConfigurationTable,
  features: MasterFeatures,
  configA: string,
  configB: string,
): ConfigDiff {
  const resolvedA = table.getResolved(configA, features);
  const resolvedB = table.getResolved(configB, features);

  // Suppression: build sets of "visible feature ids" on each side.
  const visibleA = new Set(resolvedA.map(f => f.id));
  const visibleB = new Set(resolvedB.map(f => f.id));

  const suppressedInA: string[] = [];
  const suppressedInB: string[] = [];

  // Master determines the universe — features absent from master
  // can't appear in either resolved list anyway.
  for (const f of features) {
    const inA = visibleA.has(f.id);
    const inB = visibleB.has(f.id);
    if (inA && !inB) suppressedInB.push(f.id);
    else if (!inA && inB) suppressedInA.push(f.id);
  }

  // Param deltas: walk the union of (featureId, paramKey) keys
  // present on either side's resolved features, comparing values.
  const featById = new Map<string, { a?: Record<string, number>; b?: Record<string, number> }>();
  for (const fa of resolvedA) {
    const slot = featById.get(fa.id) ?? {};
    slot.a = fa.params;
    featById.set(fa.id, slot);
  }
  for (const fb of resolvedB) {
    const slot = featById.get(fb.id) ?? {};
    slot.b = fb.params;
    featById.set(fb.id, slot);
  }

  const paramDeltas: ConfigParamDelta[] = [];
  for (const [featureId, sides] of featById) {
    // If a feature is suppressed on one side, its params are already
    // recorded in `suppressedIn*`; skip param-level diff for that
    // pair to avoid double-reporting.
    if (sides.a === undefined || sides.b === undefined) continue;
    const keys = new Set<string>([...Object.keys(sides.a), ...Object.keys(sides.b)]);
    for (const k of keys) {
      const va = Object.prototype.hasOwnProperty.call(sides.a, k) ? sides.a[k] : undefined;
      const vb = Object.prototype.hasOwnProperty.call(sides.b, k) ? sides.b[k] : undefined;
      if (va === vb) continue;
      // Equal-NaN: two NaNs from expression-eval failures shouldn't
      // appear in the diff (they're "the same broken state").
      if (typeof va === 'number' && typeof vb === 'number' && Number.isNaN(va) && Number.isNaN(vb)) continue;
      paramDeltas.push({ featureId, paramKey: k, valueA: va, valueB: vb });
    }
  }

  // Stable sort — diff display order shouldn't depend on Map iteration.
  paramDeltas.sort((x, y) =>
    x.featureId === y.featureId
      ? x.paramKey.localeCompare(y.paramKey)
      : x.featureId.localeCompare(y.featureId),
  );
  suppressedInA.sort();
  suppressedInB.sort();

  return { configA, configB, suppressedInA, suppressedInB, paramDeltas };
}
