'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { UniqueVertex, UniqueEdge } from './types';

const EPSILON = 0.01; // 0.01mm spatial tolerance for vertex deduplication

function roundKey(x: number, y: number, z: number): string {
  return `${Math.round(x / EPSILON) * EPSILON}|${Math.round(y / EPSILON) * EPSILON}|${Math.round(z / EPSILON) * EPSILON}`;
}

function deduplicateVertices(geometry: THREE.BufferGeometry): UniqueVertex[] {
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const map = new Map<string, UniqueVertex>();
  let nextId = 0;

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = roundKey(x, y, z);

    const existing = map.get(key);
    if (existing) {
      existing.indices.push(i);
    } else {
      map.set(key, {
        id: nextId++,
        indices: [i],
        position: [x, y, z],
      });
    }
  }

  return Array.from(map.values());
}

function extractEdges(
  geometry: THREE.BufferGeometry,
  vertices: UniqueVertex[],
): UniqueEdge[] {
  const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
  const edgePosAttr = edgesGeo.attributes.position;
  const edgeCount = edgePosAttr.count / 2;

  // Build a spatial lookup from rounded position to UniqueVertex id
  const posToVertex = new Map<string, number>();
  for (const v of vertices) {
    const key = roundKey(v.position[0], v.position[1], v.position[2]);
    posToVertex.set(key, v.id);
  }

  const seen = new Set<string>();
  const edges: UniqueEdge[] = [];
  let nextId = 0;

  for (let i = 0; i < edgeCount; i++) {
    const ax = edgePosAttr.getX(i * 2);
    const ay = edgePosAttr.getY(i * 2);
    const az = edgePosAttr.getZ(i * 2);
    const bx = edgePosAttr.getX(i * 2 + 1);
    const by = edgePosAttr.getY(i * 2 + 1);
    const bz = edgePosAttr.getZ(i * 2 + 1);

    const keyA = roundKey(ax, ay, az);
    const keyB = roundKey(bx, by, bz);

    const vertA = posToVertex.get(keyA);
    const vertB = posToVertex.get(keyB);

    if (vertA === undefined || vertB === undefined) continue;
    if (vertA === vertB) continue;

    const edgeKey = vertA < vertB ? `${vertA}-${vertB}` : `${vertB}-${vertA}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);

    const vA = vertices[vertA];
    const vB = vertices[vertB];

    edges.push({
      id: nextId++,
      vertexA: vertA,
      vertexB: vertB,
      midpoint: [
        (vA.position[0] + vB.position[0]) / 2,
        (vA.position[1] + vB.position[1]) / 2,
        (vA.position[2] + vB.position[2]) / 2,
      ],
    });
  }

  edgesGeo.dispose();
  return edges;
}

export function useEditableGeometry(sourceGeometry: THREE.BufferGeometry | null) {
  const [revision, setRevision] = useState(0);
  const editGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const originalGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const [hasEdits, setHasEdits] = useState(false);

  // Clone geometry when source changes
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

  // Derive vertices and edges from current geometry + revision
  const vertices = useMemo(() => {
    if (!editGeometry) return [];
    // revision dependency forces recomputation
    void revision;
    return deduplicateVertices(editGeometry);
  }, [editGeometry, revision]);

  const edges = useMemo(() => {
    if (!editGeometry || vertices.length === 0) return [];
    void revision;
    return extractEdges(editGeometry, vertices);
  }, [editGeometry, vertices, revision]);

  const moveVertex = useCallback(
    (vertexId: number, newPos: [number, number, number]) => {
      const geo = editGeoRef.current;
      if (!geo) return;

      const vertex = vertices.find((v) => v.id === vertexId);
      if (!vertex) return;

      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      for (const idx of vertex.indices) {
        posAttr.setXYZ(idx, newPos[0], newPos[1], newPos[2]);
      }
      vertex.position[0] = newPos[0];
      vertex.position[1] = newPos[1];
      vertex.position[2] = newPos[2];

      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      setHasEdits(true);
    },
    [vertices],
  );

  const moveEdge = useCallback(
    (edgeId: number, delta: [number, number, number]) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;

      const vA = vertices.find((v) => v.id === edge.vertexA);
      const vB = vertices.find((v) => v.id === edge.vertexB);
      if (!vA || !vB) return;

      moveVertex(vA.id, [
        vA.position[0] + delta[0],
        vA.position[1] + delta[1],
        vA.position[2] + delta[2],
      ]);
      moveVertex(vB.id, [
        vB.position[0] + delta[0],
        vB.position[1] + delta[1],
        vB.position[2] + delta[2],
      ]);

      // Update midpoint
      edge.midpoint[0] = (vA.position[0] + vB.position[0]) / 2;
      edge.midpoint[1] = (vA.position[1] + vB.position[1]) / 2;
      edge.midpoint[2] = (vA.position[2] + vB.position[2]) / 2;
    },
    [edges, vertices, moveVertex],
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
    setRevision((r) => r + 1);
  }, []);

  return {
    editGeometry,
    vertices,
    edges,
    moveVertex,
    moveEdge,
    resetEdits,
    hasEdits,
  };
}
