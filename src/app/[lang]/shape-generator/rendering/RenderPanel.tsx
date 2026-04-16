'use client';

import React from 'react';
import type { EnvironmentPreset, RenderModeProps } from './RenderMode';

export interface RenderSettings {
  environment: EnvironmentPreset;
  showBackground: boolean;
  shadowIntensity: number;
  bloomIntensity: number;
  showGround: boolean;
  exposure: number;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  environment: 'studio',
  showBackground: false,
  shadowIntensity: 0.4,
  bloomIntensity: 0,
  showGround: true,
  exposure: 1.0,
};

interface RenderPanelProps {
  settings: RenderSettings;
  onChange: (settings: RenderSettings) => void;
  onCapture: () => void;
  lang: string;
}

const ENV_OPTIONS: { value: EnvironmentPreset; labelKo: string; labelEn: string }[] = [
  { value: 'studio', labelKo: '스튜디오', labelEn: 'Studio' },
  { value: 'city', labelKo: '도시', labelEn: 'City' },
  { value: 'sunset', labelKo: '일몰', labelEn: 'Sunset' },
  { value: 'forest', labelKo: '숲', labelEn: 'Forest' },
  { value: 'warehouse', labelKo: '창고', labelEn: 'Warehouse' },
];

export default function RenderPanel({ settings, onChange, onCapture, lang }: RenderPanelProps) {
  const isKo = lang === 'ko';

  const update = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div style={{
      background: '#21262d',
      borderRadius: 10,
      border: '1px solid #30363d',
      padding: 12,
    }}>
      {/* Header */}
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#8b949e',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span style={{ fontSize: 14 }}>🎬</span>
        {isKo ? '렌더링 설정' : 'Render Settings'}
      </div>

      {/* Environment preset */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9', display: 'block', marginBottom: 4 }}>
          {isKo ? '환경' : 'Environment'}
        </label>
        <select
          value={settings.environment}
          onChange={e => update('environment', e.target.value as EnvironmentPreset)}
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid #30363d',
            background: '#0d1117',
            color: '#c9d1d9',
            fontSize: 12,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {ENV_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {isKo ? opt.labelKo : opt.labelEn}
            </option>
          ))}
        </select>
      </div>

      {/* Background toggle */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9' }}>
          {isKo ? '배경 표시' : 'Show Background'}
        </label>
        <button
          onClick={() => update('showBackground', !settings.showBackground)}
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: settings.showBackground ? '#388bfd' : '#484f58',
            position: 'relative', transition: 'background 0.2s',
          }}
        >
          <div style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 2,
            left: settings.showBackground ? 18 : 2,
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Ground plane toggle */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9' }}>
          {isKo ? '바닥면' : 'Ground Plane'}
        </label>
        <button
          onClick={() => update('showGround', !settings.showGround)}
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: settings.showGround ? '#388bfd' : '#484f58',
            position: 'relative', transition: 'background 0.2s',
          }}
        >
          <div style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 2,
            left: settings.showGround ? 18 : 2,
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Shadow intensity slider */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9' }}>
            {isKo ? '그림자 강도' : 'Shadow Intensity'}
          </label>
          <span style={{ fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>
            {settings.shadowIntensity.toFixed(2)}
          </span>
        </div>
        <input
          type="range" min={0} max={1} step={0.05}
          value={settings.shadowIntensity}
          onChange={e => update('shadowIntensity', parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#388bfd', height: 4 }}
        />
      </div>

      {/* Exposure slider */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9' }}>
            {isKo ? '노출' : 'Exposure'}
          </label>
          <span style={{ fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>
            {settings.exposure.toFixed(2)}
          </span>
        </div>
        <input
          type="range" min={0.2} max={3} step={0.05}
          value={settings.exposure}
          onChange={e => update('exposure', parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#388bfd', height: 4 }}
        />
      </div>

      {/* Capture button */}
      <button
        onClick={onCapture}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #388bfd',
          background: 'linear-gradient(135deg, #1a2332, #0d1117)',
          color: '#58a6ff',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#388bfd';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #1a2332, #0d1117)';
          e.currentTarget.style.color = '#58a6ff';
        }}
      >
        <span style={{ fontSize: 14 }}>📸</span>
        {isKo ? '스크린샷 캡처' : 'Capture Screenshot'}
      </button>
    </div>
  );
}
