'use client';
import React, { useState, useCallback, useEffect } from 'react';
import type { FeatureInstance } from './features/types';
import { getFeatureDefinition } from './features';
import { useTheme } from './ThemeContext';

interface TimelineBarProps {
  features: FeatureInstance[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  /** Drag a feature chip onto another to swap order (same parent as design tree). */
  onMoveFeature?: (fromId: string, toId: string) => void;
  onEditFeature?: (id: string) => void;
  onDeleteFeature?: (id: string) => void;
  onSuppressFeature?: (id: string) => void;
  baseShapeName: string;
  baseShapeIcon: string;
  analysisProgress?: {
    type: 'fea' | 'dfm' | 'topology' | 'motion' | 'cam' | 'interference';
    label: string;
    pct: number;
    running: boolean;
    onCancel?: () => void;
  } | null;
  featureErrors?: Record<string, string>;
}

export default function TimelineBar({
  features,
  selectedId,
  onSelect,
  onToggle,
  onMoveFeature,
  onEditFeature,
  onDeleteFeature,
  onSuppressFeature,
  baseShapeName,
  baseShapeIcon,
  analysisProgress,
}: TimelineBarProps) {
  const { theme } = useTheme();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    if (!onMoveFeature) return;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, [onMoveFeature]);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    if (!onMoveFeature || !dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, [onMoveFeature, dragId]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const from = dragId;
    setDragOverId(null);
    setDragId(null);
    if (!onMoveFeature || !from || from === targetId) return;
    onMoveFeature(from, targetId);
  }, [dragId, onMoveFeature]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  return (
    <div
      style={{
        height: 44,
        background: theme.panelBg,
        borderTop: `1px solid ${theme.border}`,
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
          background: theme.hoverBg, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${analysisProgress.pct}%`,
            background: analysisProgress.type === 'fea' ? '#388bfd'
              : analysisProgress.type === 'dfm' ? '#3fb950'
              : analysisProgress.type === 'topology' ? '#a371f7'
              : analysisProgress.type === 'interference' ? '#58a6ff'
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
            background: theme.hoverBg, border: `1px solid ${theme.border}`,
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: theme.inputBg, border: `2px solid ${theme.accentBright}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, flexShrink: 0,
          }}>
            {baseShapeIcon}
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted }}>{baseShapeName}</span>
        </div>
      </div>

      {/* Feature nodes */}
      {features.map((f) => {
        const def = getFeatureDefinition(f.type);
        const isSelected = f.id === selectedId;
        const isHovered = f.id === hoverId;
        const hasError = !!f.error;

        return (
          <React.Fragment key={f.id}>
            {/* Connecting line */}
            <div style={{
              width: 20, height: 2, flexShrink: 0,
              background: f.enabled ? (isSelected || isHovered ? theme.accentBright : theme.border) : theme.hoverBg,
              transition: 'background 0.15s',
            }} />

            {/* Feature node */}
            <div
              style={{ position: 'relative', flexShrink: 0 }}
              onMouseEnter={() => setHoverId(f.id)}
              onMouseLeave={() => setHoverId(null)}
              onDragOver={e => handleDragOver(e, f.id)}
              onDrop={e => handleDrop(e, f.id)}
            >
              <div
                draggable={!!onMoveFeature}
                onDragStart={e => onMoveFeature && handleDragStart(e, f.id)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelect(isSelected ? null : f.id)}
                onDoubleClick={(e) => { e.stopPropagation(); if (onEditFeature) onEditFeature(f.id); else onToggle(f.id); }}
                onContextMenu={e => handleContextMenu(e, f.id)}
                title={onMoveFeature ? 'Drag onto another feature to reorder. Right-click for options.' : 'Right-click for options'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 8px 4px 4px', borderRadius: 6,
                  background: isSelected ? theme.canvasBg : isHovered ? theme.hoverBg : 'transparent',
                  border: `1px solid ${
                    dragOverId === f.id && dragId !== f.id
                      ? '#3fb950'
                      : isSelected
                        ? theme.accent
                        : isHovered
                          ? theme.border
                          : 'transparent'
                  }`,
                  cursor: onMoveFeature ? 'grab' : 'pointer',
                  opacity: f.enabled ? 1 : 0.4,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: isSelected ? theme.hoverBg : theme.inputBg,
                  border: `2px solid ${isSelected ? theme.accentBright : hasError ? '#f85149' : theme.textMuted}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, flexShrink: 0, transition: 'border-color 0.15s',
                }}>
                  {def?.icon || '?'}
                </div>
                {/* Label visible when selected or hovered */}
                {(isSelected || isHovered) && (
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: isSelected ? theme.accentBright : theme.textMuted,
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

      {contextMenu && (
        <div style={{
          position: 'fixed', left: Math.min(contextMenu.x, typeof window !== 'undefined' ? window.innerWidth - 150 : 0), bottom: 50,
          background: theme.panelBg, border: `1px solid ${theme.border}`,
          borderRadius: 6, padding: 4, zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 2,
          minWidth: 140
        }}>
          {onEditFeature && (
            <button
              onClick={() => onEditFeature(contextMenu.id)}
              style={{ padding: '6px 12px', border: 'none', background: 'transparent', textAlign: 'left', fontSize: 11, fontWeight: 500, cursor: 'pointer', borderRadius: 4, color: theme.text }}
              onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              ✎ Edit Feature
            </button>
          )}
          {onSuppressFeature && (
            <button
              onClick={() => onSuppressFeature(contextMenu.id)}
              style={{ padding: '6px 12px', border: 'none', background: 'transparent', textAlign: 'left', fontSize: 11, fontWeight: 500, cursor: 'pointer', borderRadius: 4, color: theme.text }}
              onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              👁‍🗨 Toggle Suppress
            </button>
          )}
          {onDeleteFeature && (
            <button
              onClick={() => onDeleteFeature(contextMenu.id)}
              style={{ padding: '6px 12px', border: 'none', background: 'transparent', textAlign: 'left', fontSize: 11, fontWeight: 500, cursor: 'pointer', borderRadius: 4, color: '#f85149' }}
              onMouseEnter={e => e.currentTarget.style.background = '#3d1519'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              × Delete Feature
            </button>
          )}
        </div>
      )}

      {/* Analysis type badge */}
      {analysisProgress?.running && (
        <div style={{
          marginLeft: 'auto', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '2px 4px 2px 8px', borderRadius: 4,
          background: '#21262d', border: '1px solid #30363d',
          fontSize: 10, color: '#8b949e',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: analysisProgress.type === 'fea' || analysisProgress.type === 'interference'
              ? '#388bfd'
              : '#3fb950',
            animation: 'pulse 1s infinite',
          }} />
          {analysisProgress.label} {Math.round(analysisProgress.pct)}%
          {analysisProgress.onCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); analysisProgress.onCancel?.(); }}
              title="Cancel"
              aria-label="Cancel analysis"
              style={{
                marginLeft: 4,
                width: 18, height: 18, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3,
                background: 'transparent',
                color: '#f85149',
                border: '1px solid #30363d',
                cursor: 'pointer',
                fontSize: 12, lineHeight: 1, fontWeight: 700,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = '#f8514922';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#f85149';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d';
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Right spacer */}
      <div style={{ minWidth: 12, flexShrink: 0 }} />

      {/* Feature Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            bottom: typeof window !== 'undefined' ? window.innerHeight - contextMenu.y : 44,
            zIndex: 99999,
            background: 'rgba(36,41,47,0.95)',
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '4px 0',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 160,
            backdropFilter: 'blur(8px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onEditFeature && (
            <button
              onClick={() => { onEditFeature(contextMenu.id); setContextMenu(null); }}
              style={{
                background: 'transparent', border: 'none', color: '#c9d1d9',
                padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'background 0.1s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              ✏️ Edit Feature
            </button>
          )}
          {onSuppressFeature && (
            <button
              onClick={() => { onSuppressFeature(contextMenu.id); setContextMenu(null); }}
              style={{
                background: 'transparent', border: 'none', color: '#c9d1d9',
                padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'background 0.1s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {features.find(f => f.id === contextMenu.id)?.enabled ? '👁️ Suppress' : '👁️‍🗨️ Unsuppress'}
            </button>
          )}
          <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />
          {onDeleteFeature && (
            <button
              onClick={() => { onDeleteFeature(contextMenu.id); setContextMenu(null); }}
              style={{
                background: 'transparent', border: 'none', color: '#f85149',
                padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'background 0.1s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,81,73,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              🗑️ Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
