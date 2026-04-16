'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { PrintAnalysisResult } from './printAnalysis';

/* ─── Color helpers ──────────────────────────────────────────────────────── */

/** Map overhang angle to color: green (safe) → yellow (moderate) → red (needs support) */
function overhangToColor(angleDeg: number, threshold: number): THREE.Color {
  if (angleDeg <= 0) return new THREE.Color(0.15, 0.75, 0.3); // green – safe
  const t = Math.min(angleDeg / 90, 1);
  if (t < 0.33) {
    // Green → Yellow
    const s = t / 0.33;
    return new THREE.Color(s, 0.75, 0.3 * (1 - s));
  } else if (t < 0.66) {
    // Yellow → Orange
    const s = (t - 0.33) / 0.33;
    return new THREE.Color(1, 0.75 - s * 0.35, 0);
  } else {
    // Orange → Red
    const s = (t - 0.66) / 0.34;
    return new THREE.Color(1, 0.4 * (1 - s), 0);
  }
}

/* ─── R3F Component ──────────────────────────────────────────────────────── */

interface PrintAnalysisOverlayProps {
  geometry: THREE.BufferGeometry;
  analysis: PrintAnalysisResult;
  overhangThreshold: number;
  buildDirection: [number, number, number];
}

export default function PrintAnalysisOverlay({
  geometry,
  analysis,
  overhangThreshold,
  buildDirection,
}: PrintAnalysisOverlayProps) {
  // Clone geometry and apply vertex colors based on overhang angles
  const coloredGeometry = useMemo(() => {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const pos = nonIndexed.attributes.position;
    const vertCount = pos.count;
    const triCount = Math.floor(vertCount / 3);
    const colors = new Float32Array(vertCount * 3);

    for (let i = 0; i < triCount; i++) {
      const angle = i < analysis.overhangAngles.length ? analysis.overhangAngles[i] : 0;
      const color = overhangToColor(angle, overhangThreshold);

      // Apply same color to all 3 vertices of the triangle
      for (let v = 0; v < 3; v++) {
        const idx = i * 3 + v;
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
      }
    }

    const geo = nonIndexed.clone();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [geometry, analysis, overhangThreshold]);

  // Build plate indicator (flat plane at bottom of bounding box)
  const buildPlateY = useMemo(() => {
    return analysis.boundingBox.min.y - 1;
  }, [analysis]);

  const plateSize = useMemo(() => {
    const size = new THREE.Vector3();
    const box = new THREE.Box3(analysis.boundingBox.min, analysis.boundingBox.max);
    box.getSize(size);
    return Math.max(size.x, size.z) * 1.5;
  }, [analysis]);

  // Build direction arrow
  const arrowStart = useMemo(() => {
    const center = new THREE.Vector3()
      .addVectors(analysis.boundingBox.min, analysis.boundingBox.max)
      .multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(analysis.boundingBox.max, analysis.boundingBox.min);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dir = new THREE.Vector3(...buildDirection).normalize();
    return center.clone().addScaledVector(dir, -maxDim * 0.7);
  }, [analysis, buildDirection]);

  const arrowLength = useMemo(() => {
    const size = new THREE.Vector3().subVectors(analysis.boundingBox.max, analysis.boundingBox.min);
    return Math.max(size.x, size.y, size.z) * 0.5;
  }, [analysis]);

  const arrowDir = useMemo(() => new THREE.Vector3(...buildDirection).normalize(), [buildDirection]);

  return (
    <group>
      {/* Colored mesh overlay */}
      <mesh geometry={coloredGeometry}>
        <meshStandardMaterial
          vertexColors
          roughness={0.5}
          metalness={0.1}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Build plate */}
      <mesh position={[0, buildPlateY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[plateSize, plateSize]} />
        <meshStandardMaterial
          color="#1a3a5c"
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Build plate border */}
      <mesh position={[0, buildPlateY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[plateSize * 0.499, plateSize * 0.5, 64]} />
        <meshBasicMaterial color="#388bfd" transparent opacity={0.6} />
      </mesh>

      {/* Build direction arrow */}
      <arrowHelper args={[arrowDir, arrowStart, arrowLength, 0x388bfd, arrowLength * 0.2, arrowLength * 0.1]} />
    </group>
  );
}
