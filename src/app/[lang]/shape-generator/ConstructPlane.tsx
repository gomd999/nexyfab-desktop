'use client';
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

interface ConstructPlaneProps {
  planes: Array<{
    id: string;
    type: 'xy' | 'xz' | 'yz' | 'offset';
    offset?: number;
    visible: boolean;
    label?: string;
  }>;
  size?: number;
}

const PLANE_CONFIG = {
  xy: {
    color: [0, 200, 0],
    rotation: [0, 0, 0] as [number, number, number],
    positionAxis: 'z' as const,
    defaultLabel: 'XY Plane',
  },
  xz: {
    color: [0, 0, 200],
    rotation: [-Math.PI / 2, 0, 0] as [number, number, number],
    positionAxis: 'y' as const,
    defaultLabel: 'XZ Plane',
  },
  yz: {
    color: [200, 0, 0],
    rotation: [0, Math.PI / 2, 0] as [number, number, number],
    positionAxis: 'x' as const,
    defaultLabel: 'YZ Plane',
  },
  offset: {
    color: [150, 150, 0],
    rotation: [0, 0, 0] as [number, number, number],
    positionAxis: 'z' as const,
    defaultLabel: 'Offset Plane',
  },
};

function SinglePlane({
  id,
  type,
  offset = 0,
  label,
  size,
}: {
  id: string;
  type: 'xy' | 'xz' | 'yz' | 'offset';
  offset: number;
  label?: string;
  size: number;
}) {
  const config = PLANE_CONFIG[type];
  const [r, g, b] = config.color;

  const fillColor = useMemo(
    () => new THREE.Color(`rgb(${r},${g},${b})`),
    [r, g, b],
  );

  const position = useMemo<[number, number, number]>(() => {
    const pos: [number, number, number] = [0, 0, 0];
    const axisIndex = { x: 0, y: 1, z: 2 }[config.positionAxis];
    pos[axisIndex] = offset;
    return pos;
  }, [config.positionAxis, offset]);

  const edgeGeometry = useMemo(() => {
    const shape = new THREE.BufferGeometry();
    const h = size / 2;
    const vertices = new Float32Array([
      -h, -h, 0,
       h, -h, 0,
       h,  h, 0,
      -h,  h, 0,
      -h, -h, 0,
    ]);
    shape.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return shape;
  }, [size]);

  const displayLabel =
    label ??
    (type === 'offset'
      ? `Offset ${offset >= 0 ? '+' : ''}${offset}mm`
      : config.defaultLabel);

  const half = size / 2;

  return (
    <group key={id} position={position} rotation={config.rotation}>
      <mesh>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial
          color={fillColor}
          transparent
          opacity={0.08}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments geometry={edgeGeometry}>
        <lineBasicMaterial
          color={fillColor}
          transparent
          opacity={0.3}
        />
      </lineSegments>

      <Html
        position={[half - 2, half - 2, 0]}
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          fontSize: '10px',
          color: `rgba(${r},${g},${b},0.7)`,
          background: 'rgba(30,30,30,0.6)',
          padding: '1px 4px',
          borderRadius: '2px',
        }}
        distanceFactor={200}
      >
        {displayLabel}
      </Html>
    </group>
  );
}

export default function ConstructPlane({
  planes,
  size = 150,
}: ConstructPlaneProps) {
  const visiblePlanes = planes.filter((p) => p.visible);

  if (visiblePlanes.length === 0) return null;

  return (
    <group name="construct-planes">
      {visiblePlanes.map((plane) => (
        <SinglePlane
          key={plane.id}
          id={plane.id}
          type={plane.type}
          offset={plane.offset ?? 0}
          label={plane.label}
          size={size}
        />
      ))}
    </group>
  );
}
