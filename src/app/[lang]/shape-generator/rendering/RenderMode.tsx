'use client';

import { Environment, ContactShadows, Lightformer } from '@react-three/drei';
import { useThree, useLoader } from '@react-three/fiber';
import { EffectComposer, DepthOfField, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, Suspense, type ReactElement } from 'react';
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
  /**
   * Depth-of-field (bokeh). Opt-in: when false (default) the render path is
   * byte-identical to before — no post-processing composer is mounted, so the
   * proven photorealistic look is untouched. When true, an EffectComposer with
   * a DepthOfField pass (+ bloom + ACES tone mapping) takes over rendering.
   */
  dofEnabled?: boolean;
  /** Focus plane distance, normalised camera near→far [0,1]. */
  dofFocusDistance?: number;
  /** Lens focal length, normalised [0,1] — larger = shallower depth of field. */
  dofFocalLength?: number;
  /** Bokeh blur kernel scale (px). */
  dofBokehScale?: number;
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

/** Sets ONLY the renderer's tone-mapping exposure. Used in the post-fx path,
 *  where the ACES curve is applied by the ToneMapping effect instead. */
function ExposureSetter({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- imperative Three.js renderer state */
    gl.toneMappingExposure = exposure;
    return () => {
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
  bloomIntensity = 0,
  showGround = true,
  exposure = 1.0,
  customHdriUrl,
  dofEnabled = false,
  dofFocusDistance = 0.02,
  dofFocalLength = 0.05,
  dofBokehScale = 3,
}: RenderModeProps) {
  // Post-processing is only mounted when DoF or bloom is requested. Otherwise
  // the renderer keeps its imperative ACES tone mapping (ToneMapper) and the
  // scene renders exactly as before — zero regression for the default path.
  const usePostFx = dofEnabled || bloomIntensity > 0;

  // EffectComposer's children prop is strictly typed (no false/null), so build
  // the effect list as a filtered array. ToneMapping is always last so the
  // bokeh/bloom buffers stay linear until the ACES curve is applied.
  const postFx: ReactElement[] = [];
  if (dofEnabled) {
    postFx.push(
      <DepthOfField
        key="dof"
        focusDistance={dofFocusDistance}
        focalLength={dofFocalLength}
        bokehScale={dofBokehScale}
      />,
    );
  }
  if (bloomIntensity > 0) {
    postFx.push(
      <Bloom key="bloom" intensity={bloomIntensity} luminanceThreshold={0.8} luminanceSmoothing={0.2} mipmapBlur />,
    );
  }
  postFx.push(<ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />);

  return (
    <>
      {/* Exposure always applies; tone-mapping curve is owned by ToneMapper in
          the default path, or by the ToneMapping effect when post-fx is on. */}
      {usePostFx ? <ExposureSetter exposure={exposure} /> : <ToneMapper exposure={exposure} />}

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

      {usePostFx && (
        <EffectComposer enableNormalPass={false} multisampling={4}>
          {postFx}
        </EffectComposer>
      )}
    </>
  );
}
