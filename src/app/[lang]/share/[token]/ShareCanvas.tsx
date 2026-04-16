'use client';
/**
 * ShareCanvas — IP 보호 공유 뷰어용 읽기 전용 3D 캔버스
 * meshVertices: base64 인코딩된 JSON { positions, normals?, indices? }
 * shapeId: meshVertices가 없을 때 폴백 텍스트용
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { useEffect, useState } from 'react';
import * as THREE from 'three';

interface ShareCanvasProps {
  shapeId: string;
  meshVertices?: string;
}

function MeshModel({ meshVertices }: { meshVertices: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    try {
      const json = atob(meshVertices);
      const data = JSON.parse(json) as {
        positions: number[];
        normals?: number[];
        indices?: number[];
      };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      if (data.normals?.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      if (data.indices?.length) geo.setIndex(data.indices);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      // Center the geometry
      geo.center();
      setGeometry(geo);
    } catch (e) {
      console.error('[ShareCanvas] Failed to decode mesh', e);
    }
  }, [meshVertices]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#6e7cf4" roughness={0.25} metalness={0.55} />
    </mesh>
  );
}

export default function ShareCanvas({ shapeId, meshVertices }: ShareCanvasProps) {
  return (
    <Canvas
      camera={{ position: [120, 90, 120], fov: 42 }}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      style={{ width: '100%', height: '100%' }}
      shadows
    >
      <color attach="background" args={['#161b22']} />
      <hemisphereLight args={['#d0dcff', '#0a0a20', 0.65]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[25, 35, 20]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment preset="city" />

      {meshVertices ? (
        <MeshModel meshVertices={meshVertices} />
      ) : (
        /* meshVertices 없을 때: 기본 박스 플레이스홀더 */
        <mesh>
          <boxGeometry args={[40, 40, 40]} />
          <meshStandardMaterial color="#30363d" roughness={0.8} wireframe />
        </mesh>
      )}

      <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.6} />

      {/* 워터마크 텍스트는 ShareViewer 레이어에서 처리 */}
    </Canvas>
  );
}
