'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { FEAResult } from './simpleFEA';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type FEADisplayMode = 'stress' | 'displacement' | 'deformed';

interface FEAOverlayProps {
  geometry: THREE.BufferGeometry;
  result: FEAResult;
  displayMode: FEADisplayMode;
  deformationScale: number;
}

/* ─── Color scale: blue -> cyan -> green -> yellow -> red ────────────────── */

function valueToColor(t: number): THREE.Color {
  // t in [0, 1]
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.25) {
    const s = clamped / 0.25;
    // Blue (0,0,1) -> Cyan (0,1,1)
    return new THREE.Color(0, s, 1);
  } else if (clamped < 0.5) {
    const s = (clamped - 0.25) / 0.25;
    // Cyan (0,1,1) -> Green (0,1,0)
    return new THREE.Color(0, 1, 1 - s);
  } else if (clamped < 0.75) {
    const s = (clamped - 0.5) / 0.25;
    // Green (0,1,0) -> Yellow (1,1,0)
    return new THREE.Color(s, 1, 0);
  } else {
    const s = (clamped - 0.75) / 0.25;
    // Yellow (1,1,0) -> Red (1,0,0)
    return new THREE.Color(1, 1 - s, 0);
  }
}

/* ─── R3F Component ──────────────────────────────────────────────────────── */

export default function FEAOverlay({
  geometry,
  result,
  displayMode,
  deformationScale,
}: FEAOverlayProps) {
  const coloredGeometry = useMemo(() => {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const pos = nonIndexed.attributes.position;
    const vertCount = pos.count;
    const colors = new Float32Array(vertCount * 3);

    // Choose which data to color by
    const isStress = displayMode === 'stress';
    const values = isStress ? result.vonMisesStress : result.displacement;
    const maxVal = isStress ? result.maxStress : result.maxDisplacement;

    for (let i = 0; i < vertCount; i++) {
      const raw = i < values.length ? values[i] : 0;
      const t = maxVal > 0 ? raw / maxVal : 0;
      const color = valueToColor(t);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geo = nonIndexed.clone();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Apply deformation to positions if in deformed mode
    if (displayMode === 'deformed' && result.displacementVectors) {
      const newPos = geo.attributes.position;
      for (let i = 0; i < vertCount; i++) {
        if (i * 3 + 2 < result.displacementVectors.length) {
          const x = newPos.getX(i) + result.displacementVectors[i * 3] * deformationScale;
          const y = newPos.getY(i) + result.displacementVectors[i * 3 + 1] * deformationScale;
          const z = newPos.getZ(i) + result.displacementVectors[i * 3 + 2] * deformationScale;
          newPos.setXYZ(i, x, y, z);
        }
      }
      newPos.needsUpdate = true;
      geo.computeVertexNormals();
    }

    return geo;
  }, [geometry, result, displayMode, deformationScale]);

  return (
    <group>
      <mesh geometry={coloredGeometry}>
        <meshStandardMaterial
          vertexColors
          roughness={0.5}
          metalness={0.1}
          side={THREE.DoubleSide}
          transparent
          opacity={0.92}
        />
      </mesh>
    </group>
  );
}
