'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';

export interface UniqueFace {
  id: number;
  triangleIndices: number[]; // triangle indices (each value i → verts at i*3, i*3+1, i*3+2)
  normal: [number, number, number];
  center: [number, number, number];
}

// ---------------------------------------------------------------------------
// extractFaces
// ---------------------------------------------------------------------------
// Groups triangles from a non-indexed BufferGeometry into coplanar logical faces.
// Coplanar criteria: dot(n1, n2) > 0.98 AND same plane distance within 0.5 mm.

export function extractFaces(geometry: THREE.BufferGeometry): UniqueFace[] {
  const posAttr = geometry.attributes.position;
  const triCount = posAttr.count / 3;

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _ab = new THREE.Vector3();
  const _ac = new THREE.Vector3();
  const _n = new THREE.Vector3();

  // Per-triangle normals and plane distances
  const triNormals: THREE.Vector3[] = [];
  const triDistances: number[] = [];
  const triCenters: THREE.Vector3[] = [];

  for (let i = 0; i < triCount; i++) {
    const base = i * 3;
    _a.fromBufferAttribute(posAttr, base);
    _b.fromBufferAttribute(posAttr, base + 1);
    _c.fromBufferAttribute(posAttr, base + 2);

    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    _n.crossVectors(_ab, _ac).normalize();

    triNormals.push(_n.clone());
    triDistances.push(_n.dot(_a));
    triCenters.push(
      new THREE.Vector3(
        (_a.x + _b.x + _c.x) / 3,
        (_a.y + _b.y + _c.y) / 3,
        (_a.z + _b.z + _c.z) / 3,
      ),
    );
  }

  // Greedy grouping: each triangle joins the first compatible face group
  const faceOf = new Int32Array(triCount).fill(-1);
  const faces: UniqueFace[] = [];
  let nextFaceId = 0;

  for (let i = 0; i < triCount; i++) {
    if (faceOf[i] !== -1) continue;

    // Start a new face group
    const faceId = nextFaceId++;
    const faceNormal = triNormals[i].clone();
    const faceDist = triDistances[i];
    const members: number[] = [i];
    faceOf[i] = faceId;

    for (let j = i + 1; j < triCount; j++) {
      if (faceOf[j] !== -1) continue;

      const dot = faceNormal.dot(triNormals[j]);
      if (dot < 0.98) continue;
      if (Math.abs(triDistances[j] - faceDist) > 0.5) continue;

      faceOf[j] = faceId;
      members.push(j);
    }

    // Compute face center as average of triangle centers
    let cx = 0, cy = 0, cz = 0;
    for (const ti of members) {
      cx += triCenters[ti].x;
      cy += triCenters[ti].y;
      cz += triCenters[ti].z;
    }
    cx /= members.length;
    cy /= members.length;
    cz /= members.length;

    faces.push({
      id: faceId,
      triangleIndices: members,
      normal: [faceNormal.x, faceNormal.y, faceNormal.z],
      center: [cx, cy, cz],
    });
  }

  return faces;
}

// ---------------------------------------------------------------------------
// useFaceEditing hook
// ---------------------------------------------------------------------------

export function useFaceEditing(sourceGeometry: THREE.BufferGeometry | null) {
  const [revision, setRevision] = useState(0);
  const editGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const originalGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const [hasEdits, setHasEdits] = useState(false);
  const [selectedFaceId, setSelectedFaceId] = useState<number | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);

  // Clone + non-index geometry when source changes
  useEffect(() => {
    if (!sourceGeometry) {
      editGeoRef.current = null;
      originalGeoRef.current = null;
      setHasEdits(false);
      setRevision((r) => r + 1);
      return;
    }

    let geo = sourceGeometry.clone();
    if (geo.index) {
      geo = geo.toNonIndexed();
    }
    geo.computeVertexNormals();

    editGeoRef.current = geo;
    originalGeoRef.current = geo.clone();
    setHasEdits(false);
    setRevision((r) => r + 1);

    return () => {
      geo.dispose();
    };
  }, [sourceGeometry]);

  const editGeometry = editGeoRef.current;

  // Re-extract faces whenever geometry or revision changes
  const faces = useMemo<UniqueFace[]>(() => {
    if (!editGeometry) return [];
    void revision;
    return extractFaces(editGeometry);
  }, [editGeometry, revision]);

  // Push/pull: moves all vertices belonging to a face along its normal
  const pushPullFace = useCallback(
    (faceId: number, delta: number) => {
      const geo = editGeoRef.current;
      if (!geo) return;

      const face = faces.find((f) => f.id === faceId);
      if (!face) return;

      const [nx, ny, nz] = face.normal;
      const dx = nx * delta;
      const dy = ny * delta;
      const dz = nz * delta;

      const posAttr = geo.attributes.position as THREE.BufferAttribute;

      // Collect the unique buffer indices that belong to this face
      const affectedIndices = new Set<number>();
      for (const ti of face.triangleIndices) {
        affectedIndices.add(ti * 3);
        affectedIndices.add(ti * 3 + 1);
        affectedIndices.add(ti * 3 + 2);
      }

      for (const idx of affectedIndices) {
        posAttr.setXYZ(
          idx,
          posAttr.getX(idx) + dx,
          posAttr.getY(idx) + dy,
          posAttr.getZ(idx) + dz,
        );
      }

      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // Update the face's center in-place so FaceHandles stays in sync
      face.center[0] += dx;
      face.center[1] += dy;
      face.center[2] += dz;

      setHasEdits(true);
    },
    [faces],
  );

  const resetEdits = useCallback(() => {
    const original = originalGeoRef.current;
    if (!original) return;

    let geo = original.clone();
    if (geo.index) {
      geo = geo.toNonIndexed();
    }
    geo.computeVertexNormals();

    editGeoRef.current?.dispose();
    editGeoRef.current = geo;
    setHasEdits(false);
    setSelectedFaceId(null);
    setHoveredFaceId(null);
    setRevision((r) => r + 1);
  }, []);

  return {
    editGeometry,
    faces,
    selectedFaceId,
    setSelectedFaceId,
    hoveredFaceId,
    setHoveredFaceId,
    pushPullFace,
    resetEdits,
    hasEdits,
  };
}
