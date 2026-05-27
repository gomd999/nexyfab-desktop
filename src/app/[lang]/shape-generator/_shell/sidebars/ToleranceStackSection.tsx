'use client';

// Tolerance Stack-up — interactive chain builder + worst-case / RSS /
// Monte Carlo results. Lives inside the Drawing right pane.

import { useMemo, useState } from 'react';
import { PropSection } from './';
import { analyzeStackUp, monteCarloStackUp, type ChainLink, type MonteCarloResult, type StackUpResult } from '../../annotations/toleranceStackUp';

export interface ToleranceStackSectionProps {
  isKo: boolean;
}

const DEFAULT_CHAIN: ChainLink[] = [
  { label: 'Plate width', nominal: 80, plus: 0.1, minus: 0.1 },
  { label: 'Hole offset X', nominal: 15, plus: 0.05, minus: 0.05 },
  { label: 'Hole Ø', nominal: 6.5, plus: 0.1, minus: 0 },
];

export function ToleranceStackSection({ isKo }: ToleranceStackSectionProps) {
  const [chain, setChain] = useState<ChainLink[]>(DEFAULT_CHAIN);
  const [mode, setMode] = useState<'worst' | 'rss' | 'mc'>('worst');

  const result: StackUpResult | MonteCarloResult = useMemo(
    () => mode === 'mc'
      ? monteCarloStackUp(chain, { iterations: 5000 })
      : analyzeStackUp(chain),
    [chain, mode],
  );
  const mc: MonteCarloResult['monteCarlo'] | null = mode === 'mc' && 'monteCarlo' in result
    ? (result as MonteCarloResult).monteCarlo
    : null;

  const updateLink = (idx: number, patch: Partial<ChainLink>) => {
    setChain(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  return (
    <PropSection title={isKo ? '공차 누적' : 'Tolerance Stack-up'} defaultExpanded={false}>
      {/* Mode pills */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['worst', 'rss', 'mc'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1, height: 22, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${mode === m ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              background: mode === m ? 'var(--nx-accent-soft)' : 'transparent',
              color: mode === m ? 'var(--nx-accent-2)' : 'var(--nx-text-2)',
              borderRadius: 3,
            }}
          >
            {m === 'worst' ? (isKo ? '최악' : 'Worst') : m === 'rss' ? 'RSS' : (isKo ? '몬테카를로' : 'Monte Carlo')}
          </button>
        ))}
      </div>

      {/* Chain links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
        {chain.map((link, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 50px 40px 40px 16px', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              value={link.label}
              onChange={e => updateLink(i, { label: e.target.value })}
              style={inputStyle}
            />
            <input
              type="number"
              value={link.nominal}
              step={0.1}
              onChange={e => updateLink(i, { nominal: parseFloat(e.target.value) || 0 })}
              style={{ ...inputStyle, textAlign: 'right' }}
            />
            <input
              type="number"
              value={link.plus}
              step={0.01}
              onChange={e => updateLink(i, { plus: parseFloat(e.target.value) || 0 })}
              title="+ tolerance"
              style={{ ...inputStyle, textAlign: 'right', color: 'var(--nx-accent-2)' }}
            />
            <input
              type="number"
              value={link.minus}
              step={0.01}
              onChange={e => updateLink(i, { minus: parseFloat(e.target.value) || 0 })}
              title="− tolerance"
              style={{ ...inputStyle, textAlign: 'right', color: 'var(--nx-warn, #ffa800)' }}
            />
            <button
              onClick={() => setChain(prev => prev.filter((_, j) => j !== i))}
              style={{
                width: 16, height: 16, border: 0, background: 'transparent',
                color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
              }}
            >×</button>
          </div>
        ))}
        <button
          onClick={() => setChain(prev => [...prev, { label: 'New link', nominal: 0, plus: 0.05, minus: 0.05 }])}
          style={{
            height: 22, padding: '0 8px', border: '1px dashed var(--nx-border)', borderRadius: 3,
            background: 'transparent', color: 'var(--nx-text-3)', fontSize: 10, cursor: 'pointer',
          }}
        >
          + {isKo ? '체인 링크 추가' : 'Add link'}
        </button>
      </div>

      {/* Result */}
      <div style={{
        padding: 8, background: 'var(--nx-panel-2)', borderRadius: 4,
        fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--nx-text)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--nx-text-2)' }}>{isKo ? '명목' : 'Nominal'}</span>
          <span>{result.nominal.toFixed(3)} mm</span>
        </div>
        {mode === 'worst' && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--nx-text-2)' }}>{isKo ? '최악' : 'Worst-case'}</span>
            <span style={{ color: 'var(--nx-warn, #ffa800)' }}>
              [{result.worstCase.min.toFixed(3)}, {result.worstCase.max.toFixed(3)}] mm
            </span>
          </div>
        )}
        {mode === 'rss' && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--nx-text-2)' }}>RSS ±</span>
            <span style={{ color: 'var(--nx-accent-2)' }}>±{result.rssTolerance.toFixed(3)} mm</span>
          </div>
        )}
        {mode === 'mc' && mc && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--nx-text-2)' }}>{isKo ? '평균' : 'Mean'}</span>
              <span>{mc.mean.toFixed(3)} mm</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--nx-text-2)' }}>{isKo ? '표준편차' : 'Stddev'}</span>
              <span>±{mc.stddev.toFixed(3)} mm</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--nx-text-2)' }}>99.7%</span>
              <span style={{ color: 'var(--nx-accent-2)' }}>
                [{mc.min.toFixed(3)}, {mc.max.toFixed(3)}] mm
              </span>
            </div>
          </>
        )}
      </div>
    </PropSection>
  );
}

const inputStyle: React.CSSProperties = {
  height: 20, padding: '0 4px', borderRadius: 2,
  border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
  color: 'var(--nx-text)', fontSize: 10, fontFamily: 'ui-monospace, monospace',
};
