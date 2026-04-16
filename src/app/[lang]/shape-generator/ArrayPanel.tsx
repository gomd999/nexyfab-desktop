'use client';

import React, { useState } from 'react';
import type { ArrayPattern } from './features/instanceArray';
import { instanceCount } from './features/instanceArray';

interface ArrayPanelProps {
  onApply: (pattern: ArrayPattern) => void;
  onClose: () => void;
  isKo?: boolean;
  t?: Record<string, string>;
}

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#388bfd',
  danger: '#f85149',
};

const DEFAULT_PATTERN: ArrayPattern = {
  type: 'linear',
  countX: 3, countY: 1, countZ: 1,
  spacingX: 60, spacingY: 60, spacingZ: 60,
  radialCount: 6, radialRadius: 80, radialAxis: 'y',
};

function SliderRow({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: C.muted, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: C.accent, height: 4 }}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: 52, padding: '2px 6px', background: '#0d1117', color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11,
          fontFamily: 'monospace', textAlign: 'right',
        }}
      />
    </div>
  );
}

export default function ArrayPanel({ onApply, onClose, isKo = false, t }: ArrayPanelProps) {
  const [pattern, setPattern] = useState<ArrayPattern>(DEFAULT_PATTERN);

  const count = instanceCount(pattern);

  const set = <K extends keyof ArrayPattern>(key: K, value: ArrayPattern[K]) => {
    setPattern(prev => ({ ...prev, [key]: value }));
  };

  const label = (ko: string, en: string) => isKo ? ko : en;

  return (
    <div style={{
      width: 320, flexShrink: 0,
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`, gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>⊞</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
            {label('배열/패턴', 'Array / Pattern')}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
            {label('인스턴싱으로 복수 복사', 'Instanced mesh copies')}
          </div>
        </div>
        <button onClick={onClose} style={{
          border: 'none', background: C.card, cursor: 'pointer', fontSize: 12,
          color: C.muted, width: 24, height: 24, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.color = C.muted; }}
        >✕</button>
      </div>

      {/* Scrollable body */}
      <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Mode selector */}
        <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            {label('배열 유형', 'Array Type')}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['linear', 'radial', 'grid'] as const).map(type => (
              <button
                key={type}
                onClick={() => set('type', type)}
                style={{
                  flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  border: pattern.type === type ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                  background: pattern.type === type ? `${C.accent}22` : '#0d1117',
                  color: pattern.type === type ? C.accent : C.muted,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {type === 'linear'
                  ? label('직선', 'Linear')
                  : type === 'radial'
                    ? label('원형', 'Radial')
                    : label('격자', 'Grid')}
              </button>
            ))}
          </div>
        </div>

        {/* Linear params */}
        {pattern.type === 'linear' && (
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {label('직선 배열 설정', 'Linear Array Settings')}
            </div>
            <SliderRow label={label('X 개수', 'Count X')} value={pattern.countX} min={1} max={20} onChange={v => set('countX', v)} />
            <SliderRow label={label('Y 개수', 'Count Y')} value={pattern.countY} min={1} max={20} onChange={v => set('countY', v)} />
            <SliderRow label={label('Z 개수', 'Count Z')} value={pattern.countZ} min={1} max={20} onChange={v => set('countZ', v)} />
            <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
            <SliderRow label={label('X 간격', 'Spacing X')} value={pattern.spacingX} min={1} max={500} step={5} onChange={v => set('spacingX', v)} />
            <SliderRow label={label('Y 간격', 'Spacing Y')} value={pattern.spacingY} min={1} max={500} step={5} onChange={v => set('spacingY', v)} />
            <SliderRow label={label('Z 간격', 'Spacing Z')} value={pattern.spacingZ} min={1} max={500} step={5} onChange={v => set('spacingZ', v)} />
          </div>
        )}

        {/* Radial params */}
        {pattern.type === 'radial' && (
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {label('원형 배열 설정', 'Radial Array Settings')}
            </div>
            <SliderRow label={label('개수', 'Count')} value={pattern.radialCount} min={2} max={64} onChange={v => set('radialCount', v)} />
            <SliderRow label={label('반경', 'Radius')} value={pattern.radialRadius} min={10} max={500} step={5} onChange={v => set('radialRadius', v)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: C.muted, minWidth: 80 }}>{label('회전 축', 'Axis')}</span>
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                {(['x', 'y', 'z'] as const).map(ax => (
                  <button key={ax} onClick={() => set('radialAxis', ax)} style={{
                    flex: 1, padding: '4px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                    border: pattern.radialAxis === ax ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                    background: pattern.radialAxis === ax ? `${C.accent}22` : '#0d1117',
                    color: pattern.radialAxis === ax ? C.accent : C.muted,
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}>
                    {ax.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Grid params */}
        {pattern.type === 'grid' && (
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {label('격자 배열 설정 (XZ 평면)', 'Grid Settings (XZ Plane)')}
            </div>
            <SliderRow label={label('X 개수', 'Count X')} value={pattern.countX} min={1} max={20} onChange={v => set('countX', v)} />
            <SliderRow label={label('Z 개수', 'Count Z')} value={pattern.countZ} min={1} max={20} onChange={v => set('countZ', v)} />
            <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
            <SliderRow label={label('X 간격', 'Spacing X')} value={pattern.spacingX} min={1} max={500} step={5} onChange={v => set('spacingX', v)} />
            <SliderRow label={label('Z 간격', 'Spacing Z')} value={pattern.spacingZ} min={1} max={500} step={5} onChange={v => set('spacingZ', v)} />
          </div>
        )}

        {/* Instance count display */}
        <div style={{
          background: '#0d1117', borderRadius: 8, border: `1px solid ${C.border}`,
          padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            {label('인스턴스 수', 'Instance Count')}
          </span>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.accent, fontFamily: 'monospace' }}>
            {count.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', gap: 8 }}>
        <button
          onClick={() => onApply(pattern)}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
            background: C.accent, color: '#fff', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1a7fe8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.accent; }}
        >
          ⊞ {label('피처로 적용', 'Apply as Feature')}
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.muted, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >
          {label('닫기', 'Close')}
        </button>
      </div>
    </div>
  );
}
