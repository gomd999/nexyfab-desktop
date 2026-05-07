'use client';

import { useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

interface InstanceArrayProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  visible: boolean;
}

export default function InstanceArray({ geometry, material, matrices, visible }: InstanceArrayProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((mat, i) => {
      mesh.setMatrixAt(i, mat);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  if (!visible || matrices.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, matrices.length]}
        castShadow
        receiveShadow
      />
      <Html
        position={[0, 0, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[10, 20]}
      >
        <div style={{
          background: 'rgba(13,17,23,0.85)',
          border: '1px solid #30363d',
          borderRadius: '6px',
          padding: '3px 10px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#388bfd',
          fontFamily: 'system-ui, sans-serif',
          whiteSpace: 'nowrap',
        }}>
          ⊞ {matrices.length} instances
        </div>
      </Html>
    </group>
  );
}
