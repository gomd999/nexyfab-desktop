'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';

type EnvPreset = 'studio' | 'workshop' | 'overcast' | 'warehouse';
const HDRI_TO_DREI: Record<EnvPreset, 'studio' | 'lobby' | 'sunset' | 'warehouse'> = {
  studio: 'studio',
  workshop: 'lobby',
  overcast: 'sunset',
  warehouse: 'warehouse',
};

interface Props {
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
}

export function PbrSphereImpl({ color, roughness, metalness, exposure, hdri }: Props) {
  const preset = (HDRI_TO_DREI[hdri as EnvPreset] ?? 'studio') as 'studio' | 'lobby' | 'sunset' | 'warehouse';
  const isCssVar = color.startsWith('var(') || color.startsWith('rgb');
  // THREE.Color can't parse CSS vars or rgba; fall back to neutral gray.
  const meshColor = isCssVar ? '#888888' : color;
  return (
    <Canvas
      camera={{ position: [0, 0, 3.2], fov: 38 }}
      gl={{ antialias: true, toneMapping: 1 /* ACESFilmic */ }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = exposure;
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} />
      <Environment preset={preset} background={false} />
      <mesh>
        <sphereGeometry args={[1, 96, 96]} />
        <meshStandardMaterial
          color={meshColor}
          roughness={roughness}
          metalness={metalness}
        />
      </mesh>
      <OrbitControls enablePan={false} minDistance={2} maxDistance={6} />
    </Canvas>
  );
}
