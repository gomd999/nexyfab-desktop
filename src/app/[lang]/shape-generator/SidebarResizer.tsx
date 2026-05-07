'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Which edge of the panel this handle is on. */
  edge: 'left' | 'right';
  /** Current width. */
  width: number;
  /** Called continuously while dragging with the new width (clamped by caller if needed). */
  onResize: (next: number) => void;
  /** Optional inline style overrides for positioning. */
  style?: React.CSSProperties;
}

/**
 * Thin 4px draggable handle that reports desired width as the user drags.
 * - edge='right' means the handle sits on the RIGHT edge of the left panel.
 * - edge='left'  means the handle sits on the LEFT edge of the right panel.
 */
export default function SidebarResizer({ edge, width, onResize, style }: Props) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const next = edge === 'right' ? startRef.current.w + dx : startRef.current.w - dx;
      onResize(next);
    },
    [edge, onResize],
  );

  const stop = useCallback(() => {
    setDragging(false);
    startRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, onPointerMove, stop]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, w: width };
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 6,
        [edge === 'right' ? 'right' : 'left']: -3,
        cursor: 'col-resize',
        zIndex: 60,
        background: dragging ? 'rgba(88,166,255,0.35)' : 'transparent',
        transition: dragging ? 'none' : 'background 0.15s',
        ...style,
      }}
      onMouseEnter={e => {
        if (!dragging) e.currentTarget.style.background = 'rgba(88,166,255,0.2)';
      }}
      onMouseLeave={e => {
        if (!dragging) e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}
