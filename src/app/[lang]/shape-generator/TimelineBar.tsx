'use client';
import React, { useState } from 'react';
import type { FeatureInstance } from './features/types';
import { FEATURE_MAP } from './features';

interface TimelineBarProps {
  features: FeatureInstance[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  baseShapeName: string;
  baseShapeIcon: string;
  analysisProgress?: {
    type: 'fea' | 'dfm' | 'topology' | 'motion' | 'cam';
    label: string;
    pct: number;
    running: boolean;
  } | null;
  featureErrors?: Record<string, string>;
}

export default function TimelineBar({
  features,
  selectedId,
  onSelect,
  onToggle,
  baseShapeName,
  baseShapeIcon,
  analysisProgress,
}: TimelineBarProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  return (
    <div
      style={{
        height: 44,
        background: '#161b22',
        borderTop: '1px solid #30363d',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        overflowX: 'auto',
        overflowY: 'hidden',
        zIndex: 20,
        gap: 0,
        userSelect: 'none',
        flexShrink: 0,
        position: 'relative',
      }}
      className="nf-scroll"
    >
      {/* Analysis progress bar strip */}
      {analysisProgress?.running && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: '#21262d', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${analysisProgress.pct}%`,
            background: analysisProgress.type === 'fea' ? '#388bfd'
              : analysisProgress.type === 'dfm' ? '#3fb950'
              : analysisProgress.type === 'topology' ? '#a371f7'
              : '#f0883e',
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}
      {/* Base shape node */}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div
          title={baseShapeName}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px 4px 4px', borderRadius: 6,
            background: '#21262d', border: '1px solid #30363d',
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: '#0d1117', border: '2px solid #58a6ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, flexShrink: 0,
          }}>
            {baseShapeIcon}
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e' }}>{baseShapeName}</span>
        </div>
      </div>

      {/* Feature nodes */}
      {features.map((f) => {
        const def = FEATURE_MAP[f.type];
        const isSelected = f.id === selectedId;
        const isHovered = f.id === hoverId;
        const hasError = !!f.error;

        return (
          <React.Fragment key={f.id}>
            {/* Connecting line */}
            <div style={{
              width: 20, height: 2, flexShrink: 0,
              background: f.enabled ? (isSelected || isHovered ? '#58a6ff' : '#30363d') : '#21262d',
              transition: 'background 0.15s',
            }} />

            {/* Feature node */}
            <div
              style={{ position: 'relative', flexShrink: 0 }}
              onMouseEnter={() => setHoverId(f.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <div
                onClick={() => onSelect(isSelected ? null : f.id)}
                onDoubleClick={(e) => { e.stopPropagation(); onToggle(f.id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 8px 4px 4px', borderRadius: 6,
                  background: isSelected ? '#1a2332' : isHovered ? '#21262d' : 'transparent',
                  border: `1px solid ${isSelected ? '#388bfd' : isHovered ? '#30363d' : 'transparent'}`,
                  cursor: 'pointer', opacity: f.enabled ? 1 : 0.4,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: isSelected ? '#388bfd22' : '#21262d',
                  border: `2px solid ${isSelected ? '#58a6ff' : hasError ? '#f85149' : '#484f58'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, flexShrink: 0, transition: 'border-color 0.15s',
                }}>
                  {def?.icon || '?'}
                </div>
                {/* Label visible when selected or hovered */}
                {(isSelected || isHovered) && (
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: isSelected ? '#58a6ff' : '#8b949e',
                    whiteSpace: 'nowrap',
                  }}>
                    {def?.type || f.type}
                    {hasError && <span style={{ color: '#f85149', marginLeft: 4 }}>!</span>}
                  </span>
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {/* Analysis type badge */}
      {analysisProgress?.running && (
        <div style={{
          marginLeft: 'auto', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '2px 8px', borderRadius: 4,
          background: '#21262d', border: '1px solid #30363d',
          fontSize: 10, color: '#8b949e',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: analysisProgress.type === 'fea' ? '#388bfd' : '#3fb950',
            animation: 'pulse 1s infinite',
          }} />
          {analysisProgress.label} {Math.round(analysisProgress.pct)}%
        </div>
      )}

      {/* Right spacer */}
      <div style={{ minWidth: 12, flexShrink: 0 }} />
    </div>
  );
}
