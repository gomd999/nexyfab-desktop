'use client';

import { useRef, useCallback } from 'react';

interface TouchGestureCallbacks {
  onLongPress?: (x: number, y: number) => void;
}

/**
 * Touch gesture support for the 3D viewport.
 * - Pinch to zoom and two-finger rotate are handled by OrbitControls (enableTouchRotate/enableTouchZoom).
 * - Three-finger pan is handled by OrbitControls when `touches.THREE = THREE.TOUCH.PAN` (default).
 * - This hook adds long-press detection to replace right-click context menu on mobile.
 */
export function useTouchGestures({ onLongPress }: TouchGestureCallbacks) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only long-press on single finger
    if (e.touches.length !== 1) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      return;
    }
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };

    longPressTimer.current = setTimeout(() => {
      if (touchStartPos.current && onLongPress) {
        onLongPress(touchStartPos.current.x, touchStartPos.current.y);
      }
      longPressTimer.current = null;
    }, 600);
  }, [onLongPress]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!longPressTimer.current || !touchStartPos.current) return;
    // Cancel long press if finger moved > 10px
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPos.current.x;
    const dy = touch.clientY - touchStartPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
  };
}
