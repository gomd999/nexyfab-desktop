'use client';

import React from 'react';
import { useSceneStore } from '../store/sceneStore';
import { useUIStore } from '../store/uiStore';
import { useTheme } from '../ThemeContext';
import { SHAPES, type ShapeConfig, type ShapeResult } from '../shapes';
import type { SketchProfile, SketchConfig, SketchTool } from '../sketch/types';
import type { SketchHistoryEntry } from '../sketch/SketchHistory';
import type { ExprVariable } from '../ExpressionEngine';
import FeatureTree from '../FeatureTree';
import SketchPanel from '../sketch/SketchPanel';
import MaterialPicker from '../MaterialPicker';
import RenderPanel, { type RenderSettings } from '../rendering/RenderPanel';
import ConditionPanel from '../topology/ConditionPanel';
import type { BomPartResult } from '../ShapePreview';
import type { Face, OptResult } from '../topology/optimizer/types';
import type { FeatureHistory } from '../useFeatureStack';
import type { FeatureInstance, FeatureType } from '../features/types';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import ExpressionInput from '../ExpressionInput';
import CotsSizePreset from '../CotsSizePreset';
import SectionPropertiesPanel from '../SectionPropertiesPanel';
import type { DFMParamWarning } from '../analysis/dfmParamMapper';

const SketchHistoryPanel = dynamic(() => import('../sketch/SketchHistoryPanel'), { ssr: false });

// ─── Constants ────────────────────────────────────────────────────────────────

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', sphere: '🔮', cone: '🔺', torus: '🍩', wedge: '🔻',
  pipe: '🔧', lBracket: '📐', flange: '⚙️', plateBend: '🔨',
  gear: '⚙️', fanBlade: '🌀', sprocket: '🔗', pulley: '🎡',
  sweep: '🔀', loft: '🔄',
  bolt: '🔩', spring: '🌀', tSlot: '⊓',
  hexNut: '⬡', washer: '⭕', iBeam: 'Ⅰ', bearing: '⊚',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeftPanelProps {
  // i18n
  lang: string;
  t: Record<string, string>;
  gt: Record<string, string>;

  // Responsive
  isMobile: boolean;
  isTablet: boolean;

  // Computed shape lists
  tier1: ShapeConfig[];
  tier2: ShapeConfig[];

  // Effective result (sketchResult || parametric result)
  effectiveResult: ShapeResult | null;

  // Feature tree
  featureHistory: FeatureHistory | null;
  features: FeatureInstance[];
  rollbackTo: (id: string) => void;
  startEditing: (id: string) => void;
  finishEditing: () => void;
  toggleExpanded: (id: string) => void;
  toggleFeature: (id: string) => void;
  removeNode: (id: string) => void;
  updateFeatureParam: (id: string, key: string, value: number) => void;
  addFeature: (type: FeatureType) => void;
  moveFeatureByIds?: (fromId: string, toId: string) => void;

  // Sketch local state
  sketchProfiles: SketchProfile[];
  activeProfileIdx: number;
  sketchOperation: 'add' | 'subtract';
  sketchPlaneOffset: number;
  showSketchHistory: boolean;
  editingSketchFeatureId: string | null;
  sketchHistory: SketchHistoryEntry[];

  // Sketch handlers
  onSketchModeStart: () => void;
  onSketchViewModeChange: (mode: '2d' | '3d' | 'drawing') => void;
  onSketchPlaneChange: (p: 'xy' | 'xz' | 'yz') => void;
  onSketchOperationChange: (op: 'add' | 'subtract') => void;
  onSketchPlaneOffsetChange: (v: number) => void;
  onToggleSketchHistory: () => void;
  onLoadSketchFromHistory: (entry: SketchHistoryEntry) => void;
  onDeleteSketchHistoryEntry: (id: string) => void;
  onSketchClear: () => void;
  onSketchUndo: () => void;
  onSketchGenerate: () => void;
  sketchStep?: 'draw' | 'setup3d';
  onSketchStepChange?: (step: 'draw' | 'setup3d') => void;
  onSetActiveProfile: (idx: number) => void;
  onAddHoleProfile: () => void;
  onDeleteProfile: (idx: number) => void;
  onAddSketchFeature: () => void;
  onEditSketchFeature: (featureId: string) => void;

  // Constraint status
  constraintStatus?: 'ok' | 'over-defined' | 'under-defined' | 'inconsistent';
  constraintDiagnostic?: {
    dof?: number;
    residual?: number;
    message?: string;
    unsatisfiedCount?: number;
  };

  // Shape / param handlers
  onSelectShape: (s: ShapeConfig) => void;
  onParamChange: (key: string, value: number) => void;
  onExpressionChange: (key: string, expr: string) => void;
  onParamCommit: () => void;
  onShapeReset: () => void;
  /** Formula text values for shapes with formulaFields */
  formulaValues?: Record<string, string>;
  onFormulaChange?: (key: string, value: string) => void;
  /** User-defined model variables available in expression formulas */
  modelVars?: ExprVariable[];

  // BOM export
  bomParts: BomPartResult[];
  bomLabel: string;
  showBomExportMenu: boolean;
  onToggleBomExportMenu: () => void;
  onExportBomCSV: () => void;
  onExportBomExcel: () => void;

  // Cart items count (for BOM visibility check)
  cartItemsCount: number;

  // Imported file info
  importedFilename: string | null;

  // Render panel
  renderSettings: RenderSettings;
  onRenderSettingsChange: (s: RenderSettings) => void;
  onRenderCapture: () => void;

  // Optimize tab props
  customDomainGeometry: THREE.BufferGeometry | null;
  /** DFM 경고 맵: paramKey → warning. 슬라이더 레이블 옆 인라인 배지에 사용 */
  dfmParamWarnings?: Record<string, DFMParamWarning>;
  useCustomDomain: boolean;
  onUseCustomDomainChange: (v: boolean) => void;
  dimX: number;
  dimY: number;
  dimZ: number;
  onDimChange: (key: 'dimX' | 'dimY' | 'dimZ', value: number) => void;
  materialKey: string;
  onMaterialKeyChange: (k: string) => void;
  fixedFaces: Face[];
  loads: Array<{ face: Face; force: [number, number, number] }>;
  selectionMode: 'none' | 'fixed' | 'load';
  onSelectionModeChange: (mode: 'none' | 'fixed' | 'load') => void;
  onRemoveFixed: (face: Face) => void;
  onRemoveLoad: (face: Face) => void;
  activeLoadForce: [number, number, number];
  onActiveLoadForceChange: (force: [number, number, number]) => void;
  volfrac: number;
  onVolfracChange: (v: number) => void;
  resolution: 'low' | 'medium' | 'high';
  onResolutionChange: (r: 'low' | 'medium' | 'high') => void;
  penal: number;
  onPenalChange: (v: number) => void;
  rmin: number;
  onRminChange: (v: number) => void;
  maxIter: number;
  onMaxIterChange: (v: number) => void;
  isOptimizing: boolean;
  onGenerate: () => void;
  onOptReset: () => void;
  optResult: OptResult | null;
  resultMesh: boolean;
  weightInfo: { originalWeight: number; optimizedWeight: number; reduction: number } | null;
  convergenceChart: React.ReactNode | null;
  onExportOptSTL: () => void;
  onSendOptToQuote: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

function LeftPanel({
  lang,
  t,
  gt,
  isMobile,
  isTablet,
  tier1,
  tier2,
  effectiveResult,
  featureHistory,
  features,
  rollbackTo,
  startEditing,
  finishEditing,
  toggleExpanded,
  toggleFeature,
  removeNode,
  updateFeatureParam,
  addFeature,
  moveFeatureByIds,
  sketchProfiles,
  activeProfileIdx,
  sketchOperation,
  sketchPlaneOffset,
  showSketchHistory,
  editingSketchFeatureId,
  sketchHistory,
  onSketchModeStart,
  onSketchViewModeChange,
  onSketchPlaneChange,
  onSketchOperationChange,
  onSketchPlaneOffsetChange,
  onToggleSketchHistory,
  onLoadSketchFromHistory,
  onDeleteSketchHistoryEntry,
  onSketchClear,
  onSketchUndo,
  onSketchGenerate,
  sketchStep,
  onSketchStepChange,
  onSetActiveProfile,
  onAddHoleProfile,
  onDeleteProfile,
  onAddSketchFeature,
  onEditSketchFeature,
  constraintStatus,
  constraintDiagnostic,
  onSelectShape,
  onParamChange,
  onExpressionChange,
  onParamCommit,
  onShapeReset,
  formulaValues,
  onFormulaChange,
  bomParts,
  bomLabel,
  showBomExportMenu,
  onToggleBomExportMenu,
  onExportBomCSV,
  onExportBomExcel,
  cartItemsCount,
  importedFilename,
  renderSettings,
  onRenderSettingsChange,
  onRenderCapture,
  customDomainGeometry,
  dfmParamWarnings,
  useCustomDomain,
  onUseCustomDomainChange,
  dimX,
  dimY,
  dimZ,
  onDimChange,
  materialKey,
  onMaterialKeyChange,
  fixedFaces,
  loads,
  selectionMode,
  onSelectionModeChange,
  onRemoveFixed,
  onRemoveLoad,
  activeLoadForce,
  onActiveLoadForceChange,
  volfrac,
  onVolfracChange,
  resolution,
  onResolutionChange,
  penal,
  onPenalChange,
  rmin,
  onRminChange,
  maxIter,
  onMaxIterChange,
  isOptimizing,
  onGenerate,
  onOptReset,
  optResult,
  resultMesh,
  weightInfo,
  convergenceChart,
  onExportOptSTL,
  onSendOptToQuote,
  modelVars,
}: LeftPanelProps) {
  // Read from stores directly
  const { theme } = useTheme();
  const activeTab = useUIStore(s => s.activeTab);
  const tabletLeftOpen = useUIStore(s => s.tabletLeftOpen);

  const selectedId = useSceneStore(s => s.selectedId);
  const params = useSceneStore(s => s.params);
  const paramExpressions = useSceneStore(s => s.paramExpressions);
  const materialId = useSceneStore(s => s.materialId);

  // Formula mode toggle per param key
  const [formulaMode, setFormulaMode] = React.useState<Set<string>>(new Set());
  const setMaterialId = useSceneStore(s => s.setMaterialId);
  const isSketchMode = useSceneStore(s => s.isSketchMode);
  const sketchViewMode = useSceneStore(s => s.sketchViewMode);
  const sketchPlane = useSceneStore(s => s.sketchPlane);
  const sketchProfile = useSceneStore(s => s.sketchProfile);
  const sketchConfig = useSceneStore(s => s.sketchConfig);
  const setSketchConfig = useSceneStore(s => s.setSketchConfig);
  const sketchTool = useSceneStore(s => s.sketchTool);
  const setSketchTool = useSceneStore(s => s.setSketchTool);
  const renderMode = useSceneStore(s => s.renderMode);

  // Derived
  const shape = SHAPES.find(s => s.id === selectedId)!;

  // ── Shape search + favorites + recent ───────────────────────────────────────
  const [shapeSearch, setShapeSearch] = React.useState('');
  const [shapeFavorites, setShapeFavorites] = React.useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nf_shape_favorites') || '[]'); } catch { return []; }
  });
  const [recentShapes, setRecentShapes] = React.useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nf_shape_recent') || '[]'); } catch { return []; }
  });

  const toggleFavorite = React.useCallback((id: string) => {
    setShapeFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev];
      try { localStorage.setItem('nf_shape_favorites', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const trackRecentShape = React.useCallback((id: string) => {
    setRecentShapes(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, 6);
      try { localStorage.setItem('nf_shape_recent', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Accordion state ──────────────────────────────────────────────────────────
  const [sections, setSections] = React.useState({
    tree: true,
    props: true,
    geometry: false,
    bom: false,
  });
  const toggleSection = (key: keyof typeof sections) =>
    setSections(s => ({ ...s, [key]: !s[key] }));

  // Auto-expand props panel when entering sketch mode
  React.useEffect(() => {
    if (isSketchMode) setSections(s => s.props ? s : { ...s, props: true });
  }, [isSketchMode]);

  // ── Accordion header helper ──────────────────────────────────────────────────
  const SectionHeader = ({ label, sKey, extra }: { label: string; sKey: keyof typeof sections; extra?: React.ReactNode }) => (
    <div
      onClick={() => toggleSection(sKey)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', padding: '5px 0', marginBottom: sections[sKey] ? 6 : 0,
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {extra}
        <span style={{ color: '#484f58', fontSize: 10 }}>{sections[sKey] ? '▲' : '▼'}</span>
      </div>
    </div>
  );

  return (
    <div style={{
      width: isTablet ? 240 : 260,
      flexShrink: 0,
      background: theme.panelBg,
      borderRight: `1px solid ${theme.border}`,
      display: isMobile ? 'none' : (isTablet && !tabletLeftOpen) ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      ...(isTablet ? { position: 'absolute' as const, top: 44, left: 0, bottom: 0, zIndex: 50, boxShadow: '4px 0 20px rgba(0,0,0,0.3)' } : {}),
    }}>
      <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>

        {activeTab === 'design' ? (
          <>
            {/* ── FeatureManager Design Tree ── */}
            {!isSketchMode && (
              <div data-tour="feature-tree" style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <SectionHeader
                  label={lang === 'ko' ? '디자인 트리' : 'Design Tree'}
                  sKey="tree"
                  extra={
                    <button
                      data-tour="sketch-btn"
                      onClick={e => { e.stopPropagation(); onSketchModeStart(); }}
                      title={lang === 'ko' ? '스케치 시작' : 'New Sketch'}
                      style={{
                        padding: '1px 6px', borderRadius: 4, border: '1px solid #30363d',
                        background: '#0d1117', color: '#8b949e', fontSize: 9, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      ✏️
                    </button>
                  }
                />
                {sections.tree && (
                  <>
                    {/* Base shape header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 6, background: '#0d1117', border: '1px solid #30363d', marginBottom: 4 }}>
                      <span style={{ fontSize: 12 }}>{SHAPE_ICONS[selectedId] || '🧊'}</span>
                      <span
                        style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                        title={t[`shapeName_${selectedId}`] || selectedId}
                      >{t[`shapeName_${selectedId}`] || selectedId}</span>
                      <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>{effectiveResult ? `${effectiveResult.bbox.w.toFixed(0)}×${effectiveResult.bbox.h.toFixed(0)}×${effectiveResult.bbox.d.toFixed(0)}` : ''}</span>
                    </div>
                    {/* History-based Feature Tree */}
                    {featureHistory && (
                      <FeatureTree history={featureHistory} onRollbackTo={rollbackTo} onStartEditing={startEditing} onFinishEditing={finishEditing} onToggleExpanded={toggleExpanded} onToggleEnabled={toggleFeature} onRemoveNode={removeNode} onUpdateParam={updateFeatureParam} onAddFeature={addFeature} onEditSketch={onEditSketchFeature} onMoveFeature={moveFeatureByIds} t={t as any} />
                    )}
                    {!featureHistory?.nodes?.length && features.length === 0 && (
                      <div style={{ padding: '8px 0 2px', fontSize: 10, color: '#484f58', textAlign: 'center' }}>
                        {lang === 'ko' ? '피처 탭에서 피처를 추가하세요' : 'Add features from the Features tab'}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── PropertyManager ── */}
            <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
              <SectionHeader
                label={isSketchMode ? (lang === 'ko' ? '스케치 속성' : 'Sketch') : (lang === 'ko' ? '속성' : 'Properties')}
                sKey="props"
              />

              {sections.props && (
                isSketchMode ? (
                  <>
                    {/* 2D / 3D / Drawing mode toggle */}
                    <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                      {([['2d', '2D'], ['3d', '3D'], ['drawing', (t as any).drawingView || '2D Drawing']] as const).map(([mode, label]) => (
                        <button key={mode} onClick={() => onSketchViewModeChange(mode)}
                          style={{
                            flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            border: sketchViewMode === mode ? '2px solid #388bfd' : '1px solid #30363d',
                            background: sketchViewMode === mode ? '#388bfd22' : '#0d1117',
                            color: sketchViewMode === mode ? '#388bfd' : '#8b949e',
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>

                    <div style={{ position: 'relative' }}>
                      {showSketchHistory && (
                        <SketchHistoryPanel
                          entries={sketchHistory}
                          onLoad={onLoadSketchFromHistory}
                          onDelete={onDeleteSketchHistoryEntry}
                          onClose={() => onToggleSketchHistory()}
                          t={t as any}
                        />
                      )}
                      <div data-tour="sketch-toolbox" style={{ display: 'contents' }}>
                      <SketchPanel
                        profile={sketchProfile} config={sketchConfig}
                        onConfigChange={setSketchConfig} activeTool={sketchTool}
                        onToolChange={setSketchTool} onClear={onSketchClear}
                        onUndo={onSketchUndo} onGenerate={onSketchGenerate}
                        canGenerate={sketchProfiles[0]?.closed && sketchProfiles[0]?.segments.length >= 3}
                        sketchStep={sketchStep}
                        onSketchStepChange={onSketchStepChange}
                        t={t as any}
                        multiSketch={{ profiles: sketchProfiles, activeProfileIndex: activeProfileIdx }}
                        onSetActiveProfile={onSetActiveProfile}
                        onAddHoleProfile={onAddHoleProfile}
                        onDeleteProfile={onDeleteProfile}
                        sketchPlane={sketchPlane as 'xy' | 'xz' | 'yz'}
                        onSketchPlaneChange={onSketchPlaneChange}
                        sketchPlaneOffset={sketchPlaneOffset}
                        onSketchPlaneOffsetChange={onSketchPlaneOffsetChange}
                        sketchOperation={sketchOperation}
                        onSketchOperationChange={onSketchOperationChange}
                        onAddSketchFeature={onAddSketchFeature}
                        showSketchHistory={showSketchHistory}
                        onToggleSketchHistory={sketchHistory.length >= 2 ? onToggleSketchHistory : undefined}
                        editingFeatureId={editingSketchFeatureId}
                        constraintStatus={constraintStatus}
                        constraintDiagnostic={constraintDiagnostic}
                        isKo={lang === 'ko'}
                      />
                      </div>{/* /sketch-toolbox */}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Shape selector — search + favorites + recent + grid */}
                    <div data-tour="shape-selector">
                      {/* Search bar */}
                      <div style={{ position: 'relative', marginBottom: 6 }}>
                        <svg style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                          type="text"
                          value={shapeSearch}
                          onChange={e => setShapeSearch(e.target.value)}
                          placeholder={lang === 'ko' ? 'shape 검색...' : 'Search shapes...'}
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
                            color: '#c9d1d9', fontSize: 11, padding: '5px 8px 5px 22px',
                            outline: 'none',
                          }}
                        />
                        {shapeSearch && (
                          <button onClick={() => setShapeSearch('')} style={{
                            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0,
                          }}>✕</button>
                        )}
                      </div>

                      {/* Favorites row */}
                      {!shapeSearch && shapeFavorites.length > 0 && (
                        <div style={{ marginBottom: 5 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                            {lang === 'ko' ? '즐겨찾기' : 'Favorites'}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                            {shapeFavorites.map(id => {
                              const s = [...tier1, ...tier2].find(x => x.id === id);
                              if (!s) return null;
                              const active = s.id === selectedId;
                              return (
                                <button key={s.id}
                                  onClick={() => { onSelectShape(s); trackRecentShape(s.id); }}
                                  title={t[`shapeName_${s.id}`] || s.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '5px 0', borderRadius: 6, fontSize: 16,
                                    border: active ? '2px solid #f59e0b' : '1px solid #78350f44',
                                    background: active ? '#f59e0b22' : '#0d1117',
                                    cursor: 'pointer', transition: 'all 0.12s',
                                  }}
                                >{SHAPE_ICONS[s.id] || s.icon}</button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Recent row */}
                      {!shapeSearch && recentShapes.length > 0 && (
                        <div style={{ marginBottom: 5 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                            {lang === 'ko' ? '최근 사용' : 'Recent'}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                            {recentShapes.map(id => {
                              const s = [...tier1, ...tier2].find(x => x.id === id);
                              if (!s) return null;
                              const active = s.id === selectedId;
                              return (
                                <button key={s.id}
                                  onClick={() => { onSelectShape(s); trackRecentShape(s.id); }}
                                  title={t[`shapeName_${s.id}`] || s.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '5px 0', borderRadius: 6, fontSize: 16,
                                    border: active ? '2px solid #388bfd' : '1px solid #30363d',
                                    background: active ? '#388bfd22' : '#0d1117',
                                    cursor: 'pointer', transition: 'all 0.12s',
                                  }}
                                >{SHAPE_ICONS[s.id] || s.icon}</button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* All shapes grid (filtered by search) */}
                      {(() => {
                        const allShapes = [...tier1, ...tier2];
                        const filtered = shapeSearch
                          ? allShapes.filter(s =>
                              (t[`shapeName_${s.id}`] || s.id).toLowerCase().includes(shapeSearch.toLowerCase()) ||
                              s.id.toLowerCase().includes(shapeSearch.toLowerCase())
                            )
                          : allShapes;
                        return (
                          <div style={{ marginBottom: 4 }}>
                            {!shapeSearch && (
                              <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                                {lang === 'ko' ? '전체' : 'All'}
                              </div>
                            )}
                            {filtered.length === 0 ? (
                              <div style={{ fontSize: 11, color: '#484f58', textAlign: 'center', padding: '8px 0' }}>
                                {lang === 'ko' ? '결과 없음' : 'No results'}
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                                {filtered.map(s => {
                                  const active = s.id === selectedId;
                                  const isFav = shapeFavorites.includes(s.id);
                                  return (
                                    <div key={s.id} style={{ position: 'relative' }}>
                                      <button
                                        onClick={() => { onSelectShape(s); trackRecentShape(s.id); }}
                                        title={t[`shapeName_${s.id}`] || s.id}
                                        style={{
                                          width: '100%',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          padding: '5px 0', borderRadius: 6, fontSize: 16,
                                          border: active ? '2px solid #388bfd' : '1px solid #30363d',
                                          background: active ? '#388bfd22' : '#0d1117',
                                          cursor: 'pointer', transition: 'all 0.12s',
                                        }}
                                      >{SHAPE_ICONS[s.id] || s.icon}</button>
                                      {/* Star button */}
                                      <button
                                        onClick={e => { e.stopPropagation(); toggleFavorite(s.id); }}
                                        title={isFav ? (lang === 'ko' ? '즐겨찾기 제거' : 'Remove favorite') : (lang === 'ko' ? '즐겨찾기 추가' : 'Add favorite')}
                                        style={{
                                          position: 'absolute', top: 1, right: 1,
                                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                          fontSize: 8, lineHeight: 1, opacity: isFav ? 1 : 0,
                                          color: isFav ? '#f59e0b' : '#6b7280',
                                          transition: 'opacity 0.15s',
                                        }}
                                        className="shape-star-btn"
                                      >★</button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* ── Material — inline under shape selector ── */}
                    {effectiveResult ? (
                      <div data-tour="material-picker" style={{ borderTop: '1px solid #30363d', paddingTop: 6, marginBottom: 6 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          {lang === 'ko' ? '재질' : 'Material'}
                        </div>
                        <MaterialPicker selectedId={materialId} onSelect={setMaterialId} lang={lang} />
                      </div>
                    ) : (
                      <div style={{ borderTop: '1px solid #21262d', paddingTop: 6, marginBottom: 6, fontSize: 10, color: '#484f58', textAlign: 'center', fontStyle: 'italic' }}>
                        {lang === 'ko' ? '형상을 먼저 생성하면 재질을 선택할 수 있습니다' : 'Generate a shape to select material'}
                      </div>
                    )}

                    {/* COTS 표준 사이즈 프리셋 (hexNut / washer / bearing) */}
                    <CotsSizePreset
                      shapeId={selectedId}
                      isKo={lang === 'ko'}
                      onSelect={(preset) => {
                        Object.entries(preset).forEach(([key, val]) => onParamChange(key, val));
                      }}
                    />

                    {/* Parameters — compact single-row: label | slider | number | fx */}
                    <div data-tour="param-panel">
                      {shape.params.map(sp => {
                        const label = t[sp.labelKey] || sp.key;
                        const val = params[sp.key] ?? sp.default;
                        const isFx = formulaMode.has(sp.key);
                        const expr = paramExpressions[sp.key] ?? String(val);
                        const allVars: ExprVariable[] = [
                          ...Object.entries(params)
                            .filter(([k]) => k !== sp.key)
                            .map(([name, value]) => ({ name, value })),
                          ...(modelVars ?? []),
                        ];

                        const dfmWarn = dfmParamWarnings?.[sp.key];
                        const warnColor = dfmWarn?.severity === 'error' ? '#f85149'
                          : dfmWarn?.severity === 'warning' ? '#d29922'
                          : dfmWarn?.severity === 'info' ? '#79c0ff'
                          : undefined;

                        return (
                          <div key={sp.key} style={{ marginBottom: 3 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 40px 20px', alignItems: 'center', gap: 4 }}>
                              <label
                                style={{ fontSize: 10, fontWeight: 600, color: warnColor ?? '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={dfmWarn ? `DFM: ${dfmWarn.message}` : label}
                              >
                                {dfmWarn && (
                                  <span style={{ marginRight: 2, fontSize: 9 }}>
                                    {dfmWarn.severity === 'error' ? '🔴' : dfmWarn.severity === 'warning' ? '🟡' : '🔵'}
                                  </span>
                                )}
                                {label}
                              </label>
                              {isFx ? (
                                <ExpressionInput
                                  expression={expr}
                                  variables={allVars}
                                  onValueChange={(v) => onParamChange(sp.key, v)}
                                  onExpressionChange={(e) => onExpressionChange(sp.key, e)}
                                  onCommit={onParamCommit}
                                  min={sp.min} max={sp.max} step={sp.step}
                                  unit={sp.unit ?? ''}
                                  expressionLabel={label}
                                />
                              ) : (
                                <>
                                  <input
                                    type="range"
                                    min={sp.min} max={sp.max} step={sp.step}
                                    value={val}
                                    onChange={e => onParamChange(sp.key, parseFloat(e.target.value))}
                                    onTouchEnd={onParamCommit}
                                    onMouseDown={e => { e.currentTarget.style.accentColor = '#818cf8'; e.currentTarget.style.height = '5px'; }}
                                    onMouseUp={e => { e.currentTarget.style.accentColor = '#6366f1'; e.currentTarget.style.height = '3px'; onParamCommit(); }}
                                    onMouseLeave={e => { if (e.buttons === 0) { e.currentTarget.style.accentColor = '#6366f1'; e.currentTarget.style.height = '3px'; } }}
                                    style={{ width: '100%', accentColor: '#6366f1', height: 3, borderRadius: 2, cursor: 'pointer', transition: 'height 0.1s' }}
                                  />
                                  <input
                                    type="number"
                                    value={val}
                                    step={sp.step}
                                    onChange={e => onParamChange(sp.key, parseFloat(e.target.value))}
                                    onBlur={onParamCommit}
                                    style={{
                                      width: 40, padding: '1px 4px', borderRadius: 3,
                                      border: '1px solid #30363d', background: '#0d1117',
                                      color: '#c9d1d9', fontSize: 10, textAlign: 'right',
                                      fontFamily: 'monospace',
                                    }}
                                  />
                                </>
                              )}
                              {/* fx toggle */}
                              <button
                                title={isFx
                                  ? (lang === 'ko' ? '슬라이더로 전환 (수식 모드 끄기)' : 'Back to slider (exit formula mode)')
                                  : (lang === 'ko' ? '수식 입력 모드로 전환 (예: sin(x)*10)' : 'Switch to formula mode (e.g. sin(x)*10)')}
                                aria-label={isFx ? 'Exit formula mode' : 'Enter formula mode'}
                                onClick={() => setFormulaMode(prev => {
                                  const next = new Set(prev);
                                  if (next.has(sp.key)) next.delete(sp.key); else next.add(sp.key);
                                  return next;
                                })}
                                style={{
                                  padding: '0 3px', height: 18, minWidth: 20,
                                  borderRadius: 3,
                                  border: isFx ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent',
                                  background: isFx ? 'rgba(99,102,241,0.3)' : 'transparent',
                                  color: isFx ? '#818cf8' : '#6e7681',
                                  fontSize: 9, fontWeight: 800, cursor: 'pointer',
                                  lineHeight: 1, fontFamily: 'monospace',
                                  transition: 'all 0.12s',
                                }}
                                onMouseEnter={e => { if (!isFx) { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#30363d'; } }}
                                onMouseLeave={e => { if (!isFx) { e.currentTarget.style.color = '#6e7681'; e.currentTarget.style.borderColor = 'transparent'; } }}
                              >
                                fx
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* ── Formula fields (text input for function-driven shapes) ── */}
                      {shape.formulaFields && shape.formulaFields.length > 0 && (
                        <div style={{ marginTop: 6, borderTop: '1px solid #21262d', paddingTop: 6 }}>
                          {shape.formulaFields.map(ff => {
                            const label = t[ff.labelKey] || ff.key;
                            const currentVal = formulaValues?.[ff.key] ?? ff.default;
                            return (
                              <div key={ff.key} style={{ marginBottom: 6 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', marginBottom: 3, fontFamily: 'monospace' }}>
                                  ∿ {label}
                                </div>
                                <textarea
                                  value={currentVal}
                                  onChange={e => onFormulaChange?.(ff.key, e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onParamCommit(); } }}
                                  placeholder={ff.placeholder ?? ff.default}
                                  spellCheck={false}
                                  rows={2}
                                  style={{
                                    width: '100%',
                                    padding: '5px 7px',
                                    borderRadius: 5,
                                    border: '1px solid #3b4048',
                                    background: '#0d1117',
                                    color: '#79c0ff',
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    lineHeight: 1.4,
                                    resize: 'vertical',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                  }}
                                />
                                {ff.hint && (
                                  <div style={{ fontSize: 9, color: '#484f58', marginTop: 2, lineHeight: 1.4 }}>
                                    {ff.hint}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={onShapeReset}
                        style={{ width: '100%', padding: '4px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#8b949e', fontSize: 10, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}
                      >
                        {t.resetParams}
                      </button>

                      {/* 단면 물성 패널 */}
                      <div style={{ marginTop: 8, borderTop: '1px solid #21262d', paddingTop: 6 }}>
                        <SectionPropertiesPanel
                          shapeId={selectedId}
                          params={params}
                          isKo={lang === 'ko'}
                        />
                      </div>
                    </div>
                  </>
                )
              )}
            </div>


            {/* ── Render Settings Panel ── */}
            {renderMode === 'photorealistic' && (
              <RenderPanel
                settings={renderSettings}
                onChange={onRenderSettingsChange}
                onCapture={onRenderCapture}
                lang={lang}
              />
            )}

            {/* ── Geometry info ── */}
            {effectiveResult && (
              <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <SectionHeader label={lang === 'ko' ? '형상 정보' : 'Geometry'} sKey="geometry" />
                {sections.geometry && (
                  <div style={{ fontSize: 10, color: '#c9d1d9', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span><span style={{ color: '#9ca3af' }}>Vol </span><b>{effectiveResult.volume_cm3.toFixed(2)}</b> cm³</span>
                      <span><span style={{ color: '#9ca3af' }}>Surf </span><b>{effectiveResult.surface_area_cm2.toFixed(2)}</b> cm²</span>
                    </div>
                    <div><span style={{ color: '#9ca3af' }}>Size </span><b style={{ color: '#58a6ff' }}>{effectiveResult.bbox.w.toFixed(1)}×{effectiveResult.bbox.h.toFixed(1)}×{effectiveResult.bbox.d.toFixed(1)} mm</b></div>
                  </div>
                )}
              </div>
            )}

            {/* ── Export BOM — only show when cart has items ── */}
            {(bomParts.length > 0 || cartItemsCount > 0) && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={onToggleBomExportMenu}
                  aria-expanded={showBomExportMenu}
                  aria-haspopup="true"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #30363d', background: '#21262d', color: '#c9d1d9', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.background = '#30363d'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.background = '#21262d'; }}
                >
                  <span style={{ fontSize: 13 }}>📋</span>
                  {(t as any).exportBom || 'Export BOM'}
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: '#6e7681' }}>{showBomExportMenu ? '▲' : '▼'}</span>
                </button>
                {showBomExportMenu && (
                  // #7: Escape to close + role=menu for keyboard nav
                  <div
                    role="menu"
                    onKeyDown={e => { if (e.key === 'Escape') onToggleBomExportMenu(); }}
                    style={{ display: 'flex', gap: 6, marginTop: 4 }}
                  >
                    <button
                      role="menuitem"
                      onClick={onExportBomCSV}
                      autoFocus
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#3fb950', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' }}
                      onKeyDown={e => { if (e.key === 'Escape') onToggleBomExportMenu(); }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#0d2818'; e.currentTarget.style.borderColor = '#3fb950'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#0d1117'; e.currentTarget.style.borderColor = '#30363d'; }}
                    >CSV</button>
                    <button
                      role="menuitem"
                      onClick={onExportBomExcel}
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#58a6ff', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' }}
                      onKeyDown={e => { if (e.key === 'Escape') onToggleBomExportMenu(); }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a2332'; e.currentTarget.style.borderColor = '#58a6ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#0d1117'; e.currentTarget.style.borderColor = '#30363d'; }}
                    >Excel</button>
                  </div>
                )}
              </div>
            )}

            {/* ── Imported file info ── */}
            {importedFilename && (
              <div style={{ background: '#0d1117', borderRadius: 8, border: '1px solid #1f6feb', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  {lang === 'ko' ? '임포트된 파일' : 'Imported File'}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#79c0ff' }}>{importedFilename}</div>
              </div>
            )}
          </>
        ) : (
          /* ── OPTIMIZE TAB LEFT ── */
          <>
            {customDomainGeometry && (
              <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Domain</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[['Box', false], ['Custom', true]].map(([label, val]) => (
                    <button key={String(label)} onClick={() => onUseCustomDomainChange(val as boolean)} style={{
                      flex: 1, padding: '5px', borderRadius: 6, border: useCustomDomain === val ? '2px solid #388bfd' : '1px solid #30363d',
                      background: useCustomDomain === val ? '#388bfd22' : '#0d1117', fontSize: 11, fontWeight: 700,
                      color: useCustomDomain === val ? '#388bfd' : '#8b949e', cursor: 'pointer',
                    }}>{label as string}</button>
                  ))}
                </div>
              </div>
            )}
            <ConditionPanel
              dimX={dimX} dimY={dimY} dimZ={dimZ} onDimChange={onDimChange}
              materialKey={materialKey} onMaterialChange={onMaterialKeyChange}
              fixedFaces={fixedFaces} loads={loads}
              selectionMode={selectionMode} onSelectionModeChange={onSelectionModeChange}
              onRemoveFixed={onRemoveFixed} onRemoveLoad={onRemoveLoad}
              activeLoadForce={activeLoadForce} onActiveLoadForceChange={onActiveLoadForceChange}
              volfrac={volfrac} onVolfracChange={onVolfracChange}
              resolution={resolution} onResolutionChange={onResolutionChange}
              penal={penal} onPenalChange={onPenalChange}
              rmin={rmin} onRminChange={onRminChange}
              maxIter={maxIter} onMaxIterChange={onMaxIterChange}
              isOptimizing={isOptimizing} onGenerate={onGenerate} onReset={onOptReset}
              t={gt}
            />
            {optResult && !isOptimizing && (
              <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Results</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, marginBottom: 8 }}>
                  <div><span style={{ color: '#9ca3af' }}>Iter:</span> <b>{optResult.iterations}</b></div>
                  <div><span style={{ color: '#9ca3af' }}>Vol:</span> <b>{(optResult.finalVolumeFraction * 100).toFixed(1)}%</b></div>
                </div>
                {weightInfo && (
                  <div style={{ background: '#0d1117', borderRadius: 6, padding: 8, fontSize: 11, border: '1px solid #30363d', color: '#c9d1d9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b949e' }}>Original</span><b>{weightInfo.originalWeight.toFixed(3)} kg</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b949e' }}>Optimized</span><b>{weightInfo.optimizedWeight.toFixed(3)} kg</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3fb950', fontWeight: 800, borderTop: '1px solid #30363d', paddingTop: 4, marginTop: 4 }}><span>Reduction</span><span>-{weightInfo.reduction.toFixed(1)}%</span></div>
                  </div>
                )}
                {convergenceChart && <div style={{ marginTop: 8 }}>{convergenceChart}</div>}
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  <button onClick={onExportOptSTL} disabled={!resultMesh} style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid #388bfd', background: '#0d1117', color: '#58a6ff', fontSize: 11, fontWeight: 700, cursor: resultMesh ? 'pointer' : 'default' }}>Export STL</button>
                  <button onClick={onSendOptToQuote} style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none', background: '#388bfd', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Quote</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(LeftPanel);
