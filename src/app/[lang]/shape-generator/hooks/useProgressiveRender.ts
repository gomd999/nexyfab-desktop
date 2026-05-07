'use client';

import { useState, useEffect, useRef } from 'react';

export type RenderPhase = 'wireframe' | 'flat' | 'smooth';

/**
 * Progressive rendering hook — shows wireframe first,
 * then flat shading, then full smooth shading for complex models.
 */
export function useProgressiveRender(
  triangleCount: number,
  threshold: number = 10000,
): {
  phase: RenderPhase;
  wireframe: boolean;
  flatShading: boolean;
  isProgressing: boolean;
} {
  const [phase, setPhase] = useState<RenderPhase>('smooth');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCount = useRef(triangleCount);

  useEffect(() => {
    // Only trigger progressive render when triangle count changes significantly
    if (Math.abs(triangleCount - prevCount.current) < threshold * 0.5) {
      prevCount.current = triangleCount;
      return;
    }
    prevCount.current = triangleCount;

    // Not complex enough — skip progressive
    if (triangleCount < threshold) {
      setPhase('smooth');
      return;
    }

    // Start progressive sequence
    setPhase('wireframe');

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      setPhase('flat');
      timerRef.current = setTimeout(() => {
        setPhase('smooth');
        timerRef.current = null;
      }, 300);
    }, 200);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [triangleCount, threshold]);

  return {
    phase,
    wireframe: phase === 'wireframe',
    flatShading: phase === 'flat',
    isProgressing: phase !== 'smooth',
  };
}
