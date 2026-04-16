'use client';

import React, { useState, useCallback } from 'react';
import * as THREE from 'three';
import dynamic from 'next/dynamic';
import type { Theme } from './theme';

const FlatPatternPanel = dynamic(() => import('./features/FlatPatternPanel'), { ssr: false });

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SheetMetalPanelProps {
  lang: string;
  onBend: (angle: number, radius: number, position: number, direction: 'up' | 'down') => void;
  onFlange: (height: number, angle: number, radius: number, edgeIndex: number) => void;
  onFlatPattern: (thickness: number, kFactor: number) => void;
  onClose: () => void;
  /** Current scene geometry — passed to FlatPatternPanel for unfolding */
  geometry?: THREE.BufferGeometry | null;
  /** Theme from ThemeContext for FlatPatternPanel */
  theme?: Theme;
}

// ─── i18n ──────────────────────────────────────────────────────────────────────

const i18n: Record<string, Record<string, string>> = {
  ko: {
    title: '판금',
    bend: '굽힘',
    flange: '플랜지',
    flatPattern: '전개도',
    variableFillet: '가변 필릿',
    bendAngle: '굽힘 각도',
    bendRadius: '굽힘 반경',
    bendPosition: '굽힘 위치',
    bendDirection: '방향',
    up: '위',
    down: '아래',
    flangeHeight: '플랜지 높이',
    flangeAngle: '플랜지 각도',
    flangeRadius: '플랜지 반경',
    flangeEdge: '가장자리',
    edgePlusZ: '+Z 가장자리',
    edgeMinusZ: '-Z 가장자리',
    edgePlusX: '+X 가장자리',
    edgeMinusX: '-X 가장자리',
    thickness: '판 두께',
    kFactor: 'K팩터',
    apply: '적용',
    generateFlat: '전개도 생성',
    close: '닫기',
  },
  en: {
    title: 'Sheet Metal',
    bend: 'Bend',
    flange: 'Flange',
    flatPattern: 'Flat Pattern',
    variableFillet: 'Variable Fillet',
    bendAngle: 'Bend Angle',
    bendRadius: 'Bend Radius',
    bendPosition: 'Bend Position',
    bendDirection: 'Direction',
    up: 'Up',
    down: 'Down',
    flangeHeight: 'Flange Height',
    flangeAngle: 'Flange Angle',
    flangeRadius: 'Flange Radius',
    flangeEdge: 'Edge',
    edgePlusZ: '+Z Edge',
    edgeMinusZ: '-Z Edge',
    edgePlusX: '+X Edge',
    edgeMinusX: '-X Edge',
    thickness: 'Thickness',
    kFactor: 'K-Factor',
    apply: 'Apply',
    generateFlat: 'Generate Flat Pattern',
    close: 'Close',
  },
};

type TabId = 'bend' | 'flange' | 'flatPattern';

// ─── Component ─────────────────────────────────────────────────────────────────

export default function SheetMetalPanel({
  lang,
  onBend,
  onFlange,
  onFlatPattern,
  onClose,
  geometry = null,
  theme: themeProp,
}: SheetMetalPanelProps) {
  const t = i18n[lang] || i18n.en;

  const [activeTab, setActiveTab] = useState<TabId>('bend');

  // Bend state
  const [bendAngle, setBendAngle] = useState(90);
  const [bendRadius, setBendRadius] = useState(3);
  const [bendPosition, setBendPosition] = useState(50);
  const [bendDirection, setBendDirection] = useState<'up' | 'down'>('up');

  // Flange state
  const [flangeHeight, setFlangeHeight] = useState(20);
  const [flangeAngle, setFlangeAngle] = useState(90);
  const [flangeRadius, setFlangeRadius] = useState(3);
  const [flangeEdge, setFlangeEdge] = useState(0);

  // Flat pattern state
  const [thickness, setThickness] = useState(2);
  const [kFactor, setKFactor] = useState(0.44);

  const handleApplyBend = useCallback(() => {
    onBend(bendAngle, bendRadius, bendPosition / 100, bendDirection);
  }, [bendAngle, bendRadius, bendPosition, bendDirection, onBend]);

  const handleApplyFlange = useCallback(() => {
    onFlange(flangeHeight, flangeAngle, flangeRadius, flangeEdge);
  }, [flangeHeight, flangeAngle, flangeRadius, flangeEdge, onFlange]);

  const handleGenerateFlat = useCallback(() => {
    onFlatPattern(thickness, kFactor);
  }, [thickness, kFactor, onFlatPattern]);

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'bend', label: t.bend, icon: '↩' },
    { id: 'flange', label: t.flange, icon: '⌐' },
    { id: 'flatPattern', label: t.flatPattern, icon: '📐' },
  ];

  // ── Styles ──
  const panelStyle: React.CSSProperties = {
    position: 'absolute', right: 12, top: 60, width: 300,
    background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
    color: '#c9d1d9', fontFamily: 'Inter, sans-serif', zIndex: 100,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: '1px solid #30363d',
  };

  const tabBarStyle: React.CSSProperties = {
    display: 'flex', borderBottom: '1px solid #30363d',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 0', textAlign: 'center', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, border: 'none', background: 'transparent',
    color: active ? '#58a6ff' : '#8b949e',
    borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
    transition: 'all 0.15s',
  });

  const fieldStyle: React.CSSProperties = {
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#8b949e', fontWeight: 600,
  };

  const inputStyle: React.CSSProperties = {
    width: 80, padding: '4px 8px', borderRadius: 4,
    border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9',
    fontSize: 12, textAlign: 'right',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle, width: 120, textAlign: 'left',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%', padding: '8px 0', borderRadius: 6, border: 'none',
    background: '#238636', color: '#fff', fontWeight: 700, fontSize: 12,
    cursor: 'pointer', transition: 'background 0.15s',
  };

  const closeStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#8b949e', fontSize: 16,
    cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>🔨 {t.title}</span>
        <button style={closeStyle} onClick={onClose} title={t.close}>✕</button>
      </div>

      {/* Tab bar */}
      <div style={tabBarStyle}>
        {tabs.map(tab => (
          <button key={tab.id} style={tabStyle(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Bend tab */}
      {activeTab === 'bend' && (
        <div style={fieldStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.bendAngle} (deg)</span>
            <input type="number" style={inputStyle} value={bendAngle} min={1} max={180} step={1}
              onChange={e => setBendAngle(Number(e.target.value))} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.bendRadius} (mm)</span>
            <input type="number" style={inputStyle} value={bendRadius} min={0.5} max={50} step={0.5}
              onChange={e => setBendRadius(Number(e.target.value))} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.bendPosition} (%)</span>
            <input type="range" style={{ flex: 1, margin: '0 8px' }} value={bendPosition} min={5} max={95} step={1}
              onChange={e => setBendPosition(Number(e.target.value))} />
            <span style={{ fontSize: 11, color: '#58a6ff', minWidth: 30, textAlign: 'right' }}>{bendPosition}%</span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.bendDirection}</span>
            <select style={selectStyle} value={bendDirection} onChange={e => setBendDirection(e.target.value as 'up' | 'down')}>
              <option value="up">{t.up}</option>
              <option value="down">{t.down}</option>
            </select>
          </div>
          <button style={buttonStyle} onClick={handleApplyBend}>{t.apply}</button>
        </div>
      )}

      {/* Flange tab */}
      {activeTab === 'flange' && (
        <div style={fieldStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.flangeHeight} (mm)</span>
            <input type="number" style={inputStyle} value={flangeHeight} min={1} max={200} step={1}
              onChange={e => setFlangeHeight(Number(e.target.value))} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.flangeAngle} (deg)</span>
            <input type="number" style={inputStyle} value={flangeAngle} min={1} max={180} step={1}
              onChange={e => setFlangeAngle(Number(e.target.value))} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.flangeRadius} (mm)</span>
            <input type="number" style={inputStyle} value={flangeRadius} min={0.5} max={50} step={0.5}
              onChange={e => setFlangeRadius(Number(e.target.value))} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t.flangeEdge}</span>
            <select style={selectStyle} value={flangeEdge} onChange={e => setFlangeEdge(Number(e.target.value))}>
              <option value={0}>{t.edgePlusZ}</option>
              <option value={1}>{t.edgeMinusZ}</option>
              <option value={2}>{t.edgePlusX}</option>
              <option value={3}>{t.edgeMinusX}</option>
            </select>
          </div>
          <button style={buttonStyle} onClick={handleApplyFlange}>{t.apply}</button>
        </div>
      )}

      {/* Flat Pattern tab */}
      {activeTab === 'flatPattern' && (
        geometry && themeProp ? (
          /* Full flat-pattern panel with SVG preview and DXF/SVG export */
          <FlatPatternPanel
            geometry={geometry}
            thickness={thickness}
            theme={themeProp}
            lang={lang}
          />
        ) : (
          /* Fallback: simple parameter form (no geometry passed yet) */
          <div style={fieldStyle}>
            <div style={rowStyle}>
              <span style={labelStyle}>{t.thickness} (mm)</span>
              <input type="number" style={inputStyle} value={thickness} min={0.5} max={20} step={0.5}
                onChange={e => setThickness(Number(e.target.value))} />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>{t.kFactor}</span>
              <input type="number" style={inputStyle} value={kFactor} min={0.2} max={0.6} step={0.01}
                onChange={e => setKFactor(Number(e.target.value))} />
            </div>
            <div style={{ fontSize: 10, color: '#8b949e', lineHeight: 1.5 }}>
              {lang === 'ko'
                ? 'K팩터: 강(0.44), 알루미늄(0.33), 동(0.35)'
                : 'K-Factor: Steel(0.44), Aluminum(0.33), Copper(0.35)'}
            </div>
            <button style={buttonStyle} onClick={handleGenerateFlat}>{t.generateFlat}</button>
          </div>
        )
      )}
    </div>
  );
}
