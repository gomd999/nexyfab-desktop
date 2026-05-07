'use client';

import React, { useState, useEffect, useCallback } from 'react';

/**
 * ShortcutHintOverlay — When the user holds Alt for 800ms+, shows
 * a semi-transparent overlay on each major button with its keyboard shortcut.
 * Disappears on Alt release.
 */

export interface ShortcutHint {
  /** CSS selector or element id to position the hint near */
  targetId: string;
  /** Shortcut key label */
  keys: string;
}

interface ShortcutHintOverlayProps {
  hints: ShortcutHint[];
}

export default function ShortcutHintOverlay({ hints }: ShortcutHintOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [positions, setPositions] = useState<Map<string, DOMRect>>(new Map());

  // Show on long Alt hold
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        timer = setTimeout(() => {
          // Compute positions of all targets
          const map = new Map<string, DOMRect>();
          for (const h of hints) {
            const el = document.getElementById(h.targetId);
            if (el) map.set(h.targetId, el.getBoundingClientRect());
          }
          setPositions(map);
          setVisible(true);
        }, 800);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        if (timer) clearTimeout(timer);
        setVisible(false);
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      if (timer) clearTimeout(timer);
    };
  }, [hints]);

  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none' }}>
      {hints.map(h => {
        const rect = positions.get(h.targetId);
        if (!rect) return null;
        return (
          <div
            key={h.targetId}
            style={{
              position: 'absolute',
              left: rect.left + rect.width / 2,
              top: rect.top - 6,
              transform: 'translate(-50%, -100%)',
              background: 'rgba(88, 166, 255, 0.9)',
              color: '#000',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'monospace',
              padding: '2px 6px',
              borderRadius: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              whiteSpace: 'nowrap',
              animation: 'hintFadeIn 0.15s ease-out',
            }}
          >
            {h.keys}
          </div>
        );
      })}
      <style>{`
        @keyframes hintFadeIn {
          from { opacity: 0; transform: translate(-50%, -100%) scale(0.9); }
          to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
        }
      `}</style>
    </div>
  );
}
