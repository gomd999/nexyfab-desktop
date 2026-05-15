'use client';

import { Environment, ContactShadows, Lightformer } from '@react-three/drei';
import { useThree, useLoader } from '@react-three/fiber';
import { useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export type EnvironmentPreset = 'studio' | 'city' | 'sunset' | 'forest' | 'warehouse';

const ENV_TINTS: Record<EnvironmentPreset, { top: string; key: string; fill: string; rim: string }> = {
  studio:    { top: '#ffffff', key: '#ffffff', fill: '#c8d8ff', rim: '#ffe8d0' },
  city:      { top: '#c8d0e0', key: '#fff0d0', fill: '#a0b8e0', rim: '#ffe0a8' },
  sunset:    { top: '#ff9060', key: '#ff7040', fill: '#8060a0', rim: '#ffb070' },
  forest:    { top: '#a8c098', key: '#c8e0a0', fill: '#80a0b0', rim: '#d8e8c0' },
  warehouse: { top: '#e6e8ec', key: '#fff5e8', fill: '#a8b0c0', rim: '#d8c8a8' },
};

export interface RenderModeProps {
  environment: EnvironmentPreset;
  showBackground: boolean;
  shadowIntensity: number;
  bloomIntensity: number;
  showGround: boolean;
  exposure: number;
  /** Data URL or blob URL for a custom .hdr/.exr file uploaded by the user */
  customHdriUrl?: string;
}

/** Applies tone mapping + exposure to the GL renderer */
function ToneMapper({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- imperative Three.js renderer state */
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    return () => {
      gl.toneMapping = THREE.NoToneMapping;
      gl.toneMappingExposure = 1;
    };
    /* eslint-enable react-hooks/immutability */
  }, [gl, exposure]);
  return null;
}

/** Custom HDRI environment loaded from a blob/data URL */
function CustomHdriEnv({ url, showBackground }: { url: string; showBackground: boolean }) {
  const texture = useLoader(RGBELoader, url);
  const { scene, gl } = useThree();

  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- imperative Three.js scene / PMREM setup */
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    pmremGenerator.compileEquirectangularShader();
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    if (showBackground) scene.background = envMap;
    return () => {
      scene.environment = null;
      if (showBackground) scene.background = null;
      envMap.dispose();
      pmremGenerator.dispose();
    };
    /* eslint-enable react-hooks/immutability */
  }, [texture, scene, gl, showBackground]);

  return null;
}

export default function RenderMode({
  environment = 'studio',
  showBackground = false,
  shadowIntensity = 0.4,
  showGround = true,
  exposure = 1.0,
  customHdriUrl,
}: RenderModeProps) {
  return (
    <>
      <ToneMapper exposure={exposure} />

      {customHdriUrl ? (
        <Suspense fallback={null}>
          <CustomHdriEnv url={customHdriUrl} showBackground={showBackground} />
        </Suspense>
      ) : (
        // Procedural lights-only Environment — no HDRI CDN fetch, so the
        // photorealistic preview cannot fail due to a missing preset asset.
        // Users who want a real-world HDRI can upload one (customHdriUrl).
        <Environment background={showBackground} resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.0} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} color={ENV_TINTS[environment].top} />
          <Lightformer form="rect" intensity={2.5} position={[3, 3, 4]} scale={[5, 5, 1]} color={ENV_TINTS[environment].key} />
          <Lightformer form="rect" intensity={1.2} position={[-4, 2, 1]} rotation-y={Math.PI / 2} scale={[6, 4, 1]} color={ENV_TINTS[environment].fill} />
          <Lightformer form="rect" intensity={1.5} position={[0, 2, -4]} scale={[8, 3, 1]} color={ENV_TINTS[environment].rim} />
          <Lightformer form="rect" intensity={0.3} position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} color="#404040" />
        </Environment>
      )}

      {/* Key light */}
      <directionalLight position={[8, 12, 6]} intensity={1.8} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} shadow-normalBias={0.02} color="#fff5e8">
        <orthographicCamera attach="shadow-camera" args={[-50, 50, 50, -50, 0.1, 200]} />
      </directionalLight>

      {/* Fill light */}
      <directionalLight position={[-6, 8, -4]} intensity={0.6} color="#d0e0ff" />

      {/* Ambient base */}
      <ambientLight intensity={0.15} />

      {showGround && (
        <ContactShadows position={[0, -0.01, 0]} opacity={shadowIntensity} scale={200} blur={2.5} far={100} resolution={1024} color="#000000" />
      )}

      {showGround && (
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[500, 500]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.8} metalness={0.1} transparent opacity={0.6} />
        </mesh>
      )}
    </>
  );
}
