'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { AiDesignConceptNodeV10 } from '@/lib/ai/aiDesignWorkspaceIntegrationV10';

const HEAT = { none: '#2f81f7', attention: '#d29922', high: '#f0883e', critical: '#f85149' } as const;

export default function AiDesignConceptCanvas3d({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: readonly AiDesignConceptNodeV10[];
  selectedId: string | null;
  onSelect(id: string, kind: AiDesignConceptNodeV10['kind']): void;
}) {
  return (
    <Canvas camera={{ position: [7, 6, 9], fov: 42 }} dpr={[1, 1.75]} aria-label="Concept 3D workspace">
      <color attach="background" args={['#07101c']} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[8, 10, 6]} intensity={2.2} />
      <gridHelper args={[18, 18, '#243349', '#152133']} />
      {nodes.map((node, index) => {
        const column = index % 5;
        const row = Math.floor(index / 5);
        const selected = node.id === selectedId;
        return (
          <mesh
            key={node.id}
            position={[(column - 2) * 1.45, 0.45 + node.depth * 0.14, (row - 1.5) * 1.35]}
            scale={selected ? 1.12 : 1}
            onClick={(event) => { event.stopPropagation(); onSelect(node.id, node.kind); }}
          >
            <boxGeometry args={[1.05, 0.75, 1.05]} />
            <meshStandardMaterial color={selected ? '#7ee787' : HEAT[node.heat]} roughness={0.48} metalness={0.2} />
          </mesh>
        );
      })}
      <OrbitControls makeDefault enableDamping minDistance={4} maxDistance={30} />
    </Canvas>
  );
}
