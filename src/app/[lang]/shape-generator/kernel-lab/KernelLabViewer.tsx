'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { ShapeResult } from '../shapes';

export default function KernelLabViewer({ result }: { result: ShapeResult }) {
  return (
    <Canvas camera={{ position: [25, 20, 25], fov: 45 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} />
      <mesh geometry={result.geometry}>
        <meshStandardMaterial color="#58a6ff" roughness={0.4} metalness={0.1} />
      </mesh>
      <lineSegments geometry={result.edgeGeometry}>
        <lineBasicMaterial color="#cbd5e1" />
      </lineSegments>
      <OrbitControls />
    </Canvas>
  );
}
