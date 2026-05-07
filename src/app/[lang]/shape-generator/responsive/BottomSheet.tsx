'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

export type SheetHeight = 'compact' | 'half' | 'full';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  height?: SheetHeight;
  children: React.ReactNode;
  /** Offset from bottom (e.g. for MobileToolbar height) */
  bottomOffset?: number;
}

const SHEET_HEIGHTS: Record<SheetHeight, string> = {
  compact: '35vh',
  half: '55vh',
  full: '90vh',
};

// vh percent for each snap point
const SNAP_VH: Record<SheetHeight, number> = { compact: 35, half: 55, full: 90 };

export default function BottomSheet({ visible, onClose, title, height: initialHeight = 'half', children, bottomOffset = 56 }: BottomSheetProps) {
  const [sheetHeight, setSheetHeight] = useState<SheetHeight>(initialHeight);
  // Live drag offset in pixels (positive = drag down). Null when not dragging.
  const [dragPx, setDragPx] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startTime: number; startHeight: SheetHeight; lastY: number; lastTime: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset height when visibility or initialHeight changes
  useEffect(() => {
    if (visible) setSheetHeight(initialHeight);
  }, [visible, initialHeight]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const y = e.touches[0].clientY;
    const now = performance.now();
    dragRef.current = { startY: y, startTime: now, startHeight: sheetHeight, lastY: y, lastTime: now };
    setDragPx(0);
  }, [sheetHeight]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return;
    const y = e.touches[0].clientY;
    const dy = y - dragRef.current.startY;
    dragRef.current.lastY = y;
    dragRef.current.lastTime = performance.now();
    setDragPx(dy);
  }, []);

  const handleTouchEnd = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) { setDragPx(null); return; }
    const dy = d.lastY - d.startY;
    const dt = Math.max(1, d.lastTime - d.startTime);
    const velocity = dy / dt; // px/ms; positive = downward
    const vh = window.innerHeight / 100;
    // Resolve current effective height in vh, then pick the closest snap (with velocity bias).
    const startVh = SNAP_VH[d.startHeight];
    const effectiveVh = startVh - dy / vh;
    let target: SheetHeight | 'close';
    // Strong fling biases the choice
    if (velocity > 0.8) {
      target = d.startHeight === 'full' ? 'half' : d.startHeight === 'half' ? 'compact' : 'close';
    } else if (velocity < -0.8) {
      target = d.startHeight === 'compact' ? 'half' : d.startHeight === 'half' ? 'full' : 'full';
    } else {
      // Snap to nearest
      const candidates: { id: SheetHeight; vh: number }[] = [
        { id: 'compact', vh: 35 }, { id: 'half', vh: 55 }, { id: 'full', vh: 90 },
      ];
      const sorted = candidates.sort((a, b) => Math.abs(a.vh - effectiveVh) - Math.abs(b.vh - effectiveVh));
      target = sorted[0].id;
      // If user dragged the compact sheet down more than 25% of viewport, dismiss
      if (d.startHeight === 'compact' && effectiveVh < 18) target = 'close';
    }
    setDragPx(null);
    if (target === 'close') onClose();
    else setSheetHeight(target);
  }, [onClose]);

  // Computed live height during drag
  const liveHeight = (() => {
    if (dragPx === null) return SHEET_HEIGHTS[sheetHeight];
    const vh = typeof window !== 'undefined' ? window.innerHeight / 100 : 8;
    const startVh = SNAP_VH[sheetHeight];
    const liveVh = Math.max(8, Math.min(95, startVh - dragPx / vh));
    return `${liveVh}vh`;
  })();

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.4)',
          transition: 'opacity 0.2s',
        }}
      />
      {/* Sheet */}
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: bottomOffset,
          zIndex: 910,
          height: liveHeight,
          maxHeight: `calc(100vh - ${bottomOffset}px - 44px)`,
          background: '#161b22',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: '0 -4px 30px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          transition: dragPx === null ? 'height 0.25s cubic-bezier(0.32, 0.72, 0, 1)' : 'none',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        {/* Drag handle */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '10px 16px 6px',
            cursor: 'grab',
            flexShrink: 0,
          }}
        >
          <div style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: '#484f58',
            marginBottom: title ? 8 : 0,
          }} />
          {title && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9' }}>{title}</span>
              <button
                onClick={onClose}
                style={{
                  border: 'none', background: '#21262d', cursor: 'pointer', fontSize: 12,
                  color: '#8b949e', width: 28, height: 28, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
        {/* Content */}
        <div
          className="nf-scroll"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 16px 16px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
