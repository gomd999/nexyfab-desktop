'use client';

// G8 — Render the autoExplodedDrawing layout as inline SVG.
//
// Pure presentation layer: takes the layout result from autoExplodedDrawing
// and emits balloons (numbered circles) + leader lines + a small legend
// table. Used inside AutoDrawingPanel as an additional view, and exportable
// to PDF via the same path as the regular drawing.

import React from 'react';
import type { AutoExplodedDrawingResult } from './autoExplodedDrawing';

interface Props {
  layout: AutoExplodedDrawingResult;
  /** Outer SVG width (px). Default fits to the layout bounds. */
  width?: number;
  height?: number;
  /** Show legend table next to balloons. Default true. */
  showLegend?: boolean;
}

const COLOR = {
  bg: 'var(--nx-text)',
  ink: 'var(--nx-bg)',
  accent: '#1f6feb',
  leader: 'var(--nx-border-strong)',
  partDot: 'var(--nx-text-2)',
};

export default function AutoExplodedSVG({
  layout,
  width = 800,
  height = 600,
  showLegend = true,
}: Props) {
  const { balloons, drawingBounds } = layout;
  const padding = 30;
  const span = Math.max(
    drawingBounds.maxX - drawingBounds.minX,
    drawingBounds.maxY - drawingBounds.minY,
    1,
  );
  const balloonR = Math.max(8, span * 0.025);
  const fontSize = Math.max(8, balloonR * 0.9);

  const vbX = drawingBounds.minX - padding;
  const vbY = drawingBounds.minY - padding;
  const vbW = (drawingBounds.maxX - drawingBounds.minX) + padding * 2;
  const vbH = (drawingBounds.maxY - drawingBounds.minY) + padding * 2;

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <svg
        width={width}
        height={height}
        viewBox={`${vbX} ${-vbY - vbH} ${vbW} ${vbH}`}
        // Engineering convention: Y-up. We invert via the viewBox so the SVG
        // text glyphs (which use Y-down) still render upright.
        style={{ background: COLOR.bg, border: '1px solid #e5e7eb', borderRadius: 4 }}
      >
        {/* Part centre dots */}
        {balloons.map(b => (
          <circle
            key={`dot-${b.partId}`}
            cx={b.partX}
            cy={-b.partY}
            r={1.6}
            fill={COLOR.partDot}
          />
        ))}
        {/* Leader lines part → balloon */}
        {balloons.map(b => (
          <line
            key={`lead-${b.partId}`}
            x1={b.partX}
            y1={-b.partY}
            x2={b.balloonX}
            y2={-b.balloonY}
            stroke={COLOR.leader}
            strokeWidth={0.6}
          />
        ))}
        {/* Balloons */}
        {balloons.map(b => (
          <g key={`bal-${b.partId}`}>
            <circle
              cx={b.balloonX}
              cy={-b.balloonY}
              r={balloonR}
              fill={COLOR.bg}
              stroke={COLOR.accent}
              strokeWidth={1}
            />
            <text
              x={b.balloonX}
              y={-b.balloonY}
              fontSize={fontSize}
              fontWeight={700}
              fill={COLOR.ink}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="ui-sans-serif, sans-serif"
            >
              {b.number}
            </text>
          </g>
        ))}
      </svg>
      {showLegend && (
        <div style={{
          minWidth: 180, fontSize: 12, color: COLOR.ink, lineHeight: 1.5,
          background: COLOR.bg, border: '1px solid #e5e7eb', borderRadius: 4,
          padding: '8px 10px', maxHeight: height, overflow: 'auto',
        }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {balloons.map(b => (
                <tr key={`leg-${b.partId}`}>
                  <td style={{
                    padding: '2px 6px', fontWeight: 700,
                    color: COLOR.accent, width: 24, textAlign: 'right',
                  }}>{b.number}</td>
                  <td style={{ padding: '2px 6px' }}>{b.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
