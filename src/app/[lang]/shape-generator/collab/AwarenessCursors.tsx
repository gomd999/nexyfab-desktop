'use client';

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import type { PresenceState } from './yjsDoc';
import { useNowMs } from './useNowMs';

/**
 * Renders other users' cursors using the Yjs Awareness presence map (instead
 * of the legacy CollabUser[] shape). Visual matches CollabCursors so the two
 * can coexist while migration is in progress.
 *
 * The local user's clientId should be passed so we don't draw a cursor on
 * top of ourselves.
 */

interface Props {
  presences: Map<number, PresenceState>;
  localClientId: number;
}

const STALE_AFTER_MS = 10_000;

function fallbackColor(clientId: number): string {
  // Deterministic per-client hue when the peer didn't set one.
  const hue = (clientId * 137) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function PresenceCursor({ clientId, state, now }: { clientId: number; state: PresenceState; now: number }) {
  const cursor = state.cursor;
  if (!cursor) return null;
  const stale = state.ts !== undefined && now - state.ts > STALE_AFTER_MS;
  const opacity = stale ? 0.25 : 1;
  const color = state.color ?? fallbackColor(clientId);
  const name = state.name ?? `User ${clientId}`;

  return (
    <group position={[cursor.x, cursor.y, cursor.z ?? 0]}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.2, 3, 8]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>
      <Html
        center
        distanceFactor={60}
        style={{ pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        <div
          style={{
            background: color,
            color: 'var(--nx-text)',
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 4,
            opacity,
            transform: 'translateY(-18px)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {name}
          {state.editingNodeId && (
            <span style={{ opacity: 0.7, marginLeft: 4 }}>· editing</span>
          )}
          {state.viewportMode && state.viewportMode !== '3d' && (
            <span style={{ opacity: 0.7, marginLeft: 4 }}>· {state.viewportMode}</span>
          )}
          {state.activity === 'idle' && (
            <span style={{ opacity: 0.55, marginLeft: 4 }}>· idle</span>
          )}
        </div>
      </Html>
    </group>
  );
}

export default function AwarenessCursors({ presences, localClientId }: Props) {
  const now = useNowMs(500);
  const remoteCursors = useMemo(() => {
    const out: Array<[number, PresenceState]> = [];
    presences.forEach((state, clientId) => {
      if (clientId === localClientId) return;
      if (!state.cursor) return;
      out.push([clientId, state]);
    });
    return out;
  }, [presences, localClientId]);

  if (remoteCursors.length === 0) return null;

  return (
    <group>
      {remoteCursors.map(([clientId, state]) => (
        <PresenceCursor key={clientId} clientId={clientId} state={state} now={now} />
      ))}
    </group>
  );
}
