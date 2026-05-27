'use client';
import { useRef, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { FaceSelectionInfo, EdgeSelectionInfo, ElementSelectionInfo } from './selectionInfo';
import { normalToLabel } from './selectionInfo';
import { getFaceFeatureIdStrict } from '../features/faceProvenance';
import { findStableEdgeId, type TaggedEdgeSig } from '../features/topologyRegistry';

/** Returns the closest distance from point `p` to the line segment `ab`,
 *  and the projected world-space point on that segment. Used by the
 *  edge-snap path so a face click near a triangle edge promotes to an
 *  edge selection. */
function closestPointOnSegment(
  p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3,
): { dist: number; point: THREE.Vector3 } {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const lenSq = ab.dot(ab);
  if (lenSq < 1e-10) return { dist: ap.length(), point: a.clone() };
  const t = Math.max(0, Math.min(1, ap.dot(ab) / lenSq));
  const proj = new THREE.Vector3().copy(a).addScaledVector(ab, t);
  return { dist: p.distanceTo(proj), point: proj };
}

interface Props {
  geometry: THREE.BufferGeometry;
  onSelect: (info: ElementSelectionInfo, additive?: boolean) => void;
  onPointerDown?: (e: ThreeEvent<PointerEvent>, info: ElementSelectionInfo) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>, info: ElementSelectionInfo) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>, info: ElementSelectionInfo) => void;
}

// Group coplanar triangles by face normal (dot > 0.98 threshold)
function groupCoplanarFaces(geo: THREE.BufferGeometry): Array<{
  normal: THREE.Vector3;
  triangleIndices: number[];
  area: number;
}> {
  const pos = geo.attributes.position;
  const groups: Array<{ normal: THREE.Vector3; triangleIndices: number[]; area: number }> = [];
  const triCount = Math.floor(pos.count / 3);

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const faceNorm = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const base = i * 3;
    vA.fromBufferAttribute(pos, base);
    vB.fromBufferAttribute(pos, base + 1);
    vC.fromBufferAttribute(pos, base + 2);

    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    cross.crossVectors(edge1, edge2);
    const area = cross.length() * 0.5;
    if (area < 1e-10) continue;

    faceNorm.copy(cross).normalize();

    // Find matching group
    let found = false;
    for (const g of groups) {
      if (g.normal.dot(faceNorm) > 0.98) {
        g.triangleIndices.push(i);
        g.area += area;
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push({
        normal: faceNorm.clone(),
        triangleIndices: [i],
        area,
      });
    }
  }
  return groups;
}

export default function SelectionMesh({ geometry, onSelect, onPointerDown, onPointerMove, onPointerUp }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Cache coplanar groups — recompute only when geometry changes
  const groupsRef = useRef<ReturnType<typeof groupCoplanarFaces> | null>(null);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);

  const getGroups = useCallback(() => {
    if (geoRef.current !== geometry) {
      geoRef.current = geometry;
      groupsRef.current = groupCoplanarFaces(geometry);
    }
    return groupsRef.current!;
  }, [geometry]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!e.face || !meshRef.current) return;

    // Convert face normal to world space
    const worldNormal = e.face.normal.clone()
      .transformDirection(meshRef.current.matrixWorld)
      .normalize();

    const n: [number, number, number] = [worldNormal.x, worldNormal.y, worldNormal.z];
    const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];

    // Find coplanar group
    const groups = getGroups();
    let matchedGroup = groups.find(g => g.normal.dot(worldNormal) > 0.98);
    if (!matchedGroup && groups.length > 0) {
      // Fallback: find closest normal
      let bestDot = -1;
      for (const g of groups) {
        const d = g.normal.dot(worldNormal);
        if (d > bestDot) { bestDot = d; matchedGroup = g; }
      }
    }

    // Topology phase 3-d — boolean propagation. Each triangle carries a
    // per-vertex `nfabFaceFeatureId` attribute that survives CSG ops, so
    // we can identify which sketch-extrude (or base) it came from and pick
    // *that* feature's hash table from `topoFaceMapByFeature`. For meshes
    // that don't yet have the per-feature map (legacy stamps, raw base
    // shapes) we fall back to the single `topoSketchExtrudeHashes` blob
    // exactly like step 3-a.
    type FeatureTopo = {
      featureId: string;
      sweepFaces: string[];
      caps: [string, string];
      sideSegmentRanges?: { startTri: number; endTri: number; hash: string }[];
      /** Phase 3-f — box base shape's per-face hash keyed by BoxGeometry
       *  materialIndex (0=+x, 1=-x, 2=+y, 3=-y, 4=+z, 5=-z). */
      boxFaces?: Record<number, string>;
    };
    const featureMap = (geometry.userData as { topoFaceMapByFeature?: Record<string, FeatureTopo> } | undefined)?.topoFaceMapByFeature;
    let topo: FeatureTopo | undefined;
    if (featureMap && e.faceIndex != null) {
      // Look up which feature this triangle came from via the per-vertex
      // attribute three-bvh-csg preserved through the boolean.
      // (`faceIndex` is `number | null` on R3F Intersections, so the `!= null`
      // check narrows both undefined and null in one step.)
      const sourceFeatureId = getFaceFeatureIdStrict(geometry, e.faceIndex);
      if (sourceFeatureId && featureMap[sourceFeatureId]) {
        topo = featureMap[sourceFeatureId];
      }
    }
    if (!topo) {
      topo = (geometry.userData as { topoSketchExtrudeHashes?: FeatureTopo } | undefined)?.topoSketchExtrudeHashes;
    }
    // Phase 3-f — for primitive base shapes (box / cylinder / etc.) the
    // geometry has no `FACE_FEATURE_ID_ATTR` per-triangle attribute yet,
    // so the featureMap lookup above misses. Fall back to whichever
    // base-shape entry is present in the map (we expect exactly one for
    // a fresh primitive).
    if (!topo && featureMap) {
      topo = featureMap.box ?? featureMap.cylinder ?? featureMap.sphere;
    }
    let persistentId: string | undefined;
    if (topo) {
      const matIdx = e.face?.materialIndex;
      // Phase 3-f — box base shape: each face is its own materialIndex
      // (BoxGeometry tags 0..5 by face). If the stamp has the boxFaces
      // table this takes priority over the cap/sweep heuristic.
      if (topo.boxFaces && typeof matIdx === 'number' && topo.boxFaces[matIdx]) {
        persistentId = topo.boxFaces[matIdx];
      } else if (matIdx === 1) {
        // ExtrudeGeometry's cap group — disambiguate top/bottom by the
        // face normal's sign against the extrude axis (defaults to +Z
        // unless a tilted face frame was used; step C will pass the
        // exact frame normal in here).
        const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
        const max = Math.max(ax, ay, az);
        const dominant = max === ax ? n[0] : max === ay ? n[1] : n[2];
        persistentId = dominant >= 0 ? topo.caps[0] : topo.caps[1];
      } else if (matIdx === 0 && topo.sweepFaces.length > 0) {
        // Side wall — phase 3-b uses per-segment triangle ranges when
        // available so an individual swept face resolves to its
        // authoring sketch segment hash. Fallback to the coarse
        // "any sweep face" hash when the range table is missing
        // (legacy stamps, non-line profiles).
        const triIdx = e.faceIndex ?? 0;
        const range = topo.sideSegmentRanges?.find(
          r => triIdx >= r.startTri && triIdx < r.endTri,
        );
        persistentId = range?.hash ?? topo.sweepFaces[0];
      } else {
        // Non-ExtrudeGeometry source (booleaned downstream, etc.) —
        // fall back to the normal-dominance heuristic from step B.
        const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
        const max = Math.max(ax, ay, az);
        if (max > 0.95) {
          const dominant = max === ax ? n[0] : max === ay ? n[1] : n[2];
          persistentId = dominant >= 0 ? topo.caps[0] : topo.caps[1];
        } else if (topo.sweepFaces.length > 0) {
          persistentId = topo.sweepFaces[0];
        }
      }
    }

    // Phase C — edge snap. If the hit lands within EDGE_SNAP world units
    // of one of the triangle's 3 edges, promote the selection to an
    // EdgeSelectionInfo. Camera-scale snap radius keeps this consistent
    // with the measure tool's behaviour.
    const EDGE_SNAP = 1.5; // mm in world units (camera-relative scaling
                          // is phase-C2 — for now a fixed mm threshold).
    const meshObj = meshRef.current;
    if (e.face && meshObj && e.faceIndex != null) {
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      const idxAttr = geometry.index as THREE.BufferAttribute | null;
      const fi = e.faceIndex;
      // Resolve the 3 vertex indices, indexed or not.
      const v0i = idxAttr ? idxAttr.getX(fi * 3 + 0) : fi * 3 + 0;
      const v1i = idxAttr ? idxAttr.getX(fi * 3 + 1) : fi * 3 + 1;
      const v2i = idxAttr ? idxAttr.getX(fi * 3 + 2) : fi * 3 + 2;
      if (posAttr) {
        const m = meshObj.matrixWorld;
        const va = new THREE.Vector3(posAttr.getX(v0i), posAttr.getY(v0i), posAttr.getZ(v0i)).applyMatrix4(m);
        const vb = new THREE.Vector3(posAttr.getX(v1i), posAttr.getY(v1i), posAttr.getZ(v1i)).applyMatrix4(m);
        const vc = new THREE.Vector3(posAttr.getX(v2i), posAttr.getY(v2i), posAttr.getZ(v2i)).applyMatrix4(m);
        const candidates = [
          { a: va, b: vb },
          { a: vb, b: vc },
          { a: vc, b: va },
        ];
        const hit = e.point;
        let bestDist = Infinity;
        let bestSeg: { a: THREE.Vector3; b: THREE.Vector3 } | null = null;
        let bestProj: THREE.Vector3 | null = null;
        for (const seg of candidates) {
          const { dist, point } = closestPointOnSegment(hit, seg.a, seg.b);
          if (dist < bestDist) {
            bestDist = dist;
            bestSeg = seg;
            bestProj = point;
          }
        }
        if (bestSeg && bestProj && bestDist <= EDGE_SNAP) {
          // Edge persistentId: combine the source face hash with the
          // edge direction so two different edges of the same face don't
          // collapse to the same id. The "other adjacent face" half of
          // the canonical `edge_<f1>|<f2>` id lands in phase D.
          const dir = new THREE.Vector3().subVectors(bestSeg.b, bestSeg.a).normalize();
          const dirKey = `${dir.x.toFixed(2)},${dir.y.toFixed(2)},${dir.z.toFixed(2)}`;
          // Prefer a rebuild-stable topology id when the pipeline emitted one:
          // tag the click against the solid's tagged edge signatures so the
          // selection survives a chain of edits. Fall back to the face-hash id.
          const taggedSigs = geometry.userData?.topoEdgeSignatures as TaggedEdgeSig[] | undefined;
          const stableEdgeId = taggedSigs
            ? findStableEdgeId(taggedSigs, [bestProj.x, bestProj.y, bestProj.z], [dir.x, dir.y, dir.z])
            : null;
          const edgePersistentId = stableEdgeId
            ?? (persistentId ? `edge_${persistentId}|dir_${dirKey}` : undefined);
          // Capture the part's world bbox so the finder can remap the click
          // point when a dimension changes (scale-aware re-resolution).
          geometry.computeBoundingBox();
          const worldBox = geometry.boundingBox?.clone().applyMatrix4(m);
          const edgeInfo: EdgeSelectionInfo = {
            type: 'edge',
            position: [bestProj.x, bestProj.y, bestProj.z],
            length: bestSeg.a.distanceTo(bestSeg.b),
            normal: n,
            direction: [dir.x, dir.y, dir.z],
            bbox: worldBox
              ? { min: [worldBox.min.x, worldBox.min.y, worldBox.min.z], max: [worldBox.max.x, worldBox.max.y, worldBox.max.z] }
              : undefined,
            persistentId: edgePersistentId,
          };
          onSelect(edgeInfo, e.shiftKey);
          return;
        }
      }
    }

    const info: FaceSelectionInfo = {
      type: 'face',
      normal: n,
      position: pt,
      area: matchedGroup ? matchedGroup.area : 0,
      triangleCount: matchedGroup ? matchedGroup.triangleIndices.length : 1,
      normalLabel: normalToLabel(n, true),
      triangleIndices: matchedGroup ? matchedGroup.triangleIndices : [],
      persistentId,
    };

    onSelect(info, e.shiftKey);
  }, [getGroups, geometry, onSelect]);

  const handlePointerEvent = useCallback((e: ThreeEvent<PointerEvent>, handler?: (e: ThreeEvent<PointerEvent>, info: FaceSelectionInfo) => void) => {
    if (!handler || !e.face || !meshRef.current) return;
    const worldNormal = e.face.normal.clone()
      .transformDirection(meshRef.current.matrixWorld)
      .normalize();
    const n: [number, number, number] = [worldNormal.x, worldNormal.y, worldNormal.z];
    const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    
    handler(e, {
      type: 'face',
      normal: n,
      position: pt,
      area: 0,
      triangleCount: 1,
      normalLabel: normalToLabel(n, true),
      triangleIndices: [],
    });
  }, []);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerDown={onPointerDown ? (e) => handlePointerEvent(e, onPointerDown) : undefined}
      onPointerMove={onPointerMove ? (e) => handlePointerEvent(e, onPointerMove) : undefined}
      onPointerUp={onPointerUp ? (e) => handlePointerEvent(e, onPointerUp) : undefined}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
