/**
 * Face-provenance transfer helpers for the pipeline worker boundary.
 *
 * The feature pipeline stamps two kinds of provenance onto its output
 * geometry that persistent face selection (editing/SelectionMesh.tsx)
 * depends on:
 *
 *   1. The per-vertex `nfabFaceFeatureId` Uint32 BufferAttribute plus its
 *      numeric→string resolution table `userData.nfabFeatureIdMap`
 *      (features/faceProvenance.ts — survives CSG via three-bvh-csg).
 *   2. The topology hash tables `userData.topoFaceMapByFeature` /
 *      `userData.topoSketchExtrudeHashes` (features/pipelineManager.ts,
 *      shapes/box|cylinder|sphere.ts) that map a picked triangle to a
 *      rebuild-stable persistent face id.
 *
 * Neither crosses `postMessage` on its own: BufferAttributes are not part
 * of the serialized arrays, and `userData` is dropped entirely (same issue
 * already solved for `topoEdgeSignatures` / `meshDowngrades`). These
 * helpers mirror that ferry pattern in both directions so worker-path
 * geometry is indistinguishable from sync-path geometry for selection.
 *
 * NOTE: `userData.occtHandle` (a live replicad/OCCT object) is deliberately
 * NOT ferried — it cannot be structured-cloned and must stay within the
 * context that created it.
 */

import * as THREE from 'three';
import { FACE_FEATURE_ID_ATTR } from '../features/faceProvenance';

/** Plain-JSON shape of one feature's topology stamp (see pipelineManager). */
export interface FeatureTopoJSON {
  featureId: string;
  sweepFaces: string[];
  caps: [string, string];
  sideSegmentRanges?: { startTri: number; endTri: number; hash: string }[];
  /** Box base shape's per-face hash keyed by BoxGeometry materialIndex. */
  boxFaces?: Record<number, string>;
}

/** Everything needed to reconstruct face provenance on the far side. */
export interface FaceProvenancePayload {
  /** Per-vertex numeric feature ids (itemSize 1); pairs with `featureIdMap`. */
  faceFeatureIds?: Uint32Array;
  /** Numeric id → feature id string map that resolves `faceFeatureIds`. */
  featureIdMap?: Record<number, string>;
  /** Per-feature topology hash tables for persistent face ids. */
  topoFaceMapByFeature?: Record<string, FeatureTopoJSON>;
  /** Legacy single-feature topo blob fallback. */
  topoSketchExtrudeHashes?: FeatureTopoJSON;
  /** Coarse whole-geometry provenance fallback. */
  lastFeatureId?: string;
}

/**
 * Snapshot face provenance off `geo` as transferable/structured-clone-safe
 * data. The attribute array is copied (like positions/normals) so adding it
 * to a transfer list never detaches the source geometry's live buffer.
 * Returns `undefined` when the geometry carries no provenance at all, so
 * callers can skip the field entirely.
 */
export function extractFaceProvenance(
  geo: THREE.BufferGeometry,
): FaceProvenancePayload | undefined {
  const out: FaceProvenancePayload = {};

  const attr = geo.getAttribute(FACE_FEATURE_ID_ATTR) as
    | THREE.BufferAttribute
    | undefined;
  if (attr?.array) {
    out.faceFeatureIds = new Uint32Array(attr.array as ArrayLike<number>);
  }

  const ud = geo.userData as
    | {
        nfabFeatureIdMap?: Record<number, string>;
        topoFaceMapByFeature?: Record<string, FeatureTopoJSON>;
        topoSketchExtrudeHashes?: FeatureTopoJSON;
        lastFeatureId?: string;
      }
    | undefined;
  if (ud?.nfabFeatureIdMap) out.featureIdMap = ud.nfabFeatureIdMap;
  if (ud?.topoFaceMapByFeature) out.topoFaceMapByFeature = ud.topoFaceMapByFeature;
  if (ud?.topoSketchExtrudeHashes) out.topoSketchExtrudeHashes = ud.topoSketchExtrudeHashes;
  if (typeof ud?.lastFeatureId === 'string') out.lastFeatureId = ud.lastFeatureId;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Re-attach a provenance payload onto `geo` so consumers (SelectionMesh,
 * getFaceFeatureIdStrict, DFM) see exactly what the producing context
 * stamped. Merges into existing userData; missing fields are left alone.
 */
export function applyFaceProvenance(
  geo: THREE.BufferGeometry,
  payload: FaceProvenancePayload | undefined,
): void {
  if (!payload) return;

  if (payload.faceFeatureIds) {
    geo.setAttribute(
      FACE_FEATURE_ID_ATTR,
      new THREE.BufferAttribute(payload.faceFeatureIds, 1),
    );
  }

  const ud: Record<string, unknown> = {};
  if (payload.featureIdMap) ud.nfabFeatureIdMap = payload.featureIdMap;
  if (payload.topoFaceMapByFeature) ud.topoFaceMapByFeature = payload.topoFaceMapByFeature;
  if (payload.topoSketchExtrudeHashes) ud.topoSketchExtrudeHashes = payload.topoSketchExtrudeHashes;
  if (payload.lastFeatureId !== undefined) ud.lastFeatureId = payload.lastFeatureId;
  if (Object.keys(ud).length > 0) {
    geo.userData = { ...geo.userData, ...ud };
  }
}

/**
 * ArrayBuffers in `payload` that should join the postMessage transfer list
 * (zero-copy hand-off, mirroring positions/normals/indices).
 */
export function faceProvenanceTransferables(
  payload: FaceProvenancePayload | undefined,
): ArrayBuffer[] {
  if (!payload?.faceFeatureIds) return [];
  return [payload.faceFeatureIds.buffer as ArrayBuffer];
}
