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

export default function BottomSheet({ visible, onClose, title, height: initialHeight = 'half', children, bottomOffset = 56 }: BottomSheetProps) {
  const [sheetHeight, setSheetHeight] = useState<SheetHeight>(initialHeight);
  const dragRef = useRef<{ startY: number; startHeight: SheetHeight } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset height when visibility or initialHeight changes
  useEffect(() => {
    if (visible) setSheetHeight(initialHeight);
  }, [visible, initialHeight]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = { startY: e.touches[0].clientY, startHeight: sheetHeight };
  }, [sheetHeight]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return;
    const dy = e.touches[0].clientY - dragRef.current.startY;
    const startH = dragRef.current.startHeight;

    // Swipe up => expand, swipe down => collapse
    if (dy < -60) {
      if (startH === 'compact') setSheetHeight('half');
      else if (startH === 'half') setSheetHeight('full');
    } else if (dy > 60) {
      if (startH === 'full') setSheetHeight('half');
      else if (startH === 'half') setSheetHeight('compact');
      else onClose();
    }
  }, [onClose]);

  const handleTouchEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

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
          height: SHEET_HEIGHTS[sheetHeight],
          maxHeight: `calc(100vh - ${bottomOffset}px - 44px)`,
          background: '#161b22',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: '0 -4px 30px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'height 0.25s ease',
          overflow: 'hidden',
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
