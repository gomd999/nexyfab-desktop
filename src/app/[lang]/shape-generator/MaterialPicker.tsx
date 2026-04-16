'use client';

import React, { useState, useCallback, useRef } from 'react';
import { MATERIAL_PRESETS, type MaterialPreset } from './materials';

interface MaterialPickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
  lang: string;
}

interface TooltipState {
  mat: MaterialPreset;
  x: number;
  y: number;
}

function PropRow({ label, value, unit }: { label: string; value: number | undefined; unit: string }) {
  if (value === undefined) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={{ color: '#8b949e', fontSize: 10, fontFamily: 'monospace', minWidth: 24 }}>{label}</span>
      <span style={{ color: '#c9d1d9', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
        {value < 1 ? value.toFixed(3) : value < 10 ? value.toFixed(2) : value.toFixed(1)}
      </span>
      <span style={{ color: '#484f58', fontSize: 9, minWidth: 36, textAlign: 'right' }}>{unit}</span>
    </div>
  );
}

export default function MaterialPicker({ selectedId, onSelect, lang }: MaterialPickerProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayLang = lang === 'ko' ? 'ko' : 'en';

  const handleMouseEnter = useCallback((e: React.MouseEvent, mat: MaterialPreset) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setTooltip({ mat, x: rect.right + 8, y: rect.top });
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTooltip(null);
  }, []);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
        {MATERIAL_PRESETS.map(mat => {
          const active = mat.id === selectedId;
          const hovered = tooltip?.mat.id === mat.id;
          const label = mat.name[displayLang] ?? mat.name.en;
          return (
            <div
              key={mat.id}
              onClick={() => onSelect(mat.id)}
              onMouseEnter={(e) => handleMouseEnter(e, mat)}
              onMouseLeave={handleMouseLeave}
              title={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: mat.color,
                border: active ? '2.5px solid #388bfd' : hovered ? '2px solid #58a6ff' : '2px solid #30363d',
                boxShadow: active ? '0 0 0 2px rgba(56,139,253,0.3)' : 'none',
                transition: 'all 0.15s',
                opacity: mat.transparent && mat.opacity ? 0.5 + mat.opacity * 0.5 : 1,
              }} />
            </div>
          );
        })}
      </div>

      {/* Rich material property tooltip */}
      {tooltip && (
        <div
          onMouseEnter={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            left: Math.min(tooltip.x, typeof window !== 'undefined' ? window.innerWidth - 172 : tooltip.x),
            top: Math.min(tooltip.y, typeof window !== 'undefined' ? window.innerHeight - 180 : tooltip.y),
            zIndex: 9000,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '10px 12px',
            minWidth: 158,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: tooltip.mat.color,
              border: '1.5px solid #30363d',
              flexShrink: 0,
              opacity: tooltip.mat.transparent && tooltip.mat.opacity ? 0.5 + tooltip.mat.opacity * 0.5 : 1,
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>
              {tooltip.mat.name[displayLang] ?? tooltip.mat.name.en}
            </span>
          </div>

          {/* Mechanical properties */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid #21262d', paddingTop: 7 }}>
            <PropRow label="E"  value={tooltip.mat.youngsModulus} unit="GPa" />
            <PropRow label="σy" value={tooltip.mat.yieldStrength} unit="MPa" />
            <PropRow label="ρ"  value={tooltip.mat.density}       unit="g/cm³" />
            <PropRow label="ν"  value={tooltip.mat.poissonRatio}  unit="" />
          </div>

          {/* Render properties row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 7, paddingTop: 6, borderTop: '1px solid #21262d' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <span style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{lang === 'ko' ? '거칠기' : 'Rough'}</span>
              <div style={{ width: '100%', height: 4, borderRadius: 2, background: '#21262d', overflow: 'hidden' }}>
                <div style={{ width: `${tooltip.mat.roughness * 100}%`, height: '100%', background: '#8b949e', borderRadius: 2 }} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <span style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{lang === 'ko' ? '금속성' : 'Metal'}</span>
              <div style={{ width: '100%', height: 4, borderRadius: 2, background: '#21262d', overflow: 'hidden' }}>
                <div style={{ width: `${tooltip.mat.metalness * 100}%`, height: '100%', background: '#58a6ff', borderRadius: 2 }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
