'use client';

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import type { Face, OptProgress } from './optimizer/types';

interface GenDesignViewerProps {
  dimX: number;
  dimY: number;
  dimZ: number;
  nx: number;
  ny: number;
  nz: number;
  fixedFaces: Face[];
  loads: Array<{ face: Face; force: [number, number, number] }>;
  selectionMode: 'none' | 'fixed' | 'load';
  onFaceClick: (face: Face) => void;
  resultMesh: THREE.BufferGeometry | null;
  isOptimizing: boolean;
  progress: OptProgress | null;
}

type DisplayMode = 'solid' | 'wireframe';

const FACE_LIST: Face[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

const MATERIAL_COLORS: Record<string, string> = {
  aluminum: '#b0b8c8',
  steel: '#8a929e',
  titanium: '#a0a8b4',
  abs: '#e8d8c8',
  nylon: '#d4d0c8',
};

interface FacePlaneProps {
  face: Face;
  dimX: number;
  dimY: number;
  dimZ: number;
  isFixed: boolean;
  isLoad: boolean;
  selectionMode: 'none' | 'fixed' | 'load';
  onClick: (face: Face) => void;
  loadForce?: [number, number, number];
}

function FacePlane({ face, dimX, dimY, dimZ, isFixed, isLoad, selectionMode, onClick, loadForce }: FacePlaneProps) {
  const [hovered, setHovered] = useState(false);

  const { position, rotation, size } = useMemo(() => {
    const hx = dimX / 2;
    const hy = dimY / 2;
    const hz = dimZ / 2;
    switch (face) {
      case '+x': return { position: new THREE.Vector3(hx, 0, 0), rotation: new THREE.Euler(0, Math.PI / 2, 0), size: [dimZ, dimY] as [number, number] };
      case '-x': return { position: new THREE.Vector3(-hx, 0, 0), rotation: new THREE.Euler(0, -Math.PI / 2, 0), size: [dimZ, dimY] as [number, number] };
      case '+y': return { position: new THREE.Vector3(0, hy, 0), rotation: new THREE.Euler(-Math.PI / 2, 0, 0), size: [dimX, dimZ] as [number, number] };
      case '-y': return { position: new THREE.Vector3(0, -hy, 0), rotation: new THREE.Euler(Math.PI / 2, 0, 0), size: [dimX, dimZ] as [number, number] };
      case '+z': return { position: new THREE.Vector3(0, 0, hz), rotation: new THREE.Euler(0, 0, 0), size: [dimX, dimY] as [number, number] };
      case '-z': return { position: new THREE.Vector3(0, 0, -hz), rotation: new THREE.Euler(0, Math.PI, 0), size: [dimX, dimY] as [number, number] };
    }
  }, [face, dimX, dimY, dimZ]);

  let color = '#888888';
  let opacity = 0.3;
  if (isFixed) { color = '#ef4444'; opacity = 0.6; }
  if (isLoad) { color = '#3b82f6'; opacity = 0.6; }
  if (hovered && selectionMode !== 'none') {
    opacity = Math.min(opacity + 0.25, 0.85);
  }

  const isInteractive = selectionMode !== 'none';

  return (
    <group position={position} rotation={rotation}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          if (isInteractive) onClick(face);
        }}
        onPointerOver={() => { if (isInteractive) setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[size[0], size[1]]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Load arrow */}
      {isLoad && loadForce && <LoadArrow force={loadForce} faceSize={size} />}
    </group>
  );
}

function LoadArrow({ force, faceSize }: { force: [number, number, number]; faceSize: [number, number] }) {
  const arrowRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!arrowRef.current) return;
    // Clear previous children
    while (arrowRef.current.children.length > 0) {
      arrowRef.current.remove(arrowRef.current.children[0]);
    }

    const dir = new THREE.Vector3(force[0], force[1], force[2]);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.normalize();

    const arrowLen = Math.min(faceSize[0], faceSize[1]) * 0.5;
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), arrowLen, 0x3b82f6, arrowLen * 0.25, arrowLen * 0.12);
    arrowRef.current.add(arrow);
  }, [force, faceSize]);

  return <group ref={arrowRef} />;
}

function BoxWireframe({ dimX, dimY, dimZ, opacity = 1 }: { dimX: number; dimY: number; dimZ: number; opacity?: number }) {
  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(dimX, dimY, dimZ);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [dimX, dimY, dimZ]);

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#60a5fa" transparent opacity={opacity} />
    </lineSegments>
  );
}

function PulsingBox({ dimX, dimY, dimZ }: { dimX: number; dimY: number; dimZ: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      const s = 0.97 + Math.sin(clock.getElapsedTime() * 3) * 0.03;
      meshRef.current.scale.set(s, s, s);
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.15 + Math.sin(clock.getElapsedTime() * 2) * 0.08;
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[dimX, dimY, dimZ]} />
      <meshStandardMaterial color="#8b5cf6" transparent opacity={0.15} depthWrite={false} />
    </mesh>
  );
}

function LiveDensityField({
  progress, nx, ny, nz, dimX, dimY, dimZ,
}: {
  progress: OptProgress;
  nx: number; ny: number; nz: number;
  dimX: number; dimY: number; dimZ: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const nElem = nx * ny * nz;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Element size
  const ex = dimX / nx;
  const ey = dimY / ny;
  const ez = dimZ / nz;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const densities = progress.densities;
    let count = 0;

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const eIdx = ix + iy * nx + iz * nx * ny;
          const d = densities[eIdx];
          if (d < 0.2) continue; // skip near-void elements

          dummy.position.set(
            -dimX / 2 + (ix + 0.5) * ex,
            -dimY / 2 + (iy + 0.5) * ey,
            -dimZ / 2 + (iz + 0.5) * ez,
          );
          dummy.scale.setScalar(ex * Math.pow(d, 0.5) * 0.95); // scale by sqrt(density) for visual
          dummy.updateMatrix();
          mesh.setMatrixAt(count, dummy.matrix);

          // Color: blue (low density) → orange (high density)
          const t = Math.min(1, Math.max(0, (d - 0.2) / 0.8));
          const color = new THREE.Color().setHSL(0.6 - t * 0.55, 0.8, 0.45 + t * 0.15);
          mesh.setColorAt(count, color);
          count++;
        }
      }
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [progress, nx, ny, nz, dimX, dimY, dimZ, ex, ey, ez, dummy]);

  // Max instances = nElem (conservative)
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, nElem]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors transparent opacity={0.85} />
    </instancedMesh>
  );
}

function ResultMeshComponent({ geometry, materialColor }: { geometry: THREE.BufferGeometry; materialColor: string }) {
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={materialColor}
        roughness={0.2}
        metalness={0.8}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function CameraFitter({ dimX, dimY, dimZ, fitKey }: { dimX: number; dimY: number; dimZ: number; fitKey: number }) {
  const { camera } = useThree();

  useEffect(() => {
    const maxDim = Math.max(dimX, dimY, dimZ);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 2.2;
    camera.position.set(dist * 0.7, dist * 0.55, dist * 0.7);
    camera.lookAt(0, 0, 0);
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [dimX, dimY, dimZ, camera, fitKey]);

  return null;
}

function CursorSetter({ selectionMode }: { selectionMode: string }) {
  const { gl } = useThree();

  useEffect(() => {
    gl.domElement.style.cursor = selectionMode !== 'none' ? 'pointer' : 'grab';
  }, [selectionMode, gl]);

  return null;
}

export default function GenDesignViewer({
  dimX, dimY, dimZ,
  nx, ny, nz,
  fixedFaces, loads,
  selectionMode, onFaceClick,
  resultMesh, isOptimizing, progress,
}: GenDesignViewerProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('solid');
  const [fitKey, setFitKey] = useState(0);

  const loadMap = useMemo(() => {
    const m = new Map<Face, [number, number, number]>();
    for (const l of loads) {
      m.set(l.face, l.force);
    }
    return m;
  }, [loads]);

  const fixedSet = useMemo(() => new Set(fixedFaces), [fixedFaces]);
  const hasResult = resultMesh !== null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', touchAction: 'none', userSelect: 'none' }}
      onDragStart={e => e.preventDefault()}>
      {/* Toolbar */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        right: 10,
        zIndex: 10,
        display: 'flex',
        gap: 6,
        justifyContent: 'flex-end',
      }}>
        {hasResult && (
          <>
            {(['solid', 'wireframe'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setDisplayMode(mode)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: displayMode === mode ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.2)',
                  background: displayMode === mode ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {mode === 'solid' ? 'Solid' : 'Wire'}
              </button>
            ))}
          </>
        )}
        <button
          onClick={() => setFitKey(k => k + 1)}
          style={{
            padding: '5px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
          }}
        >
          Reset Camera
        </button>
      </div>

      {/* Optimization overlay */}
      {isOptimizing && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          color: '#fff',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 40,
            height: 40,
            border: '3px solid rgba(255,255,255,0.2)',
            borderTop: '3px solid #8b5cf6',
            borderRadius: '50%',
            animation: 'genViewerSpin 1s linear infinite',
            margin: '0 auto 10px',
          }} />
          <div style={{ fontSize: 14, fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
            {progress
              ? `Iteration ${progress.iteration} / ${progress.maxIteration}`
              : 'Computing...'}
          </div>
          {progress && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
              Compliance: {progress.compliance.toFixed(2)} | Change: {progress.change.toFixed(4)}
            </div>
          )}
        </div>
      )}

      {/* Selection mode indicator */}
      {selectionMode !== 'none' && !isOptimizing && (
        <div style={{
          position: 'absolute',
          bottom: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          padding: '6px 14px',
          borderRadius: 20,
          background: selectionMode === 'fixed'
            ? 'rgba(239,68,68,0.85)'
            : 'rgba(59,130,246,0.85)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}>
          {selectionMode === 'fixed' ? 'Click a face to fix' : 'Click a face to apply load'}
        </div>
      )}

      <Canvas
        camera={{ fov: 50, near: 0.1, far: 10000 }}
        style={{ background: '#0d1117' }}
        gl={{ preserveDrawingBuffer: true }}
      >
        <CameraFitter dimX={dimX} dimY={dimY} dimZ={dimZ} fitKey={fitKey} />
        <CursorSetter selectionMode={selectionMode} />
        <OrbitControls enableDamping dampingFactor={0.1} />

        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 5]} intensity={1.0} castShadow />
        <directionalLight position={[-3, 4, -3]} intensity={0.3} />

        {/* Grid floor */}
        <Grid
          args={[1000, 1000]}
          position={[0, -dimY / 2 - 0.5, 0]}
          cellSize={Math.max(dimX, dimZ) / 8}
          cellThickness={0.5}
          cellColor="#1e293b"
          sectionSize={Math.max(dimX, dimZ) / 2}
          sectionThickness={1}
          sectionColor="#334155"
          fadeDistance={Math.max(dimX, dimY, dimZ) * 4}
          infiniteGrid
        />

        {/* Setup mode: face planes */}
        {!hasResult && !isOptimizing && (
          <>
            {FACE_LIST.map(face => (
              <FacePlane
                key={face}
                face={face}
                dimX={dimX}
                dimY={dimY}
                dimZ={dimZ}
                isFixed={fixedSet.has(face)}
                isLoad={loadMap.has(face)}
                selectionMode={selectionMode}
                onClick={onFaceClick}
                loadForce={loadMap.get(face)}
              />
            ))}
            <BoxWireframe dimX={dimX} dimY={dimY} dimZ={dimZ} />
          </>
        )}

        {/* Optimizing mode: live density field (falls back to pulsing box before first densities arrive) */}
        {isOptimizing && (
          <>
            {progress && progress.densities.length > 0 ? (
              <LiveDensityField
                progress={progress}
                nx={nx} ny={ny} nz={nz}
                dimX={dimX} dimY={dimY} dimZ={dimZ}
              />
            ) : (
              <PulsingBox dimX={dimX} dimY={dimY} dimZ={dimZ} />
            )}
            <BoxWireframe dimX={dimX} dimY={dimY} dimZ={dimZ} opacity={0.4} />
          </>
        )}

        {/* Result mode */}
        {hasResult && !isOptimizing && (
          <>
            {displayMode === 'solid' ? (
              <ResultMeshComponent geometry={resultMesh} materialColor="#b0b8c8" />
            ) : (
              <mesh geometry={resultMesh}>
                <meshBasicMaterial color="#8b5cf6" wireframe />
              </mesh>
            )}
            <BoxWireframe dimX={dimX} dimY={dimY} dimZ={dimZ} opacity={0.15} />
          </>
        )}
      </Canvas>

    </div>
  );
}
