'use client';

/**
 * MobileModelViewer — a lightweight, READ-ONLY touch 3D viewer for phones.
 *
 * The full CAD modeller is desktop-only, but the common mobile case is "someone
 * shared a design, I want to look at it on my phone." This renders the current
 * model in a minimal react-three-fiber canvas with touch orbit/zoom/pan
 * (OrbitControls: one finger rotates, two fingers dolly + pan) — no editing.
 * `touchAction: none` so the gesture drives the model, not page scroll.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center, Grid } from '@react-three/drei';
import type * as THREE from 'three';

interface MobileModelViewerProps {
  geometry: THREE.BufferGeometry;
  color?: string;
}

export default function MobileModelViewer({ geometry, color = '#3b82f6' }: MobileModelViewerProps) {
  return (
    <Canvas
      camera={{ position: [70, 50, 70], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
    >
      <color attach="background" args={['#0d1117']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[40, 60, 30]} intensity={1.1} />
      <directionalLight position={[-30, -10, -40]} intensity={0.35} />
      <Center>
        <mesh geometry={geometry}>
          <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} />
        </mesh>
      </Center>
      <Grid
        args={[400, 400]} cellSize={10} sectionSize={50} infiniteGrid fadeDistance={500}
        cellColor="#1f2937" sectionColor="#374151" position={[0, -0.01, 0]}
      />
      <OrbitControls makeDefault enablePan enableZoom enableRotate enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}
