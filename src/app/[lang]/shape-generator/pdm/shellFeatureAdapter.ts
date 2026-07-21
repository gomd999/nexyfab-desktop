/**
 * shellFeatureAdapter.ts — Wave 6 Track W6-D.
 *
 * VersionTreePanel lives in the shell-v2 layer, but the live feature
 * pipeline lives inside ShapeGeneratorInner (useFeatureStack). Inner already
 * publishes a presentation snapshot of that pipeline to the shell bridge
 * (`useShellBridge.featureItems`), so the PDM session repo can be fed real
 * per-session data without lifting Inner's domain state.
 *
 * This adapter converts that snapshot (ShellFeatureItem[]) into the
 * FeatureInstance[] shape the tested PDM engine (versionBranch /
 * conflictResolution / historyView) operates on.
 *
 * Known approximation (explicit, by design):
 *   - ShellFeatureItem carries only numeric params + muted flag — sketch
 *     geometry / edge selections are NOT round-tripped. The PDM layer never
 *     dispatches on these, so commits/diffs/merges remain correct for the
 *     id + type + params + enabled surface it actually compares
 *     (see conflictResolution.featureEquals).
 */

import type { ShellFeatureItem } from '../_shell/shellBridgeStore';
import type { FeatureInstance, FeatureType } from '../features/types';

export function shellItemsToFeatureInstances(items: ShellFeatureItem[]): FeatureInstance[] {
  const out: FeatureInstance[] = [];
  const walk = (list: ShellFeatureItem[]) => {
    for (const it of list) {
      out.push({
        id: it.id,
        // Presentation-layer type string is the same feature type id Inner
        // publishes from the real pipeline; the cast is a widening bridge,
        // not a fabrication — unknown values survive untouched because the
        // PDM layer only compares them for equality.
        type: it.type as FeatureType,
        params: { ...(it.params ?? {}) },
        enabled: !it.muted,
      });
      if (it.children?.length) walk(it.children);
    }
  };
  walk(items);
  // Guard against duplicate ids if a publisher repeats nodes — first wins,
  // matching conflictResolution's Map-index semantics.
  const seen = new Set<string>();
  return out.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}
