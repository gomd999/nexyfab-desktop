/**
 * edgeCapWarnings.ts — Wave 2 Phase 3 Track E2.
 *
 * Cap-warning catalogue for the edge-based direct-edit ops. Mirrors
 * E1's face-side cap warnings (push-pull oversize / self-intersect)
 * but for the dynamic fillet / chamfer flow.
 *
 * The catalogue is consumed by the overlay (to surface a non-blocking
 * toast on a refused drag) and by tests (to lock the trigger
 * conditions + threshold rationale).
 *
 * Why a separate module: E5 (commit-to-history, W7) wants to expose
 * these to the param-form path as well, and ADR-012 §6 says the
 * direct-edit refusal semantics must be the same regardless of
 * entrypoint.
 */

export type EdgeCapWarningKind =
  | 'DYNAMIC_FILLET_OVER_ROUND'
  | 'DYNAMIC_FILLET_EDGE_TOO_SHORT'
  | 'DYNAMIC_FILLET_INVALID_RADIUS'
  | 'DYNAMIC_FILLET_TOO_LARGE'
  | 'DYNAMIC_CHAMFER_DISTANCE_EXCEEDS_EDGE'
  | 'DYNAMIC_CHAMFER_INVALID_DISTANCE'
  | 'DYNAMIC_CHAMFER_OVER_CHAMFER'
  | 'DYNAMIC_CHAMFER_TOO_LARGE';

export interface EdgeCapWarning {
  kind: EdgeCapWarningKind;
  /** Threshold that triggered the refusal. e.g. {radius:10,limit:5}. */
  details: Record<string, number | string>;
}

/** Build a warning record. Pure — no console / toast side effects.
 *  Callers (overlay, applier) decide how to surface it. */
export function makeEdgeCapWarning(
  kind: EdgeCapWarningKind,
  details: Record<string, number | string> = {},
): EdgeCapWarning {
  return { kind, details };
}

/** Catalogue of trigger conditions + threshold rationale. Exported
 *  for documentation + tests; not used at runtime. */
export const EDGE_CAP_WARNING_CATALOGUE: Record<EdgeCapWarningKind, {
  trigger: string;
  threshold: string;
  rationale: string;
}> = {
  DYNAMIC_FILLET_OVER_ROUND: {
    trigger: 'radius > 50% of shortest adjacent face perpendicular extent',
    threshold: '0.5 × shortestAdjacentFaceExtentMm',
    rationale:
      'A fillet that consumes more than half the adjacent face leaves'
      + ' no flat region — the resulting topology collapses (the cap'
      + ' meets the opposite edge), which mesh-level rounding cannot'
      + ' resolve without a B-Rep solver. 50% is the standard CAD'
      + ' cap (SolidWorks fillet preview refuses at the same'
      + ' threshold).',
  },
  DYNAMIC_FILLET_EDGE_TOO_SHORT: {
    trigger: 'edgeLengthMm < 2 × radius',
    threshold: '2 × radiusMm',
    rationale:
      'The quarter-cylinder cap needs r headroom at each end of the'
      + ' edge to round into the neighbouring corners. Without 2r of'
      + ' edge length the caps overlap and the mesh becomes non-'
      + ' manifold. B-Rep would coalesce the corners into a sphere;'
      + ' mesh-level path refuses early.',
  },
  DYNAMIC_FILLET_INVALID_RADIUS: {
    trigger: 'radius ≤ 0 or non-finite',
    threshold: '0',
    rationale:
      'A zero or negative radius is not geometrically meaningful.'
      + ' NaN / Infinity from a drag jitter would silently corrupt'
      + ' the session stack; we refuse early.',
  },
  DYNAMIC_FILLET_TOO_LARGE: {
    trigger: 'radius > DYNAMIC_EDGE_MAX_MM',
    threshold: '1000 mm',
    rationale:
      'A 1m fillet on a typical M8-scale part is a drag-gesture'
      + ' bug, not user intent. Hard cap is the same as push-pull'
      + ' (PUSH_PULL_MAX_OFFSET_MM) — the gestures share scale.',
  },
  DYNAMIC_CHAMFER_DISTANCE_EXCEEDS_EDGE: {
    trigger: 'distance ≥ edgeLengthMm',
    threshold: 'edgeLengthMm',
    rationale:
      'A chamfer setback ≥ the edge length removes the entire edge'
      + ' and merges the two adjacent corner vertices — the bevel'
      + ' becomes a triangle, not a quadrilateral, and mesh-level'
      + ' re-triangulation cannot recover a valid topology.',
  },
  DYNAMIC_CHAMFER_INVALID_DISTANCE: {
    trigger: 'distance ≤ 0 or non-finite',
    threshold: '0',
    rationale: 'Same rationale as DYNAMIC_FILLET_INVALID_RADIUS.',
  },
  DYNAMIC_CHAMFER_OVER_CHAMFER: {
    trigger: 'distance > 50% of shortest adjacent face perpendicular extent',
    threshold: '0.5 × shortestAdjacentFaceExtentMm',
    rationale:
      'Beyond 50% the bevel collides with the opposite edge of the'
      + ' adjacent face. Same constraint as fillet over-round.',
  },
  DYNAMIC_CHAMFER_TOO_LARGE: {
    trigger: 'distance > DYNAMIC_EDGE_MAX_MM',
    threshold: '1000 mm',
    rationale: 'Same rationale as DYNAMIC_FILLET_TOO_LARGE.',
  },
};
