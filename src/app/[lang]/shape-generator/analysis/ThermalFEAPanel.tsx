'use client';
import React, { useState, useCallback } from 'react';
import * as THREE from 'three';
import { runThermalFEA, applyThermalColormap, THERMAL_MATERIALS, type ThermalBoundary, type ThermalResult } from './thermalFEA';

interface Props {
  geometry: THREE.BufferGeometry | null;
  lang: string;
  onResult: (coloredGeo: THREE.BufferGeometry, result: ThermalResult) => void;
  onClose: () => void;
}

const FACE_NAMES_KO = ['하면(-Y)', '상면(+Y)', '전면(-Z)', '후면(+Z)', '좌면(-X)', '우면(+X)'];
const FACE_NAMES_EN = ['Bottom(-Y)', 'Top(+Y)', 'Front(-Z)', 'Back(+Z)', 'Left(-X)', 'Right(+X)'];
const C = { bg: '#0d1117', card: '#161b22', border: '#30363d', text: '#c9d1d9', muted: '#8b949e', accent: '#388bfd', hot: '#f85149', warn: '#f59e0b', ok: '#3fb950' };

type BoundaryEdit = ThermalBoundary & { id: string };

export default function ThermalFEAPanel({ geometry, lang, onResult, onClose }: Props) {
  const isKo = lang === 'ko';
  const faceNames = isKo ? FACE_NAMES_KO : FACE_NAMES_EN;

  const [materialId, setMaterialId] = useState<keyof typeof THERMAL_MATERIALS>('aluminum');
  const [ambientTemp, setAmbientTemp] = useState(25);
  const [boundaries, setBoundaries] = useState<BoundaryEdit[]>([
    { id: 'b1', type: 'heat_source', faceIndex: 0, value: 500 },
    { id: 'b2', type: 'fixed_temp', faceIndex: 1, value: 25 },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ThermalResult | null>(null);

  const addBoundary = () => {
    setBoundaries(prev => [...prev, { id: `b${Date.now()}`, type: 'heat_source', faceIndex: 0, value: 100 }]);
  };

  const removeBoundary = (id: string) => setBoundaries(prev => prev.filter(b => b.id !== id));

  const updateBoundary = (id: string, patch: Partial<BoundaryEdit>) => {
    setBoundaries(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  };

  const run = useCallback(async () => {
    if (!geometry || isRunning) return;
    setIsRunning(true);
    setResult(null);
    try {
      const mat = THERMAL_MATERIALS[materialId];
      const res = runThermalFEA(geometry, boundaries, mat, ambientTemp);
      setResult(res);
      const coloredGeo = applyThermalColormap(geometry, res);
      onResult(coloredGeo, res);
    } catch (err) {
      console.error('[ThermalFEA]', err);
    } finally {
      setIsRunning(false);
    }
  }, [geometry, boundaries, materialId, ambientTemp, isRunning, onResult]);

  const mat = THERMAL_MATERIALS[materialId];

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, width: 290, color: C.text, fontSize: 12, maxHeight: '85vh', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>🌡️ {isKo ? '열해석 (Thermal FEA)' : 'Thermal FEA'}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      {/* Material */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 5 }}>{isKo ? '재질' : 'Material'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(Object.entries(THERMAL_MATERIALS) as [keyof typeof THERMAL_MATERIALS, typeof THERMAL_MATERIALS[keyof typeof THERMAL_MATERIALS]][]).map(([id, m]) => (
            <button key={id} onClick={() => setMaterialId(id)}
              style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${materialId === id ? C.accent : C.border}`, background: materialId === id ? 'rgba(56,139,253,0.15)' : 'transparent', color: materialId === id ? C.accent : C.muted, fontSize: 10, cursor: 'pointer', fontWeight: materialId === id ? 700 : 400 }}>
              {isKo ? m.nameKo : m.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
          k = {mat.conductivity} W/(m·K) · ρ = {mat.density} kg/m³
        </div>
      </div>

      {/* Ambient temp */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 30px', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: C.muted }}>{isKo ? '주변 온도' : 'Ambient Temp'}</span>
        <input type="range" min={-20} max={80} step={1} value={ambientTemp} onChange={e => setAmbientTemp(Number(e.target.value))} style={{ width: '100%' }} />
        <span style={{ fontSize: 10, textAlign: 'right' }}>{ambientTemp}°C</span>
      </div>

      {/* Boundary conditions */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>{isKo ? '경계 조건' : 'Boundary Conditions'}</span>
          <button onClick={addBoundary} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.accent, cursor: 'pointer' }}>+ {isKo ? '추가' : 'Add'}</button>
        </div>

        {boundaries.map(bc => (
          <div key={bc.id} style={{ background: C.card, borderRadius: 6, padding: '6px 8px', marginBottom: 5 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {/* Type selector */}
              <select value={bc.type} onChange={e => updateBoundary(bc.id, { type: e.target.value as ThermalBoundary['type'] })}
                style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px' }}>
                <option value="heat_source">{isKo ? '열원' : 'Heat Source'}</option>
                <option value="fixed_temp">{isKo ? '고정 온도' : 'Fixed Temp'}</option>
                <option value="convection">{isKo ? '대류' : 'Convection'}</option>
              </select>
              {/* Face selector */}
              <select value={bc.faceIndex} onChange={e => updateBoundary(bc.id, { faceIndex: Number(e.target.value) })}
                style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px' }}>
                {faceNames.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>
              <button onClick={() => removeBoundary(bc.id)} style={{ background: 'none', border: 'none', color: C.hot, cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>×</button>
            </div>
            {/* Value input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: C.muted, width: 60 }}>
                {bc.type === 'heat_source' ? (isKo ? '출력(mW)' : 'Power(mW)') : bc.type === 'fixed_temp' ? (isKo ? '온도(°C)' : 'Temp(°C)') : 'h·A (W/K)'}
              </span>
              <input type="number" value={bc.value} min={0}
                onChange={e => updateBoundary(bc.id, { value: parseFloat(e.target.value) || 0 })}
                style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px' }} />
            </div>
            {bc.type === 'convection' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 9, color: C.muted, width: 60 }}>{isKo ? '주변(°C)' : 'Ambient(°C)'}</span>
                <input type="number" value={bc.ambientTemp ?? ambientTemp}
                  onChange={e => updateBoundary(bc.id, { ambientTemp: parseFloat(e.target.value) || 0 })}
                  style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Results */}
      {result && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>{isKo ? '결과' : 'Results'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ background: C.card, borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.muted }}>{isKo ? '최고 온도' : 'Max Temp'}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.hot }}>{result.maxTemp.toFixed(1)}°C</div>
            </div>
            <div style={{ background: C.card, borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.muted }}>{isKo ? '최저 온도' : 'Min Temp'}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{result.minTemp.toFixed(1)}°C</div>
            </div>
          </div>
          {/* Colorbar */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: C.accent }}>{result.minTemp.toFixed(0)}°C</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)' }} />
            <span style={{ fontSize: 9, color: C.hot }}>{result.maxTemp.toFixed(0)}°C</span>
          </div>
          {result.hotspots.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: C.warn }}>
              🔥 {isKo ? `핫스팟 ${result.hotspots.length}개 감지` : `${result.hotspots.length} hotspot(s) detected`}
            </div>
          )}
        </div>
      )}

      {/* Run button */}
      <button onClick={run} disabled={!geometry || isRunning}
        style={{ width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', background: isRunning ? C.card : C.hot, color: isRunning ? C.muted : '#fff', fontWeight: 700, fontSize: 12, cursor: geometry && !isRunning ? 'pointer' : 'default' }}>
        {isRunning ? `⏳ ${isKo ? '해석 중...' : 'Running...'}` : `🌡️ ${isKo ? '열해석 실행' : 'Run Thermal FEA'}`}
      </button>
    </div>
  );
}
