'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { FeatureType } from './features/types';
import type { EditMode } from './editing/types';

/* ── Export loading spinner (injected once) ─────────────────────────────── */
if (typeof document !== 'undefined') {
  const styleId = '__nexyfab_toolbar_spin';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      @keyframes __nf_spin { to { transform: rotate(360deg); } }
      .__nf_exporting { display:inline-block; animation: __nf_spin 1s linear infinite; }
    `;
    document.head.appendChild(s);
  }
}
import NotificationBell from './NotificationBell';

/* ─── Types ─────────────────────────────────────────────────────────────── */

type CommandTab = 'sketch' | 'features' | 'surface' | 'sheetmetal' | 'evaluate';

interface ToolBtn {
  id: string;
  icon: string;
  label: string;
  action: () => void;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  sub?: { id: string; icon: string; label: string; action: () => void }[];
  dataTour?: string;
}

interface CommandToolbarProps {
  activeTab: 'design' | 'optimize';
  isSketchMode: boolean;
  editMode: EditMode;
  hasResult: boolean;
  onSketchMode: (on: boolean) => void;
  onEditMode: (mode: EditMode) => void;
  onAddFeature: (type: FeatureType) => void;
  onSendToOptimizer: () => void;
  onExportSTL: () => void;
  onToggleChat: () => void;
  onUndo: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  showHistoryPanel?: boolean;
  onToggleHistory?: () => void;
  showChat: boolean;
  isOptimizing: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
  resultMesh: boolean;
  measureActive?: boolean;
  onToggleMeasure?: () => void;
  measureMode?: 'distance' | 'angle' | 'radius';
  onSetMeasureMode?: (mode: 'distance' | 'angle' | 'radius') => void;
  sectionActive?: boolean;
  onToggleSection?: () => void;
  onTogglePlanes?: () => void;
  showPlanes?: boolean;
  onImportFile?: () => void;
  onExportOBJ?: () => void;
  onExportPLY?: () => void;
  onExport3MF?: () => void;
  onExportSTEP?: () => void;
  onExportGLTF?: () => void;
  onExportDXF?: () => void;
  onExportFlatPatternDXF?: () => void;
  onSaveScene?: () => void;
  onLoadScene?: () => void;
  onExportGLB?: () => void;
  onExportRhino?: () => void;
  onExportGrasshopper?: () => void;
  dxfProjection?: 'xy' | 'xz' | 'yz';
  onDxfProjectionChange?: (axis: 'xy' | 'xz' | 'yz') => void;
  onMeshProcess?: (op: string) => void;
  onAnalysis?: (type: string) => void;
  onStandardParts?: () => void;
  onSheetMetal?: (op: string) => void;
  onExtraction?: (type: string) => void;
  onSketchTool?: (tool: string) => void;
  onConstraint?: (type: string) => void;
  onSmartDimension?: () => void;
  onExtrudeCut?: () => void;
  onHoleWizard?: () => void;
  showLibrary?: boolean;
  showValidation?: boolean;
  onTogglePlugins?: () => void;
  onToggleScript?: () => void;
  onExportDrawingPDF?: () => void;
  onShare?: () => void;
  onManufacturerMatch?: () => void;
  onBodyManager?: () => void;
  exportingFormat?: string | null;
  /** Called when user picks a CAM post-processor from the menu */
  onSetCamPost?: (id: string) => void;
  /** Current active CAM post-processor id — shown as a checkmark in the menu */
  activeCamPost?: string;
  /** Model Parameters panel toggle */
  showModelParams?: boolean;
  onToggleModelParams?: () => void;
  /** Number of DFM issues from last auto-analysis — shown as badge on DFM button */
  dfmIssueCount?: number;
  t: Record<string, string>;
  lang?: string;
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  tabBar: '#1b1f27',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  textDim: '#8b949e',
  hover: '#30363d',
  dropBg: '#21262d',
};

const S = {
  wrapper: {
    display: 'flex', flexDirection: 'column' as const, flexShrink: 0,
    background: C.bg, borderBottom: `1px solid ${C.border}`,
    userSelect: 'none' as const,
  } as React.CSSProperties,
  topRow: {
    display: 'flex', alignItems: 'center', gap: 0,
    background: C.tabBar, borderBottom: `1px solid ${C.border}`,
    padding: '0 8px', height: 34,
  } as React.CSSProperties,
  fileBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 12px', marginRight: 4, borderRadius: 4,
    border: 'none', background: 'transparent', color: C.text,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', height: 28,
    position: 'relative' as const,
  } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '6px 16px', border: 'none', borderRadius: 0,
    background: active ? C.bg : 'transparent',
    color: active ? '#fff' : C.textDim,
    fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
    borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
    transition: 'all 0.12s', height: '100%',
    display: 'flex', alignItems: 'center',
  }),
  strip: {
    display: 'flex', alignItems: 'flex-start', gap: 2, padding: '4px 8px',
    background: C.bg, overflowX: 'auto' as const, minHeight: 50,
  } as React.CSSProperties,
  toolBtn: (active?: boolean, disabled?: boolean) => ({
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'flex-start', gap: 1,
    width: 52, minWidth: 52, padding: '4px 3px 3px', borderRadius: 6,
    border: 'none', background: active ? C.accent : 'transparent',
    color: active ? '#fff' : disabled ? '#6e7681' : C.text,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 10, fontWeight: 600, transition: 'background 0.1s',
    opacity: disabled ? 0.5 : 1, position: 'relative' as const,
    lineHeight: 1.2,
  }),
  toolIcon: { fontSize: 18, lineHeight: 1, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 9, textAlign: 'center' as const, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 50 },
  sep: { width: 1, height: 38, background: C.border, margin: '3px 5px', flexShrink: 0 } as React.CSSProperties,
  dropdown: (top: number, left: number) => ({
    position: 'fixed' as const, top, left,
    background: C.dropBg, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: 4, zIndex: 9999, minWidth: 170,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  } as React.CSSProperties),
  dropItem: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '7px 12px', borderRadius: 5, border: 'none',
    background: 'transparent', color: C.text, cursor: 'pointer',
    fontSize: 12, fontWeight: 500, textAlign: 'left' as const,
    transition: 'background 0.08s',
  } as React.CSSProperties,
  rightActions: {
    display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
  } as React.CSSProperties,
  smallBtn: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', borderRadius: 5, border: 'none',
    background: active ? C.accent : 'transparent',
    color: active ? '#fff' : C.text,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    transition: 'background 0.1s',
  }),
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function ToolButton({ tool, openSub, onOpenSub, onClose }: {
  tool: ToolBtn; openSub: string | null;
  onOpenSub: (id: string) => void; onClose: () => void;
}) {
  const hasSub = tool.sub && tool.sub.length > 0;
  const isOpen = openSub === tool.id;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);

  const handleOpen = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const top = rect.bottom + 6;
    const left = rect.left + rect.width / 2 - 85; // 85 = half of minWidth 170
    setDropPos({ top, left: Math.max(8, left) });
    onOpenSub(tool.id);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        data-tour={tool.dataTour}
        style={S.toolBtn(tool.active, tool.disabled)}
        onClick={() => { if (tool.disabled) return; hasSub ? handleOpen() : (tool.action(), onClose()); }}
        onMouseEnter={e => { if (!tool.active && !tool.disabled) (e.currentTarget.style.background = C.hover); }}
        onMouseLeave={e => { if (!tool.active) (e.currentTarget.style.background = 'transparent'); }}
        title={tool.label}
      >
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <span style={S.toolIcon}>{tool.icon}</span>
          {tool.badge != null && tool.badge > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -7,
              minWidth: 14, height: 14, borderRadius: 7,
              background: '#f85149', color: '#fff',
              fontSize: 9, fontWeight: 800, lineHeight: '14px',
              textAlign: 'center', padding: '0 2px',
              pointerEvents: 'none',
            }}>
              {tool.badge > 99 ? '99+' : tool.badge}
            </span>
          )}
        </span>
        <span style={S.toolLabel}>{tool.label}{hasSub ? ' ▾' : ''}</span>
      </button>
      {hasSub && isOpen && dropPos && (
        <div style={S.dropdown(dropPos.top, dropPos.left)}>
          {tool.sub!.map(s => (
            <button key={s.id} style={S.dropItem}
              onClick={() => { s.action(); onClose(); }}
              onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Separator() { return <div style={S.sep} />; }

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function CommandToolbar(props: CommandToolbarProps) {
  const {
    activeTab, isSketchMode, editMode, hasResult,
    onSketchMode, onEditMode, onAddFeature,
    onSendToOptimizer, onExportSTL, onToggleChat, onUndo,
    showChat, isOptimizing, onGenerate, canGenerate, resultMesh,
    measureActive, onToggleMeasure, measureMode, onSetMeasureMode, sectionActive, onToggleSection,
    onTogglePlanes, showPlanes,
    onImportFile, onExportOBJ, onExportPLY, onExport3MF, onExportSTEP, onExportGLTF,
    onExportDXF, onExportFlatPatternDXF, dxfProjection, onDxfProjectionChange,
    onSaveScene, onLoadScene, onExportGLB,
    onExportRhino, onExportGrasshopper,
    onMeshProcess, onAnalysis, onStandardParts,
    onSheetMetal, onExtraction,
    onSketchTool, onConstraint, onSmartDimension,
    onExtrudeCut, onHoleWizard,
    onTogglePlugins,
    onToggleScript,
    onExportDrawingPDF,
    onShare,
    onManufacturerMatch,
    onBodyManager,
    exportingFormat,
    onSetCamPost,
    activeCamPost,
    onRedo, canUndo, canRedo, showHistoryPanel, onToggleHistory,
    showModelParams, onToggleModelParams,
    dfmIssueCount,
    t,
    lang,
  } = props;

  const [commandTab, setCommandTab] = useState<CommandTab>('features');
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isKo = !!(t.chatExample1 && /[가-힣]/.test(t.chatExample1));

  // Auto-switch to sketch tab when sketch mode activated
  useEffect(() => {
    if (isSketchMode) setCommandTab('sketch');
  }, [isSketchMode]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!openSub && !fileOpen) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpenSub(null); setFileOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openSub, fileOpen]);

  const toggleSub = (id: string) => { setOpenSub(prev => prev === id ? null : id); setFileOpen(false); };
  const closeSub = () => { setOpenSub(null); setFileOpen(false); };

  /* ── Optimize tab ── */
  if (activeTab === 'optimize') {
    return (
      <div ref={wrapRef} style={{ ...S.strip, borderBottom: `1px solid ${C.border}` }}>
        <ToolButton tool={{ id: 'gen', icon: isOptimizing ? '⏳' : '▶', label: isKo ? '최적화 실행' : 'Generate', action: onGenerate, disabled: !canGenerate || isOptimizing }} openSub={null} onOpenSub={() => {}} onClose={() => {}} />
        <Separator />
        <ToolButton tool={{ id: 'expStl', icon: '💾', label: isKo ? 'STL 내보내기' : 'Export STL', action: onExportSTL, disabled: !resultMesh }} openSub={null} onOpenSub={() => {}} onClose={() => {}} />
        <div style={{ flex: 1 }} />
        <button style={S.smallBtn(showChat)} onClick={onToggleChat}>🤖 AI Chat</button>
      </div>
    );
  }

  /* ── Tab definitions ── */
  const tabs: { key: CommandTab; label: string }[] = [
    { key: 'sketch', label: isKo ? '스케치' : 'Sketch' },
    { key: 'features', label: isKo ? '피처' : 'Features' },
    { key: 'surface', label: isKo ? '서피스' : 'Surface' },
    { key: 'sheetmetal', label: isKo ? '판금' : 'Sheet Metal' },
    { key: 'evaluate', label: isKo ? '평가' : 'Evaluate' },
  ];

  /* ── Tool groups per tab ── */
  const sketchTools: (ToolBtn | 'sep')[] = [
    { id: 'sk-line', icon: '╱', label: isKo ? '선' : 'Line', action: () => { onSketchMode(true); onSketchTool?.('line'); } },
    { id: 'sk-arc', icon: '◠', label: isKo ? '호' : 'Arc', action: () => { onSketchMode(true); onSketchTool?.('arc'); } },
    { id: 'sk-circle', icon: '○', label: isKo ? '원' : 'Circle', action: () => { onSketchMode(true); onSketchTool?.('circle'); } },
    { id: 'sk-rect', icon: '▭', label: isKo ? '사각형' : 'Rect', action: () => { onSketchMode(true); onSketchTool?.('rectangle'); } },
    { id: 'sk-polygon', icon: '⬡', label: isKo ? '다각형' : 'Polygon', action: () => { onSketchMode(true); onSketchTool?.('polygon'); } },
    'sep',
    { id: 'sk-offset', icon: '⧈', label: isKo ? '오프셋' : 'Offset', action: () => { onSketchMode(true); onSketchTool?.('offset'); } },
    { id: 'sk-trim', icon: '✂', label: isKo ? '트림' : 'Trim', action: () => { onSketchMode(true); onSketchTool?.('trim'); } },
    'sep',
    { id: 'sk-constraint', icon: '🔗', label: isKo ? '구속' : 'Constrain', action: () => {},
      sub: [
        { id: 'c-horiz', icon: '─', label: isKo ? '수평' : 'Horizontal', action: () => onConstraint?.('horizontal') },
        { id: 'c-vert', icon: '│', label: isKo ? '수직' : 'Vertical', action: () => onConstraint?.('vertical') },
        { id: 'c-perp', icon: '⊥', label: isKo ? '직교' : 'Perpendicular', action: () => onConstraint?.('perpendicular') },
        { id: 'c-par', icon: '∥', label: isKo ? '평행' : 'Parallel', action: () => onConstraint?.('parallel') },
        { id: 'c-tang', icon: '⌒', label: isKo ? '접선' : 'Tangent', action: () => onConstraint?.('tangent') },
        { id: 'c-coinc', icon: '●', label: isKo ? '일치' : 'Coincident', action: () => onConstraint?.('coincident') },
        { id: 'c-equal', icon: '=', label: isKo ? '동일' : 'Equal', action: () => onConstraint?.('equal') },
      ],
    },
    { id: 'sk-dim', icon: '📏', label: isKo ? '스마트 치수' : 'Dimension', action: () => onSmartDimension?.() },
  ];

  const featureTools: (ToolBtn | 'sep')[] = [
    { id: 'ft-extrude', icon: '⬆', label: isKo ? '돌출 보스' : 'Extrude', action: () => onAddFeature('boolean'), active: false },
    { id: 'ft-extcut', icon: '⬇', label: isKo ? '돌출 컷' : 'Ext. Cut', action: () => onExtrudeCut?.() },
    { id: 'ft-revolve', icon: '🔄', label: isKo ? '회전' : 'Revolve', action: () => onAddFeature('revolve') },
    { id: 'ft-sweep', icon: '〰️', label: isKo ? '스윕' : 'Sweep', action: () => onAddFeature('sweep') },
    { id: 'ft-loft', icon: '◈', label: isKo ? '로프트' : 'Loft', action: () => onAddFeature('loft') },
    'sep',
    { id: 'ft-fillet', icon: '◠', label: isKo ? '필렛' : 'Fillet', action: () => onAddFeature('fillet') },
    { id: 'ft-chamfer', icon: '⬠', label: isKo ? '챔퍼' : 'Chamfer', action: () => onAddFeature('chamfer') },
    { id: 'ft-shell', icon: '▢', label: isKo ? '쉘' : 'Shell', action: () => onAddFeature('shell') },
    { id: 'ft-draft', icon: '📐', label: isKo ? '구배' : 'Draft', action: () => onAddFeature('draft') },
    'sep',
    { id: 'ft-hole', icon: '◎', label: isKo ? '홀 위저드' : 'Hole Wiz.', action: () => onHoleWizard?.() ?? onAddFeature('hole') },
    { id: 'ft-thread', icon: '🔩', label: isKo ? '나사' : 'Thread', action: () => onAddFeature('thread') },
    { id: 'ft-boolean', icon: '⊕', label: isKo ? '불리안' : 'Boolean', action: () => onAddFeature('boolean') },
    'sep',
    { id: 'ft-pattern', icon: '⫼', label: isKo ? '패턴' : 'Pattern', action: () => {},
      sub: [
        { id: 'p-lin', icon: '⫼', label: isKo ? '직선 패턴' : 'Linear Pattern', action: () => onAddFeature('linearPattern') },
        { id: 'p-cir', icon: '◔', label: isKo ? '원형 패턴' : 'Circular Pattern', action: () => onAddFeature('circularPattern') },
      ],
    },
    { id: 'ft-mirror', icon: '⬌', label: isKo ? '대칭' : 'Mirror', action: () => onAddFeature('mirror') },
    { id: 'ft-split', icon: '✂', label: isKo ? '분할' : 'Split', action: () => onAddFeature('splitBody') },
    { id: 'ft-mold', icon: '🏭', label: isKo ? '금형' : 'Mold Tools', action: () => {},
      sub: [
        { id: 'm-draft', icon: '📐', label: isKo ? '구배 분석' : 'Draft Analysis', action: () => onAddFeature('moldTools') },
        { id: 'm-cavity', icon: '⬛', label: isKo ? '캐비티' : 'Cavity', action: () => onAddFeature('moldTools') },
        { id: 'm-core', icon: '⬜', label: isKo ? '코어' : 'Core', action: () => onAddFeature('moldTools') },
      ],
    },
    'sep',
    { id: 'ft-weld', icon: '🔧', label: isKo ? '용접 부재' : 'Weldment', action: () => {},
      sub: [
        { id: 'w-recttube', icon: '▭', label: isKo ? '사각관' : 'Rect Tube', action: () => onAddFeature('weldment') },
        { id: 'w-ibeam', icon: 'Ι', label: isKo ? 'I 빔' : 'I-Beam', action: () => onAddFeature('weldment') },
        { id: 'w-angle', icon: 'L', label: isKo ? '앵글' : 'Angle', action: () => onAddFeature('weldment') },
        { id: 'w-roundtube', icon: '○', label: isKo ? '원형관' : 'Round Tube', action: () => onAddFeature('weldment') },
      ]
    },
    'sep',
    { id: 'ft-array', icon: '⊞', label: isKo ? '배열' : 'Array', action: () => onAnalysis?.('array'), disabled: !hasResult },
  ];

  const surfaceTools: (ToolBtn | 'sep')[] = [
    { id: 'sf-auto', icon: '🌐', label: isKo ? '자동 서피스' : 'Auto Surf.', action: () => onExtraction?.('autoSurface') },
    { id: 'sf-cross', icon: '🔪', label: isKo ? '단면' : 'Cross Sec.', action: () => onExtraction?.('crossSection') },
    'sep',
    { id: 'sf-repair', icon: '🔧', label: isKo ? '수리' : 'Repair', action: () => onMeshProcess?.('repair'), disabled: !hasResult },
    { id: 'sf-smooth', icon: '✨', label: isKo ? '스무딩' : 'Smooth', action: () => onMeshProcess?.('smooth'), disabled: !hasResult },
    { id: 'sf-simplify', icon: '📉', label: isKo ? '단순화' : 'Simplify', action: () => onMeshProcess?.('simplify'), disabled: !hasResult },
    { id: 'sf-fill', icon: '🕳️', label: isKo ? '홀 채우기' : 'Fill Holes', action: () => onMeshProcess?.('fillHoles'), disabled: !hasResult },
    { id: 'sf-flip', icon: '↕', label: isKo ? '노말 뒤집기' : 'Flip Norm.', action: () => onMeshProcess?.('flipNormals'), disabled: !hasResult },
    { id: 'sf-spike', icon: '📌', label: isKo ? '스파이크 제거' : 'Rm Spikes', action: () => onMeshProcess?.('removeSpikes'), disabled: !hasResult },
    'sep',
    { id: 'sf-remesh', icon: '🔄', label: isKo ? '리메시' : 'Remesh', action: () => onMeshProcess?.('remesh'), disabled: !hasResult },
    { id: 'sf-noise', icon: '🔇', label: isKo ? '노이즈 감소' : 'Denoise', action: () => onMeshProcess?.('reduceNoise'), disabled: !hasResult },
    { id: 'sf-detach', icon: '✂️', label: isKo ? '분리 제거' : 'Rm Detach.', action: () => onMeshProcess?.('detached'), disabled: !hasResult },
  ];

  const sheetMetalTools: (ToolBtn | 'sep')[] = [
    { id: 'sm-box', icon: '📦', label: isKo ? '판금 박스' : 'Box', action: () => onSheetMetal?.('box') },
    { id: 'sm-bend', icon: '↩', label: isKo ? '벤드' : 'Bend', action: () => onSheetMetal?.('bend') },
    { id: 'sm-flange', icon: '⌐', label: isKo ? '플랜지' : 'Flange', action: () => onSheetMetal?.('flange') },
    { id: 'sm-hem', icon: '↰', label: isKo ? '헴' : 'Hem', action: () => onSheetMetal?.('hem') },
    'sep',
    { id: 'sm-unfold', icon: '📐', label: isKo ? '전개' : 'Unfold', action: () => onSheetMetal?.('unfold') },
  ];

  const evaluateTools: (ToolBtn | 'sep')[] = [
    { id: 'ev-valid', icon: '✅', label: isKo ? '형상 검증' : 'Validate', action: () => onAnalysis?.('validation'), disabled: !hasResult },
    { id: 'ev-dev', icon: '📏', label: isKo ? '편차 분석' : 'Deviation', action: () => onAnalysis?.('deviation'), disabled: !hasResult },
    'sep',
    { id: 'ev-measure', icon: '📐', label: isKo ? '측정' : 'Measure', action: () => onToggleMeasure?.(), active: measureActive },
    { id: 'ev-measure-dist', icon: '↔', label: isKo ? '거리' : 'Distance', action: () => { if (!measureActive) onToggleMeasure?.(); onSetMeasureMode?.('distance'); }, active: measureActive && measureMode === 'distance', disabled: false },
    { id: 'ev-measure-angle', icon: '∠', label: isKo ? '각도' : 'Angle', action: () => { if (!measureActive) onToggleMeasure?.(); onSetMeasureMode?.('angle'); }, active: measureActive && measureMode === 'angle', disabled: false },
    { id: 'ev-measure-radius', icon: 'R', label: isKo ? '반지름' : 'Radius', action: () => { if (!measureActive) onToggleMeasure?.(); onSetMeasureMode?.('radius'); }, active: measureActive && measureMode === 'radius', disabled: false },
    { id: 'ev-section', icon: '🔪', label: isKo ? '단면 분석' : 'Section', action: () => onToggleSection?.(), active: sectionActive },
    { id: 'ev-planes', icon: '◫', label: isKo ? '기준 평면' : 'Planes', action: () => onTogglePlanes?.(), active: showPlanes },
    'sep',
    { id: 'ev-prim', icon: '🔍', label: isKo ? '프리미티브 감지' : 'Primitives', action: () => onExtraction?.('primitives'), disabled: !hasResult },
    { id: 'ev-extr', icon: '⬆', label: isKo ? '돌출 감지' : 'Extrusions', action: () => onExtraction?.('extrusions'), disabled: !hasResult },
    'sep',
    { id: 'ev-print', icon: '🖨', label: isKo ? '3D 프린팅 분석' : '3D Print', action: () => onAnalysis?.('printability'), disabled: !hasResult, dataTour: 'ev-print-btn' },
    { id: 'ev-fea', icon: '🔬', label: isKo ? '응력 해석' : 'FEA', action: () => onAnalysis?.('fea'), disabled: !hasResult },
    { id: 'ev-thermal', icon: '🌡️', label: isKo ? '열해석' : 'Thermal', action: () => onAnalysis?.('thermal'), disabled: !hasResult },
    { id: 'ev-ecad', icon: '🔌', label: isKo ? 'PCB 열매핑' : 'PCB Thermal', action: () => onAnalysis?.('ecad'), disabled: !hasResult },
    { id: 'ev-cam', icon: '⚙️', label: isKo ? 'CAM 경로' : 'CAM Path', action: () => onAnalysis?.('cam'), disabled: !hasResult },
    { id: 'ev-cam-post-linuxcnc', icon: activeCamPost === 'linuxcnc' ? '✅' : '🔧', label: isKo ? '포스트: LinuxCNC' : 'Post: LinuxCNC', action: () => { try { localStorage.setItem('nexyfab.cam.post', 'linuxcnc'); } catch {} onSetCamPost?.('linuxcnc'); } },
    { id: 'ev-cam-post-fanuc', icon: activeCamPost === 'fanuc' ? '✅' : '🔧', label: isKo ? '포스트: Fanuc' : 'Post: Fanuc', action: () => { try { localStorage.setItem('nexyfab.cam.post', 'fanuc'); } catch {} onSetCamPost?.('fanuc'); } },
    { id: 'ev-cam-post-mazak', icon: activeCamPost === 'mazak' ? '✅' : '🔧', label: isKo ? '포스트: Mazak' : 'Post: Mazak', action: () => { try { localStorage.setItem('nexyfab.cam.post', 'mazak'); } catch {} onSetCamPost?.('mazak'); } },
    { id: 'ev-cam-post-haas', icon: activeCamPost === 'haas' ? '✅' : '🔧', label: isKo ? '포스트: Haas' : 'Post: Haas', action: () => { try { localStorage.setItem('nexyfab.cam.post', 'haas'); } catch {} onSetCamPost?.('haas'); } },
    { id: 'ev-dfm', icon: '🏭', label: isKo ? '제조 가능성 분석' : 'DFM Analysis', action: () => onAnalysis?.('dfm'), disabled: !hasResult, badge: dfmIssueCount && dfmIssueCount > 0 ? dfmIssueCount : undefined },
    'sep',
    { id: 'ev-mass', icon: '\u2696', label: isKo ? '질량 특성' : 'Mass Props', action: () => onAnalysis?.('massProperties'), disabled: !hasResult },
    'sep',
    { id: 'ev-gdt', icon: '⊕', label: isKo ? 'GD&T 공차' : 'GD&T', action: () => onAnalysis?.('gdt'), disabled: !hasResult },
    'sep',
    { id: 'ev-model-params', icon: '⚙️', label: isKo ? '모델 파라미터' : 'Parameters', action: () => onToggleModelParams?.(), active: showModelParams },
    { id: 'ev-history', icon: '🕐', label: isKo ? '히스토리' : 'History', action: () => onToggleHistory?.(), active: showHistoryPanel },
    'sep',
    { id: 'ev-dim-advisor', icon: '🤖', label: isKo ? 'AI 치수 추천' : 'AI Suggest', action: () => onAnalysis?.('dimensionAdvisor') },
    'sep',
    { id: 'ev-gendesign', icon: '✨', label: isKo ? '생성형 설계' : 'Gen. Design', action: () => onAnalysis?.('generativeDesign'), disabled: !hasResult },
    'sep',
    { id: 'ev-motion', icon: '🎬', label: isKo ? '동작 해석' : 'Motion Study', action: () => onAnalysis?.('motionStudy') },
    { id: 'ev-modal', icon: '📊', label: isKo ? '고유진동수' : 'Modal Analysis', action: () => onAnalysis?.('modalAnalysis'), disabled: !hasResult },
    { id: 'ev-sweep', icon: '📈', label: isKo ? '매개변수 탐색' : 'Param Sweep', action: () => onAnalysis?.('parametricSweep'), disabled: !hasResult },
    { id: 'ev-tolerance', icon: '📐', label: isKo ? '공차 누적' : 'Tolerance', action: () => onAnalysis?.('toleranceStackup') },
    { id: 'ev-surface', icon: '🔍', label: isKo ? '곡률 분석' : 'Surface Quality', action: () => onAnalysis?.('surfaceQuality'), disabled: !hasResult },
    { id: 'ev-drawing', icon: '📄', label: isKo ? '자동 도면' : 'Auto Drawing', action: () => onAnalysis?.('autoDrawing'), disabled: !hasResult },
    'sep',
    { id: 'ev-mfg', icon: '🏭', label: isKo ? '제조 파이프라인' : 'Mfg Pipeline', action: () => onAnalysis?.('mfgPipeline'), disabled: !hasResult },
  ];

  const toolMap: Record<CommandTab, (ToolBtn | 'sep')[]> = {
    sketch: sketchTools,
    features: featureTools,
    surface: surfaceTools,
    sheetmetal: sheetMetalTools,
    evaluate: evaluateTools,
  };

  const currentTools = toolMap[commandTab];

  return (
    <div ref={wrapRef} style={S.wrapper}>
      {/* ── Tab Bar ── */}
      <div style={S.topRow}>
        {/* File button (always visible, far left) */}
        <div style={{ position: 'relative', marginRight: 6 }}>
          <button style={{
            ...S.fileBtn,
            background: fileOpen ? C.hover : 'transparent',
          }}
            onClick={() => { setFileOpen(p => !p); setOpenSub(null); }}
          >
            📁 {isKo ? '파일' : 'File'} ▾
          </button>
          {fileOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: C.dropBg, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: 4, zIndex: 9999, minWidth: 200,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
              <button style={S.dropItem} onClick={() => { onImportFile?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📂</span>
                <span>{isKo ? '파일 불러오기' : 'Import'} (STEP/STL/OBJ/PLY/DXF)</span>
              </button>
              {/* Recent Files */}
              {(() => {
                try {
                  const recent = JSON.parse(localStorage.getItem('nf_recent_files') || '[]');
                  if (recent.length === 0) return null;
                  return (
                    <>
                      <div style={{ padding: '6px 12px 3px', fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {isKo ? '최근 파일' : 'Recent Files'}
                        <span
                          title={isKo ? '최근 파일 목록은 참고용입니다. 다시 불러오려면 위의 Import를 사용하세요.' : 'Recent file history (read-only). Use Import above to re-open a file.'}
                          style={{ cursor: 'help', fontSize: 10, color: '#484f58', border: '1px solid #484f58', borderRadius: '50%', width: 13, height: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}
                        >?</span>
                      </div>
                      {recent.slice(0, 5).map((f: { name: string; ext: string; date: number }, i: number) => (
                        <div
                          key={i}
                          title={isKo ? `최근 파일: ${f.name}\n다시 불러오려면 Import 버튼을 사용하세요` : `Recent: ${f.name}\nUse Import to re-open`}
                          style={{ ...S.dropItem, opacity: 0.55, fontSize: 11, cursor: 'default', pointerEvents: 'none', fontStyle: 'italic' } as React.CSSProperties}
                        >
                          <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>🕐</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                          <span style={{ fontSize: 9, color: '#484f58', flexShrink: 0, marginLeft: 4 }}>
                            {new Date(f.date).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </>
                  );
                } catch { return null; }
              })()}
              <div style={{ height: 1, background: C.border, margin: '3px 8px' }} />
              {!hasResult && (
                <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#6e7681', fontStyle: 'italic' }}>
                  {isKo ? '형상을 생성한 후 내보낼 수 있습니다' : 'Generate a shape to enable export'}
                </div>
              )}
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportSTL(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>Export STL</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportOBJ?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>Export OBJ</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportPLY?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>Export PLY</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExport3MF?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🖨️</span>
                <span>{isKo ? '3MF 내보내기 (3D 프린터)' : 'Export 3MF (3D print)'}</span>
              </button>
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'STEP') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'STEP'} onClick={() => { onExportSTEP?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'STEP' ? <span className="__nf_exporting">⟳</span> : '💾'}</span>
                <span>{exportingFormat === 'STEP' ? (isKo ? 'STEP 변환 중...' : 'Exporting STEP...') : (isKo ? 'STEP 내보내기' : 'Export STEP')}</span>
              </button>
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'GLTF') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'GLTF'} onClick={() => { onExportGLTF?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'GLTF' ? <span className="__nf_exporting">⟳</span> : '💾'}</span>
                <span>{exportingFormat === 'GLTF' ? (isKo ? 'GLTF 변환 중...' : 'Exporting GLTF...') : (isKo ? 'GLTF (GLB) 내보내기' : 'Export GLTF (GLB)')}</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportGLB?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📦</span>
                <span>{isKo ? '씬 GLB 내보내기' : 'Export Scene GLB'}</span>
              </button>
              <div style={{ height: 1, background: C.border, margin: '3px 8px' }} />
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'Rhino') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'Rhino'} onClick={() => { onExportRhino?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'Rhino' ? <span className="__nf_exporting">⟳</span> : '🦏'}</span>
                <span>{exportingFormat === 'Rhino' ? (isKo ? 'Rhino 변환 중...' : 'Exporting Rhino...') : (t.exportRhino ?? (isKo ? 'Rhino JSON 내보내기' : 'Export Rhino JSON'))}</span>
              </button>
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'Grasshopper') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'Grasshopper'} onClick={() => { onExportGrasshopper?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'Grasshopper' ? <span className="__nf_exporting">⟳</span> : '🌿'}</span>
                <span>{exportingFormat === 'Grasshopper' ? (isKo ? 'Grasshopper 변환 중...' : 'Exporting GH...') : (t.exportGrasshopper ?? (isKo ? 'Grasshopper 포인트 내보내기' : 'Export Grasshopper Points'))}</span>
              </button>
              <div style={{ height: 1, background: C.border, margin: '3px 8px' }} />
              <button style={S.dropItem} onClick={() => { onSaveScene?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>{isKo ? '씬 저장 (.nexyfab)' : 'Save Scene (.nexyfab)'}</span>
              </button>
              <button style={S.dropItem} onClick={() => { onLoadScene?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📂</span>
                <span>{isKo ? '씬 불러오기 (.nexyfab)' : 'Load Scene (.nexyfab)'}</span>
              </button>
              <div style={{ height: 1, background: C.border, margin: '3px 8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
                <button style={{ ...S.dropItem, opacity: exportingFormat === 'DXF' ? 0.6 : 1 }} disabled={exportingFormat === 'DXF'} onClick={() => { onExportDXF?.(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'DXF' ? <span className="__nf_exporting">⟳</span> : '📐'}</span>
                  <span>{exportingFormat === 'DXF' ? (isKo ? 'DXF 변환 중...' : 'Exporting DXF...') : (isKo ? 'DXF 내보내기' : 'Export DXF')}</span>
                </button>
                <button style={S.dropItem} onClick={() => { onExportFlatPatternDXF?.(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📏</span>
                  <span>{isKo ? '전개도 DXF (판금·레이저)' : 'Flat Pattern DXF (sheet metal)'}</span>
                </button>
                <select
                  value={dxfProjection ?? 'xy'}
                  onChange={e => onDxfProjectionChange?.(e.target.value as 'xy' | 'xz' | 'yz')}
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: '#0d1117', color: C.text, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer',
                    marginLeft: 'auto',
                  }}
                >
                  <option value="xy">XY</option>
                  <option value="xz">XZ</option>
                  <option value="yz">YZ</option>
                </select>
              </div>
              <button style={{ ...S.dropItem, opacity: exportingFormat === 'PDF' ? 0.6 : 1 }} disabled={exportingFormat === 'PDF'} onClick={() => { onExportDrawingPDF?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'PDF' ? <span className="__nf_exporting">⟳</span> : '📄'}</span>
                <span>{exportingFormat === 'PDF' ? (isKo ? 'PDF 변환 중...' : 'Exporting PDF...') : (isKo ? 'PDF 도면 내보내기' : 'PDF Drawing')}</span>
              </button>
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: C.border, marginRight: 4 }} />

        {/* Tabs */}
        {tabs.map(tab => (
          <button key={tab.key} style={S.tab(commandTab === tab.key)}
            onClick={() => { setCommandTab(tab.key); closeSub(); }}
            onMouseEnter={e => { if (commandTab !== tab.key) e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { if (commandTab !== tab.key) e.currentTarget.style.color = C.textDim; }}
            title={tab.key === 'sketch' ? (isKo ? '스케치 모드 (단축키: S)' : 'Sketch mode (shortcut: S)') : undefined}
          >
            {tab.label}
            {tab.key === 'sketch' && (
              <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.45, fontFamily: 'monospace', letterSpacing: 0 }}>S</span>
            )}
          </button>
        ))}

        {/* Right side: Undo, Redo, History, Optimize, AI Chat */}
        <div style={S.rightActions}>
          <button
            style={{ ...S.smallBtn(false), opacity: canUndo === false ? 0.4 : 1 }}
            onClick={onUndo}
            disabled={canUndo === false}
            title={isKo ? '실행 취소 (Ctrl+Z)' : 'Undo (Ctrl+Z)'}
          >
            ← {isKo ? '취소' : 'Undo'}
          </button>
          <button
            style={{ ...S.smallBtn(false), opacity: canRedo === false ? 0.4 : 1 }}
            onClick={onRedo}
            disabled={canRedo === false}
            title={isKo ? '다시 실행 (Ctrl+Y)' : 'Redo (Ctrl+Y)'}
          >
            → {isKo ? '재실행' : 'Redo'}
          </button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
          <button style={S.smallBtn(!!showHistoryPanel)} onClick={() => onToggleHistory?.()} title={isKo ? '명령 히스토리' : 'Command History'}>
            🕐 {isKo ? '히스토리' : 'History'}
          </button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
          <button style={S.smallBtn(false)} onClick={onSendToOptimizer}
            title={isKo ? '위상 최적화' : 'Topology optimization'}>
            🔬 {isKo ? '최적화' : 'Optimize'}
          </button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
          <button style={S.smallBtn(false)} onClick={() => { onTogglePlugins?.(); closeSub(); }}>
            🧩 {isKo ? '플러그인' : 'Plugins'}
          </button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
          <button style={S.smallBtn(false)} onClick={() => { onToggleScript?.(); closeSub(); }}
            title={isKo ? 'NexyScript 코드 편집기' : 'NexyScript Editor'}>
            {'</>'}  {isKo ? '스크립트' : 'Script'}
          </button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
          <button style={S.smallBtn(showChat)} onClick={() => { onToggleChat(); closeSub(); }}>
            🤖 AI Chat
          </button>
          {onShare && (
            <>
              <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
              <button style={S.smallBtn(false)} onClick={() => { onShare(); closeSub(); }}
                title={t.shareDesign ?? 'Share design'}>
                🔗 {t.shareLink ?? 'Share'}
              </button>
            </>
          )}
          {onManufacturerMatch && (
            <>
              <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
              <button style={S.smallBtn(false)} onClick={() => { onManufacturerMatch(); closeSub(); }}
                title={isKo ? '재질·형상 기반 제조사 매칭' : 'Match manufacturers to your part'}>
                🏭 {isKo ? '제조사 매칭' : 'Manufacturer Match'}
              </button>
            </>
          )}
          {onBodyManager && (
            <>
              <div style={{ width: 1, height: 20, background: C.border, margin: '0 2px' }} />
              <button style={S.smallBtn(false)} onClick={() => { onBodyManager(); closeSub(); }}
                title={isKo ? '바디 분리·합체 관리' : 'Split and merge bodies'}>
                ⬡ {isKo ? '바디 관리' : 'Bodies'}
              </button>
            </>
          )}
          {/* Notification bell — spacer then bell */}
          <div style={{ flex: 1 }} />
          {lang && <NotificationBell lang={lang} />}
        </div>
      </div>

      {/* ── Tool Strip ── */}
      <div style={S.strip}>
        {currentTools.map((item, i) => {
          if (item === 'sep') return <Separator key={`sep-${i}`} />;
          return (
            <ToolButton key={item.id} tool={item}
              openSub={openSub} onOpenSub={toggleSub} onClose={closeSub} />
          );
        })}
      </div>
    </div>
  );
}
