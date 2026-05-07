'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useMemo, useState } from 'react';
import type { ShapeResult } from './shapes';
import type { BomPartResult } from './ShapePreview';
import SectionPlane from './SectionPlane';
import { computeAssemblyWorldBounds } from './assembly/assemblyWorldBounds';

const PART_COLORS = ['#8b9cf4', '#f4a28b', '#8bf4b0', '#f4e08b', '#c48bf4', '#8bd8f4', '#f48bb0', '#b0f48b', '#f4c88b', '#8bf4e0'];

function ViewportMesh({
  result,
  bomParts,
}: {
  result: ShapeResult | null;
  bomParts?: BomPartResult[];
}) {
  const isAssembly = bomParts && bomParts.length > 0;

  if (isAssembly) {
    return (
      <>
        {bomParts.map((part, i) => {
          const rot = part.rotation
            ? (part.rotation.map(d => d * Math.PI / 180) as [number, number, number])
            : undefined;
          return (
            <group key={i} position={part.position} rotation={rot}>
              <mesh geometry={part.result.geometry} castShadow receiveShadow>
                <meshStandardMaterial
                  color={PART_COLORS[i % PART_COLORS.length]}
                  roughness={0.35}
                  metalness={0.4}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {part.result.edgeGeometry && (
                <lineSegments geometry={part.result.edgeGeometry}>
                  <lineBasicMaterial color="#60a5fa" />
                </lineSegments>
              )}
            </group>
          );
        })}
      </>
    );
  }

  if (!result) return null;

  return (
    <group>
      <mesh geometry={result.geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#8b9cf4" roughness={0.35} metalness={0.4} side={THREE.DoubleSide} />
      </mesh>
      {result.edgeGeometry && (
        <lineSegments geometry={result.edgeGeometry}>
          <lineBasicMaterial color="#60a5fa" />
        </lineSegments>
      )}
    </group>
  );
}

interface ViewportConfig {
  label: string;
  camera: { position: [number, number, number]; up?: [number, number, number] };
  orthographic: boolean;
}

const VIEWPORTS: ViewportConfig[] = [
  { label: 'Front', camera: { position: [0, 0, 200] }, orthographic: true },
  { label: 'Right', camera: { position: [200, 0, 0] }, orthographic: true },
  { label: 'Top', camera: { position: [0, 200, 0], up: [0, 0, -1] }, orthographic: true },
  { label: '3D', camera: { position: [50, 50, 50] }, orthographic: false },
];

function SingleViewport({
  config,
  result,
  bomParts,
  bottomY,
  isActive,
  onActivate,
  sectionActive,
  sectionAxis,
  sectionOffset,
  assemblyWorldBounds,
  singleSectionResult,
  gridCellSize,
}: {
  config: ViewportConfig;
  result: ShapeResult | null;
  bomParts?: BomPartResult[];
  bottomY: number;
  isActive: boolean;
  onActivate: () => void;
  sectionActive: boolean;
  sectionAxis: 'x' | 'y' | 'z';
  sectionOffset: number;
  assemblyWorldBounds: { min: [number, number, number]; max: [number, number, number] } | null;
  singleSectionResult: ShapeResult | null;
  gridCellSize: number;
}) {
  const isAssembly = bomParts && bomParts.length > 0;
  const showSection =
    sectionActive &&
    (isAssembly && assemblyWorldBounds
      ? true
      : !isAssembly && !!singleSectionResult);

  return (
    <div
      onClick={onActivate}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        border: isActive ? '2px solid #388bfd' : '1px solid #30363d',
        boxSizing: 'border-box',
        background: '#0d1117',
        cursor: 'pointer',
      }}
    >
      {/* Label */}
      <div style={{
        position: 'absolute',
        top: 6,
        left: 8,
        zIndex: 10,
        background: 'rgba(13,17,23,0.8)',
        color: isActive ? '#388bfd' : '#8b949e',
        fontSize: '11px',
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: '4px',
        border: '1px solid rgba(48,54,61,0.6)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        {config.label}
      </div>

      <Canvas
        orthographic={config.orthographic}
        camera={
          config.orthographic
            ? {
                position: config.camera.position,
                zoom: 3,
                up: config.camera.up || [0, 1, 0],
                near: -10000,
                far: 10000,
              }
            : {
                position: config.camera.position,
                fov: 50,
              }
        }
        shadows
        gl={{ antialias: true }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#0d1117']} />
        <hemisphereLight args={['#c8d8ff', '#0a0a1a', 0.7]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[20, 30, 15]} intensity={1.4} castShadow />
        <directionalLight position={[-15, 10, -10]} intensity={0.5} color="#c8d8ff" />
        <Suspense fallback={null}>
          <ViewportMesh result={result} bomParts={bomParts} />
          {showSection && (isAssembly && assemblyWorldBounds ? (
            <SectionPlane
              enabled
              axis={sectionAxis}
              offset={sectionOffset}
              worldBoxMin={assemblyWorldBounds.min}
              worldBoxMax={assemblyWorldBounds.max}
            />
          ) : (
            <SectionPlane enabled axis={sectionAxis} offset={sectionOffset} result={singleSectionResult} />
          ))}
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.07}
            enableRotate={!config.orthographic}
            minDistance={config.orthographic ? undefined : 1}
            maxDistance={config.orthographic ? undefined : 5000}
          />
        </Suspense>
        <Grid
          args={[2000, 2000]}
          position={[0, bottomY - 2, 0]}
          cellSize={gridCellSize}
          cellThickness={0.4}
          cellColor="#1c2128"
          sectionSize={50}
          sectionThickness={0.8}
          sectionColor="#30363d"
          fadeDistance={600}
          fadeStrength={3}
          infiniteGrid
        />
      </Canvas>
    </div>
  );
}

interface MultiViewportProps {
  result: ShapeResult | null;
  bomParts?: BomPartResult[];
  sectionActive?: boolean;
  sectionAxis?: 'x' | 'y' | 'z';
  sectionOffset?: number;
  /** Matches main viewport grid / transform snap step (mm). */
  snapGrid?: number;
  /** Same as ShapePreview — affects assembly section bounds union. */
  explodeFactor?: number;
}

export default function MultiViewport({
  result,
  bomParts,
  sectionActive = false,
  sectionAxis = 'y',
  sectionOffset = 0.5,
  snapGrid,
  explodeFactor = 0,
}: MultiViewportProps) {
  const [activeIndex, setActiveIndex] = useState(3); // default to 3D view

  const allResults = useMemo(() => {
    if (bomParts && bomParts.length > 0) return bomParts.map(p => p.result);
    return result ? [result] : [];
  }, [result, bomParts]);

  const bottomY = useMemo(() => {
    if (allResults.length === 0) return 0;
    let minY = Infinity;
    for (const r of allResults) {
      r.geometry.computeBoundingBox();
      const y = r.geometry.boundingBox?.min.y ?? 0;
      if (y < minY) minY = y;
    }
    return minY === Infinity ? 0 : minY;
  }, [allResults]);

  const assemblyWorldBounds = useMemo(() => {
    if (!bomParts?.length) return null;
    return computeAssemblyWorldBounds(bomParts, explodeFactor);
  }, [bomParts, explodeFactor]);

  const gridCell = typeof snapGrid === 'number' && snapGrid > 0 ? snapGrid : 10;

  const hasContent = allResults.length > 0;

  if (!hasContent) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#0d1117', flexDirection: 'column', gap: '8px',
      }}>
        <span style={{ fontSize: '32px', opacity: 0.3 }}>&#x1f9ca;</span>
        <p style={{ color: '#484f58', fontSize: '13px' }}>Select a shape to preview</p>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: '1px',
      background: '#30363d',
    }}>
      {VIEWPORTS.map((config, i) => (
        <SingleViewport
          key={config.label}
          config={config}
          result={result}
          bomParts={bomParts}
          bottomY={bottomY}
          isActive={activeIndex === i}
          onActivate={() => setActiveIndex(i)}
          sectionActive={sectionActive}
          sectionAxis={sectionAxis}
          sectionOffset={sectionOffset}
          assemblyWorldBounds={assemblyWorldBounds}
          singleSectionResult={result}
          gridCellSize={gridCell}
        />
      ))}
    </div>
  );
}
