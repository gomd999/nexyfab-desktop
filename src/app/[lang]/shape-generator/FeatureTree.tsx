'use client';

import React, { useState, useRef, useCallback } from 'react';
import type { FeatureType } from './features/types';
import { FEATURE_DEFS, FEATURE_MAP, classifyFeatureError } from './features';
import type { FeatureHistory, HistoryNode } from './useFeatureStack';
import FeatureParams from './FeatureParams';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FeatureTreeProps {
  history: FeatureHistory;
  onRollbackTo: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onToggleExpanded: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  onRemoveNode: (id: string) => void;
  onUpdateParam: (id: string, key: string, value: number) => void;
  onAddFeature: (type: FeatureType) => void;
  onEditSketch?: (featureId: string) => void;
  onMoveFeature?: (fromId: string, toId: string) => void;
  t: Record<string, string>;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg: '#1b1f27',
  bgNode: '#22272e',
  bgNodeHover: '#2d333b',
  bgEditing: '#2a2520',
  text: '#c9d1d9',
  textMuted: '#8b949e',
  textDim: '#484f58',
  border: '#30363d',
  borderEditing: '#d29922',
  active: '#388bfd',
  activeBg: '#1a2332',
  danger: '#f85149',
  dangerBg: '#3d1519',
  accent: '#58a6ff',
  rollbar: '#388bfd',
} as const;

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FeatureTree({
  history,
  onRollbackTo,
  onStartEditing,
  onFinishEditing,
  onToggleExpanded,
  onToggleEnabled,
  onRemoveNode,
  onUpdateParam,
  onAddFeature,
  onEditSketch,
  onMoveFeature,
  t,
}: FeatureTreeProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  // #wf11: disable Add Feature when any feature has an error
  const hasFeatureError = history.nodes.some(n => n.error && n.enabled);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const { nodes, rootId, activeNodeId, editingNodeId } = history;

  // Find where the active node is in the ordered list
  const activeIdx = nodes.findIndex(n => n.id === activeNodeId);

  // Close context menu on outside click
  const handleTreeClick = useCallback(() => {
    if (contextMenu) setContextMenu(null);
  }, [contextMenu]);

  // ── Context menu handler ──

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  // ── Drag and drop ──

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    if (id === rootId) { e.preventDefault(); return; }
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, [rootId]);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragId || dragId === targetId || targetId === rootId) { setDragId(null); return; }
    onMoveFeature?.(dragId, targetId);
    setDragId(null);
  }, [dragId, rootId, onMoveFeature]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  // ── Render a single tree node ──

  const renderNode = (node: HistoryNode, depth: number, idx: number) => {
    const isActive = idx <= activeIdx;
    const isActiveNode = node.id === activeNodeId;
    const isEditing = node.id === editingNodeId;
    const isRoot = node.id === rootId;
    const isDragTarget = node.id === dragOverId && dragId !== node.id;
    const hasChildren = node.children.length > 0;
    const suppressed = !isActive;

    const def = node.featureType ? FEATURE_MAP[node.featureType] : null;

    // Node container style
    const containerStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      marginLeft: depth * 16,
      marginBottom: 1,
    };

    // Row style
    const rowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 8px',
      borderRadius: 6,
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 0.12s, opacity 0.12s',
      background: node.error ? C.dangerBg : isEditing ? C.bgEditing : isActiveNode ? C.activeBg : isDragTarget ? C.bgNodeHover : C.bgNode,
      opacity: suppressed ? 0.35 : node.enabled ? 1 : 0.45,
      borderLeft: isActiveNode ? `3px solid ${C.active}` : isEditing ? `3px solid ${C.borderEditing}` : '3px solid transparent',
      border: isEditing ? `1px solid ${C.borderEditing}` : `1px solid ${node.error ? C.danger : isDragTarget ? C.accent : 'transparent'}`,
      borderLeftWidth: 3,
      borderLeftStyle: 'solid',
      borderLeftColor: node.error ? C.danger : isActiveNode ? C.active : isEditing ? C.borderEditing : 'transparent',
    };

    return (
      <div key={node.id} style={containerStyle}>
        {/* Rollback bar: show between active and next node */}
        {isActiveNode && idx < nodes.length - 1 && (
          <div style={{
            height: 3,
            background: `linear-gradient(90deg, ${C.rollbar}, ${C.rollbar}80)`,
            borderRadius: 2,
            margin: '2px 0',
            cursor: 'ns-resize',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              right: 4,
              top: -6,
              fontSize: 9,
              color: C.active,
              fontWeight: 700,
              userSelect: 'none',
            }}>
              ▼ {t.rollbackBar || 'Current'}
            </div>
          </div>
        )}

        <div
          style={rowStyle}
          draggable={!isRoot}
          onDragStart={e => handleDragStart(e, node.id)}
          onDragOver={e => handleDragOver(e, node.id)}
          onDrop={e => handleDrop(e, node.id)}
          onDragEnd={handleDragEnd}
          onClick={() => onRollbackTo(node.id)}
          onDoubleClick={() => {
            if (isRoot) return;
            if (node.type === 'sketch' && onEditSketch) {
              onEditSketch(node.id);
            } else {
              onStartEditing(node.id);
            }
          }}
          onContextMenu={e => handleContextMenu(e, node.id)}
          onMouseEnter={e => {
            if (isRoot || Object.keys(node.params).length === 0) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
            tooltipTimerRef.current = setTimeout(() => {
              setTooltip({ nodeId: node.id, x: rect.right + 6, y: rect.top });
            }, 400);
          }}
          onMouseLeave={() => {
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
            setTooltip(null);
          }}
        >
          {/* Expand/collapse arrow */}
          {hasChildren ? (
            <span
              onClick={e => { e.stopPropagation(); onToggleExpanded(node.id); }}
              style={{
                fontSize: 10,
                color: C.textMuted,
                cursor: 'pointer',
                width: 14,
                textAlign: 'center',
                userSelect: 'none',
                flexShrink: 0,
                transition: 'transform 0.15s',
                display: 'inline-block',
                transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              ▶
            </span>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}

          {/* Icon */}
          <span style={{ fontSize: 14, flexShrink: 0 }}>{node.icon}</span>

          {/* Label */}
          <span style={{
            flex: 1,
            fontSize: 12,
            fontWeight: isActiveNode ? 700 : 500,
            color: suppressed ? C.textDim : isActiveNode ? C.accent : C.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}>
            {node.label}
          </span>

          {/* Sketch plane badge */}
          {node.featureType === 'sketchExtrude' && node.sketchData && (
            <span style={{
              fontSize: 9,
              color: '#58a6ff',
              background: '#0d1a2e',
              border: '1px solid #1a3a5e',
              padding: '1px 5px',
              borderRadius: 4,
              fontWeight: 700,
              flexShrink: 0,
              letterSpacing: '0.04em',
            }}>
              {node.sketchData.plane.toUpperCase()}
              {node.sketchData.operation === 'subtract' ? ' −' : ' +'}
            </span>
          )}

          {/* Error badge — clickable to toggle diagnostic panel */}
          {node.error && (
            <button
              onClick={e => {
                e.stopPropagation();
                setExpandedErrorId(prev => (prev === node.id ? null : node.id));
              }}
              title={node.error}
              style={{
                fontSize: 10,
                color: '#fff',
                background: C.danger,
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 700,
                flexShrink: 0,
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              ⚠ {expandedErrorId === node.id ? 'HIDE' : 'ERROR'}
            </button>
          )}

          {/* Action buttons */}
          {!isRoot && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              {/* Toggle visibility */}
              <button
                onClick={() => onToggleEnabled(node.id)}
                title={node.enabled ? 'Suppress' : 'Unsuppress'}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: node.enabled ? C.textMuted : C.textDim,
                  padding: '1px 3px',
                  lineHeight: 1,
                }}
              >
                {node.enabled ? '👁' : '👁‍🗨'}
              </button>

              {/* Edit */}
              {isEditing ? (
                <button
                  onClick={onFinishEditing}
                  title="Finish Editing"
                  style={{
                    border: 'none',
                    background: C.borderEditing,
                    color: '#000',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    lineHeight: 1,
                  }}
                >
                  ✓
                </button>
              ) : node.type === 'sketch' && onEditSketch ? (
                <button
                  onClick={() => onEditSketch(node.id)}
                  title={t.editingSketch || 'Edit Sketch'}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: C.accent,
                    padding: '1px 3px',
                    lineHeight: 1,
                  }}
                >
                  ✏️
                </button>
              ) : (
                <button
                  onClick={() => onStartEditing(node.id)}
                  title="Edit"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: C.textMuted,
                    padding: '1px 3px',
                    lineHeight: 1,
                  }}
                >
                  ✎
                </button>
              )}

              {/* Delete */}
              <button
                onClick={() => onRemoveNode(node.id)}
                title="Delete"
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: C.danger,
                  padding: '1px 3px',
                  lineHeight: 1,
                  fontWeight: 700,
                }}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Diagnostic panel (when error badge clicked) */}
        {node.error && expandedErrorId === node.id && (() => {
          const diag = classifyFeatureError(node.featureType ?? 'sketchExtrude', node.error);
          return (
            <div style={{
              marginLeft: 20,
              marginTop: 4,
              marginBottom: 4,
              padding: '10px 12px',
              background: '#1e0d10',
              border: `1px solid ${C.danger}`,
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.5,
            }}>
              <div style={{ color: C.danger, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span>
                <span>{t.diagnosticTitle || '피처 실행 실패'}</span>
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: '#3d1519', color: '#ffb4ab', fontWeight: 600,
                  marginLeft: 'auto', letterSpacing: '0.04em',
                }}>{diag.code}</span>
              </div>
              <div style={{ color: '#e8b0b0', fontFamily: 'monospace', fontSize: 10, marginBottom: 6, wordBreak: 'break-word' }}>
                {diag.message}
              </div>
              <div style={{ color: '#ffd4a8', marginBottom: 8 }}>
                💡 {diag.hintKo}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onStartEditing(node.id);
                    setExpandedErrorId(null);
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.active}`,
                    background: 'transparent', color: C.accent, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t.editParams || '파라미터 편집'}
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onToggleEnabled(node.id);
                    setExpandedErrorId(null);
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.textMuted}`,
                    background: 'transparent', color: C.textMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {node.enabled ? (t.suppress || '일시 중지') : (t.unsuppress || '활성화')}
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (confirm(t.confirmRemove || '이 피처를 삭제하시겠습니까?')) {
                      onRemoveNode(node.id);
                      setExpandedErrorId(null);
                    }
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.danger}`,
                    background: 'transparent', color: C.danger, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t.remove || '삭제'}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Inline parameter editor (when editing) */}
        {isEditing && def && (
          <div style={{
            marginLeft: 20,
            marginTop: 4,
            marginBottom: 4,
            padding: 10,
            background: '#2a2520',
            border: `1px solid ${C.borderEditing}`,
            borderRadius: 6,
          }}>
            <FeatureParams
              instance={{
                id: node.id,
                type: node.featureType!,
                params: node.params,
                enabled: node.enabled,
                error: node.error,
              }}
              definition={def}
              t={t}
              onParamChange={onUpdateParam}
            />
          </div>
        )}

        {/* Recursively render children */}
        {node.expanded && hasChildren && node.children.map(childId => {
          const childNode = nodes.find(n => n.id === childId);
          if (!childNode) return null;
          const childIdx = nodes.indexOf(childNode);
          return renderNode(childNode, depth + 1, childIdx);
        })}
      </div>
    );
  };

  // ── Render ──

  const rootNode = nodes.find(n => n.id === rootId);

  return (
    <div
      ref={treeRef}
      onClick={handleTreeClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{
        background: C.bg,
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        padding: 12,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <h3 style={{
            fontSize: 13,
            fontWeight: 800,
            color: C.text,
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{ fontSize: 14 }}>🌳</span>
            {t.featureTree || 'Design Tree'}
          </h3>

          {/* Add feature button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { if (!hasFeatureError) setShowAddMenu(!showAddMenu); }}
              disabled={hasFeatureError}
              title={hasFeatureError ? (t.fixFeatureErrorFirst || '피처 오류를 먼저 수정하세요') : (t.addFeature || 'Add Feature')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${C.border}`,
                background: C.bgNode,
                color: hasFeatureError ? '#6e7681' : C.accent,
                fontSize: 12,
                fontWeight: 700,
                cursor: hasFeatureError ? 'not-allowed' : 'pointer',
                opacity: hasFeatureError ? 0.5 : 1,
              }}
            >
              + {t.addFeature || 'Add'}
            </button>

            {showAddMenu && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: C.bgNode,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                padding: 4,
                zIndex: 100,
                minWidth: 180,
                maxHeight: 300,
                overflowY: 'auto',
              }}>
                {FEATURE_DEFS.map(def => (
                  <button
                    key={def.type}
                    onClick={() => { onAddFeature(def.type); setShowAddMenu(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text,
                      textAlign: 'left',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.bgNodeHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 14 }}>{def.icon}</span>
                    {(t as Record<string, string>)[`featureName_${def.type}`] || def.type}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tree body */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}>
          {nodes.length === 0 || !rootNode ? (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 20, opacity: 0.3 }}>🌳</span>
              <p style={{ color: C.textMuted, fontSize: 11, marginTop: 6 }}>
                {t.noFeatures || 'No features added'}
              </p>
            </div>
          ) : (
            renderNode(rootNode, 0, 0)
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: C.bgNode,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 1000,
            minWidth: 140,
          }}
          onClick={e => e.stopPropagation()}
        >
          {(() => {
            const ctxNode = nodes.find(n => n.id === contextMenu.nodeId);
            const isSketchNode = ctxNode?.type === 'sketch';
            return [
              ...(isSketchNode && onEditSketch ? [{ label: t.editingSketch || 'Edit Sketch', action: () => { onEditSketch(contextMenu.nodeId); setContextMenu(null); }, disabled: false }] : []),
              { label: t.editFeature || 'Edit', action: () => { onStartEditing(contextMenu.nodeId); setContextMenu(null); }, disabled: contextMenu.nodeId === rootId || isSketchNode },
              { label: t.rollbackHere || 'Rollback here', action: () => { onRollbackTo(contextMenu.nodeId); setContextMenu(null); } },
              { label: t.suppressFeature || 'Toggle suppress', action: () => { onToggleEnabled(contextMenu.nodeId); setContextMenu(null); }, disabled: contextMenu.nodeId === rootId },
              { label: t.deleteFeature || 'Delete', action: () => { onRemoveNode(contextMenu.nodeId); setContextMenu(null); }, disabled: contextMenu.nodeId === rootId, danger: true },
            ];
          })().map((item, i) => (
            <button
              key={i}
              onClick={item.disabled ? undefined : item.action}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                cursor: item.disabled ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: item.disabled ? C.textDim : (item as any).danger ? C.danger : C.text,
                textAlign: 'left',
                opacity: item.disabled ? 0.4 : 1,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = C.bgNodeHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Node param hover tooltip ── */}
      {tooltip && (() => {
        const node = nodes.find(n => n.id === tooltip.nodeId);
        if (!node || Object.keys(node.params).length === 0) return null;
        const def = node.featureType ? FEATURE_MAP[node.featureType] : null;
        return (
          <div
            onMouseEnter={() => { if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current); }}
            onMouseLeave={() => setTooltip(null)}
            style={{
              position: 'fixed',
              left: Math.min(tooltip.x, window.innerWidth - 180),
              top: Math.max(4, Math.min(tooltip.y, window.innerHeight - 160)),
              zIndex: 9999,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              padding: '8px 10px',
              minWidth: 150,
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{node.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#e6edf3' }}>
                {(def as any)?.label ?? node.label ?? node.id}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(node.params).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10 }}>
                  <span style={{ color: '#8b949e' }}>{k}</span>
                  <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontWeight: 700 }}>{Math.round(v * 100) / 100}</span>
                </div>
              ))}
            </div>
            {!node.enabled && (
              <div style={{ marginTop: 5, fontSize: 9, color: '#f0883e', fontWeight: 700 }}>⊘ 비활성화됨</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
