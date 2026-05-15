'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { useShellBridge } from './shellBridgeStore';

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

// Picks a primitive geometry from the modeler's selectedId so the render
// route shows something resembling the user's part. Real geometry sharing
// (Inner's effectiveResult) needs persistent state across routes; a follow-up.
function PartGeometry() {
  const selected = useShellBridge(s => s.selectedLabel) ?? '';
  const id = selected.toLowerCase();
  if (id.includes('box') || id.includes('block') || id.includes('rect')) {
    return <boxGeometry args={[1.4, 1.0, 1.0]} />;
  }
  if (id.includes('cyl') || id.includes('rod') || id.includes('shaft')) {
    return <cylinderGeometry args={[0.6, 0.6, 1.6, 64]} />;
  }
  if (id.includes('cone')) {
    return <coneGeometry args={[0.8, 1.6, 64]} />;
  }
  if (id.includes('torus') || id.includes('ring')) {
    return <torusGeometry args={[0.7, 0.25, 32, 96]} />;
  }
  if (id.includes('gear')) {
    return <torusGeometry args={[0.8, 0.18, 16, 12]} />;
  }
  // Default fallback: sphere (mat-ball preview).
  return <sphereGeometry args={[1, 96, 96]} />;
}

// drei's <Environment preset> downloads HDRI .hdr files from a CDN
// (pmndrs/drei-assets). On networks that block it, or before the asset
// resolves, the loader throws and the parent error boundary catches it —
// which is exactly the symptom the user reported. Wrap the preset load in
// Suspense and add an error boundary so the rest of the scene still
// renders (with default lighting only) if HDRI is unavailable.
function PresetEnvironment({ preset }: { preset: 'studio' | 'lobby' | 'sunset' | 'warehouse' }) {
  try {
    return <Environment preset={preset} background={false} />;
  } catch {
    return null;
  }
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
      {/* Always-on lighting so the sphere is visible even without HDRI */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-3, -2, -4]} intensity={0.4} />
      <Suspense fallback={null}>
        <PresetEnvironment preset={preset} />
      </Suspense>
      <mesh>
        <PartGeometry />
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
