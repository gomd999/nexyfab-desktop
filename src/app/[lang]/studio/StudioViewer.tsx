'use client';

/** Studio 3D viewer — an R3F canvas that auto-frames the rendered mesh with
 *  orbit controls and premium PBR lighting (RoomEnvironment reflections +
 *  ACES tone mapping + contact shadows) so generated parts read like real
 *  machined metal / product renders. preserveDrawingBuffer lets the parent
 *  grab a thumbnail of the canvas for the chat history. */
import React, { useMemo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Center, Bounds, ContactShadows } from '@react-three/drei';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as THREE from 'three';

/** Procedural studio IBL (no external HDR / CDN) — soft neutral reflections
 *  that make metalness/roughness read correctly, like the reference atelier. */
function StudioEnv() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { env.dispose(); pmrem.dispose(); scene.environment = null; };
  }, [gl, scene]);
  return null;
}

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
        {/* Per-colour group (CADAM-style) when available, else a single mesh
            rendered as brushed metal so precise CAD parts look manufactured. */}
        {object ? <primitive object={object} /> : geo ? (
          <mesh geometry={geo} castShadow receiveShadow>
            <meshStandardMaterial color="#c4c7cd" metalness={0.85} roughness={0.34} envMapIntensity={1.1} />
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
      gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ position: [120, 90, 140], fov: 45 }}
      style={{ width: '100%', height: '100%', background: light ? 'radial-gradient(circle at 50% 30%, #f3f5f8 0%, #dfe4ea 75%)' : 'radial-gradient(circle at 50% 30%, #232327 0%, #161618 70%)' }}
    >
      <StudioEnv />
      <ambientLight intensity={light ? 0.5 : 0.35} />
      {/* Warm key + cool rim — a directional highlight over the soft IBL. */}
      <directionalLight position={[80, 140, 100]} intensity={light ? 1.4 : 1.6} color="#fff4e0" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-100, 50, -80]} intensity={0.45} color="#cfe0ff" />
      {(geometry || object) && <Model geometry={geometry} object={object} fitKey={fitKey} />}
      {/* Soft grounding shadow under the part (premium product-render feel). */}
      <ContactShadows position={[0, -0.01, 0]} scale={400} far={300} blur={2.4} opacity={light ? 0.4 : 0.55} color={light ? '#8b93a0' : '#000000'} resolution={1024} />
      <Grid args={[600, 600]} cellSize={10} cellColor={light ? '#c4ccd6' : '#2e2e33'} sectionSize={50} sectionColor={light ? '#aab4c0' : '#3a3a42'} position={[0, -0.02, 0]} infiniteGrid fadeDistance={650} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}
