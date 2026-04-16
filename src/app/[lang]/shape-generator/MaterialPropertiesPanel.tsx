'use client';

import React from 'react';

export type EnvPreset =
  | 'apartment' | 'city' | 'dawn' | 'forest' | 'lobby'
  | 'night' | 'park' | 'studio' | 'sunset' | 'warehouse';

export interface MaterialOverride {
  color?: string;
  metalness?: number;
  roughness?: number;
  envMapIntensity?: number;
}

interface MaterialPropertiesPanelProps {
  override: MaterialOverride;
  onOverrideChange: (next: MaterialOverride) => void;
  envPreset: EnvPreset;
  onEnvPresetChange: (p: EnvPreset) => void;
  presetName?: string;
  onReset: () => void;
  lang: string;
}

const ENV_PRESETS: { id: EnvPreset; label: string }[] = [
  { id: 'studio',    label: 'Studio' },
  { id: 'city',      label: 'City' },
  { id: 'apartment', label: 'Apartment' },
  { id: 'dawn',      label: 'Dawn' },
  { id: 'forest',    label: 'Forest' },
  { id: 'lobby',     label: 'Lobby' },
  { id: 'night',     label: 'Night' },
  { id: 'park',      label: 'Park' },
  { id: 'sunset',    label: 'Sunset' },
  { id: 'warehouse', label: 'Warehouse' },
];

export default function MaterialPropertiesPanel({
  override,
  onOverrideChange,
  envPreset,
  onEnvPresetChange,
  presetName,
  onReset,
  lang,
}: MaterialPropertiesPanelProps) {
  const isKo = lang === 'ko';

  const set = (key: keyof MaterialOverride, value: string | number) =>
    onOverrideChange({ ...override, [key]: value });

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 60,
    right: 20,
    zIndex: 500,
    width: 240,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    color: '#e6edf3',
    fontFamily: 'sans-serif',
    fontSize: 13,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    userSelect: 'none',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #30363d',
    fontWeight: 600,
    fontSize: 13,
  };

  const bodyStyle: React.CSSProperties = {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 11,
    color: '#c9d1d9',
  };

  const sectionTitle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 10,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    accentColor: '#58a6ff',
    cursor: 'pointer',
    marginTop: 3,
  };

  const resetBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 0',
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#8b949e',
    fontWeight: 600,
    fontSize: 11,
    cursor: 'pointer',
    marginTop: 2,
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>🎨 {isKo ? '재료 프리뷰' : 'Material Preview'}</span>
        {presetName && (
          <span style={{ fontSize: 10, color: '#8b949e', fontWeight: 400 }}>{presetName}</span>
        )}
      </div>

      <div style={bodyStyle}>
        {/* Color */}
        <div>
          <div style={sectionTitle}>{isKo ? '색상' : 'Color'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={override.color ?? '#888888'}
              onChange={(e) => set('color', e.target.value)}
              style={{ width: 32, height: 24, borderRadius: 4, border: '1px solid #30363d', cursor: 'pointer', padding: 0, background: 'none' }}
            />
            <input
              type="text"
              value={override.color ?? ''}
              onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set('color', e.target.value); }}
              style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', fontSize: 11, padding: '3px 7px', fontFamily: 'monospace' }}
              placeholder="#888888"
            />
          </div>
        </div>

        {/* Metalness */}
        <div>
          <div style={rowStyle}>
            <span style={sectionTitle}>{isKo ? '금속성 (Metalness)' : 'Metalness'}</span>
            <span style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11 }}>
              {(override.metalness ?? 0).toFixed(2)}
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01}
            value={override.metalness ?? 0}
            onChange={(e) => set('metalness', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>

        {/* Roughness */}
        <div>
          <div style={rowStyle}>
            <span style={sectionTitle}>{isKo ? '거칠기 (Roughness)' : 'Roughness'}</span>
            <span style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11 }}>
              {(override.roughness ?? 0.5).toFixed(2)}
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01}
            value={override.roughness ?? 0.5}
            onChange={(e) => set('roughness', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>

        {/* Env Map Intensity */}
        <div>
          <div style={rowStyle}>
            <span style={sectionTitle}>{isKo ? '환경광 강도' : 'Env Intensity'}</span>
            <span style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11 }}>
              {(override.envMapIntensity ?? 1).toFixed(1)}
            </span>
          </div>
          <input
            type="range" min={0} max={3} step={0.1}
            value={override.envMapIntensity ?? 1}
            onChange={(e) => set('envMapIntensity', parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>

        {/* Environment Preset */}
        <div>
          <div style={sectionTitle}>{isKo ? '환경 프리셋 (HDR)' : 'Environment (HDR)'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ENV_PRESETS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onEnvPresetChange(id)}
                style={{
                  padding: '3px 7px',
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: envPreset === id ? '1px solid #388bfd' : '1px solid #30363d',
                  background: envPreset === id ? 'rgba(56,139,253,0.15)' : '#21262d',
                  color: envPreset === id ? '#388bfd' : '#8b949e',
                  transition: 'all 0.12s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Reset */}
        <button style={resetBtnStyle} onClick={onReset}>
          {isKo ? '프리셋으로 초기화' : 'Reset to Preset'}
        </button>
      </div>
    </div>
  );
}
