'use client';

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { CollabUser } from './CollabTypes';

// ─── Cursor mesh for a single remote user ────────────────────────────────────

function UserCursor({ user }: { user: CollabUser }) {
  const stale = Date.now() - user.lastSeen > 10_000;
  const opacity = stale ? 0.25 : 1;

  const pos = user.cursor;
  if (!pos) return null;

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      {/* Cone pointing downward acts as a cursor arrow */}
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.2, 3, 8]} />
        <meshStandardMaterial
          color={user.color}
          transparent
          opacity={opacity}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>

      {/* User name label */}
      <Html
        center
        distanceFactor={60}
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        <div
          style={{
            background: user.color,
            color: '#fff',
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: '4px',
            opacity,
            transform: 'translateY(-18px)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {user.name}
        </div>
      </Html>
    </group>
  );
}

// ─── CollabCursors: renders all remote users' 3D cursors ─────────────────────

export default function CollabCursors({ users }: { users: CollabUser[] }) {
  const remoteUsers = useMemo(
    () => users.filter(u => u.cursor),
    [users],
  );

  if (remoteUsers.length === 0) return null;

  return (
    <group>
      {remoteUsers.map(u => (
        <UserCursor key={u.id} user={u} />
      ))}
    </group>
  );
}
