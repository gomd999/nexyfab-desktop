'use client';

import { Environment, ContactShadows, Lightformer } from '@react-three/drei';
import { useThree, useLoader } from '@react-three/fiber';
import { useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export type EnvironmentPreset = 'studio' | 'city' | 'sunset' | 'forest' | 'warehouse';

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
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    return () => {
      gl.toneMapping = THREE.NoToneMapping;
      gl.toneMappingExposure = 1;
    };
  }, [gl, exposure]);
  return null;
}

/** Custom HDRI environment loaded from a blob/data URL */
function CustomHdriEnv({ url, showBackground }: { url: string; showBackground: boolean }) {
  const texture = useLoader(RGBELoader, url);
  const { scene, gl } = useThree();

  useEffect(() => {
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
        <Environment
          preset={environment as any}
          background={showBackground}
          environmentIntensity={1.2}
        >
          <Lightformer form="rect" intensity={2} position={[0, 4, -3]} scale={[10, 2, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={0.8} position={[-5, 2, 0]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} color="#c8d8ff" />
          <Lightformer form="circle" intensity={0.5} position={[5, 3, 2]} scale={[3, 3, 1]} color="#ffe8d0" />
          <Lightformer form="rect" intensity={1.5} position={[0, 2, 5]} scale={[8, 2, 1]} color="#ffffff" />
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
