'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { DraftAnalysisResult } from './draftAnalysis';

interface DraftAnalysisOverlayProps {
  geometry: THREE.BufferGeometry;
  result: DraftAnalysisResult;
  /** Faces below this angle (deg) are considered "insufficient draft". */
  minDraftDeg: number;
  /** Mold pull direction (unit vector). When set, renders an arrow + plane
   *  indicator so the user can see at a glance which direction the mold
   *  half opens — without it the red/amber/green colour-map is ambiguous. */
  pullDirection?: [number, number, number];
}

const COLOR_UNDERCUT = new THREE.Color(0.97, 0.32, 0.29);  // red
const COLOR_VERTICAL = new THREE.Color(0.82, 0.60, 0.13);  // amber
const COLOR_POSITIVE = new THREE.Color(0.25, 0.73, 0.30);  // green
const COLOR_DEEP     = new THREE.Color(0.13, 0.50, 0.80);  // blue for ≥ 10°

export default function DraftAnalysisOverlay({
  geometry,
  result,
  minDraftDeg,
  pullDirection,
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

  // Pull-direction indicator: an arrow above the part pointing along the
  // mold-opening direction. Length scales with the part's bounding box so the
  // arrow stays visible across part scales.
  const pullArrowProps = useMemo(() => {
    if (!pullDirection) return null;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return null;
    const size = bb.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 10);
    const dir = new THREE.Vector3(pullDirection[0], pullDirection[1], pullDirection[2]).normalize();
    // Anchor the arrow above the part along the pull axis so it doesn't clip
    // through the geometry. Origin = bbox centre + 0.6×span along the dir.
    const center = bb.getCenter(new THREE.Vector3());
    const origin = center.clone().add(dir.clone().multiplyScalar(span * 0.6));
    return { dir, origin, length: span * 0.5, color: 0xffd700 };
  }, [geometry, pullDirection]);

  return (
    <>
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
      {pullArrowProps && (
        <arrowHelper
          args={[pullArrowProps.dir, pullArrowProps.origin, pullArrowProps.length, pullArrowProps.color, pullArrowProps.length * 0.2, pullArrowProps.length * 0.12]}
        />
      )}
    </>
  );
}
