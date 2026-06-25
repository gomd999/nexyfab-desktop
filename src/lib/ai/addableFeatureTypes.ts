/**
 * addableFeatureTypes — runtime allowlist of feature types the in-context
 * viewport AI prompt may add to the current part via the generic
 * `add_feature_to_last` PlanIntent.
 *
 * Pure data (no imports) so the server route (`/api/featureTree-intent`) can
 * validate LLM output against it without pulling in the client-side feature
 * registry (which imports three.js). The client mapper
 * (`planIntentToFeatureEdit`) maps the validated `{ featureType, params }`
 * straight onto a dispatcher `add_feature` intent; `addFeatureWithParams`
 * fills any omitted params from the feature's registry defaults, so partial
 * params from the model are safe.
 *
 * Why a curated subset instead of all ~30 FeatureType values?
 *   These are the "dress-up / modify the whole body" features that map cleanly
 *   from a one-line natural-language command. Features that genuinely require
 *   interactive selection (boolean, mirror, sketch, sheet-metal bends) are
 *   left out — adding them blind would produce confusing no-ops.
 *
 * Keep `type` values in sync with the `FeatureType` union in
 * features/types.ts. (A compile-time cross-check lives in
 * planIntentToFeatureEdit.ts, which casts these to FeatureType.)
 */

export interface AddableFeatureSpec {
  /** Canonical FeatureType registry key. */
  type: string;
  /** EN + KO synonyms that should resolve to this feature (offline fast-path + prompt hints). */
  aka: string[];
  /** Primary numeric params with their canonical registry key (shown to the LLM). */
  params: string[];
}

export const ADDABLE_FEATURES: readonly AddableFeatureSpec[] = [
  { type: 'fillet', aka: ['fillet', 'round', '필렛', '라운드', '모깎기'], params: ['radius'] },
  { type: 'chamfer', aka: ['chamfer', 'bevel', '챔퍼', '모따기'], params: ['distance'] },
  { type: 'hole', aka: ['hole', 'bore', 'drill', '구멍', '홀'], params: ['diameter', 'depth'] },
  { type: 'shell', aka: ['shell', 'hollow', '쉘', '속비우기'], params: ['wallThickness'] },
  { type: 'thread', aka: ['thread', 'screw', '나사', '나사산'], params: ['pitch', 'depth', 'angle'] },
  { type: 'draft', aka: ['draft', '구배', '빼기구배'], params: ['angle'] },
  { type: 'helix', aka: ['helix', 'spiral', 'coil', '나선', '헬릭스'], params: ['radius', 'pitch', 'turns', 'wireRadius'] },
  { type: 'scale', aka: ['scale', 'resize', '스케일', '크기조절'], params: ['scaleX', 'scaleY', 'scaleZ'] },
  // Face-selection consumers — the client mapper attaches the current face
  // selection when one is active (SELECTION_CONSUMING_FEATURES).
  { type: 'offsetFace', aka: ['offset', 'off set', '오프셋', '옵셋'], params: ['distance'] },
  { type: 'deleteFace', aka: ['delete face', 'remove face', '면 삭제', '면 제거'], params: [] },
] as const;

/**
 * Features that consume the user's current face/edge selection. The viewport
 * mapper upgrades an `add_feature_to_last` for these to `add_feature_on_selection`
 * when a selection of the right kind is active. (Edge consumers: fillet/chamfer.)
 */
export const FACE_SELECTION_CONSUMERS: readonly string[] = ['offsetFace', 'deleteFace', 'draft'];
export const EDGE_SELECTION_CONSUMERS: readonly string[] = ['fillet', 'chamfer'];

/** Plain list of valid featureType strings for `add_feature_to_last`. */
export const ADDABLE_FEATURE_TYPES: readonly string[] = ADDABLE_FEATURES.map((f) => f.type);

/** True when `t` is a feature type the generic add path accepts. */
export function isAddableFeatureType(t: unknown): t is string {
  return typeof t === 'string' && ADDABLE_FEATURE_TYPES.includes(t);
}
