/**
 * conflictResolution.ts — 3-way merge of feature pipelines.
 *
 * When two branches diverge and both edit the same feature, naive
 * "take theirs / take ours" loses data. This module performs a
 * 3-way merge using the LCA (lowest common ancestor) as the base,
 * detecting conflicts and producing a merged pipeline plus a list
 * of unresolved entries the user has to decide on.
 *
 * Strategy:
 *   - Index features by id across base / ours / theirs.
 *   - For each feature id, classify:
 *     - unchanged on both sides → take base
 *     - changed only on one side → take that side
 *     - changed on both sides:
 *       - identical change → take it (no conflict)
 *       - different change → CONFLICT
 *     - added on both sides:
 *       - identical → take it
 *       - different → CONFLICT (rare; id collision)
 *     - deleted on one side, modified on other → CONFLICT
 */

import type { FeatureInstance } from '../features/types';

export interface MergeInput {
  base: FeatureInstance[];
  ours: FeatureInstance[];
  theirs: FeatureInstance[];
}

export type ConflictKind =
  | 'modify-modify'
  | 'modify-delete'
  | 'delete-modify'
  | 'add-add';

export interface MergeConflict {
  featureId: string;
  kind: ConflictKind;
  ours?: FeatureInstance;
  theirs?: FeatureInstance;
  base?: FeatureInstance;
}

export interface MergeResult {
  merged: FeatureInstance[];
  conflicts: MergeConflict[];
}

function featureEquals(a: FeatureInstance, b: FeatureInstance): boolean {
  if (a.type !== b.type) return false;
  if (a.enabled !== b.enabled) return false;
  const ak = Object.keys(a.params).sort();
  const bk = Object.keys(b.params).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (a.params[ak[i]!] !== b.params[bk[i]!]) return false;
  }
  // sketchData equality is intentionally not checked deeply — that's
  // typically a sign of an intentional structural change anyway.
  return true;
}

function index(features: FeatureInstance[]): Map<string, FeatureInstance> {
  const m = new Map<string, FeatureInstance>();
  for (const f of features) m.set(f.id, f);
  return m;
}

export function mergeFeatures(input: MergeInput): MergeResult {
  const baseMap = index(input.base);
  const oursMap = index(input.ours);
  const theirsMap = index(input.theirs);

  const ids = new Set<string>([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);
  const merged: FeatureInstance[] = [];
  const conflicts: MergeConflict[] = [];

  // Preserve insertion order: prefer ours' order, then append theirs-only.
  const order: string[] = [];
  for (const f of input.ours) if (ids.has(f.id)) order.push(f.id);
  for (const f of input.theirs) if (!order.includes(f.id) && ids.has(f.id)) order.push(f.id);
  for (const f of input.base) if (!order.includes(f.id)) order.push(f.id);

  for (const id of order) {
    const b = baseMap.get(id);
    const o = oursMap.get(id);
    const t = theirsMap.get(id);

    if (!b && !o && !t) continue;

    // Both deleted relative to base → consume.
    if (b && !o && !t) continue;

    // Added on both sides.
    if (!b && o && t) {
      if (featureEquals(o, t)) {
        merged.push(o);
      } else {
        conflicts.push({ featureId: id, kind: 'add-add', ours: o, theirs: t });
      }
      continue;
    }

    // Added on one side only.
    if (!b && o && !t) { merged.push(o); continue; }
    if (!b && !o && t) { merged.push(t); continue; }

    // Deleted on one side.
    if (b && !o && t) {
      if (featureEquals(b, t)) {
        // Their side unchanged — accept the delete.
        continue;
      }
      conflicts.push({ featureId: id, kind: 'delete-modify', base: b, theirs: t });
      continue;
    }
    if (b && o && !t) {
      if (featureEquals(b, o)) {
        continue;
      }
      conflicts.push({ featureId: id, kind: 'modify-delete', base: b, ours: o });
      continue;
    }

    // Both sides present; compare against base.
    if (b && o && t) {
      const oChanged = !featureEquals(b, o);
      const tChanged = !featureEquals(b, t);
      if (!oChanged && !tChanged) { merged.push(b); continue; }
      if (oChanged && !tChanged) { merged.push(o); continue; }
      if (!oChanged && tChanged) { merged.push(t); continue; }
      // Both changed.
      if (featureEquals(o, t)) {
        merged.push(o);
      } else {
        conflicts.push({ featureId: id, kind: 'modify-modify', base: b, ours: o, theirs: t });
      }
    }
  }

  return { merged, conflicts };
}

/** Resolve a conflict by choosing one side. The caller's UI shows
 *  side-by-side and the user clicks "take ours" / "take theirs". */
export function resolveConflict(
  result: MergeResult,
  featureId: string,
  choice: 'ours' | 'theirs',
): MergeResult {
  const conflict = result.conflicts.find(c => c.featureId === featureId);
  if (!conflict) return result;
  const chosen = choice === 'ours' ? conflict.ours : conflict.theirs;
  const newMerged = result.merged.slice();
  if (chosen) {
    // Insert in position of the original feature id, if absent.
    if (!newMerged.find(f => f.id === featureId)) newMerged.push(chosen);
  }
  return {
    merged: newMerged,
    conflicts: result.conflicts.filter(c => c.featureId !== featureId),
  };
}
