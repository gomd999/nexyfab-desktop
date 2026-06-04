/**
 * meshEdgeIdentity — resize-invariant box-edge identity for mesh-mode selection
 * survival (F3 step-1 breadth).
 *
 * The OCCT path already re-resolves a stored edge selection by signature so a
 * fillet/chamfer survives an upstream dimension change. The mesh path had no
 * equivalent. This supplies the missing half that is actually correct on a mesh:
 * resolving a selection to a *box-edge id* — (axis, signU, signV) — that is
 * bbox-RELATIVE, hence invariant under a resize. The SAME selected edge is
 * recovered after the part changes size, with no stored-point drift.
 *
 * Note on the other half (applying a chamfer to ONLY that edge on a mesh): a
 * three-bvh-csg wedge subtraction was prototyped but produced NON-watertight
 * output (boundary edges that vertex-welding can't seal — the same reason the
 * global mesh chamfer is built analytically, not via CSG). Shipping non-manifold
 * geometry would violate the project's block-rather-than-silently-wrong policy,
 * so the per-edge mesh BEVEL is deferred to a watertight analytic builder; OCCT
 * remains the per-edge path today. The edge-identity resolution here is the part
 * that is correct and verifiable now.
 */
import { remapPointThroughBbox } from './topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

export type Axis = 'x' | 'y' | 'z';
/** A box edge: the extrude axis + the signs of the two perpendicular coords. */
export interface BoxEdgeId { axis: Axis; sU: 1 | -1; sV: 1 | -1; }

export type BBox = { min: [number, number, number]; max: [number, number, number] };

/** Perpendicular axes for an extrude axis, in a fixed (u, v) order. */
export function perpAxes(axis: Axis): [Axis, Axis] {
  return axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['z', 'x'] : ['x', 'y'];
}

const axisIdx = (a: Axis) => (a === 'x' ? 0 : a === 'y' ? 1 : 2);

/** Canonical string key for set/dedupe use. */
export function boxEdgeKey(e: BoxEdgeId): string {
  return `${e.axis}${e.sU > 0 ? 'p' : 'm'}${e.sV > 0 ? 'p' : 'm'}`;
}

/**
 * Resolve an edge selection to a box-edge id: the click direction picks the axis,
 * and the bbox-relative click position picks the two perpendicular corner signs.
 * Because the signs are read relative to the CURRENT bbox centre (after remapping
 * the stored click point through the bbox change), the id is invariant under an
 * upstream dimension change — that is the selection-survival property on a mesh.
 * Returns null when the selection carries no direction (can't pick an axis).
 */
export function boxEdgeFromSelection(
  selection: EdgeSelectionInfo,
  currentBbox: BBox,
): BoxEdgeId | null {
  const dir = selection.direction;
  if (!dir) return null;
  const ax = Math.abs(dir[0]); const ay = Math.abs(dir[1]); const az = Math.abs(dir[2]);
  const axis: Axis = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
  const [uA, vA] = perpAxes(axis);

  const p = remapPointThroughBbox(selection.position, selection.bbox, currentBbox);
  const centre = (a: Axis) => (currentBbox.min[axisIdx(a)] + currentBbox.max[axisIdx(a)]) / 2;
  const sign = (a: Axis): 1 | -1 => (p[axisIdx(a)] >= centre(a) ? 1 : -1);
  return { axis, sU: sign(uA), sV: sign(vA) };
}
