'use client';

// Standard parts library grid — drag-drop ISO/DIN catalog into the assembly.
// Sources STANDARD_PARTS from library/standardPartsIso.ts.
// On click, dispatches `nexyfab:insert-standard-part` event which Inner
// listens for to place the resolved SCAD output in the scene.

import { useMemo, useState } from 'react';
import { STANDARD_PARTS, type StandardPart } from '../../library/standardPartsIso';
import { I } from '../Icons';

export interface StandardPartsGridProps {
  isKo: boolean;
}

const CATEGORY_LABELS: Record<string, { ko: string; en: string }> = {
  all: { ko: '전체', en: 'All' },
  fastener: { ko: '체결', en: 'Fasteners' },
  bearing: { ko: '베어링', en: 'Bearings' },
  pulley: { ko: '풀리', en: 'Pulleys' },
  rail: { ko: '리니어 레일', en: 'Linear rails' },
  spring: { ko: '스프링', en: 'Springs' },
  gear: { ko: '기어', en: 'Gears' },
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  fastener: <I.cube size={11} />,
  bearing: <I.circle size={11} />,
  pulley: <I.circle size={11} />,
  rail: <I.line size={11} />,
  spring: <I.sweep size={11} />,
  gear: <I.pattern size={11} />,
};

export function StandardPartsGrid({ isKo }: StandardPartsGridProps) {
  const [filter, setFilter] = useState<'all' | StandardPart['category']>('all');
  const [selectedPart, setSelectedPart] = useState<StandardPart | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number | string>>({});

  const filtered = useMemo(
    () => filter === 'all' ? STANDARD_PARTS : STANDARD_PARTS.filter(p => p.category === filter),
    [filter],
  );

  const categories = ['all', 'fastener', 'bearing', 'pulley', 'rail'] as const;

  const onPartClick = (part: StandardPart) => {
    setSelectedPart(part);
    const defaults: Record<string, number | string> = {};
    for (const p of part.params) defaults[p.name] = p.default;
    setParamValues(defaults);
  };

  const onInsert = () => {
    if (!selectedPart) return;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:insert-standard-part', {
        detail: {
          id: selectedPart.id,
          title: selectedPart.title,
          standard: selectedPart.standard,
          params: { ...paramValues },
          scad: selectedPart.scad(paramValues),
        },
      }));
    }
    setSelectedPart(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Category filter row */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--nx-border)', flexWrap: 'wrap' }}>
        {categories.map(c => {
          const isActive = filter === c;
          return (
            <button
              key={c}
              onClick={() => setFilter(c as typeof filter)}
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 600,
                borderRadius: 3, cursor: 'pointer',
                background: isActive ? 'var(--nx-accent-soft)' : 'transparent',
                color: isActive ? 'var(--nx-accent-2)' : 'var(--nx-text-2)',
                border: `1px solid ${isActive ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              }}
            >
              {isKo ? CATEGORY_LABELS[c].ko : CATEGORY_LABELS[c].en}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {filtered.map(p => (
          <button
            key={p.id}
            onClick={() => onPartClick(p)}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('application/x-nexyfab-part', JSON.stringify({ id: p.id }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 4, padding: '8px 8px',
              border: `1px solid ${selectedPart?.id === p.id ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              borderRadius: 4,
              background: selectedPart?.id === p.id ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
              cursor: 'pointer',
              textAlign: 'left',
              minHeight: 64,
            }}
          >
            <span style={{ color: 'var(--nx-text-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {CATEGORY_ICON[p.category]}
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{p.category}</span>
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text)', lineHeight: 1.2 }}>{p.title}</span>
            <span style={{ fontSize: 9, color: 'var(--nx-text-3)', fontFamily: 'ui-monospace, monospace' }}>{p.standard}</span>
          </button>
        ))}
      </div>

      {/* Selected part configurator */}
      {selectedPart && (
        <div style={{
          borderTop: '1px solid var(--nx-border)',
          padding: 10, background: 'var(--nx-panel)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-text)' }}>
            {selectedPart.title}
          </div>
          {selectedPart.params.map(p => (
            <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{p.label}</span>
              {p.kind === 'enum' && p.options ? (
                <select
                  value={String(paramValues[p.name] ?? p.default)}
                  onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                  style={{
                    height: 22, padding: '0 6px', borderRadius: 3,
                    border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
                    color: 'var(--nx-text)', fontSize: 11,
                  }}
                >
                  {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type="number"
                  value={Number(paramValues[p.name] ?? p.default)}
                  onChange={e => setParamValues(prev => ({ ...prev, [p.name]: parseFloat(e.target.value) || 0 }))}
                  style={{
                    height: 22, padding: '0 6px', borderRadius: 3,
                    border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
                    color: 'var(--nx-text)', fontSize: 11, fontFamily: 'ui-monospace, monospace',
                  }}
                />
              )}
            </div>
          ))}
          <button
            onClick={onInsert}
            style={{
              marginTop: 4, height: 26, padding: '0 12px',
              border: 0, borderRadius: 4,
              background: 'var(--nx-accent)', color: '#fff',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {isKo ? '어셈블리에 추가' : 'Insert into assembly'}
          </button>
        </div>
      )}
    </div>
  );
}
