'use client';

import React, { useState, useEffect } from 'react';
import type {
  SketchProfile, SketchConfig, SketchTool, ExtrudeMode,
  SketchConstraint, SketchDimension, ConstraintType,
} from './types';

interface SketchPanelProps {
  profile: SketchProfile;
  config: SketchConfig;
  onConfigChange: (config: SketchConfig) => void;
  activeTool: SketchTool;
  onToolChange: (tool: SketchTool) => void;
  onClear: () => void;
  onUndo: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
  t: Record<string, string>;
  // New props for constraints/dimensions
  constraints?: SketchConstraint[];
  dimensions?: SketchDimension[];
  onAddConstraint?: (type: ConstraintType) => void;
  onRemoveConstraint?: (id: string) => void;
  onDimensionChange?: (id: string, value: number) => void;
  onRemoveDimension?: (id: string) => void;
  // Tool-specific params
  circleRadius?: number;
  onCircleRadiusChange?: (r: number) => void;
  rectWidth?: number;
  rectHeight?: number;
  onRectSizeChange?: (w: number, h: number) => void;
  polygonSides?: number;
  onPolygonSidesChange?: (n: number) => void;
  // ellipseRx/Ry, slotRadius, filletRadius are read from config and written via onConfigChange
  selectedConstraintType?: ConstraintType;
  onConstraintTypeChange?: (type: ConstraintType) => void;
  // Multi-profile support
  multiSketch?: { profiles: SketchProfile[]; activeProfileIndex: number };
  onSetActiveProfile?: (idx: number) => void;
  onAddHoleProfile?: () => void;
  onDeleteProfile?: (idx: number) => void;
  // Feature-tree sketch props
  sketchPlane?: 'xy' | 'xz' | 'yz';
  onSketchPlaneChange?: (plane: 'xy' | 'xz' | 'yz') => void;
  sketchPlaneOffset?: number;
  onSketchPlaneOffsetChange?: (offset: number) => void;
  sketchOperation?: 'add' | 'subtract';
  onSketchOperationChange?: (op: 'add' | 'subtract') => void;
  onAddSketchFeature?: () => void;
  // Sketch history
  showSketchHistory?: boolean;
  onToggleSketchHistory?: () => void;
  // Edit-feature mode
  editingFeatureId?: string | null;
  // Constraint solver
  autoSolve?: boolean;
  onAutoSolveChange?: (v: boolean) => void;
  onSolveConstraints?: () => void;
  /** Status returned from constraint solver */
  constraintStatus?: 'ok' | 'over-defined' | 'under-defined' | 'inconsistent';
  /** Extended diagnostic from the LM solver (dof/residual/message) */
  constraintDiagnostic?: {
    dof?: number;
    residual?: number;
    message?: string;
    unsatisfiedCount?: number;
  };
  isKo?: boolean;
  /** 2-phase sketch UX: 'draw' shows tools only, 'setup3d' shows extrude/generate */
  sketchStep?: 'draw' | 'setup3d';
  onSketchStepChange?: (step: 'draw' | 'setup3d') => void;
}

// ─── Styles (dark theme) ────────────────────────────────────────────────────

const sectionSep: React.CSSProperties = {
  borderTop: '1px solid #21262d',
  paddingTop: 6,
  marginTop: 6,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: '#6e7681',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 6,
};

const toolBtnBase: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 0',
  borderRadius: 6,
  border: '1px solid #30363d',
  background: '#161b22',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  color: '#8b949e',
  transition: 'all 0.15s',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
};

const toolBtnActive: React.CSSProperties = {
  ...toolBtnBase,
  border: '2px solid #388bfd',
  background: '#0d1117',
  color: '#388bfd',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '56px 1fr 36px',
  alignItems: 'center',
  gap: 4,
  marginBottom: 3,
};

const sliderLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#9ca3af',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sliderStyle: React.CSSProperties = {
  width: '100%',
  accentColor: '#388bfd',
  cursor: 'pointer',
  height: 3,
  borderRadius: 2,
};

const sliderValueStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#388bfd',
  textAlign: 'right',
  fontFamily: 'monospace',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #30363d',
  background: '#0d1117',
  color: '#c9d1d9',
  fontSize: 12,
  fontWeight: 600,
  outline: 'none',
};

const constraintBtnBase: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 5,
  border: '1px solid #30363d',
  background: '#161b22',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 600,
  color: '#8b949e',
  transition: 'all 0.15s',
};

const constraintBtnActive: React.CSSProperties = {
  ...constraintBtnBase,
  border: '1px solid #388bfd',
  background: '#0d1117',
  color: '#388bfd',
};

// ─── Tool definitions ───────────────────────────────────────────────────────

type ToolDef = { id: SketchTool; label: string; icon: string; hotkey?: string };

/** Always-visible primary tools */
const primaryTools: ToolDef[] = [
  { id: 'line',       label: 'Line',   icon: '/',  hotkey: 'L' },
  { id: 'arc',        label: 'Arc',    icon: '⌒', hotkey: 'A' },
  { id: 'circle',     label: 'Circle', icon: '○', hotkey: 'C' },
  { id: 'rect',       label: 'Rect',   icon: '▭', hotkey: 'R' },
  { id: 'polygon',    label: 'Poly',   icon: '⬡', hotkey: 'P' },
  { id: 'select',     label: 'Select', icon: '↖', hotkey: 'V' },
  { id: 'dimension',  label: 'Dim',    icon: '↔', hotkey: 'N' },
  { id: 'constraint', label: 'Constr', icon: '⊥' },
];

/** Extra tools shown only when "more" is expanded */
const moreTools: ToolDef[] = [
  { id: 'ellipse',      label: 'Ellipse', icon: '⬭',  hotkey: 'E' },
  { id: 'slot',         label: 'Slot',    icon: '⬮',  hotkey: 'U' },
  { id: 'spline',       label: 'Spline',  icon: '〜', hotkey: 'B' },
  { id: 'fillet',       label: 'Fillet',  icon: '◜',  hotkey: 'F' },
  { id: 'mirror',       label: 'Mirror',  icon: '⇆',  hotkey: 'K' },
  { id: 'offset',       label: 'Offset',  icon: '⧫',  hotkey: 'O' },
  { id: 'trim',         label: 'Trim',    icon: '✂',  hotkey: 'X' },
  { id: 'construction', label: 'Aux',     icon: '- -', hotkey: 'Q' },
];

const constraintTypes: Array<{ type: ConstraintType; label: string; icon: string }> = [
  { type: 'horizontal', label: 'Horizontal', icon: 'H' },
  { type: 'vertical', label: 'Vertical', icon: 'V' },
  { type: 'perpendicular', label: 'Perp', icon: '⊥' },
  { type: 'parallel', label: 'Parallel', icon: '∥' },
  { type: 'tangent', label: 'Tangent', icon: '⌢' },
  { type: 'coincident', label: 'Coincid', icon: '●' },
  { type: 'equal', label: 'Equal', icon: '=' },
  { type: 'symmetric', label: 'Symm', icon: '⇔' },
  { type: 'midpoint', label: 'Midpt', icon: '◎' },
  { type: 'concentric', label: 'Concent', icon: '⊙' },
  { type: 'angle', label: 'Angle', icon: '∠' },
  { type: 'fixed', label: 'Fixed', icon: '⊗' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function SketchPanel({
  profile, config, onConfigChange, activeTool, onToolChange,
  onClear, onUndo, onGenerate, canGenerate, t,
  constraints = [], dimensions = [],
  onAddConstraint, onRemoveConstraint,
  onDimensionChange, onRemoveDimension,
  circleRadius = 25, onCircleRadiusChange,
  rectWidth = 50, rectHeight = 30, onRectSizeChange,
  polygonSides = 6, onPolygonSidesChange,
  selectedConstraintType = 'horizontal', onConstraintTypeChange,
  multiSketch, onSetActiveProfile, onAddHoleProfile, onDeleteProfile,
  sketchPlane = 'xy', onSketchPlaneChange,
  sketchPlaneOffset = 0, onSketchPlaneOffsetChange,
  sketchOperation = 'add', onSketchOperationChange,
  onAddSketchFeature,
  showSketchHistory = false, onToggleSketchHistory,
  editingFeatureId = null,
  autoSolve = false, onAutoSolveChange,
  onSolveConstraints,
  constraintStatus,
  constraintDiagnostic,
  isKo = false,
  sketchStep = 'draw',
  onSketchStepChange,
}: SketchPanelProps) {

  // Auto-expand "more tools" if the active tool is in the more-tools group
  const isMoreTool = moreTools.some(t => t.id === activeTool);
  const [showMoreTools, setShowMoreTools] = useState(isMoreTool);
  // Keep expanded if user switches to a "more" tool via hotkey
  React.useEffect(() => {
    if (isMoreTool) setShowMoreTools(true);
  }, [isMoreTool]);

  // Derive new tool params from config (with fallback defaults)
  const ellipseRx = config.ellipseRx ?? 25;
  const ellipseRy = config.ellipseRy ?? 15;
  const slotRadius = config.slotRadius ?? 10;
  const filletRadius = config.filletRadius ?? 5;

  const [dimEditId, setDimEditId] = useState<string | null>(null);
  const [dimEditValue, setDimEditValue] = useState('');
  const [showConstraints, setShowConstraints] = useState(false);

  // ── Destructive action confirmations ──
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteProfileIdx, setConfirmDeleteProfileIdx] = useState<number | null>(null);
  const [confirmRemoveConstraintId, setConfirmRemoveConstraintId] = useState<string | null>(null);
  const [confirmRemoveDimensionId, setConfirmRemoveDimensionId] = useState<string | null>(null);

  // Suppress unused-variable warnings — kept for API compat
  void onAddConstraint;

  const pointCount = (() => {
    const pts = new Set<string>();
    for (const seg of profile.segments) {
      for (const p of seg.points) {
        pts.add(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      }
    }
    return pts.size;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── ① Profile status bar ── */}
      {(() => {
        const segCount = profile.segments.length;
        const isClosed = profile.closed;
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', marginBottom: 6,
            borderRadius: 6,
            background: isClosed ? 'rgba(63,185,80,0.07)' : segCount > 0 ? 'rgba(210,153,34,0.07)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isClosed ? '#3fb95033' : segCount > 0 ? '#d2992233' : '#21262d'}`,
          }}>
            <span style={{
              fontSize: 13,
              color: isClosed ? '#3fb950' : segCount > 0 ? '#d29922' : '#484f58',
            }}>
              {isClosed ? '✓' : segCount > 0 ? '○' : '◌'}
            </span>
            <span style={{ fontSize: 10, color: isClosed ? '#3fb950' : segCount > 0 ? '#d29922' : '#484f58', fontWeight: 700 }}>
              {isClosed
                ? (isKo ? '프로파일 완성' : 'Profile closed')
                : segCount > 0
                  ? (isKo ? `그리는 중 (${segCount}seg)` : `Drawing… (${segCount} seg)`)
                  : (isKo ? '스케치 시작' : 'Start sketching')}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>
              {pointCount}pt
            </span>
          </div>
        );
      })()}

      {/* ── ② Drawing Tools ── */}
      {(() => {
        const koLabel: Record<string, string> = {
          line: '선', arc: '호', circle: '원', rect: '사각형', polygon: '다각형',
          ellipse: '타원', slot: '슬롯', fillet: '필렛', mirror: '미러',
          construction: '보조선', spline: '스플라인', offset: '오프셋',
          trim: '트림', select: '선택', dimension: '치수', constraint: '구속조건',
        };
        // ③ Tool step hints
        const toolHint: Record<string, [string, string]> = {
          line:         ['Click: start point → end point', '클릭: 시작점 → 끝점'],
          arc:          ['3 clicks: start → through → end', '3클릭: 시작 → 통과 → 끝'],
          circle:       ['2 clicks: center → edge', '2클릭: 중심 → 가장자리'],
          rect:         ['2 clicks: corner 1 → corner 2', '2클릭: 모서리1 → 모서리2'],
          polygon:      ['2 clicks: center → vertex', '2클릭: 중심 → 꼭짓점'],
          ellipse:      ['3 clicks: center → Rx → Ry', '3클릭: 중심 → Rx → Ry'],
          slot:         ['2 clicks: center 1 → center 2', '2클릭: 중심1 → 중심2'],
          spline:       ['Click points, double-click to finish', '점 클릭, 더블클릭으로 완료'],
          fillet:       ['Click a corner vertex to fillet', '모서리 꼭짓점을 클릭'],
          mirror:       ['2 clicks: axis start → end', '2클릭: 축 시작 → 끝'],
          offset:       ['Click a segment to offset', '세그먼트 클릭으로 오프셋'],
          trim:         ['Click a segment to trim', '세그먼트 클릭으로 자르기'],
          construction: ['Click a segment to toggle aux', '세그먼트 클릭으로 보조선 전환'],
          select:       ['Click to select, drag to move', '클릭 선택, 드래그 이동'],
          dimension:    ['Click a segment to add dimension', '세그먼트 클릭으로 치수 추가'],
          constraint:   ['Select constraint type below', '아래에서 구속조건 선택'],
        };
        const hint = toolHint[activeTool];

        const renderTool = (tool: ToolDef) => {
          const isActive = activeTool === tool.id;
          const displayLabel = isKo ? (koLabel[tool.id] ?? tool.label) : tool.label;
          return (
            <button
              key={tool.id}
              onClick={() => onToolChange(tool.id)}
              title={tool.hotkey ? `${displayLabel} (단축키: ${tool.hotkey})` : displayLabel}
              aria-label={tool.hotkey ? `${tool.label} (${tool.hotkey})` : tool.label}
              style={{ ...(isActive ? toolBtnActive : toolBtnBase), position: 'relative' }}
            >
              {tool.icon}
              {tool.hotkey && (
                <span style={{
                  position: 'absolute', top: 1, right: 2,
                  fontSize: 8, opacity: 0.55, fontFamily: 'monospace',
                  pointerEvents: 'none',
                }}>{tool.hotkey}</span>
              )}
            </button>
          );
        };

        // Draw tools (line–polygon) vs interact tools (select/dim/constraint)
        const drawTools = primaryTools.slice(0, 5);
        const interactTools = primaryTools.slice(5);

        return (
          <div style={{ marginBottom: 4 }}>
            {/* Primary tools with ③ separator */}
            <div style={{ display: 'flex', gap: 3, marginBottom: 3, alignItems: 'stretch' }}>
              {drawTools.map(renderTool)}
              {/* Divider */}
              <div style={{ width: 1, background: '#30363d', margin: '2px 1px', flexShrink: 0 }} />
              {interactTools.map(renderTool)}
            </div>

            {/* ① Active tool hint */}
            {hint && (
              <div style={{
                fontSize: 10, color: '#8b949e',
                padding: '3px 6px', marginBottom: 3,
                background: 'rgba(56,139,253,0.06)',
                borderLeft: '2px solid #388bfd55',
                borderRadius: '0 4px 4px 0',
              }}>
                {isKo ? hint[1] : hint[0]}
              </div>
            )}

            {/* More tools — collapsible with sub-groups */}
            {showMoreTools && (
              <div style={{
                marginBottom: 3, padding: '5px 6px',
                background: 'rgba(56,139,253,0.03)',
                border: '1px solid #21262d', borderRadius: 5,
              }}>
                {/* Shape sub-group */}
                <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 3, letterSpacing: '0.05em' }}>
                  {isKo ? '도형' : 'SHAPE'}
                </div>
                <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
                  {moreTools.filter(t => ['ellipse','slot','spline'].includes(t.id)).map(renderTool)}
                </div>
                {/* Edit sub-group */}
                <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 3, letterSpacing: '0.05em' }}>
                  {isKo ? '편집' : 'EDIT'}
                </div>
                <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
                  {moreTools.filter(t => ['fillet','mirror','offset','trim'].includes(t.id)).map(renderTool)}
                </div>
                {/* Aux sub-group */}
                <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 3, letterSpacing: '0.05em' }}>
                  {isKo ? '보조' : 'AUX'}
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {moreTools.filter(t => ['construction'].includes(t.id)).map(renderTool)}
                </div>
              </div>
            )}

            {/* Toggle button */}
            <button
              onClick={() => setShowMoreTools(v => !v)}
              style={{
                width: '100%', padding: '3px 0',
                background: 'none', border: '1px solid #21262d',
                borderRadius: 4, cursor: 'pointer',
                color: showMoreTools ? '#388bfd' : '#8b949e',
                fontSize: 10, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                transition: 'color 0.15s',
              }}
            >
              {showMoreTools
                ? (isKo ? '접기 ▲' : 'Less ▲')
                : (isKo ? `더 보기 ▼ (${moreTools.length}개)` : `More ▼ (${moreTools.length})`)}
              {!showMoreTools && isMoreTool && (
                <span style={{
                  background: '#388bfd', color: '#fff',
                  borderRadius: 3, fontSize: 9, padding: '0 4px',
                }}>active</span>
              )}
            </button>
          </div>
        );
      })()}

      {/* ── ⑤ Constraint type picker — inline (shown when constraint tool active) ── */}
      {activeTool === 'constraint' && (
        <div style={{
          marginBottom: 6, padding: '6px',
          background: '#0d1117', border: '1px solid #388bfd44',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 4, letterSpacing: '0.05em' }}>
            {isKo ? '구속조건 선택' : 'CONSTRAINT TYPE'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          {constraintTypes.map(ct => (
            <button
              key={ct.type}
              onClick={() => {
                onConstraintTypeChange?.(ct.type);
              }}
              title={ct.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 5,
                border: selectedConstraintType === ct.type ? '1px solid #388bfd' : '1px solid transparent',
                background: selectedConstraintType === ct.type ? 'rgba(56,139,253,0.15)' : 'transparent',
                color: selectedConstraintType === ct.type ? '#58a6ff' : '#c9d1d9',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { if (selectedConstraintType !== ct.type) e.currentTarget.style.background = '#21262d'; }}
              onMouseLeave={e => { if (selectedConstraintType !== ct.type) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{ct.icon}</span>
              <span>{isKo ? ({
                horizontal: '수평', vertical: '수직', perpendicular: '직교',
                parallel: '평행', tangent: '접선', coincident: '일치',
                concentric: '동심', equal: '동일', symmetric: '대칭', midpoint: '중점',
                angle: '각도', fixed: '고정',
              } as Record<string, string>)[ct.type] ?? ct.label : ct.label}</span>
            </button>
          ))}
          </div>
        </div>
      )}

      {/* ── Multi-profile tabs ── */}
      {multiSketch && multiSketch.profiles.length > 0 && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{t.outerProfile ? t.outerProfile + ' / ' + (t.holeProfile || 'Holes') : 'Profiles'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
            {multiSketch.profiles.map((_, idx) => {
              const isActive = idx === multiSketch.activeProfileIndex;
              const label = idx === 0
                ? (t.outerProfile || 'Outer')
                : `${t.holeProfile || 'Hole'} ${idx}`;
              return (
                <button
                  key={idx}
                  onClick={() => onSetActiveProfile?.(idx)}
                  title={isActive ? (isKo ? '현재 편집 중' : 'Currently editing') : (isKo ? '클릭하여 전환' : 'Click to switch')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    border: isActive ? '2px solid #388bfd' : '1px solid #30363d',
                    background: isActive ? 'linear-gradient(135deg, #388bfd22, #1f6feb11)' : '#161b22',
                    color: isActive ? '#58a6ff' : '#8b949e',
                    fontWeight: isActive ? 800 : 600,
                    fontSize: 10,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                    boxShadow: isActive ? '0 0 0 1px #388bfd44' : 'none',
                  }}
                >
                  {isActive ? '● ' : ''}{label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={onAddHoleProfile}
              style={{
                flex: 1, padding: '4px 8px', borderRadius: 6,
                border: '1px solid #30363d', background: '#161b22',
                color: '#3fb950', fontWeight: 700, fontSize: 10, cursor: 'pointer',
              }}
            >
              + {t.addHoleProfile || 'Add Hole'}
            </button>
            {confirmDeleteProfileIdx === multiSketch.activeProfileIndex ? (
              <div style={{ flex: 1, display: 'flex', gap: 3 }}>
                <button
                  onClick={() => setConfirmDeleteProfileIdx(null)}
                  style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontWeight: 700, fontSize: 10, cursor: 'pointer' }}
                >
                  {isKo ? '취소' : 'Cancel'}
                </button>
                <button
                  onClick={() => { onDeleteProfile?.(multiSketch.activeProfileIndex); setConfirmDeleteProfileIdx(null); }}
                  style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontWeight: 800, fontSize: 10, cursor: 'pointer' }}
                >
                  {isKo ? '삭제 확인' : 'Confirm'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteProfileIdx(multiSketch.activeProfileIndex)}
                disabled={multiSketch.activeProfileIndex === 0}
                title={multiSketch.activeProfileIndex === 0 ? (isKo ? '외부 프로파일은 삭제할 수 없습니다' : 'Cannot delete the outer profile') : (isKo ? '현재 홀 프로파일 삭제' : 'Delete current hole profile')}
                style={{
                  flex: 1, padding: '4px 8px', borderRadius: 6,
                  border: '1px solid #30363d', background: '#161b22',
                  color: multiSketch.activeProfileIndex === 0 ? '#6e7681' : '#f85149',
                  fontWeight: 700, fontSize: 10,
                  cursor: multiSketch.activeProfileIndex === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                ✕ {t.deleteProfile || 'Delete'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Tool-specific params ── */}
      {activeTool === 'circle' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Circle</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Radius</span>
            <input type="range" min={1} max={200} step={1} value={circleRadius}
              onChange={e => onCircleRadiusChange?.(Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{circleRadius}</span>
          </div>
        </div>
      )}

      {activeTool === 'rect' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Rectangle</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Width</span>
            <input type="range" min={1} max={500} step={1} value={rectWidth}
              onChange={e => onRectSizeChange?.(Number(e.target.value), rectHeight)}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{rectWidth}</span>
          </div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Height</span>
            <input type="range" min={1} max={500} step={1} value={rectHeight}
              onChange={e => onRectSizeChange?.(rectWidth, Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{rectHeight}</span>
          </div>
        </div>
      )}

      {activeTool === 'polygon' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Polygon</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Sides</span>
            <input type="range" min={3} max={12} step={1} value={polygonSides}
              onChange={e => onPolygonSidesChange?.(Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{polygonSides}</span>
          </div>
        </div>
      )}

      {activeTool === 'ellipse' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{isKo ? '타원' : 'Ellipse'}</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Rx</span>
            <input type="range" min={1} max={200} step={1} value={ellipseRx}
              onChange={e => onConfigChange({ ...config, ellipseRx: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{ellipseRx}</span>
          </div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Ry</span>
            <input type="range" min={1} max={200} step={1} value={ellipseRy}
              onChange={e => onConfigChange({ ...config, ellipseRy: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{ellipseRy}</span>
          </div>
        </div>
      )}

      {activeTool === 'slot' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{isKo ? '슬롯' : 'Slot'}</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>{isKo ? '반지름' : 'Radius'}</span>
            <input type="range" min={1} max={100} step={1} value={slotRadius}
              onChange={e => onConfigChange({ ...config, slotRadius: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{slotRadius}</span>
          </div>
        </div>
      )}

      {activeTool === 'fillet' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{isKo ? '필렛' : 'Fillet'}</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>{isKo ? '반지름' : 'Radius'}</span>
            <input type="range" min={1} max={50} step={0.5} value={filletRadius}
              onChange={e => onConfigChange({ ...config, filletRadius: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{filletRadius}</span>
          </div>
        </div>
      )}

      {activeTool === 'mirror' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{isKo ? '미러' : 'Mirror'}</div>
          <p style={{ fontSize: 10, color: '#8b949e', margin: 0 }}>
            {isKo
              ? '축 위 두 점을 클릭하세요. Shift = Y축 미러'
              : 'Click two points on the mirror axis. Shift = mirror about Y axis'}
          </p>
        </div>
      )}

      {activeTool === 'construction' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{isKo ? '보조선' : 'Construction'}</div>
          <p style={{ fontSize: 10, color: '#8b949e', margin: 0 }}>
            {isKo
              ? '세그먼트를 클릭하면 보조선으로 전환됩니다. 형상 생성에 포함되지 않습니다.'
              : 'Click a segment to toggle construction mode. Construction lines are excluded from geometry.'}
          </p>
        </div>
      )}

      {activeTool === 'dimension' && (
        <div style={sectionSep}>
          <p style={{ fontSize: 10, color: '#8b949e', margin: 0 }}>
            Click a segment to add a dimension. Click dimension text to edit value.
          </p>
        </div>
      )}

      {/* ── Constraint solver diagnostic panel ── */}
      {constraintStatus && (() => {
        const isError = constraintStatus === 'over-defined' || constraintStatus === 'inconsistent';
        const isWarn = constraintStatus === 'under-defined';
        const isOk = constraintStatus === 'ok';
        const bg = isError ? '#3d1f1f' : isWarn ? '#1c2933' : '#1a2d1a';
        const border = isError ? '#f85149' : isWarn ? '#388bfd' : '#3fb950';
        const icon = isError ? '⚠️' : isWarn ? 'ℹ️' : '✓';
        const label =
          constraintStatus === 'over-defined'
            ? (isKo ? '과잉 구속' : 'Over-defined')
            : constraintStatus === 'inconsistent'
              ? (isKo ? '구속 불일치' : 'Inconsistent')
              : constraintStatus === 'under-defined'
                ? (isKo ? '구속 부족' : 'Under-defined')
                : (isKo ? '정상' : 'OK');
        const dof = constraintDiagnostic?.dof;
        const residual = constraintDiagnostic?.residual;
        const unsat = constraintDiagnostic?.unsatisfiedCount;
        const hint = constraintDiagnostic?.message;
        return (
          <div style={{ padding: '6px 10px', background: bg, border: `1px solid ${border}`, borderRadius: 5, color: border, fontSize: 10, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <span>{icon}</span>
              <span>{label}</span>
              {typeof dof === 'number' && (
                <span
                  title={isKo
                    ? `자유도 (DOF): ${dof} — 0이면 완전 구속, 양수면 구속 부족, 음수면 과잉 구속`
                    : `Degrees of Freedom: ${dof} — 0 = fully constrained, >0 = under-constrained, <0 = over-constrained`}
                  style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 400, opacity: 0.9, cursor: 'help', borderBottom: '1px dotted currentColor' }}
                >
                  {isKo ? '자유도' : 'DOF'}: {dof}
                </span>
              )}
            </div>
            {(typeof residual === 'number' || typeof unsat === 'number') && (
              <div style={{ fontFamily: 'monospace', fontSize: 9, opacity: 0.8, marginTop: 2 }}>
                {typeof residual === 'number' && (
                  <span
                    title={isKo
                      ? `잔차(residual): ${residual.toExponential(2)} — 구속 조건 해결 오차. 값이 작을수록 정확함`
                      : `Solver residual error: ${residual.toExponential(2)} — smaller is better`}
                    style={{ cursor: 'help', borderBottom: '1px dotted currentColor' }}
                  >
                    {isKo ? '오차' : 'err'}={residual.toExponential(2)}
                  </span>
                )}
                {typeof residual === 'number' && typeof unsat === 'number' && unsat > 0 && '  '}
                {typeof unsat === 'number' && unsat > 0 && (
                  <span
                    title={isKo
                      ? `미충족 구속 ${unsat}개 — 이 구속 조건들이 현재 만족되지 않습니다`
                      : `${unsat} unsatisfied constraint(s) — these constraints are not currently met`}
                    style={{ cursor: 'help', borderBottom: '1px dotted currentColor', color: '#f85149' }}
                  >
                    {isKo ? '미충족' : 'unsat'}={unsat}
                  </span>
                )}
              </div>
            )}
            {hint && !isOk && (
              <div style={{ fontSize: 9, opacity: 0.85, marginTop: 2 }}>
                {hint}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Constraints — collapsible ── */}
      {constraints.length > 0 && (
        <div style={sectionSep}>
          <div
            onClick={() => setShowConstraints(s => !s)}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showConstraints ? 4 : 0 }}
          >
            <span style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Constraints ({constraints.length}) {constraintStatus === 'over-defined' ? '⚠️' : constraintStatus === 'ok' ? '✓' : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Auto-solve toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 10, color: '#8b949e', fontWeight: 600 }}
                onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={autoSolve}
                  onChange={e => onAutoSolveChange?.(e.target.checked)}
                  style={{ accentColor: '#388bfd', cursor: 'pointer' }}
                />
                {t.autoSolve || 'Auto'}
              </label>
              {!autoSolve && (
                <button
                  onClick={e => { e.stopPropagation(); onSolveConstraints?.(); }}
                  style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #388bfd', background: '#0d1a2e', color: '#388bfd', fontWeight: 700, fontSize: 10, cursor: 'pointer' }}
                >
                  {t.solveConstraints || 'Solve'}
                </button>
              )}
              <span style={{ fontSize: 10, color: '#484f58' }}>{showConstraints ? '▲' : '▼'}</span>
            </div>
          </div>
          {showConstraints && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
              {constraints.map(c => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '3px 6px', borderRadius: 5, background: '#161b22',
                  border: `1px solid ${c.satisfied ? '#238636' : '#da3633'}`,
                }}>
                  <span style={{ fontSize: 10, color: c.satisfied ? '#3fb950' : '#f85149', fontWeight: 600 }}>
                    {c.satisfied ? '✓' : '✗'} {isKo
                      ? ({ horizontal: '수평', vertical: '수직', perpendicular: '직교', parallel: '평행', tangent: '접선', coincident: '일치', equal: '동일', symmetric: '대칭', midpoint: '중점', angle: '각도', fixed: '고정' } as Record<string, string>)[c.type] ?? c.type
                      : c.type}
                  </span>
                  {confirmRemoveConstraintId === c.id ? (
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button
                        onClick={() => setConfirmRemoveConstraintId(null)}
                        style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                      >
                        {isKo ? '취소' : 'No'}
                      </button>
                      <button
                        onClick={() => { onRemoveConstraint?.(c.id); setConfirmRemoveConstraintId(null); }}
                        style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                      >
                        {isKo ? '삭제' : 'Del'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemoveConstraintId(c.id)}
                      title={isKo ? '구속 조건 삭제' : 'Remove constraint'}
                      style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 11, padding: '0 3px' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#f85149')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Dimensions ── */}
      {dimensions.length > 0 && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Dimensions ({dimensions.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
            {dimensions.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '3px 6px', borderRadius: 5, background: '#161b22',
                border: '1px solid #30363d',
              }}>
                {dimEditId === d.id ? (
                  <input
                    autoFocus
                    value={dimEditValue}
                    onChange={e => setDimEditValue(e.target.value)}
                    onBlur={() => {
                      const v = parseFloat(dimEditValue);
                      if (!isNaN(v) && v > 0) onDimensionChange?.(d.id, v);
                      setDimEditId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const v = parseFloat(dimEditValue);
                        if (!isNaN(v) && v > 0) onDimensionChange?.(d.id, v);
                        setDimEditId(null);
                      }
                    }}
                    style={{ ...inputStyle, width: 70, padding: '1px 5px', fontSize: 10 }}
                  />
                ) : (
                  <span
                    onClick={() => { setDimEditId(d.id); setDimEditValue(String(d.value)); }}
                    style={{ fontSize: 10, color: '#c9d1d9', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {d.type}: {d.value.toFixed(1)} {d.type === 'angular' ? '°' : 'mm'}
                    {d.locked ? ' 🔒' : ''}
                  </span>
                )}
                {confirmRemoveDimensionId === d.id ? (
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button
                      onClick={() => setConfirmRemoveDimensionId(null)}
                      style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                    >
                      {isKo ? '취소' : 'No'}
                    </button>
                    <button
                      onClick={() => { onRemoveDimension?.(d.id); setConfirmRemoveDimensionId(null); }}
                      style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                    >
                      {isKo ? '삭제' : 'Del'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemoveDimensionId(d.id)}
                    title={isKo ? '치수 삭제' : 'Remove dimension'}
                    style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 11, padding: '0 3px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f85149')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 단계 전환 버튼 ── */}
      {sketchStep === 'draw' ? (
        <div style={{ ...sectionSep, paddingTop: 8 }}>
          <button
            onClick={() => onSketchStepChange?.('setup3d')}
            disabled={!canGenerate}
            style={{
              width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none',
              background: canGenerate
                ? 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)'
                : '#21262d',
              color: canGenerate ? '#fff' : '#484f58',
              fontWeight: 800, fontSize: 13, cursor: canGenerate ? 'pointer' : 'not-allowed',
              boxShadow: canGenerate ? '0 4px 16px rgba(56,139,253,0.3)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {isKo ? '3D 변환 설정 →' : 'Setup 3D →'}
          </button>
          {!canGenerate && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, padding: '6px 8px', borderRadius: 6, background: '#1c2233', border: '1px solid #30363d', marginTop: 5 }}>
              <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
              <p style={{ fontSize: 11, color: '#8b949e', margin: 0, lineHeight: 1.4 }}>
                {isKo
                  ? '스케치 선분을 연결하여 닫힌 프로파일을 만들어야 3D 변환이 활성화됩니다'
                  : 'Draw connected lines to close the profile — then 3D setup unlocks'}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...sectionSep, paddingTop: 8 }}>
          <button
            onClick={() => onSketchStepChange?.('draw')}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 7, marginBottom: 8,
              border: '1px solid #30363d', background: '#161b22',
              color: '#8b949e', fontWeight: 700, fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            ← {isKo ? '스케치 수정' : 'Edit Sketch'}
          </button>
        </div>
      )}

      {/* ── Extrude / Revolve / ExtrudeCut (setup3d 단계에서만) ── */}
      {sketchStep === 'setup3d' && (
      <div style={sectionSep}>
        {/* #wf8: default values hint */}
        <div style={{ background: 'rgba(56,139,253,0.06)', border: '1px solid rgba(56,139,253,0.2)', borderRadius: 6, padding: '5px 8px', marginBottom: 8, fontSize: 10, color: '#8b949e', lineHeight: 1.5 }}>
          {isKo
            ? '⬆ Extrude: 두께(Depth)를 지정해 돌출. ↻ Revolve: 회전각으로 원통형 생성. ▼ Cut: 기존 형상에서 잘라냄.'
            : '⬆ Extrude: pull sketch into a solid. ↻ Revolve: spin around axis. ▼ Cut: remove material from existing shape.'}
        </div>
        <div style={sectionTitle}>{t.sketchExtrude || 'Operation'}</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['extrude', 'revolve', 'extrudeCut'] as ExtrudeMode[]).map(mode => {
            const active = config.mode === mode;
            const labels: Record<ExtrudeMode, string> = {
              extrude: t.sketchExtrude || 'Extrude',
              revolve: t.sketchRevolve || 'Revolve',
              extrudeCut: t.sketchExtrudeCut || 'Cut',
            };
            const icons: Record<ExtrudeMode, string> = {
              extrude: '⬆',
              revolve: '↻',
              extrudeCut: '▼',
            };
            return (
              <button
                key={mode}
                onClick={() => onConfigChange({ ...config, mode })}
                style={{
                  flex: 1, padding: '5px 4px', borderRadius: 6,
                  border: active ? '2px solid #388bfd' : '1px solid #30363d',
                  background: active ? 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)' : '#161b22',
                  color: active ? '#fff' : '#8b949e', fontWeight: 700, fontSize: 10, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {icons[mode]} {labels[mode]}
              </button>
            );
          })}
        </div>

        {config.mode === 'extrude' && (
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>{t.sketchDepth || 'Depth'}</span>
            <input type="range" min={1} max={500} step={1} value={config.depth}
              onChange={e => onConfigChange({ ...config, depth: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{config.depth}</span>
          </div>
        )}

        {config.mode === 'extrudeCut' && (
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Cut Depth</span>
            <input type="range" min={1} max={500} step={1} value={config.cutDepth ?? config.depth}
              onChange={e => onConfigChange({ ...config, cutDepth: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{config.cutDepth ?? config.depth}</span>
          </div>
        )}

        {config.mode === 'revolve' && (
          <>
            <div style={sliderRowStyle}>
              <span style={sliderLabelStyle}>{t.sketchAngle || 'Angle'}</span>
              <input type="range" min={10} max={360} step={5} value={config.revolveAngle}
                onChange={e => onConfigChange({ ...config, revolveAngle: Number(e.target.value) })}
                style={sliderStyle} />
              <span style={sliderValueStyle}>{config.revolveAngle}°</span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {(['x', 'y'] as const).map(axis => {
                const active = config.revolveAxis === axis;
                return (
                  <button
                    key={axis}
                    onClick={() => onConfigChange({ ...config, revolveAxis: axis })}
                    style={{
                      flex: 1, padding: '4px 8px', borderRadius: 6,
                      border: active ? '2px solid #388bfd' : '1px solid #30363d',
                      background: active ? '#0d1117' : '#161b22',
                      color: active ? '#388bfd' : '#8b949e', fontWeight: 700, fontSize: 10, cursor: 'pointer',
                    }}
                  >
                    {axis.toUpperCase()} Axis
                  </button>
                );
              })}
            </div>
            <div style={sliderRowStyle}>
              <span style={sliderLabelStyle}>{t.sketchSegments || 'Segs'}</span>
              <input type="range" min={8} max={64} step={4} value={config.segments}
                onChange={e => onConfigChange({ ...config, segments: Number(e.target.value) })}
                style={sliderStyle} />
              <span style={sliderValueStyle}>{config.segments}</span>
            </div>
          </>
        )}
      </div>
      )} {/* end sketchStep === 'setup3d' extrude section */}

      {/* ── Actions (setup3d 단계에서만 Generate 버튼 표시) ── */}
      <div style={sectionSep}>
        {onToggleSketchHistory && (
          <button
            onClick={onToggleSketchHistory}
            style={{
              width: '100%', padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${showSketchHistory ? '#388bfd' : '#30363d'}`,
              background: showSketchHistory ? '#1a2332' : '#161b22',
              color: showSketchHistory ? '#388bfd' : '#8b949e',
              fontWeight: 700, fontSize: 10, cursor: 'pointer', transition: 'all 0.15s',
              marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span>🕐</span>
            {t.sketchHistory || 'Sketch History'}
            <span style={{ marginLeft: 'auto', fontSize: 9 }}>{showSketchHistory ? '▲' : '▼'}</span>
          </button>
        )}

        {sketchStep === 'setup3d' && (
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%', padding: '9px 14px', borderRadius: 8,
            border: editingFeatureId ? '2px solid #d29922' : 'none',
            background: canGenerate
              ? editingFeatureId
                ? 'linear-gradient(135deg, #d29922 0%, #b07d10 100%)'
                : 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)'
              : '#21262d',
            color: canGenerate ? '#fff' : '#484f58',
            fontWeight: 800, fontSize: 13, cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            boxShadow: canGenerate ? '0 4px 16px rgba(56,139,253,0.3)' : 'none',
            marginBottom: 5,
          }}
        >
          {editingFeatureId
            ? (t.updateFeature || 'Update Feature')
            : (t.sketchGenerate || 'Generate 3D')}
        </button>
        )}

        {confirmClear ? (
          <div style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #f85149', background: '#2d0e0e', marginBottom: 2 }}>
            <p style={{ fontSize: 11, color: '#f85149', fontWeight: 700, margin: '0 0 6px', textAlign: 'center' }}>
              {isKo ? '⚠️ 스케치 전체를 지우시겠습니까?' : '⚠️ Clear entire sketch?'}
            </p>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={() => setConfirmClear(false)}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #30363d', background: '#161b22', color: '#c9d1d9', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
              >
                {isKo ? '취소' : 'Cancel'}
              </button>
              <button
                onClick={() => { onClear(); setConfirmClear(false); }}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
              >
                {isKo ? '전체 삭제' : 'Clear All'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              onClick={onUndo}
              disabled={profile.segments.length === 0}
              title={profile.segments.length === 0 ? (isKo ? '되돌릴 선분이 없습니다' : 'Nothing to undo') : (isKo ? '마지막 선분 되돌리기 (Ctrl+Z)' : 'Undo last segment (Ctrl+Z)')}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6,
                border: '1px solid #30363d', background: '#161b22',
                color: profile.segments.length > 0 ? '#c9d1d9' : '#6e7681',
                fontWeight: 600, fontSize: 11,
                cursor: profile.segments.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              ↩ {t.sketchUndo || 'Undo'}
            </button>
            <button
              onClick={() => profile.segments.length > 0 && setConfirmClear(true)}
              disabled={profile.segments.length === 0}
              title={profile.segments.length === 0 ? (isKo ? '지울 스케치가 없습니다' : 'Nothing to clear') : (isKo ? '스케치 전체 지우기' : 'Clear all sketch segments')}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6,
                border: '1px solid #30363d', background: '#161b22',
                color: profile.segments.length > 0 ? '#f85149' : '#6e7681',
                fontWeight: 600, fontSize: 11,
                cursor: profile.segments.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              ✕ {t.sketchClear || 'Clear'}
            </button>
          </div>
        )}
      </div>

      {/* ── Add to Feature Tree ── */}
      {onAddSketchFeature && (
        <div style={{ ...sectionSep, borderColor: '#388bfd44' }}>
          <div style={{ ...sectionTitle, color: '#58a6ff' }}>
            {t.addToFeatureTree || 'Add to Feature Tree'}
          </div>

          {/* Plane selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
            {(['xy', 'xz', 'yz'] as const).map(p => (
              <button
                key={p}
                onClick={() => onSketchPlaneChange?.(p)}
                style={{
                  flex: 1, padding: '4px 6px', borderRadius: 5,
                  border: sketchPlane === p ? '2px solid #388bfd' : '1px solid #30363d',
                  background: sketchPlane === p ? '#0d1a2e' : '#161b22',
                  color: sketchPlane === p ? '#388bfd' : '#8b949e',
                  fontWeight: 700, fontSize: 10, cursor: 'pointer',
                }}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Plane offset */}
          <div style={{ ...sliderRowStyle, marginBottom: 5 }}>
            <span style={sliderLabelStyle}>Offset</span>
            <input type="range" min={-500} max={500} step={1} value={sketchPlaneOffset}
              onChange={e => onSketchPlaneOffsetChange?.(Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{sketchPlaneOffset}</span>
          </div>

          {/* Operation selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['add', 'subtract'] as const).map(op => {
              const active = sketchOperation === op;
              const labels: Record<'add' | 'subtract', string> = {
                add: t.sketchAdd || 'Add',
                subtract: t.sketchSubtract || 'Subtract',
              };
              const icons = { add: '+', subtract: '−' };
              return (
                <button
                  key={op}
                  onClick={() => onSketchOperationChange?.(op)}
                  style={{
                    flex: 1, padding: '5px 6px', borderRadius: 6,
                    border: active ? '2px solid #388bfd' : '1px solid #30363d',
                    background: active ? 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)' : '#161b22',
                    color: active ? '#fff' : '#8b949e', fontWeight: 700, fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {icons[op]} {labels[op]}
                </button>
              );
            })}
          </div>

          {/* Finish & Add button */}
          <button
            onClick={onAddSketchFeature}
            disabled={!canGenerate}
            style={{
              width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none',
              background: canGenerate
                ? 'linear-gradient(135deg, #3fb950 0%, #238636 100%)'
                : '#21262d',
              color: canGenerate ? '#fff' : '#484f58',
              fontWeight: 800, fontSize: 12, cursor: canGenerate ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canGenerate ? '0 4px 14px rgba(63,185,80,0.3)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 13 }}>✏️</span>
            {t.addToFeatureTree || 'Finish & Add to Feature Tree'}
          </button>
        </div>
      )}

      {/* ── Tips ── */}
      <div style={{ ...sectionSep, borderStyle: 'dashed' }}>
        <p style={{ fontSize: 10, color: '#6e7681', lineHeight: 1.4, margin: 0 }}>
          {t.sketchTip || 'Click to place points. Double-click or click first point to close. Ctrl+Z to undo.'}
        </p>
      </div>
    </div>
  );
}
