'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ViewportComplexityTier } from '@/lib/viewportPerformance';

const TRIANGLES_BY_TIER: Record<ViewportComplexityTier, number> = {
  S: 25_000,
  M: 100_000,
  L: 500_000,
  XL: 1_100_000,
};

/** Deterministic real-WebGL fixture enabled explicitly on the expert route. */
export default function ViewportBenchmarkFixture({ tier }: { tier: ViewportComplexityTier }) {
  const geometry = useMemo(() => {
    const triangleCount = TRIANGLES_BY_TIER[tier];
    const positions = new Float32Array(triangleCount * 9);
    const columns = Math.ceil(Math.sqrt(triangleCount));
    const spacing = 0.018;
    const half = (columns * spacing) / 2;
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const x = (triangle % columns) * spacing - half;
      const y = Math.floor(triangle / columns) * spacing - half;
      const z = (triangle % 17) * 0.0001;
      positions.set([x, y, z, x + 0.014, y, z, x, y + 0.014, z], triangle * 9);
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    result.computeBoundingSphere();
    return result;
  }, [tier]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} frustumCulled={false} data-viewport-benchmark={tier}>
      <meshBasicMaterial color="#4b9cff" side={THREE.DoubleSide} />
    </mesh>
  );
}
