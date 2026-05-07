'use client';

import React, { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { GDTAnnotation, DimensionAnnotation } from './GDTTypes';
import { GDT_SYMBOLS } from './GDTTypes';

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const frameStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'rgba(0,0,0,0.85)',
  backdropFilter: 'blur(4px)',
  border: '1.5px solid #58a6ff',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 11,
  fontWeight: 700,
  color: '#e6edf3',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  userSelect: 'none',
};

const cellStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRight: '1px solid #58a6ff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const lastCellStyle: React.CSSProperties = {
  ...cellStyle,
  borderRight: 'none',
};

const dimLabelStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
  color: '#fbbf24',
  fontSize: 11,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 4,
  whiteSpace: 'nowrap',
  border: '1px solid rgba(251,191,36,0.35)',
  fontFamily: 'monospace',
  pointerEvents: 'none',
  userSelect: 'none',
};

/* ─── GD&T Feature Control Frame ─────────────────────────────────────────── */

function GDTFrame({ annotation }: { annotation: GDTAnnotation }) {
  const sym = GDT_SYMBOLS[annotation.symbol];
  const pos = annotation.position;

  // Leader line: from annotation slightly offset upward to the anchor point
  const labelOffset: [number, number, number] = [pos[0], pos[1] + 8, pos[2]];

  return (
    <group>
      {/* Leader line from surface anchor to label */}
      <Line
        points={[pos, labelOffset]}
        color="#58a6ff"
        lineWidth={1.5}
        dashed
        dashSize={1.5}
        gapSize={0.8}
      />
      {/* Small sphere at anchor point */}
      <mesh position={pos}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial color="#58a6ff" depthTest={false} transparent opacity={0.9} />
      </mesh>
      {/* ISO-style feature control frame */}
      <Html position={labelOffset} center style={{ pointerEvents: 'none' }}>
        <div style={frameStyle}>
          <div style={cellStyle}>
            <span style={{ fontSize: 14 }}>{sym}</span>
          </div>
          <div style={annotation.datum ? cellStyle : lastCellStyle}>
            {annotation.tolerance.toFixed(2)}
          </div>
          {annotation.datum && (
            <div style={lastCellStyle}>
              {annotation.datum}
            </div>
          )}
        </div>
        {annotation.label && (
          <div style={{ color: '#8b949e', fontSize: 9, textAlign: 'center', marginTop: 2, fontFamily: 'monospace' }}>
            {annotation.label}
          </div>
        )}
      </Html>
    </group>
  );
}

/* ─── Dimension Annotation ───────────────────────────────────────────────── */

function DimensionFrame({ annotation }: { annotation: DimensionAnnotation }) {
  const pos = annotation.position;
  const dir = new THREE.Vector3(...annotation.direction).normalize();
  const halfLen = Math.max(annotation.value * 0.3, 5);

  // Endpoints of the dimension line
  const startPt: [number, number, number] = [
    pos[0] - dir.x * halfLen,
    pos[1] - dir.y * halfLen,
    pos[2] - dir.z * halfLen,
  ];
  const endPt: [number, number, number] = [
    pos[0] + dir.x * halfLen,
    pos[1] + dir.y * halfLen,
    pos[2] + dir.z * halfLen,
  ];

  // Format tolerance display
  let tolText = '';
  if (annotation.tolerance) {
    const { upper, lower } = annotation.tolerance;
    if (upper === -lower) {
      tolText = ` \u00B1${upper.toFixed(2)}`;
    } else {
      tolText = ` +${upper.toFixed(2)}/${lower.toFixed(2)}`;
    }
  }

  // Prefix for diameter / radial
  const prefix = annotation.type === 'diameter' ? '\u2300' : annotation.type === 'radial' ? 'R' : '';
  const suffix = annotation.type === 'angular' ? '\u00B0' : '';
  const valueStr = `${prefix}${annotation.value.toFixed(2)}${suffix}${tolText}`;

  return (
    <group>
      {/* Dimension line */}
      <Line points={[startPt, endPt]} color="#fbbf24" lineWidth={1.5} />
      {/* Arrowhead markers at ends */}
      <mesh position={startPt}>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshBasicMaterial color="#fbbf24" depthTest={false} />
      </mesh>
      <mesh position={endPt}>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshBasicMaterial color="#fbbf24" depthTest={false} />
      </mesh>
      {/* Value label at midpoint */}
      <Html position={pos} center style={{ pointerEvents: 'none' }}>
        <div style={dimLabelStyle}>
          {valueStr}
        </div>
        {annotation.label && (
          <div style={{ color: '#8b949e', fontSize: 9, textAlign: 'center', marginTop: 1, fontFamily: 'monospace' }}>
            {annotation.label}
          </div>
        )}
      </Html>
    </group>
  );
}

/* ─── Main Overlay ───────────────────────────────────────────────────────── */

interface GDTOverlayProps {
  gdtAnnotations?: GDTAnnotation[];
  dimensionAnnotations?: DimensionAnnotation[];
}

export default function GDTOverlay({ gdtAnnotations, dimensionAnnotations }: GDTOverlayProps) {
  const hasGDT = gdtAnnotations && gdtAnnotations.length > 0;
  const hasDim = dimensionAnnotations && dimensionAnnotations.length > 0;

  if (!hasGDT && !hasDim) return null;

  return (
    <group>
      {hasGDT && gdtAnnotations.map(a => <GDTFrame key={a.id} annotation={a} />)}
      {hasDim && dimensionAnnotations.map(a => <DimensionFrame key={a.id} annotation={a} />)}
    </group>
  );
}
