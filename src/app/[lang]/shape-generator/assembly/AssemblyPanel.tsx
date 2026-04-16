'use client';

import React, { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { AssemblyMate, MateType } from './AssemblyMates';
import { MATE_TYPE_LABELS, generateMateId } from './AssemblyMates';
import type { InterferenceResult } from './InterferenceDetection';
import { useAssemblyState } from './useAssemblyState';

// Dynamically import the solver panel to avoid pulling Three.js into the initial bundle
const AssemblyMatesPanel = dynamic(() => import('./AssemblyMatesPanel'), { ssr: false });

// ─── i18n ────────────────────────────────────────────────────────────────────

const LABELS: Record<string, Record<string, string>> = {
  ko: {
    assembly: '어셈블리',
    mates: '메이트',
    solver: '구속 계산',
    addMate: '메이트 추가',
    removeMate: '삭제',
    lockMate: '잠금',
    unlockMate: '잠금 해제',
    interference: '간섭 탐지',
    runCheck: '간섭 검사 실행',
    noInterference: '간섭 없음',
    interferenceFound: '간섭 발견',
    volume: '체적',
    explodedView: '분해도',
    assembled: '조립 상태',
    exploded: '분해 상태',
    selectFaces: '두 면을 클릭하여 메이트를 설정합니다',
    partA: '파트 A',
    partB: '파트 B',
    faceA: '면 A',
    faceB: '면 B',
    value: '값',
    type: '유형',
    close: '닫기',
    cancel: '취소',
  },
  en: {
    assembly: 'Assembly',
    mates: 'Mates',
    solver: 'Solver',
    addMate: 'Add Mate',
    removeMate: 'Delete',
    lockMate: 'Lock',
    unlockMate: 'Unlock',
    interference: 'Interference',
    runCheck: 'Run Check',
    noInterference: 'No interference',
    interferenceFound: 'Interference found',
    volume: 'Volume',
    explodedView: 'Exploded View',
    assembled: 'Assembled',
    exploded: 'Exploded',
    selectFaces: 'Click two faces to create a mate',
    partA: 'Part A',
    partB: 'Part B',
    faceA: 'Face A',
    faceB: 'Face B',
    value: 'Value',
    type: 'Type',
    close: 'Close',
    cancel: 'Cancel',
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface AssemblyPanelProps {
  mates: AssemblyMate[];
  onAddMate: (mate: AssemblyMate) => void;
  onRemoveMate: (id: string) => void;
  onUpdateMate: (id: string, updates: Partial<AssemblyMate>) => void;
  onDetectInterference: () => void;
  interferenceResults: InterferenceResult[];
  interferenceLoading: boolean;
  explodeFactor: number;
  onExplodeFactorChange: (factor: number) => void;
  partNames: string[];
  isKo: boolean;
  onClose: () => void;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  textDim: '#8b949e',
  danger: '#f85149',
  success: '#3fb950',
  warning: '#f0883e',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AssemblyPanel({
  mates,
  onAddMate,
  onRemoveMate,
  onUpdateMate,
  onDetectInterference,
  interferenceResults,
  interferenceLoading,
  explodeFactor,
  onExplodeFactorChange,
  partNames,
  isKo,
  onClose,
}: AssemblyPanelProps) {
  const t = isKo ? LABELS.ko : LABELS.en;
  const mateLabels = isKo ? MATE_TYPE_LABELS.ko : MATE_TYPE_LABELS.en;

  const [addMode, setAddMode] = useState(false);
  const [newMateType, setNewMateType] = useState<MateType>('coincident');
  const [newPartA, setNewPartA] = useState(partNames[0] ?? '');
  const [newPartB, setNewPartB] = useState(partNames[1] ?? partNames[0] ?? '');
  const [newValue, setNewValue] = useState(10);
  const [activeSection, setActiveSection] = useState<'mates' | 'interference' | 'explode' | 'solver'>('mates');

  // Internal solver state — managed independently of the legacy AssemblyMate[] list
  const {
    assembly: solverAssembly,
    setAssembly: setSolverAssembly,
  } = useAssemblyState();

  // Theme-compatible object for AssemblyMatesPanel
  const solverTheme = {
    panelBg: C.bg,
    border: C.border,
    text: C.text,
    textMuted: C.textDim,
    cardBg: C.card,
    accent: C.accent,
    accentBright: C.accent,
  };

  const handleAddMate = useCallback(() => {
    if (!newPartA || !newPartB) return;
    const mate: AssemblyMate = {
      id: generateMateId(),
      type: newMateType,
      partA: newPartA,
      partB: newPartB,
      value: newMateType === 'distance' || newMateType === 'angle' ? newValue : undefined,
      locked: false,
    };
    onAddMate(mate);
    setAddMode(false);
  }, [newMateType, newPartA, newPartB, newValue, onAddMate]);

  const MATE_TYPES: MateType[] = ['coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent'];

  const sectionBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 4px',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    background: active ? C.accent : C.card,
    color: active ? '#fff' : C.textDim,
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      width: 320,
      flexShrink: 0,
      borderLeft: `1px solid ${C.border}`,
      background: C.bg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${C.border}`,
        gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>&#x2699;&#xFE0F;</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: C.text }}>{t.assembly}</span>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: C.card,
            cursor: 'pointer',
            fontSize: 12,
            color: C.textDim,
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          &#x2715;
        </button>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 3, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setActiveSection('mates')} style={sectionBtnStyle(activeSection === 'mates')}>
          {t.mates}
        </button>
        <button onClick={() => setActiveSection('solver')} style={sectionBtnStyle(activeSection === 'solver')}>
          {t.solver}
        </button>
        <button onClick={() => setActiveSection('interference')} style={sectionBtnStyle(activeSection === 'interference')}>
          {t.interference}
        </button>
        <button onClick={() => setActiveSection('explode')} style={sectionBtnStyle(activeSection === 'explode')}>
          {t.explodedView}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>

        {/* ── Mates Section ── */}
        {activeSection === 'mates' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Existing mates */}
            {mates.length === 0 && !addMode && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ color: C.textDim, fontSize: 12, margin: 0 }}>{t.selectFaces}</p>
              </div>
            )}

            {mates.map(mate => (
              <div key={mate.id} style={{
                background: C.card,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                padding: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    background: C.accent,
                    borderRadius: 4,
                    padding: '1px 6px',
                  }}>
                    {mateLabels[mate.type]}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, color: C.textDim, fontWeight: 600 }}>
                    {mate.partA} &#x2194; {mate.partB}
                  </span>
                  <button
                    onClick={() => onUpdateMate(mate.id, { locked: !mate.locked })}
                    title={mate.locked ? t.unlockMate : t.lockMate}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: mate.locked ? C.warning : C.textDim,
                      padding: '0 3px',
                    }}
                  >
                    {mate.locked ? '\uD83D\uDD12' : '\uD83D\uDD13'}
                  </button>
                  <button
                    onClick={() => onRemoveMate(mate.id)}
                    title={t.removeMate}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.danger,
                      padding: '0 3px',
                    }}
                  >
                    &#x2715;
                  </button>
                </div>
                {(mate.type === 'distance' || mate.type === 'angle') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>{t.value}:</span>
                    <input
                      type="number"
                      value={mate.value ?? 0}
                      onChange={e => onUpdateMate(mate.id, { value: parseFloat(e.target.value) || 0 })}
                      style={{
                        width: 70,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: `1px solid ${C.border}`,
                        background: '#0d1117',
                        color: C.text,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                    <span style={{ fontSize: 10, color: C.textDim }}>{mate.type === 'distance' ? 'mm' : 'deg'}</span>
                  </div>
                )}
              </div>
            ))}

            {/* Add mate form */}
            {addMode ? (
              <div style={{
                background: '#0d1117',
                borderRadius: 8,
                border: `1px solid ${C.accent}`,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                {/* Mate type */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>{t.type}</label>
                  <select
                    value={newMateType}
                    onChange={e => setNewMateType(e.target.value as MateType)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      color: C.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {MATE_TYPES.map(mt => (
                      <option key={mt} value={mt}>{mateLabels[mt]}</option>
                    ))}
                  </select>
                </div>

                {/* Part A */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>{t.partA}</label>
                  <select
                    value={newPartA}
                    onChange={e => setNewPartA(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      color: C.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {partNames.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Part B */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>{t.partB}</label>
                  <select
                    value={newPartB}
                    onChange={e => setNewPartB(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      color: C.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {partNames.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Value (for distance/angle) */}
                {(newMateType === 'distance' || newMateType === 'angle') && (
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>
                      {t.value} ({newMateType === 'distance' ? 'mm' : 'deg'})
                    </label>
                    <input
                      type="number"
                      value={newValue}
                      onChange={e => setNewValue(parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                        background: C.card,
                        color: C.text,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleAddMate}
                    style={{
                      flex: 1,
                      padding: '7px',
                      borderRadius: 6,
                      border: 'none',
                      background: C.accent,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t.addMate}
                  </button>
                  <button
                    onClick={() => setAddMode(false)}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: 'transparent',
                      color: C.textDim,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddMode(true)}
                style={{
                  padding: '9px',
                  borderRadius: 8,
                  border: `1px dashed ${C.border}`,
                  background: 'transparent',
                  color: C.accent,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                + {t.addMate}
              </button>
            )}
          </div>
        )}

        {/* ── Solver Section ── */}
        {activeSection === 'solver' && (
          <AssemblyMatesPanel
            theme={solverTheme}
            lang={isKo ? 'ko' : 'en'}
            assemblyState={solverAssembly}
            onAssemblyUpdate={setSolverAssembly}
          />
        )}

        {/* ── Interference Section ── */}
        {activeSection === 'interference' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={onDetectInterference}
              disabled={interferenceLoading}
              style={{
                padding: '10px',
                borderRadius: 8,
                border: `1px solid ${C.accent}`,
                background: interferenceLoading ? C.card : '#0d1117',
                color: C.accent,
                fontSize: 12,
                fontWeight: 700,
                cursor: interferenceLoading ? 'default' : 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {interferenceLoading ? (
                <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(56,139,253,0.3)', borderTopColor: C.accent, borderRadius: '50%', animation: 'nf-spin 0.8s linear infinite' }} />
              ) : null}
              {t.runCheck}
            </button>

            {interferenceResults.length === 0 && !interferenceLoading && (
              <div style={{
                textAlign: 'center',
                padding: 16,
                background: C.card,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: 20, display: 'block', marginBottom: 6 }}>&#x2705;</span>
                <p style={{ color: C.success, fontSize: 12, fontWeight: 700, margin: 0 }}>
                  {t.noInterference}
                </p>
              </div>
            )}

            {interferenceResults.map((res, i) => (
              <div key={i} style={{
                background: '#1a0808',
                borderRadius: 8,
                border: `1px solid ${C.danger}`,
                padding: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>&#x26A0;&#xFE0F;</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.danger }}>
                    {t.interferenceFound}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600, marginBottom: 2 }}>
                  {res.partA} &#x2194; {res.partB}
                </div>
                <div style={{ fontSize: 10, color: C.textDim }}>
                  {t.volume}: {res.volume.toFixed(3)} cm&#xB3;
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Exploded View Section ── */}
        {activeSection === 'explode' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              background: C.card,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              padding: 12,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                  {t.explodedView}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: explodeFactor > 0 ? C.warning : C.success,
                  background: explodeFactor > 0 ? '#2a1a08' : '#0a1a08',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}>
                  {explodeFactor > 0 ? t.exploded : t.assembled}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(explodeFactor * 100)}
                onChange={e => onExplodeFactorChange(parseInt(e.target.value, 10) / 100)}
                style={{
                  width: '100%',
                  accentColor: C.accent,
                  height: 6,
                  cursor: 'pointer',
                }}
              />

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 6,
                fontSize: 10,
                color: C.textDim,
                fontWeight: 600,
              }}>
                <span>0%</span>
                <span style={{
                  fontFamily: 'monospace',
                  color: C.text,
                  fontSize: 12,
                  fontWeight: 800,
                }}>
                  {Math.round(explodeFactor * 100)}%
                </span>
                <span>100%</span>
              </div>
            </div>

            {/* Quick presets */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 0.25, 0.5, 0.75, 1].map(v => (
                <button
                  key={v}
                  onClick={() => onExplodeFactorChange(v)}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: 4,
                    border: 'none',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: Math.abs(explodeFactor - v) < 0.01 ? C.accent : C.card,
                    color: Math.abs(explodeFactor - v) < 0.01 ? '#fff' : C.textDim,
                    transition: 'all 0.12s',
                  }}
                >
                  {Math.round(v * 100)}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
