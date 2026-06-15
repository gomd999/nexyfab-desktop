/**
 * Pipeline worker boundary — face-provenance round-trip tests.
 *
 * The worker serializes geometry as bare positions/normals/indices arrays;
 * BufferAttributes like `nfabFaceFeatureId` and userData maps like
 * `topoFaceMapByFeature` / `topoSketchExtrudeHashes` / `nfabFeatureIdMap`
 * are dropped by postMessage. workers/faceProvenanceTransfer.ts is the
 * explicit ferry (mirroring the topoEdgeSignatures pattern). These tests
 * assert the extract → structured-clone → apply round-trip leaves geometry
 * indistinguishable from the sync path for selection purposes.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  extractFaceProvenance,
  applyFaceProvenance,
  faceProvenanceTransferables,
  type FaceProvenancePayload,
} from '../workers/faceProvenanceTransfer';
import {
  stampFaceFeatureIdAll,
  getFaceFeatureIdStrict,
  FACE_FEATURE_ID_ATTR,
} from '../features/faceProvenance';

function stampedBox(featureId: string): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  stampFaceFeatureIdAll(geo, featureId);
  return geo;
}

/** Simulate the postMessage hop: structured clone of the plain payload. */
function crossBoundary(p: FaceProvenancePayload | undefined): FaceProvenancePayload | undefined {
  if (p === undefined) return undefined;
  return structuredClone(p);
}

const SAMPLE_TOPO = {
  featureId: 'sk-extrude-1',
  sweepFaces: ['hash-side-0', 'hash-side-1'],
  caps: ['hash-cap-top', 'hash-cap-bottom'] as [string, string],
  sideSegmentRanges: [{ startTri: 0, endTri: 12, hash: 'hash-side-0' }],
};

describe('faceProvenanceTransfer — worker boundary round-trip', () => {
  it('round-trips the nfabFaceFeatureId attribute and resolution map', () => {
    const src = stampedBox('feat-A');
    const payload = crossBoundary(extractFaceProvenance(src));

    // Rebuild the far-side geometry the way usePipelineWorker does:
    // positions only, then applyFaceProvenance.
    const dst = new THREE.BufferGeometry();
    dst.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array((src.attributes.position as THREE.BufferAttribute).array), 3));
    applyFaceProvenance(dst, payload);

    const attr = dst.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    expect(attr).toBeDefined();
    expect(attr.itemSize).toBe(1);
    expect(attr.count).toBe(src.attributes.position.count);
    // Strict (deep) reader resolves the same string id on every triangle —
    // no coarse fallback involved.
    expect(getFaceFeatureIdStrict(dst, 0)).toBe('feat-A');
    expect(getFaceFeatureIdStrict(dst, 5)).toBe('feat-A');
    expect(dst.userData.nfabFeatureIdMap).toEqual(src.userData.nfabFeatureIdMap);
  });

  it('round-trips topoFaceMapByFeature and topoSketchExtrudeHashes userData', () => {
    const src = stampedBox('feat-B');
    src.userData = {
      ...src.userData,
      topoFaceMapByFeature: { 'sk-extrude-1': SAMPLE_TOPO, box: { featureId: 'box', sweepFaces: [], caps: ['', ''], boxFaces: { 0: 'bx-px' } } },
      topoSketchExtrudeHashes: SAMPLE_TOPO,
    };

    const payload = crossBoundary(extractFaceProvenance(src));
    const dst = new THREE.BufferGeometry();
    applyFaceProvenance(dst, payload);

    expect(dst.userData.topoFaceMapByFeature).toEqual(src.userData.topoFaceMapByFeature);
    expect(dst.userData.topoSketchExtrudeHashes).toEqual(SAMPLE_TOPO);
    expect(dst.userData.lastFeatureId).toBe('feat-B');
  });

  it('does NOT ferry non-cloneable userData (occtHandle stays behind)', () => {
    const src = stampedBox('feat-C');
    src.userData = { ...src.userData, occtHandle: { fake: () => {} } };

    const payload = extractFaceProvenance(src)!;
    // The payload itself must be structured-clone safe.
    expect(() => structuredClone(payload)).not.toThrow();
    const dst = new THREE.BufferGeometry();
    applyFaceProvenance(dst, structuredClone(payload));
    expect('occtHandle' in dst.userData).toBe(false);
  });

  it('returns undefined for geometry with no provenance, and apply is a no-op', () => {
    const bare = new THREE.BoxGeometry(5, 5, 5).toNonIndexed();
    bare.userData = {};
    expect(extractFaceProvenance(bare)).toBeUndefined();

    const dst = new THREE.BufferGeometry();
    applyFaceProvenance(dst, undefined);
    expect(dst.getAttribute(FACE_FEATURE_ID_ATTR)).toBeUndefined();
    expect(Object.keys(dst.userData)).toHaveLength(0);
  });

  it('extract copies the attribute array so transferring never detaches the source', () => {
    const src = stampedBox('feat-D');
    const srcAttr = src.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    const payload = extractFaceProvenance(src)!;
    expect(payload.faceFeatureIds).toBeInstanceOf(Uint32Array);
    expect(payload.faceFeatureIds!.buffer).not.toBe((srcAttr.array as Uint32Array).buffer);
    // Transfer list exposes exactly the copied buffer.
    expect(faceProvenanceTransferables(payload)).toEqual([payload.faceFeatureIds!.buffer]);
    expect(faceProvenanceTransferables(undefined)).toEqual([]);
  });

  it('worker-path geometry matches sync-path geometry for the SelectionMesh lookup chain', () => {
    // Sync path: stamped attribute + featureMap → strict reader picks the
    // feature's own topo entry. Reproduce the exact lookup SelectionMesh
    // does (getFaceFeatureIdStrict → topoFaceMapByFeature[featureId]).
    const sync = stampedBox('sk-extrude-1');
    sync.userData = { ...sync.userData, topoFaceMapByFeature: { 'sk-extrude-1': SAMPLE_TOPO } };

    const payload = crossBoundary(extractFaceProvenance(sync));
    const workerPath = new THREE.BufferGeometry();
    workerPath.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array((sync.attributes.position as THREE.BufferAttribute).array), 3));
    applyFaceProvenance(workerPath, payload);

    for (const geo of [sync, workerPath]) {
      const fid = getFaceFeatureIdStrict(geo, 3);
      expect(fid).toBe('sk-extrude-1');
      const featureMap = (geo.userData as { topoFaceMapByFeature?: Record<string, typeof SAMPLE_TOPO> }).topoFaceMapByFeature;
      expect(featureMap?.[fid!]).toEqual(SAMPLE_TOPO);
    }
  });
});
