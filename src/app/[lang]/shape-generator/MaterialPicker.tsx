'use client';

import React, { useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { MATERIAL_PRESETS, USE_CASE_DEFS, type MaterialPreset, type MaterialUseCase } from './materials';

const dict = {
  ko: { rough: '거칠기', metal: '금속성' },
  en: { rough: 'Rough', metal: 'Metal' },
  ja: { rough: '粗さ', metal: '金属性' },
  zh: { rough: '粗糙度', metal: '金属度' },
  es: { rough: 'Rugoso', metal: 'Metal' },
  ar: { rough: 'خشونة', metal: 'معدني' },
};

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
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [useCase, setUseCase] = useState<MaterialUseCase | null>(null);
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
      {/* ── Use-case chip row: filters recommendation, not availability ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
        {USE_CASE_DEFS.map(uc => {
          const active = useCase === uc.id;
          const label = uc.label[displayLang] ?? uc.label.en;
          const hint  = uc.hint[displayLang]  ?? uc.hint.en;
          return (
            <button
              key={uc.id}
              type="button"
              onClick={() => setUseCase(active ? null : uc.id)}
              title={hint}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 6px',
                borderRadius: 10,
                fontSize: 10,
                lineHeight: 1.2,
                cursor: 'pointer',
                border: active ? '1px solid #58a6ff' : '1px solid #30363d',
                background: active ? 'rgba(56,139,253,0.15)' : '#0d1117',
                color: active ? '#58a6ff' : '#8b949e',
                transition: 'all 0.1s',
              }}
            >
              <span style={{ fontSize: 10 }}>{uc.icon}</span>
              <span style={{ fontWeight: active ? 700 : 500 }}>{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {MATERIAL_PRESETS.map(mat => {
          const active = mat.id === selectedId;
          const recommended = useCase ? mat.useCases?.includes(useCase) ?? false : true;
          const label = mat.name[displayLang] ?? mat.name.en;
          const isMetal = mat.metalness > 0.5;
          return (
            <div
              key={mat.id}
              onClick={() => onSelect(mat.id)}
              onMouseEnter={(e) => handleMouseEnter(e, mat)}
              onMouseLeave={handleMouseLeave}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 10,
                cursor: 'pointer',
                opacity: recommended ? 1 : 0.3,
                filter: recommended ? 'none' : 'grayscale(0.6)',
                transition: 'all 0.15s ease',
                background: active
                  ? 'rgba(56,139,253,0.12)'
                  : 'rgba(255,255,255,0.02)',
                border: active
                  ? '1.5px solid rgba(56,139,253,0.6)'
                  : '1px solid rgba(255,255,255,0.06)',
                boxShadow: active
                  ? '0 0 12px rgba(56,139,253,0.2)'
                  : 'none',
              }}
            >
              {/* Color swatch */}
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: isMetal
                  ? `linear-gradient(135deg, ${mat.color} 0%, ${mat.color}aa 60%, #fff8 100%)`
                  : mat.color,
                border: `1.5px solid ${active ? '#388bfd' : 'rgba(255,255,255,0.1)'}`,
                boxShadow: isMetal ? `inset 0 1px 3px rgba(255,255,255,0.3)` : 'none',
                opacity: mat.transparent && mat.opacity ? 0.5 + mat.opacity * 0.5 : 1,
              }} />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: active ? 700 : 600,
                  color: active ? '#58a6ff' : '#c9d1d9',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}>
                  {label}
                </div>
                <div style={{
                  fontSize: 9, color: '#484f58', marginTop: 2,
                  display: 'flex', gap: 6,
                }}>
                  {mat.density !== undefined && <span>{mat.density} g/cm³</span>}
                  {mat.yieldStrength !== undefined && <span>σ{mat.yieldStrength}MPa</span>}
                </div>
              </div>

              {/* Recommended badge */}
              {recommended && useCase && !active && (
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#3fb950', flexShrink: 0,
                  boxShadow: '0 0 4px #3fb950',
                }} />
              )}
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
              <span style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{t.rough}</span>
              <div style={{ width: '100%', height: 4, borderRadius: 2, background: '#21262d', overflow: 'hidden' }}>
                <div style={{ width: `${tooltip.mat.roughness * 100}%`, height: '100%', background: '#8b949e', borderRadius: 2 }} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <span style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{t.metal}</span>
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
