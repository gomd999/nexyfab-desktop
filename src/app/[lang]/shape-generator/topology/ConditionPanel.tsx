'use client';

import React from 'react';
import type { Face } from './optimizer/types';
import { MATERIALS } from './optimizer/types';

interface ConditionPanelProps {
  dimX: number;
  dimY: number;
  dimZ: number;
  onDimChange: (key: 'dimX' | 'dimY' | 'dimZ', value: number) => void;
  materialKey: string;
  onMaterialChange: (key: string) => void;
  fixedFaces: Face[];
  loads: Array<{ face: Face; force: [number, number, number] }>;
  selectionMode: 'none' | 'fixed' | 'load';
  onSelectionModeChange: (mode: 'none' | 'fixed' | 'load') => void;
  onRemoveFixed: (face: Face) => void;
  onRemoveLoad: (face: Face) => void;
  activeLoadForce: [number, number, number];
  onActiveLoadForceChange: (force: [number, number, number]) => void;
  volfrac: number;
  onVolfracChange: (v: number) => void;
  resolution: 'low' | 'medium' | 'high';
  onResolutionChange: (r: 'low' | 'medium' | 'high') => void;
  penal: number;
  onPenalChange: (v: number) => void;
  rmin: number;
  onRminChange: (v: number) => void;
  maxIter: number;
  onMaxIterChange: (v: number) => void;
  isOptimizing: boolean;
  onGenerate: () => void;
  onReset: () => void;
  t: Record<string, string>;
}

const FACE_LABELS: Record<Face, string> = {
  '+x': '+X (Right)',
  '-x': '-X (Left)',
  '+y': '+Y (Top)',
  '-y': '-Y (Bottom)',
  '+z': '+Z (Front)',
  '-z': '-Z (Back)',
};

const RESOLUTION_ELEMENTS: Record<string, string> = {
  low: '16x8x16 = 2,048',
  medium: '24x12x24 = 6,912',
  high: '32x16x32 = 16,384',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  border: '1px solid #e5e7eb',
  padding: 14,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#374151',
  marginBottom: 10,
};

export default function ConditionPanel({
  dimX, dimY, dimZ, onDimChange,
  materialKey, onMaterialChange,
  fixedFaces, loads,
  selectionMode, onSelectionModeChange,
  onRemoveFixed, onRemoveLoad,
  activeLoadForce, onActiveLoadForceChange,
  volfrac, onVolfracChange,
  resolution, onResolutionChange,
  penal, onPenalChange,
  rmin, onRminChange,
  maxIter, onMaxIterChange,
  isOptimizing, onGenerate, onReset,
  t,
}: ConditionPanelProps) {
  const canGenerate = fixedFaces.length > 0 && loads.length > 0 && !isOptimizing;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Design Domain */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>{t.designDomain || 'Design Domain'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {([['dimX', dimX, t.width || 'Width (X)'], ['dimY', dimY, t.height || 'Height (Y)'], ['dimZ', dimZ, t.depth || 'Depth (Z)']] as const).map(([key, val, label]) => (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{label}</label>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{val} mm</span>
              </div>
              <input
                type="range"
                min={50}
                max={500}
                step={10}
                value={val}
                onChange={e => onDimChange(key as 'dimX' | 'dimY' | 'dimZ', parseFloat(e.target.value))}
                disabled={isOptimizing}
                style={{ width: '100%', accentColor: '#6366f1' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af' }}>
                <span>50mm</span>
                <span>500mm</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Material */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>{t.material || 'Material'}</h3>
        <select
          value={materialKey}
          onChange={e => onMaterialChange(e.target.value)}
          disabled={isOptimizing}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            fontSize: 12,
            fontWeight: 600,
            color: '#374151',
            background: '#f9fafb',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {Object.entries(MATERIALS).map(([key, mat]) => (
            <option key={key} value={key}>{mat.name}</option>
          ))}
        </select>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600 }}>E (GPa)</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{(MATERIALS[materialKey].E / 1e9).toFixed(1)}</div>
          </div>
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600 }}>{t.density || 'Density'} (kg/m3)</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{MATERIALS[materialKey].density}</div>
          </div>
        </div>
      </div>

      {/* Boundary Conditions */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>{t.boundaryConditions || 'Boundary Conditions'}</h3>

        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {([
            ['none', '\u{1F441}\uFE0F', t.view || 'View'],
            ['fixed', '\u{1F534}', t.fix || 'Fix'],
            ['load', '\u{1F535}', t.load || 'Load'],
          ] as const).map(([mode, icon, label]) => (
            <button
              key={mode}
              onClick={() => onSelectionModeChange(mode as 'none' | 'fixed' | 'load')}
              disabled={isOptimizing}
              style={{
                flex: 1,
                padding: '8px 6px',
                borderRadius: 10,
                border: selectionMode === mode ? '2px solid #6366f1' : '1px solid #e5e7eb',
                background: selectionMode === mode ? '#f5f3ff' : '#fafafa',
                cursor: isOptimizing ? 'not-allowed' : 'pointer',
                fontSize: 11,
                fontWeight: 700,
                color: selectionMode === mode ? '#6366f1' : '#6b7280',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                transition: 'all 0.15s',
              }}
            >
              <span>{icon}</span> {label}
            </button>
          ))}
        </div>

        {/* Instruction text */}
        {selectionMode !== 'none' && (
          <div style={{
            padding: '8px 10px',
            borderRadius: 8,
            background: selectionMode === 'fixed' ? '#fef2f2' : '#eff6ff',
            border: `1px solid ${selectionMode === 'fixed' ? '#fecaca' : '#bfdbfe'}`,
            fontSize: 11,
            color: selectionMode === 'fixed' ? '#991b1b' : '#1e40af',
            marginBottom: 10,
            fontWeight: 500,
          }}>
            {selectionMode === 'fixed'
              ? (t.clickToFix || 'Click a face on the 3D model to fix it')
              : (t.clickToLoad || 'Click a face on the 3D model to apply load')}
          </div>
        )}

        {/* Load force inputs (shown when in load mode) */}
        {selectionMode === 'load' && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.forceDirection || 'Force Direction (N)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <div key={axis}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: '#374151', marginBottom: 2, display: 'block' }}>F{axis}</label>
                  <input
                    type="number"
                    value={activeLoadForce[idx]}
                    onChange={e => {
                      const newForce: [number, number, number] = [...activeLoadForce];
                      newForce[idx] = parseFloat(e.target.value) || 0;
                      onActiveLoadForceChange(newForce);
                    }}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#374151',
                      background: '#f9fafb',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fixed faces list */}
        {fixedFaces.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.fixedFaces || 'Fixed Faces'}
            </div>
            {fixedFaces.map(face => (
              <div key={face} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 8px',
                borderRadius: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                  {FACE_LABELS[face]}
                </span>
                <button
                  onClick={() => onRemoveFixed(face)}
                  disabled={isOptimizing}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: isOptimizing ? 'not-allowed' : 'pointer',
                    fontSize: 14,
                    color: '#991b1b',
                    lineHeight: 1,
                    padding: '0 2px',
                  }}
                >
                  \u2715
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Load list */}
        {loads.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.appliedLoads || 'Applied Loads'}
            </div>
            {loads.map(load => (
              <div key={load.face} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 8px',
                borderRadius: 8,
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                marginBottom: 4,
              }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
                    {FACE_LABELS[load.face]}
                  </span>
                  <span style={{ fontSize: 9, color: '#6b7280' }}>
                    [{load.force[0]}, {load.force[1]}, {load.force[2]}] N
                  </span>
                </div>
                <button
                  onClick={() => onRemoveLoad(load.face)}
                  disabled={isOptimizing}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: isOptimizing ? 'not-allowed' : 'pointer',
                    fontSize: 14,
                    color: '#1e40af',
                    lineHeight: 1,
                    padding: '0 2px',
                  }}
                >
                  \u2715
                </button>
              </div>
            ))}
          </div>
        )}

        {fixedFaces.length === 0 && loads.length === 0 && selectionMode === 'none' && (
          <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: '10px 0' }}>
            {t.noBoundary || 'Select Fix or Load mode, then click faces on the 3D model.'}
          </div>
        )}
      </div>

      {/* Optimization Settings */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>{t.optSettings || 'Optimization Settings'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Volume fraction */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{t.volumeFraction || 'Volume Fraction'}</label>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{Math.round(volfrac * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={volfrac}
              onChange={e => onVolfracChange(parseFloat(e.target.value))}
              disabled={isOptimizing}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af' }}>
              <span>10%</span>
              <span>90%</span>
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>{t.resolution || 'Resolution'}</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['low', 'medium', 'high'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => onResolutionChange(r)}
                  disabled={isOptimizing}
                  style={{
                    flex: 1,
                    padding: '6px 4px',
                    borderRadius: 8,
                    border: resolution === r ? '2px solid #6366f1' : '1px solid #e5e7eb',
                    background: resolution === r ? '#f5f3ff' : '#fafafa',
                    cursor: isOptimizing ? 'not-allowed' : 'pointer',
                    fontSize: 10,
                    fontWeight: 700,
                    color: resolution === r ? '#6366f1' : '#6b7280',
                    textAlign: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  <div>{r === 'low' ? (t.low || 'Low') : r === 'medium' ? (t.medium || 'Medium') : (t.high || 'High')}</div>
                  <div style={{ fontSize: 8, fontWeight: 500, color: '#9ca3af', marginTop: 2 }}>
                    {RESOLUTION_ELEMENTS[r]}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Penalty */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{t.penalty || 'Penalty (p)'}</label>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{penal}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={0.5}
              value={penal}
              onChange={e => onPenalChange(parseFloat(e.target.value))}
              disabled={isOptimizing}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af' }}>
              <span>1</span>
              <span>5</span>
            </div>
          </div>

          {/* Filter radius */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{t.filterRadius || 'Filter Radius'}</label>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{rmin.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={3.0}
              step={0.1}
              value={rmin}
              onChange={e => onRminChange(parseFloat(e.target.value))}
              disabled={isOptimizing}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af' }}>
              <span>0.5</span>
              <span>3.0</span>
            </div>
          </div>

          {/* Max iterations */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{t.maxIterations || 'Max Iterations'}</label>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{maxIter}</span>
            </div>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={maxIter}
              onChange={e => onMaxIterChange(parseFloat(e.target.value))}
              disabled={isOptimizing}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af' }}>
              <span>10</span>
              <span>200</span>
            </div>
          </div>
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          width: '100%',
          padding: '14px 0',
          borderRadius: 12,
          border: 'none',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          background: canGenerate
            ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
            : '#d1d5db',
          color: '#fff',
          fontWeight: 800,
          fontSize: 14,
          boxShadow: canGenerate ? '0 4px 16px rgba(99,102,241,0.3)' : 'none',
          transition: 'all 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {isOptimizing && (
          <span
            style={{
              width: 16,
              height: 16,
              border: '2px solid rgba(255,255,255,0.3)',
              borderTop: '2px solid #fff',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'genSpinner 0.8s linear infinite',
            }}
          />
        )}
        {isOptimizing ? (t.optimizing || 'Optimizing...') : (t.generate || 'Generate')}
      </button>

      {/* Reset button */}
      <button
        onClick={onReset}
        disabled={isOptimizing}
        style={{
          width: '100%',
          padding: '10px 0',
          borderRadius: 12,
          border: '1px solid #e5e7eb',
          cursor: isOptimizing ? 'not-allowed' : 'pointer',
          background: '#fff',
          color: '#6b7280',
          fontWeight: 600,
          fontSize: 12,
          transition: 'all 0.2s',
        }}
      >
        {t.reset || 'Reset All'}
      </button>

    </div>
  );
}
