'use client';

import { useRef, useCallback } from 'react';

type SwipeDirection = 'left' | 'right';
type SwipeHandler = (dir: SwipeDirection) => void;

/**
 * Returns onTouchStart/onTouchEnd handlers to detect horizontal swipes.
 * Attach both to the container element you want to watch.
 * minDistance: minimum px delta to count as a swipe (default 50).
 */
export function useSwipe(onSwipe: SwipeHandler, minDistance = 50) {
  const startX = useRef<number | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) >= minDistance) {
      onSwipe(dx < 0 ? 'left' : 'right');
    }
    startX.current = null;
  }, [onSwipe, minDistance]);

  return { onTouchStart, onTouchEnd };
}
