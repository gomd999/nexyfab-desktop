'use client';

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { useShellBridge } from './shellBridgeStore';
import { readGeometry } from './geometryBridge';

type EnvPreset = 'studio' | 'workshop' | 'overcast' | 'warehouse';
const PRESET_TINTS: Record<EnvPreset, { key: string; fill: string; rim: string }> = {
  studio:    { key: '#ffffff', fill: '#c8d8ff', rim: '#ffe8d0' },
  workshop:  { key: '#ffe8c8', fill: '#b8c0d0', rim: '#fff8e8' },
  overcast:  { key: '#d8dce8', fill: '#a0a8b8', rim: '#c8d0e0' },
  warehouse: { key: '#fff5e8', fill: '#a8b0c0', rim: '#d8c8a8' },
};

interface Props {
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
  projectId?: string;
}

// Real-geometry mesh — uses the modeler's bridged geometry when available,
// auto-centered + auto-scaled to a unit reference box for the preview camera.
function RealPartMesh({
  geometry,
  color,
  roughness,
  metalness,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  roughness: number;
  metalness: number;
}) {
  const { offset, scale } = useMemo(() => {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const size = new THREE.Vector3().subVectors(bb.max, bb.min);
    const center = new THREE.Vector3().addVectors(bb.max, bb.min).multiplyScalar(0.5);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const targetSize = 1.8; // fits camera at z=3.2 fov=38
    return { offset: center, scale: targetSize / maxDim };
  }, [geometry]);
  return (
    <group position={[-offset.x * scale, -offset.y * scale, -offset.z * scale]} scale={scale}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
      </mesh>
    </group>
  );
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

// Procedural environment — produces env-map reflections from Lightformer
// children only, with no HDRI CDN fetch. Eliminates the
// "Could not load potsdamer_platz_1k.hdr" failure path entirely.
function PresetEnvironment({ preset }: { preset: EnvPreset }) {
  const tint = PRESET_TINTS[preset] ?? PRESET_TINTS.studio;
  return (
    <Environment background={false} resolution={256} frames={1}>
      <Lightformer form="rect" intensity={2.5} position={[3, 3, 4]} scale={[5, 5, 1]} color={tint.key} />
      <Lightformer form="rect" intensity={1.2} position={[-4, 2, 1]} rotation-y={Math.PI / 2} scale={[6, 4, 1]} color={tint.fill} />
      <Lightformer form="rect" intensity={1.5} position={[0, 2, -4]} scale={[8, 3, 1]} color={tint.rim} />
      <Lightformer form="rect" intensity={1.8} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} color="#ffffff" />
    </Environment>
  );
}

export function PbrSphereImpl({ color, roughness, metalness, exposure, hdri, projectId }: Props) {
  const preset = (hdri as EnvPreset) in PRESET_TINTS ? (hdri as EnvPreset) : 'studio';
  const isCssVar = color.startsWith('var(') || color.startsWith('rgb');
  // THREE.Color can't parse CSS vars or rgba; fall back to neutral gray.
  const meshColor = isCssVar ? '#888888' : color;

  // Try to consume the real modeler geometry bridged via sessionStorage.
  // Falls back to a primitive matching `selectedLabel` if not present.
  const bridged = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return readGeometry(projectId ?? 'local');
  }, [projectId]);

  return (
    <Canvas
      camera={{ position: [0, 0, 3.2], fov: 38 }}
      gl={{ antialias: true, toneMapping: 1 /* ACESFilmic */ }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = exposure;
      }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Always-on lighting so the part is visible even without HDRI */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-3, -2, -4]} intensity={0.4} />
      <Suspense fallback={null}>
        <PresetEnvironment preset={preset} />
      </Suspense>
      {bridged ? (
        <RealPartMesh
          geometry={bridged.geometry}
          color={meshColor}
          roughness={roughness}
          metalness={metalness}
        />
      ) : (
        <mesh>
          <PartGeometry />
          <meshStandardMaterial
            color={meshColor}
            roughness={roughness}
            metalness={metalness}
          />
        </mesh>
      )}
      <OrbitControls enablePan={false} minDistance={2} maxDistance={6} />
    </Canvas>
  );
}
