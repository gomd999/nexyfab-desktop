'use client';

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMultiplayer } from './MultiplayerProvider';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

/**
 * Renders the 3D cursors of other connected engineers in the shared CAD workspace.
 */
export default function MultiplayerCursors() {
  const { cursors, myId } = useMultiplayer();
  
  return (
    <group>
      {Array.from(cursors.values()).map((cursor) => {
        if (cursor.id === myId) return null; // Don't render own cursor
        
        return (
          <CursorMesh 
            key={cursor.id}
            position={cursor.position}
            color={cursor.color}
            name={cursor.name}
            state={cursor.state}
          />
        );
      })}
    </group>
  );
}

function CursorMesh({ position, color, name, state }: { position: THREE.Vector3, color: string, name: string, state: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3().copy(position));

  useFrame((state, delta) => {
    if (groupRef.current) {
      // Smooth interpolation (lerp) to the network position to avoid stuttering
      targetPos.current.copy(position);
      groupRef.current.position.lerp(targetPos.current, 0.2);
    }
  });

  return (
    <group ref={groupRef}>
      {/* 3D Cursor Arrow Geometry */}
      <mesh rotation={[-Math.PI / 4, 0, Math.PI / 8]} position={[1.5, -2, 0]}>
        <coneGeometry args={[1, 4, 4]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      
      {/* HTML Overlay for Name and State */}
      <Html position={[2, -4, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        <div style={{
          background: color,
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          {name}
          {state === 'sketching' && <span style={{ fontSize: '10px', opacity: 0.8 }}>(Sketching ✏️)</span>}
          {state === 'editing_feature' && <span style={{ fontSize: '10px', opacity: 0.8 }}>(Editing 🔧)</span>}
        </div>
      </Html>
    </group>
  );
}
