'use client';

import React, { useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ShapeResult } from './shapes';
import { formatWithUnit, type UnitSystem } from './units';

/**
 * Dimension line component that uses lineSegments to avoid SVG <line> conflict.
 */
function DimLine({ points, color = '#f59e0b' }: { points: THREE.Vector3[]; color?: string }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} opacity={0.8} transparent />
    </lineSegments>
  );
}

/**
 * Renders dimension annotation lines + labels in 3D space.
 * Shows width (X), height (Y), depth (Z) with measurements.
 * Labels are clickable when onDimClick is provided.
 */
export default function DimensionOverlay({
  result,
  visible = true,
  unitSystem = 'mm',
  onDimClick,
}: {
  result: ShapeResult | null;
  visible?: boolean;
  unitSystem?: UnitSystem;
  onDimClick?: (dim: 'w' | 'h' | 'd', currentValue: number) => void;
}) {
  const [editingDim, setEditingDim] = useState<'w' | 'h' | 'd' | null>(null);
  const [editValue, setEditValue] = useState('');

  const dims = useMemo(() => {
    if (!result) return null;
    result.geometry.computeBoundingBox();
    const bb = result.geometry.boundingBox;
    if (!bb) return null;
    const min = bb.min;
    const max = bb.max;
    const size = bb.getSize(new THREE.Vector3());
    const off = Math.max(size.x, size.y, size.z) * 0.15;

    return [
      {
        // Width (X)
        linePoints: [new THREE.Vector3(min.x, min.y, max.z + off), new THREE.Vector3(max.x, min.y, max.z + off)],
        mid: new THREE.Vector3((min.x + max.x) / 2, min.y, max.z + off + 3),
        value: size.x, label: 'W',
        tickDir: new THREE.Vector3(0, 1, 0),
        tickLen: Math.max(size.x * 0.03, 1.5),
      },
      {
        // Height (Y)
        linePoints: [new THREE.Vector3(max.x + off, min.y, max.z), new THREE.Vector3(max.x + off, max.y, max.z)],
        mid: new THREE.Vector3(max.x + off + 3, (min.y + max.y) / 2, max.z),
        value: size.y, label: 'H',
        tickDir: new THREE.Vector3(0, 0, 1),
        tickLen: Math.max(size.y * 0.03, 1.5),
      },
      {
        // Depth (Z)
        linePoints: [new THREE.Vector3(max.x + off, min.y, min.z), new THREE.Vector3(max.x + off, min.y, max.z)],
        mid: new THREE.Vector3(max.x + off + 3, min.y, (min.z + max.z) / 2),
        value: size.z, label: 'D',
        tickDir: new THREE.Vector3(0, 1, 0),
        tickLen: Math.max(size.z * 0.03, 1.5),
      },
    ];
  }, [result]);

  if (!visible || !dims) return null;

  return (
    <group>
      {dims.map((dim, idx) => {
        const td = dim.tickDir.clone().multiplyScalar(dim.tickLen);
        const tick1Points = [dim.linePoints[0].clone().add(td), dim.linePoints[0].clone().sub(td)];
        const tick2Points = [dim.linePoints[1].clone().add(td), dim.linePoints[1].clone().sub(td)];
        const dimKey = dim.label.toLowerCase() as 'w' | 'h' | 'd';

        return (
          <group key={idx}>
            <DimLine points={dim.linePoints} />
            <DimLine points={tick1Points} />
            <DimLine points={tick2Points} />
            <Html position={dim.mid} center style={{ pointerEvents: onDimClick ? 'auto' : 'none', cursor: onDimClick ? 'pointer' : 'default' }}>
              {editingDim === dimKey ? (
                <input
                  autoFocus
                  type="number"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => {
                    const v = parseFloat(editValue);
                    if (!isNaN(v) && v > 0) onDimClick?.(dimKey, v);
                    setEditingDim(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                    if (e.key === 'Escape') { setEditingDim(null); }
                  }}
                  style={{ width: 60, padding: '2px 6px', borderRadius: 4, border: '1px solid #388bfd', background: '#1c2128', color: '#fff', fontSize: 11, outline: 'none' }}
                />
              ) : (
                <div
                  onClick={() => {
                    if (onDimClick) {
                      setEditingDim(dimKey);
                      setEditValue(dim.value.toFixed(1));
                    }
                  }}
                  style={{
                    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                    color: '#fbbf24', fontSize: 10, fontWeight: 700,
                    padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
                    border: `1px solid ${onDimClick ? 'rgba(56,139,253,0.5)' : 'rgba(251,191,36,0.3)'}`,
                    fontFamily: 'monospace',
                    cursor: onDimClick ? 'pointer' : 'default',
                  }}
                >
                  {dim.label}: {formatWithUnit(dim.value, unitSystem)}
                  {onDimClick && <span style={{ color: '#58a6ff', marginLeft: 4, fontSize: 8 }}>✏️</span>}
                </div>
              )}
            </Html>
          </group>
        );
      })}
    </group>
  );
}
