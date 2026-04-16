'use client';

import React, { useState, useCallback } from 'react';
import type { FEAResult, FEABoundaryCondition, FEAMaterial } from './simpleFEA';
import type { FEADisplayMode } from './FEAOverlay';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  orange: '#f0883e',
};

/* ─── Material presets for FEA ───────────────────────────────────────────── */

const FEA_MATERIAL_PRESETS: { id: string; label: { ko: string; en: string }; props: FEAMaterial }[] = [
  { id: 'aluminum', label: { ko: '알루미늄', en: 'Aluminum' }, props: { youngsModulus: 69, poissonRatio: 0.33, yieldStrength: 276, density: 2.7 } },
  { id: 'steel', label: { ko: '스틸', en: 'Steel' }, props: { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 250, density: 7.85 } },
  { id: 'titanium', label: { ko: '티타늄', en: 'Titanium' }, props: { youngsModulus: 116, poissonRatio: 0.34, yieldStrength: 880, density: 4.43 } },
  { id: 'copper', label: { ko: '구리', en: 'Copper' }, props: { youngsModulus: 117, poissonRatio: 0.34, yieldStrength: 210, density: 8.96 } },
  { id: 'abs', label: { ko: 'ABS', en: 'ABS' }, props: { youngsModulus: 2.3, poissonRatio: 0.35, yieldStrength: 40, density: 1.05 } },
  { id: 'nylon', label: { ko: '나일론', en: 'Nylon' }, props: { youngsModulus: 2.7, poissonRatio: 0.39, yieldStrength: 70, density: 1.14 } },
];

/* ─── Component ──────────────────────────────────────────────────────────── */

interface FEAPanelProps {
  result: FEAResult | null;
  conditions: FEABoundaryCondition[];
  onConditionsChange: (conds: FEABoundaryCondition[]) => void;
  onRunAnalysis: (material: FEAMaterial) => void;
  onClose: () => void;
  displayMode: FEADisplayMode;
  onDisplayModeChange: (mode: FEADisplayMode) => void;
  deformationScale: number;
  onDeformationScaleChange: (scale: number) => void;
  materialId?: string;
  isKo: boolean;
  totalFaces: number;
}

export default function FEAPanel({
  result,
  conditions,
  onConditionsChange,
  onRunAnalysis,
  onClose,
  displayMode,
  onDisplayModeChange,
  deformationScale,
  onDeformationScaleChange,
  materialId,
  isKo,
  totalFaces,
}: FEAPanelProps) {
  // Find matching preset or default to steel
  const defaultPreset = FEA_MATERIAL_PRESETS.find(p => p.id === materialId) || FEA_MATERIAL_PRESETS[1];
  const [selectedPreset, setSelectedPreset] = useState(defaultPreset.id);
  const [matProps, setMatProps] = useState<FEAMaterial>({ ...defaultPreset.props });
  const [isRunning, setIsRunning] = useState(false);

  const handlePresetChange = useCallback((presetId: string) => {
    const preset = FEA_MATERIAL_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setSelectedPreset(presetId);
      setMatProps({ ...preset.props });
    }
  }, []);

  const handleAddCondition = useCallback((type: 'fixed' | 'force' | 'pressure') => {
    // Default: apply to first 10% of faces as a starting point
    const faceCount = Math.max(1, Math.floor(totalFaces * 0.1));
    const startIdx = type === 'fixed' ? 0 : Math.floor(totalFaces * 0.9);
    const indices: number[] = [];
    for (let i = startIdx; i < Math.min(startIdx + faceCount, totalFaces); i++) {
      indices.push(i);
    }
    const newCond: FEABoundaryCondition = {
      type,
      faceIndices: indices,
      value: type === 'force' ? [0, -1000, 0] : type === 'pressure' ? [0, -100, 0] : undefined,
    };
    onConditionsChange([...conditions, newCond]);
  }, [conditions, onConditionsChange, totalFaces]);

  const handleRemoveCondition = useCallback((idx: number) => {
    const next = conditions.filter((_, i) => i !== idx);
    onConditionsChange(next);
  }, [conditions, onConditionsChange]);

  const handleUpdateConditionValue = useCallback((idx: number, axis: 0 | 1 | 2, val: number) => {
    const next = conditions.map((c, i) => {
      if (i !== idx) return c;
      const newVal: [number, number, number] = [...(c.value || [0, 0, 0])] as [number, number, number];
      newVal[axis] = val;
      return { ...c, value: newVal };
    });
    onConditionsChange(next);
  }, [conditions, onConditionsChange]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    // Small delay for UI feedback
    await new Promise(r => setTimeout(r, 50));
    onRunAnalysis(matProps);
    setIsRunning(false);
  }, [matProps, onRunAnalysis]);

  const safetyColor = (sf: number) => sf >= 2 ? C.green : sf >= 1 ? C.yellow : C.red;
  const safetyLabel = (sf: number) => {
    if (sf >= 2) return isKo ? '안전' : 'Safe';
    if (sf >= 1) return isKo ? '주의' : 'Caution';
    return isKo ? '위험' : 'Danger';
  };

  return (
    <div style={{
      width: 310, background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontSize: 12, color: C.text, userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`, background: C.card,
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          {isKo ? '응력 해석 (FEA)' : 'Stress Analysis (FEA)'}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>&#10005;</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {/* ── Material properties ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {isKo ? '재료 속성' : 'Material Properties'}
          </div>

          {/* Preset selector */}
          <div style={{ marginBottom: 10 }}>
            <select
              value={selectedPreset}
              onChange={e => handlePresetChange(e.target.value)}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 4,
                border: `1px solid ${C.border}`, background: '#0d1117',
                color: C.text, fontSize: 11, cursor: 'pointer',
              }}
            >
              {FEA_MATERIAL_PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {isKo ? p.label.ko : p.label.en}
                </option>
              ))}
            </select>
          </div>

          {/* Material property inputs */}
          {([
            { key: 'youngsModulus' as const, label: isKo ? '탄성 계수' : "Young's Modulus", unit: 'GPa' },
            { key: 'poissonRatio' as const, label: isKo ? '포아송 비' : 'Poisson Ratio', unit: '' },
            { key: 'yieldStrength' as const, label: isKo ? '항복 강도' : 'Yield Strength', unit: 'MPa' },
            { key: 'density' as const, label: isKo ? '밀도' : 'Density', unit: 'g/cm\u00B3' },
          ]).map(prop => (
            <div key={prop.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: C.textDim, width: 80, flexShrink: 0 }}>{prop.label}</span>
              <input
                type="number"
                step={prop.key === 'poissonRatio' ? 0.01 : 1}
                value={matProps[prop.key]}
                onChange={e => setMatProps(prev => ({ ...prev, [prop.key]: Number(e.target.value) }))}
                style={{
                  flex: 1, padding: '3px 6px', borderRadius: 4,
                  border: `1px solid ${C.border}`, background: '#0d1117',
                  color: C.text, fontSize: 11, fontFamily: 'monospace',
                }}
              />
              {prop.unit && (
                <span style={{ fontSize: 9, color: '#484f58', width: 32, flexShrink: 0 }}>{prop.unit}</span>
              )}
            </div>
          ))}
        </div>

        {/* ── Boundary conditions ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {isKo ? '경계 조건' : 'Boundary Conditions'}
          </div>

          {/* Add condition buttons */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {([
              { type: 'fixed' as const, icon: '📌', label: isKo ? '고정' : 'Fixed' },
              { type: 'force' as const, icon: '➡', label: isKo ? '하중' : 'Force' },
              { type: 'pressure' as const, icon: '⬇', label: isKo ? '압력' : 'Pressure' },
            ]).map(btn => (
              <button
                key={btn.type}
                onClick={() => handleAddCondition(btn.type)}
                style={{
                  flex: 1, padding: '5px 4px', borderRadius: 4,
                  border: `1px solid ${C.border}`, background: C.card,
                  color: C.text, fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.12s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
              >
                <span style={{ fontSize: 12 }}>{btn.icon}</span> +{btn.label}
              </button>
            ))}
          </div>

          {/* Condition list */}
          {conditions.length === 0 && (
            <div style={{ fontSize: 10, color: '#484f58', textAlign: 'center', padding: 8 }}>
              {isKo ? '경계 조건을 추가하세요' : 'Add boundary conditions above'}
            </div>
          )}
          {conditions.map((cond, idx) => (
            <div key={idx} style={{
              padding: '8px 10px', background: C.card, borderRadius: 6,
              border: `1px solid ${C.border}`, marginBottom: 6,
              borderLeft: `3px solid ${cond.type === 'fixed' ? C.green : cond.type === 'force' ? C.orange : C.accent}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  color: cond.type === 'fixed' ? C.green : cond.type === 'force' ? C.orange : C.accent }}>
                  {cond.type === 'fixed' ? (isKo ? '고정' : 'FIXED') :
                   cond.type === 'force' ? (isKo ? '하중' : 'FORCE') :
                   (isKo ? '압력' : 'PRESSURE')}
                </span>
                <button onClick={() => handleRemoveCondition(idx)} style={{
                  border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 12, padding: 0,
                }}>&#10005;</button>
              </div>
              <div style={{ fontSize: 9, color: '#484f58', marginBottom: 4 }}>
                {cond.faceIndices.length} {isKo ? '면' : 'faces'}
              </div>
              {cond.type !== 'fixed' && cond.value && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['X', 'Y', 'Z']).map((axis, ai) => (
                    <div key={axis} style={{ flex: 1 }}>
                      <label style={{ fontSize: 8, color: '#484f58' }}>{axis}</label>
                      <input
                        type="number"
                        value={cond.value![ai]}
                        onChange={e => handleUpdateConditionValue(idx, ai as 0 | 1 | 2, Number(e.target.value))}
                        style={{
                          width: '100%', padding: '2px 4px', borderRadius: 3,
                          border: `1px solid ${C.border}`, background: '#0d1117',
                          color: C.text, fontSize: 10, fontFamily: 'monospace',
                        }}
                      />
                    </div>
                  ))}
                  <div style={{ fontSize: 8, color: '#484f58', alignSelf: 'flex-end', paddingBottom: 3 }}>
                    {cond.type === 'force' ? 'N' : 'Pa'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Run button ── */}
        <button
          onClick={handleRun}
          disabled={conditions.length === 0 || isRunning}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 6,
            border: 'none', background: conditions.length === 0 ? '#21262d' : C.accent,
            color: conditions.length === 0 ? '#484f58' : '#fff',
            fontSize: 12, fontWeight: 700, cursor: conditions.length === 0 ? 'default' : 'pointer',
            transition: 'opacity 0.12s', marginBottom: 16,
            opacity: isRunning ? 0.6 : 1,
          }}
          onMouseEnter={e => { if (conditions.length > 0) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = isRunning ? '0.6' : '1'; }}
        >
          {isRunning ? (isKo ? '해석 중...' : 'Analyzing...') : (isKo ? '해석 실행' : 'Run Analysis')}
        </button>

        {/* ── Results ── */}
        {result && (
          <>
            {/* Solver quality indicator */}
            <div style={{
              marginBottom: 12, padding: '7px 10px', borderRadius: 6,
              background: C.card, border: `1px solid ${C.border}`,
              fontSize: 10, color: C.textDim, fontFamily: 'monospace',
              lineHeight: 1.6,
            }}>
              {result.method === 'linear-fem-tet' ? (
                <>
                  <span style={{ color: C.green, fontWeight: 700 }}>
                    {isKo ? '방법: 선형 FEM (Tet4)' : 'Method: Linear FEM (Tet4)'}
                  </span>
                  {' | '}
                  {isKo ? '요소' : 'Elements'}: {result.elementCount.toLocaleString()}
                  {' | '}
                  DOF: {result.dofCount.toLocaleString()}
                  {' | '}
                  {isKo ? '수렴' : 'Converged'}: {result.converged ? (
                    <span style={{ color: C.green }}>&#10003;</span>
                  ) : (
                    <span style={{ color: C.yellow }}>&#9888;</span>
                  )}
                </>
              ) : (
                <>
                  <span style={{ color: C.yellow, fontWeight: 700 }}>
                    {isKo ? '방법: 보 이론 (근사)' : 'Method: Beam Theory (Approx)'}
                  </span>
                  {' | '}
                  <span style={{ color: C.yellow }}>
                    {isKo ? '정확도: ±30-50%' : 'Accuracy: \u00B130\u201350%'}
                  </span>
                </>
              )}
            </div>

            {/* Summary stats */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {isKo ? '해석 결과' : 'Results'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  {
                    label: isKo ? '최대 응력' : 'Max Stress',
                    value: `${result.maxStress.toFixed(2)} MPa`,
                    icon: '🔴',
                  },
                  {
                    label: isKo ? '최소 응력' : 'Min Stress',
                    value: `${result.minStress.toFixed(2)} MPa`,
                    icon: '🔵',
                  },
                  {
                    label: isKo ? '최대 변위' : 'Max Displacement',
                    value: `${result.maxDisplacement.toFixed(4)} mm`,
                    icon: '📏',
                  },
                  {
                    label: isKo ? '안전율' : 'Safety Factor',
                    value: result.safetyFactor.toFixed(2),
                    icon: '🛡',
                    color: safetyColor(result.safetyFactor),
                  },
                ].map((stat, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: C.card, borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                      {stat.icon} {stat.label}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 800, fontFamily: 'monospace',
                      color: stat.color || C.text,
                    }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Safety factor badge */}
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: C.card, border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13,
                background: safetyColor(result.safetyFactor) + '22',
                color: safetyColor(result.safetyFactor),
                border: `2px solid ${safetyColor(result.safetyFactor)}`,
              }}>
                {result.safetyFactor.toFixed(1)}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: safetyColor(result.safetyFactor) }}>
                  {safetyLabel(result.safetyFactor)}
                </div>
                <div style={{ fontSize: 10, color: C.textDim }}>
                  {isKo ? '안전율' : 'Safety Factor'} = {isKo ? '항복 강도' : 'Yield'} / {isKo ? '최대 응력' : 'Max Stress'}
                </div>
              </div>
            </div>

            {/* Display mode toggle */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {isKo ? '표시 모드' : 'Display Mode'}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { key: 'stress' as FEADisplayMode, label: isKo ? '응력' : 'Stress' },
                  { key: 'displacement' as FEADisplayMode, label: isKo ? '변위' : 'Displacement' },
                  { key: 'deformed' as FEADisplayMode, label: isKo ? '변형' : 'Deformed' },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => onDisplayModeChange(opt.key)}
                    style={{
                      flex: 1, padding: '5px 6px', borderRadius: 4,
                      border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: displayMode === opt.key ? C.accent : C.card,
                      color: displayMode === opt.key ? '#fff' : C.textDim,
                      transition: 'all 0.12s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Deformation scale slider */}
            {displayMode === 'deformed' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>
                    {isKo ? '변형 배율' : 'Deformation Scale'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>
                    {deformationScale.toFixed(0)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={1} max={500} step={1}
                  value={deformationScale}
                  onChange={e => onDeformationScaleChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: C.accent }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#484f58' }}>
                  <span>1x</span><span>250x</span><span>500x</span>
                </div>
              </div>
            )}

            {/* Color legend */}
            <div style={{
              padding: '10px', background: '#0d1117', borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                {displayMode === 'displacement'
                  ? (isKo ? '변위 분포 (mm)' : 'Displacement Map (mm)')
                  : (isKo ? '응력 분포 — Von Mises (MPa)' : 'Stress Map — Von Mises (MPa)')}
              </div>
              {/* Gradient bar */}
              <div style={{
                height: 14, borderRadius: 4, marginBottom: 6, position: 'relative',
                background: 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)',
              }}>
                {/* tick marks */}
                {[0, 25, 50, 75, 100].map(pct => (
                  <div key={pct} style={{
                    position: 'absolute', left: `${pct}%`, top: 0, width: 1, height: '100%',
                    background: 'rgba(0,0,0,0.25)',
                  }} />
                ))}
              </div>
              {/* Min / quartile / max labels */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#8b949e', fontFamily: 'monospace' }}>
                {displayMode === 'stress' ? (
                  <>
                    <span>{result.minStress.toFixed(1)}</span>
                    <span>{((result.minStress + result.maxStress) / 2).toFixed(1)}</span>
                    <span style={{ color: '#f85149', fontWeight: 700 }}>{result.maxStress.toFixed(1)}</span>
                  </>
                ) : (
                  <>
                    <span>0</span>
                    <span>{(result.maxDisplacement / 2).toFixed(4)}</span>
                    <span style={{ color: '#f85149', fontWeight: 700 }}>{result.maxDisplacement.toFixed(4)}</span>
                  </>
                )}
              </div>
              {/* Safety factor reminder */}
              <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 5, background: `${safetyColor(result.safetyFactor)}18`, border: `1px solid ${safetyColor(result.safetyFactor)}44`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: safetyColor(result.safetyFactor) }}>
                  SF {result.safetyFactor.toFixed(2)}
                </span>
                <span style={{ fontSize: 9, color: C.textDim }}>
                  {isKo
                    ? `항복강도 ${matProps.yieldStrength} MPa / 최대응력 ${result.maxStress.toFixed(2)} MPa`
                    : `Yield ${matProps.yieldStrength} MPa / Max ${result.maxStress.toFixed(2)} MPa`}
                </span>
              </div>
            </div>
          </>
        )}

        {!result && conditions.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px 10px', color: '#484f58' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🔬</div>
            <div style={{ fontSize: 11 }}>
              {isKo
                ? '"해석 실행"을 클릭하여 시작하세요'
                : 'Click "Run Analysis" to begin'}
            </div>
          </div>
        )}

        {!result && conditions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 10px', color: '#484f58' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📌</div>
            <div style={{ fontSize: 11 }}>
              {isKo
                ? '경계 조건(고정면, 하중)을 추가한 후 해석하세요'
                : 'Add boundary conditions (fixed, forces) then analyze'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
