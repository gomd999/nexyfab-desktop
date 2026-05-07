import { useMemo, useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { simplifyGeometry } from './meshSimplify';

/** Default decimation thresholds (full, medium, low). */
const DEFAULT_THRESHOLDS = [1.0, 0.5, 0.25];

/** Below this triangle count we skip LOD entirely — the mesh is cheap enough. */
const LOD_SKIP_THRESHOLD = 10_000;

export interface LODResult {
  /** Array of pre-computed LOD geometries (index 0 = full, 1 = medium, 2 = low). */
  levels: THREE.BufferGeometry[];
  /** Triangle count of the *original* (full) geometry. */
  triangleCount: number;
  /** Whether LOD was skipped because the mesh is small enough. */
  skipped: boolean;
}

/**
 * Pre-compute multiple LOD levels for a geometry.
 *
 * Returns an object containing the LOD level array, the original triangle count,
 * and a flag indicating whether LOD generation was skipped.
 *
 * The caller picks which level to display based on interaction state
 * (e.g. orbiting → lower LOD).
 */
export function useLOD(
  geometry: THREE.BufferGeometry | null,
  options?: { thresholds?: number[] },
): LODResult {
  const thresholds = options?.thresholds ?? DEFAULT_THRESHOLDS;

  // Keep a ref to previously generated (simplified) geometries so they can be
  // disposed when the input geometry changes or the hook unmounts.
  const prevSimplifiedRef = useRef<THREE.BufferGeometry[]>([]);

  useEffect(() => {
    return () => {
      for (const geo of prevSimplifiedRef.current) {
        geo.dispose();
      }
      prevSimplifiedRef.current = [];
    };
  }, []);

  return useMemo(() => {
    // Dispose geometries produced by the previous run (ratio < 1.0 only —
    // the full-resolution geometry is owned by the caller, not by this hook).
    for (const geo of prevSimplifiedRef.current) {
      geo.dispose();
    }
    prevSimplifiedRef.current = [];

    if (!geometry) {
      return { levels: [], triangleCount: 0, skipped: true };
    }

    const posAttr = geometry.attributes?.position;
    if (!posAttr) {
      return { levels: [], triangleCount: 0, skipped: true };
    }

    // For indexed geometry count triangles from the index; otherwise from position count.
    const triCount = geometry.index
      ? Math.floor(geometry.index.count / 3)
      : Math.floor(posAttr.count / 3);

    // Skip LOD for small meshes
    if (triCount < LOD_SKIP_THRESHOLD) {
      return { levels: [geometry], triangleCount: triCount, skipped: true };
    }

    // Generate LOD levels — track simplified copies for later disposal.
    const levels: THREE.BufferGeometry[] = thresholds.map((ratio) => {
      if (ratio >= 1.0) return geometry;
      const simplified = simplifyGeometry(geometry, ratio);
      prevSimplifiedRef.current.push(simplified);
      return simplified;
    });

    return { levels, triangleCount: triCount, skipped: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, ...thresholds]);
}
