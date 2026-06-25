'use client';

/** Studio 3D viewer — an R3F canvas that auto-frames the rendered mesh with
 *  orbit controls and soft studio lighting. preserveDrawingBuffer lets the
 *  parent grab a thumbnail of the canvas for the chat history. */
import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Center, Bounds } from '@react-three/drei';
import * as THREE from 'three';

function Model({ geometry, object, fitKey }: { geometry: THREE.BufferGeometry | null; object: THREE.Object3D | null; fitKey: number }) {
  const geo = useMemo(() => {
    if (geometry && !geometry.attributes.normal) geometry.computeVertexNormals();
    return geometry;
  }, [geometry]);
  return (
    // Bounds re-fits the camera only when fitKey changes (a NEW generation) —
    // not on every slider tweak — so tuning dimensions doesn't reset the view.
    <Bounds fit clip margin={1.3} key={fitKey}>
      <Center>
        {/* Per-colour group (CADAM-style) when available, else a single mesh. */}
        {object ? <primitive object={object} /> : geo ? (
          <mesh geometry={geo} castShadow receiveShadow>
            <meshStandardMaterial color="#e8623a" metalness={0.1} roughness={0.6} />
          </mesh>
        ) : null}
      </Center>
    </Bounds>
  );
}

export default function StudioViewer({ geometry, object = null, fitKey = 0, theme = 'dark' }: { geometry: THREE.BufferGeometry | null; object?: THREE.Object3D | null; fitKey?: number; theme?: 'light' | 'dark' }) {
  const light = theme === 'light';
  return (
    <Canvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [120, 90, 140], fov: 45 }}
      style={{ width: '100%', height: '100%', background: light ? 'radial-gradient(circle at 50% 30%, #f3f5f8 0%, #dfe4ea 75%)' : 'radial-gradient(circle at 50% 30%, #232327 0%, #161618 70%)' }}
    >
      <ambientLight intensity={light ? 0.85 : 0.65} />
      <directionalLight position={[80, 140, 100]} intensity={1.15} castShadow />
      <directionalLight position={[-100, 40, -80]} intensity={0.3} />
      {(geometry || object) && <Model geometry={geometry} object={object} fitKey={fitKey} />}
      <Grid args={[600, 600]} cellSize={10} cellColor={light ? '#c4ccd6' : '#2e2e33'} sectionSize={50} sectionColor={light ? '#aab4c0' : '#3a3a42'} position={[0, -0.01, 0]} infiniteGrid fadeDistance={650} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}
