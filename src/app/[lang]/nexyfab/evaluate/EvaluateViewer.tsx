'use client';

// 3D viewer for the Design Review page — shows the uploaded part and overlays
// the DFM problem faces (thin wall / undercut / sharp corner …) in red so the
// user SEES where the issues are, not just reads about them.

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center, Bounds } from '@react-three/drei';
import * as THREE from 'three';

/** Build an overlay geometry from triangle indices into `source`. */
function buildHighlight(source: THREE.BufferGeometry, triIndices: number[]): THREE.BufferGeometry | null {
  if (!triIndices.length) return null;
  const src = source.index ? source.toNonIndexed() : source;
  const pos = src.getAttribute('position');
  if (!pos) return null;
  const out: number[] = [];
  for (const ti of triIndices) {
    for (let k = 0; k < 3; k++) {
      const i = ti * 3 + k;
      if (i < pos.count) out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  }
  if (out.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

export default function EvaluateViewer({
  geometry,
  highlightTris,
  fitKey,
}: {
  geometry: THREE.BufferGeometry;
  highlightTris: number[];
  fitKey: number;
}) {
  const geo = useMemo(() => {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return geometry;
  }, [geometry]);
  const highlight = useMemo(() => buildHighlight(geometry, highlightTris), [geometry, highlightTris]);

  return (
    <Canvas
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      camera={{ position: [120, 90, 140], fov: 45, near: 1, far: 8000 }}
      style={{ width: '100%', height: '100%', background: 'radial-gradient(circle at 50% 30%, #232327 0%, #161618 70%)' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[80, 140, 100]} intensity={1.4} color="#fff4e0" />
      <directionalLight position={[-100, 50, -80]} intensity={0.4} color="#cfe0ff" />
      <Bounds fit clip margin={1.3} key={fitKey}>
        <Center>
          <mesh geometry={geo}>
            <meshStandardMaterial color="#c4c7cd" metalness={0.7} roughness={0.4} />
          </mesh>
          {highlight && (
            <mesh geometry={highlight}>
              <meshStandardMaterial color="#ef4444" emissive="#b91c1c" emissiveIntensity={0.5} transparent opacity={0.85} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
            </mesh>
          )}
        </Center>
      </Bounds>
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}
