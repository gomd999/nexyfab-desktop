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
import { loc } from '../lib/loc';

// Clear the right property pane (Shell default rightWidth = 320px) so the
// floating map opens INTO the viewport instead of covering the ANALYZE /
// DFM / FEA inspector rows. 320 pane + 16 margin. (2026-06-12 overlap fix)
const RIGHT_PANE_CLEARANCE = 336;

interface TopoMapPanelProps {
  topoMap: UseTopologicalMapReturn;
  lang?: string;
}

export default function TopoMapPanel({ topoMap, lang = 'en' }: TopoMapPanelProps) {
  const [open, setOpen] = useState(false);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);

  const labelOpen = loc(lang, { ko: '위상 ID 맵 열기', en: 'Open Topo Map', ja: '位相 ID マップを開く', zh: '打开拓扑 ID 映射', es: 'Abrir mapa topológico', ar: 'فتح خريطة المعرّف الطوبولوجي' });
  const labelClose = loc(lang, { ko: '닫기', en: 'Close', ja: '閉じる', zh: '关闭', es: 'Cerrar', ar: 'إغلاق' });
  const faceCount = Object.keys(topoMap.map.faces).length;

  return (
    <>
      {/* Toggle button — bottom chrome zone, offset left of the right pane */}
      <div style={{
        position: 'fixed', bottom: 50, right: RIGHT_PANE_CLEARANCE, zIndex: 510,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
      }}>
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? labelClose : labelOpen}
          style={{
            padding: '5px 11px',
            borderRadius: 7,
            border: open ? '1px solid #bc8cff' : '1px solid var(--nx-border)',
            background: open ? 'rgba(188,140,255,0.15)' : 'var(--nx-panel)',
            color: open ? 'var(--nx-accent-2)' : 'var(--nx-text-3)',
            fontSize: 11, fontWeight: 700,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s',
            boxShadow: open ? '0 0 12px rgba(188,140,255,0.25)' : 'none',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--nx-accent-2)';
            e.currentTarget.style.color = 'var(--nx-accent-2)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = open ? 'var(--nx-accent-2)' : 'var(--nx-border)';
            e.currentTarget.style.color = open ? 'var(--nx-accent-2)' : 'var(--nx-text-3)';
          }}
        >
          <span>🏷️</span>
          <span>Topo</span>
          <span style={{
            fontSize: 9, fontWeight: 800,
            background: 'rgba(188,140,255,0.2)',
            color: 'var(--nx-accent-2)',
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
          right: RIGHT_PANE_CLEARANCE,
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
