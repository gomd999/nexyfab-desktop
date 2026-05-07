'use client';
import { useMemo } from 'react';
import * as THREE from 'three';

interface Props {
  sourceGeometry: THREE.BufferGeometry;
  triangleIndices: number[];
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
  color = '#22d3ee',
  opacity = 0.35,
}: Props) {
  const highlightGeo = useMemo(() => {
    if (!triangleIndices.length) return null;
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
  }, [sourceGeometry, triangleIndices]);

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
