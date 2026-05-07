'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { DraftAnalysisResult } from './draftAnalysis';

interface DraftAnalysisOverlayProps {
  geometry: THREE.BufferGeometry;
  result: DraftAnalysisResult;
  /** Faces below this angle (deg) are considered "insufficient draft". */
  minDraftDeg: number;
}

const COLOR_UNDERCUT = new THREE.Color(0.97, 0.32, 0.29);  // red
const COLOR_VERTICAL = new THREE.Color(0.82, 0.60, 0.13);  // amber
const COLOR_POSITIVE = new THREE.Color(0.25, 0.73, 0.30);  // green
const COLOR_DEEP     = new THREE.Color(0.13, 0.50, 0.80);  // blue for ≥ 10°

export default function DraftAnalysisOverlay({
  geometry,
  result,
  minDraftDeg,
}: DraftAnalysisOverlayProps) {
  const coloredGeometry = useMemo(() => {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const pos = nonIndexed.attributes.position;
    const vertCount = pos.count;
    const triCount = Math.floor(vertCount / 3);
    const colors = new Float32Array(vertCount * 3);

    const tmp = new THREE.Color();
    for (let i = 0; i < triCount; i++) {
      const draft = result.faceAngles[i];
      if (draft < 0) {
        tmp.copy(COLOR_UNDERCUT);
      } else if (draft < minDraftDeg) {
        tmp.copy(COLOR_VERTICAL);
      } else if (draft < 10) {
        // Interpolate green → deeper green as draft grows.
        const t = (draft - minDraftDeg) / Math.max(10 - minDraftDeg, 0.01);
        tmp.copy(COLOR_POSITIVE).lerp(COLOR_DEEP, Math.min(t, 1));
      } else {
        tmp.copy(COLOR_DEEP);
      }
      for (let v = 0; v < 3; v++) {
        const idx = i * 3 + v;
        colors[idx * 3] = tmp.r;
        colors[idx * 3 + 1] = tmp.g;
        colors[idx * 3 + 2] = tmp.b;
      }
    }

    const geo = nonIndexed.clone();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [geometry, result, minDraftDeg]);

  return (
    <mesh geometry={coloredGeometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.6}
        metalness={0.05}
        side={THREE.DoubleSide}
        transparent
        opacity={0.92}
      />
    </mesh>
  );
}
