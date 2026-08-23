'use client';

/**
 * Lightweight 3D preview for the papercraft page — shows the FINISHED model next
 * to its 2D flat pattern. Renders either a parametric building/room/gable box
 * (from text/photo dimensions) or an uploaded STL mesh, auto-fitted and
 * orbit-controllable.
 *
 * NOTE: uses explicit lights (NOT drei <Stage environment>) so it never pulls an
 * HDRI from a CDN — that network load can fail and, without a boundary, would
 * crash the whole page. A local error boundary additionally degrades to a static
 * note instead of taking down /papercraft.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { usePathname } from 'next/navigation';
import React, { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { loc } from '@/lib/i18n/loc';
import { toIsoLang } from '@/lib/i18n/normalize';

export type Model3D =
  | { kind: 'box'; W: number; D: number; H: number; roof: 'flat' | 'gable' | 'open'; gableH?: number }
  | { kind: 'mesh'; positions: number[] };

function gableRoofGeometry(W: number, D: number, h: number): BufferGeometry {
  const x = W / 2, z = D / 2;
  const v: number[] = [];
  const t = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], Dd = [-x, 0, z];
  const R0 = [0, h, -z], R1 = [0, h, z];
  t(A, R0, B); t(C, R1, Dd);
  t(B, R0, R1); t(B, R1, C);
  t(Dd, R1, R0); t(Dd, R0, A);
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

/** center + uniform scale so the model fits a ~2-unit view box. */
function fitOf(min: [number, number, number], max: [number, number, number]) {
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const maxDim = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  return { center: [cx, cy, cz] as [number, number, number], scale: 2 / maxDim };
}

function ModelMesh({ m }: { m: Model3D }) {
  const data = useMemo(() => {
    if (m.kind === 'mesh') {
      const geo = meshGeometry(m.positions);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      return { kind: 'mesh' as const, geo, fit: fitOf([bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]) };
    }
    const top = m.roof === 'gable' ? m.H + (m.gableH ?? m.D * 0.4) : m.H;
    const fit = fitOf([-m.W / 2, 0, -m.D / 2], [m.W / 2, top, m.D / 2]);
    const roofGeo = m.roof === 'gable' ? gableRoofGeometry(m.W, m.D, m.gableH ?? m.D * 0.4) : null;
    return { kind: 'box' as const, fit, roofGeo };
  }, [m]);

  const { center, scale } = data.fit;
  return (
    <group scale={scale} position={[-center[0] * scale, -center[1] * scale, -center[2] * scale]}>
      {data.kind === 'mesh' ? (
        <mesh geometry={data.geo} castShadow receiveShadow>
          <meshStandardMaterial color="#c8b89a" roughness={0.85} metalness={0.05} />
        </mesh>
      ) : (
        <group>
          <mesh position={[0, (m as Extract<Model3D, { kind: 'box' }>).H / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[(m as Extract<Model3D, { kind: 'box' }>).W, (m as Extract<Model3D, { kind: 'box' }>).H, (m as Extract<Model3D, { kind: 'box' }>).D]} />
            <meshStandardMaterial
              color={(m as Extract<Model3D, { kind: 'box' }>).roof === 'open' ? '#b9c6d6' : '#c8b89a'}
              roughness={0.85} metalness={0.05}
              transparent={(m as Extract<Model3D, { kind: 'box' }>).roof === 'open'}
              opacity={(m as Extract<Model3D, { kind: 'box' }>).roof === 'open' ? 0.55 : 1}
            />
          </mesh>
          {data.roofGeo && (
            <mesh geometry={data.roofGeo} position={[0, (m as Extract<Model3D, { kind: 'box' }>).H, 0]} castShadow receiveShadow>
              <meshStandardMaterial color="#a8584a" roughness={0.8} metalness={0.05} />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
}

class Preview3DBoundary extends React.Component<{ children: React.ReactNode; fallback: string }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; fallback: string }) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(err: Error) { console.warn('Preview3D failed; hiding 3D preview', err); }
  override render() {
    if (this.state.hasError) {
      return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', fontSize: 12 }}>{this.props.fallback}</div>;
    }
    return this.props.children;
  }
}

export default function Preview3D({ model }: { model: Model3D }) {
  const pathname = usePathname();
  const lang = toIsoLang(pathname?.split('/')[1]);
  return (
    <Preview3DBoundary fallback={loc(lang, {
      ko: '3D 미리보기를 표시할 수 없습니다 (2D 도면은 정상)',
      en: '3D preview is unavailable (the 2D drawing is fine)',
      ja: '3Dプレビューを表示できません（2D図面は正常です）',
      zh: '无法显示 3D 预览（2D 图纸正常）',
      es: 'La vista previa 3D no está disponible (el plano 2D funciona)',
      ar: 'معاينة 3D غير متاحة (الرسم ثنائي الأبعاد سليم)',
    })}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [2.4, 1.8, 2.6], fov: 45 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#0d1117']} />
        <hemisphereLight intensity={0.6} groundColor="#1a2230" />
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 6, 5]} intensity={1.4} castShadow />
        <directionalLight position={[-4, 2, -3]} intensity={0.5} />
        <ModelMesh m={model} />
        <OrbitControls makeDefault enablePan={false} minDistance={1.2} maxDistance={12} />
      </Canvas>
    </Preview3DBoundary>
  );
}
