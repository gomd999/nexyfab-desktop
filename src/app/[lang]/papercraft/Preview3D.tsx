'use client';

/**
 * Lightweight 3D preview for the papercraft page — shows the FINISHED model next
 * to its 2D flat pattern. Renders either a parametric building/room/gable box
 * (from text/photo dimensions) or an uploaded STL mesh, auto-fitted and
 * orbit-controllable.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage } from '@react-three/drei';
import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';

export type Model3D =
  | { kind: 'box'; W: number; D: number; H: number; roof: 'flat' | 'gable' | 'open'; gableH?: number }
  | { kind: 'mesh'; positions: number[] };

function gableRoofGeometry(W: number, D: number, h: number): BufferGeometry {
  const x = W / 2, z = D / 2;
  const v: number[] = [];
  const t = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], Dd = [-x, 0, z];
  const R0 = [0, h, -z], R1 = [0, h, z];
  t(A, R0, B);            // front gable
  t(C, R1, Dd);           // back gable
  t(B, R0, R1); t(B, R1, C);   // right slope
  t(Dd, R1, R0); t(Dd, R0, A); // left slope
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function meshGeometry(positions: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function ModelMesh({ m }: { m: Model3D }) {
  const roofGeo = useMemo(
    () => (m.kind === 'box' && m.roof === 'gable' ? gableRoofGeometry(m.W, m.D, m.gableH ?? m.D * 0.4) : null),
    [m],
  );
  const meshGeo = useMemo(() => (m.kind === 'mesh' ? meshGeometry(m.positions) : null), [m]);

  if (m.kind === 'mesh' && meshGeo) {
    return (
      <mesh geometry={meshGeo} castShadow receiveShadow>
        <meshStandardMaterial color="#c8b89a" roughness={0.85} metalness={0.05} />
      </mesh>
    );
  }
  if (m.kind === 'box') {
    const body = m.roof === 'open' ? m.H : m.H;
    return (
      <group>
        {/* walls / body */}
        <mesh position={[0, body / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[m.W, body, m.D]} />
          <meshStandardMaterial color={m.roof === 'open' ? '#b9c6d6' : '#c8b89a'} roughness={0.85} metalness={0.05} transparent={m.roof === 'open'} opacity={m.roof === 'open' ? 0.55 : 1} />
        </mesh>
        {/* gable roof */}
        {roofGeo && (
          <mesh geometry={roofGeo} position={[0, m.H, 0]} castShadow receiveShadow>
            <meshStandardMaterial color="#a8584a" roughness={0.8} metalness={0.05} />
          </mesh>
        )}
      </group>
    );
  }
  return null;
}

export default function Preview3D({ model }: { model: Model3D }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [1.6, 1.3, 1.8], fov: 45 }} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#0d1117']} />
      <Stage intensity={0.5} environment="city" adjustCamera shadows="contact">
        <ModelMesh m={model} />
      </Stage>
      <OrbitControls makeDefault enablePan={false} minDistance={1} maxDistance={10} />
    </Canvas>
  );
}
