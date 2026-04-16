'use client';

import React, { useState, useCallback } from 'react';
import type { GDTAnnotation, DimensionAnnotation, GDTSymbol } from './GDTTypes';
import { GDT_SYMBOLS, GDT_SYMBOL_NAMES, GDT_CATEGORIES } from './GDTTypes';

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#1c2128',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  dim: '#8b949e',
  hover: '#30363d',
  danger: '#f85149',
  success: '#3fb950',
};

const panelStyle: React.CSSProperties = {
  width: 280,
  background: C.bg,
  borderLeft: `1px solid ${C.border}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: `1px solid ${C.border}`,
  background: '#1b1f27',
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 10px',
};

const sectionTitle: React.CSSProperties = {
  color: C.dim,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
  marginTop: 10,
};

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 5,
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  transition: 'all 0.15s',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  background: '#0d1117',
  color: C.text,
  fontSize: 11,
  fontFamily: 'monospace',
  outline: 'none',
};

const listItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderRadius: 4,
  background: C.card,
  marginBottom: 4,
  fontSize: 11,
  color: C.text,
  fontFamily: 'monospace',
};

/* ─── Types ───────────────────────────────────────────────────────────────── */

type PlacementMode = 'none' | 'gdt' | 'dimension';

type ToleranceType = 'bilateral' | 'unilateral' | 'limit';

interface AnnotationPanelProps {
  gdtAnnotations: GDTAnnotation[];
  dimensionAnnotations: DimensionAnnotation[];
  onAddGDT: (annotation: GDTAnnotation) => void;
  onUpdateGDT: (id: string, updates: Partial<GDTAnnotation>) => void;
  onRemoveGDT: (id: string) => void;
  onAddDimension: (annotation: DimensionAnnotation) => void;
  onUpdateDimension: (id: string, updates: Partial<DimensionAnnotation>) => void;
  onRemoveDimension: (id: string) => void;
  placementMode: PlacementMode;
  onPlacementModeChange: (mode: PlacementMode) => void;
  onClose: () => void;
  isKo: boolean;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function AnnotationPanel({
  gdtAnnotations,
  dimensionAnnotations,
  onAddGDT,
  onUpdateGDT,
  onRemoveGDT,
  onAddDimension,
  onUpdateDimension,
  onRemoveDimension,
  placementMode,
  onPlacementModeChange,
  onClose,
  isKo,
}: AnnotationPanelProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<GDTSymbol>('position');
  const [tolValue, setTolValue] = useState('0.05');
  const [datumLetter, setDatumLetter] = useState('A');
  const [showGDTDropdown, setShowGDTDropdown] = useState(false);
  const [dimType, setDimType] = useState<'linear' | 'angular' | 'radial' | 'diameter'>('linear');
  const [dimValue, setDimValue] = useState('50.00');
  const [tolType, setTolType] = useState<ToleranceType>('bilateral');
  const [tolUpper, setTolUpper] = useState('0.05');
  const [tolLower, setTolLower] = useState('-0.05');
  const [editingId, setEditingId] = useState<string | null>(null);

  const t = useCallback((ko: string, en: string) => isKo ? ko : en, [isKo]);

  // ── Add GD&T ──
  const handleAddGDT = useCallback(() => {
    const tol = parseFloat(tolValue);
    if (isNaN(tol) || tol <= 0) return;
    const annotation: GDTAnnotation = {
      id: `gdt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol: selectedSymbol,
      tolerance: tol,
      datum: datumLetter || undefined,
      position: [0, 0, 0], // Will be updated on mesh click
    };
    onAddGDT(annotation);
    onPlacementModeChange('gdt');
  }, [selectedSymbol, tolValue, datumLetter, onAddGDT, onPlacementModeChange]);

  // ── Add Dimension ──
  const handleAddDimension = useCallback(() => {
    const val = parseFloat(dimValue);
    if (isNaN(val) || val <= 0) return;
    const upper = parseFloat(tolUpper);
    const lower = parseFloat(tolLower);
    const hasTol = !isNaN(upper) && !isNaN(lower) && (upper !== 0 || lower !== 0);
    const annotation: DimensionAnnotation = {
      id: `dim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: dimType,
      value: val,
      tolerance: hasTol ? { upper, lower } : undefined,
      position: [0, 0, 0], // Will be updated on mesh click
      direction: [1, 0, 0],
    };
    onAddDimension(annotation);
    onPlacementModeChange('dimension');
  }, [dimType, dimValue, tolType, tolUpper, tolLower, onAddDimension, onPlacementModeChange]);

  // ── Set bilateral tolerance shortcut ──
  const handleBilateralChange = useCallback((val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setTolUpper(Math.abs(n).toFixed(2));
      setTolLower((-Math.abs(n)).toFixed(2));
    }
  }, []);

  const DATUM_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const categoryLabels: Record<string, { en: string; ko: string }> = {
    form:        { en: 'Form',        ko: '형상' },
    orientation: { en: 'Orientation', ko: '자세' },
    location:    { en: 'Location',    ko: '위치' },
    runout:      { en: 'Runout',      ko: '흔들림' },
    profile:     { en: 'Profile',     ko: '윤곽' },
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>
          {t('GD&T 주석', 'GD&T Annotations')}
        </span>
        <button
          onClick={onClose}
          style={{ ...btnBase, background: 'transparent', color: C.dim, fontSize: 16, padding: '0 4px', lineHeight: 1 }}
        >
          &times;
        </button>
      </div>

      <div style={scrollStyle}>
        {/* Placement mode indicator */}
        {placementMode !== 'none' && (
          <div style={{
            padding: '6px 10px', borderRadius: 5, marginBottom: 8,
            background: 'rgba(56,139,253,0.15)', border: '1px solid rgba(56,139,253,0.3)',
            color: C.accent, fontSize: 11, fontWeight: 600, textAlign: 'center',
          }}>
            {placementMode === 'gdt'
              ? t('메쉬 표면을 클릭하여 GD&T를 배치하세요', 'Click on mesh surface to place GD&T')
              : t('메쉬 표면을 클릭하여 치수를 배치하세요', 'Click on mesh surface to place dimension')}
            <button
              onClick={() => onPlacementModeChange('none')}
              style={{ ...btnBase, background: 'rgba(248,81,73,0.2)', color: C.danger, marginLeft: 8, padding: '2px 8px' }}
            >
              {t('취소', 'Cancel')}
            </button>
          </div>
        )}

        {/* ── Add GD&T Section ── */}
        <div style={sectionTitle}>{t('기하 공차 추가', 'Add GD&T')}</div>

        {/* Symbol selector */}
        <div style={{ position: 'relative', marginBottom: 6 }}>
          <button
            onClick={() => setShowGDTDropdown(v => !v)}
            style={{
              ...btnBase, width: '100%', textAlign: 'left',
              background: C.card, color: C.text, border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>{GDT_SYMBOLS[selectedSymbol]}</span>
            <span>{isKo ? GDT_SYMBOL_NAMES[selectedSymbol].ko : GDT_SYMBOL_NAMES[selectedSymbol].en}</span>
            <span style={{ marginLeft: 'auto', color: C.dim }}>&#x25BE;</span>
          </button>
          {showGDTDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: '#21262d', border: `1px solid ${C.border}`, borderRadius: 5,
              maxHeight: 280, overflowY: 'auto', padding: 4,
            }}>
              {Object.entries(GDT_CATEGORIES).map(([cat, symbols]) => (
                <div key={cat}>
                  <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, padding: '4px 8px', textTransform: 'uppercase' }}>
                    {isKo ? categoryLabels[cat].ko : categoryLabels[cat].en}
                  </div>
                  {symbols.map(sym => (
                    <button
                      key={sym}
                      onClick={() => { setSelectedSymbol(sym); setShowGDTDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '4px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                        background: sym === selectedSymbol ? 'rgba(56,139,253,0.2)' : 'transparent',
                        color: C.text, fontSize: 11, textAlign: 'left',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.hover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = sym === selectedSymbol ? 'rgba(56,139,253,0.2)' : 'transparent'; }}
                    >
                      <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{GDT_SYMBOLS[sym]}</span>
                      <span>{isKo ? GDT_SYMBOL_NAMES[sym].ko : GDT_SYMBOL_NAMES[sym].en}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tolerance input */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t('공차 (mm)', 'Tolerance (mm)')}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={tolValue}
              onChange={e => setTolValue(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ width: 70 }}>
            <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t('데이텀', 'Datum')}</label>
            <select
              value={datumLetter}
              onChange={e => setDatumLetter(e.target.value)}
              style={{ ...inputStyle, padding: '5px 4px' }}
            >
              <option value="">-</option>
              {DATUM_LETTERS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleAddGDT}
          style={{
            ...btnBase, width: '100%', marginBottom: 10,
            background: C.accent, color: '#fff',
          }}
        >
          {t('GD&T 추가', 'Add GD&T')}
        </button>

        {/* ── Add Dimension Section ── */}
        <div style={sectionTitle}>{t('치수 공차 추가', 'Add Dimension')}</div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['linear', 'angular', 'radial', 'diameter'] as const).map(dt => (
            <button
              key={dt}
              onClick={() => setDimType(dt)}
              style={{
                ...btnBase, flex: 1, fontSize: 10, padding: '4px 2px',
                background: dimType === dt ? C.accent : C.card,
                color: dimType === dt ? '#fff' : C.dim,
                border: `1px solid ${dimType === dt ? C.accent : C.border}`,
              }}
            >
              {dt === 'linear' ? (isKo ? '선형' : 'Linear') :
               dt === 'angular' ? (isKo ? '각도' : 'Angular') :
               dt === 'radial' ? (isKo ? '반경' : 'Radial') :
               (isKo ? '지름' : 'Dia.')}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 6 }}>
          <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>
            {t('치수 값', 'Value')} {dimType === 'angular' ? '(\u00B0)' : '(mm)'}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={dimValue}
            onChange={e => setDimValue(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Tolerance type */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['bilateral', 'unilateral', 'limit'] as const).map(tt => (
            <button
              key={tt}
              onClick={() => {
                setTolType(tt);
                if (tt === 'bilateral') {
                  const v = Math.abs(parseFloat(tolUpper) || 0.05);
                  setTolUpper(v.toFixed(2));
                  setTolLower((-v).toFixed(2));
                }
              }}
              style={{
                ...btnBase, flex: 1, fontSize: 10, padding: '3px 2px',
                background: tolType === tt ? 'rgba(56,139,253,0.15)' : 'transparent',
                color: tolType === tt ? C.accent : C.dim,
                border: `1px solid ${tolType === tt ? C.accent : C.border}`,
              }}
            >
              {tt === 'bilateral' ? '\u00B1' : tt === 'unilateral' ? '+/-' : isKo ? '한계' : 'Limit'}
            </button>
          ))}
        </div>

        {tolType === 'bilateral' ? (
          <div style={{ marginBottom: 6 }}>
            <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t('양방향 공차', 'Bilateral Tol.')} (\u00B1)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={Math.abs(parseFloat(tolUpper) || 0).toFixed(2)}
              onChange={e => handleBilateralChange(e.target.value)}
              style={inputStyle}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t('상한', 'Upper')}</label>
              <input
                type="number"
                step="0.01"
                value={tolUpper}
                onChange={e => setTolUpper(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t('하한', 'Lower')}</label>
              <input
                type="number"
                step="0.01"
                value={tolLower}
                onChange={e => setTolLower(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleAddDimension}
          style={{
            ...btnBase, width: '100%', marginBottom: 10,
            background: '#fbbf24', color: '#0d1117',
          }}
        >
          {t('치수 공차 추가', 'Add Dimension')}
        </button>

        {/* ── Annotation List ── */}
        {(gdtAnnotations.length > 0 || dimensionAnnotations.length > 0) && (
          <>
            <div style={sectionTitle}>{t('주석 목록', 'Annotations')}</div>

            {gdtAnnotations.map(a => (
              <div key={a.id} style={listItemStyle}>
                <span style={{ fontSize: 14 }}>{GDT_SYMBOLS[a.symbol]}</span>
                <span style={{ flex: 1 }}>{a.tolerance.toFixed(2)}{a.datum ? ` [${a.datum}]` : ''}</span>
                <button
                  onClick={() => onRemoveGDT(a.id)}
                  style={{ ...btnBase, background: 'transparent', color: C.danger, padding: '0 4px', fontSize: 13 }}
                  title={t('삭제', 'Delete')}
                >
                  &times;
                </button>
              </div>
            ))}

            {dimensionAnnotations.map(a => {
              const prefix = a.type === 'diameter' ? '\u2300' : a.type === 'radial' ? 'R' : '';
              const suffix = a.type === 'angular' ? '\u00B0' : '';
              let tolStr = '';
              if (a.tolerance) {
                if (a.tolerance.upper === -a.tolerance.lower) {
                  tolStr = ` \u00B1${a.tolerance.upper.toFixed(2)}`;
                } else {
                  tolStr = ` +${a.tolerance.upper.toFixed(2)}/${a.tolerance.lower.toFixed(2)}`;
                }
              }
              return (
                <div key={a.id} style={listItemStyle}>
                  <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: 12, width: 18, textAlign: 'center' }}>
                    {a.type === 'linear' ? '↔' : a.type === 'angular' ? '∠' : a.type === 'radial' ? 'R' : '⌀'}
                  </span>
                  <span style={{ flex: 1 }}>{prefix}{a.value.toFixed(2)}{suffix}{tolStr}</span>
                  <button
                    onClick={() => onRemoveDimension(a.id)}
                    style={{ ...btnBase, background: 'transparent', color: C.danger, padding: '0 4px', fontSize: 13 }}
                    title={t('삭제', 'Delete')}
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
