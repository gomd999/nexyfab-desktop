'use client';

/**
 * SnapAlignGuides — renders colored X/Y/Z axis guide lines through the
 * currently snapped vertex position, visible only while snap-dragging.
 *
 * Place inside <Canvas>. Listens for the custom 'nexyfab:snap-pos' event
 * dispatched by VertexHandles/EdgeHandles whenever a snapped position changes.
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const GUIDE_LEN = 10000; // half-length of each guide line (very long = infinite)

// Pre-allocated geometry + material for each axis
function makeAxisLine(color: string) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(6); // two points
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false });
  return new THREE.Line(geo, mat);
}

export default function SnapAlignGuides() {
  const groupRef = useRef<THREE.Group>(null);
  const posRef = useRef<THREE.Vector3 | null>(null);
  const activeRef = useRef(false);
  const fadeRef = useRef(1); // 0..1 opacity multiplier

  // Build lines on first render (not re-rendered via React state)
  const linesRef = useRef<{ x: THREE.Line; y: THREE.Line; z: THREE.Line } | null>(null);
  if (linesRef.current === null) {
    linesRef.current = {
      x: makeAxisLine('#f87171'), // red = X
      y: makeAxisLine('#4ade80'), // green = Y
      z: makeAxisLine('#60a5fa'), // blue = Z
    };
  }

  // Attach lines to group when group ref is set
  useEffect(() => {
    const g = groupRef.current;
    const l = linesRef.current;
    if (!g || !l) return;
    g.add(l.x);
    g.add(l.y);
    g.add(l.z);
    return () => {
      g.remove(l.x);
      g.remove(l.y);
      g.remove(l.z);
    };
  }, []);

  // Listen for snap-pos events from VertexHandles/EdgeHandles
  useEffect(() => {
    const handler = (e: Event) => {
      const { x, y, z, active } = (e as CustomEvent<{ x?: number; y?: number; z?: number; active: boolean }>).detail;
      if (active && x !== undefined && y !== undefined && z !== undefined) {
        posRef.current = new THREE.Vector3(x, y, z);
        activeRef.current = true;
        fadeRef.current = 1;
      } else {
        activeRef.current = false;
      }
    };
    window.addEventListener('nexyfab:snap-pos', handler);
    return () => window.removeEventListener('nexyfab:snap-pos', handler);
  }, []);

  // Per-frame: update guide line positions + fade
  useFrame((_, delta) => {
    const g = groupRef.current;
    const l = linesRef.current;
    if (!g || !l) return;

    if (!activeRef.current) {
      // Fade out
      fadeRef.current = Math.max(0, fadeRef.current - delta * 4);
    } else {
      fadeRef.current = Math.min(1, fadeRef.current + delta * 8);
    }

    const visible = fadeRef.current > 0.01;
    g.visible = visible;
    if (!visible) return;

    const pos = posRef.current;
    if (!pos) { g.visible = false; return; }

    const alpha = fadeRef.current * 0.55;

    // Update X line (pos.y, pos.z fixed; x goes ±GUIDE_LEN)
    const xPos = (l.x.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    xPos[0] = pos.x - GUIDE_LEN; xPos[1] = pos.y; xPos[2] = pos.z;
    xPos[3] = pos.x + GUIDE_LEN; xPos[4] = pos.y; xPos[5] = pos.z;
    l.x.geometry.attributes.position.needsUpdate = true;
    (l.x.material as THREE.LineBasicMaterial).opacity = alpha;

    // Update Y line
    const yPos = (l.y.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    yPos[0] = pos.x; yPos[1] = pos.y - GUIDE_LEN; yPos[2] = pos.z;
    yPos[3] = pos.x; yPos[4] = pos.y + GUIDE_LEN; yPos[5] = pos.z;
    l.y.geometry.attributes.position.needsUpdate = true;
    (l.y.material as THREE.LineBasicMaterial).opacity = alpha;

    // Update Z line
    const zPos = (l.z.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    zPos[0] = pos.x; zPos[1] = pos.y; zPos[2] = pos.z - GUIDE_LEN;
    zPos[3] = pos.x; zPos[4] = pos.y; zPos[5] = pos.z + GUIDE_LEN;
    l.z.geometry.attributes.position.needsUpdate = true;
    (l.z.material as THREE.LineBasicMaterial).opacity = alpha;
  });

  return <group ref={groupRef} renderOrder={999} />;
}
