/**
 * referenceGeometry/sketchPlaneAdapter.ts — bridge between sketch plane
 * consumers and the ref-geom store.
 *
 * Wave 2 Phase 2 Track D3. Spec §6.3, §10.1.
 *
 * The sketch system speaks `SketchPlaneSpec` (see `sketch/types.ts`); the
 * ref-geom subsystem speaks `ResolvedPlane`. Consumers like the 3D canvas,
 * extrude pipeline, and ConstructPlane viz all want the materialized
 * `{ origin, normal }` shape. This adapter resolves a `SketchPlaneSpec`
 * (or legacy `'xy'/'xz'/'yz'` literal) into a `ResolvedPlane`, walking
 * the ref-geom store when the spec is `refGeom`.
 *
 * Pure function. The caller passes in the node list (so the adapter is
 * SSR-safe and test-friendly — no hidden Zustand subscription).
 *
 * CRDT note: this is a *read* path. The store is still plain Zustand
 * (CRDT promotion deferred to D3b per spec §15); the consumer subscribes
 * to the store via `useReferenceGeometryStore`'s hook upstream, then
 * passes the snapshot here.
 */

import type { ReferenceNode, ResolvedPlane } from './types';
import type { SketchPlaneSpec, SketchStandardPlaneId } from '../sketch/types';
import { computeResolvedNodes } from './evaluator';
import { standardPlane, planeOffset } from './math';

/** Resolve a sketch plane spec into a `ResolvedPlane`.
 *
 *  - `standard` kind: standard world plane optionally offset along its
 *    normal. Spec §10.1.
 *  - `refGeom` kind: looks up the node in `nodes`, evaluates its plane
 *    via `computeResolvedNodes`. Returns `null` when the node is missing,
 *    not a plane, or has a downstream eval error.
 *
 *  Legacy literal `'xy'/'xz'/'yz'` is accepted directly for back-compat.
 */
export function resolveSketchPlane(
  spec: SketchPlaneSpec | SketchStandardPlaneId,
  nodes: readonly ReferenceNode[],
  legacyOffset = 0,
): ResolvedPlane | null {
  // Legacy literal path — spec §10.1 back-compat.
  if (typeof spec === 'string') {
    const base = standardPlane(spec);
    return legacyOffset === 0 ? base : planeOffset(base, legacyOffset);
  }

  if (spec.kind === 'standard') {
    const base = standardPlane(spec.plane);
    const off = spec.offset ?? 0;
    return off === 0 ? base : planeOffset(base, off);
  }

  // refGeom — resolve via the evaluator.
  const resolved = computeResolvedNodes(nodes);
  const value = resolved.values.get(spec.planeId);
  if (value === undefined || value.kind !== 'plane') return null;
  return value.value;
}

/** True iff a `SketchPlaneSpec` points at a ref-geom node that's no
 *  longer in `nodes`. Used by the sketch panel to disable the "Create
 *  sketch" button when the picked ref-geom plane was deleted. */
export function isSketchPlaneSpecStale(
  spec: SketchPlaneSpec,
  nodes: readonly ReferenceNode[],
): boolean {
  if (spec.kind !== 'refGeom') return false;
  return !nodes.some((n) => n.id === spec.planeId && n.kind === 'plane');
}
