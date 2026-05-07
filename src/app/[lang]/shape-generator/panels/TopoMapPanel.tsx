'use client';
/**
 * TopoMapPanel – Floating "Topological ID Map" toggle panel
 *
 * A collapsible floating panel that can be opened via a small
 * icon button in the viewport. Shows the current topological map
 * using the TopoPanel inspector component.
 *
 * Consumed directly in ShapeGeneratorInner.tsx.
 */

import React, { useState } from 'react';
import TopoPanel from '../topology/TopoPanel';
import type { UseTopologicalMapReturn } from '../topology/useTopologicalMap';

interface TopoMapPanelProps {
  topoMap: UseTopologicalMapReturn;
  lang?: string;
}

export default function TopoMapPanel({ topoMap, lang = 'en' }: TopoMapPanelProps) {
  const [open, setOpen] = useState(false);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);

  const isKo = lang === 'ko' || lang === 'kr';
  const labelOpen = isKo ? '위상 ID 맵 열기' : 'Open Topo Map';
  const labelClose = isKo ? '닫기' : 'Close';
  const faceCount = Object.keys(topoMap.map.faces).length;

  return (
    <>
      {/* Toggle button — sits in bottom-right chrome zone */}
      <div style={{
        position: 'fixed', bottom: 50, right: 16, zIndex: 510,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
      }}>
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? labelClose : labelOpen}
          style={{
            padding: '5px 11px',
            borderRadius: 7,
            border: open ? '1px solid #bc8cff' : '1px solid #30363d',
            background: open ? 'rgba(188,140,255,0.15)' : '#161b22',
            color: open ? '#bc8cff' : '#6e7681',
            fontSize: 11, fontWeight: 700,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s',
            boxShadow: open ? '0 0 12px rgba(188,140,255,0.25)' : 'none',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = '#bc8cff';
            e.currentTarget.style.color = '#bc8cff';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = open ? '#bc8cff' : '#30363d';
            e.currentTarget.style.color = open ? '#bc8cff' : '#6e7681';
          }}
        >
          <span>🏷️</span>
          <span>Topo</span>
          <span style={{
            fontSize: 9, fontWeight: 800,
            background: 'rgba(188,140,255,0.2)',
            color: '#bc8cff',
            borderRadius: 8,
            padding: '0 5px',
            border: '1px solid rgba(188,140,255,0.3)',
          }}>
            {faceCount}
          </span>
        </button>
      </div>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 90,
          right: 16,
          width: 320,
          zIndex: 510,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(188,140,255,0.2)',
          animation: 'topoSlideIn 0.18s ease',
        }}>
          <style>{`
            @keyframes topoSlideIn {
              from { opacity: 0; transform: translateY(8px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          <TopoPanel
            map={topoMap.map}
            selectedFaceIndex={selectedFaceIndex}
            onSelectFace={setSelectedFaceIndex}
            lang={lang}
            visible
          />
        </div>
      )}
    </>
  );
}
