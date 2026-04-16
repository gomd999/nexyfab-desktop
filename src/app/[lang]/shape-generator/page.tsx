'use client';

// REFACTORING NOTE: This file (3900+ lines) should be split into:
// - ShapeGeneratorPage.tsx (main layout, ~200 lines)
// - panels/LeftPanel.tsx (feature tree, sketch tools)
// - panels/RightPanel.tsx (AI chat, analysis, properties)
// - panels/TopToolbar.tsx (shape selection, tools)
// - hooks/useShapeGenerator.ts (core state logic)
// - hooks/useKeyboardShortcuts.ts (keyboard handling)

import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense } from 'react';
import { useUIStore } from './store/uiStore';
import { useSceneStore } from './store/sceneStore';
import { useAnalysisStore } from './store/analysisStore';
// Responsive layout imports
import { useResponsive } from './responsive/useResponsive';
import type { MobileTab } from './responsive/MobileToolbar';
import MobileToolbar from './responsive/MobileToolbar';
import BottomSheet from './responsive/BottomSheet';
import type { SheetHeight } from './responsive/BottomSheet';
import { useTouchGestures } from './responsive/useTouchGestures';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { analytics } from '@/lib/analytics';
// Shape design imports
import { SHAPES, type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea, buildShapeResult } from './shapes';
import { shapeDict } from './shapeDict';
import type { UnitSystem } from './units';
import { applyFeaturePipeline, applyFeaturePipelineDetailed, classifyFeatureError } from './features';
import DesktopTitleBar from './DesktopTitleBar';
import { patchFetchForTauri } from '@/lib/tauri';
import { useNfabFileIO } from './hooks/useNfabFileIO';
import { useSceneAutoSaveWatchers } from './hooks/useSceneAutoSaveWatchers';
import { applyBooleanAsync } from './features/boolean';
import { useCsgWorker } from './workers/useCsgWorker';
import { useFEAWorker } from './workers/useFEAWorker';
import { useDFMWorker } from './workers/useDFMWorker';
import { usePipelineWorker } from './workers/usePipelineWorker';
import { useFeatureStack } from './useFeatureStack';
import { useShapeCart } from './useShapeCart';
import { exportBomCSV, exportBomExcel, estimateWeight, type BomRow } from './io/bomExport';
import { useHistory } from './useHistory';
import { useToast } from './useToast';
import ToastContainer from './ToastContainer';
import FeatureTree from './FeatureTree';
import ShapeCart from './ShapeCart';
import type { SketchResult, OptimizeResult, ModifyResult, ChatMessage } from './ShapeChat';
import type { FeatureType } from './features/types';
import { SHAPE_MAP } from './shapes';
import type { BomPartResult } from './ShapePreview';
// Sketch imports
import type { SketchProfile, SketchConfig, SketchTool, SketchConstraint, SketchDimension, ConstraintType } from './sketch/types';
import { profileToGeometry, profileToGeometryMulti } from './sketch/extrudeProfile';
import { solveConstraints } from './sketch/constraintSolver';
import SketchPanel from './sketch/SketchPanel';
import SketchCanvas from './sketch/SketchCanvas';
import {
  type SketchHistoryEntry,
  generateSketchThumbnail,
  saveSketchHistory,
  loadSketchHistory,
} from './sketch/SketchHistory';
const Sketch3DCanvas = dynamic(() => import('./sketch/Sketch3DCanvas'), { ssr: false });
const DrawingView = dynamic(() => import('./sketch/DrawingView'), { ssr: false });
const SketchHistoryPanel = dynamic(() => import('./sketch/SketchHistoryPanel'), { ssr: false });
// Editing imports
import type { EditMode } from './editing/types';
// Custom hooks
import { useViewportState } from './hooks/useViewportState';
import { useOptimizationState, RESOLUTION_MAP } from './hooks/useOptimizationState';
import { useImportExport } from './hooks/useImportExport';
import { useManufacturingFlow } from './hooks/useManufacturingFlow';
import { useFreemiumGate } from './hooks/useFreemiumGate';
import { useAnalysisState } from './hooks/useAnalysisState';
import { useSketchState } from './hooks/useSketchState';
import { useFreemium } from '@/hooks/useFreemium';
import UpgradeModal from '@/components/nexyfab/UpgradeModal';
import { useIPShareFlow } from './hooks/useIPShareFlow';
import ShapeGeneratorToolbar from './ShapeGeneratorToolbar';
import DesignFunnelBar from './DesignFunnelBar';
import QuoteWizard from './onboarding/QuoteWizard';
import { useAssemblyState } from './hooks/useAssemblyState';
import CSGPanel from './editing/CSGPanel';
import { applyCSG, makeToolGeometry } from './editing/CSGOperations';
import type { CSGOperation, CSGToolParams } from './editing/CSGOperations';
import BodyPanel from './panels/BodyPanel';
import type { BodyEntry } from './panels/BodyPanel';
import { splitBodyBoth } from './features/splitBodyBoth';
import { mergeBodyGeometries } from './features/mergeBodies';
// Topology optimization imports
import { genDesignDict } from './topology/genDesignDict';
import type { Face, OptProgress, OptResult } from './topology/optimizer/types';
import { MATERIALS } from './topology/optimizer/types';
import ConditionPanel from './topology/ConditionPanel';
import CommandToolbar from './CommandToolbar';
import { decodeShareLink } from './io/shareLink';
import { useSearchParams } from 'next/navigation';
import TimelineBar from './TimelineBar';
import ContextMenu, { getContextItemsEmpty, getContextItemsGeometry, getContextItemsSketch } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
// New module imports
import type { ArrayPattern } from './features/instanceArray';
import type { ValidationResult } from './analysis/geometryValidation';
import type { PrintAnalysisResult, PrintAnalysisOptions, OrientationOptimizationResult } from './analysis/printAnalysis';
import type { DFMResult, ManufacturingProcess, DFMIssue } from './analysis/dfmAnalysis';
import { useProcessRecommendation } from './analysis/useProcessRecommendation';
import type { FEAResult, FEABoundaryCondition, FEAMaterial } from './analysis/simpleFEA';
import ManufacturingReadyCard from './analysis/ManufacturingReadyCard';
import type { FEADisplayMode } from './analysis/FEAOverlay';
// Auto-save imports
import { useAutoSave } from './useAutoSave';
import type { AutoSaveState } from './useAutoSave';
import RecoveryBanner from './RecoveryBanner';
import ShortcutHelp from './ShortcutHelp';
import AutoSaveIndicator from './AutoSaveIndicator';
import CommandPalette from './CommandPalette';
import type { Command } from './CommandPalette';
import MaterialPicker from './MaterialPicker';
import { MATERIAL_PRESETS } from './materials';
import { ThemeProvider, useTheme } from './ThemeContext';
import ExpressionInput from './ExpressionInput';
import { evaluateExpression, type ExprVariable } from './ExpressionEngine';
import ModelParametersPanel, { type ModelVar, resolveModelVars } from './ModelParametersPanel';
import { usePlugins } from './plugins/usePlugins';
import { pluginRegistry } from './plugins/PluginRegistry';
import PluginManager from './plugins/PluginManager';
import TransformInputPanel from './TransformInputPanel';
import type { CustomShapeDefinition } from './plugins/PluginAPI';
import { useCollab } from './collab/useCollab';
import CollabPresence from './collab/CollabPresence';
import { detectInterference } from './assembly/InterferenceDetection';
import type { AssemblyMate } from './assembly/AssemblyMates';
import { useVersionHistory } from './history/useVersionHistory';
import type { DesignVersion } from './history/useVersionHistory';
import VersionPanel from './history/VersionPanel';
const VersionDiff3DViewer = dynamic(() => import('./history/VersionDiff3DViewer'), { ssr: false });
import { useCommandHistory } from './history/useCommandHistory';
import { commandHistory } from './history/CommandHistory';
const HistoryPanel = dynamic(() => import('./history/HistoryPanel'), { ssr: false });
import BranchCompare from './history/BranchCompare';
import { captureCanvasSnapshot } from './history/useCanvasSnapshot';
import SheetMetalPanel from './SheetMetalPanel';
import RightPanel from './panels/RightPanel';
import { mapDFMToParams, getBestDFMScore, getTopDFMIssues } from './analysis/dfmParamMapper';
import { useProactiveAdvisor } from './useProactiveAdvisor';
import { useCloudSaveFlow } from './useCloudSaveFlow';
import RenderPanel, { DEFAULT_RENDER_SETTINGS, type RenderSettings } from './rendering/RenderPanel';
import { downloadScreenshot, captureHighRes } from './rendering/useScreenshot';
import ScreenshotShareModal from './rendering/ScreenshotShareModal';
import { useTutorial } from './onboarding/useTutorial';
const TutorialOverlay = dynamic(() => import('./onboarding/TutorialOverlay'), {
  ssr: false,
  loading: () => null,
});
const WelcomeBanner = dynamic(() => import('./onboarding/WelcomeBanner'), {
  ssr: false,
  loading: () => null,
});
const SketchContextTip = dynamic(() => import('./onboarding/SketchContextTip'), {
  ssr: false,
  loading: () => null,
});
const ContextHelpPanel = dynamic(() => import('./onboarding/ContextHelpPanel'), {
  ssr: false,
  loading: () => null,
});
import { useContextHelp } from './onboarding/useContextHelp';
import type { GeometryMetrics } from './estimation/CostEstimator';
import { estimateCosts } from './estimation/CostEstimator';
// GD&T Annotation imports
import type { GDTAnnotation, DimensionAnnotation } from './annotations/GDTTypes';
const ShapePreview = dynamic(() => import('./ShapePreview'), { ssr: false });
const MultiViewport = dynamic(() => import('./MultiViewport'), { ssr: false });
import LeftPanel from './panels/LeftPanel';
const GenDesignViewer = dynamic(() => import('./topology/GenDesignViewer'), { ssr: false });
import AuthModal from '@/components/nexyfab/AuthModal';
import VerificationBanner from '@/components/nexyfab/VerificationBanner';
import { useAuthStore } from '@/hooks/useAuth';
import { useProjectsStore } from '@/hooks/useProjects';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { getPlanLimits } from './freemium/planLimits';
import UpgradePrompt from './freemium/UpgradePrompt';
import COTSPanel from './cots/COTSPanel';
import CAMSimPanel from './analysis/CAMSimPanel';
import type { COTSPart } from './cots/cotsData';
import ScriptPanel from './ScriptPanel';
import { usePinComments } from './comments/PinComments'
import WorkflowStepper from './WorkflowStepper';
const ManufacturerMatch = dynamic(() => import('./analysis/ManufacturerMatch'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0d1117', color: '#6e7681', fontSize: 13 }}>
      Loading Manufacturer Match...
    </div>
  ),
});
import type { Manufacturer } from './analysis/ManufacturerMatch';
import { useCollabPolling } from '@/hooks/useCollabPolling';
import GenerativeDesignPanel from './analysis/GenerativeDesignPanel';
import StatusBar from './StatusBar';
import BreadcrumbNav from './BreadcrumbNav';
import type { BreadcrumbItem } from './BreadcrumbNav';
import SelectionFilterBar from './SelectionFilterBar';
import type { SelectionFilter } from './SelectionFilterBar';
import PropertyManager from './PropertyManager';
import EmptyCanvasGuide from './EmptyCanvasGuide';
import { getToolCursor } from './hooks/useToolCursor';
import { useProgressiveRender } from './hooks/useProgressiveRender';
import type { TopologyResult } from './analysis/topologyOptimization';
import ECADImportPanel from './analysis/ECADImportPanel';
import ThermalFEAPanel from './analysis/ThermalFEAPanel';
// Advanced analysis panels
const MotionStudyPanel = dynamic(() => import('./analysis/MotionStudyPanel'), { ssr: false });
const ModalAnalysisPanel = dynamic(() => import('./analysis/ModalAnalysisPanel'), { ssr: false });
const ParametricSweepPanel = dynamic(() => import('./analysis/ParametricSweepPanel'), { ssr: false });
const ToleranceStackupPanel = dynamic(() => import('./analysis/ToleranceStackupPanel'), { ssr: false });
const SurfaceQualityPanel = dynamic(() => import('./analysis/SurfaceQualityPanel'), { ssr: false });
const AutoDrawingPanel = dynamic(() => import('./analysis/AutoDrawingPanel'), { ssr: false });
const ManufacturingPipelinePanel = dynamic(() => import('./analysis/ManufacturingPipelinePanel'), { ssr: false });
const ShapeVersionDiff = dynamic(() => import('./ShapeVersionDiff'), { ssr: false });
const PartPlacementPanel = dynamic(() => import('./assembly/PartPlacementPanel'), { ssr: false });
import type { PlacedPart } from './assembly/PartPlacementPanel';
import { placedPartsToBomResults } from './assembly/PartPlacementPanel';

// ─── Lang helper ─────────────────────────────────────────────────────────────

type Lang = keyof typeof shapeDict;

function useLang(): Lang {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const map: Record<string, Lang> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
  return map[seg] ?? 'en';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', sphere: '🔮', cone: '🔺', torus: '🍩', wedge: '🔻',
  pipe: '🔧', lBracket: '📐', flange: '⚙️', plateBend: '🔨',
  gear: '⚙️', fanBlade: '🌀', sprocket: '🔗', pulley: '🎡',
  sweep: '🔀', loft: '🔄',
  bolt: '🔩', spring: '🌀', tSlot: '⊓',
  hexNut: '⬡', washer: '⭕', iBeam: 'Ⅰ', bearing: '⊚',
};


type TabMode = 'design' | 'optimize';
type ViewMode = 'gallery' | 'workspace';

const TAB_LABELS: Record<string, { design: string; optimize: string }> = {
  ko: { design: '형상 설계', optimize: '위상 최적화' },
  en: { design: 'Shape Design', optimize: 'Topology Optimization' },
  ja: { design: '形状設計', optimize: 'トポロジー最適化' },
  cn: { design: '形状设计', optimize: '拓扑优化' },
  es: { design: 'Diseño de Forma', optimize: 'Optimización Topológica' },
  ar: { design: 'تصميم الشكل', optimize: 'تحسين الطوبولوجيا' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ShapeGeneratorPage() {
  return (
    <ThemeProvider>
      <Suspense fallback={null}>
        <ShapeGeneratorInner />
      </Suspense>
    </ThemeProvider>
  );
}

function ShapeGeneratorInner() {
  const { theme, mode, toggleTheme } = useTheme();
  const lang = useLang();
  const t = shapeDict[lang];
  const gt = genDesignDict[lang] as unknown as Record<string, string>;
  const router = useRouter();
  const pathname = usePathname();
  const langSeg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const tabLabels = TAB_LABELS[lang] || TAB_LABELS.en;
  const searchParams = useSearchParams();

  // ── View-only / readonly mode (opened via ?readonly=1 share link) ──
  const isReadOnly = searchParams?.get('readonly') === '1';

  // ══════════════════════════════════════════════════════════════════════════
  // RESPONSIVE STATE
  // ══════════════════════════════════════════════════════════════════════════
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const tabletLeftOpen = useUIStore(s => s.tabletLeftOpen);
  const setTabletLeftOpen = useUIStore(s => s.setTabletLeftOpen);
  const simpleMode = useUIStore(s => s.simpleMode);
  const enableSimpleMode = useUIStore(s => s.enableSimpleMode);
  const disableSimpleMode = useUIStore(s => s.disableSimpleMode);
  const [showQuoteWizard, setShowQuoteWizard] = useState(false);
  const [showCSGPanel, setShowCSGPanel] = useState(false);

  // ── 퍼널 전환율 추적 ─────────────────────────────────────────────────────
  const [rfqDone, setRfqDone] = useState(false);
  const [manufacturerMatched, setManufacturerMatched] = useState(false);

  // ── Multi-body state (useAssemblyState 훅으로 통합) ──────────────────────
  const {
    bodies, setBodies,
    activeBodyId, setActiveBodyId,
    selectedBodyIds, setSelectedBodyIds,
    showBodyPanel, setShowBodyPanel,
    placedParts, setPlacedParts,
    showPartPlacement, setShowPartPlacement,
    assemblyMates, setAssemblyMates,
    interferenceResults, setInterferenceResults,
    interferenceLoading, setInterferenceLoading,
  } = useAssemblyState();
  const BODY_COLORS = ['#8b9cf4', '#f4a28b', '#8bf4b0', '#f4e08b', '#c48bf4', '#8bd8f4', '#f48bb0', '#b0f48b'];
  const _mobileTab = useUIStore(s => s.mobileTab);
  const mobileTab = _mobileTab as MobileTab | null;
  const _setMobileTab = useUIStore(s => s.setMobileTab);
  const setMobileTab = useCallback((v: MobileTab | null) => _setMobileTab(v), [_setMobileTab]);
  const [mobileSheetHeight] = useState<SheetHeight>('half');

  // Close bottom sheet
  const handleCloseMobileSheet = useCallback(() => { setMobileTab(null); }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW MODE: gallery vs workspace
  // ══════════════════════════════════════════════════════════════════════════
  const viewMode = useUIStore(s => s.viewMode);
  const setViewMode = useUIStore(s => s.setViewMode);
  const [pendingChatMsg, setPendingChatMsg] = useState<string | null>(null);

  // ── Tab state ──
  const activeTab = useUIStore(s => s.activeTab);
  const setActiveTab = useUIStore(s => s.setActiveTab);

  // ══════════════════════════════════════════════════════════════════════════
  // SHAPE DESIGN STATE
  // ══════════════════════════════════════════════════════════════════════════

  const selectedId = useSceneStore(s => s.selectedId);
  const setSelectedId = useSceneStore(s => s.setSelectedId);
  const params = useSceneStore(s => s.params);
  const setParams = useSceneStore(s => s.setParams);
  // Debounced params for heavy geometry recalculation (avoids thrashing during slider drag)
  const [debouncedParams, setDebouncedParams] = useState(params);
  // Tauri: /api → https://nexyfab.com/api 자동 라우팅 (once on mount)
  useEffect(() => { patchFetchForTauri(); }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedParams(params), 120);
    return () => clearTimeout(t);
  }, [params]);
  const setParam = useSceneStore(s => s.setParam);
  const paramExpressions = useSceneStore(s => s.paramExpressions);
  const setParamExpressions = useSceneStore(s => s.setParamExpressions);
  const setParamExpression = useSceneStore(s => s.setParamExpression);
  const { features, addFeature, addSketchFeature, removeFeature, updateFeatureParam, toggleFeature, moveFeature, undoLast, clearAll, history: featureHistory, rollbackTo, startEditing, finishEditing, toggleExpanded, removeNode, featureErrors, setFeatureError, clearFeatureError, getOrderedNodes, replaceHistory } = useFeatureStack();
  const { performCSG, loading: csgLoading } = useCsgWorker();
  const { runFEA: runFEAWorker, loading: feaWorkerLoading } = useFEAWorker();
  const { analyzeDFM: analyzeDFMWorker, loading: dfmWorkerLoading } = useDFMWorker();
  const { runPipeline: runPipelineWorker, loading: pipelineWorkerLoading } = usePipelineWorker();
  const history = useHistory();
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const captureRef = useRef<(() => string | null) | null>(null);
  const [cartAdded, setCartAdded] = useState(false);
  const [bomParts, setBomParts] = useState<BomPartResult[]>([]);
  const [bomLabel, setBomLabel] = useState('');
  const materialId = useSceneStore(s => s.materialId);
  const setMaterialId = useSceneStore(s => s.setMaterialId);

  // Sync placedParts → bomParts whenever placedParts changes
  React.useEffect(() => {
    if (placedParts.length > 0) {
      setBomParts(placedPartsToBomResults(placedParts));
      setBomLabel(lang === 'ko' ? '어셈블리' : 'Assembly');
    }
  }, [placedParts, lang]);

  // ── Assembly mates / interference / exploded view ──
  const showAssemblyPanel = useUIStore(s => s.showAssemblyPanel);
  const setShowAssemblyPanel = useUIStore(s => s.setShowAssemblyPanel);
  const explodeFactor = useSceneStore(s => s.explodeFactor);
  const setExplodeFactor = useSceneStore(s => s.setExplodeFactor);

  // ── Render mode ──
  const renderMode = useSceneStore(s => s.renderMode);
  const setRenderMode = useSceneStore(s => s.setRenderMode);
  const [renderSettings, setRenderSettings] = useState<RenderSettings>(DEFAULT_RENDER_SETTINGS);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ canvas: HTMLCanvasElement } | null>(null);

  // ── Collaboration (existing demo) ──
  const { users: collabUsers, isConnected: collabConnected, demoMode: collabDemo, setDemoMode: setCollabDemo, sendCursor: collabSendCursor } = useCollab();

  // ── Sketch mode ──
  const isSketchMode = useSceneStore(s => s.isSketchMode);
  const _setSketchMode = useSceneStore(s => s.setSketchMode);
  const setIsSketchMode = useCallback((v: boolean) => _setSketchMode(v), [_setSketchMode]);
  const sketchViewMode = useSceneStore(s => s.sketchViewMode);
  const setSketchViewMode = useSceneStore(s => s.setSketchViewMode);
  const sketchPlane = useSceneStore(s => s.sketchPlane);
  const setSketchPlaneRaw = useSceneStore(s => s.setSketchPlane);
  const sketchProfile = useSceneStore(s => s.sketchProfile);
  const setSketchProfile = useSceneStore(s => s.setSketchProfile);
  const sketchConfig = useSceneStore(s => s.sketchConfig);
  const setSketchConfig = useSceneStore(s => s.setSketchConfig);
  const sketchTool = useSceneStore(s => s.sketchTool);
  const setSketchTool = useSceneStore(s => s.setSketchTool);
  // sketchOperation and sketchPlaneOffset come from useSketchState hook above

  // ── Sketch state (extracted hook) ──
  const {
    sketchProfiles, setSketchProfiles,
    activeProfileIdx, setActiveProfileIdx,
    sketchOperation, setSketchOperation,
    sketchPlaneOffset, setSketchPlaneOffset,
    sketchConstraints, setSketchConstraints,
    sketchDimensions, setSketchDimensions,
    selectedConstraintType, setSelectedConstraintType,
    autoSolve, setAutoSolve,
    constraintStatus, setConstraintStatus,
    constraintDiagnostic, setConstraintDiagnostic,
    sketchHistory, setSketchHistory,
    showSketchHistory, setShowSketchHistory,
    editingSketchFeatureId, setEditingSketchFeatureId,
    showSketchActionMenu, setShowSketchActionMenu,
  } = useSketchState();

  // ── 스케치 2단계 플로우: 'draw'=그리기, 'setup3d'=3D변환설정 ──
  const [sketchStep, setSketchStep] = useState<'draw' | 'setup3d'>('draw');

  // ── Model parameters (user-defined named variables for parametric modeling) ──
  const [modelVars, setModelVars] = useState<ModelVar[]>([]);
  const [showModelParams, setShowModelParams] = useState(false);

  // When model vars change, re-evaluate all param expressions
  useEffect(() => {
    if (modelVars.length === 0) return;
    const mvVars: ExprVariable[] = modelVars.map(v => ({ name: v.name, value: v.value }));
    // Access current paramExpressions and params from store directly
    const currentExprs = useSceneStore.getState().paramExpressions;
    const currentParams = useSceneStore.getState().params;
    Object.entries(currentExprs).forEach(([key, expr]) => {
      const allVars: ExprVariable[] = [
        ...Object.entries(currentParams).filter(([k]) => k !== key).map(([name, value]) => ({ name, value })),
        ...mvVars,
      ];
      try {
        const val = evaluateExpression(expr, allVars);
        if (isFinite(val)) setParam(key, val);
      } catch { /* invalid expression — skip */ }
    });
  }, [modelVars, setParam]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Selection filters ──
  const [selectionFilters, setSelectionFilters] = useState<SelectionFilter[]>(['face', 'body']);
  const toggleSelectionFilter = useCallback((f: SelectionFilter) => {
    setSelectionFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }, []);

  // ── PropertyManager ──
  const [showPropertyManager, setShowPropertyManager] = useState(false);

  // ── Viewport state (extracted hook) ──
  const {
    showDimensions, setShowDimensions,
    measureActive, setMeasureActive,
    measureMode, setMeasureMode,
    sectionActive, setSectionActive,
    sectionAxis, setSectionAxis,
    sectionOffset, setSectionOffset,
    editMode, setEditMode,
    transformMode, setTransformMode,
    transformMatrix, setTransformMatrix,
    snapEnabled, setSnapEnabled,
    snapSize, setSnapSize,
    unitSystem, setUnitSystem,
  } = useViewportState();

  // ── Sketch result (overrides parametric result when sketch was generated) ──
  const sketchResult = useSceneStore(s => s.sketchResult);
  const setSketchResult = useSceneStore(s => s.setSketchResult);

  // ── AI Preview state ──
  const previewResult = useSceneStore(s => s.previewResult);
  const setPreviewResult = useSceneStore(s => s.setPreviewResult);
  const isPreviewMode = useSceneStore(s => s.isPreviewMode);
  const setIsPreviewMode = useSceneStore(s => s.setIsPreviewMode);

  // ── Tutorial / Onboarding ──
  const tutorial = useTutorial();
  const contextHelp = useContextHelp();

  // Context detection: enter context when modes change
  React.useEffect(() => {
    if (isSketchMode) contextHelp.enterContext('sketch');
    else if (isPreviewMode) contextHelp.enterContext('render');
    else contextHelp.leaveContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSketchMode, isPreviewMode]);

  // Wrapped addFeature that also triggers feature context help
  const addFeatureWithContext = useCallback((type: FeatureType) => {
    addFeature(type);
    contextHelp.enterContext('feature');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFeature]);

  // ── Command History (Command Pattern undo/redo) ──
  const cmdHistory = useCommandHistory();

  // ── Fullscreen / drag / viewport misc state ──
  const [show3DPreview, setShow3DPreview] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cursor3DPos, setCursor3DPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const dragCounterRef = React.useRef(0);

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // 소화면 감지 → 프롬프트 표시 (1280px 미만, 세션당 1회)
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = sessionStorage.getItem('nf_fs_prompt_dismissed');
    if (dismissed) return;
    const check = () => {
      if (window.innerWidth < 1280 && !document.fullscreenElement) {
        setShowFullscreenPrompt(true);
      }
    };
    const t = setTimeout(check, 1500);
    return () => clearTimeout(t);
  }, []);
  const toggleFullscreen = React.useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.warn('[Fullscreen]', err));
    } else {
      document.exitFullscreen().catch(err => console.warn('[Fullscreen]', err));
    }
  }, []);
  const dismissFullscreenPrompt = React.useCallback((goFullscreen: boolean) => {
    setShowFullscreenPrompt(false);
    sessionStorage.setItem('nf_fs_prompt_dismissed', '1');
    if (goFullscreen) toggleFullscreen();
  }, [toggleFullscreen]);

  // ── UI state ──
  const showAIAssistant = useUIStore(s => s.showAIAssistant);
  const setShowAIAssistant = useUIStore(s => s.setShowAIAssistant);
  const openAIAssistant = useUIStore(s => s.openAIAssistant);
  const showShortcuts = useUIStore(s => s.showShortcuts);
  const setShowShortcuts = useUIStore(s => s.setShowShortcuts);
  const showCommandPalette = useUIStore(s => s.showCommandPalette);
  const setShowCommandPalette = useUIStore(s => s.setShowCommandPalette);
  const showPlanes = useUIStore(s => s.showPlanes);
  const setShowPlanes = useUIStore(s => s.setShowPlanes);
  const showPerf = useUIStore(s => s.showPerf);
  const setShowPerf = useUIStore(s => s.setShowPerf);
  const occtMode = useUIStore(s => s.occtMode);
  const occtInitPending = useUIStore(s => s.occtInitPending);
  const occtInitError = useUIStore(s => s.occtInitError);
  const setOcctMode = useUIStore(s => s.setOcctMode);
  const multiView = useUIStore(s => s.multiView);
  const setMultiView = useUIStore(s => s.setMultiView);
  const showVersionPanel = useUIStore(s => s.showVersionPanel);
  const setShowVersionPanel = useUIStore(s => s.setShowVersionPanel);
  const [versionDiffPair, setVersionDiffPair] = useState<[import('./history/useVersionHistory').DesignVersion, import('./history/useVersionHistory').DesignVersion] | null>(null);
  const showHistoryPanel = useUIStore(s => s.showHistoryPanel);
  const setShowHistoryPanel = useUIStore(s => s.setShowHistoryPanel);
  const defaultPlanes = useMemo(() => [
    { id: 'xy', type: 'xy' as const, offset: 0, visible: true, label: 'XY Plane' },
    { id: 'xz', type: 'xz' as const, offset: 0, visible: true, label: 'XZ Plane' },
    { id: 'yz', type: 'yz' as const, offset: 0, visible: true, label: 'YZ Plane' },
  ], []);

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; visible: boolean; items: ContextMenuItem[] }>({ x: 0, y: 0, visible: false, items: [] });
  // 오른쪽 버튼 누른 위치 추적 (드래그 vs 단순 클릭 구분용)
  const rightMouseDownPos = useRef<{ x: number; y: number } | null>(null);

  // ── New module state (non-import parts) ──
  const showLibrary = useUIStore(s => s.showLibrary);
  const setShowLibrary = useUIStore(s => s.setShowLibrary);
  const [selectedStandardPart, setSelectedStandardPart] = useState<string | null>(null);
  const [standardPartParams, setStandardPartParams] = useState<Record<string, number>>({});
  // ── Analysis state (extracted hook) ──
  const {
    feaResult, setFeaResult,
    feaConditions, setFeaConditions,
    feaDisplayMode, setFeaDisplayMode,
    feaDeformationScale, setFeaDeformationScale,
    showFEA, setShowFEA,
    dfmResults, setDfmResults,
    dfmHighlightedIssue, setDfmHighlightedIssue,
    showDFM, setShowDFM,
    printAnalysis, setPrintAnalysis,
    printBuildDir, setPrintBuildDir,
    printOverhangAngle, setPrintOverhangAngle,
    showPrintAnalysis, setShowPrintAnalysis,
    showMassProps, setShowMassProps,
    showCenterOfMass, setShowCenterOfMass,
    validationResult, setValidationResult,
    showValidation, setShowValidation,
    gdtAnnotations, addGDTAnnotation, updateGDTAnnotation, removeGDTAnnotation,
    dimensionAnnotations, addDimensionAnnotation, removeDimensionAnnotation, updateDimensionAnnotation,
    showAnnotationPanel, setShowAnnotationPanel,
    annotationPlacementMode, setAnnotationPlacementMode,
  } = useAnalysisState();

  // ── Shared: Cart ──
  const { items: cartItems, addItem: addCartItem, removeItem: removeCartItem, clearCart } = useShapeCart();
  const { toasts, addToast, removeToast } = useToast();

  // 스케치 평면 전환 래퍼: 진행 중인 프로파일이 있으면 사용자에게 알림.
  // 평면을 바꿔도 기존 2D 좌표는 유지되지만 새 평면에 투영되므로 혼란을 방지.
  const setSketchPlane = useCallback((plane: 'xy' | 'xz' | 'yz') => {
    const cur = useSceneStore.getState().sketchPlane;
    if (cur === plane) return;
    const hasProfile = useSceneStore.getState().sketchProfile.segments.length > 0;
    setSketchPlaneRaw(plane);
    if (hasProfile) {
      addToast('info', `스케치 평면이 ${plane.toUpperCase()}로 전환됨. 기존 형상은 새 평면에 매핑됩니다.`);
    }
  }, [setSketchPlaneRaw, addToast]);

  // #wf3: warn when switching to Optimize while sketch mode is active
  const handleSetActiveTab = useCallback((tab: 'design' | 'optimize') => {
    if (tab === 'optimize' && isSketchMode) {
      addToast('warning', lang === 'ko'
        ? '스케치 모드를 종료한 후 최적화 탭으로 이동하세요. 현재 스케치는 유지됩니다.'
        : 'Exit sketch mode before switching to Optimize. Your sketch will be preserved.');
      return;
    }
    setActiveTab(tab);
  }, [isSketchMode, lang, addToast, setActiveTab]);

  // ── WebGL detection ──
  const [webglSupported, setWebglSupported] = useState(true);
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) setWebglSupported(false);
    } catch {
      setWebglSupported(false);
    }
  }, []);

  // ── Pipeline errors (set by result useMemo, consumed by FeatureTree + toast) ──
  const [pipelineErrors, setPipelineErrors] = useState<Record<string, string>>({});

  // ── Feature validation error (e.g. param out of range) → toast ──
  useEffect(() => {
    const errorIds = Object.keys(featureErrors);
    if (errorIds.length > 0) {
      const lastErrorId = errorIds[errorIds.length - 1];
      const msg = featureErrors[lastErrorId];
      addToast('error', lang === 'ko'
        ? `피쳐를 적용할 수 없습니다: ${msg}`
        : `Cannot apply feature: ${msg}`,
      );
      clearFeatureError(lastErrorId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureErrors]);

  // ── Pipeline error → toast (diff-based: only fire on newly-appearing errors) ──
  const prevPipelineErrorsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevPipelineErrorsRef.current;
    const newlyFailed: string[] = [];
    for (const [id, msg] of Object.entries(pipelineErrors)) {
      if (prev[id] !== msg) newlyFailed.push(id);
    }
    prevPipelineErrorsRef.current = pipelineErrors;
    if (newlyFailed.length === 0) return;
    // Show a toast for the most recent failure only (rest are visible as red badges in tree)
    const id = newlyFailed[newlyFailed.length - 1];
    const raw = pipelineErrors[id];
    const node = featureHistory.nodes.find(n => n.id === id);
    const diag = classifyFeatureError(node?.featureType ?? 'sketchExtrude', raw);
    const label = node?.label ?? 'Feature';
    addToast('error', lang === 'ko'
      ? `⚠ ${label} 실행 실패 — ${diag.hintKo}`
      : `⚠ ${label} failed — ${diag.hintEn}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineErrors]);

  // ── Auth modal ──
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');

  // ── Freemium gates (extracted hook) ──
  const {
    authUser,
    planLimits,
    showUpgradePrompt, setShowUpgradePrompt,
    upgradeFeature, setUpgradeFeature,
    requirePro,
    checkCartLimit,
  } = useFreemiumGate();

  // ── CAM G-code freemium gate ──
  const { check: checkFreemium } = useFreemium();
  // ── Collaboration polling (Team+ plan only) ──
  const currentProjectId = useProjectsStore(s => s.projects[0]?.id ?? null);
  const { sessions: pollingSessions, mySessionId } = useCollabPolling(currentProjectId, planLimits.collaboration);

  // ── Cloud projects ──
  const saveProject = useProjectsStore(s => s.saveProject);
  const updateProject = useProjectsStore(s => s.updateProject);

  // ── CAM Simulation ──
  const [camSimResult, setCamSimResult] = useState<{ result: import('./analysis/camLite').CAMResult; operation: import('./analysis/camLite').CAMOperation } | null>(null);

  // ── Generative Design / ECAD overlays (visualization layers, not panels) ──
  const [genDesignResult, setGenDesignResult] = useState<THREE.BufferGeometry | null>(null);
  const [showGenOverlay, setShowGenOverlay] = useState(false);
  const [thermalOverlayGeo, setThermalOverlayGeo] = useState<THREE.BufferGeometry | null>(null);
  const [showThermalOverlay, setShowThermalOverlay] = useState(false);

  // ── Analysis modal panels (centralised in useUIStore for closeAllPanels / simpleMode) ──
  const showCOTSPanel        = useUIStore(s => s.showCOTSPanel);
  const setShowCOTSPanel     = useUIStore(s => s.setShowCOTSPanel);
  const showCamUpgrade       = useUIStore(s => s.showCamUpgrade);
  const setShowCamUpgrade    = useUIStore(s => s.setShowCamUpgrade);
  const showGenDesign        = useUIStore(s => s.showGenDesign);
  const setShowGenDesign     = useUIStore(s => s.setShowGenDesign);
  const showECADPanel        = useUIStore(s => s.showECADPanel);
  const setShowECADPanel     = useUIStore(s => s.setShowECADPanel);
  const showThermalPanel     = useUIStore(s => s.showThermalPanel);
  const setShowThermalPanel  = useUIStore(s => s.setShowThermalPanel);
  const showMotionStudy      = useUIStore(s => s.showMotionStudy);
  const setShowMotionStudy   = useUIStore(s => s.setShowMotionStudy);
  // Motion playback transforms: updated by MotionStudyPanel's onFrameUpdate callback
  const [motionPartTransforms, setMotionPartTransforms] = useState<Record<string, import('three').Matrix4> | null>(null);
  const showModalAnalysis    = useUIStore(s => s.showModalAnalysis);
  const setShowModalAnalysis = useUIStore(s => s.setShowModalAnalysis);
  const showParametricSweep  = useUIStore(s => s.showParametricSweep);
  const setShowParametricSweep = useUIStore(s => s.setShowParametricSweep);
  const showToleranceStackup = useUIStore(s => s.showToleranceStackup);
  const setShowToleranceStackup = useUIStore(s => s.setShowToleranceStackup);
  const showSurfaceQuality   = useUIStore(s => s.showSurfaceQuality);
  const setShowSurfaceQuality = useUIStore(s => s.setShowSurfaceQuality);
  const showAutoDrawing      = useUIStore(s => s.showAutoDrawing);
  const setShowAutoDrawing   = useUIStore(s => s.setShowAutoDrawing);
  const showMfgPipeline      = useUIStore(s => s.showMfgPipeline);
  const setShowMfgPipeline   = useUIStore(s => s.setShowMfgPipeline);
  const showVersionDiff      = useUIStore(s => s.showVersionDiff);
  const setShowVersionDiff   = useUIStore(s => s.setShowVersionDiff);
  const [diffGeometries, setDiffGeometries] = useState<{ a: THREE.BufferGeometry; b: THREE.BufferGeometry; labelA: string; labelB: string } | null>(null);

  // ── AI Advisor + Manufacturer Match + Manufacturing card (extracted later via useManufacturingFlow) ──

  // ── Plugin system ──
  const showPluginManager = useUIStore(s => s.showPluginManager);
  const setShowPluginManager = useUIStore(s => s.setShowPluginManager);
  // ── Script panel ──
  const showScriptPanel = useUIStore(s => s.showScriptPanel);
  const setShowScriptPanel = useUIStore(s => s.setShowScriptPanel);
  // ── Share link trigger key (incrementing opens ShareButton) ──
  const shareOpenKey = useUIStore(s => s.shareOpenKey);
  const setShareOpenKey = useUIStore(s => s.setShareOpenKey);
  // ── Sheet metal panel ──
  const showSheetMetalPanel = useUIStore(s => s.showSheetMetalPanel);
  const setShowSheetMetalPanel = useUIStore(s => s.setShowSheetMetalPanel);
  // ── Cost estimation panel ──
  const showCostPanel = useUIStore(s => s.showCostPanel);
  const setShowCostPanel = useUIStore(s => s.setShowCostPanel);
  // ── Array/Pattern panel ──
  const showArrayPanel = useUIStore(s => s.showArrayPanel);
  const setShowArrayPanel = useUIStore(s => s.setShowArrayPanel);
  const arrayPattern = useSceneStore(s => s.arrayPattern);
  const setArrayPattern = useSceneStore(s => s.setArrayPattern);

  // ══════════════════════════════════════════════════════════════════════════
  // TOPOLOGY OPTIMIZATION STATE (extracted hook)
  // ══════════════════════════════════════════════════════════════════════════

  const {
    dimX, setDimX, dimY, setDimY, dimZ, setDimZ,
    materialKey, setMaterialKey,
    fixedFaces, setFixedFaces,
    loads, setLoads,
    volfrac, setVolfrac,
    resolution, setResolution,
    penal, setPenal,
    rmin, setRmin,
    maxIter, setMaxIter,
    selectionMode, setSelectionMode,
    isOptimizing, setIsOptimizing,
    progress, setProgress,
    optResult, setOptResult,
    resultMesh, setResultMesh,
    activeLoadForce, setActiveLoadForce,
    useCustomDomain, setUseCustomDomain,
    customDomainGeometry, setCustomDomainGeometry,
    handleGenerate,
  } = useOptimizationState(addToast);

  // ═══ AUTO-SAVE & RECOVERY ═══
  const { hasRecovery, recoveryData, saveError, lastSavedAt, isSaving, save: autoSave, scheduleSave, dismissRecovery } = useAutoSave();
  const { cloudStatus, cloudSavedAt, cloudError, projectId: cloudProjectId, scheduleSync: scheduleCloudSync, syncNow: syncCloudNow } = useCloudSaveFlow(!!authUser);
  // ── Pin Comments (depends on cloudProjectId from useCloudSaveFlow) ──
  const { comments, isPlacingComment, setIsPlacingComment, addComment, resolveComment, deleteComment } = usePinComments({ projectId: cloudProjectId });
  const showRecovery = useUIStore(s => s.showRecovery);
  const setShowRecovery = useUIStore(s => s.setShowRecovery);
  useEffect(() => { if (hasRecovery && recoveryData) setShowRecovery(true); }, [hasRecovery, recoveryData]);
  // ── Memoised feature serialisations (shared across auto-save, version, designContext) ──
  const featuresToSerialize = useMemo(
    () => features.map(f => ({ type: f.type, params: { ...f.params }, enabled: f.enabled })),
    [features],
  );
  const enabledFeaturesForContext = useMemo(
    () => features.filter(f => f.enabled).map(f => ({ type: f.type, params: { ...f.params } })),
    [features],
  );
  // ── 채팅 히스토리 (저장/복원용) ──────────────────────────────────────────
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const buildAutoSaveState = useCallback((): AutoSaveState => ({ version: 1, timestamp: Date.now(), selectedId, params, features: featuresToSerialize, isSketchMode, sketchProfile: sketchProfile.segments.length > 0 ? { segments: sketchProfile.segments, closed: sketchProfile.closed } : undefined, sketchConfig, activeTab, chatHistory: chatHistory.length > 0 ? chatHistory : undefined }), [selectedId, params, featuresToSerialize, isSketchMode, sketchProfile, sketchConfig, activeTab, chatHistory]);
  useEffect(() => { if (saveError) addToast('warning', saveError); }, [saveError, addToast]);
  useEffect(() => { if (cloudError) addToast('warning', `☁ ${cloudError}`); }, [cloudError, addToast]);

  // ═══ .nfab NATIVE PROJECT FORMAT (save/load) + Manufacturing Route ═══
  const {
    desktopFilePath,
    desktopDirty,
    handleSaveNfab,
    handleSaveNfabCloud,
    handleLoadNfab,
    handleOpenRecentFile,
    markDirty: markNfabDirty,
    resetFile: resetNfabFile,
    mfgCamPost, setMfgCamPost,
  } = useNfabFileIO({
    featureHistory,
    replaceHistory,
    saveProject,
    updateProject,
    addToast,
    lang,
  });

  // Wire scene → autosave + .nfab dirty (debounced + transition triggers)
  useSceneAutoSaveWatchers({
    viewMode,
    selectedId,
    params,
    features,
    isSketchMode,
    sketchProfile,
    sketchConfig,
    scheduleSave,
    autoSave,
    buildAutoSaveState,
    markNfabDirty,
  });

  // Wire localStorage autosave → cloud sync (when logged in)
  useEffect(() => {
    if (viewMode !== 'workspace' || !authUser) return;
    scheduleCloudSync(buildAutoSaveState(), selectedId ?? '', materialId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, params, features, isSketchMode, materialId, viewMode, authUser]);


  // 스케치 모드 진입/이탈 시 3D 편집 모드는 항상 'none'으로 리셋.
  // 기존에는 setIsSketchMode 호출부마다 setEditMode('none')을 수동으로 붙였으나
  // 누락되는 경로가 있어 단일 지점에서 강제.
  useEffect(() => {
    if (editMode !== 'none') setEditMode('none');
    if (isSketchMode) setSketchStep('draw'); // 스케치 진입 시 항상 draw 단계로 리셋
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSketchMode]);

  // 프로파일 닫힘 감지 — 새 2단계 UX에서는 자동팝업 없이 SketchPanel 버튼으로 처리
  const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
  useEffect(() => {
    // showSketchActionMenu는 더 이상 자동 트리거하지 않음 (SketchPanel의 "3D 변환 설정 →" 버튼 사용)
    if (!activeProfile.closed) {
      setShowSketchActionMenu(false);
    }
  }, [activeProfile.closed]);
  useEffect(() => { if (viewMode !== 'workspace') return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [viewMode]);
  const handleRestoreRecovery = useCallback(() => { if (!recoveryData) return; const sd = SHAPE_MAP[recoveryData.selectedId]; if (sd) { setSelectedId(recoveryData.selectedId); setParams(recoveryData.params); } setIsSketchMode(recoveryData.isSketchMode); if (recoveryData.sketchProfile) setSketchProfile(recoveryData.sketchProfile as SketchProfile); if (recoveryData.sketchConfig) setSketchConfig(recoveryData.sketchConfig as SketchConfig); setActiveTab(recoveryData.activeTab); clearAll(); if (recoveryData.features.length > 0) setTimeout(() => { recoveryData.features.forEach(f => addFeature(f.type as FeatureType)); }, 50); setShowRecovery(false); setViewMode('workspace'); }, [recoveryData, clearAll, addFeature]);
  const handleDismissRecovery = useCallback(() => { setShowRecovery(false); dismissRecovery(); }, [dismissRecovery]);

  // ═══ SHARE LINK RESTORE ═══
  useEffect(() => {
    const shareParam = searchParams?.get('share');
    if (!shareParam) return;
    const decoded = decodeShareLink(shareParam);
    if (!decoded) { addToast('error', lang === 'ko' ? '잘못된 공유 링크입니다' : 'Invalid share link'); return; }
    const shapeConfig = SHAPE_MAP[decoded.shape];
    if (shapeConfig) {
      setSelectedId(decoded.shape);
      const merged: Record<string, number> = {};
      shapeConfig.params.forEach((sp) => { merged[sp.key] = sp.default; });
      Object.assign(merged, decoded.params);
      // Clamp decoded params to valid ranges to prevent out-of-range or zero-size crashes
      shapeConfig.params.forEach((sp) => {
        if (typeof merged[sp.key] === 'number') {
          merged[sp.key] = Math.max(sp.min, Math.min(sp.max, merged[sp.key]));
        } else {
          merged[sp.key] = sp.default;
        }
      });
      setParams(merged);
    }
    if (MATERIAL_PRESETS.some((m) => m.id === decoded.material)) {
      setMaterialId(decoded.material);
    }
    setViewMode('workspace');
    addToast('success', (t as unknown as Record<string, string>).openSharedDesign ?? 'Shared design loaded');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══ TAB PARAM (from generative-design redirect) ═══
  useEffect(() => {
    if (searchParams?.get('tab') === 'optimize') {
      setActiveTab('optimize');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══ PROJECT LOAD (from dashboard ?projectId=xxx) ═══
  useEffect(() => {
    const projectId = searchParams?.get('projectId');
    if (!projectId) return;
    fetch(`/api/nexyfab/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.project?.sceneData) return;
        try {
          const state = JSON.parse(data.project.sceneData);
          // state is AutoSaveState shape
          if (state.selectedId && SHAPE_MAP[state.selectedId]) {
            setSelectedId(state.selectedId);
            if (state.params) setParams(state.params);
          }
          if (typeof state.isSketchMode === 'boolean') setIsSketchMode(state.isSketchMode);
          if (state.activeTab) setActiveTab(state.activeTab);
          if (data.project.materialId && MATERIAL_PRESETS.some((m: { id: string }) => m.id === data.project.materialId)) {
            setMaterialId(data.project.materialId);
          }
          // 채팅 히스토리 복원
          if (Array.isArray(state.chatHistory) && state.chatHistory.length > 0) {
            setChatHistory(state.chatHistory as ChatMessage[]);
          }
          // Store projectId for subsequent cloud saves
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('nexyfab-cloud-project-id', projectId);
          }
          setViewMode('workspace');
          addToast('success', lang === 'ko' ? '설계를 불러왔습니다' : 'Design loaded from cloud');
        } catch {
          addToast('error', lang === 'ko' ? '설계 로드에 실패했습니다' : 'Failed to load design');
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══ SHARED MODEL LOAD (from /view/{token} → sessionStorage) ═══
  useEffect(() => {
    const fromParam = searchParams?.get('from');
    if (fromParam !== 'shared') return;
    try {
      const meshB64 = sessionStorage.getItem('nexyfab_shared_mesh');
      const metaRaw = sessionStorage.getItem('nexyfab_shared_meta');
      if (!meshB64) return;
      sessionStorage.removeItem('nexyfab_shared_mesh');
      sessionStorage.removeItem('nexyfab_shared_meta');

      const json = atob(meshB64);
      const data = JSON.parse(json) as { positions: number[]; normals?: number[]; indices?: number[] };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      if (data.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      if (data.indices) geo.setIndex(data.indices);
      if (!data.normals) geo.computeVertexNormals();
      geo.computeBoundingBox();

      const edgeGeo = new THREE.EdgesGeometry(geo, 15);
      const bb = geo.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const vol = meshVolume(geo) / 1000;
      const sa = meshSurfaceArea(geo) / 100;

      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      setImportedGeometry(geo);
      setImportedFilename(meta.name || 'shared-model');
      setSketchResult({ geometry: geo, edgeGeometry: edgeGeo, volume_cm3: vol, surface_area_cm2: sa, bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } });
      setIsSketchMode(false);
      setViewMode('workspace');
      addToast('success', lang === 'ko' ? '공유된 모델을 불러왔습니다' : 'Shared model loaded');
    } catch (e) {
      console.error('Failed to load shared model:', e);
      addToast('error', lang === 'ko' ? '공유 모델 로드 실패' : 'Failed to load shared model');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══ VERSION HISTORY ═══
  const {
    versions, saveVersion, restoreVersion, deleteVersion, renameVersion,
    branches, activeBranch, createBranch, switchBranch, mergeBranch, deleteBranch, compareBranches,
  } = useVersionHistory();
  const showBranchCompare = useUIStore(s => s.showBranchCompare);
  const setShowBranchCompare = useUIStore(s => s.setShowBranchCompare);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sketchContainerRef = useRef<HTMLDivElement>(null);
  const [sketchSize, setSketchSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const el = sketchContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSketchSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const captureCurrentThumbnail = useCallback((): string | undefined => {
    const canvas = canvasRef.current || document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return undefined;
    try { return captureCanvasSnapshot(canvas, 200); } catch { return undefined; }
  }, []);
  const handleSaveVersionSnapshot = useCallback(() => {
    const thumbnail = captureCurrentThumbnail();
    saveVersion(selectedId, params, featuresToSerialize, thumbnail);
    addToast('success', lang === 'ko' ? '스냅샷이 저장되었습니다' : 'Snapshot saved');
  }, [selectedId, params, featuresToSerialize, captureCurrentThumbnail, saveVersion, addToast, lang]);
  const handleRestoreVersion = useCallback((version: DesignVersion) => {
    const sd = SHAPE_MAP[version.shapeId];
    if (sd) { setSelectedId(version.shapeId); setParams(version.params); const e: Record<string, string> = {}; Object.entries(version.params).forEach(([k, v]) => { e[k] = String(v); }); setParamExpressions(e); }
    clearAll();
    if (version.features.length > 0) { setTimeout(() => { version.features.forEach(f => addFeature(f.type as FeatureType)); }, 50); }
    setShowVersionPanel(false);
    addToast('success', lang === 'ko' ? '버전이 복원되었습니다' : 'Version restored');
  }, [clearAll, addFeature, addToast, lang]);
  const prevVersionShapeRef = useRef(selectedId);
  const prevVersionFeatLenRef = useRef(features.length);
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    const shapeChanged = prevVersionShapeRef.current !== selectedId;
    const featChanged = prevVersionFeatLenRef.current !== features.length;
    prevVersionShapeRef.current = selectedId;
    prevVersionFeatLenRef.current = features.length;
    if (shapeChanged || featChanged) { const thumbnail = captureCurrentThumbnail(); saveVersion(selectedId, params, featuresToSerialize, thumbnail); }
  }, [selectedId, features.length, viewMode, params, featuresToSerialize, captureCurrentThumbnail, saveVersion]);

  // ═══ BRANCH HANDLERS ═══
  const handleCreateBranch = useCallback((name: string) => { createBranch(name); addToast('success', lang === 'ko' ? `브랜치 "${name}" 생성됨` : `Branch "${name}" created`); }, [createBranch, addToast, lang]);
  const handleSwitchBranch = useCallback((branchId: string) => { const latestVersion = switchBranch(branchId); if (latestVersion) { const sd = SHAPE_MAP[latestVersion.shapeId]; if (sd) { setSelectedId(latestVersion.shapeId); setParams(latestVersion.params); const e: Record<string, string> = {}; Object.entries(latestVersion.params).forEach(([k, v]) => { e[k] = String(v); }); setParamExpressions(e); } clearAll(); if (latestVersion.features.length > 0) { setTimeout(() => { latestVersion.features.forEach(f => addFeature(f.type as FeatureType)); }, 50); } } const branchName = branches.find(b => b.id === branchId)?.name || branchId; addToast('success', lang === 'ko' ? `브랜치 "${branchName}"(으)로 전환` : `Switched to branch "${branchName}"`); }, [switchBranch, branches, clearAll, addFeature, addToast, lang]);
  const handleDeleteBranch = useCallback((branchId: string) => { const branchName = branches.find(b => b.id === branchId)?.name || branchId; const ok = deleteBranch(branchId); if (ok) addToast('success', lang === 'ko' ? `브랜치 "${branchName}" 삭제됨` : `Branch "${branchName}" deleted`); }, [deleteBranch, branches, addToast, lang]);
  const handleMergeBranch = useCallback((sourceBranchId: string, targetBranchId: string) => { const merged = mergeBranch(sourceBranchId, targetBranchId); if (merged) { const srcName = branches.find(b => b.id === sourceBranchId)?.name || sourceBranchId; const tgtName = branches.find(b => b.id === targetBranchId)?.name || targetBranchId; addToast('success', lang === 'ko' ? `"${srcName}" -> "${tgtName}" 병합 완료` : `Merged "${srcName}" into "${tgtName}"`); } }, [mergeBranch, branches, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // GALLERY → WORKSPACE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  const handleEnterWorkspace = useCallback((shapeId: string, initParams: Record<string, number>) => {
    const shapeDef = SHAPE_MAP[shapeId];
    if (shapeDef) {
      setSelectedId(shapeId);
      const p: Record<string, number> = {};
      shapeDef.params.forEach((sp) => { p[sp.key] = sp.default; });
      Object.entries(initParams).forEach(([k, v]) => { if (typeof v === 'number' && k in p) p[k] = v; });
      setParams(p);
    }
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    setIsSketchMode(false);
    setShowAIAssistant(false);
    setPendingChatMsg(null);
    setViewMode('workspace');
  }, [clearAll]);

  const handleEnterBlankSketch = useCallback(() => {
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    setIsSketchMode(true);
    setSketchProfile({ segments: [], closed: false });
    setSketchViewMode('2d');
    openAIAssistant('chat');
    setPendingChatMsg(null);
    setViewMode('workspace');
  }, [clearAll]);

  const handleChatFromGallery = useCallback((message: string) => {
    setPendingChatMsg(message);
    openAIAssistant('chat');
    // Don't force sketch mode — let the AI response decide
    setViewMode('workspace');
  }, [openAIAssistant]);

  const handleBackToGallery = useCallback(() => {
    setViewMode('gallery');
    setPendingChatMsg(null);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // SHAPE DESIGN HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const shape = useMemo(() => SHAPES.find(s => s.id === selectedId) ?? SHAPES[0], [selectedId]);

  const handleSelectShape = useCallback((s: ShapeConfig) => {
    // Push current state to history before changing
    history.push({ selectedId, params: { ...params }, featureIds: features.map(f => f.id) });
    setSelectedId(s.id);
    const p: Record<string, number> = {};
    const e: Record<string, string> = {};
    s.params.forEach(sp => { p[sp.key] = sp.default; e[sp.key] = String(sp.default); });
    setParams(p);
    setParamExpressions(e);
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    setShowManufacturingCard(false); // reset so useEffect re-triggers
  }, [clearAll, selectedId, params, features, history]);

  const handleParamChange = useCallback((key: string, value: number) => {
    setParam(key, value);
    setParamExpression(key, String(value));
  }, [setParam, setParamExpression]);

  const handleExpressionChange = useCallback((key: string, expr: string) => {
    setParamExpression(key, expr);
    // Build variables from current params + model vars (excluding current key to avoid circular ref)
    const variables: ExprVariable[] = [
      ...Object.entries(params).filter(([k]) => k !== key).map(([name, value]) => ({ name, value })),
      ...modelVars.map(v => ({ name: v.name, value: v.value })),
    ];
    try {
      const result = evaluateExpression(expr, variables);
      if (isFinite(result)) {
        setParam(key, result);
      }
    } catch {
      // Invalid expression — don't update numeric value
    }
  }, [params, modelVars, setParam, setParamExpression]);

  // Push to history on significant param changes (debounced via blur/enter)
  const handleParamCommit = useCallback(() => {
    history.push({ selectedId, params: { ...params }, featureIds: features.map(f => f.id) });
  }, [history, selectedId, params, features]);

  const handleShapeReset = useCallback(() => {
    history.push({ selectedId, params: { ...params }, featureIds: features.map(f => f.id) });
    const p: Record<string, number> = {};
    const e: Record<string, string> = {};
    shape.params.forEach(sp => { p[sp.key] = sp.default; e[sp.key] = String(sp.default); });
    setParams(p);
    setParamExpressions(e);
    clearAll();
    setSelectedFeatureId(null);
    // Reset formula values to defaults for new shape
    if (shape.formulaFields) {
      const fv: Record<string, string> = {};
      shape.formulaFields.forEach(ff => { fv[ff.key] = ff.default; });
      setFormulaValues(fv);
    } else {
      setFormulaValues({});
    }
  }, [shape, clearAll, history, selectedId, params, features]);

  // ── Formula values (for functionSurface / latheProfile etc.) ──────────────
  const [formulaValues, setFormulaValues] = React.useState<Record<string, string>>(() => {
    const fv: Record<string, string> = {};
    shape.formulaFields?.forEach(ff => { fv[ff.key] = ff.default; });
    return fv;
  });

  // Re-initialise when shape changes to a different formula-driven shape
  const prevShapeIdRef = React.useRef(selectedId);
  React.useEffect(() => {
    if (prevShapeIdRef.current !== selectedId) {
      prevShapeIdRef.current = selectedId;
      const fv: Record<string, string> = {};
      shape.formulaFields?.forEach(ff => { fv[ff.key] = ff.default; });
      setFormulaValues(fv);
    }
  }, [selectedId, shape]);

  const handleFormulaChange = useCallback((key: string, value: string) => {
    setFormulaValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleHistoryUndo = useCallback(() => {
    const snap = history.undo();
    if (!snap) return;
    setSelectedId(snap.selectedId);
    setParams(snap.params);
  }, [history]);

  const handleHistoryRedo = useCallback(() => {
    const snap = history.redo();
    if (!snap) return;
    setSelectedId(snap.selectedId);
    setParams(snap.params);
  }, [history]);

  // ─── Command-pattern wrappers (for tracked undo/redo via CommandHistory) ────

  const handleParamChangeCmd = useCallback((key: string, value: number) => {
    const oldValue = params[key];
    if (oldValue === value) return;
    const id = `param-${key}-${Date.now()}`;
    commandHistory.execute({
      id,
      label: `Set ${key} = ${value}`,
      labelKo: `${key} = ${value} 설정`,
      execute: () => {
        setParam(key, value);
        setParamExpression(key, String(value));
      },
      undo: () => {
        setParam(key, oldValue);
        setParamExpression(key, String(oldValue));
      },
    });
  }, [params, setParam, setParamExpression]);

  const handleShapeChangeCmd = useCallback((s: ShapeConfig) => {
    const prevId = selectedId;
    const prevParams = { ...params };
    const id = `shape-${s.id}-${Date.now()}`;
    const newP: Record<string, number> = {};
    const newE: Record<string, string> = {};
    s.params.forEach(sp => { newP[sp.key] = sp.default; newE[sp.key] = String(sp.default); });
    commandHistory.execute({
      id,
      label: `Shape → ${s.id}`,
      labelKo: `형상 변경 → ${s.id}`,
      execute: () => {
        history.push({ selectedId: prevId, params: prevParams, featureIds: features.map(f => f.id) });
        setSelectedId(s.id);
        setParams(newP);
        setParamExpressions(newE);
        clearAll();
        setSelectedFeatureId(null);
        setSketchResult(null);
        setEditMode('none');
      },
      undo: () => {
        setSelectedId(prevId);
        setParams(prevParams);
        const e: Record<string, string> = {};
        Object.entries(prevParams).forEach(([k, v]) => { e[k] = String(v); });
        setParamExpressions(e);
      },
    });
  }, [selectedId, params, features, history, clearAll]);

  const handleAddFeatureCmd = useCallback((type: FeatureType) => {
    const id = `add-feature-${type}-${Date.now()}`;
    commandHistory.execute({
      id,
      label: `Add feature: ${type}`,
      labelKo: `피처 추가: ${type}`,
      execute: () => { addFeature(type); },
      undo: () => { undoLast(); },
    });
  }, [addFeature, undoLast]);

  const handleRemoveFeatureCmd = useCallback((featureId: string) => {
    // Capture the node before removal so undo can restore it
    const snapshot = featureHistory?.nodes.find(n => n.id === featureId);
    const id = `remove-feature-${featureId}-${Date.now()}`;
    commandHistory.execute({
      id,
      label: `Remove feature`,
      labelKo: `피처 제거`,
      execute: () => { removeFeature(featureId); },
      undo: () => {
        if (!snapshot || !snapshot.featureType) {
          addToast('warning', lang === 'ko' ? '피처를 복원할 수 없습니다' : 'Cannot restore feature');
          return;
        }
        // Re-add the feature with its original params
        addFeature(snapshot.featureType);
        // Restore params after a tick so the new node is in the tree
        setTimeout(() => {
          const nodes = getOrderedNodes();
          const restored = nodes[nodes.length - 1];
          if (restored) {
            Object.entries(snapshot.params).forEach(([key, val]) => {
              updateFeatureParam(restored.id, key, val);
            });
          }
        }, 0);
        addToast('success', lang === 'ko' ? '피처가 복원되었습니다' : 'Feature restored');
      },
    });
  }, [removeFeature, featureHistory, addFeature, updateFeatureParam, getOrderedNodes, addToast, lang]);

  const handleMoveFeatureByIds = useCallback((fromId: string, toId: string) => {
    const ordered = getOrderedNodes().filter(n => n.type === 'feature' && n.featureType);
    const fromIdx = ordered.findIndex(n => n.id === fromId);
    const toIdx = ordered.findIndex(n => n.id === toId);
    if (fromIdx >= 0 && toIdx >= 0) moveFeature(fromIdx, toIdx);
  }, [moveFeature, getOrderedNodes]);

  // ── Base shape generation (sync, lightweight) ──────────────────────────────
  const baseShapeResult: ShapeResult | null = useMemo(() => {
    try {
      const resolvedParams: Record<string, number> = {};
      shape.params.forEach(sp => { resolvedParams[sp.key] = sp.key in debouncedParams ? debouncedParams[sp.key] : sp.default; });
      return shape.generate(resolvedParams, Object.keys(formulaValues).length > 0 ? formulaValues : undefined);
    } catch { return null; }
  }, [shape, debouncedParams, formulaValues]);

  // ── Feature pipeline (async, off main thread via Worker) ───────────────────
  const [result, setResult] = useState<ShapeResult | null>(null);

  useEffect(() => {
    if (!baseShapeResult) {
      setResult(null);
      return;
    }

    const hasEnabledFeatures = features.length > 0 && features.some(f => f.enabled);

    if (!hasEnabledFeatures) {
      // No features — base result is the final result; clear stale errors.
      setPipelineErrors(prev => (Object.keys(prev).length === 0 ? prev : {}));
      setResult(baseShapeResult);
      return;
    }

    // Run features asynchronously via the Web Worker.
    // occtMode is a dep so changing the topology engine triggers a re-run.
    let cancelled = false;

    runPipelineWorker(baseShapeResult.geometry, features, { occtMode }).then(pipe => {
      if (cancelled) return;
      const finalGeometry = pipe.geometry;
      setPipelineErrors(prev => {
        const sameKeys = Object.keys(pipe.errors).length === Object.keys(prev).length
          && Object.keys(pipe.errors).every(k => prev[k] === pipe.errors[k]);
        return sameKeys ? prev : pipe.errors;
      });
      const edgeGeometry = makeEdges(finalGeometry);
      const volume_cm3 = meshVolume(finalGeometry) / 1000;
      const surface_area_cm2 = meshSurfaceArea(finalGeometry) / 100;
      finalGeometry.computeBoundingBox();
      const bb = finalGeometry.boundingBox;
      if (!bb || cancelled) return;
      const size = bb.getSize(new THREE.Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setResult({ geometry: finalGeometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
    }).catch(() => {
      // On worker failure fall back to the base result so the viewport is never blank.
      if (!cancelled) setResult(baseShapeResult);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseShapeResult, features, occtMode, runPipelineWorker]);

  // Merge pipeline errors into history nodes so FeatureTree can render diagnostics
  const featureHistoryWithErrors = useMemo(() => {
    if (!featureHistory) return featureHistory;
    const hasErrors = Object.keys(pipelineErrors).length > 0;
    const anyStaleError = featureHistory.nodes.some(n => n.error && !pipelineErrors[n.id]);
    if (!hasErrors && !anyStaleError) return featureHistory;
    return {
      ...featureHistory,
      nodes: featureHistory.nodes.map(n => {
        const live = pipelineErrors[n.id];
        if (live) return { ...n, error: live };
        if (n.error) return { ...n, error: undefined };
        return n;
      }),
    };
  }, [featureHistory, pipelineErrors]);

  // In sketch mode show only the extruded sketch; in shape mode show the parametric shape.
  // Do NOT fall back to the parametric result when in sketch mode — that causes a ghost
  // shape to appear in the 3D viewport before the user has drawn anything.
  const effectiveResult = isSketchMode ? sketchResult : result;

  // ── Live sketch geometry (Feature 5) ──
  const liveSketchGeo = useMemo(() => {
    if (!isSketchMode) return null;
    const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
    if (!activeProfile.closed || activeProfile.segments.length === 0) return null;
    try {
      return profileToGeometry(activeProfile, sketchConfig);
    } catch {
      return null;
    }
  }, [isSketchMode, sketchProfiles, activeProfileIdx, sketchProfile, sketchConfig]);

  const liveSketchResult = useMemo(() => {
    if (!liveSketchGeo) return null;
    liveSketchGeo.computeBoundingBox();
    const bb = liveSketchGeo.boundingBox;
    if (!bb) return null;
    const size = bb.getSize(new THREE.Vector3());
    return {
      geometry: liveSketchGeo,
      edgeGeometry: makeEdges(liveSketchGeo),
      volume_cm3: meshVolume(liveSketchGeo) / 1000,
      surface_area_cm2: meshSurfaceArea(liveSketchGeo) / 100,
      bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) },
    } as import('./shapes').ShapeResult;
  }, [liveSketchGeo]);

  // ── Geometry metrics for cost estimation ──
  const geometryMetrics = useMemo((): GeometryMetrics | null => {
    if (!effectiveResult) return null;
    const geo = effectiveResult.geometry;
    const pos = geo.attributes.position;
    const triCount = geo.index ? geo.index.count / 3 : (pos ? pos.count / 3 : 0);
    const bboxVol = effectiveResult.bbox.w * effectiveResult.bbox.h * effectiveResult.bbox.d;
    const complexity = bboxVol > 0 ? Math.min(triCount / (bboxVol * 0.01), 1) : 0.5;
    return {
      volume_cm3: effectiveResult.volume_cm3,
      surfaceArea_cm2: effectiveResult.surface_area_cm2,
      boundingBox: effectiveResult.bbox,
      complexity,
    };
  }, [effectiveResult]);

  // ── Plugin system integration ──
  const { toolbarButtons: pluginToolbarButtons, customShapes: pluginCustomShapes } = usePlugins({
    getSelectedShape: () => selectedId,
    getParams: () => params,
    getGeometry: () => effectiveResult?.geometry ?? null,
    setParam: (key, value) => setParam(key, value),
    addFeature: (type) => addFeature(type as FeatureType),
    showToast: addToast,
  });

  // ── Async boolean via Web Worker (for standalone boolean operations) ──
  const handleBooleanAsync = useCallback(
    (geometry: THREE.BufferGeometry, boolParams: Record<string, number>) =>
      applyBooleanAsync(geometry, boolParams, performCSG),
    [performCSG],
  );

  // Build design context for AI chat (includes DFM/FEA/mass/cost for AI-aware advice)
  const designContext = useMemo(() => {
    // Mass: volume × material density (g/cm³)
    const mat = MATERIAL_PRESETS.find(m => m.id === materialId);
    const density = mat?.density ?? 2.7;
    const massG = effectiveResult ? effectiveResult.volume_cm3 * density : null;

    // Cost: cheapest process unit cost estimate (pure, fast)
    let estimatedUnitCostUSD: number | null = null;
    if (geometryMetrics) {
      try {
        const estimates = estimateCosts(geometryMetrics, materialId, [1]);
        if (estimates.length > 0) {
          const best = estimates.reduce((a, b) => a.unitCost < b.unitCost ? a : b);
          // Convert KRW → USD if needed (rough rate)
          estimatedUnitCostUSD = best.currency === 'KRW' ? best.unitCost / 1300 : best.unitCost;
        }
      } catch {
        // estimateCosts failure is non-fatal
      }
    }

    return {
      shapeId: isSketchMode ? null : selectedId,
      params: isSketchMode ? {} : { ...params },
      features: enabledFeaturesForContext,
      isSketchMode,
      hasSketchResult: !!sketchResult,
      bbox: effectiveResult ? effectiveResult.bbox : null,
      volume_cm3: effectiveResult ? effectiveResult.volume_cm3 : null,
      dfmScore: getBestDFMScore(dfmResults),
      dfmIssues: getTopDFMIssues(dfmResults, 5),
      feaMaxStressMPa: feaResult?.maxStress ?? null,
      feaSafetyFactor: feaResult?.safetyFactor ?? null,
      massG,
      estimatedUnitCostUSD: estimatedUnitCostUSD !== null ? Math.round(estimatedUnitCostUSD * 100) / 100 : null,
    };
  }, [selectedId, params, enabledFeaturesForContext, isSketchMode, sketchResult, effectiveResult, dfmResults, feaResult, materialId, geometryMetrics]);

  // Param-level DFM warnings: used by LeftPanel to show inline badges on sliders
  const dfmParamWarnings = useMemo(
    () => mapDFMToParams(dfmResults, params),
    [dfmResults, params],
  );

  // ── Proactive Advisor — auto-alerts on DFM/FEA degradation after idle ──
  useProactiveAdvisor({
    params,
    dfmResults,
    feaSafetyFactor: feaResult?.safetyFactor ?? null,
    dfmScore: getBestDFMScore(dfmResults),
    shapeId: selectedId,
    lang,
    addToast,
    onOpenAdvisor: () => openAIAssistant('chat'),
  });

  // ── Auto-DFM: debounced background analysis whenever geometry changes ────────
  // Runs with default cnc_milling + injection_molding, updates dfmResults silently.
  // Badge on the DFM toolbar button reflects error/warning count from this run.
  useEffect(() => {
    if (!effectiveResult?.geometry) return;
    if (!planLimits.dfmAnalysis) return; // free plan — skip silent analysis
    const timer = setTimeout(async () => {
      try {
        const results = await analyzeDFMWorker(
          effectiveResult.geometry!,
          ['cnc_milling', 'injection_molding'],
          { minWallThickness: 1.0, minDraftAngle: 1.0, maxAspectRatio: 4.0 },
        );
        setDfmResults(results);
      } catch {
        // silent — user can manually trigger full analysis
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [effectiveResult, analyzeDFMWorker, planLimits.dfmAnalysis, setDfmResults]);

  // Count of DFM error/warning issues from last analysis (drives toolbar badge)
  const dfmIssueCount = useMemo(
    () => dfmResults ? dfmResults.reduce((n, r) => n + r.issues.filter(i => i.severity !== 'info').length, 0) : 0,
    [dfmResults],
  );

  // Process recommendation based on used feature types + geometry
  const processRecommendations = useProcessRecommendation(
    features,
    effectiveResult?.geometry ?? null,
  );

  // ── Manufacturing flow (extracted hook) ──
  const {
    showManufacturingCard, setShowManufacturingCard,
    showManufacturerMatch, setShowManufacturerMatch,
    rfqPending,
    handleGetQuote,
  } = useManufacturingFlow({
    effectiveResult,
    selectedId,
    sketchResult,
    materialId,
    dfmResults,
    planLimits,
    lang,
    langSeg,
    addToast,
    router,
    setShowUpgradePrompt,
    setUpgradeFeature,
  });

  // ── IP Share flow (extracted hook) ──
  const {
    isCreatingShare,
    shareUrl,
    showShareConfirm, setShowShareConfirm,
    handleIPShare,
    copyShareUrl,
    resetShare,
  } = useIPShareFlow(effectiveResult, authUser, lang, addToast);

  const handleAddToCart = useCallback(() => {
    if (!effectiveResult) return;
    if (!checkCartLimit(cartItems.length)) return;
    const thumbnail = captureRef.current ? captureRef.current() : null;
    const shapeName = sketchResult ? 'Custom Sketch' : ((t as any)[`shapeName_${selectedId}`] || selectedId);
    addCartItem({
      shapeId: sketchResult ? 'sketch' : selectedId, shapeName, params: sketchResult ? {} : { ...params },
      featureCount: features.filter(f => f.enabled).length, thumbnail,
      volume_cm3: effectiveResult.volume_cm3, surface_area_cm2: effectiveResult.surface_area_cm2, bbox: effectiveResult.bbox,
    });
    setCartAdded(true);
    setTimeout(() => setCartAdded(false), 1500);
  }, [effectiveResult, sketchResult, selectedId, params, features, t, addCartItem, cartItems.length, checkCartLimit]);

  const handleChatApplySingle = useCallback((r: { shapeId: string | null; params: Record<string, number>; features: Array<{ type: FeatureType; params: Record<string, number> }>; message: string }) => {
    if (!r.shapeId) return;
    const shapeDef = SHAPE_MAP[r.shapeId];
    if (!shapeDef) {
      addToast('warning', lang === 'ko' ? `형상 "${r.shapeId}"을 찾을 수 없습니다` : `Shape "${r.shapeId}" not found`);
      return;
    }
    // Exit sketch mode and show the parametric shape
    setIsSketchMode(false);
    setSketchResult(null);
    setBomParts([]); setBomLabel('');
    setSelectedId(r.shapeId);
    const p: Record<string, number> = {};
    shapeDef.params.forEach((sp) => { p[sp.key] = sp.default; });
    Object.entries(r.params).forEach(([k, v]) => { if (typeof v === 'number' && k in p) p[k] = v; });
    setParams(p);
    clearAll(); setSelectedFeatureId(null);
    if (r.features?.length > 0) setTimeout(() => { r.features.forEach(f => addFeature(f.type)); }, 50);
  }, [clearAll, addFeature, addToast, lang]);

  const generatePartResult = useCallback((shapeId: string, partParams: Record<string, number>, partFeatures?: Array<{ type: FeatureType; params: Record<string, number> }>): ShapeResult | null => {
    const shapeDef = SHAPE_MAP[shapeId];
    if (!shapeDef) return null;
    const p: Record<string, number> = {};
    shapeDef.params.forEach((sp) => { p[sp.key] = sp.default; });
    Object.entries(partParams).forEach(([k, v]) => { if (typeof v === 'number' && k in p) p[k] = v; });
    // Clamp params to valid min/max ranges to prevent zero-size or out-of-range crashes
    shapeDef.params.forEach((sp) => {
      if (p[sp.key] !== undefined) {
        p[sp.key] = Math.max(sp.min, Math.min(sp.max, p[sp.key]));
      }
    });
    try {
      const baseResult = shapeDef.generate(p);
      // Apply features if provided
      if (partFeatures && partFeatures.length > 0) {
        try {
          const featureStack = partFeatures.map((f, i) => ({
            id: `bom-feat-${i}`, type: f.type, params: f.params, enabled: true,
          }));
          const finalGeo = applyFeaturePipeline(baseResult.geometry, featureStack);
          const edgeGeometry = makeEdges(finalGeo);
          const volume_cm3 = meshVolume(finalGeo) / 1000;
          const surface_area_cm2 = meshSurfaceArea(finalGeo) / 100;
          finalGeo.computeBoundingBox();
          const bb = finalGeo.boundingBox;
          if (!bb) return baseResult;
          const size = bb.getSize(new THREE.Vector3());
          const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
          return { geometry: finalGeo, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
        } catch (err) {
          console.error('[FeaturePipeline] apply failed:', err);
          return baseResult;
        }
      }
      return baseResult;
    } catch { return null; }
  }, []);

  const handleChatApplyBom = useCallback((parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features: Array<{ type: FeatureType; params: Record<string, number> }>; quantity: number; position?: [number, number, number]; rotation?: [number, number, number] }>, productName?: string) => {
    // Exit sketch mode and show the assembly
    setIsSketchMode(false);
    setSketchResult(null);
    const bomResults: BomPartResult[] = [];
    for (const part of parts) {
      const sr = generatePartResult(part.shapeId, part.params, part.features);
      if (sr) bomResults.push({ name: part.name, result: sr, position: part.position, rotation: part.rotation });
    }
    setBomParts(bomResults);
    setBomLabel(productName || 'Assembly');
    for (const part of parts) {
      const sr = generatePartResult(part.shapeId, part.params, part.features);
      if (!sr) continue;
      const qty = part.quantity || 1;
      for (let q = 0; q < qty; q++) {
        addCartItem({ shapeId: part.shapeId, shapeName: qty > 1 ? `${part.name} #${q + 1}` : part.name, params: part.params, featureCount: part.features?.length || 0, thumbnail: null, volume_cm3: sr.volume_cm3, surface_area_cm2: sr.surface_area_cm2, bbox: sr.bbox });
      }
    }
    if (parts.length > 0) {
      const first = parts[0];
      setSelectedId(first.shapeId);
      const shapeDef = SHAPE_MAP[first.shapeId];
      if (shapeDef) {
        const p: Record<string, number> = {};
        shapeDef.params.forEach((sp) => { p[sp.key] = sp.default; });
        Object.entries(first.params).forEach(([k, v]) => { if (typeof v === 'number' && k in p) p[k] = v; });
        setParams(p);
      }
      clearAll(); setSelectedFeatureId(null);
    }
  }, [generatePartResult, addCartItem, clearAll]);

  const handleBomPreview = useCallback((parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features?: Array<{ type: FeatureType; params: Record<string, number> }>; position?: [number, number, number]; rotation?: [number, number, number] }>, productName: string) => {
    // Exit sketch mode to show 3D assembly
    setIsSketchMode(false);
    setSketchResult(null);
    const bomResults: BomPartResult[] = [];
    for (const part of parts) {
      const sr = generatePartResult(part.shapeId, part.params, part.features);
      if (sr) bomResults.push({ name: part.name, result: sr, position: part.position, rotation: part.rotation });
    }
    setBomParts(bomResults);
    setBomLabel(productName || 'Assembly');
  }, [generatePartResult]);

  const handleBatchQuote = useCallback(() => {
    if (cartItems.length === 0) return;
    router.push(`/${langSeg}/quick-quote/?from=shape-cart&count=${cartItems.length}`);
  }, [cartItems, langSeg, router]);

  // ── Export loading state ──
  const [exportingFormat, setExportingFormat] = React.useState<string | null>(null);

  // ── BOM Export ──
  const [showBomExportMenu, setShowBomExportMenu] = useState(false);
  const buildBomRows = useCallback((): BomRow[] => {
    const rows: BomRow[] = [];
    if (bomParts.length > 0) {
      bomParts.forEach((part) => {
        const r = part.result;
        const mat = materialId;
        rows.push({ no: rows.length + 1, name: part.name, shape: part.name, material: mat, dimensions: `${r.bbox.w.toFixed(1)}\u00d7${r.bbox.h.toFixed(1)}\u00d7${r.bbox.d.toFixed(1)} mm`, volume_cm3: r.volume_cm3, surface_area_cm2: r.surface_area_cm2, weight_g: estimateWeight(r.volume_cm3, mat), quantity: 1 });
      });
    }
    if (cartItems.length > 0) {
      cartItems.forEach((item) => {
        const mat = materialId;
        rows.push({ no: rows.length + 1, name: item.shapeName, shape: item.shapeId, material: mat, dimensions: `${item.bbox.w.toFixed(1)}\u00d7${item.bbox.h.toFixed(1)}\u00d7${item.bbox.d.toFixed(1)} mm`, volume_cm3: item.volume_cm3, surface_area_cm2: item.surface_area_cm2, weight_g: estimateWeight(item.volume_cm3, mat), quantity: 1 });
      });
    }
    if (rows.length === 0 && effectiveResult) {
      const sn = sketchResult ? 'Custom Sketch' : ((t as any)[`shapeName_${selectedId}`] || selectedId);
      const mat = materialId;
      rows.push({ no: 1, name: sn, shape: sketchResult ? 'sketch' : selectedId, material: mat, dimensions: `${effectiveResult.bbox.w.toFixed(1)}\u00d7${effectiveResult.bbox.h.toFixed(1)}\u00d7${effectiveResult.bbox.d.toFixed(1)} mm`, volume_cm3: effectiveResult.volume_cm3, surface_area_cm2: effectiveResult.surface_area_cm2, weight_g: estimateWeight(effectiveResult.volume_cm3, mat), quantity: 1 });
    }
    return rows;
  }, [bomParts, cartItems, effectiveResult, sketchResult, selectedId, t, materialId]);
  const handleExportBomCSV = useCallback(() => { const rows = buildBomRows(); if (rows.length === 0) return; exportBomCSV(rows, `BOM_${bomLabel || 'export'}.csv`); setShowBomExportMenu(false); }, [buildBomRows, bomLabel]);
  const handleExportBomExcel = useCallback(() => { const rows = buildBomRows(); if (rows.length === 0) return; exportBomExcel(rows, `BOM_${bomLabel || 'export'}.xls`); setShowBomExportMenu(false); }, [buildBomRows, bomLabel]);

  // ══════════════════════════════════════════════════════════════════════════
  // SKETCH HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSketchGenerate = useCallback(() => {
    // Use multi-profile geometry when more than one profile exists, else fall back
    const geo = sketchProfiles.length > 1
      ? profileToGeometryMulti(sketchProfiles, sketchConfig)
      : profileToGeometry(sketchProfile, sketchConfig);
    if (!geo) {
      addToast('warning', lang === 'ko'
        ? '스케치를 완성해주세요 — 선분 3개 이상을 연결하여 닫힌 프로파일을 만드세요'
        : 'Complete the sketch — connect 3+ segments into a closed profile');
      return;
    }
    const edgeGeometry = makeEdges(geo);
    const volume_cm3 = meshVolume(geo) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geo) / 100;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new THREE.Vector3());
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
    setBomParts([]); setBomLabel('');
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3, surface_area_cm2, bbox });

    // Save to sketch history when there is meaningful content
    if (sketchProfile.segments.length > 0) {
      const histEntry: SketchHistoryEntry = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `sh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        profile: sketchProfile,
        config: sketchConfig,
        plane: sketchPlane,
        timestamp: Date.now(),
        thumbnail: generateSketchThumbnail(sketchProfile),
        label: `Sketch ${sketchHistory.length + 1}`,
      };
      setSketchHistory(prev => {
        const updated = [...prev, histEntry].slice(-20);
        saveSketchHistory(updated);
        return updated;
      });
    }

    setEditingSketchFeatureId(null);
    setSketchStep('draw'); // 3D 생성 완료 후 다음 진입을 위해 리셋
    sketchGeneratedRef.current = true;
    setIsSketchMode(false);
    setShowManufacturingCard(true);

    // #wf1: Guide user to next step after sketch generation
    addToast('success', lang === 'ko'
      ? '3D 형상 생성 완료! 왼쪽 패널에서 재질을 선택하고 Export하거나 RFQ로 보내세요.'
      : '3D shape generated! Select a material in the left panel, then export or send to RFQ.',
      5000);

    // Auto-save to cloud (fire-and-forget, only when logged in)
    if (useAuthStore.getState().user) {
      void useProjectsStore.getState().saveProject({
        name: `Sketch ${new Date().toLocaleDateString('ko-KR')}`,
        shapeId: 'sketch',
        tags: ['sketch'],
      });
    }
  }, [sketchProfile, sketchProfiles, sketchConfig, sketchPlane, sketchHistory]);

  // #wf10: context-restore toast when exiting sketch mode without generating
  const prevIsSketchModeRef = useRef(false);
  const sketchGeneratedRef = useRef(false);
  const sketchProfileRef = useRef(sketchProfile);
  sketchProfileRef.current = sketchProfile;
  const langRef = useRef(lang);
  langRef.current = lang;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  useEffect(() => {
    if (prevIsSketchModeRef.current && !isSketchMode) {
      if (!sketchGeneratedRef.current) {
        const hasSegments = sketchProfileRef.current.segments.length > 0;
        if (hasSegments) {
          addToastRef.current('info', langRef.current === 'ko'
            ? '스케치 모드 종료. 스케치 내용은 보존됩니다. 다시 S를 눌러 재진입하세요.'
            : 'Sketch mode exited. Your sketch is preserved. Press S to re-enter.', 4000);
        }
      }
      sketchGeneratedRef.current = false;
    }
    prevIsSketchModeRef.current = isSketchMode;
  }, [isSketchMode]);

  // ── Sketch undo/redo stack (unlimited, covers profiles + constraints + dimensions) ──
  type SketchSnapshot = {
    profiles: SketchProfile[];
    constraints: SketchConstraint[];
    dimensions: SketchDimension[];
    activeIdx: number;
  };
  const sketchUndoRef = useRef<SketchSnapshot[]>([]);
  const sketchRedoRef = useRef<SketchSnapshot[]>([]);

  const captureSketchSnapshot = useCallback(() => {
    sketchUndoRef.current = [
      ...sketchUndoRef.current.slice(-49),
      {
        profiles: sketchProfiles,
        constraints: sketchConstraints,
        dimensions: sketchDimensions,
        activeIdx: activeProfileIdx,
      }
    ];
    sketchRedoRef.current = []; // clear redo branch on new action
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx]);

  const handleSketchUndo = useCallback(() => {
    const snap = sketchUndoRef.current.pop();
    if (!snap) return;
    sketchRedoRef.current.push({
      profiles: sketchProfiles,
      constraints: sketchConstraints,
      dimensions: sketchDimensions,
      activeIdx: activeProfileIdx,
    });
    setSketchProfiles(snap.profiles);
    setSketchProfile(snap.profiles[snap.activeIdx] ?? { segments: [], closed: false });
    setSketchConstraints(snap.constraints);
    setSketchDimensions(snap.dimensions);
    setActiveProfileIdx(snap.activeIdx);
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx, setSketchProfile, setSketchProfiles, setSketchConstraints, setSketchDimensions, setActiveProfileIdx]);

  const handleSketchRedo = useCallback(() => {
    const snap = sketchRedoRef.current.pop();
    if (!snap) return;
    sketchUndoRef.current.push({
      profiles: sketchProfiles,
      constraints: sketchConstraints,
      dimensions: sketchDimensions,
      activeIdx: activeProfileIdx,
    });
    setSketchProfiles(snap.profiles);
    setSketchProfile(snap.profiles[snap.activeIdx] ?? { segments: [], closed: false });
    setSketchConstraints(snap.constraints);
    setSketchDimensions(snap.dimensions);
    setActiveProfileIdx(snap.activeIdx);
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx, setSketchProfile, setSketchProfiles, setSketchConstraints, setSketchDimensions, setActiveProfileIdx]);

  const handleSketchClear = useCallback(() => {
    setSketchProfile({ segments: [], closed: false });
    // Also clear all profiles in the multi-profile state and reset to a single empty profile
    setSketchProfiles([{ segments: [], closed: false }]);
    setActiveProfileIdx(0);
  }, []);

  // ── Multi-profile handlers ──
  const handleAddHoleProfile = useCallback(() => {
    setSketchProfiles(prev => {
      const next = [...prev, { segments: [], closed: false }];
      setActiveProfileIdx(next.length - 1);
      return next;
    });
  }, []);

  const handleDeleteProfile = useCallback((idx: number) => {
    if (idx === 0) return; // Cannot delete the outer profile
    setSketchProfiles(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setActiveProfileIdx(prev => (prev >= idx ? Math.max(0, prev - 1) : prev));
  }, []);

  const handleSetActiveProfile = useCallback((idx: number) => {
    setActiveProfileIdx(idx);
    // Sync the sketchProfile store with the newly active profile
    setSketchProfiles(prev => {
      setSketchProfile(prev[idx] ?? { segments: [], closed: false });
      return prev;
    });
  }, [setSketchProfile]);

  // ── Constraint handlers ──
  const handleAddConstraint = useCallback((c: SketchConstraint) => {
    captureSketchSnapshot();
    setSketchConstraints(prev => [...prev, c]);
  }, [captureSketchSnapshot, setSketchConstraints]);

  const handleRemoveConstraint = useCallback((id: string) => {
    captureSketchSnapshot();
    setSketchConstraints(prev => prev.filter(c => c.id !== id));
  }, [captureSketchSnapshot, setSketchConstraints]);

  const handleAddDimension = useCallback((d: SketchDimension) => {
    captureSketchSnapshot();
    setSketchDimensions(prev => [...prev, d]);
  }, [captureSketchSnapshot, setSketchDimensions]);

  const handleRemoveDimension = useCallback((id: string) => {
    setSketchDimensions(prev => prev.filter(d => d.id !== id));
  }, []);

  const handleDimensionChange = useCallback((id: string, value: number) => {
    setSketchDimensions(prev => prev.map(d => d.id === id ? { ...d, value } : d));
  }, []);

  const handleSolveConstraints = useCallback(() => {
    const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
    if (activeProfile.segments.length === 0) return;
    const result = solveConstraints(activeProfile.segments, sketchConstraints, sketchDimensions);
    // Apply solved point positions back into segments
    const solvedSegments = activeProfile.segments.map(seg => ({
      ...seg,
      points: seg.points.map(p => {
        if (p.id && result.points.has(p.id)) {
          return { ...result.points.get(p.id)!, id: p.id };
        }
        return p;
      }),
    }));
    const solvedProfile = { ...activeProfile, segments: solvedSegments };
    setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? solvedProfile : x));
    setSketchProfile(solvedProfile);
    // Mark constraints as satisfied/unsatisfied
    setSketchConstraints(prev => prev.map(c => ({
      ...c,
      satisfied: !result.unsatisfiedConstraints.includes(c.id),
    })));
    // Update constraint status for UI banner
    setConstraintStatus(result.solveResult?.status ?? (result.satisfied ? 'ok' : 'over-defined'));
    setConstraintDiagnostic({
      dof: result.solveResult?.dof,
      residual: result.solveResult?.residual,
      message: result.solveResult?.message,
      unsatisfiedCount: result.unsatisfiedConstraints.length,
    });
  }, [sketchProfiles, activeProfileIdx, sketchProfile, sketchConstraints, sketchDimensions, setSketchProfile]);

  // Hashes for auto-solve trigger (dimension values + profile point positions)
  const sketchDimHash = useMemo(
    () => sketchDimensions.map(d => `${d.id}:${d.value}`).join(','),
    [sketchDimensions],
  );
  const sketchProfileHash = useMemo(
    () => (sketchProfiles[activeProfileIdx]?.segments ?? [])
      .flatMap(s => s.points)
      .map(p => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`)
      .join('|'),
    [sketchProfiles, activeProfileIdx],
  );

  const isSolvingRef = useRef(false);

  // Auto-solve when constraint list or dimension values change
  React.useEffect(() => {
    if (!autoSolve || sketchConstraints.length === 0 || isSolvingRef.current) return;
    isSolvingRef.current = true;
    handleSolveConstraints();
    isSolvingRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSolve, sketchConstraints.length, sketchDimHash]);

  // Auto-solve after profile changes (point drag etc.) — debounced 150 ms
  React.useEffect(() => {
    if (!autoSolve || sketchConstraints.length === 0) return;
    const timer = setTimeout(() => {
      if (isSolvingRef.current) return;
      isSolvingRef.current = true;
      handleSolveConstraints();
      isSolvingRef.current = false;
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSolve, sketchConstraints.length, sketchProfileHash]);

  // ── Add sketch as feature-tree item ──
  const handleAddSketchToFeatureTree = useCallback(() => {
    if (!sketchProfile.closed) {
      addToast('error', lang === 'ko' ? '프로파일을 먼저 닫아주세요' : 'Close the profile first');
      return;
    }
    addSketchFeature(sketchProfile, sketchConfig, sketchPlane as 'xy' | 'xz' | 'yz', sketchOperation, sketchPlaneOffset);
    setSketchProfile({ segments: [], closed: false });
    setSketchProfiles([{ segments: [], closed: false }]);
    setActiveProfileIdx(0);
    setIsSketchMode(false);
    addToast('success', lang === 'ko' ? '피처 트리에 추가됨' : 'Added to feature tree');
  }, [sketchProfile, sketchConfig, sketchPlane, sketchOperation, sketchPlaneOffset, addSketchFeature, setSketchProfile, setIsSketchMode, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // SKETCH HISTORY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSaveToSketchHistory = useCallback((
    profile: SketchProfile,
    config: SketchConfig,
    plane: 'xy' | 'xz' | 'yz',
  ) => {
    const entry: SketchHistoryEntry = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `sh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      profile,
      config,
      plane,
      timestamp: Date.now(),
      thumbnail: generateSketchThumbnail(profile),
      label: `Sketch ${sketchHistory.length + 1}`,
    };
    const updated = [...sketchHistory, entry].slice(-20); // keep last 20
    setSketchHistory(updated);
    saveSketchHistory(updated);
  }, [sketchHistory]);

  const handleEditSketchFeature = useCallback((featureId: string) => {
    const node = featureHistory?.nodes.find(n => n.id === featureId);
    if (!node) return;

    const nodeAny = node as unknown as Record<string, unknown>;
    const storedProfile = nodeAny.sketchProfile as SketchProfile | undefined;
    const storedConfig = nodeAny.sketchConfig as SketchConfig | undefined;

    if (storedProfile) {
      setSketchProfile(storedProfile);
    } else {
      setSketchProfile({ segments: [], closed: false });
    }

    if (storedConfig) {
      setSketchConfig(storedConfig);
    }

    setEditingSketchFeatureId(featureId);
    setIsSketchMode(true);
    addToast('info', (t as any).editingSketch || 'Editing sketch — finish to update');
  }, [featureHistory, setSketchProfile, setSketchConfig, setIsSketchMode, addToast, t]);

  const handleLoadSketchFromHistory = useCallback((entry: SketchHistoryEntry) => {
    setSketchProfile(entry.profile);
    setSketchConfig(entry.config);
    setSketchPlane(entry.plane);
    setIsSketchMode(true);
    setShowSketchHistory(false);
    addToast('success', (t as any).loadSketch || 'Sketch loaded');
  }, [setSketchProfile, setSketchConfig, setSketchPlane, setIsSketchMode, addToast, t]);

  const handleDeleteSketchHistoryEntry = useCallback((id: string) => {
    const updated = sketchHistory.filter(e => e.id !== id);
    setSketchHistory(updated);
    saveSketchHistory(updated);
  }, [sketchHistory]);

  // ══════════════════════════════════════════════════════════════════════════
  // CHAT → SKETCH / OPTIMIZE / MODIFY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleChatApplySketch = useCallback((profile: SketchProfile, config: Partial<SketchConfig>) => {
    const mergedConfig: SketchConfig = {
      mode: config.mode || 'extrude',
      depth: config.depth ?? 50,
      revolveAngle: config.revolveAngle ?? 360,
      revolveAxis: config.revolveAxis || 'y',
      segments: config.segments ?? 32,
    };
    setSketchProfile(profile);
    setSketchConfig(mergedConfig);
    if (profile.closed && profile.segments.length >= 3) {
      const geo = profileToGeometry(profile, mergedConfig);
      if (geo) {
        const edgeGeometry = makeEdges(geo);
        const volume_cm3 = meshVolume(geo) / 1000;
        const surface_area_cm2 = meshSurfaceArea(geo) / 100;
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) return;
        const size = bb.getSize(new THREE.Vector3());
        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
        setBomParts([]); setBomLabel('');
        setSketchResult({ geometry: geo, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
        setIsSketchMode(false);
        return;
      }
    }
    setIsSketchMode(true);
    setSketchResult(null);
  }, []);

  const handleChatApplyOptimize = useCallback((opt: OptimizeResult) => {
    setIsSketchMode(false);
    setActiveTab('optimize');
    if (opt.dimX) setDimX(opt.dimX);
    if (opt.dimY) setDimY(opt.dimY);
    if (opt.dimZ) setDimZ(opt.dimZ);
    if (opt.materialKey) setMaterialKey(opt.materialKey);
    if (opt.fixedFaces) setFixedFaces(opt.fixedFaces);
    if (opt.loads) setLoads(opt.loads);
    if (opt.volfrac) setVolfrac(opt.volfrac);
    if (opt.resolution) setResolution(opt.resolution);
  }, []);

  const handleChatApplyModify = useCallback((mod: ModifyResult) => {
    history.push({ selectedId, params: { ...params }, featureIds: features.map(f => f.id) });
    for (const action of mod.actions) {
      if (action.type === 'param' && action.key && action.value !== undefined) {
        setParam(action.key, action.value);
      } else if (action.type === 'feature' && action.featureType) {
        addFeature(action.featureType);
      }
    }
  }, [addFeature, history, selectedId, params, features, setParam]);

  /** Called after modify is auto-applied — show undo toast */
  const handleModifyAutoApplied = useCallback((actionCount: number) => {
    addToast(
      'success',
      lang === 'ko'
        ? `AI 변경 ${actionCount}개 적용됨`
        : `AI applied ${actionCount} change${actionCount !== 1 ? 's' : ''}`,
      6000,
      { label: lang === 'ko' ? '되돌리기' : 'Undo', onClick: handleHistoryUndo },
    );
  }, [addToast, lang, handleHistoryUndo]);

  // Apply a geometry directly (from face editing, fillet/chamfer on edge, or CSG)
  const handleGeometryApply = useCallback((geo: THREE.BufferGeometry) => {
    const vol = meshVolume(geo);
    const sa = meshSurfaceArea(geo);
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return;
    const newResult: ShapeResult = {
      geometry: geo,
      edgeGeometry: makeEdges(geo),
      volume_cm3: vol,
      surface_area_cm2: sa,
      bbox: {
        w: box.max.x - box.min.x,
        h: box.max.y - box.min.y,
        d: box.max.z - box.min.z,
      },
    };
    setSketchResult(newResult);
    setEditMode('none');
  }, [setSketchResult, setEditMode]);

  // CSG Boolean operation
  const handleCSGApply = useCallback((op: CSGOperation, toolParams: CSGToolParams) => {
    const base = effectiveResult;
    if (!base) return;
    try {
      const toolGeo = makeToolGeometry(toolParams);
      const resultGeo = applyCSG(base.geometry, toolGeo, op);
      toolGeo.dispose();
      handleGeometryApply(resultGeo);
      setShowCSGPanel(false);
      addToast('success', lang === 'ko' ? 'Boolean 연산 완료' : 'Boolean operation applied');
    } catch {
      addToast('error', lang === 'ko' ? 'Boolean 연산 실패' : 'Boolean operation failed');
    }
  }, [effectiveResult, handleGeometryApply, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // MULTI-BODY OPERATIONS
  // ══════════════════════════════════════════════════════════════════════════

  /** Activate body panel — initialises from current geometry if bodies is empty */
  const handleOpenBodyPanel = useCallback(() => {
    if (bodies.length === 0) {
      const geo = effectiveResult;
      if (!geo) { setShowBodyPanel(true); return; }
      const id = crypto.randomUUID();
      setBodies([{
        id,
        name: lang === 'ko' ? '바디 1' : 'Body 1',
        color: BODY_COLORS[0],
        visible: true,
        locked: false,
      }]);
      setActiveBodyId(id);
      // Store geometry for this body (we extend BodyEntry with geometry refs separately)
      bodyGeosRef.current.set(id, { geometry: geo.geometry, edgeGeometry: geo.edgeGeometry });
    }
    setShowBodyPanel(true);
  }, [bodies.length, effectiveResult, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Geometry lookup map — avoids storing THREE objects in React state */
  const bodyGeosRef = React.useRef<Map<string, { geometry: THREE.BufferGeometry; edgeGeometry: THREE.BufferGeometry }>>(new Map());

  /** Split the given body into two halves */
  const handleSplitBody = useCallback((bodyId: string, plane: number, offset: number) => {
    const geos = bodyGeosRef.current.get(bodyId);
    if (!geos) { addToast('error', lang === 'ko' ? '바디 데이터 없음' : 'Body geometry not found'); return; }
    try {
      const [posGeo, negGeo] = splitBodyBoth(geos.geometry, plane, offset);
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();
      const sourceBody = bodies.find(b => b.id === bodyId);
      const colorA = sourceBody?.color ?? BODY_COLORS[0];
      const colorB = BODY_COLORS[bodies.length % BODY_COLORS.length];
      bodyGeosRef.current.set(idA, { geometry: posGeo, edgeGeometry: makeEdges(posGeo) });
      bodyGeosRef.current.set(idB, { geometry: negGeo, edgeGeometry: makeEdges(negGeo) });
      bodyGeosRef.current.delete(bodyId);
      setBodies(prev => [
        ...prev.filter(b => b.id !== bodyId),
        { id: idA, name: (sourceBody?.name ?? 'Body') + '-A', color: colorA, visible: true, locked: false, splitFrom: { bodyId, plane, offset } },
        { id: idB, name: (sourceBody?.name ?? 'Body') + '-B', color: colorB, visible: true, locked: false, splitFrom: { bodyId, plane, offset } },
      ]);
      setActiveBodyId(idA);
      addToast('success', lang === 'ko' ? '바디 분리 완료' : 'Body split complete');
    } catch {
      addToast('error', lang === 'ko' ? '분리 실패' : 'Split failed');
    }
  }, [bodies, lang, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Merge selected bodies into one */
  const handleMergeBodies = useCallback((bodyIds: string[]) => {
    const geoList = bodyIds.map(id => bodyGeosRef.current.get(id)?.geometry).filter(Boolean) as THREE.BufferGeometry[];
    if (geoList.length < 2) return;
    try {
      const merged = mergeBodyGeometries(geoList);
      const newId = crypto.randomUUID();
      const colorIdx = bodies.findIndex(b => b.id === bodyIds[0]);
      bodyGeosRef.current.set(newId, { geometry: merged, edgeGeometry: makeEdges(merged) });
      bodyIds.forEach(id => bodyGeosRef.current.delete(id));
      setBodies(prev => [
        ...prev.filter(b => !bodyIds.includes(b.id)),
        { id: newId, name: lang === 'ko' ? '합체 바디' : 'Merged Body', color: BODY_COLORS[Math.max(0, colorIdx) % BODY_COLORS.length], visible: true, locked: false, mergedFrom: bodyIds },
      ]);
      setActiveBodyId(newId);
      setSelectedBodyIds([]);
      addToast('success', lang === 'ko' ? '바디 합체 완료' : 'Bodies merged');
    } catch {
      addToast('error', lang === 'ko' ? '합체 실패' : 'Merge failed');
    }
  }, [bodies, lang, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: bomParts for multi-body rendering ──────────────────────────
  const bodyBomParts: BomPartResult[] | undefined = React.useMemo(() => {
    if (bodies.length <= 1) return undefined;
    return bodies
      .filter(b => b.visible)
      .map(b => {
        const geos = bodyGeosRef.current.get(b.id);
        if (!geos) return null;
        return {
          name: b.name,
          color: b.color,
          result: {
            geometry: geos.geometry,
            edgeGeometry: geos.edgeGeometry,
            volume_cm3: 0,
            surface_area_cm2: 0,
            bbox: { w: 0, h: 0, d: 0 },
          },
        };
      })
      .filter(Boolean) as BomPartResult[];
  }, [bodies]);

  // ══════════════════════════════════════════════════════════════════════════
  // SEND SHAPE TO OPTIMIZER
  // ══════════════════════════════════════════════════════════════════════════

  const handleSendToOptimizer = useCallback(() => {
    const r = sketchResult || result;
    if (!r) return;
    setDimX(Math.max(50, r.bbox.w));
    setDimY(Math.max(50, r.bbox.h));
    setDimZ(Math.max(50, r.bbox.d));
    setCustomDomainGeometry(r.geometry);
    setActiveTab('optimize');
  }, [result, sketchResult]);

  // ══════════════════════════════════════════════════════════════════════════
  // TOPOLOGY OPTIMIZATION HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleDimChange = useCallback((key: 'dimX' | 'dimY' | 'dimZ', value: number) => {
    if (key === 'dimX') setDimX(value); else if (key === 'dimY') setDimY(value); else setDimZ(value);
  }, []);

  const handleFaceClick = useCallback((face: Face) => {
    if (selectionMode === 'fixed') {
      setFixedFaces(prev => prev.includes(face) ? prev.filter(f => f !== face) : [...prev, face]);
    } else if (selectionMode === 'load') {
      setLoads(prev => prev.find(l => l.face === face) ? prev.filter(l => l.face !== face) : [...prev, { face, force: [...activeLoadForce] as [number, number, number] }]);
    }
  }, [selectionMode, activeLoadForce]);

  const handleRemoveFixed = useCallback((face: Face) => { setFixedFaces(prev => prev.filter(f => f !== face)); }, []);
  const handleRemoveLoad = useCallback((face: Face) => { setLoads(prev => prev.filter(l => l.face !== face)); }, []);

  // handleGenerate is provided by useOptimizationState hook

  const handleExportSTL = useCallback(async () => {
    if (!resultMesh) return;
    setExportingFormat('STL');
    try {
      const { exportSTL } = await import('./topology/optimizer/stlExporter');
      exportSTL(resultMesh, 'generative-design');
      analytics.shapeDownload('STL');
      addToast('success', lang === 'ko' ? 'STL 저장됨' : 'STL saved');
    } catch (err) {
      console.error('[Export STL]', err);
      addToast('error', lang === 'ko' ? 'STL 내보내기 실패' : 'STL export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [resultMesh, addToast, lang]);

  const handleSendOptToQuote = useCallback(() => {
    if (!optResult) return;
    const volumeCm3 = (dimX * dimY * dimZ * optResult.finalVolumeFraction) / 1000;
    router.push(`/${langSeg}/quick-quote/?from=generative-design&volume_cm3=${volumeCm3.toFixed(4)}&material=${materialKey}`);
  }, [optResult, materialKey, dimX, dimY, dimZ, langSeg, router]);

  const handleOptReset = useCallback(() => {
    setDimX(200); setDimY(100); setDimZ(200); setMaterialKey('aluminum');
    setFixedFaces([]); setLoads([]); setVolfrac(0.4); setResolution('low');
    setPenal(3); setRmin(1.5); setMaxIter(50); setSelectionMode('none');
    setProgress(null); setOptResult(null); setResultMesh(null);
    setActiveLoadForce([0, -1000, 0]);
  }, []);

  const weightInfo = useMemo(() => {
    if (!optResult) return null;
    const material = MATERIALS[materialKey];
    const volumeM3 = (dimX / 1000) * (dimY / 1000) * (dimZ / 1000);
    const originalWeight = volumeM3 * material.density;
    const optimizedWeight = originalWeight * optResult.finalVolumeFraction;
    return { originalWeight, optimizedWeight, reduction: (1 - optResult.finalVolumeFraction) * 100 };
  }, [optResult, materialKey, dimX, dimY, dimZ]);

  const convergenceChart = useMemo(() => {
    if (!optResult || optResult.convergenceHistory.length < 2) return null;
    const hist = optResult.convergenceHistory;
    const w = 240, h = 100, padX = 30, padY = 10;
    const chartW = w - padX * 2, chartH = h - padY * 2;
    const minVal = Math.log10(Math.max(1e-10, Math.min(...hist)));
    const maxVal = Math.log10(Math.max(1e-10, Math.max(...hist)));
    const range = maxVal - minVal || 1;
    const points = hist.map((val, i) => {
      const x = padX + (i / (hist.length - 1)) * chartW;
      const y = padY + chartH - ((Math.log10(Math.max(1e-10, val)) - minVal) / range) * chartH;
      return `${x},${y}`;
    }).join(' ');
    return (
      <svg width={w} height={h} style={{ width: '100%', height: 'auto' }}>
        <line x1={padX} y1={padY} x2={padX} y2={h - padY} stroke="#30363d" strokeWidth={1} />
        <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="#30363d" strokeWidth={1} />
        <text x={w / 2} y={h - 1} textAnchor="middle" fill="#484f58" fontSize={8}>Iteration</text>
        <polyline points={points} fill="none" stroke="#8b5cf6" strokeWidth={1.5} />
      </svg>
    );
  }, [optResult]);

  // ══════════════════════════════════════════════════════════════════════════
  // AI PREVIEW HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleAiPreview = useCallback((data: any) => {
    if (data.mode === 'single' && data.shapeId) {
      const preview = generatePartResult(data.shapeId, data.params, data.features);
      if (preview) { setPreviewResult(preview); setIsPreviewMode(true); }
    } else if (data.mode === 'modify') {
      setIsPreviewMode(true);
    }
  }, [generatePartResult]);

  const handleCancelPreview = useCallback(() => {
    setPreviewResult(null);
    setIsPreviewMode(false);
  }, []);

  const handleTextToCAD = useCallback((shapeId: string, nlParams: Record<string, number>) => {
    const sc = SHAPES.find(s => s.id === shapeId);
    if (!sc) return;
    // Select shape and apply parsed params, falling back to shape defaults
    history.push({ selectedId, params: { ...params }, featureIds: features.map(f => f.id) });
    setSelectedId(sc.id);
    const p: Record<string, number> = {};
    const e: Record<string, string> = {};
    sc.params.forEach(sp => {
      const val = nlParams[sp.key] ?? sp.default;
      p[sp.key] = val;
      e[sp.key] = String(val);
    });
    setParams(p);
    setParamExpressions(e);
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    addToast('success', lang === 'ko'
      ? `"${sc.id}" 형상이 텍스트에서 생성되었습니다`
      : `"${sc.id}" shape generated from text`);
  }, [selectedId, params, features, history, setSelectedId, setParams, setParamExpressions, clearAll, setSelectedFeatureId, setSketchResult, setEditMode, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // CONTEXT MENU HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // 오른쪽 버튼을 누른 채 드래그(5px 이상 이동)했으면 컨텍스트 메뉴 억제
    if (rightMouseDownPos.current) {
      const dx = e.clientX - rightMouseDownPos.current.x;
      const dy = e.clientY - rightMouseDownPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;
    }
    const items = isSketchMode ? getContextItemsSketch(lang) : effectiveResult ? getContextItemsGeometry(lang) : getContextItemsEmpty(lang);
    setCtxMenu({ x: e.clientX, y: e.clientY, visible: true, items });
  }, [isSketchMode, effectiveResult, lang]);

  const handleContextSelect = useCallback((id: string) => {
    setCtxMenu(prev => ({ ...prev, visible: false }));
    switch (id) {
      case 'zoom-fit': break; // handled by viewer
      case 'sketch-here': setIsSketchMode(true); setSketchResult(null); setEditMode('none'); break;
      case 'finish-sketch': handleSketchGenerate(); break;
      case 'cancel-sketch': setIsSketchMode(false); break;
      case 'measure': setMeasureActive(v => !v); break;
      case 'delete': if (selectedFeatureId) removeFeature(selectedFeatureId); break;
      case 'suppress': if (selectedFeatureId) toggleFeature(selectedFeatureId); break;
      case 'add-dimension': setShowDimensions(true); break;
      case 'properties': if (selectedFeatureId) setShowPropertyManager(true); break;
      case 'add-to-cart': handleAddToCart(); break;
      case 'sketch-undo': handleSketchUndo(); break;
      case 'sketch-clear': handleSketchClear(); break;
      case 'edit-feature': if (selectedFeatureId) startEditing(selectedFeatureId); break;
    }
  }, [selectedFeatureId, removeFeature, toggleFeature, handleSketchGenerate, handleAddToCart, handleSketchUndo, handleSketchClear, startEditing]);

  const handleExportDrawingPDF = useCallback(async () => {
    if (!effectiveResult) return;
    setExportingFormat('PDF');
    try {
      const { exportDrawingPDF } = await import('./io/pdfExport');
      const svgEl = document.querySelector<SVGSVGElement>('.drawing-view-svg');
      if (!svgEl) {
        setSketchViewMode('drawing');
        addToast('info', (t as any).exportDrawing || 'PDF Drawing — switch to Drawing view first');
        setExportingFormat(null);
        return;
      }
      const partName = isSketchMode ? 'sketch' : selectedId;
      await exportDrawingPDF(svgEl, `${partName || 'drawing'}.pdf`, 'A3', 'landscape');
    } catch (err) {
      console.error('[Export DrawingPDF]', err);
      addToast('error', lang === 'ko' ? 'PDF 내보내기 실패' : 'Drawing PDF export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, isSketchMode, selectedId, t, addToast, lang]);

  const handleContextClose = useCallback(() => {
    setCtxMenu(prev => ({ ...prev, visible: false }));
  }, []);

  // Long-press context menu for mobile touch
  const handleLongPress = useCallback((x: number, y: number) => {
    const items = isSketchMode ? getContextItemsSketch(lang) : effectiveResult ? getContextItemsGeometry(lang) : getContextItemsEmpty(lang);
    setCtxMenu({ x, y, visible: true, items });
  }, [isSketchMode, effectiveResult, lang]);
  const touchGestureHandlers = useTouchGestures({ onLongPress: isMobile ? handleLongPress : undefined });

  // ══════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ══════════════════════════════════════════════════════════════════════════

  useKeyboardShortcuts({
    isPreviewMode, handleCancelPreview,
    isSketchMode, setIsSketchMode,
    showAIAssistant, setShowAIAssistant,
    editMode, setEditMode,
    transformMode, setTransformMode,
    setMeasureActive, setShowDimensions,
    handleHistoryUndo, handleHistoryRedo,
    sketchTool, setSketchTool,
    handleSaveNfab, handleSaveNfabCloud, handleLoadNfab,
    handleSketchRedo,
    handleShowContextHelp: contextHelp.show,
  });

  // Auto-run DFM analysis and show manufacturing card whenever the result updates
  useEffect(() => {
    if (!effectiveResult) {
      setShowManufacturingCard(false);
      return;
    }
    setShowManufacturingCard(true);
    // Fire-and-forget DFM for the card summary
    handleDFMAnalyze(
      ['cnc_milling', 'injection_molding'],
      { minWallThickness: 1.0, minDraftAngle: 1.0, maxAspectRatio: 4.0 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveResult]);

  // ══════════════════════════════════════════════════════════════════════════
  // FILE IMPORT / EXPORT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const getEffectiveGeometry = useCallback(() => effectiveResult?.geometry ?? null, [effectiveResult]);
  const {
    importedGeometry, setImportedGeometry,
    importedFilename, setImportedFilename,
    fileInputRef,
    handleImportFile,
    handleFileSelected,
    handleExportCurrentSTL,
    handleExportOBJ,
    handleExportPLY,
    handleExport3MF,
  } = useImportExport(addToast, getEffectiveGeometry, setSketchResult as React.Dispatch<React.SetStateAction<ShapeResult | null>>, setBomParts, setBomLabel, setIsSketchMode as React.Dispatch<React.SetStateAction<boolean>>, activeTab, resultMesh);

  const handleExportSTEP = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    setExportingFormat('STEP');
    try {
      const { exportSTEP } = await import('./io/exporters');
      exportSTEP(geo, 'shape-design');
      analytics.shapeDownload('STEP');
      addToast('success', 'STEP exported successfully');
    } catch (err) {
      console.error('[Export STEP]', err);
      addToast('error', lang === 'ko' ? 'STEP 내보내기 실패' : 'STEP export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, addToast, lang]);

  const handleExportGLTF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    setExportingFormat('GLTF');
    try {
      const { exportGLTF } = await import('./io/exporters');
      await exportGLTF(geo, 'shape-design');
      analytics.shapeDownload('GLTF');
      addToast('success', 'GLTF (GLB) exported successfully');
    } catch (err) {
      console.error('GLTF export failed:', err);
      addToast('error', 'GLTF export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, addToast]);

  const [dxfProjection, setDxfProjection] = useState<'xy' | 'xz' | 'yz'>('xy');

  const handleExportDXF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    setExportingFormat('DXF');
    try {
      const { exportDXF, geometryToDXFEntities } = await import('./io/dxfExporter');
      const entities = geometryToDXFEntities(geo, dxfProjection);
      if (entities.length === 0) {
        addToast('warning', 'No edges found for DXF export');
        setExportingFormat(null);
        return;
      }
      exportDXF(entities, 'shape-design');
      addToast('success', lang === 'ko' ? 'DXF 내보내기 완료' : 'DXF exported successfully');
    } catch (err) {
      console.error('DXF export failed:', err);
      addToast('error', lang === 'ko' ? 'DXF 내보내기 실패' : 'DXF export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, dxfProjection, addToast, lang]);

  // Sheet-metal flat pattern DXF — outline (CUT) + bend lines (BEND_UP/DOWN)
  // + bend table. Reads the FlatPatternResult either from the active geometry
  // if it was produced by the flatPattern feature, or regenerates one on the
  // fly from the current effective geometry.
  const handleExportFlatPatternDXF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('error', lang === 'ko' ? '형상을 먼저 생성하세요' : 'Create a shape first');
      return;
    }
    try {
      const { generateFlatPattern, getFlatPatternMetadata } = await import('./features/sheetMetal');
      const { exportSheetMetalDXF } = await import('./io/dxfExporter');
      let pattern = getFlatPatternMetadata(geo);
      if (!pattern) {
        // Fall back to regenerating with defaults so the user still gets a
        // usable DXF even if they didn't run the flatPattern feature first.
        const result = generateFlatPattern(geo, [], 2, 'mildSteel');
        pattern = {
          width: result.width,
          length: result.length,
          thickness: result.thickness,
          material: result.material,
          bendTable: result.bendTable,
          warnings: result.warnings,
        };
      }
      exportSheetMetalDXF({ geometry: geo, ...pattern }, 'flat-pattern');
      if (pattern.warnings.length > 0) {
        for (const w of pattern.warnings) {
          addToast(w.severity, lang === 'ko' ? w.messageKo : w.messageEn);
        }
      }
      addToast('success', lang === 'ko' ? '전개도 DXF 내보내기 완료' : 'Flat pattern DXF exported');
    } catch (err) {
      addToast('error', lang === 'ko' ? `전개도 DXF 실패: ${err instanceof Error ? err.message : String(err)}` : `Flat pattern DXF failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [effectiveResult, addToast, lang]);

  const handleExportRhino = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    setExportingFormat('Rhino');
    try {
      const { exportRhinoJSON } = await import('./io/rhinoExport');
      exportRhinoJSON(geo, 'shape-design', 'Shape');
      addToast('success', lang === 'ko' ? 'Rhino JSON 내보내기 완료' : 'Rhino JSON exported successfully');
    } catch (err) {
      console.error('[Export Rhino]', err);
      addToast('error', lang === 'ko' ? 'Rhino JSON 내보내기 실패' : 'Rhino JSON export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [getEffectiveGeometry, addToast, lang]);

  const handleExportGrasshopper = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    setExportingFormat('Grasshopper');
    try {
      const { exportGrasshopperPoints } = await import('./io/rhinoExport');
      exportGrasshopperPoints(geo, 'shape-design-points');
      addToast('success', lang === 'ko' ? 'Grasshopper 포인트 내보내기 완료' : 'Grasshopper points exported successfully');
    } catch (err) {
      console.error('[Export Grasshopper]', err);
      addToast('error', lang === 'ko' ? 'Grasshopper 내보내기 실패' : 'Grasshopper export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [getEffectiveGeometry, addToast, lang]);

    // ══════════════════════════════════════════════════════════════════════════
  // SCENE SAVE / LOAD / GLB EXPORT
  // ══════════════════════════════════════════════════════════════════════════

  const sceneRef = useRef<THREE.Scene | null>(null);
  const sceneFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveScene = useCallback(async () => {
    try {
      const { serializeScene, exportSceneAsJSON } = await import('./io/sceneSerializer');
      const serializableShapes: Array<{ id: string; shapeType: string; params: Record<string, number>; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; materialPreset: string; color: string }> = features.map(f => ({
        id: f.id,
        shapeType: f.type as string,
        params: { ...f.params },
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        materialPreset: materialId,
        color: '#8b9cf4',
      }));
      // Include the base shape as the first entry
      serializableShapes.unshift({
        id: `base_${selectedId}`,
        shapeType: selectedId,
        params: { ...params },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        materialPreset: materialId,
        color: '#8b9cf4',
      });
      const state = serializeScene(serializableShapes, undefined);
      exportSceneAsJSON(state, 'nexyfab-scene');
      addToast('success', t.sceneSaved ?? 'Scene saved');
    } catch (err) {
      console.error('Scene save failed:', err);
      addToast('error', lang === 'ko' ? '씬 저장 실패' : 'Scene save failed');
    }
  }, [features, selectedId, params, materialId, addToast, t, lang]);

  const handleLoadScene = useCallback(() => {
    sceneFileInputRef.current?.click();
  }, []);

  const handleSceneFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { importSceneFromJSON, deserializeScene } = await import('./io/sceneSerializer');
      const state = await importSceneFromJSON(file);
      const { shapes } = deserializeScene(state);
      // Apply the base shape (first entry with prefix base_)
      const baseEntry = shapes.find(s => s.id.startsWith('base_'));
      if (baseEntry && SHAPE_MAP[baseEntry.shapeType]) {
        setSelectedId(baseEntry.shapeType);
        setParams(baseEntry.params);
        const e2: Record<string, string> = {};
        Object.entries(baseEntry.params).forEach(([k, v]) => { e2[k] = String(v); });
        setParamExpressions(e2);
      }
      // Restore material
      if (baseEntry?.materialPreset) {
        setMaterialId(baseEntry.materialPreset);
      }
      clearAll();
      addToast('success', t.sceneImported ?? 'Scene imported');
    } catch (err) {
      console.error('Scene import failed:', err);
      addToast('error', lang === 'ko' ? '씬 불러오기 실패' : 'Scene import failed');
    }
    e.target.value = '';
  }, [clearAll, addToast, t, lang]);

  const handleExportGLB = useCallback(async () => {
    if (!sceneRef.current) {
      addToast('warning', lang === 'ko' ? '씬을 먼저 로드하세요' : 'Load a scene first');
      return;
    }
    try {
      const { exportSceneGLB } = await import('./io/gltfExportUtils');
      await exportSceneGLB(sceneRef.current, 'nexyfab-scene');
      analytics.shapeDownload('GLB');
      addToast('success', t.exportGLB ? `${t.exportGLB} OK` : 'GLB exported');
    } catch (err) {
      console.error('GLB export failed:', err);
      addToast('error', lang === 'ko' ? 'GLB 내보내기 실패' : 'GLB export failed');
    }
  }, [addToast, t, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // MESH PROCESSING HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleMeshProcess = useCallback(async (op: string) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const mesh = await import('./mesh/meshProcessing');
    let processed: THREE.BufferGeometry;
    switch (op) {
      case 'repair': processed = mesh.repairMesh(geo); break;
      case 'reduceNoise': processed = mesh.reduceNoise(geo); break;
      case 'fillHoles': processed = mesh.fillHoles(geo); break;
      case 'simplify': processed = mesh.simplifyMesh(geo, 0.5); break;
      case 'remesh': processed = mesh.remesh(geo, 5); break;
      case 'smooth': processed = mesh.smoothMesh(geo); break;
      case 'flipNormals': processed = mesh.flipNormals(geo); break;
      case 'removeSpikes': processed = mesh.removeSpikes(geo); break;
      case 'detached': processed = mesh.detachedTriangles(geo); break;
      default: return;
    }
    const edgeGeometry = makeEdges(processed);
    const volume_cm3 = meshVolume(processed) / 1000;
    const surface_area_cm2 = meshSurfaceArea(processed) / 100;
    processed.computeBoundingBox();
    const bb = processed.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new THREE.Vector3());
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
    setSketchResult({ geometry: processed, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
    addToast('success', `Mesh "${op}" completed`);
  }, [effectiveResult, addToast]);

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYSIS HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  // Simple panel-opener dispatch. Entries that don't need geometry or side data
  // just flip a local flag; complex cases fall through to the switch below.
  const panelOpeners = useMemo<Record<string, () => void>>(() => ({
    history:          () => useUIStore.getState().togglePanel('showHistoryPanel'),
    array:            () => useUIStore.getState().togglePanel('showArrayPanel'),
    dimensionAdvisor: () => useUIStore.getState().openAIAssistant('advisor'),
    fea:              () => { setShowFEA(true); setFeaResult(null); },
    massProperties:   () => { setShowMassProps(true); setShowCenterOfMass(null); },
    gdt:              () => setShowAnnotationPanel(true),
    dfm:              () => { setShowDFM(true); setDfmResults(null); setDfmHighlightedIssue(null); },
    thermal:          () => setShowThermalPanel(true),
    generativeDesign: () => setShowGenDesign(true),
    ecad:             () => setShowECADPanel(true),
    motionStudy:      () => setShowMotionStudy(true),
    modalAnalysis:    () => setShowModalAnalysis(true),
    parametricSweep:  () => setShowParametricSweep(true),
    toleranceStackup: () => setShowToleranceStackup(true),
    surfaceQuality:   () => setShowSurfaceQuality(true),
    autoDrawing:      () => setShowAutoDrawing(true),
    mfgPipeline:      () => setShowMfgPipeline(true),
  }), []);

  // Entries that need geometry to be meaningful — handleAnalysis will bail before
  // opening the panel if `effectiveResult.geometry` is missing.
  const PANELS_REQUIRING_GEO = new Set([
    'fea', 'massProperties', 'gdt', 'dfm', 'thermal',
    'generativeDesign', 'ecad', 'motionStudy', 'modalAnalysis',
    'parametricSweep', 'toleranceStackup', 'surfaceQuality',
    'autoDrawing', 'mfgPipeline',
  ]);

  const handleAnalysis = useCallback(async (type: string) => {
    // History / array / dimensionAdvisor toggles don't require geometry
    if (type === 'history' || type === 'array' || type === 'dimensionAdvisor') {
      panelOpeners[type]();
      return;
    }
    const geo = effectiveResult?.geometry;
    if (!geo) return;

    // Simple panel opens go through the dispatch table
    if (PANELS_REQUIRING_GEO.has(type)) {
      panelOpeners[type]?.();
      return;
    }

    // Complex cases: async imports, freemium gates, or extra inputs
    switch (type) {
      case 'validation': {
        const { validateGeometry } = await import('./analysis/geometryValidation');
        setValidationResult(validateGeometry(geo));
        setShowValidation(true);
        addToast('info', 'Validation complete');
        return;
      }
      case 'deviation': {
        if (!importedGeometry || !sketchResult) {
          addToast('warning', 'Deviation analysis requires both a reference and test mesh');
        }
        return;
      }
      case 'printability': {
        setShowPrintAnalysis(true);
        const { analyzePrintability } = await import('./analysis/printAnalysis');
        setPrintAnalysis(analyzePrintability(geo, {
          buildDirection: printBuildDir,
          overhangAngle: printOverhangAngle,
        }));
        addToast('info', lang === 'ko' ? '3D 프린팅 분석 완료' : '3D Print analysis complete');
        return;
      }
      case 'cam': {
        if (!checkFreemium('cam_export').allowed) { setShowCamUpgrade(true); return; }
        const { generateCAMToolpaths } = await import('./analysis/camLite');
        const { toGcode, downloadGcode } = await import('./analysis/gcodeEmitter');
        const operation = {
          type: 'face_mill' as const,
          toolDiameter: 10, stepover: 50, stepdown: 2,
          feedRate: 500, spindleSpeed: 3000,
        };
        const result = generateCAMToolpaths(geo, operation);
        const postProcessor = mfgCamPost || (typeof window !== 'undefined' && window.localStorage.getItem('nexyfab.cam.post')) || 'linuxcnc';
        const gcode = toGcode(result, operation, { postProcessor, programName: selectedId || 'NEXYFAB' });
        downloadGcode(selectedId || 'nexyfab-program', gcode.code, gcode.fileExtension);
        setCamSimResult({ result, operation });
        const msg = lang === 'ko'
          ? `G-code 생성 완료 (${gcode.postProcessorId}) — ${result.toolpaths.length}개 패스, ${gcode.lineCount}줄, 예상 ${result.estimatedTime.toFixed(1)}분${result.warnings.length > 0 ? ` ⚠ ${result.warnings[0]}` : ''}`
          : `G-code generated (${gcode.postProcessorId}) — ${result.toolpaths.length} passes, ${gcode.lineCount} lines, est. ${result.estimatedTime.toFixed(1)} min${result.warnings.length > 0 ? ` ⚠ ${result.warnings[0]}` : ''}`;
        addToast('success', msg);
        return;
      }
    }
  }, [effectiveResult, importedGeometry, sketchResult, addToast, printBuildDir, printOverhangAngle, lang, panelOpeners, mfgCamPost, selectedId, checkFreemium]);

  // ── GD&T Annotation handlers ──
  const handleAddGDT = useCallback((a: GDTAnnotation) => addGDTAnnotation(a), [addGDTAnnotation]);
  const handleUpdateGDT = useCallback((id: string, u: Partial<GDTAnnotation>) => updateGDTAnnotation(id, u), [updateGDTAnnotation]);
  const handleRemoveGDT = useCallback((id: string) => removeGDTAnnotation(id), [removeGDTAnnotation]);
  const handleAddDimAnnotation = useCallback((a: DimensionAnnotation) => addDimensionAnnotation(a), [addDimensionAnnotation]);
  const handleUpdateDimAnnotation = useCallback((id: string, u: Partial<DimensionAnnotation>) => updateDimensionAnnotation(dimensionAnnotations.map(a => a.id === id ? { ...a, ...u } : a)), [updateDimensionAnnotation, dimensionAnnotations]);
  const handleRemoveDimAnnotation = useCallback((id: string) => removeDimensionAnnotation(id), [removeDimensionAnnotation]);

  const handlePrintAnalyze = useCallback(async (options: PrintAnalysisOptions) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const { analyzePrintability } = await import('./analysis/printAnalysis');
    const result = analyzePrintability(geo, options);
    setPrintAnalysis(result);
    if (options.buildDirection) setPrintBuildDir(options.buildDirection);
    if (options.overhangAngle != null) setPrintOverhangAngle(options.overhangAngle);
    addToast('info', lang === 'ko' ? '3D 프린팅 분석 완료' : '3D Print analysis complete');
  }, [effectiveResult, addToast, lang]);

  const [printOptimization, setPrintOptimization] = useState<OrientationOptimizationResult | null>(null);

  const handleOptimizeOrientation = useCallback(async (
    overhangAngle: number,
    currentDirection: [number, number, number],
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lang === 'ko' ? '먼저 형상을 생성하세요' : 'Generate a shape first');
      return;
    }
    const { findOptimalOrientation } = await import('./analysis/printAnalysis');
    const result = findOptimalOrientation(geo, { overhangAngle, currentDirection });
    setPrintOptimization(result);
    const best = result.candidates[result.bestIndex];
    const cur  = result.candidates[result.currentIndex];
    if (result.bestIndex === result.currentIndex) {
      addToast('success', lang === 'ko' ? '이미 최적 방향입니다' : 'Already in optimal orientation');
    } else {
      const pct = cur.supportArea > 0
        ? Math.round(((cur.supportArea - best.supportArea) / cur.supportArea) * 100)
        : 0;
      addToast('info', lang === 'ko'
        ? `${best.label} 방향 권장 — 서포트 ${pct}% 절감`
        : `Try ${best.label} — ${pct}% less support`);
    }
  }, [effectiveResult, addToast, lang]);

  const handleExportPrintReady = useCallback(async (settings: {
    process: 'fdm' | 'sla' | 'sls';
    layerHeight: number;
    infillPercent: number;
    printSpeed: number;
    buildDirection: [number, number, number];
  }) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lang === 'ko' ? '먼저 형상을 생성하세요' : 'Generate a shape first');
      return;
    }
    try {
      const { exportPrintReady } = await import('./io/exporters');
      const baseName = `nexyfab-${settings.process}-${Date.now()}`;
      exportPrintReady(geo, baseName, {
        process: settings.process,
        layerHeight: settings.layerHeight,
        infillPercent: settings.infillPercent,
        printSpeed: settings.printSpeed,
        buildDirection: settings.buildDirection,
        materialId,
        estimatedTimeMin: printAnalysis?.printTime,
        estimatedCostUsd: printAnalysis?.costBreakdown?.totalCost,
      });
      addToast('success', lang === 'ko'
        ? '슬라이서용 파일을 다운로드했습니다 (.stl + .3mf)'
        : 'Print-ready files downloaded (.stl + .3mf)');
    } catch (err) {
      console.error('[exportPrintReady]', err);
      addToast('error', lang === 'ko' ? '익스포트 실패' : 'Export failed');
    }
  }, [effectiveResult, materialId, printAnalysis, addToast, lang]);

  const handleApplyOptimalOrientation = useCallback(async (direction: [number, number, number]) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const { analyzePrintability } = await import('./analysis/printAnalysis');
    const result = analyzePrintability(geo, {
      buildDirection: direction,
      overhangAngle: printOverhangAngle,
    });
    setPrintAnalysis(result);
    setPrintBuildDir(direction);
    // Re-run the optimizer with the new current direction so the ranking updates
    const { findOptimalOrientation } = await import('./analysis/printAnalysis');
    setPrintOptimization(findOptimalOrientation(geo, {
      overhangAngle: printOverhangAngle,
      currentDirection: direction,
    }));
    addToast('success', lang === 'ko' ? '최적 방향 적용됨' : 'Optimal orientation applied');
  }, [effectiveResult, printOverhangAngle, addToast, lang]);

  const handleDFMAnalyze = useCallback(async (
    processes: ManufacturingProcess[],
    options: { minWallThickness: number; minDraftAngle: number; maxAspectRatio: number },
  ) => {
    if (!getPlanLimits(useAuthStore.getState().user?.plan).dfmAnalysis) {
      setUpgradeFeature('DFM 분석'); setShowUpgradePrompt(true); return;
    }
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const results = await analyzeDFMWorker(geo, processes, options);
    setDfmResults(results);
    setDfmHighlightedIssue(null);
    addToast('info', lang === 'ko' ? '제조 가능성 분석 완료' : 'DFM analysis complete');
  }, [effectiveResult, analyzeDFMWorker, addToast, lang]);

  const handleFEARunAnalysis = useCallback(async (material: FEAMaterial) => {
    if (!getPlanLimits(useAuthStore.getState().user?.plan).feaAnalysis) {
      setUpgradeFeature('FEA 응력 해석'); setShowUpgradePrompt(true); return;
    }
    const geo = effectiveResult?.geometry;
    if (!geo || feaConditions.length === 0) return;
    const result = await runFEAWorker(geo, material, feaConditions);
    setFeaResult(result);
    addToast('info', lang === 'ko' ? '응력 해석 완료' : 'FEA analysis complete');
  }, [effectiveResult, feaConditions, runFEAWorker, addToast, lang]);

  const feaTotalFaces = useMemo(() => {
    const geo = effectiveResult?.geometry;
    if (!geo) return 0;
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    return Math.floor(nonIndexed.attributes.position.count / 3);
  }, [effectiveResult]);

  // ── Mass Properties computation ──
  const massProperties = useMemo(() => {
    if (!showMassProps || !effectiveResult) return null;
    const { computeMassProperties } = require('./analysis/massProperties') as typeof import('./analysis/massProperties');
    const mat = MATERIAL_PRESETS.find(m => m.id === materialId);
    const density = mat?.density ?? 2.7;
    return computeMassProperties(effectiveResult.geometry, density);
  }, [showMassProps, effectiveResult, materialId]);

  // ══════════════════════════════════════════════════════════════════════════
  // ASSEMBLY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleAddMate = useCallback((mate: AssemblyMate) => {
    setAssemblyMates(prev => [...prev, mate]);
  }, []);

  const handleRemoveMate = useCallback((id: string) => {
    setAssemblyMates(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleUpdateMate = useCallback((id: string, updates: Partial<AssemblyMate>) => {
    setAssemblyMates(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const handleDetectInterference = useCallback(() => {
    if (!bomParts || bomParts.length < 2) return;
    setInterferenceLoading(true);
    setTimeout(() => {
      const partsInput = bomParts.map((p, i) => {
        const mat = new THREE.Matrix4();
        if (p.rotation) {
          const rot = p.rotation.map(d => d * Math.PI / 180) as [number, number, number];
          mat.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
        }
        if (p.position) {
          const tr = new THREE.Matrix4().makeTranslation(...p.position);
          mat.premultiply(tr);
        }
        return { id: p.name || `part_${i}`, geometry: p.result.geometry, transform: mat };
      });
      const results = detectInterference(partsInput);
      setInterferenceResults(results);
      setInterferenceLoading(false);
      if (results.length === 0) {
        addToast('success', lang === 'ko' ? '간섭이 발견되지 않았습니다' : 'No interference detected');
      } else {
        addToast('error', lang === 'ko' ? `${results.length}건의 간섭이 발견되었습니다` : `${results.length} interference(s) found`);
      }
    }, 50);
  }, [bomParts, addToast, lang]);

  const assemblyPartNames = useMemo(() => {
    return bomParts.map((p, i) => p.name || `part_${i}`);
  }, [bomParts]);

  // ══════════════════════════════════════════════════════════════════════════
  // STANDARD PARTS HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleStandardParts = useCallback(() => {
    useUIStore.getState().togglePanel('showLibrary');
  }, []);

  const handleSelectStandardPart = useCallback(async (partId: string) => {
    const { STANDARD_PARTS_MAP } = await import('./library/standardParts');
    const part = STANDARD_PARTS_MAP[partId];
    if (!part) return;
    setSelectedStandardPart(partId);
    const p: Record<string, number> = {};
    part.params.forEach(sp => { p[sp.key] = sp.default; });
    setStandardPartParams(p);
    // Generate and show
    const result = part.generate(p);
    setSketchResult(result);
    setBomParts([]); setBomLabel('');
    setIsSketchMode(false);
    addToast('info', `Loaded standard part: ${partId}`);
  }, [addToast]);

  const handleStandardPartParamChange = useCallback(async (key: string, value: number) => {
    const newParams = { ...standardPartParams, [key]: value };
    setStandardPartParams(newParams);
    if (!selectedStandardPart) return;
    const { STANDARD_PARTS_MAP } = await import('./library/standardParts');
    const part = STANDARD_PARTS_MAP[selectedStandardPart];
    if (!part) return;
    const result = part.generate(newParams);
    setSketchResult(result);
  }, [standardPartParams, selectedStandardPart]);

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET METAL HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSheetMetal = useCallback(async (op: string) => {
    const sm = await import('./sheetmetal/sheetMetal');
    if (op === 'box') {
      const result = sm.createSheetMetalBox(100, 50, 80, { thickness: 2, bendRadius: 3, kFactor: 0.44 });
      setSketchResult(result);
      setBomParts([]); setBomLabel('');
      setIsSketchMode(false);
      addToast('success', 'Sheet metal box created');
    } else if (op === 'unfold' && effectiveResult) {
      const flat = sm.unfold(effectiveResult.geometry, { thickness: 2, bendRadius: 3, kFactor: 0.44 });
      const edgeGeometry = makeEdges(flat.geometry);
      const volume_cm3 = meshVolume(flat.geometry) / 1000;
      const surface_area_cm2 = meshSurfaceArea(flat.geometry) / 100;
      flat.geometry.computeBoundingBox();
      const bb = flat.geometry.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setSketchResult({ geometry: flat.geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
      addToast('success', 'Sheet metal unfolded');
    } else if (op === 'bend' || op === 'flange' || op === 'hem') {
      setShowSheetMetalPanel(true);
    }
  }, [effectiveResult, addToast]);

  const handleSmBend = useCallback(async (angle: number, radius: number, position: number, direction: 'up' | 'down') => {
    if (!effectiveResult) { addToast('error', lang === 'ko' ? '형상을 먼저 생성하세요' : 'Create a shape first'); return; }
    const { applyBend } = await import('./features/sheetMetal');
    const geo = applyBend(effectiveResult.geometry, { angle, radius, position, direction });
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smBendBb = geo.boundingBox;
    if (!smBendBb) return;
    const s = smBendBb.getSize(new THREE.Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    addToast('success', lang === 'ko' ? '굽힘 적용됨' : 'Bend applied');
  }, [effectiveResult, addToast, lang]);

  const handleSmFlange = useCallback(async (height: number, angle: number, radius: number, edgeIndex: number) => {
    if (!effectiveResult) { addToast('error', lang === 'ko' ? '형상을 먼저 생성하세요' : 'Create a shape first'); return; }
    const { applyFlange } = await import('./features/sheetMetal');
    const geo = applyFlange(effectiveResult.geometry, { height, angle, radius, edgeIndex });
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smFlangeBb = geo.boundingBox;
    if (!smFlangeBb) return;
    const s = smFlangeBb.getSize(new THREE.Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    addToast('success', lang === 'ko' ? '플랜지 적용됨' : 'Flange applied');
  }, [effectiveResult, addToast, lang]);

  const handleSmFlatPattern = useCallback(async (thickness: number, kFactor: number) => {
    if (!effectiveResult) { addToast('error', lang === 'ko' ? '형상을 먼저 생성하세요' : 'Create a shape first'); return; }
    const { generateFlatPattern } = await import('./features/sheetMetal');
    // Legacy callers pass a raw K-factor; the new API accepts either a material
    // id or a K-factor number. Forward the K-factor unchanged.
    const pattern = generateFlatPattern(effectiveResult.geometry, [], thickness, kFactor);
    const geo = pattern.geometry;
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smFlatBb = geo.boundingBox;
    if (!smFlatBb) return;
    const s = smFlatBb.getSize(new THREE.Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    if (pattern.warnings.length > 0) {
      for (const w of pattern.warnings) {
        addToast(w.severity, lang === 'ko' ? w.messageKo : w.messageEn);
      }
    }
    addToast('success', lang === 'ko' ? '전개도 생성됨' : 'Flat pattern generated');
  }, [effectiveResult, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // FEATURE EXTRACTION HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleExtraction = useCallback(async (type: string) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const ext = await import('./extraction/featureExtraction');
    if (type === 'primitives') {
      const primitives = ext.detectPrimitives(geo);
      // Show first detected primitive
      if (primitives.length > 0) {
        const first = primitives[0];
        const edgeGeometry = makeEdges(first.geometry);
        const volume_cm3 = meshVolume(first.geometry) / 1000;
        const surface_area_cm2 = meshSurfaceArea(first.geometry) / 100;
        first.geometry.computeBoundingBox();
        const bb = first.geometry.boundingBox;
        if (!bb) return;
        const size = bb.getSize(new THREE.Vector3());
        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
        // Show as BOM parts
        const bomResults = primitives.map((p, i) => ({
          name: `${p.type} (${(p.confidence * 100).toFixed(0)}%)`,
          result: { geometry: p.geometry, edgeGeometry: makeEdges(p.geometry), volume_cm3: meshVolume(p.geometry) / 1000, surface_area_cm2: meshSurfaceArea(p.geometry) / 100, bbox },
        }));
        setBomParts(bomResults);
        setBomLabel('Detected Primitives');
      }
    } else if (type === 'extrusions') {
      ext.detectExtrusions(geo);
    } else if (type === 'autoSurface') {
      ext.autoSurface(geo);
    } else if (type === 'crossSection') {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      ext.computeCrossSection(geo, plane);
    }
  }, [effectiveResult]);

  // handleExportCurrentSTL is provided by useImportExport hook

  // ══════════════════════════════════════════════════════════════════════════
  // COMPUTED VALUES (must be before any early return to keep hooks stable)
  // ══════════════════════════════════════════════════════════════════════════

  const tier1 = useMemo(() => SHAPES.filter(s => s.tier === 1), []);
  const tier2 = useMemo(() => SHAPES.filter(s => s.tier === 2), []);

  const statusGuide = useMemo(() => {
    if (activeTab === 'optimize') {
      if (isOptimizing) return { icon: '⏳', text: `Iteration ${progress?.iteration ?? 0}/${progress?.maxIteration ?? '—'}...`, color: '#8b5cf6' };
      if (optResult) return { icon: '✅', text: 'Optimization complete. Export STL or send to quote.', color: '#16a34a' };
      if (!effectiveResult) return { icon: '🧊', text: lang === 'ko' ? 'Design 탭에서 먼저 형상을 생성하세요.' : 'Go to Design tab first to generate a shape.', color: '#f59e0b' };
      if (fixedFaces.length === 0) return { icon: '📌', text: 'Click a face in the viewer to set fixed boundary.', color: '#f59e0b' };
      if (loads.length === 0) return { icon: '⬇', text: 'Now add a load: select Load mode and click a face.', color: '#f59e0b' };
      return { icon: '▶', text: 'Ready. Click Generate in toolbar to start optimization.', color: '#6366f1' };
    }
    if (isSketchMode && !sketchResult) return { icon: '✏️', text: 'Draw a closed profile. Click first point to close.', color: '#7c3aed' };
    if (editMode === 'vertex') return { icon: '⬡', text: 'Drag vertex handles to reshape. Orbit is paused during drag.', color: '#22c55e' };
    if (editMode === 'edge') return { icon: '╱', text: lang === 'ko' ? '엣지를 클릭해 필렛/챔퍼 적용. 미드포인트 드래그로 이동.' : 'Click edge for fillet/chamfer. Drag midpoint to move.', color: '#22c55e' };
    if (editMode === 'face') return { icon: '▣', text: lang === 'ko' ? '면을 클릭해 선택, 초록 화살표 드래그로 Push/Pull.' : 'Click face to select, drag green arrow to Push/Pull.', color: '#22c55e' };
    if (!effectiveResult) return { icon: '🧊', text: 'Select a shape or use AI Chat to begin.', color: '#6b7280' };
    return { icon: '📐', text: `${(t as any)[`shapeName_${selectedId}`] || selectedId} — ${effectiveResult.bbox.w.toFixed(0)}×${effectiveResult.bbox.h.toFixed(0)}×${effectiveResult.bbox.d.toFixed(0)} mm`, color: '#58a6ff' };
  }, [activeTab, isOptimizing, optResult, fixedFaces, loads, progress, isSketchMode, sketchResult, editMode, effectiveResult, selectedId, t, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — GALLERY VIEW (early return AFTER all hooks)
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // DRAG & DROP FILE IMPORT
  // ══════════════════════════════════════════════════════════════════════════
  const SUPPORTED_EXTS = ['step', 'stp', 'iges', 'igs', 'brep', 'stl', 'obj', 'ply', 'dxf'];
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_EXTS.includes(ext)) {
      addToast('error', `Unsupported format: .${ext}`);
      return;
    }
    setIsImporting(true);
    try {
      const { importFile } = await import('./io/importers');
      const { geometry, filename } = await importFile(file);
      const edgeGeo = makeEdges(geometry);
      const vol = meshVolume(geometry) / 1000;
      const sa = meshSurfaceArea(geometry) / 100;
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const sz = bb.getSize(new THREE.Vector3());
      setImportedGeometry(geometry);
      setImportedFilename(filename);
      setSketchResult({ geometry, edgeGeometry: edgeGeo, volume_cm3: vol, surface_area_cm2: sa, bbox: { w: Math.round(sz.x), h: Math.round(sz.y), d: Math.round(sz.z) } });
      setIsSketchMode(false);
      setViewMode('workspace');
      // Save to recent files
      const recent = JSON.parse(localStorage.getItem('nf_recent_files') || '[]');
      const entry = { name: filename, ext, size: file.size, date: Date.now() };
      const updated = [entry, ...recent.filter((r: any) => r.name !== filename)].slice(0, 5);
      localStorage.setItem('nf_recent_files', JSON.stringify(updated));
      addToast('success', `"${filename}" loaded`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      // #9: provide retry action — re-trigger the browser file picker
      addToast(
        'error',
        lang === 'ko' ? `불러오기 실패: ${errMsg}` : `Import failed: ${errMsg}`,
        8000,
        {
          label: lang === 'ko' ? '다시 시도' : 'Retry',
          onClick: () => handleImportFile(),
        },
      );
    } finally {
      setIsImporting(false);
    }
  }, [addToast, setImportedGeometry, setImportedFilename, setSketchResult, setIsSketchMode, setViewMode, lang, handleImportFile]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — WORKSPACE VIEW
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ height: '100dvh', background: theme.bg, display: 'flex', flexDirection: 'column', userSelect: 'none', WebkitUserSelect: 'none', overflow: 'hidden' }}
      onDragStart={e => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>

      {/* ════ Desktop Title Bar (Tauri only) ════ */}
      <DesktopTitleBar
        projectName={useSceneStore.getState().selectedId || 'nexyfab-project'}
        isDirty={desktopDirty}
        currentPath={desktopFilePath}
        plan={(useAuthStore.getState().user?.plan as 'free' | 'pro' | 'team' | 'enterprise' | undefined) ?? 'free'}
        lang={lang}
        onNewFile={resetNfabFile}
        onOpenFile={() => void handleLoadNfab()}
        onOpenRecent={handleOpenRecentFile}
        onSave={() => void handleSaveNfab(false)}
        onSaveAs={() => void handleSaveNfab(true)}
      />

      {/* ════ Drag & Drop Overlay ════ */}
      {isDragOver && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(59,130,246,0.12)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '3px dashed #3b82f6', pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{lang === 'ko' ? '파일을 여기에 놓으세요' : 'Drop file here'}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>STEP · STL · OBJ · PLY · IGES · DXF · BREP</div>
          </div>
        </div>
      )}

      {/* ════ Import Loading Overlay ════ */}
      {isImporting && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(13,17,23,0.85)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ textAlign: 'center', color: '#e6edf3' }}>
            <div style={{ width: 40, height: 40, border: '3px solid #30363d', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>{lang === 'ko' ? '파일 불러오는 중...' : 'Loading file...'}</div>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ════ 소화면 전체화면 유도 프롬프트 (하단 슬라이드업) ════ */}
      {showFullscreenPrompt && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
          padding: '14px 20px',
          background: 'rgba(13,17,23,0.96)',
          borderTop: '1px solid #30363d',
          backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
          animation: 'nf-slide-up 0.3s ease-out',
        }}>
          <style>{`@keyframes nf-slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9', marginBottom: 2 }}>
              {lang === 'ko' ? '화면이 작습니다' : 'Small Screen Detected'}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>
              {lang === 'ko'
                ? '전체화면 모드에서 더 편하게 작업할 수 있어요.'
                : 'Switch to fullscreen for a better experience.'}
            </div>
          </div>
          <button
            onClick={() => dismissFullscreenPrompt(true)}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {lang === 'ko' ? '전체화면으로' : 'Go Fullscreen'}
          </button>
          <button
            onClick={() => dismissFullscreenPrompt(false)}
            style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid #30363d',
              color: '#6e7681', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {lang === 'ko' ? '괜찮아요' : 'No thanks'}
          </button>
        </div>
      )}

      {/* ════════ TOP TOOLBAR ════════ */}
      <ShapeGeneratorToolbar
        theme={theme}
        mode={mode}
        toggleTheme={toggleTheme}
        isMobile={isMobile}
        isTablet={isTablet}
        tabletLeftOpen={tabletLeftOpen}
        setTabletLeftOpen={setTabletLeftOpen}
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        tabLabels={tabLabels}
        lang={lang}
        langSeg={langSeg}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onHistoryUndo={handleHistoryUndo}
        onHistoryRedo={handleHistoryRedo}
        showVersionPanel={showVersionPanel}
        setShowVersionPanel={setShowVersionPanel}
        renderMode={renderMode}
        setRenderMode={setRenderMode}
        showCOTSPanel={showCOTSPanel}
        setShowCOTSPanel={setShowCOTSPanel}
        effectiveResult={!!effectiveResult}
        showAIAdvisor={showAIAssistant && useUIStore.getState().aiAssistantTab === 'suggestions'}
        setShowAIAdvisor={() => openAIAssistant('suggestions')}
        isPlacingComment={isPlacingComment}
        setIsPlacingComment={setIsPlacingComment}
        showDimensions={showDimensions}
        setShowDimensions={setShowDimensions}
        planLimits={planLimits}
        pollingSessions={pollingSessions}
        mySessionId={mySessionId}
        onOpenAuth={(m) => { setAuthModalMode(m ?? 'login'); setShowAuthModal(true); }}
        authModalMode={authModalMode}
        cartAdded={cartAdded}
        cartItemsLength={cartItems.length}
        onAddToCart={handleAddToCart}
        disableCart={!effectiveResult || activeTab !== 'design'}
        showCostPanel={showCostPanel}
        setShowCostPanel={setShowCostPanel}
        onGetQuote={handleGetQuote}
        rfqPending={rfqPending}
        simpleMode={simpleMode}
        onEnableSimpleMode={enableSimpleMode}
        onDisableSimpleMode={disableSimpleMode}
        onOpenWizard={() => setShowQuoteWizard(true)}
        tGetQuote={(t as unknown as Record<string, string>).getQuote ?? 'Get Quote'}
        selectedId={selectedId}
        params={params}
        materialId={materialId}
        shareOpenKey={shareOpenKey}
        isCreatingShare={isCreatingShare}
        shareUrl={shareUrl}
        onIPShare={() => void handleIPShare(
          planLimits,
          materialId,
          selectedId,
          setShowUpgradePrompt,
          setUpgradeFeature,
        )}
        addToast={addToast}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        dfmIssueCount={dfmIssueCount}
        dfmRunning={dfmWorkerLoading}
        showDFM={showDFM}
        onToggleDFM={() => setShowDFM(!showDFM)}
      />

      {/* ════════ FUNNEL STEP BAR ════════ */}
      {viewMode === 'workspace' && !isMobile && (
        <DesignFunnelBar
          lang={lang}
          hasGeometry={!!effectiveResult}
          dfmChecked={dfmResults !== null}
          dfmClean={dfmIssueCount === 0}
          dfmIssueCount={dfmIssueCount}
          rfqDone={rfqDone}
          manufacturerMatched={manufacturerMatched}
          onGoToDFM={() => setShowDFM(true)}
          onGoToQuote={() => setShowQuoteWizard(true)}
          onGoToMatch={() => setShowManufacturerMatch(true)}
          theme={theme}
        />
      )}

      {/* ════════ QUOTE WIZARD ════════ */}
      {showQuoteWizard && (
        <QuoteWizard
          lang={lang}
          onClose={() => setShowQuoteWizard(false)}
          initialMaterialId={materialId}
          onMatchManufacturer={() => {
            setShowManufacturerMatch(true);
          }}
          onGetQuote={() => {
            void handleGetQuote();
            setShowQuoteWizard(false);
            setRfqDone(true);
          }}
        />
      )}

      {/* ════════ CSG BOOLEAN PANEL ════════ */}
      {showCSGPanel && (
        <CSGPanel
          lang={lang}
          onApply={handleCSGApply}
          onClose={() => setShowCSGPanel(false)}
        />
      )}

      {/* ════════ BODY MANAGER PANEL ════════ */}
      {showBodyPanel && (
        <BodyPanel
          lang={lang}
          bodies={bodies}
          activeBodyId={activeBodyId}
          selectedBodyIds={selectedBodyIds}
          onSetActive={id => setActiveBodyId(id)}
          onToggleSelect={id => setSelectedBodyIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
          )}
          onToggleVisible={id => setBodies(prev => prev.map(b => b.id === id ? { ...b, visible: !b.visible } : b))}
          onRename={(id, name) => setBodies(prev => prev.map(b => b.id === id ? { ...b, name } : b))}
          onDelete={id => {
            bodyGeosRef.current.delete(id);
            setBodies(prev => {
              const next = prev.filter(b => b.id !== id);
              if (activeBodyId === id) setActiveBodyId(next[0]?.id ?? null);
              return next;
            });
            setSelectedBodyIds(prev => prev.filter(x => x !== id));
          }}
          onSplit={handleSplitBody}
          onMerge={handleMergeBodies}
          onClose={() => setShowBodyPanel(false)}
        />
      )}

      {/* ════════ AI PREVIEW BANNER ════════ */}
      {isPreviewMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '6px 20px',
          background: 'linear-gradient(90deg, #1a2332 0%, #161b22 100%)',
          borderBottom: '1px solid #1f6feb', flexShrink: 0,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'genSpin 2s linear infinite', boxShadow: '0 0 8px #f59e0b' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
            {lang === 'ko' ? 'AI 미리보기 모드' : 'AI Preview Mode'}
          </span>
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {lang === 'ko' ? '— 채팅에서 적용 또는 취소를 선택하세요' : '— Choose Apply or Cancel in the chat panel'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={handleCancelPreview} style={{
            padding: '3px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#21262d',
            color: '#f85149', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#3d1519'; e.currentTarget.style.borderColor = '#f85149'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#30363d'; }}
          >
            {lang === 'ko' ? '취소' : 'Cancel'} (Esc)
          </button>
        </div>
      )}

      {/* ════════ EMAIL VERIFICATION BANNER ════════ */}
      <VerificationBanner lang={lang} />

      {/* ════════ RECOVERY BANNER ════════ */}
      {showRecovery && recoveryData && (
        <RecoveryBanner timestamp={recoveryData.timestamp} lang={lang} onRestore={handleRestoreRecovery} onDismiss={handleDismissRecovery} />
      )}

      {/* ════════ READ-ONLY BANNER ════════ */}
      {isReadOnly && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '6px 16px', background: 'rgba(245,158,11,0.12)',
          borderBottom: '1px solid rgba(245,158,11,0.3)',
          fontSize: 12, color: '#f59e0b', fontWeight: 600,
          flexShrink: 0,
        }}>
          🔒 {lang === 'ko' ? '뷰어 전용 모드 — 편집이 비활성화되어 있습니다.' : 'View-Only Mode — Editing is disabled.'}
        </div>
      )}

      {/* ════════ MAIN AREA ════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ══════ LEFT PANEL — hidden on mobile, collapsible on tablet ══════ */}
        {!isReadOnly && <LeftPanel
          lang={lang}
          t={t as unknown as Record<string, string>}
          gt={gt}
          isMobile={isMobile}
          isTablet={isTablet}
          tier1={tier1}
          tier2={tier2}
          effectiveResult={effectiveResult}
          featureHistory={featureHistoryWithErrors ?? null}
          features={features}
          rollbackTo={rollbackTo}
          startEditing={startEditing}
          finishEditing={finishEditing}
          toggleExpanded={toggleExpanded}
          toggleFeature={toggleFeature}
          removeNode={removeNode}
          updateFeatureParam={updateFeatureParam}
          addFeature={addFeatureWithContext}
          moveFeatureByIds={handleMoveFeatureByIds}
          sketchProfiles={sketchProfiles}
          activeProfileIdx={activeProfileIdx}
          sketchOperation={sketchOperation}
          sketchPlaneOffset={sketchPlaneOffset}
          showSketchHistory={showSketchHistory}
          editingSketchFeatureId={editingSketchFeatureId}
          sketchHistory={sketchHistory}
          onSketchModeStart={() => setIsSketchMode(true)}
          onSketchViewModeChange={setSketchViewMode}
          onSketchPlaneChange={setSketchPlane}
          onSketchOperationChange={setSketchOperation}
          onSketchPlaneOffsetChange={setSketchPlaneOffset}
          onToggleSketchHistory={() => setShowSketchHistory(v => !v)}
          onLoadSketchFromHistory={handleLoadSketchFromHistory}
          onDeleteSketchHistoryEntry={handleDeleteSketchHistoryEntry}
          onSketchClear={handleSketchClear}
          onSketchUndo={handleSketchUndo}
          onSketchGenerate={handleSketchGenerate}
          sketchStep={sketchStep}
          onSketchStepChange={setSketchStep}
          onSetActiveProfile={handleSetActiveProfile}
          onAddHoleProfile={handleAddHoleProfile}
          onDeleteProfile={handleDeleteProfile}
          onAddSketchFeature={handleAddSketchToFeatureTree}
          onEditSketchFeature={handleEditSketchFeature}
          constraintStatus={constraintStatus}
          constraintDiagnostic={constraintDiagnostic}
          onSelectShape={handleSelectShape}
          onParamChange={handleParamChange}
          onExpressionChange={handleExpressionChange}
          onParamCommit={handleParamCommit}
          onShapeReset={handleShapeReset}
          formulaValues={formulaValues}
          onFormulaChange={handleFormulaChange}
          modelVars={modelVars.map(v => ({ name: v.name, value: v.value }))}
          bomParts={bomParts}
          bomLabel={bomLabel}
          showBomExportMenu={showBomExportMenu}
          onToggleBomExportMenu={() => setShowBomExportMenu(v => !v)}
          onExportBomCSV={handleExportBomCSV}
          onExportBomExcel={handleExportBomExcel}
          cartItemsCount={cartItems.length}
          importedFilename={importedFilename}
          renderSettings={renderSettings}
          onRenderSettingsChange={setRenderSettings}
          onRenderCapture={() => {
            if (renderCanvasRef.current) {
              setScreenshotModal({ canvas: renderCanvasRef.current });
            }
          }}
          customDomainGeometry={customDomainGeometry}
          dfmParamWarnings={dfmParamWarnings}
          useCustomDomain={useCustomDomain}
          onUseCustomDomainChange={setUseCustomDomain}
          dimX={dimX}
          dimY={dimY}
          dimZ={dimZ}
          onDimChange={handleDimChange}
          materialKey={materialKey}
          onMaterialKeyChange={setMaterialKey}
          fixedFaces={fixedFaces}
          loads={loads}
          selectionMode={selectionMode}
          onSelectionModeChange={(m) => setSelectionMode(m)}
          onRemoveFixed={handleRemoveFixed}
          onRemoveLoad={handleRemoveLoad}
          activeLoadForce={activeLoadForce}
          onActiveLoadForceChange={(f) => setActiveLoadForce(f)}
          volfrac={volfrac}
          onVolfracChange={setVolfrac}
          resolution={resolution}
          onResolutionChange={(r) => setResolution(r)}
          penal={penal}
          onPenalChange={setPenal}
          rmin={rmin}
          onRminChange={setRmin}
          maxIter={maxIter}
          onMaxIterChange={setMaxIter}
          isOptimizing={isOptimizing}
          onGenerate={handleGenerate}
          onOptReset={handleOptReset}
          optResult={optResult}
          resultMesh={!!resultMesh}
          weightInfo={weightInfo}
          convergenceChart={convergenceChart}
          onExportOptSTL={handleExportSTL}
          onSendOptToQuote={handleSendOptToQuote}
        />}

        {/* ══════ CENTER — CommandManager + Viewport + StatusBar ══════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

          {/* CommandManager toolbar — hidden in readonly mode */}
          {!isReadOnly && <div data-tour="command-toolbar">
          <CommandToolbar
            activeTab={activeTab} isSketchMode={isSketchMode} editMode={editMode}
            hasResult={!!effectiveResult}
            onSketchMode={(on) => { setIsSketchMode(on); if (on && !isSketchMode) { setSketchResult(null); setEditMode('none'); } else if (!on) { setEditMode('none'); } }}
            onSketchTool={(tool) => setSketchTool((tool === 'rectangle' ? 'rect' : tool) as import('./sketch/types').SketchTool)}
            onEditMode={setEditMode} onAddFeature={addFeatureWithContext}
            onSendToOptimizer={handleSendToOptimizer} onExportSTL={handleExportCurrentSTL}
            onToggleChat={() => { if (showAIAssistant) setShowAIAssistant(false); else openAIAssistant('chat'); }} showChat={showAIAssistant}
            isOptimizing={isOptimizing} onGenerate={handleGenerate}
            canGenerate={!!effectiveResult && fixedFaces.length > 0 && loads.length > 0} resultMesh={!!resultMesh}
            measureActive={measureActive} onToggleMeasure={() => setMeasureActive(v => !v)}
            measureMode={measureMode} onSetMeasureMode={setMeasureMode}
            sectionActive={sectionActive} onToggleSection={() => setSectionActive(v => !v)}
            onTogglePlanes={() => setShowPlanes(!showPlanes)} showPlanes={showPlanes}
            onImportFile={handleImportFile}
            onExportOBJ={handleExportOBJ}
            onExportPLY={handleExportPLY}
            onExport3MF={handleExport3MF}
            onExportSTEP={handleExportSTEP}
            onExportGLTF={handleExportGLTF}
            onExportDXF={handleExportDXF}
            onExportFlatPatternDXF={handleExportFlatPatternDXF}
            onSaveScene={handleSaveScene}
            onLoadScene={handleLoadScene}
            onExportGLB={handleExportGLB}
            onExportRhino={handleExportRhino}
            onExportGrasshopper={handleExportGrasshopper}
            dxfProjection={dxfProjection}
            onDxfProjectionChange={setDxfProjection}
            onMeshProcess={handleMeshProcess}
            onAnalysis={handleAnalysis}
            onStandardParts={handleStandardParts}
            onSheetMetal={handleSheetMetal}
            onExtraction={handleExtraction}
            showLibrary={showLibrary}
            showValidation={showValidation}
            onTogglePlugins={() => setShowPluginManager(!showPluginManager)}
            onToggleScript={() => setShowScriptPanel(!showScriptPanel)}
            onExportDrawingPDF={handleExportDrawingPDF}
            onShare={() => setShareOpenKey(shareOpenKey + 1)}
            onManufacturerMatch={() => setShowManufacturerMatch(true)}
            onBodyManager={handleOpenBodyPanel}
            exportingFormat={exportingFormat}
            onSetCamPost={setMfgCamPost}
            activeCamPost={mfgCamPost}
            onUndo={cmdHistory.undo}
            onRedo={cmdHistory.redo}
            canUndo={cmdHistory.canUndo}
            canRedo={cmdHistory.canRedo}
            showHistoryPanel={showHistoryPanel}
            onToggleHistory={() => setShowHistoryPanel(!showHistoryPanel)}
            showModelParams={showModelParams}
            onToggleModelParams={() => setShowModelParams(v => !v)}
            dfmIssueCount={dfmIssueCount}
            t={t as any}
            lang={lang}
          />
          </div>}

          {/* ── Breadcrumb Navigation ── */}
          <BreadcrumbNav items={(() => {
            const _bc: Record<string, Record<string, string>> = {
              ko: { design: '설계', optimize: '최적화', sketch: '스케치', profile: '프로파일', edit: '편집' },
              en: { design: 'Design', optimize: 'Optimize', sketch: 'Sketch', profile: 'Profile', edit: 'Edit' },
              ja: { design: '設計', optimize: '最適化', sketch: 'スケッチ', profile: 'プロファイル', edit: '編集' },
              cn: { design: '设计', optimize: '优化', sketch: '草图', profile: '轮廓', edit: '编辑' },
              es: { design: 'Diseño', optimize: 'Optimización', sketch: 'Boceto', profile: 'Perfil', edit: 'Editar' },
              ar: { design: 'تصميم', optimize: 'تحسين', sketch: 'رسم', profile: 'ملف تعريف', edit: 'تحرير' },
            };
            const bc = (k: string) => (_bc[lang] ?? _bc.en)[k] ?? (_bc.en[k] ?? k);
            const crumbs: BreadcrumbItem[] = [
              { label: activeTab === 'design' ? bc('design') : bc('optimize'), icon: activeTab === 'design' ? '🧊' : '🔬', onClick: () => setActiveTab(activeTab) },
            ];
            if (isSketchMode) {
              crumbs.push({ label: bc('sketch'), icon: '✏️', onClick: () => {} });
              crumbs.push({ label: `${bc('profile')} ${activeProfileIdx + 1}`, active: true });
            } else if (editMode !== 'none') {
              crumbs.push({ label: bc('edit'), icon: '✎' });
              crumbs.push({ label: editMode, active: true });
            } else if (effectiveResult) {
              const shapeName = (t as any)[`shapeName_${selectedId}`] || selectedId;
              crumbs.push({ label: shapeName, icon: SHAPE_ICONS[selectedId] || '⬡', active: !selectedFeatureId });
              if (selectedFeatureId) {
                const feat = features.find(f => f.id === selectedFeatureId);
                if (feat) crumbs.push({ label: feat.type, active: true, onClick: () => setShowPropertyManager(true) });
              }
            }
            return crumbs;
          })()} />

          {/* ── Selection Filter Bar ── */}
          {!isSketchMode && editMode !== 'none' && (
            <SelectionFilterBar activeFilters={selectionFilters} onToggle={toggleSelectionFilter} lang={lang} />
          )}

          {/* Plugin toolbar buttons */}
          {pluginToolbarButtons.length > 0 && activeTab === 'design' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#161b22', borderBottom: '1px solid #30363d' }}>
              <span style={{ color: '#8b949e', fontSize: 10, fontWeight: 700, marginRight: 4 }}>🧩 {lang === 'ko' ? '플러그인' : 'Plugins'}:</span>
              {pluginToolbarButtons.map(btn => (
                <button
                  key={btn.id}
                  onClick={btn.onClick}
                  title={btn.tooltip || btn.label}
                  style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: '#21262d', color: '#c9d1d9',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; }}
                >
                  <span style={{ fontSize: 14 }}>{btn.icon}</span>
                  {btn.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setShowPluginManager(true)}
                style={{
                  padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  border: '1px solid #30363d', cursor: 'pointer',
                  background: 'transparent', color: '#8b949e',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#c9d1d9'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
              >
                {lang === 'ko' ? '관리' : 'Manage'}
              </button>
            </div>
          )}

          {/* Transform gizmo toggle buttons */}
          {activeTab === 'design' && !isSketchMode && editMode === 'none' && effectiveResult && (
            <div data-tour="transform-tools" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: theme.panelBg, borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ color: theme.textMuted, fontSize: '11px', fontWeight: 600, marginRight: '4px' }}>Transform:</span>
              {([['translate', 'T', 'Translate (T)'], ['rotate', 'R', 'Rotate (R)'], ['scale', 'G', 'Scale (G)']] as const).map(([mode, key, title]) => (
                <button
                  key={mode}
                  onClick={() => setTransformMode(transformMode === mode ? 'off' : mode)}
                  title={title}
                  style={{
                    padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: transformMode === mode ? '#388bfd' : '#21262d',
                    color: transformMode === mode ? '#fff' : '#c9d1d9',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>{key}</span>{mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
              {transformMode !== 'off' && (
                <button
                  onClick={() => setTransformMode('off')}
                  title="Disable transform (Esc)"
                  style={{
                    padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                    border: 'none', cursor: 'pointer', background: '#21262d', color: '#f85149',
                    marginLeft: '4px',
                  }}
                >
                  ✕ Off
                </button>
              )}
            </div>
          )}
          {activeTab === 'design' && !isSketchMode && transformMode !== 'off' && (
            <div style={{ padding: '6px 10px', background: '#0d1117', borderBottom: '1px solid #30363d' }}>
              <TransformInputPanel
                transformMatrix={transformMatrix}
                onMatrixChange={setTransformMatrix}
                lang={lang}
              />
            </div>
          )}

          {/* ── Direct Geometry Edit toolbar ── */}
          {activeTab === 'design' && !isSketchMode && effectiveResult && !simpleMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#0d1117', borderBottom: '1px solid #30363d', flexWrap: 'wrap' }}>
              <span style={{ color: '#8b949e', fontSize: 10, fontWeight: 700, marginRight: 4 }}>
                {lang === 'ko' ? '직접 편집:' : 'Direct Edit:'}
              </span>
              {([
                ['face', '▣', lang === 'ko' ? '면 편집 (Push/Pull)' : 'Face Edit (Push/Pull)', '#388bfd'],
                ['vertex', '⬡', lang === 'ko' ? '버텍스 편집' : 'Vertex Edit', '#22c55e'],
                ['edge', '╱', lang === 'ko' ? '엣지 편집' : 'Edge Edit', '#f59e0b'],
              ] as const).map(([mode, icon, label, activeColor]) => (
                <button
                  key={mode}
                  onClick={() => setEditMode(editMode === mode ? 'none' : mode as any)}
                  title={mode === 'face' ? `${label} — ${lang === 'ko' ? '더블클릭 = 면 스케치' : 'Double-click = Sketch on face'}` : label}
                  style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: editMode === mode ? activeColor : '#21262d',
                    color: editMode === mode ? '#fff' : '#c9d1d9',
                    display: 'flex', alignItems: 'center', gap: 4,
                    position: 'relative',
                  }}
                >
                  <span>{icon}</span>{label}
                  {mode === 'face' && editMode === 'face' && (
                    <span style={{ fontSize: 8, color: '#58a6ff', marginLeft: 2, fontWeight: 600 }}>(더블클릭=스케치)</span>
                  )}
                </button>
              ))}
              <div style={{ width: 1, height: 16, background: '#30363d', margin: '0 4px' }} />
              <button
                onClick={() => setShowCSGPanel(true)}
                title={lang === 'ko' ? 'Boolean 연산 (Union/Subtract/Intersect)' : 'Boolean Operations'}
                style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: showCSGPanel ? '#8b5cf6' : '#21262d',
                  color: showCSGPanel ? '#fff' : '#c9d1d9',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                ⊕ {lang === 'ko' ? 'Boolean' : 'Boolean'}
              </button>
              {editMode !== 'none' && (
                <button
                  onClick={() => setEditMode('none')}
                  style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, border: 'none', cursor: 'pointer', background: '#21262d', color: '#f85149', marginLeft: 4 }}
                >
                  ✕ {lang === 'ko' ? '편집 종료' : 'Exit Edit'}
                </button>
              )}
            </div>
          )}

          {/* Split View toggle */}
          {activeTab === 'design' && !isSketchMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: '#161b22', borderBottom: '1px solid #30363d' }}>
              <button
                onClick={() => setMultiView(!multiView)}
                title={multiView ? 'Single View' : 'Split View'}
                style={{
                  padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: multiView ? '#388bfd' : '#21262d',
                  color: multiView ? '#fff' : '#c9d1d9',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}
              >
                <span style={{ fontSize: '10px', fontFamily: 'monospace' }}>&#x229e;</span>
                {multiView ? 'Single View' : 'Split View'}
              </button>
            </div>
          )}

          {/* ── Workflow Stepper (sketch mode) ── */}
          {isSketchMode && activeTab === 'design' && (
            <WorkflowStepper
              isSketchMode={isSketchMode}
              sketchClosed={(sketchProfiles[activeProfileIdx] ?? sketchProfile).closed}
              hasResult={!!effectiveResult}
              featuresCount={features.length}
              lang={lang}
            />
          )}

          {/* ══ SPLIT LAYOUT: Sketch (left) + 3D Preview (right) ══ */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

            {/* ── Sketch Canvas side (main workspace) ── */}
            {(activeTab === 'design' && (!isMobile || mobileTab !== '3d')) && (
              <div
                ref={sketchContainerRef}
                data-tour="viewport"
                style={{
                  flex: 1,
                  position: 'relative',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRight: isMobile ? 'none' : '1px solid #30363d',
                  touchAction: 'none',
                  cursor: getToolCursor(isSketchMode, sketchTool, editMode, isDragging, measureActive),
                }}
                onMouseDown={(e) => { if (e.button === 2) rightMouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
                onContextMenu={handleContextMenu}
                {...touchGestureHandlers}
              >
                {/* Collab toggle */}
                <button
                  onClick={() => setCollabDemo(!collabDemo)}
                  title={collabDemo ? 'Disable collaboration demo' : 'Enable collaboration demo'}
                  style={{
                    position: 'absolute', top: 8, left: 8, zIndex: 30,
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid #30363d',
                    background: collabDemo ? '#388bfd' : '#21262d',
                    color: collabDemo ? '#fff' : '#8b949e',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'system-ui, sans-serif',
                    transition: 'all 0.15s',
                  }}
                >
                  {collabDemo ? 'Collab ON' : 'Collab'}
                </button>

                {/* CSG loading overlay */}
                {csgLoading && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.35)', pointerEvents: 'none',
                  }}>
                    <div style={{
                      width: 32, height: 32, border: '3px solid rgba(255,255,255,0.2)',
                      borderTopColor: '#58a6ff', borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}

                {/* Empty canvas guide (shown when no result and not in sketch mode) */}
                {!effectiveResult && !isSketchMode && activeTab === 'design' && (
                  <EmptyCanvasGuide
                    lang={lang}
                    onStartSketch={() => { setIsSketchMode(true); setSketchResult(null); setEditMode('none'); }}
                    onImportFile={handleImportFile}
                    onSelectShape={(id: string) => { const sc = SHAPES.find(s => s.id === id); if (sc) handleSelectShape(sc); }}
                    onStartTutorial={tutorial.startTutorial}
                    isImporting={isImporting}
                  />
                )}

                {/* PropertyManager (shown when feature selected) */}
                <PropertyManager
                  visible={showPropertyManager}
                  lang={lang}
                  selectedFeatureId={selectedFeatureId}
                  featureName={selectedFeatureId ? (features.find(f => f.id === selectedFeatureId)?.type || '') : ''}
                  featureType={selectedFeatureId ? (features.find(f => f.id === selectedFeatureId)?.type || '') : ''}
                  featureParams={selectedFeatureId ? (features.find(f => f.id === selectedFeatureId)?.params || {}) : {}}
                  paramDefs={selectedFeatureId ? Object.entries(features.find(f => f.id === selectedFeatureId)?.params || {}).map(([name, val]) => ({
                    name,
                    label: (t as any)[`param_${name}`] || name,
                    min: 0,
                    max: typeof val === 'number' ? Math.max(val * 3, 100) : 100,
                    step: 1,
                  })) : []}
                  onParamChange={(param, value) => { if (selectedFeatureId) updateFeatureParam(selectedFeatureId, param, value); }}
                  onClose={() => setShowPropertyManager(false)}
                  onApply={() => setShowPropertyManager(false)}
                />

                {/* Sketch canvas area (flex: 1, fills remaining space) */}
                <div data-tour="sketch-canvas" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                  {sketchViewMode === '3d' ? (
                    <Sketch3DCanvas
                      profile={sketchProfile}
                      onProfileChange={setSketchProfile}
                      activeTool={sketchTool}
                      sketchPlane={sketchPlane}
                      onUndo={handleSketchUndo}
                      onPlaneChange={setSketchPlane}
                      extrudeDepth={sketchConfig.depth ?? 50}
                      onExtrudeDepthChange={(d) => setSketchConfig({ ...sketchConfig, depth: d })}
                    />
                  ) : sketchViewMode === 'drawing' ? (
                    <DrawingView result={sketchResult || effectiveResult} unitSystem={unitSystem} partName={selectedId} material={materialKey} />
                  ) : (
                    <SketchCanvas
                      profile={sketchProfiles[activeProfileIdx] ?? sketchProfile}
                      onProfileChange={(p) => {
                        captureSketchSnapshot();
                        setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? p : x));
                        setSketchProfile(p);
                      }}
                      activeTool={sketchTool}
                      width={sketchSize.width}
                      height={sketchSize.height}
                      onUndo={handleSketchUndo}
                      constraints={sketchConstraints}
                      dimensions={sketchDimensions}
                      onAddConstraint={handleAddConstraint}
                      onAddDimension={handleAddDimension}
                      selectedConstraintType={selectedConstraintType}
                      otherProfiles={sketchProfiles.filter((_, i) => i !== activeProfileIdx)}
                      onToolChange={setSketchTool}
                      lang={lang as any}
                      ellipseRx={sketchConfig.ellipseRx ?? 25}
                      ellipseRy={sketchConfig.ellipseRy ?? 15}
                      slotRadius={sketchConfig.slotRadius ?? 10}
                      filletRadius={sketchConfig.filletRadius ?? 5}
                    />
                  )}

                  {/* First-use sketch hint — shows once, then dismissed */}
                  {sketchViewMode === '2d' && (
                    <SketchContextTip visible={isSketchMode} lang={lang} />
                  )}
                </div>

                {/* ── Enhanced Extrude Action Menu (shown when sketch profile is closed) ── */}
                {(sketchProfiles[activeProfileIdx] ?? sketchProfile).segments.length > 0 && (sketchProfiles[activeProfileIdx] ?? sketchProfile).closed && showSketchActionMenu && (
                  <>
                    <style>{`
                      @keyframes nf-extrude-pulse {
                        0%, 100% { box-shadow: 0 4px 20px rgba(56,139,253,0.45); }
                        50% { box-shadow: 0 6px 32px rgba(56,139,253,0.8), 0 0 16px rgba(56,139,253,0.4); }
                      }
                    `}</style>
                    <div style={{
                      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      zIndex: 40,
                      background: 'rgba(22,27,34,0.97)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid #30363d',
                      borderRadius: 14,
                      padding: '16px 20px',
                      display: 'flex', flexDirection: 'column', gap: 12,
                      minWidth: 280,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      transition: 'opacity 0.2s, transform 0.2s',
                    }}>
                      {/* Depth slider */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: '#8b949e', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {lang === 'ko' ? '깊이 (mm)' : 'Depth (mm)'}
                        </span>
                        <input
                          type="range"
                          min={10} max={200} step={1}
                          value={sketchConfig.depth ?? 50}
                          onChange={e => setSketchConfig({ ...sketchConfig, depth: Number(e.target.value) })}
                          style={{ flex: 1, accentColor: '#388bfd' }}
                        />
                        <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 700, minWidth: 32, textAlign: 'right', fontFamily: 'monospace' }}>
                          {sketchConfig.depth ?? 50}
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          data-tour="extrude-cta"
                          onClick={handleSketchGenerate}
                          style={{
                            flex: 2,
                            padding: '10px 16px', borderRadius: 8,
                            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                            border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                            cursor: 'pointer',
                            animation: 'nf-extrude-pulse 2s ease-in-out infinite',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="3" y1="17" x2="15" y2="17"/>
                          </svg>
                          {lang === 'ko' ? '돌출 (Extrude)' : 'Extrude'}
                        </button>
                        <button
                          onClick={() => {
                            setSketchConfig({ ...sketchConfig, mode: 'revolve' });
                            setTimeout(() => handleSketchGenerate(), 0);
                          }}
                          style={{
                            flex: 1,
                            padding: '10px 10px', borderRadius: 8,
                            background: '#21262d',
                            border: '1px solid #30363d', color: '#c9d1d9', fontSize: 12, fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a10 10 0 1 0 10 10"/><polyline points="22 2 22 12 12 12"/>
                          </svg>
                          {lang === 'ko' ? '회전' : 'Revolve'}
                        </button>
                        <button
                          onClick={() => setShowSketchActionMenu(false)}
                          style={{
                            flex: 1,
                            padding: '10px 10px', borderRadius: 8,
                            background: '#21262d',
                            border: '1px solid #30363d', color: '#8b949e', fontSize: 12, fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {lang === 'ko' ? '계속 편집' : 'Continue Editing'}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Extrude hint when sketch has open (non-closed) segments */}
                {(sketchProfiles[activeProfileIdx] ?? sketchProfile).segments.length > 0 && !(sketchProfiles[activeProfileIdx] ?? sketchProfile).closed && (
                  <div style={{
                    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 40,
                  }}>
                    <span style={{
                      background: '#21262d', border: '1px solid #30363d',
                      borderRadius: 6, padding: '5px 14px', color: '#8b949e', fontSize: 11,
                      fontFamily: 'system-ui, sans-serif',
                    }}>
                      {lang === 'ko' ? '첫 점을 클릭하거나 더블클릭하여 프로파일 닫기' : 'Click first point or double-click to close profile'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── 3D Preview toggle button (shown when hidden) ── */}
            {activeTab === 'design' && !isMobile && !show3DPreview && (
              <button
                onClick={() => setShow3DPreview(true)}
                title={lang === 'ko' ? '3D 프리뷰 표시' : 'Show 3D Preview'}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  zIndex: 30, padding: '8px 6px', borderRadius: 8,
                  background: '#21262d', border: '1px solid #30363d',
                  color: '#8b949e', fontSize: 11, cursor: 'pointer',
                  writingMode: 'vertical-rl', fontWeight: 700,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = '#c9d1d9'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#8b949e'; }}
              >
                3D ▶
              </button>
            )}

            {/* ── 3D Preview side (right panel) ── */}
            {activeTab === 'design' && (!isMobile || mobileTab === '3d') && show3DPreview && (
              <div style={{
                width: isMobile ? '100%' : 380,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: '#0d1117',
                position: 'relative',
              }}>
              {/* Hide 3D Preview button */}
              <button
                onClick={() => setShow3DPreview(false)}
                title={lang === 'ko' ? '3D 프리뷰 숨기기' : 'Hide 3D Preview'}
                style={{
                  position: 'absolute', top: 8, left: 8, zIndex: 30,
                  padding: '3px 8px', borderRadius: 5,
                  background: 'rgba(33,38,45,0.85)', border: '1px solid #30363d',
                  color: '#6e7681', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#6e7681'; }}
              >
                ◀ {lang === 'ko' ? '숨기기' : 'Hide'}
              </button>
              {/* Live preview badge (Feature 5) */}
              {isSketchMode && liveSketchResult && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 30,
                  padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
                  color: '#22c55e', fontSize: 10, fontWeight: 700,
                  fontFamily: 'monospace', letterSpacing: '0.08em',
                  pointerEvents: 'none',
                }}>
                  LIVE
                </div>
              )}
                {/* Bounding box center coordinate display */}
              {(liveSketchResult ?? effectiveResult) && (() => {
                const res = liveSketchResult ?? effectiveResult!;
                return (
                  <div style={{
                    position: 'absolute', bottom: 8, left: 0, right: 0, zIndex: 20,
                    display: 'flex', justifyContent: 'center', pointerEvents: 'none',
                  }}>
                    <div style={{
                      background: 'rgba(13,17,23,0.85)', border: '1px solid #21262d',
                      padding: '3px 12px', borderRadius: 6,
                      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                      display: 'flex', gap: 8, alignItems: 'center', color: '#484f58',
                    }}>
                      <span style={{ color: '#6e7681' }}>Center:</span>
                      <span style={{ color: '#ef4444' }}>X</span><span style={{ color: '#c9d1d9' }}>{(res.bbox.w / 2).toFixed(1)}</span>
                      <span style={{ color: '#22c55e' }}>Y</span><span style={{ color: '#c9d1d9' }}>{(res.bbox.h / 2).toFixed(1)}</span>
                      <span style={{ color: '#3b82f6' }}>Z</span><span style={{ color: '#c9d1d9' }}>{(res.bbox.d / 2).toFixed(1)}</span>
                      <span>mm</span>
                    </div>
                  </div>
                );
              })()}
              {collabUsers.length > 0 && (
                  <CollabPresence users={collabUsers} />
                )}
                {/* Part Placement toggle */}
                <button
                  onClick={() => setShowPartPlacement(s => !s)}
                  title={lang === 'ko' ? '파트 배치 패널' : 'Part Placement'}
                  style={{
                    position: 'absolute', top: 8, left: 8, zIndex: 30,
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid #30363d',
                    background: showPartPlacement ? '#388bfd' : '#21262d',
                    color: showPartPlacement ? '#fff' : '#8b949e',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'system-ui, sans-serif',
                    transition: 'all 0.15s',
                  }}
                >
                  {lang === 'ko' ? `⊞ 배치${placedParts.length > 0 ? ` (${placedParts.length})` : ''}` : `⊞ Parts${placedParts.length > 0 ? ` (${placedParts.length})` : ''}`}
                </button>

                {bomParts.length > 1 && (
                  <button
                    onClick={() => setShowAssemblyPanel(!showAssemblyPanel)}
                    title={lang === 'ko' ? '어셈블리 도구' : 'Assembly Tools'}
                    style={{
                      position: 'absolute', top: 8, zIndex: 30,
                      padding: '4px 10px', borderRadius: 6,
                      border: '1px solid #30363d',
                      background: showAssemblyPanel ? '#388bfd' : '#21262d',
                      color: showAssemblyPanel ? '#fff' : '#8b949e',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'system-ui, sans-serif',
                      transition: 'all 0.15s',
                    }}
                  >
                    {lang === 'ko' ? '어셈블리' : 'Assembly'}
                  </button>
                )}
                {!webglSupported ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', background: '#0d1117', color: '#e6edf3',
                    flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 48 }}>⚠️</div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>WebGL Not Supported</h3>
                    <p style={{ margin: 0, fontSize: 14, color: '#8b949e', maxWidth: 400 }}>
                      Your browser does not support WebGL, which is required for the 3D modeler.
                      Please try Chrome, Firefox, or Edge with hardware acceleration enabled.
                    </p>
                  </div>
                ) : multiView ? (
                  <MultiViewport
                    result={effectiveResult}
                    bomParts={bomParts.length > 0 ? bomParts : undefined}
                  />
                ) : (
                  <ShapePreview
                    result={
                      showThermalOverlay && thermalOverlayGeo && effectiveResult
                        ? { ...effectiveResult, geometry: thermalOverlayGeo }
                        : showGenOverlay && genDesignResult && effectiveResult
                          ? { ...effectiveResult, geometry: genDesignResult }
                          : (liveSketchResult ?? effectiveResult)
                    }
                    bomParts={bodyBomParts ?? (bomParts.length > 0 ? bomParts : undefined)}
                    assemblyLabel={bomLabel || undefined}
                    onCapture={(cb) => {
                      captureRef.current = cb;
                      const canvasEl = document.querySelector('canvas[data-engine]') as HTMLCanvasElement | null;
                      if (canvasEl) renderCanvasRef.current = canvasEl;
                    }}
                    editMode={editMode}
                    onDragStateChange={setIsDragging}
                    showDimensions={showDimensions}
                    measureActive={measureActive}
                    measureMode={measureMode}
                    sectionActive={sectionActive}
                    sectionAxis={sectionAxis}
                    sectionOffset={sectionOffset}
                    showPlanes={showPlanes}
                    constructPlanes={showPlanes ? defaultPlanes : undefined}
                    unitSystem={unitSystem}
                    transformMode={transformMode}
                    onTransformChange={setTransformMatrix}
                    snapGrid={snapEnabled ? snapSize : undefined}
                    showPerf={showPerf}
                    materialId={materialId}
                    collabUsers={collabUsers}
                    showPrintAnalysis={showPrintAnalysis && !simpleMode}
                    printAnalysis={printAnalysis}
                    printBuildDirection={printBuildDir}
                    printOverhangAngle={printOverhangAngle}
                    renderMode={renderMode}
                    renderSettings={renderMode === 'photorealistic' ? renderSettings : undefined}
                    onCaptureScreenshot={renderMode === 'photorealistic' ? () => {
                      if (renderCanvasRef.current) {
                        setScreenshotModal({ canvas: renderCanvasRef.current });
                      }
                    } : undefined}
                    explodeFactor={explodeFactor}
                    interferenceHighlights={interferenceResults.length > 0 ? interferenceResults : undefined}
                    showFEA={showFEA && !simpleMode}
                    feaResult={feaResult}
                    feaDisplayMode={feaDisplayMode}
                    feaDeformationScale={feaDeformationScale}
                    showDFM={showDFM && !simpleMode}
                    dfmResults={dfmResults}
                    dfmHighlightedIssue={dfmHighlightedIssue}
                    showCenterOfMass={showCenterOfMass}
                    gdtAnnotations={gdtAnnotations.length > 0 ? gdtAnnotations : undefined}
                    dimensionAnnotations={dimensionAnnotations.length > 0 ? dimensionAnnotations : undefined}
                    onSceneReady={(scene) => { sceneRef.current = scene; }}
                    onCameraPlaneChange={isSketchMode ? setSketchPlaneRaw : undefined}
                    sketchPlane={isSketchMode ? (sketchPlane as 'xy' | 'xz' | 'yz') : undefined}
                    onSketchPlaneChange={isSketchMode ? setSketchPlane : undefined}
                    onGeometryApply={handleGeometryApply}
                    lang={lang}
                    arrayPattern={arrayPattern}
                    showArray={showArrayPanel && !!arrayPattern && !simpleMode}
                    onOpenLibrary={() => setShowLibrary(true)}
                    onStartSketch={() => setIsSketchMode(true)}
                    onOpenChat={() => openAIAssistant('chat')}
                    pinComments={comments}
                    isPlacingComment={isPlacingComment}
                    onAddPinComment={(pos, text) => addComment(pos, text, authUser?.name ?? 'Guest', 'comment')}
                    onResolvePinComment={resolveComment}
                    onDeletePinComment={deleteComment}
                    onFaceSketch={(_faceId) => {
                      setEditMode('none');
                      setIsSketchMode(true);
                      setSketchProfile({ segments: [], closed: false });
                    }}
                    onDimClick={(dim, value) => {
                      const paramMap: Record<string, string> = { w: 'width', h: 'height', d: 'depth' };
                      const paramKey = paramMap[dim];
                      if (paramKey && paramKey in params) {
                        setParams({ ...params, [paramKey]: value });
                      }
                    }}
                    snapEnabled={snapEnabled}
                    ghostResult={isPreviewMode ? previewResult : null}
                    motionPartTransforms={motionPartTransforms}
                    onFileImport={async (file) => {
                      // Reuse the same import logic as the file-picker handler (handleFileSelected)
                      try {
                        const { importFile } = await import('./io/importers');
                        const { geometry, filename } = await importFile(file);
                        const { makeEdges, meshVolume, meshSurfaceArea } = await import('./shapes');
                        const edgeGeometry = makeEdges(geometry);
                        const volume_cm3 = meshVolume(geometry) / 1000;
                        const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
                        geometry.computeBoundingBox();
                        const bb = geometry.boundingBox!;
                        const { Vector3 } = await import('three');
                        const size = bb.getSize(new Vector3());
                        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
                        setImportedGeometry(geometry);
                        setSketchResult({ geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
                        setBomParts([]); setBomLabel('');
                        setIsSketchMode(false);
                        addToast('success', lang === 'ko'
                          ? `"${filename}" 불러오기 완료`
                          : `Imported "${filename}" successfully`);
                        try {
                          const ext = filename.split('.').pop()?.toLowerCase() ?? '';
                          const recent = JSON.parse(localStorage.getItem('nf_recent_files') ?? '[]');
                          const entry = { name: filename, ext, date: Date.now() };
                          localStorage.setItem('nf_recent_files', JSON.stringify([entry, ...recent.filter((r: { name: string }) => r.name !== filename)].slice(0, 5)));
                        } catch { /* localStorage unavailable */ }
                      } catch (err) {
                        addToast('error', lang === 'ko'
                          ? `파일 불러오기 실패: ${err instanceof Error ? err.message : String(err)}`
                          : `Import failed: ${err instanceof Error ? err.message : String(err)}`);
                      }
                    }}
                  />
                )}
                {/* Manufacturing Ready Card */}
                {showManufacturingCard && effectiveResult && (
                  <ManufacturingReadyCard
                    result={effectiveResult}
                    materialId={materialId}
                    quantity={1}
                    lang={lang}
                    dfmResults={dfmResults}
                    onClose={() => setShowManufacturingCard(false)}
                    onDetailAnalysis={() => {
                      setShowDFM(true);
                      setShowMassProps(true);
                      openAIAssistant('suggestions');
                    }}
                    onRequestQuote={() => void handleGetQuote()}
                    onOptimize={() => setActiveTab('optimize')}
                  />
                )}
              </div>
            )}

            {/* ── Optimize tab: full-width GenDesignViewer ── */}
            {activeTab === 'optimize' && (
              <div
                ref={sketchContainerRef}
                style={{ flex: 1, position: 'relative', touchAction: 'none' }}
                onMouseDown={(e) => { if (e.button === 2) rightMouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
                onContextMenu={handleContextMenu}
                {...touchGestureHandlers}
                onMouseMove={collabConnected ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                  collabSendCursor({ x: nx * 30, y: ny * 20, z: 0 });
                } : undefined}
              >
                <GenDesignViewer
                  dimX={dimX} dimY={dimY} dimZ={dimZ}
                  nx={RESOLUTION_MAP[resolution].nx}
                  ny={RESOLUTION_MAP[resolution].ny}
                  nz={RESOLUTION_MAP[resolution].nz}
                  fixedFaces={fixedFaces} loads={loads}
                  selectionMode={selectionMode} onFaceClick={handleFaceClick}
                  resultMesh={resultMesh} isOptimizing={isOptimizing} progress={progress}
                />
              </div>
            )}
          </div>

          {/* Timeline bar */}
          {activeTab === 'design' && features.length > 0 && (
            <TimelineBar
              features={features}
              selectedId={selectedFeatureId}
              onSelect={setSelectedFeatureId}
              onToggle={toggleFeature}
              baseShapeName={(t as any)[`shapeName_${selectedId}`] || selectedId}
              baseShapeIcon={SHAPE_ICONS[selectedId] || '🧊'}
              analysisProgress={
                feaWorkerLoading ? { type: 'fea', label: 'FEA', pct: 50, running: true }
                : dfmWorkerLoading ? { type: 'dfm', label: 'DFM', pct: 70, running: true }
                : null
              }
            />
          )}

          {/* ── Status Bar (VS Code-style bottom bar) ── */}
          <StatusBar
            lang={lang}
            cursor3D={cursor3DPos}
            unitSystem={unitSystem}
            onToggleUnit={() => setUnitSystem(u => u === 'mm' ? 'inch' : 'mm')}
            selectionCount={0}
            activeTool={isSketchMode ? sketchTool : null}
            isSketchMode={isSketchMode}
            editMode={editMode}
            featureCount={features.length}
            triangleCount={effectiveResult?.geometry?.index ? effectiveResult.geometry.index.count / 3 : 0}
            snapEnabled={snapEnabled}
            onToggleSnap={() => setSnapEnabled(v => !v)}
            sectionActive={sectionActive}
            sectionAxis={sectionAxis}
            sectionOffset={sectionOffset}
            onSectionAxisChange={setSectionAxis}
            onSectionOffsetChange={setSectionOffset}
            isOptimizing={isOptimizing}
            progress={progress}
            onShowShortcuts={() => setShowShortcuts(true)}
          />
        </div>

        {/* ══════ RIGHT PANEL (extracted) ══════ */}
        <RightPanel
          lang={lang}
          t={t as unknown as Record<string, string>}
          effectiveResult={effectiveResult}
          geometryMetrics={geometryMetrics}
          massProperties={massProperties}
          feaTotalFaces={feaTotalFaces}
          unitSystem={unitSystem}
          assemblyMates={assemblyMates}
          interferenceResults={interferenceResults}
          interferenceLoading={interferenceLoading}
          assemblyPartNames={assemblyPartNames}
          bomPartsLength={bomParts.length}
          designContext={designContext}
          pendingChatMsg={pendingChatMsg}
          isPreviewMode={isPreviewMode}
          isSketchMode={isSketchMode}
          onPrintAnalyze={handlePrintAnalyze}
          printOptimization={printOptimization}
          onOptimizeOrientation={handleOptimizeOrientation}
          onApplyOptimalOrientation={handleApplyOptimalOrientation}
          onExportPrintReady={handleExportPrintReady}
          onDFMAnalyze={handleDFMAnalyze}
          processRecommendations={processRecommendations}
          onFEARunAnalysis={handleFEARunAnalysis}
          onAddGDT={handleAddGDT}
          onUpdateGDT={handleUpdateGDT}
          onRemoveGDT={handleRemoveGDT}
          onAddDimension={handleAddDimAnnotation}
          onUpdateDimension={handleUpdateDimAnnotation}
          onRemoveDimension={handleRemoveDimAnnotation}
          onApplyDimension={(param, value) => setParam(param, value)}
          onAddMate={handleAddMate}
          onRemoveMate={handleRemoveMate}
          onUpdateMate={handleUpdateMate}
          onDetectInterference={handleDetectInterference}
          onGetQuote={handleGetQuote}
          onApplyArray={(pattern) => { setArrayPattern(pattern); }}
          onChatApplySingle={handleChatApplySingle as any}
          onChatApplyBom={handleChatApplyBom as any}
          onBomPreview={handleBomPreview as any}
          onChatApplySketch={handleChatApplySketch}
          onChatApplyOptimize={handleChatApplyOptimize}
          onChatApplyModify={handleChatApplyModify}
          onModifyAutoApplied={handleModifyAutoApplied}
          onAiPreview={handleAiPreview}
          onCancelPreview={handleCancelPreview}
          onTextToCAD={handleTextToCAD}
          chatHistory={chatHistory}
          onChatHistoryChange={setChatHistory}
        />

      </div>

      {/* Hidden file input for import */}
      <input ref={fileInputRef} type="file" accept=".stl,.obj,.ply,.step,.stp,.iges,.igs,.brep,.dxf" style={{ display: 'none' }}
        onChange={handleFileSelected} />

      {/* Hidden file input for scene load */}
      <input ref={sceneFileInputRef} type="file" accept=".nexyfab,.json" style={{ display: 'none' }}
        onChange={handleSceneFileSelected} />

      {/* CAM Simulation Viewer */}
      {camSimResult && (
        <CAMSimPanel
          result={camSimResult.result}
          operation={camSimResult.operation}
          lang={lang}
          onClose={() => setCamSimResult(null)}
        />
      )}

      {/* COTS Panel */}
      <COTSPanel
        open={showCOTSPanel}
        onClose={() => setShowCOTSPanel(false)}
        lang={lang}
        onInsert={(part: COTSPart) => {
          addToast('success', lang === 'ko'
            ? `${part.nameKo} BOM에 추가됨`
            : `${part.name} added to BOM`);
        }}
      />

      {/* Cart panel (shared) */}
      <ShapeCart items={cartItems} onRemove={removeCartItem} onClear={clearCart} onBatchQuote={handleBatchQuote} t={t as any} />
      {cartItems.length > 0 && <div style={{ height: 180 }} />}

      {/* ═══ Validation Results Modal ═══ */}
      {!simpleMode && showValidation && validationResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowValidation(false)}>
          <div style={{ background: '#21262d', borderRadius: 14, padding: 24, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #30363d' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#c9d1d9' }}>
                {lang === 'ko' ? '지오메트리 검증 결과' : 'Geometry Validation'}
              </h3>
              <button onClick={() => setShowValidation(false)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#8b949e' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              {[
                [lang === 'ko' ? '매니폴드' : 'Manifold', validationResult.isManifold ? '✅' : '❌'],
                [lang === 'ko' ? '닫힌 메시' : 'Closed', validationResult.isClosed ? '✅' : '❌'],
                [lang === 'ko' ? '일관된 노말' : 'Consistent Normals', validationResult.hasConsistentNormals ? '✅' : '❌'],
                [lang === 'ko' ? '열린 에지' : 'Open Edges', String(validationResult.openEdges)],
                [lang === 'ko' ? '비매니폴드 에지' : 'Non-manifold Edges', String(validationResult.nonManifoldEdges)],
                [lang === 'ko' ? '퇴화 삼각형' : 'Degenerate Tri', String(validationResult.degenerateTriangles)],
                [lang === 'ko' ? '중복 정점' : 'Duplicate Vertices', String(validationResult.duplicateVertices)],
                [lang === 'ko' ? '총 삼각형' : 'Total Triangles', String(validationResult.totalTriangles)],
                [lang === 'ko' ? '총 정점' : 'Total Vertices', String(validationResult.totalVertices)],
                [lang === 'ko' ? '체적' : 'Volume', `${(validationResult.volume / 1000).toFixed(2)} cm³`],
                [lang === 'ko' ? '표면적' : 'Surface Area', `${(validationResult.surfaceArea / 100).toFixed(2)} cm²`],
              ].map(([label, val], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: i % 2 === 0 ? '#161b22' : '#1b1f27', borderRadius: 6 }}>
                  <span style={{ color: '#8b949e', fontWeight: 600 }}>{label}</span>
                  <span style={{ fontWeight: 700, color: '#c9d1d9' }}>{val}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: 10, background: '#0d1117', borderRadius: 8, fontSize: 11, border: '1px solid #30363d' }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#3fb950' }}>{lang === 'ko' ? '검사 결과' : 'Issues'}</div>
              {validationResult.issues.map((issue, i) => (
                <div key={i} style={{ color: '#c9d1d9', marginBottom: 2 }}>• {issue}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Standard Parts Library Panel ═══ */}
      {showLibrary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowLibrary(false)}>
          <div style={{ background: '#21262d', borderRadius: 14, padding: 24, maxWidth: 600, width: '90%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #30363d' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#c9d1d9' }}>
                {lang === 'ko' ? '표준 부품 라이브러리' : 'Standard Parts Library'}
              </h3>
              <button onClick={() => setShowLibrary(false)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#8b949e' }}>✕</button>
            </div>
            {[
              { key: 'fastener', label: lang === 'ko' ? '체결류' : 'Fasteners', icon: '🔩' },
              { key: 'structural', label: lang === 'ko' ? '구조재' : 'Structural', icon: '🏗️' },
              { key: 'bearing', label: lang === 'ko' ? '베어링' : 'Bearings', icon: '⊚' },
            ].map(cat => (
              <div key={cat.key} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8b949e', textTransform: 'uppercase', marginBottom: 8 }}>
                  {cat.icon} {cat.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {[
                    ...(cat.key === 'fastener' ? [
                      { id: 'hexBolt', name: lang === 'ko' ? '육각 볼트' : 'Hex Bolt', icon: '🔩', std: 'ISO 4014' },
                      { id: 'hexNut', name: lang === 'ko' ? '육각 너트' : 'Hex Nut', icon: '⬡', std: 'ISO 4032' },
                      { id: 'socketHeadCapScrew', name: lang === 'ko' ? '소켓 캡스크류' : 'Socket Cap Screw', icon: '🔧', std: 'ISO 4762' },
                      { id: 'flatWasher', name: lang === 'ko' ? '평와셔' : 'Flat Washer', icon: '⊙', std: 'ISO 7089' },
                      { id: 'springWasher', name: lang === 'ko' ? '스프링 와셔' : 'Spring Washer', icon: '◎', std: 'DIN 127' },
                    ] : cat.key === 'structural' ? [
                      { id: 'iBeam', name: lang === 'ko' ? 'I빔' : 'I-Beam', icon: '🏗️', std: 'ISO 657' },
                      { id: 'angleBracket', name: lang === 'ko' ? 'L앵글' : 'Angle Bracket', icon: '📐', std: 'ISO 657' },
                      { id: 'channelBeam', name: lang === 'ko' ? 'C채널' : 'Channel', icon: '⊏', std: 'ISO 657' },
                    ] : [
                      { id: 'ballBearing', name: lang === 'ko' ? '볼 베어링' : 'Ball Bearing', icon: '⊚', std: 'ISO 15' },
                      { id: 'bushing', name: lang === 'ko' ? '부싱' : 'Bushing', icon: '◯', std: 'ISO 3547' },
                    ]),
                  ].map(part => (
                    <button key={part.id} onClick={() => { handleSelectStandardPart(part.id); setShowLibrary(false); }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        padding: '12px 8px', borderRadius: 10,
                        border: selectedStandardPart === part.id ? '2px solid #388bfd' : '1px solid #30363d',
                        background: selectedStandardPart === part.id ? '#388bfd22' : '#161b22',
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#58a6ff'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = selectedStandardPart === part.id ? '#388bfd' : '#30363d'}
                    >
                      <span style={{ fontSize: 24 }}>{part.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9', textAlign: 'center' }}>{part.name}</span>
                      <span style={{ fontSize: 9, color: '#8b949e' }}>{part.std}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Context Menu ═══ */}
      <ContextMenu x={ctxMenu.x} y={ctxMenu.y} visible={ctxMenu.visible}
        items={ctxMenu.items} onSelect={handleContextSelect} onClose={handleContextClose} />

      {/* ═══ Screenshot Share Modal ═══ */}
      {screenshotModal && (
        <ScreenshotShareModal
          canvas={screenshotModal.canvas}
          shapeName={String(useSceneStore.getState().params.name ?? '')}
          isKo={lang === 'ko'}
          onClose={() => setScreenshotModal(null)}
          onDownload={() => {
            downloadScreenshot(screenshotModal.canvas, `nexyfab-render-${Date.now()}.png`, 2);
            addToast('success', lang === 'ko' ? '스크린샷이 저장되었습니다' : 'Screenshot saved');
          }}
        />
      )}

      {/* ═══ Toast Notifications ═══ */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* ═══ Keyboard Shortcuts Help ═══ */}
      <ShortcutHelp visible={showShortcuts} onClose={() => setShowShortcuts(false)} lang={lang} />

      {/* ═══ Context-aware Help Panel (?, sketch/feature/render 진입 시) ═══ */}
      <ContextHelpPanel
        visible={contextHelp.visible}
        context={contextHelp.context}
        lang={lang}
        onClose={contextHelp.hide}
        onDismissForever={contextHelp.dismissForever}
        onOpenShortcuts={() => useUIStore.getState().togglePanel('showShortcuts')}
      />

      {/* ═══ Auto-save Indicator (상단 중앙 토스트 근처) ═══ */}
      {viewMode === 'workspace' && (
        <AutoSaveIndicator isSaving={isSaving} lastSavedAt={lastSavedAt} saveError={saveError} lang={lang} cloudStatus={cloudStatus} cloudSavedAt={cloudSavedAt} />
      )}

      {/* ═══ OCCT Engine Toggle (experimental — #98 phase 2d) ═══ */}
      {viewMode === 'workspace' && (
        <button
          type="button"
          onClick={() => { void setOcctMode(!occtMode); }}
          disabled={occtInitPending}
          title={occtInitError ?? (lang === 'ko' ? 'OCCT 토폴로지 엔진 (실험)' : 'OCCT topology engine (experimental)')}
          style={{
            position: 'fixed',
            bottom: 12,
            right: 12,
            zIndex: 50,
            padding: '6px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            borderRadius: 6,
            border: `1px solid ${occtMode ? '#10b981' : '#4b5563'}`,
            background: occtMode ? 'rgba(16,185,129,0.15)' : 'rgba(31,41,55,0.85)',
            color: occtMode ? '#10b981' : '#9ca3af',
            cursor: occtInitPending ? 'wait' : 'pointer',
            opacity: occtInitPending ? 0.6 : 1,
          }}
        >
          OCCT: {occtInitPending ? '...' : occtMode ? 'ON' : 'OFF'}
          {occtInitError ? ' ⚠' : ''}
        </button>
      )}

      {/* ═══ Tutorial Overlay ═══ */}
      {tutorial.showTutorial && tutorial.step && (
        <TutorialOverlay
          visible={tutorial.showTutorial}
          step={tutorial.step}
          currentStep={tutorial.currentStep}
          totalSteps={tutorial.totalSteps}
          isFirstStep={tutorial.isFirstStep}
          isLastStep={tutorial.isLastStep}
          onNext={tutorial.nextStep}
          onPrev={tutorial.prevStep}
          onSkip={tutorial.skipTutorial}
          lang={lang}
        />
      )}

      {/* ═══ Welcome Banner (first-time visitors only) ═══ */}
      {tutorial.showWelcomeBanner && (
        <WelcomeBanner
          lang={lang}
          onStartTutorial={tutorial.startTutorial}
          onDismiss={tutorial.completeTutorial}
        />
      )}

      {/* ═══ Version History Panel ═══ */}
      <VersionPanel
        visible={showVersionPanel}
        versions={versions}
        onClose={() => setShowVersionPanel(false)}
        onSaveSnapshot={handleSaveVersionSnapshot}
        onRestore={handleRestoreVersion}
        onDelete={deleteVersion}
        onRename={renameVersion}
        theme={theme}
        lang={lang}
        branches={branches}
        activeBranch={activeBranch}
        onCreateBranch={handleCreateBranch}
        onSwitchBranch={handleSwitchBranch}
        onDeleteBranch={handleDeleteBranch}
        onShowCompare={() => setShowBranchCompare(true)}
        onShow3DDiff={(a, b) => setVersionDiffPair([a, b])}
      />

      {/* ═══ Command History Panel ═══ */}
      {showHistoryPanel && (
        <HistoryPanel lang={lang} onClose={() => setShowHistoryPanel(false)} />
      )}

      {/* ═══ Branch Compare ═══ */}
      <BranchCompare
        visible={showBranchCompare && !simpleMode}
        branches={branches}
        activeBranch={activeBranch}
        onCompare={compareBranches}
        onMerge={handleMergeBranch}
        onClose={() => setShowBranchCompare(false)}
        theme={theme}
        lang={lang}
      />

      {/* ═══ Version 3D Diff Viewer ═══ */}
      {versionDiffPair && (
        <VersionDiff3DViewer
          versionA={versionDiffPair[0]}
          versionB={versionDiffPair[1]}
          lang={lang}
          onClose={() => setVersionDiffPair(null)}
        />
      )}

      {/* ═══ Plugin Manager ═══ */}
      <PluginManager visible={showPluginManager && !simpleMode} onClose={() => setShowPluginManager(false)} isKo={lang === 'ko'} />

      {/* ═══ NexyScript Panel ═══ */}
      <ScriptPanel visible={showScriptPanel} onClose={() => setShowScriptPanel(false)} lang={lang} />

      {/* ═══ Auth Modal ═══ */}
      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        defaultMode={authModalMode}
      />

      {/* ═══ Model Parameters Panel ═══ */}
      {showModelParams && (
        <ModelParametersPanel
          vars={modelVars}
          onChange={setModelVars}
          lang={lang}
        />
      )}

      {/* ═══ Part Placement Panel ═══ */}
      {showPartPlacement && (
        <div style={{
          position: 'fixed', top: 48, right: 320, zIndex: 900,
          width: 300, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          background: 'rgba(22,27,34,0.97)', backdropFilter: 'blur(12px)',
          border: '1px solid #30363d', borderRadius: 12,
          padding: '12px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <PartPlacementPanel
            parts={placedParts}
            onChange={setPlacedParts}
            isKo={lang === 'ko'}
            currentShapeId={selectedId}
            currentParams={params}
          />
        </div>
      )}

      {/* ═══ Upgrade Prompt ═══ */}
      <UpgradePrompt
        open={showUpgradePrompt}
        feature={upgradeFeature}
        lang={lang}
        onClose={() => setShowUpgradePrompt(false)}
        onLogin={() => { setShowUpgradePrompt(false); setAuthModalMode('signup'); setShowAuthModal(true); }}
      />

      {/* ═══ CAM G-code Upgrade Modal ═══ */}
      <UpgradeModal
        open={showCamUpgrade}
        feature="cam_export"
        lang={lang}
        onClose={() => setShowCamUpgrade(false)}
      />

      {/* ═══ Manufacturer Match Modal ═══ */}
      {showManufacturerMatch && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 8000,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowManufacturerMatch(false)}>
          <div style={{ width: 560, maxHeight: '85vh', overflow: 'auto', borderRadius: 14 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #30363d' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#e6edf3' }}>
                  🏭 {lang === 'ko' ? '제조사 선택' : 'Select Manufacturer'}
                </span>
                <button onClick={() => setShowManufacturerMatch(false)} style={{ background: 'none', border: 'none', color: '#6e7681', fontSize: 16, cursor: 'pointer' }}>✕</button>
              </div>
              <ManufacturerMatch
                lang={lang}
                volume_cm3={effectiveResult?.volume_cm3}
                materialId={materialId}
                bbox={effectiveResult?.bbox}
                triangleCount={effectiveResult?.geometry?.attributes.position
                  ? Math.floor(effectiveResult.geometry.attributes.position.count / 3)
                  : undefined}
                hasUndercuts={(printAnalysis?.overhangFaces.length ?? 0) > 50}
                onSelectManufacturer={(m: Manufacturer) => {
                  setShowManufacturerMatch(false);
                  // Fire-and-forget: notify manufacturer via email
                  fetch(`/api/nexyfab/manufacturers/${m.id}/contact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: lang === 'ko' ? '견적을 요청드립니다.' : 'I would like to request a quote.' }),
                  })
                    .then(res => { if (!res.ok) console.warn('[Manufacturer contact] request failed:', res.status); })
                    .catch(err => console.error('[Manufacturer contact] network error:', err));
                  addToast('success', lang === 'ko' ? `${m.nameKo}에 견적 요청을 전송했습니다` : `Quote request sent to ${m.name}`);
                  setManufacturerMatched(true);
                  router.push(`/${langSeg}/nexyfab/rfq`);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ IP Share Confirm ═══ */}
      {showShareConfirm && shareUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowShareConfirm(false)}>
          <div style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 14,
            padding: '28px 24px', width: 360, boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }} onClick={e => e.stopPropagation()}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>
              🔒 {lang === 'ko' ? 'IP 보호 공유 링크' : 'IP-Protected Share Link'}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 11, color: '#6e7681' }}>
              {lang === 'ko' ? '72시간 유효 · 다운로드 불가 · 워터마크 포함' : '72 hrs · No download · Watermarked'}
            </p>
            <div style={{
              background: '#0d1117', border: '1px solid #21262d', borderRadius: 8,
              padding: '10px 12px', fontSize: 11, color: '#58a6ff', wordBreak: 'break-all',
              marginBottom: 12, fontFamily: 'monospace',
            }}>{shareUrl}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={async () => { await copyShareUrl(); addToast('success', lang === 'ko' ? '링크 복사됨' : 'Link copied'); }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: '#388bfd', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>📋 {lang === 'ko' ? '복사' : 'Copy'}</button>
              <button onClick={() => { setShowShareConfirm(false); resetShare(); }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer',
              }}>{lang === 'ko' ? '닫기' : 'Close'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Generative Design Panel (SIMP Topology Optimization) ═══ */}
      {showGenDesign && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <GenerativeDesignPanel
            geometry={effectiveResult?.geometry ?? null}
            lang={lang}
            onResult={(geo, _result: TopologyResult) => {
              setGenDesignResult(geo);
              setShowGenOverlay(true);
              addToast('success', lang === 'ko' ? '최적 구조 생성 완료!' : 'Optimal structure generated!');
            }}
            onClose={() => setShowGenDesign(false)}
          />
        </div>
      )}

      {/* ═══ Thermal FEA Panel ═══ */}
      {showThermalPanel && (
        <div style={{ position: 'fixed', top: 60, right: showECADPanel ? 620 : 310, zIndex: 500 }}>
          <ThermalFEAPanel
            geometry={effectiveResult?.geometry ?? null}
            lang={lang}
            onResult={(coloredGeo, _res) => {
              setThermalOverlayGeo(coloredGeo);
              setShowThermalOverlay(true);
              addToast('success', lang === 'ko' ? `열해석 완료 — 3D 뷰에 온도 분포가 표시됩니다` : 'Thermal FEA complete — temperature distribution shown in 3D view');
            }}
            onClose={() => setShowThermalPanel(false)}
          />
        </div>
      )}

      {/* ═══ ECAD PCB Thermal Mapping Panel ═══ */}
      {showECADPanel && (
        <div style={{ position: 'fixed', top: 60, right: 310, zIndex: 500 }}>
          <ECADImportPanel
            geometry={effectiveResult?.geometry ?? null}
            lang={lang}
            onThermalResult={(geo) => {
              setThermalOverlayGeo(geo);
              setShowThermalOverlay(true);
              setShowECADPanel(false);
              addToast('success', lang === 'ko' ? 'PCB 열분포 매핑 완료!' : 'PCB heat mapping complete!');
            }}
            onClose={() => setShowECADPanel(false)}
          />
        </div>
      )}

      {/* ═══ PCB Thermal overlay toggle button ═══ */}
      {thermalOverlayGeo && !showECADPanel && (
        <div style={{ position: 'fixed', bottom: 110, right: 16, zIndex: 500 }}>
          <button
            onClick={() => setShowThermalOverlay(prev => !prev)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #f59e0b',
              background: showThermalOverlay ? '#f59e0b' : '#161b22',
              color: showThermalOverlay ? '#000' : '#f59e0b',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showThermalOverlay
              ? (lang === 'ko' ? '원본 보기' : 'Show Original')
              : (lang === 'ko' ? 'PCB 열분포 보기' : 'Show PCB Heat Map')}
          </button>
        </div>
      )}

      {/* ═══ Gen Design overlay toggle button ═══ */}
      {genDesignResult && !showGenDesign && (
        <div style={{ position: 'fixed', bottom: 80, right: 16, zIndex: 500 }}>
          <button
            onClick={() => setShowGenOverlay(prev => !prev)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #388bfd',
              background: showGenOverlay ? '#388bfd' : '#161b22',
              color: showGenOverlay ? '#fff' : '#388bfd',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showGenOverlay
              ? (lang === 'ko' ? '원본 보기' : 'Show Original')
              : (lang === 'ko' ? '최적화 결과 보기' : 'Show Optimized')}
          </button>
        </div>
      )}

      {/* ═══ Motion Study Panel ═══ */}
      {showMotionStudy && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <MotionStudyPanel
            lang={lang}
            partIds={features.map(f => f.id)}
            onFrameUpdate={(transforms) => setMotionPartTransforms({ ...transforms })}
            onClose={() => { setShowMotionStudy(false); setMotionPartTransforms(null); }}
          />
        </div>
      )}

      {/* ═══ Modal Analysis Panel ═══ */}
      {showModalAnalysis && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <ModalAnalysisPanel
            lang={lang}
            geometry={effectiveResult?.geometry ?? null}
            dimensions={{ x: params.width ?? 100, y: params.height ?? 100, z: params.depth ?? 100 }}
            onResult={() => {
              addToast('success', lang === 'ko' ? '모달 해석 완료' : 'Modal analysis complete');
            }}
            onClose={() => setShowModalAnalysis(false)}
          />
        </div>
      )}

      {/* ═══ Parametric Sweep Panel ═══ */}
      {showParametricSweep && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <ParametricSweepPanel
            lang={lang}
            currentParams={params}
            paramDefs={Object.keys(params).map(k => ({
              name: k,
              label: k,
              min: Math.max(0, (params[k] as number) * 0.5),
              max: (params[k] as number) * 1.5,
            }))}
            onApplyBest={(best) => {
              Object.entries(best).forEach(([k, v]) => setParam(k, v));
              addToast('success', lang === 'ko' ? '최적 파라미터 적용됨' : 'Best parameters applied');
            }}
            onEvaluate={(overrideParams, objective) => {
              // Merge current params with override params for this evaluation
              const evalParams = { ...params, ...overrideParams };
              // Rebuild the shape geometry with these params
              const r = buildShapeResult(selectedId, evalParams);
              if (!r) return 0;
              switch (objective) {
                case 'volume':      return meshVolume(r.geometry) / 1000; // cm³
                case 'surfaceArea': return meshSurfaceArea(r.geometry) / 100; // cm²
                case 'mass': {
                  const vol = meshVolume(r.geometry) / 1000;
                  const density = 2.7; // g/cm³ default aluminum
                  return vol * density;
                }
                case 'maxStress':   return meshVolume(r.geometry) / 1000; // approximate: use volume as proxy for stress
                default:            return meshVolume(r.geometry) / 1000;
              }
            }}
            onClose={() => setShowParametricSweep(false)}
          />
        </div>
      )}

      {/* ═══ Tolerance Stack-up Panel ═══ */}
      {showToleranceStackup && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <ToleranceStackupPanel
            lang={lang}
            onClose={() => setShowToleranceStackup(false)}
          />
        </div>
      )}

      {/* ═══ Surface Quality Panel ═══ */}
      {showSurfaceQuality && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <SurfaceQualityPanel
            lang={lang}
            geometry={effectiveResult?.geometry ?? null}
            onResult={() => {
              addToast('success', lang === 'ko' ? '곡률 분석 완료' : 'Surface analysis complete');
            }}
            onClose={() => setShowSurfaceQuality(false)}
          />
        </div>
      )}

      {/* ═══ Auto Drawing Panel ═══ */}
      {showAutoDrawing && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <AutoDrawingPanel
            lang={lang}
            geometry={effectiveResult?.geometry ?? null}
            partName={selectedId || 'Part'}
            material={materialId}
            onClose={() => setShowAutoDrawing(false)}
          />
        </div>
      )}

      {/* ═══ Manufacturing Pipeline Panel ═══ */}
      {showMfgPipeline && effectiveResult && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 500 }}>
          <ManufacturingPipelinePanel
            lang={lang}
            volumeCm3={meshVolume(effectiveResult.geometry) * 1e-3}
            surfaceAreaCm2={meshSurfaceArea(effectiveResult.geometry) * 1e-2}
            material={materialId}
            complexity={features.length > 5 ? 0.8 : features.length > 2 ? 0.5 : 0.3}
            onGetQuote={(mfgId) => {
              addToast('info', lang === 'ko' ? `제조사 ${mfgId}에 견적 요청됨` : `Quote requested from ${mfgId}`);
            }}
            onClose={() => setShowMfgPipeline(false)}
          />
        </div>
      )}

      {/* ═══ Shape Version Diff ═══ */}
      {showVersionDiff && diffGeometries && (
        <ShapeVersionDiff
          lang={lang}
          geometryA={diffGeometries.a}
          geometryB={diffGeometries.b}
          labelA={diffGeometries.labelA}
          labelB={diffGeometries.labelB}
          onClose={() => setShowVersionDiff(false)}
        />
      )}

      {/* ═══ Sheet Metal Panel ═══ */}
      {!simpleMode && showSheetMetalPanel && (
        <SheetMetalPanel
          lang={lang}
          onBend={handleSmBend}
          onFlange={handleSmFlange}
          onFlatPattern={handleSmFlatPattern}
          onClose={() => setShowSheetMetalPanel(false)}
          geometry={effectiveResult?.geometry ?? null}
          theme={theme}
        />
      )}

      <style>{`
        @keyframes genSpin { to { transform: rotate(360deg); } }
        @keyframes nf-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        /* Custom scrollbar for dark panels */
        .nf-scroll::-webkit-scrollbar { width: 6px; }
        .nf-scroll::-webkit-scrollbar-track { background: transparent; }
        .nf-scroll::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        .nf-scroll::-webkit-scrollbar-thumb:hover { background: #484f58; }
        /* Allow text selection in input fields only */
        input, textarea, select { user-select: text !important; -webkit-user-select: text !important; }
        /* Prevent drag ghost on all elements */
        img, a, button, div { -webkit-user-drag: none; }
        /* 3D viewport should block all browser drag/select */
        canvas { touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
      `}</style>
    </div>
  );
}
