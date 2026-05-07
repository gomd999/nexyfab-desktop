'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { FEABoundaryCondition } from './simpleFEA';

interface FEAConditionMarkersProps {
  geometry: THREE.BufferGeometry;
  conditions: FEABoundaryCondition[];
  /** Index of the condition currently highlighted in the FEA panel (e.g., on hover). */
  highlightedIdx?: number | null;
  /** Click on a marker → select that condition in the panel */
  onMarkerClick?: (idx: number) => void;
}

/**
 * Renders 3D markers for FEA boundary conditions during setup (before solve).
 * - Fixed (anchor): green wedge at face centroid + small label
 * - Force/Pressure (arrow): orange arrow showing direction & magnitude
 *
 * Uses face centroids derived from geometry.position; faceIndices treated as
 * triangle indices in the non-indexed mesh.
 */
export default function FEAConditionMarkers({
  geometry,
  conditions,
  highlightedIdx = null,
  onMarkerClick,
}: FEAConditionMarkersProps) {
  // Pre-compute the centroid + normal of every triangle.
  const triData = useMemo(() => {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.attributes.position;
    const triCount = pos.count / 3;
    const centroids = new Float32Array(triCount * 3);
    const normals = new Float32Array(triCount * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < triCount; i++) {
      a.fromBufferAttribute(pos, i * 3 + 0);
      b.fromBufferAttribute(pos, i * 3 + 1);
      c.fromBufferAttribute(pos, i * 3 + 2);
      centroids[i * 3 + 0] = (a.x + b.x + c.x) / 3;
      centroids[i * 3 + 1] = (a.y + b.y + c.y) / 3;
      centroids[i * 3 + 2] = (a.z + b.z + c.z) / 3;
      ab.subVectors(b, a); ac.subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      normals[i * 3 + 0] = n.x; normals[i * 3 + 1] = n.y; normals[i * 3 + 2] = n.z;
    }
    return { centroids, normals, triCount };
  }, [geometry]);

  // For each condition, compute its representative point: average centroid of all faces
  const markers = useMemo(() => {
    return conditions.map((cond, idx) => {
      const { faceIndices, type, value } = cond;
      if (faceIndices.length === 0) return null;
      const pos = new THREE.Vector3();
      const normal = new THREE.Vector3();
      let validCount = 0;
      for (const fi of faceIndices) {
        if (fi < 0 || fi >= triData.triCount) continue;
        pos.x += triData.centroids[fi * 3 + 0];
        pos.y += triData.centroids[fi * 3 + 1];
        pos.z += triData.centroids[fi * 3 + 2];
        normal.x += triData.normals[fi * 3 + 0];
        normal.y += triData.normals[fi * 3 + 1];
        normal.z += triData.normals[fi * 3 + 2];
        validCount++;
      }
      if (validCount === 0) return null;
      pos.divideScalar(validCount);
      normal.divideScalar(validCount).normalize();
      return { idx, type, value, pos, normal, faceCount: faceIndices.length };
    }).filter(Boolean) as Array<{
      idx: number; type: FEABoundaryCondition['type']; value?: [number, number, number];
      pos: THREE.Vector3; normal: THREE.Vector3; faceCount: number;
    }>;
  }, [conditions, triData]);

  // Estimate marker size from geometry bbox
  const markerScale = useMemo(() => {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return 5;
    const size = bb.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) * 0.06;
  }, [geometry]);

  return (
    <group>
      {markers.map(m => {
        const isHighlighted = highlightedIdx === m.idx;
        const baseColor = m.type === 'fixed' ? '#3fb950' : '#f0883e';
        const color = isHighlighted ? '#58a6ff' : baseColor;
        const scale = isHighlighted ? markerScale * 1.4 : markerScale;
        if (m.type === 'fixed') {
          // Anchor: small octahedron with cone "spikes" pointing into the surface
          return (
            <group key={m.idx} position={m.pos.toArray()}>
              <mesh
                onClick={(e) => { e.stopPropagation(); onMarkerClick?.(m.idx); }}
                onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                onPointerOut={() => { document.body.style.cursor = ''; }}
              >
                <octahedronGeometry args={[scale * 0.5]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.3} metalness={0.7} />
              </mesh>
              <Html distanceFactor={120} position={[0, scale * 1.2, 0]} center>
                <div style={{
                  background: 'rgba(63,185,80,0.9)', color: '#fff',
                  padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>
                  🔒 Fixed ({m.faceCount})
                </div>
              </Html>
            </group>
          );
        }
        // Force/pressure: arrow along value vector (or surface normal if no value)
        const dir = m.value
          ? new THREE.Vector3(m.value[0], m.value[1], m.value[2])
          : m.normal.clone().multiplyScalar(-1); // pressure pushes inward
        const mag = dir.length();
        if (mag < 1e-6) dir.copy(m.normal).multiplyScalar(-1);
        const dirN = dir.clone().normalize();
        // Arrow length proportional to magnitude (clamped)
        const arrowLen = scale * (1 + Math.min(2, Math.log10(Math.max(1, mag)) * 0.5));
        // Arrow start offset slightly from surface
        const start = m.pos.clone().add(m.normal.clone().multiplyScalar(scale * 0.5));
        // Compute rotation: align +Y to dirN
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirN);
        const shaftPos = start.clone().add(dirN.clone().multiplyScalar(arrowLen / 2));
        const headPos = start.clone().add(dirN.clone().multiplyScalar(arrowLen));
        const labelText = m.type === 'force'
          ? `⬇ ${mag.toFixed(0)} N (${m.faceCount})`
          : `⬇ ${mag.toFixed(0)} Pa (${m.faceCount})`;
        return (
          <group key={m.idx}>
            {/* Shaft */}
            <mesh
              position={shaftPos.toArray()}
              quaternion={quat.toArray() as [number, number, number, number]}
              onClick={(e) => { e.stopPropagation(); onMarkerClick?.(m.idx); }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
              onPointerOut={() => { document.body.style.cursor = ''; }}
            >
              <cylinderGeometry args={[scale * 0.08, scale * 0.08, arrowLen, 12]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
            </mesh>
            {/* Head */}
            <mesh
              position={headPos.toArray()}
              quaternion={quat.toArray() as [number, number, number, number]}
              onClick={(e) => { e.stopPropagation(); onMarkerClick?.(m.idx); }}
            >
              <coneGeometry args={[scale * 0.25, scale * 0.5, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
            </mesh>
            <Html distanceFactor={120} position={headPos.clone().add(dirN.clone().multiplyScalar(scale * 0.6)).toArray() as [number, number, number]} center>
              <div style={{
                background: 'rgba(240,136,62,0.9)', color: '#fff',
                padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>
                {labelText}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
