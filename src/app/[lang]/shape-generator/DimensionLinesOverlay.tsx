'use client';

import React from 'react';

/**
 * DimensionLinesOverlay — renders BBox dimension arrows + labels on top of
 * the 3D viewport. Pure HTML/CSS overlay, no Three.js dependency.
 */

interface DimensionLinesOverlayProps {
  bbox: { w: number; h: number; d: number } | null;
  visible: boolean;
  lang: string;
}

export default function DimensionLinesOverlay({ bbox, visible, lang }: DimensionLinesOverlayProps) {
  if (!visible || !bbox) return null;

  const isKo = lang === 'ko' || lang === 'kr';
  const fmt = (v: number) => v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toString();

  const dims = [
    { label: isKo ? '폭' : 'W', value: bbox.w, color: '#ff6b6b', position: 'bottom' as const },
    { label: isKo ? '높이' : 'H', value: bbox.h, color: '#51cf66', position: 'right' as const },
    { label: isKo ? '깊이' : 'D', value: bbox.d, color: '#339af0', position: 'top' as const },
  ];

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 40,
    }}>
      {/* Bottom — Width (X) */}
      <div style={{
        position: 'absolute',
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <div style={{ width: 32, height: 1, background: dims[0].color, opacity: 0.6 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(13,17,23,0.85)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${dims[0].color}40`,
          borderRadius: 6,
          padding: '3px 8px',
        }}>
          <span style={{ fontSize: 9, color: dims[0].color, fontWeight: 700, letterSpacing: '0.03em' }}>
            {dims[0].label}
          </span>
          <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 700, fontFamily: 'monospace' }}>
            {fmt(dims[0].value)}
          </span>
          <span style={{ fontSize: 9, color: '#484f58' }}>mm</span>
        </div>
        <div style={{ width: 32, height: 1, background: dims[0].color, opacity: 0.6 }} />
      </div>

      {/* Right — Height (Y) */}
      <div style={{
        position: 'absolute',
        right: 48,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}>
        <div style={{ width: 1, height: 32, background: dims[1].color, opacity: 0.6 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(13,17,23,0.85)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${dims[1].color}40`,
          borderRadius: 6,
          padding: '3px 8px',
        }}>
          <span style={{ fontSize: 9, color: dims[1].color, fontWeight: 700, letterSpacing: '0.03em' }}>
            {dims[1].label}
          </span>
          <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 700, fontFamily: 'monospace' }}>
            {fmt(dims[1].value)}
          </span>
          <span style={{ fontSize: 9, color: '#484f58' }}>mm</span>
        </div>
        <div style={{ width: 1, height: 32, background: dims[1].color, opacity: 0.6 }} />
      </div>

      {/* Top — Depth (Z) */}
      <div style={{
        position: 'absolute',
        top: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <div style={{ width: 24, height: 1, background: dims[2].color, opacity: 0.6 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(13,17,23,0.85)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${dims[2].color}40`,
          borderRadius: 6,
          padding: '3px 8px',
        }}>
          <span style={{ fontSize: 9, color: dims[2].color, fontWeight: 700, letterSpacing: '0.03em' }}>
            {dims[2].label}
          </span>
          <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 700, fontFamily: 'monospace' }}>
            {fmt(dims[2].value)}
          </span>
          <span style={{ fontSize: 9, color: '#484f58' }}>mm</span>
        </div>
        <div style={{ width: 24, height: 1, background: dims[2].color, opacity: 0.6 }} />
      </div>
    </div>
  );
}
