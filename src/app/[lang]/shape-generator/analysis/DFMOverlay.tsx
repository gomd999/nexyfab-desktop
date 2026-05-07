'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { DFMResult, DFMIssue } from './dfmAnalysis';

/* ─── Color helpers ──────────────────────────────────────────────────────── */

function severityToColor(severity: 'error' | 'warning' | 'info'): THREE.Color {
  switch (severity) {
    case 'error': return new THREE.Color(0.97, 0.32, 0.29);   // red
    case 'warning': return new THREE.Color(0.82, 0.60, 0.13);  // yellow
    case 'info': return new THREE.Color(0.22, 0.55, 0.99);     // blue
  }
}

const COLOR_OK = new THREE.Color(0.15, 0.75, 0.3);         // green
const COLOR_HIGHLIGHT = new THREE.Color(0.22, 0.55, 0.99); // bright blue for selected

/* ─── Component ──────────────────────────────────────────────────────────── */

interface DFMOverlayProps {
  geometry: THREE.BufferGeometry;
  results: DFMResult[];
  highlightedIssue?: DFMIssue | null;
}

export default function DFMOverlay({
  geometry,
  results,
  highlightedIssue,
}: DFMOverlayProps) {
  // Build per-face severity map from all results
  const coloredGeometry = useMemo(() => {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const pos = nonIndexed.attributes.position;
    const vertCount = pos.count;
    const triCount = Math.floor(vertCount / 3);
    const colors = new Float32Array(vertCount * 3);

    // Build face-severity map: track worst severity per face
    const faceSeverity = new Map<number, 'error' | 'warning' | 'info'>();
    const severityRank: Record<string, number> = { error: 3, warning: 2, info: 1 };

    for (const result of results) {
      for (const issue of result.issues) {
        if (issue.faceIndices) {
          for (const fi of issue.faceIndices) {
            const existing = faceSeverity.get(fi);
            if (!existing || severityRank[issue.severity] > severityRank[existing]) {
              faceSeverity.set(fi, issue.severity);
            }
          }
        }
      }
    }

    // Build highlight set
    const highlightSet = new Set<number>();
    if (highlightedIssue?.faceIndices) {
      for (const fi of highlightedIssue.faceIndices) {
        highlightSet.add(fi);
      }
    }

    // Apply colors
    for (let i = 0; i < triCount; i++) {
      let color: THREE.Color;
      if (highlightSet.has(i)) {
        color = COLOR_HIGHLIGHT;
      } else {
        const sev = faceSeverity.get(i);
        color = sev ? severityToColor(sev) : COLOR_OK;
      }

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
  }, [geometry, results, highlightedIssue]);

  // Arrow indicators for highlighted issue location
  const arrowData = useMemo(() => {
    if (!highlightedIssue?.location) return null;
    const loc = new THREE.Vector3(...highlightedIssue.location);
    const dir = new THREE.Vector3(0, 1, 0);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const size = new THREE.Vector3().subVectors(bb.max, bb.min);
    const arrowLen = Math.max(size.x, size.y, size.z) * 0.3;
    const origin = loc.clone().addScaledVector(dir, arrowLen * 1.2);
    return { origin, dir: dir.clone().negate(), length: arrowLen };
  }, [geometry, highlightedIssue]);

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

      {/* Arrow indicator for highlighted issue */}
      {arrowData && (
        <arrowHelper
          args={[
            arrowData.dir,
            arrowData.origin,
            arrowData.length,
            0x388bfd,
            arrowData.length * 0.25,
            arrowData.length * 0.12,
          ]}
        />
      )}
    </group>
  );
}
