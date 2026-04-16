'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { useEffect, useState } from 'react';
import * as THREE from 'three';

interface ModelViewerProps {
  meshDataBase64: string;
  metadata: { name: string; material?: string; bbox?: { w: number; h: number; d: number } };
}

export default function ModelViewer({ meshDataBase64, metadata }: ModelViewerProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    try {
      const json = atob(meshDataBase64);
      const data = JSON.parse(json) as {
        positions: number[];
        normals?: number[];
        indices?: number[];
      };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      if (data.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      if (data.indices) geo.setIndex(data.indices);
      else geo.computeVertexNormals();
      geo.computeBoundingBox();
      setGeometry(geo);
    } catch (e) {
      console.error('Failed to decode mesh', e);
    }
  }, [meshDataBase64]);

  // metadata is available for future use (e.g. material label overlay)
  void metadata;

  return (
    <Canvas
      camera={{ position: [100, 80, 100], fov: 45 }}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#0d1117']} />
      <hemisphereLight args={['#c8d8ff', '#0a0a1a', 0.7]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[20, 30, 15]} intensity={1.4} castShadow />
      <Environment preset="city" />
      {geometry && (
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial color="#8b9cf4" roughness={0.3} metalness={0.5} />
        </mesh>
      )}
      <OrbitControls enablePan={false} />
    </Canvas>
  );
}
