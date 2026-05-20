'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

interface Props {
  sourceGeometry: THREE.BufferGeometry;
  /** Single group or multiple groups (multi-select). All rendered with same color. */
  triangleIndices: number[];
  /** Additional index groups for multi-select highlight (rendered in accent color). */
  additionalGroups?: number[][];
  color?: string;
  opacity?: number;
}

/**
 * Renders a semi-transparent highlight over specific triangles of sourceGeometry.
 * Used to visually mark the selected face group.
 */
export default function FaceHighlightMesh({
  sourceGeometry,
  triangleIndices,
  additionalGroups,
  color = '#22d3ee',
  opacity = 0.35,
}: Props) {
  const allIndices = useMemo(() => {
    if (!additionalGroups?.length) return triangleIndices;
    return [...triangleIndices, ...additionalGroups.flat()];
  }, [triangleIndices, additionalGroups]);

  const highlightGeo = useMemo(() => {
    if (!allIndices.length) return null;
    const triangleIndices = allIndices;
    const srcPos = sourceGeometry.attributes.position;
    const triCount = triangleIndices.length;
    const positions = new Float32Array(triCount * 9);

    let out = 0;
    for (const ti of triangleIndices) {
      const base = ti * 3;
      for (let v = 0; v < 3; v++) {
        positions[out++] = srcPos.getX(base + v);
        positions[out++] = srcPos.getY(base + v);
        positions[out++] = srcPos.getZ(base + v);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }, [sourceGeometry, allIndices]);

  // Dispose the geometry on unmount or when allIndices changes — useMemo
  // recreates it but doesn't free the old one, so without this cleanup
  // every face-selection click leaks GPU memory.
  useEffect(() => {
    return () => { highlightGeo?.dispose(); };
  }, [highlightGeo]);

  if (!highlightGeo) return null;

  return (
    <mesh geometry={highlightGeo} renderOrder={1}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
