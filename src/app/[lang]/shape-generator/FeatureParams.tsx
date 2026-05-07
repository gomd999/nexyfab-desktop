'use client';

import React from 'react';
import type { FeatureDefinition, FeatureInstance } from './features/types';

interface FeatureParamsProps {
  instance: FeatureInstance;
  definition: FeatureDefinition;
  t: Record<string, string>;
  onParamChange: (id: string, key: string, value: number) => void;
}

export default function FeatureParams({ instance, definition, t, onParamChange }: FeatureParamsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {definition.params.map(sp => {
        const label = sp.labelKey ? t[sp.labelKey] ?? sp.key : sp.key;
        const val = instance.params[sp.key] ?? sp.default;

        // Enum-style param (axis, plane, hole type)
        if (sp.options) {
          return (
            <div key={sp.key}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9', display: 'block', marginBottom: 4 }}>{label}</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {sp.options.map(opt => {
                  const active = Math.round(val) === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onParamChange(instance.id, sp.key, opt.value)}
                      style={{
                        flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                        border: active ? '2px solid #388bfd' : '1px solid #30363d',
                        background: active ? '#388bfd22' : '#0d1117',
                        color: active ? '#58a6ff' : '#8b949e',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {t[opt.labelKey] ?? opt.labelKey}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        // Slider param
        return (
          <div key={sp.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9' }}>{label}</label>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff' }}>{val}{sp.unit ? ` ${sp.unit}` : ''}</span>
            </div>
            <input
              type="range"
              min={sp.min}
              max={sp.max}
              step={sp.step}
              value={val}
              onChange={e => onParamChange(instance.id, sp.key, parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#388bfd' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#484f58' }}>
              <span>{sp.min}{sp.unit}</span>
              <span>{sp.max}{sp.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
