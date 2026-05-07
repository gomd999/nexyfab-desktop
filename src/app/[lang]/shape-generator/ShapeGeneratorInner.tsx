'use client';

// Main workspace shell (split from ShapeGeneratorApp for maintainability).

import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useUIStore } from './store/uiStore';
import { useSceneStore } from './store/sceneStore';
// Responsive layout imports
import { useResponsive } from './responsive/useResponsive';
import { useTouchGestures } from './responsive/useTouchGestures';
import { useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  BufferGeometry,
  Float32BufferAttribute,
  EdgesGeometry,
  Vector3,
  Euler,
  Plane,
  Scene,
  Quaternion,
  MathUtils,
  Matrix4,
} from 'three';
import { analytics } from '@/lib/analytics';
import { getSuppressCadPerfToasts } from '@/lib/cadPerfHints';
import { getAssemblyLoadGuidance } from '@/lib/assemblyLoadPolicy';
import { mateGraphSummary, preflightAssemblyMates } from '@/lib/assemblyMatePreflight';
import { preflightSketchConstraints } from '@/lib/sketchConstraintPreflight';
import { NF_R3F_VIEWPORT_DATA_ENGINE } from '@/lib/nexyfab/viewport';
// Shape design imports
import { SHAPES, type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea, buildShapeResult } from './shapes';
import { shapeDict } from './shapeDict';
import { applyFeaturePipeline, classifyFeatureError, getFeatureDefinition } from './features';
import { reportError, reportInfo, reportWarning } from './lib/telemetry';
import DesktopTitleBar from './DesktopTitleBar';
import PdmMetaWorkspaceStrip from './PdmMetaWorkspaceStrip';
import { useCloudProjectAccessStore } from './store/cloudProjectAccessStore';
import { usePdmProjectMetaStore } from './store/pdmProjectMetaStore';
import { getDrawingTitlePartName } from '@/lib/nfabPartDisplay';
import { patchFetchForTauri, hasDesktopPower, isTauriApp } from '@/lib/tauri';
import {
  prefGetString,
  prefSetString,
  PREF_KEYS,
  upsertRecentImportFile,
  isDesktopFirstRunComplete,
  resetDesktopFirstRun,
} from '@/lib/platform';
import { useNfabFileIO } from './hooks/useNfabFileIO';
import { parseProject, NfabParseError, type NfabAssemblySnapshotV1, type NfabConfigurationV1, type NfabStudioViewV1 } from './io/nfabFormat';
import { useSceneAutoSaveWatchers } from './hooks/useSceneAutoSaveWatchers';
import { applyBooleanAsync } from './features/boolean';
import { useCsgWorker } from './workers/useCsgWorker';
import { useFEAWorker } from './workers/useFEAWorker';
import { useDFMWorker } from './workers/useDFMWorker';
import { usePipelineWorker } from './workers/usePipelineWorker';
import { useInterferenceWorker } from './workers/useInterferenceWorker';
import { useFeatureStack, type FeatureHistory } from './useFeatureStack';
import { useShapeCart } from './useShapeCart';
import { exportBomCSV, exportBomExcel, estimateWeight, type BomRow } from './io/bomExport';
import { useHistory } from './useHistory';
import { useToast } from './useToast';
import ToastContainer from './ToastContainer';
import SidebarResizer from './SidebarResizer';
import type { OptimizeResult, ModifyResult, ChatMessage, ChatResult, SingleResult } from './ShapeChat';
import { computeMassProperties } from './analysis/massProperties';
import type { ElementSelectionInfo, FaceSelectionInfo } from './editing/selectionInfo';
import type { FeatureType } from './features/types';
const HoleWizardModal = dynamic(() => import('./features/HoleWizardModal'), { ssr: false });
const FeatureParams = dynamic(() => import('./FeatureParams'), { ssr: false });
const CommandToolbar = dynamic(() => import('./CommandToolbar'), { ssr: false });
const ShapeCart = dynamic(() => import('./ShapeCart'), { ssr: false });
const DesignFunnelBar = dynamic(() => import('./DesignFunnelBar'), { ssr: false });
const TimelineBar = dynamic(() => import('./TimelineBar'), { ssr: false });
const ShapeGeneratorToolbar = dynamic(() => import('./ShapeGeneratorToolbar'), { ssr: false });
const BodyPanel = dynamic(() => import('./panels/BodyPanel'), { ssr: false });
import { SHAPE_MAP } from './shapes';
import type { BomPartResult } from './ShapePreview';
// Sketch imports
import type { SketchProfile, SketchConfig, SketchConstraint, SketchDimension, SketchSegment } from './sketch/types';
import { profileToGeometry, profileToGeometryMulti } from './sketch/extrudeProfile';
import { solveConstraints } from './sketch/constraintSolver';
import SketchCanvas from './sketch/SketchCanvas';
import {
  type SketchHistoryEntry,
  generateSketchThumbnail,
  saveSketchHistory } from './sketch/SketchHistory';
const Sketch3DCanvas = dynamic(() => import('./sketch/Sketch3DCanvas'), { ssr: false });
const DrawingView = dynamic(() => import('./sketch/DrawingView'), { ssr: false });
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
import { useShapeGeneratorUI } from './hooks/useShapeGeneratorUI';
const QuoteWizard = dynamic(() => import('./onboarding/QuoteWizard'), { ssr: false });
const DesktopFirstRunWizard = dynamic(() => import('./onboarding/DesktopFirstRunWizard'), { ssr: false });
import { useAssemblyState } from './hooks/useAssemblyState';
const CSGPanel = dynamic(() => import('./editing/CSGPanel'), { ssr: false });
import { applyCSG, makeToolGeometry } from './editing/CSGOperations';
import type { CSGOperation, CSGToolParams } from './editing/CSGOperations';
import { splitBodyBoth } from './features/splitBodyBoth';
import { mergeBodyGeometries } from './features/mergeBodies';
// Topology optimization imports
import { genDesignDict } from './topology/genDesignDict';
import type { Face } from './topology/optimizer/types';
import { MATERIALS } from './topology/optimizer/types';
import { useTopologicalMap } from './topology/useTopologicalMap';
import { decodeShareLink } from './io/shareLink';
import { useSearchParams } from 'next/navigation';
import ContextMenu, { getContextItemsEmpty, getContextItemsGeometry, getContextItemsSketch } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import SketchPalette from './sketch/SketchPalette';
import { useSketchReferenceUnderlay } from './hooks/useSketchReferenceUnderlay';
import SketchRadialMenu from './sketch/SketchRadialMenu';
import { getSketchRadialMainItems, getSketchRadialInnerItems, getSketchRadialLinearItems } from './sketch/sketchRadialItems';
// New module imports
import type { PrintAnalysisOptions, OrientationOptimizationResult } from './analysis/printAnalysis';
import type { ManufacturingProcess, DFMIssue } from './analysis/dfmAnalysis';
import { explainDFMIssue, calculateCostDelta, approximateMetricsAfterHint, type DFMExplanation, type CostDelta } from './analysis/dfmExplainer';
import { analyzeDraft } from './analysis/draftAnalysis';
import { useProcessRecommendation } from './analysis/useProcessRecommendation';
import type { FEAMaterial } from './analysis/simpleFEA';
import ManufacturingReadyCard from './analysis/ManufacturingReadyCard';
// Auto-save imports
import { useAutoSave } from './useAutoSave';
import type { AutoSaveState } from './useAutoSave';
import RecoveryBanner from './RecoveryBanner';
const ShortcutHelp = dynamic(() => import('./ShortcutHelp'), { ssr: false });
import AutoSaveIndicator from './AutoSaveIndicator';
const CommandPalette = dynamic(() => import('./CommandPalette'), { ssr: false });
import type { Command } from './CommandPalette';
import { buildPanelCommands } from './commandPaletteCommands';
import { buildWorkspaceCommands } from './commandWorkspaceCommands';
import WorkspaceEmptyHint from './WorkspaceEmptyHint';
import { MATERIAL_PRESETS } from './materials';
import { useTheme } from './ThemeContext';
import { evaluateExpression, findBrokenExpressions, type ExprVariable } from './ExpressionEngine';
import ModelParametersPanel, { type ModelVar } from './ModelParametersPanel';
import { buildExprGraph, propagateChanges } from './ExpressionGraph';
import { usePlugins } from './plugins/usePlugins';
const PluginManager = dynamic(() => import('./plugins/PluginManager'), { ssr: false });
import TransformInputPanel from './TransformInputPanel';
import { useCollab } from './collab/useCollab';
import type { CollabChatMessage } from './collab/useCollab';
import CollabPresence from './collab/CollabPresence';
import CollabReconnectBanner from './collab/CollabReconnectBanner';
const CollabChat = dynamic(() => import('./collab/CollabChat'), { ssr: false });
const FeatureDependencyGraph = dynamic(() => import('./panels/FeatureDependencyGraph'), { ssr: false });
const NestingTool = dynamic(() => import('./manufacturing/NestingTool'), { ssr: false });
const ThreadHoleCalloutPanel = dynamic(() => import('./annotations/ThreadHoleCalloutPanel'), { ssr: false });
const DesignVariantsPanel = dynamic(() => import('./panels/DesignVariantsPanel'), { ssr: false });
import { generateLinearSweep } from './panels/DesignVariantsPanel';
const UserPartsPanel = dynamic(() => import('./library/UserPartsPanel'), { ssr: false });
const CopilotPanel = dynamic(() => import('./copilot/CopilotPanel'), { ssr: false });
const RfqPanel = dynamic(() => import('./io/RfqPanel'), { ssr: false });

const SessionTimelapse = dynamic(() => import('./rendering/SessionTimelapse'), { ssr: false });
const StockOptimizerPanel = dynamic(() => import('./manufacturing/StockOptimizerPanel'), { ssr: false });
import type { AssemblyMate, MateType } from './assembly/AssemblyMates';
import { generateMateId } from './assembly/AssemblyMates';
import { useVersionHistory } from './history/useVersionHistory';
import type { DesignVersion } from './history/useVersionHistory';
const VersionPanel = dynamic(() => import('./history/VersionPanel'), { ssr: false });
const VersionDiff3DViewer = dynamic(() => import('./history/VersionDiff3DViewer'), { ssr: false });
import { useCommandHistory } from './history/useCommandHistory';
import { commandHistory } from './history/CommandHistory';
const HistoryPanel = dynamic(() => import('./history/HistoryPanel'), { ssr: false });
const BranchCompare = dynamic(() => import('./history/BranchCompare'), { ssr: false });
import { captureCanvasSnapshot } from './history/useCanvasSnapshot';
const SheetMetalPanel = dynamic(() => import('./SheetMetalPanel'), { ssr: false });
import RightPanel from './panels/RightPanel';
import { mapDFMToParams, getBestDFMScore, getTopDFMIssues } from './analysis/dfmParamMapper';
import { useProactiveAdvisor } from './useProactiveAdvisor';
import { useCloudSaveFlow } from './useCloudSaveFlow';
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from './rendering/RenderPanel';
import { downloadScreenshot } from './rendering/useScreenshot';
const ScreenshotShareModal = dynamic(() => import('./rendering/ScreenshotShareModal'), { ssr: false });
const ARViewer = dynamic(() => import('./rendering/ARViewer'), { ssr: false });
import { useTutorial } from './onboarding/useTutorial';
const TutorialOverlay = dynamic(() => import('./onboarding/TutorialOverlay'), {
  ssr: false,
  loading: () => null });
const WelcomeBanner = dynamic(() => import('./onboarding/WelcomeBanner'), {
  ssr: false,
  loading: () => null });
const SketchContextTip = dynamic(() => import('./onboarding/SketchContextTip'), {
  ssr: false,
  loading: () => null });
const SimpleModeOfferBanner = dynamic(() => import('./onboarding/SimpleModeOfferBanner'), {
  ssr: false,
  loading: () => null });
const ContextHelpPanel = dynamic(() => import('./onboarding/ContextHelpPanel'), {
  ssr: false,
  loading: () => null });
import { useContextHelp } from './onboarding/useContextHelp';
import type { GeometryMetrics } from './estimation/CostEstimator';
import { estimateCosts } from './estimation/CostEstimator';
const ProcessRouterPanel = dynamic(() => import('./estimation/ProcessRouterPanel'), { ssr: false });
const AISupplierPanel = dynamic(() => import('./analysis/AISupplierPanel'), { ssr: false });
const CostCopilotPanel = dynamic(() => import('./analysis/CostCopilotPanel'), { ssr: false });
const AIHistoryPanel = dynamic(() => import('./analysis/AIHistoryPanel'), { ssr: false });
const OpenScadPanel = dynamic(() => import('./openscad/OpenScadPanel'), { ssr: false });
// GD&T Annotation imports
import type { GDTAnnotation, DimensionAnnotation } from './annotations/GDTTypes';
const ShapePreview = dynamic(() => import('./ShapePreview'), { ssr: false });
const MultiViewport = dynamic(() => import('./MultiViewport'), { ssr: false });
import LeftPanel from './panels/LeftPanel';
import TopoMapPanel from './panels/TopoMapPanel';
import { useSidebarLayout } from './hooks/useSidebarLayout';
const GenDesignViewer = dynamic(() => import('./topology/GenDesignViewer'), { ssr: false });
import AuthModal from '@/components/nexyfab/AuthModal';
import VerificationBanner from '@/components/nexyfab/VerificationBanner';
import { useAuthStore } from '@/hooks/useAuth';
import { userMeetsBmMatrixFeatureStage } from '@/lib/bm-matrix-stage-ui';
import type { Stage } from '@/lib/stage-engine';
import { useProjectsStore } from '@/hooks/useProjects';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { getPlanLimits } from './freemium/planLimits';
import { dfmAnalysisAllowed, consumeFreeDfmCreditIfUnpaid } from './freemium/freeDfmAllowance';
import { useDfmWarnings } from './hooks/useDfmWarnings';
const UpgradePrompt = dynamic(() => import('./freemium/UpgradePrompt'), { ssr: false });
const COTSPanel = dynamic(() => import('./cots/COTSPanel'), { ssr: false });
const CAMSimPanel = dynamic(() => import('./analysis/CAMSimPanel'), { ssr: false });
const MoldDesignPanel = dynamic(() => import('./analysis/MoldDesignPanel'), { ssr: false });
import type { COTSPart } from './cots/cotsData';
const ScriptPanel = dynamic(() => import('./ScriptPanel'), { ssr: false });
import { usePinComments } from './comments/PinComments';
const CommentsPanel = dynamic(() => import('./comments/CommentsPanel'), { ssr: false });
import type { ActivityEvent } from './comments/CommentsPanel';
import WorkflowStepper from './WorkflowStepper';
const ManufacturerMatch = dynamic(() => import('./analysis/ManufacturerMatch'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0d1117', color: '#6e7681', fontSize: 13 }}>
      Loading Manufacturer Match...
    </div>
  ) });
import type { Manufacturer } from './analysis/ManufacturerMatch';
import { useCollabPolling } from '@/hooks/useCollabPolling';
const GenerativeDesignPanel = dynamic(() => import('./analysis/GenerativeDesignPanel'), { ssr: false });
const StatusBar = dynamic(() => import('./StatusBar'), { ssr: false });
const BreadcrumbNav = dynamic(() => import('./BreadcrumbNav'), { ssr: false });
import type { BreadcrumbItem } from './BreadcrumbNav';
import SelectionFilterBar from './SelectionFilterBar';
import type { SelectionFilter } from './SelectionFilterBar';
import SelectionInfoBadge from './editing/SelectionInfoBadge';
import InViewportGizmo from './InViewportGizmo';
import DimensionLinesOverlay from './DimensionLinesOverlay';
import DFMWarningBadges from './DFMWarningBadges';
import { ThemeToggleButton } from './ThemeToggle';
import BOMExportButton from './BOMExportButton';
import ShortcutHintOverlay from './ShortcutHintOverlay';
import AIAssistantSidebar from './analysis/AIAssistantSidebar';
const IntakeWizard = dynamic(() => import('./intake/IntakeWizard'), { ssr: false });
const ComposeResultPanel = dynamic(() => import('./intake/ComposeResultPanel'), { ssr: false });
import type { ComposeResponse } from './intake/ComposeResultPanel';
import type { IntakeSpec } from './intake/intakeSpec';
import { mapToPresetId } from './library/materialMapping';
const PropertyManager = dynamic(() => import('./PropertyManager'), { ssr: false });
const EmptyCanvasGuide = dynamic(() => import('./EmptyCanvasGuide'), { ssr: false });
import FullscreenAutoHide from './FullscreenAutoHide';
import { ErrorBoundary } from '@/components/nexyfab/ErrorBoundary';
import { getToolCursor } from './hooks/useToolCursor';
import type { TopologyResult } from './analysis/topologyOptimization';
const ECADImportPanel = dynamic(() => import('./analysis/ECADImportPanel'), { ssr: false });
const ThermalFEAPanel = dynamic(() => import('./analysis/ThermalFEAPanel'), { ssr: false });
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
import { bomPartWorldMatrixFromBom } from './assembly/bomPartWorldMatrix';
import { applyGeometryMatesToPlaced } from './assembly/applyGeometryMatesToPlaced';
import { useLang } from './hooks/useLang';
import { SHAPE_ICONS, TAB_LABELS, LOCAL_LABELS } from './constants/labels';
import CadWorkspaceSwitcher from './CadWorkspaceSwitcher';
import { applyCadWorkspace, isCadWorkspaceId } from './cadWorkspace/applyCadWorkspace';
import { useCadWorkspaceInference } from './hooks/useCadWorkspaceInference';
import { useGeometryGC } from './hooks/useGeometryGC';

// ─── Design tab: resizable 3D preview column (right) ───────────────────────────

const DESIGN_PREVIEW_MIN = 260;
const DESIGN_PREVIEW_MAX_CAP = 920;

function clampDesignPreviewWidth(w: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const maxW = Math.max(DESIGN_PREVIEW_MIN + 80, Math.min(DESIGN_PREVIEW_MAX_CAP, vw - 320));
  return Math.round(Math.min(maxW, Math.max(DESIGN_PREVIEW_MIN, w)));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ShapeGeneratorInner() {
  const { theme, mode, toggleTheme } = useTheme();
  const lang = useLang();
  const t = shapeDict[lang];
  /** Bracket i18n keys (shapeName_*, param_*) — same object as `t`, widened for dynamic access. */
  const shapeLabels = t as unknown as Record<string, string>;
  const gt = genDesignDict[lang] as unknown as Record<string, string>;
  const lt = LOCAL_LABELS[lang] ?? LOCAL_LABELS.en;
  const router = useRouter();
  const pathname = usePathname();
  const langSeg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const tabLabels = TAB_LABELS[lang] || TAB_LABELS.en;
  const searchParams = useSearchParams();

  useGeometryGC();

  // ── View-only / readonly mode (opened via ?readonly=1 share link) ──
  const isReadOnly = searchParams?.get('readonly') === '1';

  // ══════════════════════════════════════════════════════════════════════════
  // LOCAL UI STATE (extracted hook — panels, fullscreen, drag, auth modal, callouts)
  // ══════════════════════════════════════════════════════════════════════════
  const {
    showQuoteWizard, setShowQuoteWizard,
    showCSGPanel, setShowCSGPanel,
    showARViewer, setShowARViewer,
    showFeatureGraph, setShowFeatureGraph,
    showNestingTool, setShowNestingTool,
    showThreadHolePanel, setShowThreadHolePanel,
    showPropertyManager, setShowPropertyManager,
    showModelParams, setShowModelParams,
    showBomExportMenu, setShowBomExportMenu,
    showCommentsPanel, setShowCommentsPanel,
    showChatPanel, setShowChatPanel,
    showCopilot, setShowCopilot,
    showRfqPanel, setShowRfqPanel,
    showCAMSimPanel, setShowCAMSimPanel,
    showMoldDesignPanel, setShowMoldDesignPanel,
    threadCallouts, setThreadCallouts,
    holeCallouts, setHoleCallouts,
    showVariantsPanel, setShowVariantsPanel,
    designVariants, setDesignVariants,
    activeVariantId, setActiveVariantId,
    showUserPartsPanel, setShowUserPartsPanel,
    showSessionTimelapse, setShowSessionTimelapse,
    showStockOptimizer, setShowStockOptimizer,
    rfqDone, setRfqDone,
    selectedStandardPart, setSelectedStandardPart,
    standardPartParams, setStandardPartParams,
    showAuthModal, setShowAuthModal,
    authModalMode, setAuthModalMode,
    show3DPreview, setShow3DPreview,
    isFullscreen,
    showFullscreenPrompt,
    toggleFullscreen,
    dismissFullscreenPrompt,
    isDragOver, setIsDragOver,
    isImporting, setIsImporting,
    isDragging, setIsDragging,
    dragCounterRef } = useShapeGeneratorUI();

  const [designPreviewWidth, setDesignPreviewWidth] = useState(380);
  useEffect(() => {
    try {
      const raw = prefGetString(PREF_KEYS.designPreviewWidth);
      if (raw) {
        const v = parseInt(raw, 10);
        if (Number.isFinite(v)) setDesignPreviewWidth(clampDesignPreviewWidth(v));
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const onResize = () => setDesignPreviewWidth((w) => clampDesignPreviewWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const handleDesignPreviewResize = useCallback((next: number) => {
    const c = clampDesignPreviewWidth(next);
    setDesignPreviewWidth(c);
    try {
      prefSetString(PREF_KEYS.designPreviewWidth, String(c));
    } catch { /* ignore */ }
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // RESPONSIVE STATE
  // ══════════════════════════════════════════════════════════════════════════
  const { isMobile, isTablet } = useResponsive();
  const sidebarLayout = useSidebarLayout();
  const tabletLeftOpen = useUIStore(s => s.tabletLeftOpen);
  const setTabletLeftOpen = useUIStore(s => s.setTabletLeftOpen);
  const simpleMode = useUIStore(s => s.simpleMode);
  const enableSimpleMode = useUIStore(s => s.enableSimpleMode);
  const disableSimpleMode = useUIStore(s => s.disableSimpleMode);
  // (showQuoteWizard / showCSGPanel / rfqDone moved to useShapeGeneratorUI at top of component)

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
    onlineCount } = useAssemblyState();
  /** 메이트→배치 적용 후 Solver 탭 `solveAssembly` 상태를 `placedParts`와 다시 맞출 때 증가 (M3 B1). */
  const [assemblySolverResyncNonce, setAssemblySolverResyncNonce] = useState(0);
  const BODY_COLORS = ['#8b9cf4', '#f4a28b', '#8bf4b0', '#f4e08b', '#c48bf4', '#8bd8f4', '#f48bb0', '#b0f48b'];
  // ══════════════════════════════════════════════════════════════════════════
  // VIEW MODE: gallery vs workspace
  // ══════════════════════════════════════════════════════════════════════════
  const viewMode = useUIStore(s => s.viewMode);
  const setViewMode = useUIStore(s => s.setViewMode);
  const [pendingChatMsg, setPendingChatMsg] = useState<string | null>(null);

  // ── Tab state ──
  const activeTab = useUIStore(s => s.activeTab);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const cadWorkspace = useUIStore(s => s.cadWorkspace);

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
  useEffect(() => {
    if (hasDesktopPower('backendProxy')) patchFetchForTauri();
  }, []);

  const [showDesktopFirstRun, setShowDesktopFirstRun] = useState(false);
  useEffect(() => {
    if (!isTauriApp()) return;
    if (!isDesktopFirstRunComplete()) setShowDesktopFirstRun(true);
  }, []);
  const handleReplayDesktopWelcome = useCallback(() => {
    resetDesktopFirstRun();
    setShowDesktopFirstRun(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedParams(params), 120);
    return () => clearTimeout(t);
  }, [params]);
  const setParam = useSceneStore(s => s.setParam);
  const paramExpressions = useSceneStore(s => s.paramExpressions);
  const setParamExpressions = useSceneStore(s => s.setParamExpressions);
  const setParamExpression = useSceneStore(s => s.setParamExpression);
  // ─ Expression Dependency Graph: propagate param changes through expression DAG ─
  const exprGraphRef = React.useRef(buildExprGraph({}, []));
  useEffect(() => {
    // Rebuild graph whenever expressions change
    const knownKeys = Object.keys(params);
    exprGraphRef.current = buildExprGraph(paramExpressions, knownKeys);
    // Propagate all values with base params as roots
    const { resolved, changed, errors: _errors } = propagateChanges(
      exprGraphRef.current,
      Object.keys(paramExpressions),
      params,
      params,
    );
    if (changed.length > 0) {
      // Apply resolved values back to params for downstream features
      const newParams = { ...params };
      let didChange = false;
      for (const key of changed) {
        if (key in newParams && Math.abs((newParams[key] ?? 0) - (resolved[key] ?? 0)) > 1e-9) {
          newParams[key] = resolved[key];
          didChange = true;
        }
      }
      if (didChange) setParams(newParams);
    }
  }, [paramExpressions]);
  const { features, addFeature, addFeatureWithParams, addSketchFeature, removeFeature, updateFeatureParam, toggleFeature, moveFeature, undoLast, clearAll, history: featureHistory, rollbackTo, startEditing, finishEditing, toggleExpanded, ensureExpanded, removeNode, updateNode, featureErrors, setFeatureError: _setFeatureError, clearFeatureError, getOrderedNodes, replaceHistory } = useFeatureStack();
  const { performCSG, loading: csgLoading, cancel: cancelCsg } = useCsgWorker();
  const { runFEA: runFEAWorker, loading: feaWorkerLoading, cancel: cancelFea } = useFEAWorker();
  const { analyzeDFM: analyzeDFMWorker, loading: dfmWorkerLoading, cancel: cancelDfm } = useDFMWorker();
  const { runPipeline: runPipelineWorker, loading: pipelineWorkerLoading, progress: pipelineProgress, progressLabel: pipelineProgressLabel, cancel: cancelPipeline } = usePipelineWorker();
  const {
    detect: detectInterferenceWorker,
    cancel: cancelInterferenceWorker,
    loading: interferenceWorkerHookLoading,
  } = useInterferenceWorker();
  const history = useHistory();
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  // Auto-clear stale selection when undo/rollback removes the selected feature.
  // Avoids "selection points to a feature that no longer exists" after history nav.
  useEffect(() => {
    if (selectedFeatureId && !features.some(f => f.id === selectedFeatureId)) {
      setSelectedFeatureId(null);
    }
  }, [features, selectedFeatureId]);
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
      setBomLabel(lt.assemblyLabel);
    } else {
      setBomParts([]);
      setBomLabel('');
    }
  }, [placedParts, lang]);

  const getAssemblySnapshot = useCallback((): NfabAssemblySnapshotV1 => {
    const snap: NfabAssemblySnapshotV1 = { placedParts, mates: assemblyMates };
    if (bodies.length > 0) {
      snap.bodies = bodies;
      snap.activeBodyId = activeBodyId;
      if (selectedBodyIds.length > 0) snap.selectedBodyIds = selectedBodyIds;
    }
    return snap;
  }, [placedParts, assemblyMates, bodies, activeBodyId, selectedBodyIds]);
  const restoreAssemblySnapshot = useCallback((snap?: NfabAssemblySnapshotV1) => {
    if (!snap) {
      setPlacedParts([]);
      setAssemblyMates([]);
      setBodies([]);
      setActiveBodyId(null);
      setSelectedBodyIds([]);
      return;
    }
    setPlacedParts(snap.placedParts);
    setAssemblyMates(snap.mates);
    const rawBodies = snap.bodies ?? [];
    setBodies(rawBodies);
    if (rawBodies.length === 0) {
      setActiveBodyId(null);
      setSelectedBodyIds([]);
    } else {
      const aid = snap.activeBodyId;
      setActiveBodyId(
        aid !== undefined && aid !== null && rawBodies.some(b => b.id === aid)
          ? aid
          : rawBodies[0]!.id,
      );
      setSelectedBodyIds(
        (snap.selectedBodyIds ?? []).filter(id => rawBodies.some(b => b.id === id)),
      );
    }
  }, [setPlacedParts, setAssemblyMates, setBodies, setActiveBodyId, setSelectedBodyIds]);

  // ── Assembly mates / interference / exploded view ──
  const showAssemblyPanel = useUIStore(s => s.showAssemblyPanel);
  const setShowAssemblyPanel = useUIStore(s => s.setShowAssemblyPanel);
  const explodeFactor = useSceneStore(s => s.explodeFactor);

  // ── Render mode ──
  const renderMode = useSceneStore(s => s.renderMode);
  const setRenderMode = useSceneStore(s => s.setRenderMode);
  const persistedRenderSettings = useSceneStore(s => s.renderSettings);
  const setPersistedRenderSettings = useSceneStore(s => s.setRenderSettings);
  const renderSettings = persistedRenderSettings ?? DEFAULT_RENDER_SETTINGS;
  const setRenderSettings = useCallback((next: RenderSettings | ((prev: RenderSettings) => RenderSettings)) => {
    if (typeof next === 'function') {
      setPersistedRenderSettings(next(persistedRenderSettings ?? DEFAULT_RENDER_SETTINGS));
    } else {
      setPersistedRenderSettings(next);
    }
  }, [persistedRenderSettings, setPersistedRenderSettings]);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ canvas: HTMLCanvasElement } | null>(null);

  const lastSyncedHistoryRef = useRef<string | null>(null);

  // ── Collaboration ──
  const [chatMessages, setChatMessages] = useState<CollabChatMessage[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  // (showChatPanel moved to useShapeGeneratorUI)
  const addActivity = useCallback((evt: Omit<ActivityEvent, 'id' | 'ts'>) => {
    setActivityFeed(prev => [...prev.slice(-199), { ...evt, id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`, ts: Date.now() }]);
  }, []);

  // Forward refs for values declared later in this component
  const collabAddToastRef = useRef<((type: 'info' | 'success' | 'warning' | 'error', msg: string) => void) | null>(null);
  const authUserRef = useRef<{ name?: string } | null>(null);

  // Forward refs to break initialization cycle with usePinComments
  const pinApplyRemoteAddRef = useRef<((c: unknown) => void) | null>(null);
  const pinApplyRemoteResolveRef = useRef<((id: string) => void) | null>(null);
  const pinApplyRemoteDeleteRef = useRef<((id: string) => void) | null>(null);
  const pinApplyRemoteReactRef = useRef<((id: string, emoji: string, userId: string) => void) | null>(null);
  const pinApplyRemoteReplyRef = useRef<((commentId: string, reply: unknown) => void) | null>(null);

  const {
    users: collabUsers, isConnected: collabConnected, demoMode: collabDemo,
    setDemoMode: setCollabDemo, sendCursor: collabSendCursor,
    sendParamChange: collabSendParamChange, sendShapeChange: collabSendShapeChange,
    sendCommentAdd: collabSendCommentAdd, sendCommentResolve: collabSendCommentResolve,
    sendCommentDelete: collabSendCommentDelete, sendCommentReact: collabSendCommentReact,
    sendCommentReply: collabSendCommentReply, sendTyping: collabSendTyping,
    sendChatMessage: collabSendChatMessage, typingUsers: collabTypingUsers,
    sendFeatureSync: collabSendFeatureSync,
    userIdRef: collabUserIdRef, userColorRef: collabUserColorRef,
    reconnectState: collabReconnectState, reconnectCountdown: collabReconnectCountdown,
    manualReconnect: collabManualReconnect, roomId: collabRoomId } = useCollab({
    onRemoteParamChange: useCallback((remoteParams: Record<string, number>) => {
      Object.entries(remoteParams).forEach(([k, v]) => setParam(k, v));
    }, [setParam]),
    onRemoteFeatureSync: useCallback((remoteHistory: unknown) => {
      if (!replaceHistory) return;
      lastSyncedHistoryRef.current = JSON.stringify(remoteHistory);
      const fh = remoteHistory as FeatureHistory | null | undefined;
      if (fh?.nodes?.length && fh.rootId && fh.activeNodeId) {
        replaceHistory(fh.nodes, fh.rootId, fh.activeNodeId);
      }
    }, [replaceHistory]),
    onRemoteShapeChange: useCallback((shapeId: string) => {
      const sd = SHAPE_MAP[shapeId];
      if (!sd) return;
      setSelectedId(shapeId);
      const p: Record<string, number> = {};
      sd.params.forEach(sp => { p[sp.key] = sp.default; });
      setParams(p);
    }, [setSelectedId, setParams]),
    onRemoteCommentAdd: useCallback((comment: unknown) => {
      pinApplyRemoteAddRef.current?.(comment);
      const c = comment as { author?: string; authorColor?: string; text?: string };
      addActivity({ type: 'comment_add', actor: c.author ?? 'Remote', actorColor: c.authorColor, detail: c.text });
      collabAddToastRef.current?.('info', `📌 ${c.author ?? 'Remote'}: ${(c.text ?? '').slice(0, 40)}${(c.text ?? '').length > 40 ? '...' : ''}`);
    }, [addActivity]),
    onRemoteCommentResolve: useCallback((id: string) => {
      pinApplyRemoteResolveRef.current?.(id);
      addActivity({ type: 'comment_resolve', actor: 'Remote' });
      collabAddToastRef.current?.('info', lt.remoteResolvedComment);
    }, [addActivity, lang]),
    onRemoteCommentDelete: useCallback((id: string) => {
      pinApplyRemoteDeleteRef.current?.(id);
      addActivity({ type: 'comment_delete', actor: 'Remote' });
    }, [addActivity]),
    onRemoteCommentReact: useCallback((id: string, emoji: string, userId: string) => {
      pinApplyRemoteReactRef.current?.(id, emoji, userId);
    }, []),
    onRemoteCommentReply: useCallback((commentId: string, reply: unknown) => {
      pinApplyRemoteReplyRef.current?.(commentId, reply);
      const r = reply as { author?: string; text?: string };
      collabAddToastRef.current?.('info', `💬 ${r.author ?? 'Remote'}: ${(r.text ?? '').slice(0, 40)}`);
    }, []),
    onChatMessage: useCallback((msg: CollabChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
      // @mention detection (authUserRef/collabUserIdRef resolved at call time via refs)
      const myName = authUserRef.current?.name ?? 'me';
      if (myName !== 'me' && msg.text.toLowerCase().includes(`@${myName.toLowerCase()}`)) {
        collabAddToastRef.current?.('info', `🔔 ${msg.name} ${lt.mentionedYou}: ${msg.text.slice(0, 40)}`);
        setShowCommentsPanel(true);
        setShowChatPanel(true);
      }
    }, [lang]) });

  // ── Sketch mode ──
  const isSketchMode = useSceneStore(s => s.isSketchMode);
  const _setSketchMode = useSceneStore(s => s.setSketchMode);
  const setIsSketchMode = useCallback((v: boolean) => _setSketchMode(v), [_setSketchMode]);

  useCadWorkspaceInference();

  const urlWorkspaceOrTabAppliedRef = useRef(false);
  useLayoutEffect(() => {
    if (isReadOnly) return;
    if (urlWorkspaceOrTabAppliedRef.current) return;
    const w = searchParams?.get('workspace');
    if (w && isCadWorkspaceId(w)) {
      urlWorkspaceOrTabAppliedRef.current = true;
      applyCadWorkspace(w, { isSketchMode });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      if (qs.has('workspace')) {
        qs.delete('workspace');
        const n = qs.toString();
        router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      }
      return;
    }
    if (searchParams?.get('entry') === 'sketch') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(true);
      applyCadWorkspace('design', { isSketchMode: true });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'assembly') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('design', { isSketchMode: false });
      setShowAssemblyPanel(true);
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'topology') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('generative', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'analysis') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('simulation', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('tab') === 'optimize') {
      urlWorkspaceOrTabAppliedRef.current = true;
      applyCadWorkspace('optimize', { isSketchMode });
    }
  }, [searchParams, isSketchMode, isReadOnly, pathname, router, setIsSketchMode, setShowAssemblyPanel]);

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
    showSketchActionMenu, setShowSketchActionMenu } = useSketchState();

  // ── 스케치 2단계 플로우: 'draw'=그리기, 'setup3d'=3D변환설정 ──
  const [sketchStep, setSketchStep] = useState<'draw' | 'setup3d'>('draw');

  // ── Model parameters (user-defined named variables for parametric modeling) ──
  const [modelVars, setModelVars] = useState<ModelVar[]>([]);
  // (showModelParams moved to useShapeGeneratorUI)

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
  }, [modelVars, setParam]);  

  const lastBrokenSnapshotRef = useRef<string>('');

  // (showPropertyManager moved to useShapeGeneratorUI)

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
    unitSystem, setUnitSystem } = useViewportState();

  // ── Selection filters (depends on editMode from viewport) ──
  const [selectionFilters, setSelectionFilters] = useState<SelectionFilter[]>(['body']);

  useEffect(() => {
    if (editMode === 'none') setSelectionFilters(['body']);
    else setSelectionFilters([editMode as SelectionFilter]);
  }, [editMode]);

  const toggleSelectionFilter = useCallback((f: SelectionFilter) => {
    setSelectionFilters([f]);
    if (f === 'body') setEditMode('none');
    else setEditMode(f as EditMode);
  }, [setEditMode]);

  const [sketchPalSlice, setSketchPalSlice] = useState(false);
  const [sketchSlicePlaneMm, setSketchSlicePlaneMm] = useState(60);
  const [viewportCameraPersisted, setViewportCameraPersisted] = useState<{
    position: [number, number, number];
    target: [number, number, number];
  } | null>(null);
  const [projectCameraToApply, setProjectCameraToApply] = useState<{
    position: [number, number, number];
    target: [number, number, number];
  } | null>(null);
  const [viewportGeometryFitSuppressed, setViewportGeometryFitSuppressed] = useState(false);

  const getStudioViewSnapshot = useCallback((): NfabStudioViewV1 | undefined => {
    const mv = useUIStore.getState().multiView;
    const hasMv = mv === true;
    const hasCam = viewportCameraPersisted != null;
    const isDefault =
      !sectionActive &&
      sectionAxis === 'y' &&
      Math.abs(sectionOffset - 0.5) < 1e-6 &&
      !sketchPalSlice &&
      Math.abs(sketchSlicePlaneMm - 60) < 1e-6 &&
      !hasMv &&
      !hasCam;
    if (isDefault) return undefined;
    return {
      sectionActive,
      sectionAxis,
      sectionOffset,
      sketchSlicePalette: sketchPalSlice,
      sketchSlicePlaneMm,
      ...(hasMv ? { multiView: true as const } : {}),
      ...(hasCam && viewportCameraPersisted
        ? {
            cameraPosition: viewportCameraPersisted.position,
            cameraTarget: viewportCameraPersisted.target,
          }
        : {}),
    };
  }, [sectionActive, sectionAxis, sectionOffset, sketchPalSlice, sketchSlicePlaneMm, viewportCameraPersisted]);

  const restoreStudioViewSnapshot = useCallback((sv?: NfabStudioViewV1) => {
    if (!sv) {
      setSectionActive(false);
      setSectionAxis('y');
      setSectionOffset(0.5);
      setSketchPalSlice(false);
      setSketchSlicePlaneMm(60);
      useUIStore.getState().setMultiView(false);
      setViewportCameraPersisted(null);
      setProjectCameraToApply(null);
      setViewportGeometryFitSuppressed(false);
      return;
    }
    setSectionActive(!!sv.sectionActive);
    if (sv.sectionAxis === 'x' || sv.sectionAxis === 'y' || sv.sectionAxis === 'z') setSectionAxis(sv.sectionAxis);
    if (typeof sv.sectionOffset === 'number' && Number.isFinite(sv.sectionOffset)) {
      setSectionOffset(Math.max(0, Math.min(1, sv.sectionOffset)));
    }
    setSketchPalSlice(!!sv.sketchSlicePalette);
    if (typeof sv.sketchSlicePlaneMm === 'number' && Number.isFinite(sv.sketchSlicePlaneMm)) {
      setSketchSlicePlaneMm(sv.sketchSlicePlaneMm);
    }
    if (typeof sv.multiView === 'boolean') {
      useUIStore.getState().setMultiView(sv.multiView);
    } else {
      useUIStore.getState().setMultiView(false);
    }
    const cp = sv.cameraPosition;
    const ct = sv.cameraTarget;
    if (
      cp &&
      ct &&
      cp.length === 3 &&
      ct.length === 3 &&
      cp.every(n => typeof n === 'number' && Number.isFinite(n)) &&
      ct.every(n => typeof n === 'number' && Number.isFinite(n))
    ) {
      const cam = {
        position: [cp[0], cp[1], cp[2]] as [number, number, number],
        target: [ct[0], ct[1], ct[2]] as [number, number, number],
      };
      setViewportCameraPersisted(cam);
      setProjectCameraToApply(cam);
      setViewportGeometryFitSuppressed(true);
    } else {
      setViewportCameraPersisted(null);
      setProjectCameraToApply(null);
      setViewportGeometryFitSuppressed(false);
    }
  }, [setSectionActive, setSectionAxis, setSectionOffset, setSketchPalSlice, setSketchSlicePlaneMm]);

  const handleViewportCameraCommit = useCallback(
    (position: [number, number, number], target: [number, number, number]) => {
      setViewportCameraPersisted({ position, target });
    },
    [],
  );

  const handleProjectCameraApplied = useCallback(() => {
    setProjectCameraToApply(null);
  }, []);

  const handleGeometryFitRequest = useCallback(() => {
    setViewportGeometryFitSuppressed(false);
  }, []);

  // ── Configurations (named variants: params + feature suppress) — .nfab [CAD-데이터] ──
  const [configurations, setConfigurations] = useState<NfabConfigurationV1[]>([]);
  const [activeConfigurationId, setActiveConfigurationId] = useState<string | null>(null);

  const getConfigurationsBlock = useCallback(
    () => ({ configurations, activeConfigurationId }),
    [configurations, activeConfigurationId],
  );

  const restoreConfigurationsSnapshot = useCallback(
    (configs: NfabConfigurationV1[] | undefined, activeId: string | null | undefined) => {
      setConfigurations(configs ?? []);
      setActiveConfigurationId(activeId ?? null);
    },
    [],
  );

  const handleConfigurationSelect = useCallback(
    (id: string | null) => {
      setActiveConfigurationId(id);
      if (id == null) return;
      const cfg = configurations.find(c => c.id === id);
      if (!cfg) return;
      useSceneStore.setState(s => ({
        params: { ...cfg.params },
        ...(cfg.paramExpressions !== undefined
          ? { paramExpressions: { ...cfg.paramExpressions } }
          : { paramExpressions: { ...s.paramExpressions } }),
      }));
      for (const [nodeId, en] of Object.entries(cfg.featureEnabled)) {
        updateNode(nodeId, { enabled: en });
      }
      // Nodes added after this variant was saved: default to enabled
      const nodes = getOrderedNodes();
      for (const n of nodes) {
        if (!featureHistory || n.id === featureHistory.rootId) continue;
        if (n.type === 'baseShape') continue;
        if (Object.prototype.hasOwnProperty.call(cfg.featureEnabled, n.id)) continue;
        updateNode(n.id, { enabled: true });
      }
    },
    [configurations, featureHistory, getOrderedNodes, updateNode],
  );

  const handleConfigurationAdd = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const sc = useSceneStore.getState();
      const nodes = getOrderedNodes();
      const featureEnabled: Record<string, boolean> = {};
      for (const n of nodes) {
        if (!featureHistory || n.id === featureHistory.rootId) continue;
        if (n.type === 'baseShape') continue;
        featureEnabled[n.id] = n.enabled;
      }
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `cfg-${Date.now()}`;
      const pe = sc.paramExpressions;
      const newCfg: NfabConfigurationV1 = {
        id,
        name: trimmed,
        params: { ...sc.params },
        ...(Object.keys(pe).length > 0 ? { paramExpressions: { ...pe } } : {}),
        featureEnabled,
      };
      setConfigurations(prev => [...prev, newCfg]);
      setActiveConfigurationId(id);
    },
    [featureHistory, getOrderedNodes],
  );

  const handleConfigurationRename = useCallback((configId: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setConfigurations(prev => prev.map(c => (c.id === configId ? { ...c, name: n } : c)));
  }, []);

  const handleConfigurationDelete = useCallback((id: string) => {
    setConfigurations(prev => prev.filter(c => c.id !== id));
    setActiveConfigurationId(cur => (cur === id ? null : cur));
  }, []);

  const configurationsSig = useMemo(
    () => JSON.stringify(configurations) + String(activeConfigurationId),
    [configurations, activeConfigurationId],
  );

  /** Clear invalid variants when the design tree is reset to a single root (e.g. clear all). */
  const configurationTreePurgeBootRef = useRef(true);
  useEffect(() => {
    if (configurationTreePurgeBootRef.current) {
      configurationTreePurgeBootRef.current = false;
      return;
    }
    if (featureHistory.nodes.length === 1 && configurations.length > 0) {
      setConfigurations([]);
      setActiveConfigurationId(null);
    }
  }, [featureHistory.nodes.length, featureHistory.rootId, configurations.length]);

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

  useEffect(() => {
    if (!featureHistory) return;
    const str = JSON.stringify(featureHistory);
    if (str !== lastSyncedHistoryRef.current) {
      lastSyncedHistoryRef.current = str;
      collabSendFeatureSync(featureHistory);
    }
  }, [featureHistory, collabSendFeatureSync]);

  // Context detection: enter context when modes change
  React.useEffect(() => {
    if (isSketchMode) contextHelp.enterContext('sketch');
    else if (isPreviewMode) contextHelp.enterContext('render');
    else contextHelp.leaveContext();
  }, [isSketchMode, isPreviewMode]);

  // Wrapped addFeature that also triggers feature context help
  const addFeatureWithContext = useCallback((type: FeatureType | 'moldTools') => {
    if (type === 'moldTools') {
      setShowMoldDesignPanel(true);
      return;
    }
    addFeature(type as FeatureType);
    contextHelp.enterContext('feature');
  }, [addFeature]);

  const addFeatureWithParamsAndContext = useCallback(
    (type: FeatureType, overrides: Record<string, number>) => {
      addFeatureWithParams(type, overrides);
      contextHelp.enterContext('feature');
    },
    [addFeatureWithParams],
  );

  // ── Command History (Command Pattern undo/redo) ──
  const cmdHistory = useCommandHistory();

  // ── Fullscreen / drag / viewport misc state ──
  // (show3DPreview, isFullscreen, showFullscreenPrompt, isDragOver, isImporting,
  //  isDragging, dragCounterRef, toggleFullscreen, dismissFullscreenPrompt
  //  moved to useShapeGeneratorUI)
  const [cursor3DPos, _setCursor3DPos] = useState<{ x: number; y: number; z: number } | null>(null);

  // ── UI state ──
  const showAIAssistant = useUIStore(s => s.showAIAssistant);
  const setShowAIAssistant = useUIStore(s => s.setShowAIAssistant);
  const openAIAssistant = useUIStore(s => s.openAIAssistant);
  const showShortcuts = useUIStore(s => s.showShortcuts);
  const setShowShortcuts = useUIStore(s => s.setShowShortcuts);
  const showCommandPalette = useUIStore(s => s.showCommandPalette);
  const setShowCommandPalette = useUIStore(s => s.setShowCommandPalette);
  const togglePanel = useUIStore(s => s.togglePanel);
  // Toolbar 🔍 버튼에서 dispatch하는 커스텀 이벤트 수신
  useEffect(() => {
    const open = () => setShowCommandPalette(true);
    window.addEventListener('nexyfab:open-command-palette', open);
    return () => window.removeEventListener('nexyfab:open-command-palette', open);
  }, [setShowCommandPalette]);
  const showPlanes = useUIStore(s => s.showPlanes);
  const setShowPlanes = useUIStore(s => s.setShowPlanes);
  const showPerf = useUIStore(s => s.showPerf);
  const _setShowPerf = useUIStore(s => s.setShowPerf);
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
  /** Radial marking menu (2D sketch context). */
  const [sketchRadial, setSketchRadial] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });
  /** Sketch palette toggles ↔ SketchCanvas overlays. */
  const [sketchPalGrid, setSketchPalGrid] = useState(true);
  const [sketchPalSnap, setSketchPalSnap] = useState(true);
  const [sketchPalDims, setSketchPalDims] = useState(true);
  const [sketchPalConst, setSketchPalConst] = useState(true);
  const [sketchLineStyle, setSketchLineStyle] = useState<'normal' | 'construction' | 'centerline'>('normal');
  const [sketchLookAtNonce, setSketchLookAtNonce] = useState(0);
  const [sketchPickFilter, setSketchPickFilter] = useState<'all' | 'segments' | 'points'>('all');
  const cycleSketchPickFilter = useCallback(() => {
    setSketchPickFilter(f => (f === 'all' ? 'segments' : f === 'segments' ? 'points' : 'all'));
  }, []);
  const sketchPickFilterHint = useMemo(() => {
    switch (sketchPickFilter) {
      case 'segments': return lt.sketchPickFilterSegments;
      case 'points': return lt.sketchPickFilterPoints;
      default: return lt.sketchPickFilterAll;
    }
  }, [sketchPickFilter, lt]);
  useEffect(() => {
    if (!isSketchMode) setSketchPickFilter('all');
  }, [isSketchMode]);
  const [sketchPalProfile, setSketchPalProfile] = useState(true);
  const ribbonTheme = useSceneStore(s => s.ribbonTheme);
  const setRibbonTheme = useSceneStore(s => s.setRibbonTheme);
  // 오른쪽 버튼 누른 위치 추적 (드래그 vs 단순 클릭 구분용)
  const rightMouseDownPos = useRef<{ x: number; y: number } | null>(null);

  // ── New module state (non-import parts) ──
  const showLibrary = useUIStore(s => s.showLibrary);
  const setShowLibrary = useUIStore(s => s.setShowLibrary);
  const showHoleWizard = useUIStore(s => s.showHoleWizard);
  const setShowHoleWizard = useUIStore(s => s.setShowHoleWizard);
  // (selectedStandardPart, standardPartParams moved to useShapeGeneratorUI)
  // ── FEA condition selection (3D marker click ↔ panel highlight) ──
  const [feaHighlightedConditionIdx, setFeaHighlightedConditionIdx] = React.useState<number | null>(null);
  // ── Analysis state (extracted hook) ──
  const {
    feaResult, setFeaResult,
    feaConditions, setFeaConditions: _setFeaConditions,
    feaDisplayMode, setFeaDisplayMode: _setFeaDisplayMode,
    feaDeformationScale, setFeaDeformationScale: _setFeaDeformationScale,
    showFEA, setShowFEA,
    dfmResults, setDfmResults,
    dfmHighlightedIssue, setDfmHighlightedIssue,
    showDFM, setShowDFM,
    draftResult, setDraftResult,
    draftMinDeg, setDraftMinDeg,
    showDraftAnalysis, setShowDraftAnalysis,
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
    showAnnotationPanel: _showAnnotationPanel, setShowAnnotationPanel,
    annotationPlacementMode: _annotationPlacementMode, setAnnotationPlacementMode: _setAnnotationPlacementMode } = useAnalysisState();

  // ── Shared: Cart ──
  const { items: cartItems, addItem: addCartItem, removeItem: removeCartItem, clearCart } = useShapeCart();
  const { toasts, addToast, removeToast } = useToast();
  useEffect(() => { collabAddToastRef.current = addToast; }, [addToast]);

  const paletteCommands = useMemo<Command[]>(
    () => [
      ...buildWorkspaceCommands({
        lang,
        isSketchMode,
        onOptimizeBlockedBySketch: () => addToast('warning', lt.exitSketchBeforeOptimize),
        onAfterSelect: () => setShowCommandPalette(false),
      }),
      ...buildPanelCommands(togglePanel as (k: string) => void),
    ],
    [togglePanel, lang, isSketchMode, addToast, lt],
  );

  const {
    sketchRefImage,
    setSketchRefImage,
    sketchRefInputRef,
    sketchRefImporting,
    handleSketchRefFileChange,
    clearSketchRef,
  } = useSketchReferenceUnderlay({
    sketchPlane: sketchPlane as 'xy' | 'xz' | 'yz',
    addToast,
    sketchRefBadFileType: lt.sketchRefBadFileType,
    maxReferencePixels: 768,
  });

  // Detect broken expression dependencies after a feature is removed.
  // If a param expression references a variable that no longer exists in scope,
  // notify the user so they can fix or accept the break.
  useEffect(() => {
    const currentExprs = useSceneStore.getState().paramExpressions;
    const currentParams = useSceneStore.getState().params;
    if (Object.keys(currentExprs).length === 0) return;
    const availableNames = [
      ...Object.keys(currentParams),
      ...modelVars.map(v => v.name),
    ];
    const broken = findBrokenExpressions(currentExprs, availableNames);
    const snapshot = broken.map(b => `${b.key}:${b.missing.join(',')}`).join('|');
    if (snapshot && snapshot !== lastBrokenSnapshotRef.current) {
      lastBrokenSnapshotRef.current = snapshot;
      const first = broken[0];
      addToast('warning', lt.brokenExpression(first.key, first.expression, first.missing.join(', '), broken.length - 1));
    } else if (!snapshot) {
      lastBrokenSnapshotRef.current = '';
    }
  }, [features, modelVars, addToast, lang]);

  // 스케치 평면 전환 래퍼: 진행 중인 프로파일이 있으면 사용자에게 알림.
  // 평면을 바꿔도 기존 2D 좌표는 유지되지만 새 평면에 투영되므로 혼란을 방지.
  const setSketchPlane = useCallback((plane: 'xy' | 'xz' | 'yz') => {
    const cur = useSceneStore.getState().sketchPlane;
    if (cur === plane) return;
    const hasProfile = useSceneStore.getState().sketchProfile.segments.length > 0;
    setSketchPlaneRaw(plane);
    if (hasProfile) {
      addToast('info', lt.sketchPlaneSwitched(plane.toUpperCase()));
    }
  }, [setSketchPlaneRaw, addToast, lt]);

  // #wf3: warn when switching to Optimize while sketch mode is active
  const handleSetActiveTab = useCallback((tab: 'design' | 'optimize') => {
    const r = applyCadWorkspace(tab === 'design' ? 'design' : 'optimize', { isSketchMode });
    if (!r.ok && r.reason === 'sketch') {
      addToast('warning', lt.exitSketchBeforeOptimize);
    }
  }, [isSketchMode, addToast, lt]);

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
      addToast('error', lt.cannotApplyFeature(msg));
      clearFeatureError(lastErrorId);
    }
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
    const diag = classifyFeatureError(node?.featureType ?? 'sketchExtrude', raw, { nodeId: id });
    const label = node?.label ?? 'Feature';
    addToast('error', lt.featureFailed(label, lang === 'ko' ? diag.hintKo : diag.hintEn));
  }, [pipelineErrors]);

  // ── Auth modal ──
  // (showAuthModal, authModalMode moved to useShapeGeneratorUI)

  // ── Freemium gates (extracted hook) ──
  const {
    authUser,
    planLimits,
    showUpgradePrompt, setShowUpgradePrompt,
    upgradeFeature, setUpgradeFeature,
    requirePro: _requirePro,
    requirePhotoReal,
    checkCartLimit } = useFreemiumGate();
  useEffect(() => { authUserRef.current = authUser ?? null; }, [authUser]);

  // ── CAM G-code freemium gate ──
  const { check: checkFreemium, isPro: isProPlan } = useFreemium();
  // ── Collaboration polling (Team+ plan only) ──
  const currentProjectId = useProjectsStore(s => s.projects[0]?.id ?? null);
  const { sessions: pollingSessions, mySessionId } = useCollabPolling(currentProjectId, planLimits.collaboration);

  // ── Collaboration read-only upsell (free users): surface the Pro prompt
  // the first time a real (non-demo) session becomes active. `collabEditUpsellShownRef`
  // keeps it once per page mount so the user isn't spammed across reconnects. ──
  const collabEditUpsellShownRef = useRef(false);
  // Pre-export optimization upsell: free users see the prompt the first time they
  // export a heavy format in a session. Pro users skip it silently.
  const exportOptimizeUpsellShownRef = useRef(false);

  // ── Cloud projects ──
  const saveProject = useProjectsStore(s => s.saveProject);
  const updateProject = useProjectsStore(s => s.updateProject);

  // ── CAM Simulation ──
  const [camSimResult, setCamSimResult] = useState<{ result: import('./analysis/camLite').CAMResult; operation: import('./analysis/camLite').CAMOperation } | null>(null);

  // ── Generative Design / ECAD overlays (visualization layers, not panels) ──
  const [genDesignResult, setGenDesignResult] = useState<BufferGeometry | null>(null);
  const [showGenOverlay, setShowGenOverlay] = useState(false);
  const [thermalOverlayGeo, setThermalOverlayGeo] = useState<BufferGeometry | null>(null);
  const [showThermalOverlay, setShowThermalOverlay] = useState(false);

  // ── Analysis modal panels (centralised in useUIStore for closeAllPanels / simpleMode) ──
  const showCOTSPanel        = useUIStore(s => s.showCOTSPanel);
  const setShowCOTSPanel     = useUIStore(s => s.setShowCOTSPanel);
  const showCamUpgrade       = useUIStore(s => s.showCamUpgrade);
  const setShowCamUpgrade    = useUIStore(s => s.setShowCamUpgrade);
  const showDFMFixUpgrade    = useUIStore(s => s.showDFMFixUpgrade);
  const setShowDFMFixUpgrade = useUIStore(s => s.setShowDFMFixUpgrade);
  const showDFMInsightsUpgrade    = useUIStore(s => s.showDFMInsightsUpgrade);
  const setShowDFMInsightsUpgrade = useUIStore(s => s.setShowDFMInsightsUpgrade);
  const showProcessRouter         = useUIStore(s => s.showProcessRouter);
  const setShowProcessRouter      = useUIStore(s => s.setShowProcessRouter);
  const showProcessRouterUpgrade    = useUIStore(s => s.showProcessRouterUpgrade);
  const setShowProcessRouterUpgrade = useUIStore(s => s.setShowProcessRouterUpgrade);
  const showAISupplierMatch         = useUIStore(s => s.showAISupplierMatch);
  const setShowAISupplierMatch      = useUIStore(s => s.setShowAISupplierMatch);
  const showAISupplierMatchUpgrade    = useUIStore(s => s.showAISupplierMatchUpgrade);
  const setShowAISupplierMatchUpgrade = useUIStore(s => s.setShowAISupplierMatchUpgrade);
  const showCostCopilot             = useUIStore(s => s.showCostCopilot);
  const setShowCostCopilot          = useUIStore(s => s.setShowCostCopilot);
  const showCostCopilotUpgrade      = useUIStore(s => s.showCostCopilotUpgrade);
  const setShowCostCopilotUpgrade   = useUIStore(s => s.setShowCostCopilotUpgrade);
  const showAIHistory               = useUIStore(s => s.showAIHistory);
  const setShowAIHistory            = useUIStore(s => s.setShowAIHistory);
  const showOpenScad                = useUIStore(s => s.showOpenScad);
  const setShowOpenScad             = useUIStore(s => s.setShowOpenScad);
  // ── Face/edge selection ──
  const [selectedElement, setSelectedElement] = React.useState<ElementSelectionInfo | null>(null);
  const [mateFaceA, setMateFaceA] = React.useState<FaceSelectionInfo | null>(null);
  const [selectionActive, setSelectionActive] = React.useState(false);
  // ── Idea-to-Design Intake Wizard (L1→L5 composition) ──
  const [showIntakeWizard, setShowIntakeWizard] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const [composeSpec, setComposeSpec] = React.useState<IntakeSpec | null>(null);
  const [composeResult, setComposeResult] = React.useState<ComposeResponse | null>(null);

  // compose API 호출 (최초 + swap 재호출 공용)
  const runCompose = React.useCallback(
    async (spec: IntakeSpec, force?: { partId?: string; methodId?: string; materialId?: string }) => {
      setComposing(true);
      try {
        const res = await fetch('/api/nexyfab/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec, force }) });
        const data = await res.json();
        if (!res.ok) {
          alert(lt.designFailed(String(data.error ?? res.status)));
          return null;
        }
        return data as ComposeResponse;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        alert(lt.networkError(msg));
        return null;
      } finally {
        setComposing(false);
      }
    },
    [lt]
  );
  const clearMeshSelection = useCallback(() => {
    setSelectedElement(null);
    setSelectionActive(false);
  }, []);
  // ── AI pipeline chain: Process Router → Supplier Matcher pre-fill ──
  const [chainedSupplierProcess, setChainedSupplierProcess] = React.useState<string | undefined>(undefined);
  const showCollabEditUpgrade    = useUIStore(s => s.showCollabEditUpgrade);
  const setShowCollabEditUpgrade = useUIStore(s => s.setShowCollabEditUpgrade);
  const showExportOptimizeUpgrade    = useUIStore(s => s.showExportOptimizeUpgrade);
  const setShowExportOptimizeUpgrade = useUIStore(s => s.setShowExportOptimizeUpgrade);

  // Pro upsell: free users joining a real collab session get a one-time read-only notice.
  // Demo mode is free for everyone, so only fire when connected to a real session without Pro.
  // bm-matrix §1.2 #17: Stage D+ 는 협업 편집 해금 — Pro 업셀 생략.
  const collabEditStageOk = userMeetsBmMatrixFeatureStage((authUser?.nexyfabStage ?? 'A') as Stage, 17);
  useEffect(() => {
    if (collabEditUpsellShownRef.current) return;
    if (!collabConnected || collabDemo) return;
    if (isProPlan || collabEditStageOk) return;
    collabEditUpsellShownRef.current = true;
    setShowCollabEditUpgrade(true);
  }, [collabConnected, collabDemo, isProPlan, collabEditStageOk, setShowCollabEditUpgrade]);
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
  const [diffGeometries, _setDiffGeometries] = useState<{ a: BufferGeometry; b: BufferGeometry; labelA: string; labelB: string } | null>(null);

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
  const _setShowArrayPanel = useUIStore(s => s.setShowArrayPanel);
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
    isOptimizing, setIsOptimizing: _setIsOptimizing,
    progress, setProgress,
    optResult, setOptResult,
    resultMesh, setResultMesh,
    activeLoadForce, setActiveLoadForce,
    useCustomDomain, setUseCustomDomain,
    customDomainGeometry, setCustomDomainGeometry,
    handleGenerate } = useOptimizationState(addToast);

  // ═══ AUTO-SAVE & RECOVERY ═══
  const { hasRecovery, recoveryData, saveError, lastSavedAt, isSaving, save: autoSave, scheduleSave, dismissRecovery } = useAutoSave();
  const {
    cloudStatus,
    cloudSavedAt,
    cloudError,
    versionConflictNeedsReload,
    reloadToFetchServerProject,
    projectId: cloudProjectId,
    scheduleSync: scheduleCloudSync,
    syncNow: _syncCloudNow,
    adoptProjectId,
  } = useCloudSaveFlow(!!authUser);
  const pdmPartNumber = usePdmProjectMetaStore(s => s.partNumber);
  const drawingTitlePartName = useMemo(() => {
    const shapeLabel =
      (shapeLabels[`shapeName_${selectedId}`] as string | undefined) || selectedId;
    return getDrawingTitlePartName({
      partNumber: pdmPartNumber,
      shapeLabel: typeof shapeLabel === 'string' ? shapeLabel : String(selectedId),
      cloudProjectId,
    });
  }, [shapeLabels, selectedId, pdmPartNumber, cloudProjectId]);
  // ── Pin Comments (depends on cloudProjectId from useCloudSaveFlow) ──
  const {
    comments, isPlacingComment, setIsPlacingComment, focusedCommentId, setFocusedCommentId,
    addComment, resolveComment, deleteComment, reactToComment, addReply,
    applyRemoteCommentAdd: pinApplyRemoteAdd,
    applyRemoteCommentResolve: pinApplyRemoteResolve,
    applyRemoteCommentDelete: pinApplyRemoteDelete,
    applyRemoteCommentReact: pinApplyRemoteReact,
    applyRemoteCommentReply: pinApplyRemoteReply } = usePinComments({
    projectId: cloudProjectId,
    collabSend: {
      commentAdd: collabSendCommentAdd,
      commentResolve: collabSendCommentResolve,
      commentDelete: collabSendCommentDelete,
      commentReact: collabSendCommentReact,
      commentReply: collabSendCommentReply } });
  // Wire forward refs for collab → pinComments
  useEffect(() => { pinApplyRemoteAddRef.current = pinApplyRemoteAdd; }, [pinApplyRemoteAdd]);
  useEffect(() => { pinApplyRemoteResolveRef.current = pinApplyRemoteResolve; }, [pinApplyRemoteResolve]);
  useEffect(() => { pinApplyRemoteDeleteRef.current = pinApplyRemoteDelete; }, [pinApplyRemoteDelete]);
  useEffect(() => { pinApplyRemoteReactRef.current = pinApplyRemoteReact; }, [pinApplyRemoteReact]);
  useEffect(() => { pinApplyRemoteReplyRef.current = pinApplyRemoteReply; }, [pinApplyRemoteReply]);
  // (showCommentsPanel moved to useShapeGeneratorUI)
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
  const buildAutoSaveState = useCallback((): AutoSaveState => ({
    version: 1,
    timestamp: Date.now(),
    selectedId,
    params,
    features: featuresToSerialize,
    isSketchMode,
    sketchProfile: sketchProfile.segments.length > 0 ? { segments: sketchProfile.segments, closed: sketchProfile.closed } : undefined,
    sketchConfig,
    activeTab,
    cadWorkspace,
    renderMode,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  }), [selectedId, params, featuresToSerialize, isSketchMode, sketchProfile, sketchConfig, activeTab, cadWorkspace, renderMode, chatHistory]);
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
    applyLoadedNfabProject,
    syncCloudNfabProjectId,
    markDirty: markNfabDirty,
    resetFile: resetNfabFile,
    mfgCamPost, setMfgCamPost   } = useNfabFileIO({
    featureHistory,
    replaceHistory,
    saveProject,
    updateProject,
    addToast,
    lang,
    getAssemblySnapshot,
    restoreAssemblySnapshot,
    getStudioViewSnapshot,
    restoreStudioViewSnapshot,
    getConfigurationsBlock,
    restoreConfigurationsSnapshot,
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
    placedParts,
    assemblyMates,
    bodies,
    explodeFactor,
    sketchViewMode,
    ribbonTheme,
    sectionActive,
    sectionAxis,
    sectionOffset,
    sketchPalSlice,
    sketchSlicePlaneMm,
    multiView,
    viewportCameraPersisted,
    configurationsSig,
    cadWorkspace,
    renderMode,
    scheduleSave,
    autoSave,
    buildAutoSaveState,
    markNfabDirty });

  // Wire localStorage autosave → cloud sync (when logged in)
  useEffect(() => {
    if (viewMode !== 'workspace' || !authUser) return;
    scheduleCloudSync(buildAutoSaveState(), selectedId ?? '', materialId);
  }, [selectedId, params, features, isSketchMode, materialId, viewMode, authUser, cadWorkspace, renderMode]);


  // 스케치 모드 진입/이탈 시 3D 편집 모드는 항상 'none'으로 리셋.
  // 기존에는 setIsSketchMode 호출부마다 setEditMode('none')을 수동으로 붙였으나
  // 누락되는 경로가 있어 단일 지점에서 강제.
  useEffect(() => {
    if (editMode !== 'none') setEditMode('none');
    if (isSketchMode) setSketchStep('draw'); // 스케치 진입 시 항상 draw 단계로 리셋
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
  const handleRestoreRecovery = useCallback(() => {
    if (!recoveryData) return;
    const sd = SHAPE_MAP[recoveryData.selectedId];
    if (sd) {
      setSelectedId(recoveryData.selectedId);
      setParams(recoveryData.params);
    }
    setIsSketchMode(recoveryData.isSketchMode);
    if (recoveryData.sketchProfile) setSketchProfile(recoveryData.sketchProfile as SketchProfile);
    if (recoveryData.sketchConfig) setSketchConfig(recoveryData.sketchConfig as SketchConfig);
    clearAll();
    if (recoveryData.features.length > 0) {
      setTimeout(() => {
        recoveryData.features.forEach(f => addFeature(f.type as FeatureType));
      }, 50);
    }
    const ws =
      recoveryData.cadWorkspace && isCadWorkspaceId(recoveryData.cadWorkspace)
        ? recoveryData.cadWorkspace
        : recoveryData.activeTab;
    applyCadWorkspace(ws, { isSketchMode: recoveryData.isSketchMode });
    if (recoveryData.renderMode === 'standard' || recoveryData.renderMode === 'photorealistic') {
      useSceneStore.getState().setRenderMode(recoveryData.renderMode);
    }
    setShowRecovery(false);
    setViewMode('workspace');
  }, [recoveryData, clearAll, addFeature]);
  const handleDismissRecovery = useCallback(() => { setShowRecovery(false); dismissRecovery(); }, [dismissRecovery]);

  // ═══ SHARE LINK RESTORE ═══
  useEffect(() => {
    const shareParam = searchParams?.get('share');
    if (!shareParam) return;
    const decoded = decodeShareLink(shareParam);
    if (!decoded) { addToast('error', lt.invalidShareLink); return; }
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
    addToast('success', shapeLabels.openSharedDesign ?? 'Shared design loaded');
  }, []);

  // ═══ PROJECT LOAD (from dashboard ?projectId=xxx) ═══
  useEffect(() => {
    const projectId = searchParams?.get('projectId');
    if (!projectId) {
      useCloudProjectAccessStore.getState().reset();
      return;
    }
    fetch(`/api/nexyfab/projects/${projectId}`)
      .then(r => {
        if (!r.ok) {
          useCloudProjectAccessStore.getState().reset();
          return null;
        }
        return r.json() as Promise<{
          project?: {
            sceneData?: string;
            updatedAt: number;
            materialId?: string;
            role?: 'owner' | 'editor' | 'viewer';
            canEdit?: boolean;
          };
        }>;
      })
      .then(data => {
        if (!data?.project) return;
        const proj = data.project;
        useCloudProjectAccessStore.getState().setFromApiProject(projectId, {
          role: proj.role,
          canEdit: proj.canEdit,
        });
        if (!proj.sceneData) return;
        try {
          const raw: unknown = JSON.parse(proj.sceneData);
          if (raw && typeof raw === 'object' && (raw as { magic?: string }).magic === 'nfab') {
            const project = parseProject(proj.sceneData);
            adoptProjectId(projectId, proj.updatedAt);
            syncCloudNfabProjectId(projectId, proj.updatedAt);
            applyLoadedNfabProject(project);
            setViewMode('workspace');
            addToast('success', lt.designLoaded);
            return;
          }
          const state = raw as Record<string, unknown>;
          // Legacy AutoSaveState JSON (localStorage-style)
          if (state.selectedId && typeof state.selectedId === 'string' && SHAPE_MAP[state.selectedId]) {
            setSelectedId(state.selectedId);
            if (state.params) setParams(state.params as Record<string, number>);
          }
          if (typeof state.isSketchMode === 'boolean') setIsSketchMode(state.isSketchMode);
          if (state.activeTab === 'design' || state.activeTab === 'optimize') setActiveTab(state.activeTab);
          if (proj.materialId && MATERIAL_PRESETS.some((m: { id: string }) => m.id === proj.materialId)) {
            setMaterialId(proj.materialId);
          }
          if (Array.isArray(state.chatHistory) && state.chatHistory.length > 0) {
            setChatHistory(state.chatHistory as ChatMessage[]);
          }
          adoptProjectId(projectId, proj.updatedAt);
          syncCloudNfabProjectId(projectId, proj.updatedAt);
          setViewMode('workspace');
          addToast('success', lt.designLoaded);
        } catch (e) {
          addToast(
            'error',
            e instanceof NfabParseError
              ? (lang === 'ko' ? `프로젝트 형식 오류: ${e.message}` : `Invalid project: ${e.message}`)
              : lt.designLoadFailed,
          );
        }
      })
      .catch(() => {});
  // Intentionally keyed on URL only — avoid re-fetch loops when callback identities churn.
  }, [searchParams]);

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
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
      if (data.normals) geo.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
      if (data.indices) geo.setIndex(data.indices);
      if (!data.normals) geo.computeVertexNormals();
      geo.computeBoundingBox();

      const edgeGeo = new EdgesGeometry(geo, 15);
      const bb = geo.boundingBox!;
      const size = bb.getSize(new Vector3());
      const vol = meshVolume(geo) / 1000;
      const sa = meshSurfaceArea(geo) / 100;

      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      setImportedGeometry(geo);
      setImportedFilename(meta.name || 'shared-model');
      setSketchResult({ geometry: geo, edgeGeometry: edgeGeo, volume_cm3: vol, surface_area_cm2: sa, bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } });
      setIsSketchMode(false);
      setViewMode('workspace');
      addToast('success', lt.sharedModelLoaded);
    } catch (e) {
      console.error('Failed to load shared model:', e);
      addToast('error', lt.sharedModelLoadFailed);
    }
  }, []);

  // ═══ VERSION HISTORY ═══
  const {
    versions, saveVersion, restoreVersion: _restoreVersion, deleteVersion, renameVersion,
    branches, activeBranch, createBranch, switchBranch, mergeBranch, deleteBranch, compareBranches } = useVersionHistory();
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
    const canvas =
      canvasRef.current
      ?? (document.querySelector(`canvas[data-engine="${NF_R3F_VIEWPORT_DATA_ENGINE}"]`) as HTMLCanvasElement | null);
    if (!canvas) return undefined;
    try { return captureCanvasSnapshot(canvas, 200); } catch { return undefined; }
  }, []);
  const handleSaveVersionSnapshot = useCallback(() => {
    const thumbnail = captureCurrentThumbnail();
    saveVersion(selectedId, params, featuresToSerialize, thumbnail);
    addToast('success', lt.snapshotSaved);
  }, [selectedId, params, featuresToSerialize, captureCurrentThumbnail, saveVersion, addToast, lang]);
  const handleRestoreVersion = useCallback((version: DesignVersion) => {
    const sd = SHAPE_MAP[version.shapeId];
    if (sd) { setSelectedId(version.shapeId); setParams(version.params); const e: Record<string, string> = {}; Object.entries(version.params).forEach(([k, v]) => { e[k] = String(v); }); setParamExpressions(e); }
    clearAll();
    if (version.features.length > 0) { setTimeout(() => { version.features.forEach(f => addFeature(f.type as FeatureType)); }, 50); }
    setShowVersionPanel(false);
    addToast('success', lt.versionRestored);
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
  const handleCreateBranch = useCallback((name: string) => { createBranch(name); addToast('success', lt.branchCreated(name)); }, [createBranch, addToast, lt]);
  const handleSwitchBranch = useCallback((branchId: string) => { const latestVersion = switchBranch(branchId); if (latestVersion) { const sd = SHAPE_MAP[latestVersion.shapeId]; if (sd) { setSelectedId(latestVersion.shapeId); setParams(latestVersion.params); const e: Record<string, string> = {}; Object.entries(latestVersion.params).forEach(([k, v]) => { e[k] = String(v); }); setParamExpressions(e); } clearAll(); if (latestVersion.features.length > 0) { setTimeout(() => { latestVersion.features.forEach(f => addFeature(f.type as FeatureType)); }, 50); } } const branchName = branches.find(b => b.id === branchId)?.name || branchId; addToast('success', lt.branchSwitched(branchName)); }, [switchBranch, branches, clearAll, addFeature, addToast, lt]);
  const handleDeleteBranch = useCallback((branchId: string) => { const branchName = branches.find(b => b.id === branchId)?.name || branchId; const ok = deleteBranch(branchId); if (ok) addToast('success', lt.branchDeleted(branchName)); }, [deleteBranch, branches, addToast, lt]);
  const handleMergeBranch = useCallback((sourceBranchId: string, targetBranchId: string) => { const merged = mergeBranch(sourceBranchId, targetBranchId); if (merged) { const srcName = branches.find(b => b.id === sourceBranchId)?.name || sourceBranchId; const tgtName = branches.find(b => b.id === targetBranchId)?.name || targetBranchId; addToast('success', lt.branchMerged(srcName, tgtName)); } }, [mergeBranch, branches, addToast, lt]);

  // ══════════════════════════════════════════════════════════════════════════
  // GALLERY → WORKSPACE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  const _handleEnterWorkspace = useCallback((shapeId: string, initParams: Record<string, number>) => {
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

  const _handleEnterBlankSketch = useCallback(() => {
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

  const _handleChatFromGallery = useCallback((message: string) => {
    setPendingChatMsg(message);
    openAIAssistant('chat');
    // Don't force sketch mode — let the AI response decide
    setViewMode('workspace');
  }, [openAIAssistant]);

  const _handleBackToGallery = useCallback(() => {
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
    setIsSketchMode(false);
    setEditMode('none');
    setShowManufacturingCard(false);
    collabSendShapeChange(s.id);
  }, [clearAll, selectedId, params, features, history, collabSendShapeChange, setIsSketchMode]);

  // ── LOD-during-drag: hide expensive edge overlay while a slider is held ──
  const [paramDragging, setParamDragging] = React.useState(false);
  const paramDragTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleParamChange = useCallback((key: string, value: number) => {
    setParam(key, value);
    setParamExpression(key, String(value));
    collabSendParamChange({ [key]: value });
    // Mark as dragging; auto-clear after 200ms idle (commit will also clear)
    if (!paramDragging) setParamDragging(true);
    if (paramDragTimerRef.current) clearTimeout(paramDragTimerRef.current);
    paramDragTimerRef.current = setTimeout(() => setParamDragging(false), 200);
  }, [setParam, setParamExpression, collabSendParamChange, paramDragging]);

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
    if (paramDragTimerRef.current) { clearTimeout(paramDragTimerRef.current); paramDragTimerRef.current = null; }
    setParamDragging(false);
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

  const _handleParamChangeCmd = useCallback((key: string, value: number) => {
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
      } });
  }, [params, setParam, setParamExpression]);

  const _handleShapeChangeCmd = useCallback((s: ShapeConfig) => {
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
      } });
  }, [selectedId, params, features, history, clearAll]);

  const _handleAddFeatureCmd = useCallback((type: FeatureType) => {
    const id = `add-feature-${type}-${Date.now()}`;
    commandHistory.execute({
      id,
      label: `Add feature: ${type}`,
      labelKo: `피처 추가: ${type}`,
      execute: () => { addFeature(type); },
      undo: () => { undoLast(); } });
  }, [addFeature, undoLast]);

  const _handleRemoveFeatureCmd = useCallback((featureId: string) => {
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
          addToast('warning', lt.featureCannotRestore);
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
        addToast('success', lt.featureRestored);
      } });
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
  /** Monotonic id so only the latest pipeline run may commit mesh/errors (debounce + worker races). */
  const pipelineRunGenerationRef = useRef(0);
  useEffect(() => {
    const gen = ++pipelineRunGenerationRef.current;

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
    runPipelineWorker(baseShapeResult.geometry, features, { occtMode }).then(pipe => {
      if (gen !== pipelineRunGenerationRef.current) return;
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
      if (!bb) return;
      const size = bb.getSize(new Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setResult({ geometry: finalGeometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
    }).catch((err) => {
      // On worker failure fall back to the base result so the viewport is never blank.
      if (gen !== pipelineRunGenerationRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Pipeline superseded') return;
      const enabled = features.find(f => f.enabled) ?? features[0];
      const ft = enabled?.type ?? 'sketchExtrude';
      reportError('feature_pipeline', err instanceof Error ? err : new Error(msg), {
        stage: 'shape_generator_worker',
        diagnosticCode: classifyFeatureError(ft, msg, { nodeId: enabled?.id }).code,
        featureType: ft,
        enabledFeatureCount: features.filter(f => f.enabled).length,
      });
      setResult(baseShapeResult);
      addToast('warning', lt.pipelineFailed(msg));
    });
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
      }) };
  }, [featureHistory, pipelineErrors]);

  // In sketch mode show only the extruded sketch; after extrude (sketch off) keep the
  // sketch body until the library shape / pipeline replaces it — otherwise the center
  // viewport falls back to `result` and the extrusion disappears from effective geometry.
  // While sketching, do NOT fall back to parametric `result` (avoids ghost shape).
  const effectiveResult: ShapeResult | null = isSketchMode
    ? sketchResult
    : (sketchResult ?? result);

  // ─── Topological Naming: rebuild stable face-ID map on every geometry rebuild ───
  const topoMap = useTopologicalMap();
  useEffect(() => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const activeFeatureId = features.length > 0 ? features[features.length - 1].id : undefined;
    topoMap.update(geo, activeFeatureId);
  }, [effectiveResult?.geometry]);

  /** Sketch palette “slice guide” ↔ 3D section plane (X) when solid geometry exists. */
  useEffect(() => {
    if (!sketchPalSlice) return;
    const geo = effectiveResult?.geometry ?? result?.geometry;
    if (!geo) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const sizeX = bb.max.x - bb.min.x;
    if (sizeX < 1e-9) return;
    const t = (sketchSlicePlaneMm - bb.min.x) / sizeX;
    setSectionOffset(Math.max(0, Math.min(1, t)));
    setSectionAxis('x');
    setSectionActive(true);
  }, [sketchPalSlice, sketchSlicePlaneMm, effectiveResult?.geometry, result?.geometry, setSectionOffset, setSectionAxis, setSectionActive]);

  // ── Live sketch geometry (Feature 5) ──
  const liveSketchGeo = useMemo(() => {
    if (!isSketchMode) return null;
    const outer = sketchProfiles[0] ?? sketchProfile;
    if (!outer.closed || outer.segments.length === 0) return null;
    try {
      if (sketchProfiles.length > 1) {
        const g = profileToGeometryMulti(sketchProfiles, sketchConfig);
        if (g && g.attributes.position && g.attributes.position.count > 0) return g;
      }
      const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
      if (!activeProfile.closed || activeProfile.segments.length === 0) return null;
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
    const size = bb.getSize(new Vector3());
    return {
      geometry: liveSketchGeo,
      edgeGeometry: makeEdges(liveSketchGeo),
      volume_cm3: meshVolume(liveSketchGeo) / 1000,
      surface_area_cm2: meshSurfaceArea(liveSketchGeo) / 100,
      bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } } as import('./shapes').ShapeResult;
  }, [liveSketchGeo]);

  /** Same mesh as the right-hand ShapePreview (thermal/gen overlays, live sketch LOD). */
  const viewportShapeResult = useMemo(() => {
    const baseSrc = liveSketchResult ?? effectiveResult;
    if (!baseSrc) return null;
    const base =
      showThermalOverlay && thermalOverlayGeo && effectiveResult
        ? { ...effectiveResult, geometry: thermalOverlayGeo }
        : showGenOverlay && genDesignResult && effectiveResult
          ? { ...effectiveResult, geometry: genDesignResult }
          : baseSrc;
    if (paramDragging) return { ...base, edgeGeometry: undefined } as unknown as ShapeResult;
    return base;
  }, [
    liveSketchResult,
    effectiveResult,
    showThermalOverlay,
    thermalOverlayGeo,
    showGenOverlay,
    genDesignResult,
    paramDragging,
  ]);

  /** Single-viewport 3D in the main design column (avoids “only the side panel is 3D” after extrude). */
  const showMainWorkspacePreview =
    activeTab === 'design' &&
    !isSketchMode &&
    sketchViewMode !== 'drawing' &&
    viewportShapeResult !== null &&
    !multiView &&
    webglSupported;

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
      complexity };
  }, [effectiveResult]);

  // ── Plugin system integration ──
  const { toolbarButtons: pluginToolbarButtons, customShapes: _pluginCustomShapes } = usePlugins({
    getSelectedShape: () => selectedId,
    getParams: () => params,
    getGeometry: () => effectiveResult?.geometry ?? null,
    setParam: (key, value) => setParam(key, value),
    addFeature: (type) => addFeature(type as FeatureType),
    showToast: addToast });

  // ── Async boolean via Web Worker (for standalone boolean operations) ──
  const _handleBooleanAsync = useCallback(
    (geometry: BufferGeometry, boolParams: Record<string, number>) =>
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
      selectedElement };
  }, [selectedId, params, enabledFeaturesForContext, isSketchMode, sketchResult, effectiveResult, dfmResults, feaResult, materialId, geometryMetrics, selectedElement]);

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
    onOpenAdvisor: () => openAIAssistant('chat') });

  // ── Auto-DFM: debounced background analysis whenever geometry changes ────────
  // Runs with default cnc_milling + injection_molding, updates dfmResults silently.
  // Badge on the DFM toolbar button reflects error/warning count from this run.
  useEffect(() => {
    if (!effectiveResult?.geometry) return;
    if (!dfmAnalysisAllowed(useAuthStore.getState().user?.plan)) return;
    const timer = setTimeout(async () => {
      if (!dfmAnalysisAllowed(useAuthStore.getState().user?.plan)) return;
      try {
        const results = await analyzeDFMWorker(
          effectiveResult.geometry!,
          ['cnc_milling', 'injection_molding'],
          { minWallThickness: 1.0, minDraftAngle: 1.0, maxAspectRatio: 4.0 },
        );
        setDfmResults(results);
        consumeFreeDfmCreditIfUnpaid(useAuthStore.getState().user?.plan);
      } catch {
        // silent — user can manually trigger full analysis
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [effectiveResult, analyzeDFMWorker, authUser?.plan, setDfmResults]);

  // Count of DFM error/warning issues from last analysis (drives toolbar badge)
  const dfmIssueCount = useMemo(
    () => dfmResults ? dfmResults.reduce((n, r) => n + r.issues.filter(i => i.severity !== 'info').length, 0) : 0,
    [dfmResults],
  );

  // ── REST-based DFM warnings (debounced 800ms, supplements worker-based analysis) ──
  // Used on free plan (worker DFM disabled) or before worker completes its first run.
  const dfmWarnings = useDfmWarnings(
    // Only pass params when there is geometry; skip when no shape is loaded
    effectiveResult?.geometry ? params : null,
  );
  // Combine: prefer worker result count when available, fall back to REST-based
  const dfmBadgeCount = dfmResults !== null ? dfmIssueCount : dfmWarnings.issues + dfmWarnings.warnings;
  const dfmBadgeRunning = dfmWorkerLoading || dfmWarnings.loading;

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
    handleGetQuote } = useManufacturingFlow({
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
    setUpgradeFeature });

  // ── IP Share flow (extracted hook) ──
  const {
    isCreatingShare,
    shareUrl,
    showShareConfirm, setShowShareConfirm,
    handleIPShare,
    copyShareUrl,
    resetShare } = useIPShareFlow(effectiveResult, authUser, lang, addToast);

  const handleAddToCart = useCallback(() => {
    if (!effectiveResult) return;
    if (!checkCartLimit(cartItems.length)) return;
    const thumbnail = captureRef.current ? captureRef.current() : null;
    const shapeName = sketchResult ? 'Custom Sketch' : (shapeLabels[`shapeName_${selectedId}`] || selectedId);
    addCartItem({
      shapeId: sketchResult ? 'sketch' : selectedId, shapeName, params: sketchResult ? {} : { ...params },
      featureCount: features.filter(f => f.enabled).length, thumbnail,
      volume_cm3: effectiveResult.volume_cm3, surface_area_cm2: effectiveResult.surface_area_cm2, bbox: effectiveResult.bbox });
    setCartAdded(true);
    setTimeout(() => setCartAdded(false), 1500);
  }, [effectiveResult, sketchResult, selectedId, params, features, t, addCartItem, cartItems.length, checkCartLimit]);

  const handleChatApplySingle = useCallback((r: SingleResult) => {
    if (!r.shapeId) return;
    const shapeDef = SHAPE_MAP[r.shapeId];
    if (!shapeDef) {
      addToast('warning', lt.shapeNotFound(r.shapeId));
      return;
    }
    // Exit sketch mode and show the parametric shape
    setIsSketchMode(false);
    setShowAIAssistant(false);
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
            id: `bom-feat-${i}`, type: f.type, params: f.params, enabled: true }));
          const finalGeo = applyFeaturePipeline(baseResult.geometry, featureStack);
          const edgeGeometry = makeEdges(finalGeo);
          const volume_cm3 = meshVolume(finalGeo) / 1000;
          const surface_area_cm2 = meshSurfaceArea(finalGeo) / 100;
          finalGeo.computeBoundingBox();
          const bb = finalGeo.boundingBox;
          if (!bb) return baseResult;
          const size = bb.getSize(new Vector3());
          const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
          return { geometry: finalGeo, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
        } catch (err) {
          console.error('[FeaturePipeline] apply failed:', err);
          const msg = err instanceof Error ? err.message : String(err);
          addToast('warning', lt.pipelineFailed(msg));
          return baseResult;
        }
      }
      return baseResult;
    } catch { return null; }
  }, [lt, addToast]);

  const handleChatApplyBom = useCallback((parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features: Array<{ type: FeatureType; params: Record<string, number> }>; quantity: number; position?: [number, number, number]; rotation?: [number, number, number] }>, productName?: string) => {
    // Exit sketch mode and show the assembly
    setIsSketchMode(false);
    setShowAIAssistant(false);
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
    setShowAIAssistant(false);
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
  // (showBomExportMenu moved to useShapeGeneratorUI)
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
      const sn = sketchResult ? 'Custom Sketch' : (shapeLabels[`shapeName_${selectedId}`] || selectedId);
      const mat = materialId;
      rows.push({ no: 1, name: sn, shape: sketchResult ? 'sketch' : selectedId, material: mat, dimensions: `${effectiveResult.bbox.w.toFixed(1)}\u00d7${effectiveResult.bbox.h.toFixed(1)}\u00d7${effectiveResult.bbox.d.toFixed(1)} mm`, volume_cm3: effectiveResult.volume_cm3, surface_area_cm2: effectiveResult.surface_area_cm2, weight_g: estimateWeight(effectiveResult.volume_cm3, mat), quantity: 1 });
    }
    return rows;
  }, [bomParts, cartItems, effectiveResult, sketchResult, selectedId, t, materialId]);
  const handleExportBomCSV = useCallback(async () => {
    const rows = buildBomRows();
    if (rows.length === 0) return;
    await exportBomCSV(rows, `BOM_${bomLabel || 'export'}.csv`);
    setShowBomExportMenu(false);
  }, [buildBomRows, bomLabel]);
  const handleExportBomExcel = useCallback(async () => {
    const rows = buildBomRows();
    if (rows.length === 0) return;
    await exportBomExcel(rows, `BOM_${bomLabel || 'export'}.xls`);
    setShowBomExportMenu(false);
  }, [buildBomRows, bomLabel]);

  // ══════════════════════════════════════════════════════════════════════════
  // SKETCH HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSketchGenerate = useCallback(() => {
    // ── Pre-validate sketch profile(s) before extrusion ──
    const validateProfile = (p: { segments: SketchSegment[]; closed: boolean }) => {
      if (p.segments.length === 0) return { ok: false, reason: 'empty' as const };
      if (p.segments.length < 3 && !p.closed) return { ok: false, reason: 'too_few' as const };
      if (!p.closed) return { ok: false, reason: 'open' as const };
      // Endpoint coincidence check (in case `closed` flag is stale)
      const firstSeg = p.segments[0];
      const lastSeg = p.segments[p.segments.length - 1];
      const firstPt = firstSeg.points?.[0];
      const lastPt = lastSeg.points?.[lastSeg.points.length - 1];
      if (firstPt && lastPt) {
        const dx = firstPt.x - lastPt.x;
        const dy = firstPt.y - lastPt.y;
        if (Math.hypot(dx, dy) > 0.01) return { ok: false, reason: 'gap' as const };
      }
      return { ok: true as const };
    };
    const profilesToCheck = sketchProfiles.length > 1 ? sketchProfiles : [sketchProfile];
    for (let i = 0; i < profilesToCheck.length; i++) {
      const v = validateProfile(profilesToCheck[i]);
      if (!v.ok) {
        const where = profilesToCheck.length > 1 ? ` (Profile ${i + 1})` : '';
        const msg = v.reason === 'empty' ? lt.sketchEmpty(where)
          : v.reason === 'too_few' ? lt.sketchTooFew(where)
          : v.reason === 'gap' ? lt.sketchGap(where)
          : lt.sketchNotClosed(where);
        addToast('warning', msg);
        return;
      }
    }
    // Use multi-profile geometry when more than one profile exists, else fall back
    const geo = sketchProfiles.length > 1
      ? profileToGeometryMulti(sketchProfiles, sketchConfig)
      : profileToGeometry(sketchProfile, sketchConfig);
    if (!geo) {
      addToast('warning', lt.sketchGeometryFailed);
      return;
    }
    const edgeGeometry = makeEdges(geo);
    const volume_cm3 = meshVolume(geo) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geo) / 100;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new Vector3());
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
        label: `Sketch ${sketchHistory.length + 1}` };
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
    addToast('success', lt.shapeGeneratedGuide, 5000);

    // Auto-save to cloud (fire-and-forget, only when logged in)
    if (useAuthStore.getState().user) {
      void useProjectsStore.getState().saveProject({
        name: `Sketch ${new Date().toLocaleDateString('ko-KR')}`,
        shapeId: 'sketch',
        tags: ['sketch'] });
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
          addToastRef.current('info', (LOCAL_LABELS[langRef.current] ?? LOCAL_LABELS.en).sketchModeExitPreserved, 4000);
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
        activeIdx: activeProfileIdx }
    ];
    sketchRedoRef.current = []; // clear redo branch on new action
   
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx]);

  const handleSketchUndo = useCallback(() => {
    const snap = sketchUndoRef.current.pop();
    if (!snap) return;
    sketchRedoRef.current.push({
      profiles: sketchProfiles,
      constraints: sketchConstraints,
      dimensions: sketchDimensions,
      activeIdx: activeProfileIdx });
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
      activeIdx: activeProfileIdx });
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

  /** Append a finished closed loop as a new hole profile (avoids bridging two loops in one segment list). */
  const handleAddClosedLoopAsNewProfile = useCallback((holeProfile: SketchProfile) => {
    captureSketchSnapshot();
    setSketchProfiles(prev => {
      const next = [...prev, holeProfile];
      setActiveProfileIdx(next.length - 1);
      setSketchProfile(holeProfile);
      return next;
    });
  }, [captureSketchSnapshot, setSketchProfile]);

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
    const pts = activeProfile.segments.flatMap(s => s.points);
    const pf = preflightSketchConstraints(pts, sketchConstraints);
    if (autoSolve && pf.warningCodes.includes('large_constraint_set') && !sketchLargeConstraintAutoSolveNotifiedRef.current) {
      sketchLargeConstraintAutoSolveNotifiedRef.current = true;
      reportWarning('constraint_solver', new Error('sketch_large_constraint_set'), {
        constraintCount: pf.constraintCount,
        pointCount: pf.pointCount,
      });
      if (!getSuppressCadPerfToasts()) {
        addToast('info', lt.sketchLargeConstraintInfo);
      }
    }
    if (!autoSolve) {
      const suppressPerf = getSuppressCadPerfToasts();
      for (const code of pf.warningCodes) {
        if (code === 'points_no_constraints') addToast('warning', lt.sketchPreflightPointsNoConstraints);
        else if (code === 'constraints_no_points') addToast('warning', lt.sketchPreflightConstraintsNoPoints);
        else if (code === 'large_constraint_set' && !suppressPerf) addToast('warning', lt.sketchPreflightLargeConstraintSet);
      }
    }
    const result = solveConstraints(activeProfile.segments, sketchConstraints, sketchDimensions);
    // Apply solved point positions back into segments
    const solvedSegments = activeProfile.segments.map(seg => ({
      ...seg,
      points: seg.points.map(p => {
        if (p.id && result.points.has(p.id)) {
          return { ...result.points.get(p.id)!, id: p.id };
        }
        return p;
      }) }));
    const solvedProfile = { ...activeProfile, segments: solvedSegments };
    setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? solvedProfile : x));
    setSketchProfile(solvedProfile);
    // Mark constraints as satisfied/unsatisfied
    setSketchConstraints(prev => prev.map(c => ({
      ...c,
      satisfied: !result.unsatisfiedConstraints.includes(c.id) })));
    // Update constraint status for UI banner
    setConstraintStatus(result.solveResult?.status ?? (result.satisfied ? 'ok' : 'over-defined'));
    setConstraintDiagnostic({
      dof: result.solveResult?.dof,
      residual: result.solveResult?.residual,
      message: result.solveResult?.message,
      unsatisfiedCount: result.unsatisfiedConstraints.length,
      redundant: result.solveResult?.redundant,
      onRemoveRedundant: (id: string) => {
        setSketchConstraints(prev => prev.filter(c => c.id !== id));
      } });
  }, [sketchProfiles, activeProfileIdx, sketchProfile, sketchConstraints, sketchDimensions, setSketchProfile, autoSolve, addToast, lt, reportWarning]);

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
  /** One telemetry ping per mount when auto-solve hits a very large constraint set (avoid spam). */
  /** Auto-solve: one telemetry warning + one info toast when constraint count is very large. */
  const sketchLargeConstraintAutoSolveNotifiedRef = useRef(false);

  // Auto-solve when constraint list or dimension values change
  React.useEffect(() => {
    if (!autoSolve || sketchConstraints.length === 0 || isSolvingRef.current) return;
    isSolvingRef.current = true;
    handleSolveConstraints();
    isSolvingRef.current = false;
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
  }, [autoSolve, sketchConstraints.length, sketchProfileHash]);

  // ── Add sketch as feature-tree item ──
  const handleAddSketchToFeatureTree = useCallback(() => {
    if (!sketchProfile.closed) {
      addToast('error', lt.closeProfileFirst);
      return;
    }
    addSketchFeature(sketchProfile, sketchConfig, sketchPlane as 'xy' | 'xz' | 'yz', sketchOperation, sketchPlaneOffset, sketchConstraints, sketchDimensions);
    setSketchProfile({ segments: [], closed: false });
    setSketchProfiles([{ segments: [], closed: false }]);
    setActiveProfileIdx(0);
    setIsSketchMode(false);
    addToast('success', lt.addedToFeatureTree);
  }, [sketchProfile, sketchConfig, sketchPlane, sketchOperation, sketchPlaneOffset, sketchConstraints, sketchDimensions, addSketchFeature, setSketchProfile, setIsSketchMode, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // SKETCH HISTORY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const _handleSaveToSketchHistory = useCallback((
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
      label: `Sketch ${sketchHistory.length + 1}` };
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
    
    const sketchDataSlice = nodeAny.sketchData as { constraints?: SketchConstraint[]; dimensions?: SketchDimension[] } | undefined;
    const storedConstraints = sketchDataSlice?.constraints;
    const storedDimensions = sketchDataSlice?.dimensions;
    
    setSketchConstraints(storedConstraints || []);
    setSketchDimensions(storedDimensions || []);

    setEditingSketchFeatureId(featureId);
    setIsSketchMode(true);
    addToast('info', shapeLabels.editingSketch || 'Editing sketch — finish to update');
  }, [featureHistory, setSketchProfile, setSketchConfig, setIsSketchMode, addToast, shapeLabels.editingSketch]);

  const handleLoadSketchFromHistory = useCallback((entry: SketchHistoryEntry) => {
    setSketchProfile(entry.profile);
    setSketchConfig(entry.config);
    setSketchPlane(entry.plane);
    setIsSketchMode(true);
    setShowSketchHistory(false);
    addToast('success', shapeLabels.loadSketch || 'Sketch loaded');
  }, [setSketchProfile, setSketchConfig, setSketchPlane, setIsSketchMode, addToast, shapeLabels.loadSketch]);

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
      segments: config.segments ?? 32 };
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
        const size = bb.getSize(new Vector3());
        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
        setBomParts([]); setBomLabel('');
        setSketchResult({ geometry: geo, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
        setIsSketchMode(false);
        setShowAIAssistant(false);
        return;
      }
    }
    setIsSketchMode(true);
    setShowAIAssistant(false);
    setSketchResult(null);
  }, []);

  const handleChatApplyOptimize = useCallback((opt: OptimizeResult) => {
    setIsSketchMode(false);
    setShowAIAssistant(false);
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
    setShowAIAssistant(false);
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
      lt.aiAppliedChanges(actionCount),
      6000,
      { label: lt.undoLabel, onClick: handleHistoryUndo },
    );
  }, [addToast, lang, handleHistoryUndo]);

  // Apply a geometry directly (from face editing, fillet/chamfer on edge, or CSG)
  const handleGeometryApply = useCallback((geo: BufferGeometry) => {
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
        d: box.max.z - box.min.z } };
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
      addToast('success', lt.booleanApplied);
    } catch {
      addToast('error', lt.booleanFailed);
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
        name: lt.body1,
        color: BODY_COLORS[0],
        visible: true,
        locked: false }]);
      setActiveBodyId(id);
      // Store geometry for this body (we extend BodyEntry with geometry refs separately)
      bodyGeosRef.current.set(id, { geometry: geo.geometry, edgeGeometry: geo.edgeGeometry });
    }
    setShowBodyPanel(true);
  }, [bodies.length, effectiveResult, lang]);

  /** Geometry lookup map — avoids storing THREE objects in React state */
  const bodyGeosRef = React.useRef<Map<string, { geometry: BufferGeometry; edgeGeometry: BufferGeometry }>>(new Map());

  /** Split the given body into two halves */
  const handleSplitBody = useCallback((bodyId: string, plane: number, offset: number) => {
    const geos = bodyGeosRef.current.get(bodyId);
    if (!geos) { addToast('error', lt.bodyGeometryMissing); return; }
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
      addToast('success', lt.bodySplitComplete);
    } catch {
      addToast('error', lt.splitFailed);
    }
  }, [bodies, lang, addToast]);

  /** Merge selected bodies into one */
  const handleMergeBodies = useCallback((bodyIds: string[]) => {
    const geoList = bodyIds.map(id => bodyGeosRef.current.get(id)?.geometry).filter(Boolean) as BufferGeometry[];
    if (geoList.length < 2) return;
    try {
      const merged = mergeBodyGeometries(geoList);
      const newId = crypto.randomUUID();
      const colorIdx = bodies.findIndex(b => b.id === bodyIds[0]);
      bodyGeosRef.current.set(newId, { geometry: merged, edgeGeometry: makeEdges(merged) });
      bodyIds.forEach(id => bodyGeosRef.current.delete(id));
      setBodies(prev => [
        ...prev.filter(b => !bodyIds.includes(b.id)),
        { id: newId, name: lt.mergedBody, color: BODY_COLORS[Math.max(0, colorIdx) % BODY_COLORS.length], visible: true, locked: false, mergedFrom: bodyIds },
      ]);
      setActiveBodyId(newId);
      setSelectedBodyIds([]);
      addToast('success', lt.bodiesMerged);
    } catch {
      addToast('error', lt.mergeFailed);
    }
  }, [bodies, lang, addToast]);

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
            bbox: { w: 0, h: 0, d: 0 } } };
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
    handleSetActiveTab('optimize');
  }, [result, sketchResult, handleSetActiveTab]);

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
      await exportSTL(resultMesh, 'generative-design');
      analytics.shapeDownload('STL');
      addToast('success', lt.stlSaved);
    } catch (err) {
      console.error('[Export STL]', err);
      addToast('error', lt.stlExportFailed);
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

  const handleAiPreview = useCallback((data: ChatResult) => {
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
    addToast('success', lt.shapeFromText(sc.id));
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
    if (isSketchMode && sketchViewMode === '2d') {
      setSketchRadial({ x: e.clientX, y: e.clientY, visible: true });
      setCtxMenu(prev => ({ ...prev, visible: false }));
      return;
    }
    const geomOpts = { hasAssembly: bomParts.length >= 2 };
    const items = isSketchMode ? getContextItemsSketch(lang) : effectiveResult ? getContextItemsGeometry(lang, geomOpts) : getContextItemsEmpty(lang);
    setCtxMenu({ x: e.clientX, y: e.clientY, visible: true, items });
  }, [isSketchMode, sketchViewMode, effectiveResult, lang, bomParts.length]);

  const handleContextSelect = useCallback((id: string) => {
    setCtxMenu(prev => ({ ...prev, visible: false }));
    setSketchRadial(prev => ({ ...prev, visible: false }));
    switch (id) {
      case 'action-extrude': {
        setPendingChatMsg(`Extrude the selected face by 10mm`);
        openAIAssistant('chat');
        break;
      }
      case 'action-fillet': {
        setPendingChatMsg(`Add a 5mm fillet to the selected edge`);
        openAIAssistant('chat');
        break;
      }
      case 'action-ask-ai': {
        setPendingChatMsg(`Modify the selected ${selectedElement?.type || 'element'}`);
        openAIAssistant('chat');
        break;
      }
      case 'action-isolate': {
        if (selectedElement?.partName) {
          setPendingChatMsg(`Isolate part: ${selectedElement.partName}`);
          openAIAssistant('chat');
        }
        break;
      }
      case 'zoom-fit': break; // handled by viewer
      case 'sketch-here': setIsSketchMode(true); setSketchResult(null); setEditMode('none'); break;
      case 'finish-sketch': handleSketchGenerate(); break;
      case 'cancel-sketch': setIsSketchMode(false); break;
      case 'sketch-tool-line': setSketchTool('line'); break;
      case 'sketch-tool-circle': setSketchTool('circle'); break;
      case 'sketch-tool-rect': setSketchTool('rect'); break;
      case 'sketch-tool-trim': setSketchTool('trim'); break;
      case 'sketch-tool-offset': setSketchTool('offset'); break;
      case 'sketch-tool-polygon': setSketchTool('polygon'); break;
      case 'sketch-radial-dimension': setSketchPalDims(true); setSketchTool('dimension'); break;
      case 'sketch-insert-canvas': sketchRefInputRef.current?.click(); break;
      case 'sketch-toggle-slice': setSketchPalSlice(v => !v); break;
      case 'measure': setMeasureActive(v => !v); break;
      case 'delete': if (selectedFeatureId) removeFeature(selectedFeatureId); break;
      case 'suppress': if (selectedFeatureId) toggleFeature(selectedFeatureId); break;
      case 'add-dimension': setShowDimensions(true); setSketchPalDims(true); break;
      case 'properties': if (selectedFeatureId) setShowPropertyManager(true); break;
      case 'add-to-cart': handleAddToCart(); break;
      case 'sketch-undo': handleSketchUndo(); break;
      case 'sketch-clear': handleSketchClear(); break;
      case 'edit-feature': if (selectedFeatureId) startEditing(selectedFeatureId); break;
      case 'mate-coincident':
      case 'mate-coaxial':
      case 'mate-distance': {
        if (bomParts.length < 2) break;
        const typeMap: Record<string, MateType> = {
          'mate-coincident': 'coincident',
          'mate-coaxial': 'concentric',
          'mate-distance': 'distance' };
        const mateType = typeMap[id];
        const partA = bomParts[0].name || 'part_0';
        const partB = bomParts[1].name || 'part_1';
        const newMate: AssemblyMate = {
          id: generateMateId(),
          type: mateType,
          partA,
          partB,
          ...(mateType === 'distance' ? { value: 0 } : {}),
          locked: false };
        setAssemblyMates([...assemblyMates, newMate]);
        setShowAssemblyPanel(true);
        const mateLabel = mateType === 'coincident' ? lt.mateCoincident : mateType === 'concentric' ? lt.mateConcentric : lt.mateDistance;
        addToast('success', lt.mateAdded(mateLabel, partA, partB));
        break;
      }
    }
  }, [selectedFeatureId, removeFeature, toggleFeature, handleSketchGenerate, handleAddToCart, handleSketchUndo, handleSketchClear, startEditing, bomParts, assemblyMates, setAssemblyMates, setShowAssemblyPanel, addToast, lang, setSketchTool, setIsSketchMode, setShowDimensions, setSketchPalDims, setSketchPalSlice]);

  const handleExportDrawingPDF = useCallback(async () => {
    if (!effectiveResult) return;
    setExportingFormat('PDF');
    try {
      const { exportDrawingPDF } = await import('./io/pdfExport');
      const svgEl = document.querySelector<SVGSVGElement>('.drawing-view-svg');
      if (!svgEl) {
        setSketchViewMode('drawing');
        addToast('info', shapeLabels.exportDrawing || 'PDF Drawing — switch to Drawing view first');
        setExportingFormat(null);
        return;
      }
      const partName = isSketchMode ? 'sketch' : selectedId;
      await exportDrawingPDF(svgEl, `${partName || 'drawing'}.pdf`, 'A3', 'landscape');
    } catch (err) {
      console.error('[Export DrawingPDF]', err);
      addToast('error', lt.pdfExportFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, isSketchMode, selectedId, t, addToast, lang]);

  const handleContextClose = useCallback(() => {
    setCtxMenu(prev => ({ ...prev, visible: false }));
    setSketchRadial(prev => ({ ...prev, visible: false }));
  }, []);

  // Long-press context menu for mobile touch
  const handleLongPress = useCallback((x: number, y: number) => {
    if (isSketchMode && sketchViewMode === '2d') {
      setSketchRadial({ x, y, visible: true });
      setCtxMenu(prev => ({ ...prev, visible: false }));
      return;
    }
    const geomOpts = { hasAssembly: bomParts.length >= 2 };
    const items = isSketchMode ? getContextItemsSketch(lang) : effectiveResult ? getContextItemsGeometry(lang, geomOpts) : getContextItemsEmpty(lang);
    setCtxMenu({ x, y, visible: true, items });
  }, [isSketchMode, sketchViewMode, effectiveResult, lang, bomParts.length]);
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
    measureActive,
    setMeasureActive, setShowDimensions,
    handleHistoryUndo, handleHistoryRedo,
    sketchTool, setSketchTool,
    handleSaveNfab, handleSaveNfabCloud, handleLoadNfab,
    handleSketchRedo,
    handleShowContextHelp: contextHelp.show,
    meshSelectionActive: !!selectedElement,
    onEscapeClearMeshSelection: clearMeshSelection,
    isReadOnly,
  });

  // Auto-run DFM analysis and show manufacturing card whenever the result updates
  useEffect(() => {
    if (!effectiveResult) {
      setShowManufacturingCard(false);
      return;
    }
    setShowManufacturingCard(true);
    // Fire-and-forget DFM for the card summary. Do not open the Pro upgrade modal here:
    // `effectiveResult` can update more than once (pipeline → sketch mesh), and the free
    // DFM credit is single-use — a second auto-call would wrongly show Pro immediately.
    handleDFMAnalyze(
      ['cnc_milling', 'injection_molding'],
      { minWallThickness: 1.0, minDraftAngle: 1.0, maxAspectRatio: 4.0 },
      { suppressUpgradePrompt: true, suppressSuccessToast: true },
    );
  }, [effectiveResult]);

  // ══════════════════════════════════════════════════════════════════════════
  // FILE IMPORT / EXPORT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const getEffectiveGeometry = useCallback(() => effectiveResult?.geometry ?? null, [effectiveResult]);
  const {
    importedGeometry, setImportedGeometry,
    importedFilename, setImportedFilename,
    handleImportFile,
    handleExportCurrentSTL,
    handleExportOBJ,
    handleExportPLY,
    handleExport3MF } = useImportExport(addToast, getEffectiveGeometry, setSketchResult as React.Dispatch<React.SetStateAction<ShapeResult | null>>, setBomParts, setBomLabel, setIsSketchMode as React.Dispatch<React.SetStateAction<boolean>>, activeTab, resultMesh);

  const handleExportSTEP = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    if (!planLimits.exportFormats.includes('step')) {
      setUpgradeFeature(lt.stepExportFeature); setShowUpgradePrompt(true); return;
    }
    // Soft upsell: free users see a one-time prompt describing Pro-only
    // pre-export optimization. The export still proceeds after the modal closes.
    if (!isProPlan && !exportOptimizeUpsellShownRef.current) {
      exportOptimizeUpsellShownRef.current = true;
      setShowExportOptimizeUpgrade(true);
    }
    setExportingFormat('STEP');
    try {
      const { exportManufacturingZipBundle } = await import('./io/manufacturingPackage');
      const slug = (selectedId ?? 'part').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 48) || 'part';
      const day = new Date().toISOString().slice(0, 10);
      const base = `nexyfab-${slug}-${day}`;
      const er = effectiveResult;
      const generatedAt = new Date().toISOString();
      await exportManufacturingZipBundle(geo, base, {
        partLabel: selectedId ?? 'part',
        shapeTemplateId: selectedId ?? undefined,
        bbox: er.bbox,
        volume_cm3: er.volume_cm3,
        surface_area_cm2: er.surface_area_cm2,
        unitSystem,
        materialKey: materialId,
        generatedAt,
      }, placedParts.length > 0 ? buildBomRows() : undefined);
      analytics.shapeDownload('STEP');
      addToast('success', lt.stepExportBundleSuccess);
    } catch (err) {
      console.error('[Export STEP]', err);
      addToast('error', lt.stepExportFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, addToast, lang, planLimits.exportFormats, setUpgradeFeature, setShowUpgradePrompt, isProPlan, setShowExportOptimizeUpgrade, selectedId, unitSystem, materialId, buildBomRows, placedParts.length]);

  const handleExportGLTF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    if (!planLimits.exportFormats.includes('gltf')) {
      setUpgradeFeature(lt.gltfExportFeature); setShowUpgradePrompt(true); return;
    }
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
    if (!planLimits.exportFormats.includes('dxf')) {
      setUpgradeFeature(lt.dxfExportFeature); setShowUpgradePrompt(true); return;
    }
    setExportingFormat('DXF');
    try {
      const { exportDXF, geometryToDXFEntities } = await import('./io/dxfExporter');
      const entities = geometryToDXFEntities(geo, dxfProjection);
      if (entities.length === 0) {
        addToast('warning', 'No edges found for DXF export');
        setExportingFormat(null);
        return;
      }
      await exportDXF(entities, 'shape-design');
      addToast('success', lt.dxfExported);
    } catch (err) {
      console.error('DXF export failed:', err);
      addToast('error', lt.dxfExportFailed);
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
      addToast('error', lt.createShapeFirst);
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
          warnings: result.warnings };
      }
      await exportSheetMetalDXF({ geometry: geo, ...pattern }, 'flat-pattern');
      if (pattern.warnings.length > 0) {
        for (const w of pattern.warnings) {
          addToast(w.severity, lang === 'ko' ? w.messageKo : w.messageEn); // messages come from analysis modules
        }
      }
      addToast('success', lt.flatDxfExported);
    } catch (err) {
      addToast('error', lt.flatDxfFailed(err instanceof Error ? err.message : String(err)));
    }
  }, [effectiveResult, addToast, lang]);

  const handleExportRhino = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    if (!planLimits.exportFormats.includes('rhino')) {
      setUpgradeFeature(lt.rhinoExportFeature); setShowUpgradePrompt(true); return;
    }
    setExportingFormat('Rhino');
    try {
      const { exportRhinoJSON } = await import('./io/rhinoExport');
      await exportRhinoJSON(geo, 'shape-design', 'Shape');
      addToast('success', lt.rhinoExported);
    } catch (err) {
      console.error('[Export Rhino]', err);
      addToast('error', lt.rhinoFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [getEffectiveGeometry, addToast, lang]);

  const handleExportGrasshopper = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    if (!planLimits.exportFormats.includes('grasshopper')) {
      setUpgradeFeature(lt.grasshopperExportFeature); setShowUpgradePrompt(true); return;
    }
    setExportingFormat('Grasshopper');
    try {
      const { exportGrasshopperPoints } = await import('./io/rhinoExport');
      await exportGrasshopperPoints(geo, 'shape-design-points');
      addToast('success', lt.grasshopperExported);
    } catch (err) {
      console.error('[Export Grasshopper]', err);
      addToast('error', lt.grasshopperFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [getEffectiveGeometry, addToast, lang]);

    // ══════════════════════════════════════════════════════════════════════════
  // SCENE SAVE / LOAD / GLB EXPORT
  // ══════════════════════════════════════════════════════════════════════════

  const sceneRef = useRef<Scene | null>(null);
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
        color: '#8b9cf4' }));
      // Include the base shape as the first entry
      serializableShapes.unshift({
        id: `base_${selectedId}`,
        shapeType: selectedId,
        params: { ...params },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        materialPreset: materialId,
        color: '#8b9cf4' });
      const state = serializeScene(serializableShapes, undefined);
      await exportSceneAsJSON(state, 'nexyfab-scene');
      addToast('success', t.sceneSaved ?? 'Scene saved');
    } catch (err) {
      console.error('Scene save failed:', err);
      addToast('error', lt.sceneSaveFailed);
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
      addToast('error', lt.sceneLoadFailed);
    }
    e.target.value = '';
  }, [clearAll, addToast, t, lang]);

  const handleExportGLB = useCallback(async () => {
    if (!sceneRef.current) {
      addToast('warning', lt.loadSceneFirst);
      return;
    }
    try {
      const { exportSceneGLB } = await import('./io/gltfExportUtils');
      await exportSceneGLB(sceneRef.current, 'nexyfab-scene');
      analytics.shapeDownload('GLB');
      addToast('success', t.exportGLB ? `${t.exportGLB} OK` : 'GLB exported');
    } catch (err) {
      console.error('GLB export failed:', err);
      addToast('error', lt.glbExportFailed);
    }
  }, [addToast, t, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // MESH PROCESSING HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleMeshProcess = useCallback(async (op: string) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const mesh = await import('./mesh/meshProcessing');
    let processed: BufferGeometry;
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
    const size = bb.getSize(new Vector3());
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
    draftAnalysis:    () => { setShowDraftAnalysis(true); setDraftResult(null); },
    holeWizard:       () => { setShowHoleWizard(true); },
    thermal:          () => setShowThermalPanel(true),
    generativeDesign: () => setShowGenDesign(true),
    ecad:             () => setShowECADPanel(true),
    motionStudy:      () => setShowMotionStudy(true),
    modalAnalysis:    () => setShowModalAnalysis(true),
    parametricSweep:  () => setShowParametricSweep(true),
    toleranceStackup: () => setShowToleranceStackup(true),
    surfaceQuality:   () => setShowSurfaceQuality(true),
    autoDrawing:      () => setShowAutoDrawing(true),
    mfgPipeline:      () => setShowMfgPipeline(true) }), []);

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
          overhangAngle: printOverhangAngle }));
        addToast('info', lt.printAnalysisComplete);
        return;
      }
      case 'cam': {
        if (!checkFreemium('cam_export').allowed) { setShowCamUpgrade(true); return; }
        const CAM_HEAVY_VERTEX_THRESHOLD = 80_000;
        const vtx = geo.attributes.position?.count ?? 0;
        if (vtx >= CAM_HEAVY_VERTEX_THRESHOLD && !getSuppressCadPerfToasts()) {
          addToast('info', lt.camHeavyMeshHint);
        }
        const { generateCAMToolpaths } = await import('./analysis/camLite');
        const operation = {
          type: 'face_mill' as const,
          toolDiameter: 10, stepover: 50, stepdown: 2,
          feedRate: 500, spindleSpeed: 3000 };
        const result = generateCAMToolpaths(geo, operation);
        reportInfo('cam_toolpath', 'toolpaths_generated', {
          operationType: operation.type,
          toolDiameter: operation.toolDiameter,
          passes: result.toolpaths.length,
          estimatedMinutes: Number(result.estimatedTime.toFixed(2)),
        });
        setCamSimResult({ result, operation });
        setShowCAMSimPanel(true);
        addToast('success', lt.gcodeGenerated ? lt.gcodeGenerated('simulation', result.toolpaths.length, 0, Number(result.estimatedTime.toFixed(1)), '') : 'CAM Paths generated');
        return;
      }
    }
  }, [effectiveResult, importedGeometry, sketchResult, addToast, printBuildDir, printOverhangAngle, lang, panelOpeners, mfgCamPost, selectedId, checkFreemium, lt]);

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
    addToast('info', lt.printAnalysisComplete);
  }, [effectiveResult, addToast, lang]);

  const [printOptimization, setPrintOptimization] = useState<OrientationOptimizationResult | null>(null);

  const handleOptimizeOrientation = useCallback(async (
    overhangAngle: number,
    currentDirection: [number, number, number],
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lt.generateShapeFirst);
      return;
    }
    const { findOptimalOrientation } = await import('./analysis/printAnalysis');
    const result = findOptimalOrientation(geo, { overhangAngle, currentDirection });
    setPrintOptimization(result);
    const best = result.candidates[result.bestIndex];
    const cur  = result.candidates[result.currentIndex];
    if (result.bestIndex === result.currentIndex) {
      addToast('success', lt.alreadyOptimalOrientation);
    } else {
      const pct = cur.supportArea > 0
        ? Math.round(((cur.supportArea - best.supportArea) / cur.supportArea) * 100)
        : 0;
      addToast('info', lt.orientationSaves(best.label, pct));
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
      addToast('warning', lt.generateShapeFirst);
      return;
    }
    try {
      const { exportPrintReady } = await import('./io/exporters');
      const baseName = `nexyfab-${settings.process}-${Date.now()}`;
      await exportPrintReady(geo, baseName, {
        process: settings.process,
        layerHeight: settings.layerHeight,
        infillPercent: settings.infillPercent,
        printSpeed: settings.printSpeed,
        buildDirection: settings.buildDirection,
        materialId,
        estimatedTimeMin: printAnalysis?.printTime,
        estimatedCostUsd: printAnalysis?.costBreakdown?.totalCost });
      addToast('success', lt.printReadyDownloaded);
    } catch (err) {
      console.error('[exportPrintReady]', err);
      addToast('error', lt.exportFailed);
    }
  }, [effectiveResult, materialId, printAnalysis, addToast, lang]);

  const handleApplyOptimalOrientation = useCallback(async (direction: [number, number, number]) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const { analyzePrintability } = await import('./analysis/printAnalysis');
    const result = analyzePrintability(geo, {
      buildDirection: direction,
      overhangAngle: printOverhangAngle });
    setPrintAnalysis(result);
    setPrintBuildDir(direction);
    // Re-run the optimizer with the new current direction so the ranking updates
    const { findOptimalOrientation } = await import('./analysis/printAnalysis');
    setPrintOptimization(findOptimalOrientation(geo, {
      overhangAngle: printOverhangAngle,
      currentDirection: direction }));
    addToast('success', lt.optimalOrientationApplied);
  }, [effectiveResult, printOverhangAngle, addToast, lang]);

  const handleDFMAnalyze = useCallback(async (
    processes: ManufacturingProcess[],
    options: { minWallThickness: number; minDraftAngle: number; maxAspectRatio: number },
    opts?: { suppressUpgradePrompt?: boolean; suppressSuccessToast?: boolean },
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const plan = useAuthStore.getState().user?.plan;
    if (!dfmAnalysisAllowed(plan)) {
      if (!opts?.suppressUpgradePrompt) {
        setUpgradeFeature(lt.dfmAnalysisFeature);
        setShowUpgradePrompt(true);
      }
      return;
    }
    try {
      const results = await analyzeDFMWorker(geo, processes, options);
      setDfmResults(results);
      setDfmHighlightedIssue(null);
      consumeFreeDfmCreditIfUnpaid(plan);
      if (!opts?.suppressSuccessToast) {
        addToast('info', lt.dfmAnalysisComplete);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', lt.dfmFailed(msg));
    }
  }, [effectiveResult, analyzeDFMWorker, addToast, lang, setUpgradeFeature, setShowUpgradePrompt, setDfmHighlightedIssue, lt]);

  const handleApplyDFMFix = useCallback((
    _issueType: string,
    suggestion: { paramKey: string; value: number; label: { ko: string; en: string } },
  ) => {
    const gate = checkFreemium('dfm_autofix');
    if (!gate.allowed) {
      setShowDFMFixUpgrade(true);
      return;
    }
    setParam(suggestion.paramKey, suggestion.value);
    addToast('success', lt.autoFixApplied(lang === 'ko' ? suggestion.label.ko : suggestion.label.en));
  }, [setParam, addToast, lang, checkFreemium, setShowDFMFixUpgrade]);

  // ── AI DFM Explainer (Phase 1) ─────────────────────────────────────────
  const handleExplainDFMIssue = useCallback(async (issue: DFMIssue): Promise<DFMExplanation | null> => {
    const gate = checkFreemium('dfm_insights');
    if (!gate.allowed) {
      setShowDFMInsightsUpgrade(true);
      return null;
    }
    try {
      const exp = await explainDFMIssue(issue, {
        process: issue.process,
        material: materialId,
        params,
        lang,
        projectId: currentProjectId ?? undefined });
      return exp;
    } catch (err) {
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        setShowDFMInsightsUpgrade(true);
        return null;
      }
      addToast('error', lt.aiAnalysisFailed(e.message));
      return null;
    }
  }, [checkFreemium, setShowDFMInsightsUpgrade, materialId, params, lang, addToast]);

  const handlePreviewDFMCostDelta = useCallback((hint: { key: string; delta: number }): CostDelta | null => {
    if (!geometryMetrics || !materialId) return null;
    const nextMetrics = approximateMetricsAfterHint(geometryMetrics, params, hint);
    return calculateCostDelta(geometryMetrics, nextMetrics, materialId, 1, {});
  }, [geometryMetrics, materialId, params]);

  const handleDraftAnalyze = useCallback((
    pullDirection: [number, number, number],
    minDraftDeg: number,
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lt.noGeometryToAnalyze);
      return;
    }
    try {
      const result = analyzeDraft(geo, { pullDirection, minDraftDeg });
      setDraftResult(result);
      setDraftMinDeg(minDraftDeg);
      if (result.counts.undercut > 0) {
        addToast('warning', lt.undercutsDetected(result.counts.undercut.toLocaleString()));
      } else if (result.counts.vertical > 0) {
        addToast('info', lt.facesNeedDraft(result.counts.vertical.toLocaleString()));
      } else {
        addToast('success', lt.allFacesModable);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', lt.draftFailed(msg));
    }
  }, [effectiveResult, setDraftResult, setDraftMinDeg, addToast, lang]);

  /**
   * Map a DFM issue type to a likely feature in the current feature stack and
   * select it so the FeatureTree + TimelineBar highlight it. Walks the most
   * recent features first so the user lands on the most relevant one.
   */
  const handleJumpToDFMFeature = useCallback((issueType: string) => {
    const ISSUE_TO_FEATURE_TYPES: Record<string, string[]> = {
      thin_wall:    ['shell'],
      uniform_wall: ['shell'],
      draft_angle:  ['draft'],
      sharp_corner: ['fillet', 'chamfer'],
      deep_pocket:  ['extrude', 'cut', 'pocket'],
      aspect_ratio: ['extrude', 'revolve'],
      undercut:     ['extrude', 'cut', 'sweep'],
      tool_access:  ['fillet', 'chamfer', 'extrude'] };
    const candidates = ISSUE_TO_FEATURE_TYPES[issueType] ?? [];
    if (candidates.length === 0 || features.length === 0) {
      addToast('info', lt.noRelatedFeature);
      return;
    }
    // Most recent feature first
    const found = [...features].reverse().find(f => candidates.includes(f.type as string));
    if (found) {
      setSelectedFeatureId(found.id);
      startEditing(found.id);
      addToast('info', lt.jumpToFeature(found.type));
    } else {
      addToast('info', lt.noFeatureInTree(candidates.join(', ')));
    }
  }, [features, setSelectedFeatureId, startEditing, addToast, lang]);

  const handleFEARunAnalysis = useCallback(async (material: FEAMaterial) => {
    if (!getPlanLimits(useAuthStore.getState().user?.plan).feaAnalysis) {
      setUpgradeFeature(lt.feaUpgradeFeature); setShowUpgradePrompt(true); return;
    }
    const geo = effectiveResult?.geometry;
    if (!geo || feaConditions.length === 0) return;
    try {
      const result = await runFEAWorker(geo, material, feaConditions);
      setFeaResult(result);
      addToast('info', lt.feaAnalysisComplete);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', lt.feaFailed(msg));
    }
  }, [effectiveResult, feaConditions, runFEAWorker, addToast, lang, setUpgradeFeature, setShowUpgradePrompt]);

  const feaTotalFaces = useMemo(() => {
    const geo = effectiveResult?.geometry;
    if (!geo) return 0;
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    return Math.floor(nonIndexed.attributes.position.count / 3);
  }, [effectiveResult]);

  // ── Mass Properties computation ──
  const massProperties = useMemo(() => {
    if (!showMassProps || !effectiveResult) return null;
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

  const handleApplyMatesToPlacement = useCallback(() => {
    if (placedParts.length < 2 || assemblyMates.length === 0) return;
    const mateRows = assemblyMates.map(m => ({ id: m.id, partA: m.partA, partB: m.partB, type: m.type }));
    const pf = preflightAssemblyMates(mateRows);
    if (!pf.ok) {
      addToast('error', pf.issues.join(' · '));
      return;
    }
    const graph = mateGraphSummary(mateRows);
    for (const w of graph.warnings) addToast('warning', w);

    const confirmMsg =
      lang === 'ko'
        ? '메이트 제약을 파트 배치(위치·회전)에 적용합니다. 계속할까요?'
        : 'Apply mate constraints to part placement (position & rotation). Continue?';
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;
    try {
      const before = JSON.parse(JSON.stringify(placedParts)) as PlacedPart[];
      const after = applyGeometryMatesToPlaced(placedParts, assemblyMates);
      // Phase B1: nonce inside execute/undo/redo so Solver tab (`solveAssembly` BOM sync) matches
      // `solveMates` placement after undo — not only after the initial apply.
      commandHistory.execute({
        id: `mates-to-placement-${Date.now()}`,
        label: 'Apply mates to placement',
        labelKo: '메이트 → 배치 적용',
        execute: () => {
          setPlacedParts(after);
          setAssemblySolverResyncNonce(n => n + 1);
        },
        undo: () => {
          setPlacedParts(before);
          setAssemblySolverResyncNonce(n => n + 1);
        },
      });
      addToast(
        'success',
        lang === 'ko'
          ? '메이트가 파트 배치에 적용되었습니다. (명령 히스토리에서 실행 취소 가능)'
          : 'Mates applied to placement. (Undo via command history / toolbar)',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast('error', lang === 'ko' ? `적용 실패: ${msg}` : `Apply failed: ${msg}`);
    }
  }, [placedParts, assemblyMates, setPlacedParts, setAssemblySolverResyncNonce, addToast, lang]);

  const handleDetectInterference = useCallback(async () => {
    // M3-P2 / 품질: Prefer `placedParts`→`placedPartsToBomResults` (snapshot parity). Else
    // multi-body `bodyBomParts` (world origin per mesh). Else cart/chat `bomParts`.
    const bomForCheck =
      placedParts.length >= 2
        ? placedPartsToBomResults(placedParts)
        : bodyBomParts && bodyBomParts.length >= 2
          ? bodyBomParts
          : bomParts;
    if (!bomForCheck || bomForCheck.length < 2) return;
    const loadGuide = getAssemblyLoadGuidance(bomForCheck.length);
    if (loadGuide.suggestInterferencePreambleToast && !getSuppressCadPerfToasts()) {
      try {
        const k = 'nf_interference_heavy_run_hint_v1';
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, '1');
          addToast('info', lt.interferenceRunHeavyHint);
        }
      } catch { /* private mode */ }
    }
    const { assemblyPairwiseComparisonCount: pairwiseN, INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT } = await import('@/lib/assemblyLoadPolicy');
    const pairWorst = pairwiseN(bomForCheck.length);
    if (pairWorst > 50) {
      const { cadPerfLog } = await import('@/lib/cadPerfLog');
      cadPerfLog('interference.large', 0, {
        parts: bomForCheck.length,
        pairWorst,
        broadPhaseMinN: INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT,
      });
    }
    const partsInput = bomForCheck.map((p, i) => ({
      id: p.name || `part_${i}`,
      geometry: p.result.geometry,
      transform: bomPartWorldMatrixFromBom(p),
    }));
    setInterferenceLoading(true);
    const perfStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const results = await detectInterferenceWorker(partsInput);
      const { cadPerfLog } = await import('@/lib/cadPerfLog');
      const elapsed =
        typeof performance !== 'undefined' ? performance.now() - perfStart : Date.now() - perfStart;
      cadPerfLog('interference', elapsed, { parts: partsInput.length, hits: results.length });
      setInterferenceResults(results);
      if (results.length === 0) {
        addToast('success', lt.noInterference);
      } else {
        addToast('error', lt.interferenceFound(results.length));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        addToast('info', lt.interferenceCancelled);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Interference check cancelled') {
        addToast('info', lt.interferenceCancelled);
        return;
      }
      addToast('error', lt.interferenceFailed(msg));
    } finally {
      setInterferenceLoading(false);
    }
  }, [
    bomParts,
    bodyBomParts,
    placedParts,
    detectInterferenceWorker,
    cancelInterferenceWorker,
    setInterferenceLoading,
    setInterferenceResults,
    addToast,
    lang,
    lt,
  ]);

  const assemblyPartNames = useMemo(() => {
    if (placedParts.length >= 2) return placedParts.map((p, i) => p.name || `part_${i}`);
    if (bodyBomParts && bodyBomParts.length >= 2) return bodyBomParts.map((p, i) => p.name || `part_${i}`);
    return bomParts.map((p, i) => p.name || `part_${i}`);
  }, [placedParts, bodyBomParts, bomParts]);

  /** 간섭 파이프와 동일한 소스 우선순위로 파트 수를 맞춤(뷰포트 BOM과 다를 수 있음). */
  const interferenceCheckPartCount = useMemo(() => {
    if (placedParts.length >= 2) return placedParts.length;
    if (bodyBomParts && bodyBomParts.length >= 2) return bodyBomParts.length;
    if (bomParts.length >= 2) return bomParts.length;
    return 0;
  }, [placedParts.length, bodyBomParts?.length, bomParts.length]);

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

  const _handleStandardPartParamChange = useCallback(async (key: string, value: number) => {
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
      const size = bb.getSize(new Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setSketchResult({ geometry: flat.geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
      addToast('success', 'Sheet metal unfolded');
    } else if (op === 'bend' || op === 'flange' || op === 'hem') {
      setShowSheetMetalPanel(true);
    }
  }, [effectiveResult, addToast]);

  const handleSmBend = useCallback(async (angle: number, radius: number, position: number, direction: 'up' | 'down') => {
    if (!effectiveResult) { addToast('error', lt.createShapeFirst); return; }
    const { applyBend } = await import('./features/sheetMetal');
    const geo = applyBend(effectiveResult.geometry, { angle, radius, position, direction });
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smBendBb = geo.boundingBox;
    if (!smBendBb) return;
    const s = smBendBb.getSize(new Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    addToast('success', lt.bendApplied);
  }, [effectiveResult, addToast, lang]);

  const handleSmFlange = useCallback(async (height: number, angle: number, radius: number, edgeIndex: number) => {
    if (!effectiveResult) { addToast('error', lt.createShapeFirst); return; }
    const { applyFlange } = await import('./features/sheetMetal');
    const geo = applyFlange(effectiveResult.geometry, { height, angle, radius, edgeIndex });
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smFlangeBb = geo.boundingBox;
    if (!smFlangeBb) return;
    const s = smFlangeBb.getSize(new Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    addToast('success', lt.flangeApplied);
  }, [effectiveResult, addToast, lang]);

  const handleSmFlatPattern = useCallback(async (thickness: number, kFactor: number) => {
    if (!effectiveResult) { addToast('error', lt.createShapeFirst); return; }
    const { generateFlatPattern } = await import('./features/sheetMetal');
    // Legacy callers pass a raw K-factor; the new API accepts either a material
    // id or a K-factor number. Forward the K-factor unchanged.
    const pattern = generateFlatPattern(effectiveResult.geometry, [], thickness, kFactor);
    const geo = pattern.geometry;
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smFlatBb = geo.boundingBox;
    if (!smFlatBb) return;
    const s = smFlatBb.getSize(new Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    if (pattern.warnings.length > 0) {
      for (const w of pattern.warnings) {
        addToast(w.severity, lang === 'ko' ? w.messageKo : w.messageEn);
      }
    }
    addToast('success', lt.flatPatternGenerated);
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
        first.geometry.computeBoundingBox();
        const bb = first.geometry.boundingBox;
        if (!bb) return;
        const size = bb.getSize(new Vector3());
        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
        // Show as BOM parts
        const bomResults = primitives.map((p) => ({
          name: `${p.type} (${(p.confidence * 100).toFixed(0)}%)`,
          result: { geometry: p.geometry, edgeGeometry: makeEdges(p.geometry), volume_cm3: meshVolume(p.geometry) / 1000, surface_area_cm2: meshSurfaceArea(p.geometry) / 100, bbox } }));
        setBomParts(bomResults);
        setBomLabel('Detected Primitives');
      }
    } else if (type === 'extrusions') {
      ext.detectExtrusions(geo);
    } else if (type === 'autoSurface') {
      ext.autoSurface(geo);
    } else if (type === 'crossSection') {
      const plane = new Plane(new Vector3(0, 1, 0), 0);
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
      if (!effectiveResult) return { icon: '🧊', text: lt.goDesignTabFirst, color: '#f59e0b' };
      if (fixedFaces.length === 0) return { icon: '📌', text: 'Click a face in the viewer to set fixed boundary.', color: '#f59e0b' };
      if (loads.length === 0) return { icon: '⬇', text: 'Now add a load: select Load mode and click a face.', color: '#f59e0b' };
      return { icon: '▶', text: 'Ready. Click Generate in toolbar to start optimization.', color: '#6366f1' };
    }
    if (activeTab === 'design' && measureActive) return { icon: '📏', text: lt.measureToolActive, color: '#f97316' };
    if (isSketchMode && !sketchResult) return { icon: '✏️', text: 'Draw a closed profile. Click first point to close.', color: '#7c3aed' };
    if (editMode === 'vertex') return { icon: '⬡', text: lt.vertexEditPointerHint, color: '#22c55e' };
    if (editMode === 'edge') return { icon: '╱', text: `${lt.edgeEditHint} — ${lt.edgeEditPointerHint}`, color: '#22c55e' };
    if (editMode === 'face') return { icon: '▣', text: lt.faceEditHint, color: '#22c55e' };
    if (activeTab === 'design' && selectedFeatureId) {
      const feat = features.find(f => f.id === selectedFeatureId);
      if (feat) return { icon: '🎯', text: `${lt.featureSelectedPrefix} ${feat.type}`, color: '#a371f7' };
    }
    if (!effectiveResult) return { icon: '🧊', text: 'Select a shape or use AI Chat to begin.', color: '#6b7280' };
    if (
      activeTab === 'design'
      && effectiveResult
      && !isSketchMode
      && editMode === 'none'
      && !measureActive
      && transformMode === 'off'
    ) {
      return { icon: '💡', text: lt.designEditQuickGuide, color: '#79c0ff' };
    }
    return { icon: '📐', text: `${shapeLabels[`shapeName_${selectedId}`] || selectedId} — ${effectiveResult.bbox.w.toFixed(0)}×${effectiveResult.bbox.h.toFixed(0)}×${effectiveResult.bbox.d.toFixed(0)} mm`, color: '#58a6ff' };
  }, [activeTab, isOptimizing, optResult, fixedFaces, loads, progress, isSketchMode, sketchResult, editMode, effectiveResult, selectedId, t, lang, measureActive, selectedFeatureId, features, lt, transformMode]);

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
  // ── Drag and Drop Standard Parts ──
  const handleStandardPartDrop = useCallback((evt: {
    partId: string;
    position: Vector3;
    normal: Vector3;
    intersectedPartName?: string;
    placement?: { transform: Matrix4 };
  }) => {
    
    // We need to fetch the STANDARD_PARTS_MAP here dynamically or pass it.
    import('./library/standardParts').then(({ STANDARD_PARTS_MAP }) => {
      const part = STANDARD_PARTS_MAP[evt.partId];
      if (!part) return;

      const params: Record<string, number> = {};
      part.params.forEach(sp => { params[sp.key] = sp.default; });

      let pos = [evt.position.x, evt.position.y, evt.position.z] as [number, number, number];
      let rot = [0, 0, 0] as [number, number, number];

      if (evt.placement && evt.placement.transform) {
        const position = new Vector3();
        const quaternion = new Quaternion();
        const scale = new Vector3();
        evt.placement.transform.decompose(position, quaternion, scale);
        const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
        pos = [position.x, position.y, position.z];
        rot = [MathUtils.radToDeg(euler.x), MathUtils.radToDeg(euler.y), MathUtils.radToDeg(euler.z)];
      }

      const newPlacedPartId = `placed_${Date.now()}`;
      const newPlacedPart = {
        id: newPlacedPartId,
        name: part.id,
        shapeId: `std:${part.id}`,
        params,
        qty: 1,
        position: pos,
        rotation: rot,
      };

      setPlacedParts(prev => [...prev, newPlacedPart]);

      if (evt.intersectedPartName) {
        // Add smart mates! Coincident and Concentric
        const newMates = [
          {
            id: `mate_coincident_${Date.now()}`,
            type: 'coincident' as const,
            partA: evt.intersectedPartName,
            partB: newPlacedPartId, // partB is the standard part
            locked: false,
          },
          {
            id: `mate_concentric_${Date.now() + 1}`,
            type: 'concentric' as const,
            partA: evt.intersectedPartName,
            partB: newPlacedPartId,
            locked: false,
          }
        ];
        setAssemblyMates(prev => [...prev, ...newMates]);
        addToast('success', lang === 'ko' ? `규격 부품 배치 및 자동 메이트 체결 완료` : `Standard part placed with smart mates`);
      } else {
        addToast('success', lang === 'ko' ? `규격 부품 배치 완료` : `Standard part placed`);
      }
    });
  }, [setPlacedParts, setAssemblyMates, addToast, lang]);

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
      const sz = bb.getSize(new Vector3());
      setImportedGeometry(geometry);
      setImportedFilename(filename);
      setSketchResult({ geometry, edgeGeometry: edgeGeo, volume_cm3: vol, surface_area_cm2: sa, bbox: { w: Math.round(sz.x), h: Math.round(sz.y), d: Math.round(sz.z) } });
      setIsSketchMode(false);
      setViewMode('workspace');
      // Save to recent files
      upsertRecentImportFile({ name: filename, ext, size: file.size, date: Date.now() });
      addToast('success', `"${filename}" loaded`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      // #9: provide retry action — re-trigger the browser file picker
      addToast(
        'error',
        lt.importFailed(errMsg),
        8000,
        {
          label: lt.retryLabel,
          onClick: () => handleImportFile() },
      );
    } finally {
      setIsImporting(false);
    }
  }, [addToast, setImportedGeometry, setImportedFilename, setSketchResult, setIsSketchMode, setViewMode, lang, handleImportFile]);

  // MERGE BOM PARTS for Preview (must run before any early return — hooks order)
  const effectiveBomParts = useMemo(() => {
    let combined: typeof bomParts = [];
    if (bodyBomParts && bodyBomParts.length > 0) combined = [...bodyBomParts];
    else if (bomParts && bomParts.length > 0) combined = [...bomParts];

    // `bomParts` is already `placedPartsToBomResults(placedParts)` when assembly-only — do not append again.
    if (placedParts && placedParts.length > 0 && bodyBomParts && bodyBomParts.length > 0) {
      combined = [...combined, ...placedPartsToBomResults(placedParts)];
    }
    return combined.length > 0 ? combined : undefined;
  }, [bodyBomParts, bomParts, placedParts]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — MOBILE GATE (phone users → dedicated landing)
  // ══════════════════════════════════════════════════════════════════════════

  if (isMobile) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#0d1117', color: '#e6edf3',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 20px 40px' }}>
        {/* Logo */}
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 32, alignSelf: 'flex-start' }}>
          <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
        </div>

        {/* Hero icon */}
        <div style={{ fontSize: 64, marginBottom: 20 }}>🖥️</div>

        {/* Title */}
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px', textAlign: 'center', lineHeight: 1.3 }}>
          {lt.designOn3dPc}
        </h1>
        <p style={{ fontSize: 14, color: '#8b949e', textAlign: 'center', lineHeight: 1.7, margin: '0 0 32px', maxWidth: 280 }}>
          {lt.mobileHint}
        </p>

        <div
          role="region"
          aria-label={lt.mobileShareViewTitle}
          style={{
            width: '100%', maxWidth: 320, marginBottom: 24, padding: '14px 16px',
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', marginBottom: 8 }}>
            {lt.mobileShareViewTitle}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.65 }}>
            {lt.mobileShareViewBody}
          </p>
        </div>

        {/* Mobile-friendly actions */}
        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <a href={`/${lang}/nexyfab`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: '#e6edf3' }}>
            <span style={{ fontSize: 24 }}>📊</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.dashboard}</div>
              <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>{lt.checkProjects}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: '#484f58' }}>›</span>
          </a>

          <a href={`/${lang}/nexyfab/marketplace`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: '#e6edf3' }}>
            <span style={{ fontSize: 24 }}>🏭</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.marketplace}</div>
              <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>{lt.browseMfrs}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: '#484f58' }}>›</span>
          </a>

          <a href={`/${lang}/nexyfab/orders`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: '#e6edf3' }}>
            <span style={{ fontSize: 24 }}>📦</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.orderTracking}</div>
              <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>{lt.trackMfgProgress}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: '#484f58' }}>›</span>
          </a>

          <a href={`/${lang}/nexyfab/rfq`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: '#e6edf3' }}>
            <span style={{ fontSize: 24 }}>📋</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.rfqQuotes}</div>
              <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>{lt.manageQuotes}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: '#484f58' }}>›</span>
          </a>
        </div>

        {/* Desktop hint */}
        <p style={{ fontSize: 12, color: '#484f58', textAlign: 'center', marginTop: 32, lineHeight: 1.6 }}>
          {lt.desktopHint}
        </p>
      </div>
    );
  }

  const renderWorkspaceShapePreview = (previewKey: string) => (
    <ShapePreview
                    key={previewKey}
                    isSketchMode={isSketchMode}
                    result={viewportShapeResult}
                    bomParts={effectiveBomParts}
                    assemblyLabel={bomLabel || undefined}
                    assemblyMates={assemblyMates}
                    isKinematicsMode={assemblyMates.length > 0 || (placedParts?.length ?? 0) > 0}
                    onCapture={(cb) => {
                      captureRef.current = cb;
                      const canvasEl = document.querySelector(
                        `canvas[data-engine="${NF_R3F_VIEWPORT_DATA_ENGINE}"]`,
                      ) as HTMLCanvasElement | null;
                      if (canvasEl) {
                        renderCanvasRef.current = canvasEl;
                        canvasRef.current = canvasEl;
                      }
                    }}
                    editMode={editMode}
                    onDragStateChange={setIsDragging}
                    showDimensions={showDimensions}
                    measureActive={measureActive}
                    onStandardPartDrop={handleStandardPartDrop}
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
                    onMaterialDrop={setMaterialId}
                    onRadialCommand={(cmd) => {
                      if (cmd === 'sketch_start') { setIsSketchMode(true); setSketchResult(null); setEditMode('none'); }
                      else if (cmd === 'sketch_finish') { handleSketchGenerate(); }
                      else if (cmd === 'cancel') { setIsSketchMode(false); setEditMode('none'); }
                      else if (cmd === 'extrude') {
                        if (isSketchMode) handleSketchGenerate();
                        else { setIsSketchMode(true); setSketchResult(null); setEditMode('none'); }
                      }
                      else if (cmd === 'sketch_line') { setIsSketchMode(true); setSketchTool('line'); }
                      else if (cmd === 'sketch_rect') { setIsSketchMode(true); setSketchTool('rect'); }
                      else if (cmd === 'sketch_circle') { setIsSketchMode(true); setSketchTool('circle'); }
                      else if (cmd === 'fillet') { setEditMode('face'); }
                    }}
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
                    feaConditions={showFEA && !feaResult ? feaConditions : undefined}
                    feaHighlightedConditionIdx={feaHighlightedConditionIdx}
                    onFEAConditionClick={setFeaHighlightedConditionIdx}
                    showDFM={showDFM && !simpleMode}
                    dfmResults={dfmResults}
                    dfmHighlightedIssue={dfmHighlightedIssue}
                    showDraftAnalysis={showDraftAnalysis && !simpleMode}
                    draftResult={draftResult}
                    draftMinDeg={draftMinDeg}
                    showCenterOfMass={showCenterOfMass}
                    gdtAnnotations={gdtAnnotations.length > 0 ? gdtAnnotations : undefined}
                    dimensionAnnotations={dimensionAnnotations.length > 0 ? dimensionAnnotations : undefined}
                    onSceneReady={(scene) => { sceneRef.current = scene; }}
                    onCameraPlaneChange={isSketchMode ? setSketchPlaneRaw : undefined}
                    sketchPlane={isSketchMode ? (sketchPlane as 'xy' | 'xz' | 'yz') : undefined}
                    onSketchPlaneChange={isSketchMode ? setSketchPlane : undefined}
                    onGeometryApply={handleGeometryApply}
                    faceEditViewportCallout={lt.faceEditViewportCallout}
                    faceEditViewportCalloutTitle={lt.faceEditViewportCalloutTitle}
                    faceEditViewportCalloutTip={lt.faceEditViewportCalloutTip}
                    faceEditCalloutDismiss={lt.faceEditCalloutDismiss}
                    lang={lang}
                    arrayPattern={arrayPattern}
                    showArray={showArrayPanel && !!arrayPattern && !simpleMode}
                    onOpenLibrary={() => setShowLibrary(true)}
                    onStartSketch={() => setIsSketchMode(true)}
                    onOpenChat={() => openAIAssistant('chat')}
                    pinComments={comments}
                    isPlacingComment={isPlacingComment}
                    focusedPinCommentId={focusedCommentId}
                    onAddPinComment={(pos, text, type) => addComment(pos, text, authUser?.name ?? 'Guest', type ?? 'comment', collabUserColorRef.current)}
                    onResolvePinComment={(id) => { resolveComment(id); addActivity({ type: 'comment_resolve', actor: authUser?.name ?? 'You' }); }}
                    onDeletePinComment={(id) => { deleteComment(id); addActivity({ type: 'comment_delete', actor: authUser?.name ?? 'You' }); }}
                    onReactPinComment={(id, emoji) => reactToComment(id, emoji, collabUserIdRef.current)}
                    onReplyPinComment={(id, text) => addReply(id, text, authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`, collabUserColorRef.current)}
                    pinCommentRoomUsers={collabUsers.map(u => ({ id: u.id, name: u.name, color: u.color }))}
                    pinCommentCurrentUserId={collabUserIdRef.current}
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
                    nurbsCPEdit={(() => {
                      const sel = selectedFeatureId ? features.find(f => f.id === selectedFeatureId) : null;
                      return !!(sel && sel.type === 'nurbsSurface' && sel.enabled);
                    })()}
                    nurbsCPParams={(() => {
                      const sel = selectedFeatureId ? features.find(f => f.id === selectedFeatureId) : null;
                      return sel?.type === 'nurbsSurface' ? sel.params : undefined;
                    })()}
                    onNurbsCPParamChange={(key, value) => {
                      if (selectedFeatureId) updateFeatureParam(selectedFeatureId, key, value);
                    }}
                    selectionActive={selectionActive}
                    onToggleSelection={() => {
                      setSelectionActive(v => !v);
                      if (selectionActive) setSelectedElement(null);
                    }}
                    onElementSelect={(info) => {
                      if (mateFaceA && info.type === 'face') {
                        // Create mate!
                        const faceB = info as import('./editing/selectionInfo').FaceSelectionInfo;
                        if (mateFaceA.partName && faceB.partName && mateFaceA.partName !== faceB.partName) {
                          const newMate: import('./assembly/AssemblyMates').AssemblyMate = {
                            id: generateMateId(),
                            type: 'coincident',
                            partA: mateFaceA.partName,
                            partB: faceB.partName,
                            faceA: mateFaceA.triangleIndices[0],
                            faceB: faceB.triangleIndices[0],
                            locked: false,
                          };
                          setAssemblyMates(prev => [...prev, newMate]);
                          setShowAssemblyPanel(true);
                          addToast('success', lt.mateAdded?.(lt.mateCoincident ?? 'Coincident', mateFaceA.partName, faceB.partName) ?? `Added Mate between ${mateFaceA.partName} and ${faceB.partName}`);
                        } else {
                          addToast('error', 'Select faces on different parts to create a mate.');
                        }
                        setMateFaceA(null);
                        setSelectedElement(null);
                        setSelectionActive(false);
                      } else {
                        setSelectedElement(info);
                      }
                    }}
                    highlightTriangles={
                      mateFaceA?.triangleIndices || (selectedElement?.type === 'face'
                        ? (selectedElement as import('./editing/selectionInfo').FaceSelectionInfo).triangleIndices
                        : undefined)
                    }
                    onFileImport={async (file) => {
                      try {
                        const { prepareImportedShapeFromFile, pushRecentImportFile } = await import('./io/importMeshPipeline');
                        const prepared = await prepareImportedShapeFromFile(file);
                        const ext = prepared.filename.split('.').pop()?.toLowerCase() ?? '';
                        setImportedGeometry(prepared.geometry);
                        setSketchResult({
                          geometry: prepared.geometry,
                          edgeGeometry: prepared.edgeGeometry,
                          volume_cm3: prepared.volume_cm3,
                          surface_area_cm2: prepared.surface_area_cm2,
                          bbox: prepared.bbox,
                        });
                        
                        if (prepared.parts && prepared.parts.length > 1) {
                          const { makeEdges, meshVolume, meshSurfaceArea } = await import('./shapes');
                          const bomResults = prepared.parts.map(p => {
                            const pGeo = p.geometry;
                            const pEdge = makeEdges(pGeo);
                            pGeo.computeBoundingBox();
                            const pBb = pGeo.boundingBox;
                            const pSize = pBb ? new Vector3() : null;
                            if (pBb && pSize) pBb.getSize(pSize);
                            const pBbox = pSize ? { w: Math.round(pSize.x), h: Math.round(pSize.y), d: Math.round(pSize.z) } : { w: 0, h: 0, d: 0 };
                            return {
                              name: p.name,
                              result: { geometry: pGeo, edgeGeometry: pEdge, volume_cm3: meshVolume(pGeo) / 1000, surface_area_cm2: meshSurfaceArea(pGeo) / 100, bbox: pBbox }
                            };
                          });
                          setBomParts(bomResults);
                          setBomLabel(prepared.filename);
                        } else {
                          setBomParts([]); setBomLabel('');
                        }
                        
                        setIsSketchMode(false);
                        pushRecentImportFile(prepared.filename, ext, file.size);
                        addToast('success', lt.importedFile(prepared.filename));
                      } catch (err) {
                        addToast('error', lt.importFailedFile(err instanceof Error ? err.message : String(err)));
                      }
                    }}
                    blockAutomaticGeometryFit={viewportGeometryFitSuppressed}
                    projectCameraToApply={projectCameraToApply}
                    onProjectCameraApplied={handleProjectCameraApplied}
                    onViewportCameraCommit={handleViewportCameraCommit}
                    onGeometryFitRequest={handleGeometryFitRequest}
                  />
  );

  // RENDER — WORKSPACE VIEW
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div
      data-testid="shape-generator-workspace"
      style={{ height: '100dvh', background: theme.bg, display: 'flex', flexDirection: 'column', userSelect: 'none', WebkitUserSelect: 'none', overflow: 'hidden' }}
      onDragStart={e => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>

      <FullscreenAutoHide active={isFullscreen} />

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
        onReplayWelcome={handleReplayDesktopWelcome}
      />

      {viewMode === 'workspace' && (
        <PdmMetaWorkspaceStrip isKo={lang === 'ko'} onFieldsEdited={markNfabDirty} />
      )}

      {showDesktopFirstRun ? (
        <DesktopFirstRunWizard lang={lang} onClose={() => setShowDesktopFirstRun(false)} />
      ) : null}

      {/* ════ Drag & Drop Overlay ════ */}
      {isDragOver && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(59,130,246,0.12)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '3px dashed #3b82f6', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{lt.dropFileHere}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>STEP · STL · OBJ · PLY · IGES · DXF · BREP</div>
          </div>
        </div>
      )}

      {/* ════ Import Loading Overlay ════ */}
      {isImporting && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(13,17,23,0.85)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: '#e6edf3' }}>
            <div style={{ width: 40, height: 40, border: '3px solid #30363d', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>{lt.loadingFile}</div>
          </div>
        </div>
      )}
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
          animation: 'nf-slide-up 0.3s ease-out' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9', marginBottom: 2 }}>
              {lt.smallScreenDetected}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>
              {lt.smallScreenHint}
            </div>
          </div>
          <button
            onClick={() => dismissFullscreenPrompt(true)}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              flexShrink: 0 }}
          >
            {lt.goFullscreen}
          </button>
          <button
            onClick={() => dismissFullscreenPrompt(false)}
            style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid #30363d',
              color: '#6e7681', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              flexShrink: 0 }}
          >
            {lt.noThanks}
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
        isSketchMode={isSketchMode}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onHistoryUndo={handleHistoryUndo}
        onHistoryRedo={handleHistoryRedo}
        showVersionPanel={showVersionPanel}
        setShowVersionPanel={setShowVersionPanel}
        renderMode={renderMode}
        setRenderMode={(mode) => {
          if (mode === 'photorealistic' && renderMode !== 'photorealistic') {
            requirePhotoReal(() => setRenderMode('photorealistic'));
          } else {
            setRenderMode(mode);
          }
        }}
        showCOTSPanel={showCOTSPanel}
        setShowCOTSPanel={setShowCOTSPanel}
        effectiveResult={!!effectiveResult}
        showAIAdvisor={showAIAssistant && useUIStore.getState().aiAssistantTab === 'suggestions'}
        setShowAIAdvisor={() => openAIAssistant('suggestions')}
        isPlacingComment={isPlacingComment}
        setIsPlacingComment={setIsPlacingComment}
        showCommentsPanel={showCommentsPanel}
        setShowCommentsPanel={setShowCommentsPanel}
        commentCount={comments.length}
        showDimensions={showDimensions}
        setShowDimensions={setShowDimensions}
        planLimits={planLimits}
        pollingSessions={pollingSessions}
        mySessionId={mySessionId}
        designCollabDemo={collabDemo}
        onToggleDesignCollabDemo={() => setCollabDemo(!collabDemo)}
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
        tGetQuote={shapeLabels.getQuote ?? 'Get Quote'}
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
        dfmIssueCount={dfmBadgeCount}
        dfmRunning={dfmBadgeRunning}
        showDFM={showDFM}
        onToggleDFM={() => setShowDFM(!showDFM)}
        onStepGeometryDirect={(stats) => {
          if (!stats.geometry) return;
          import('./shapes').then(({ makeEdges, meshVolume, meshSurfaceArea }) => {
            const geometry = stats.geometry!;
            const edgeGeometry = makeEdges(geometry);
            const volume_cm3 = meshVolume(geometry) / 1000;
            const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
            geometry.computeBoundingBox();
            const bb = geometry.boundingBox;
            const size = bb ? new Vector3() : null;
            if (bb && size) bb.getSize(size);
            const bbox = size ? { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } : { w: 0, h: 0, d: 0 };
            setSketchResult({ geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
            
            if (stats.partsGeo && stats.partsGeo.length > 1) {
              const bomResults = stats.partsGeo.map(p => {
                const pGeo = p.geometry;
                const pEdge = makeEdges(pGeo);
                pGeo.computeBoundingBox();
                const pBb = pGeo.boundingBox;
                const pSize = pBb ? new Vector3() : null;
                if (pBb && pSize) pBb.getSize(pSize);
                const pBbox = pSize ? { w: Math.round(pSize.x), h: Math.round(pSize.y), d: Math.round(pSize.z) } : { w: 0, h: 0, d: 0 };
                return {
                  name: p.name,
                  result: { geometry: pGeo, edgeGeometry: pEdge, volume_cm3: meshVolume(pGeo) / 1000, surface_area_cm2: meshSurfaceArea(pGeo) / 100, bbox: pBbox }
                };
              });
              setBomParts(bomResults);
              setBomLabel('Assembly');
            } else {
              setBomParts([]); setBomLabel('');
            }
            
            setIsSketchMode(false);
            addToast('success', lt.stepLoadedIntoViewport);
          });
        }}
        layoutControls={{
          leftCollapsed: sidebarLayout.leftCollapsed,
          rightCollapsed: sidebarLayout.rightCollapsed,
          swapSides: sidebarLayout.swapSides,
          overlayPref: sidebarLayout.overlayPref,
          onToggleLeft: sidebarLayout.toggleLeftCollapsed,
          onToggleRight: sidebarLayout.toggleRightCollapsed,
          onToggleSwap: sidebarLayout.toggleSwapSides,
          onCycleOverlay: sidebarLayout.cycleOverlayPref }}
      />

      {/* ════════ FUNNEL STEP BAR ════════ */}
      {viewMode === 'workspace' && !isMobile && (
        <DesignFunnelBar
          lang={lang}
          sketchMode={isSketchMode && activeTab === 'design'}
          statusGuide={statusGuide}
          hasGeometry={!!effectiveResult}
          dfmChecked={dfmResults !== null || dfmWarnings.status !== 'ok'}
          dfmClean={dfmBadgeCount === 0}
          dfmIssueCount={dfmBadgeCount}
          rfqDone={rfqDone}
          onGoToDFM={() => setShowDFM(true)}
          onGoToQuote={() => setShowQuoteWizard(true)}
          onProcessRouter={() => {
            const gate = checkFreemium('process_router');
            if (!gate.allowed) { setShowProcessRouterUpgrade(true); return; }
            setShowProcessRouter(true);
          }}
          onAISupplierMatch={() => {
            const gate = checkFreemium('ai_supplier_match');
            if (!gate.allowed) { setShowAISupplierMatchUpgrade(true); return; }
            setShowAISupplierMatch(true);
          }}
          onCostCopilot={() => {
            const gate = checkFreemium('cost_copilot');
            if (!gate.allowed) { setShowCostCopilotUpgrade(true); return; }
            setShowCostCopilot(true);
          }}
          onAIHistory={() => setShowAIHistory(true)}
          onOpenScad={() => setShowOpenScad(true)}
          onIdeaDesign={() => setShowIntakeWizard(true)}
          selectionActive={selectionActive}
          onToggleSelection={() => {
            setSelectionActive(v => !v);
            if (selectionActive) setSelectedElement(null);
          }}
          theme={theme}
        />
      )}

      {/* ════════ IDEA → DESIGN WIZARD (L1 Intake) ════════ */}
      {showIntakeWizard && (
        <IntakeWizard
          onCancel={() => setShowIntakeWizard(false)}
          onComplete={async (spec: IntakeSpec) => {
            setShowIntakeWizard(false);
            setComposeResult(null);
            setComposeSpec(spec);
            const data = await runCompose(spec);
            if (data) setComposeResult(data);
            else setComposeSpec(null);
          }}
        />
      )}

      {/* compose 결과 리뷰 패널 */}
      {composeResult && composeSpec && !composing && (
        <ComposeResultPanel
          spec={composeSpec}
          result={composeResult}
          onClose={() => {
            setComposeResult(null);
            setComposeSpec(null);
          }}
          onRetry={() => {
            setComposeResult(null);
            setShowIntakeWizard(true);
          }}
          onApply={(code, label) => {
            try {
              sessionStorage.setItem('nexyfab:pendingJscadCode', code);
              sessionStorage.setItem('nexyfab:pendingJscadSource', lt.ideaDesignSource(label));
            } catch {}

            // funnel 합류: 추천 재료 → 시각화/FEA preset 으로 주입
            const presetId = composeResult ? mapToPresetId(composeResult.materialId) : undefined;
            if (presetId) {
              setMaterialId(presetId);
            }

            // 비용 안내 + 다음 단계(견적) 유도 토스트
            const cost = composeResult?.estimate?.unitCostUsd;
            const lead = composeResult?.estimate?.leadTimeDays;
            const summaryParts: string[] = [];
            if (cost != null) summaryParts.push(lt.unitCostHint(cost));
            if (lead) summaryParts.push(lt.leadTimeHint(lead[0], lead[1]));
            const summary = summaryParts.join(' · ');

            addToast(
              'success',
              lt.designApplied(summary),
              10000,
              {
                label: lt.getQuoteArrow,
                onClick: () => setShowQuoteWizard(true) }
            );

            setComposeResult(null);
            setComposeSpec(null);
            setShowOpenScad(true);
          }}
          onSwap={async (force) => {
            if (!composeSpec) return;
            const data = await runCompose(composeSpec, force);
            if (data) setComposeResult(data);
          }}
        />
      )}

      {/* compose 진행 인디케이터 */}
      {composing && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{
            background: '#0f172a', padding: '28px 40px', borderRadius: 12,
            border: '1px solid #334155', color: '#f1f5f9',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 32 }}>⚙️</div>
            <div style={{ fontWeight: 600 }}>
              {composeResult ? lt.composeRefining : lt.composeSearching}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{lt.composeSubtitle}</div>
          </div>
        </div>
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
          borderBottom: '1px solid #1f6feb', flexShrink: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'genSpin 2s linear infinite', boxShadow: '0 0 8px #f59e0b' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
            {lt.aiPreviewMode}
          </span>
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {lt.aiPreviewHint}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={handleCancelPreview} style={{
            padding: '3px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#21262d',
            color: '#f85149', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#3d1519'; e.currentTarget.style.borderColor = '#f85149'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#30363d'; }}
          >
            {lt.cancelLabel} (Esc)
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
          flexShrink: 0 }}>
          {lt.viewerOnlyMode}
        </div>
      )}

      {!isReadOnly && (
        <SimpleModeOfferBanner
          simpleMode={simpleMode}
          onEnableSimpleMode={enableSimpleMode}
          labels={{
            title: lt.simpleModeOfferTitle,
            desc: lt.simpleModeOfferDesc,
            enable: lt.simpleModeOfferEnable,
            dismiss: lt.simpleModeOfferDismiss,
            regionLabel: lt.simpleModeOfferRegion,
          }}
        />
      )}



      {/* ════════ MAIN AREA ════════ */}
      <div style={{
        flex: 1, display: 'flex',
        flexDirection: sidebarLayout.swapSides ? 'row-reverse' : 'row',
        overflow: 'hidden', minHeight: 0, position: 'relative' }}>

        {/* ══════ LEFT PANEL — hidden on mobile, collapsible on tablet ══════ */}
        {!isReadOnly && <ErrorBoundary><LeftPanel
          lang={lang}
          t={shapeLabels}
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
          ensureExpanded={ensureExpanded}
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
          constraints={sketchConstraints}
          dimensions={sketchDimensions}
          onAddConstraint={handleAddConstraint}
          onRemoveConstraint={handleRemoveConstraint}
          onDimensionChange={handleDimensionChange}
          onRemoveDimension={handleRemoveDimension}
          selectedConstraintType={selectedConstraintType}
          onConstraintTypeChange={setSelectedConstraintType}
          autoSolve={autoSolve}
          onAutoSolveChange={setAutoSolve}
          onSolveConstraints={handleSolveConstraints}
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
          unitSystem={unitSystem}
          onSelectFeatureFromTree={setSelectedFeatureId}
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
          onHighResCapture={() => {
            const canvas = renderCanvasRef.current;
            if (!canvas) return;
            const scale = Math.min(4, Math.floor(4096 / Math.max(canvas.width, canvas.height)));
            const w = canvas.width * scale;
            const h = canvas.height * scale;
            const off = document.createElement('canvas');
            off.width = w; off.height = h;
            const ctx = off.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(canvas, 0, 0, w, h);
            const a = document.createElement('a');
            a.href = off.toDataURL('image/png');
            a.download = `nexyfab-4k-${Date.now()}.png`;
            a.click();
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
          layoutWidth={sidebarLayout.leftWidth}
          collapsed={sidebarLayout.leftCollapsed}
          overlay={sidebarLayout.overlay}
          side={sidebarLayout.swapSides ? 'right' : 'left'}
          onToggleCollapse={sidebarLayout.toggleLeftCollapsed}
          onResize={sidebarLayout.setLeftWidth}
          sketchSliceLinked={sketchPalSlice && sectionActive}
          configurationsList={configurations.map(c => ({ id: c.id, name: c.name }))}
          activeConfigurationId={activeConfigurationId}
          onConfigurationSelect={handleConfigurationSelect}
          onConfigurationAdd={handleConfigurationAdd}
          onConfigurationRename={handleConfigurationRename}
          onConfigurationDelete={handleConfigurationDelete}
        /></ErrorBoundary>}

        {/* ══════ CENTER — CommandManager + Viewport + StatusBar ══════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

          {/* CommandManager toolbar — hidden in readonly mode */}
          {!isReadOnly && <div data-tour="command-toolbar">
          <CommandToolbar
            activeTab={activeTab} isSketchMode={isSketchMode} editMode={editMode}
            hasResult={!!effectiveResult}
            onSketchMode={(on) => { setIsSketchMode(on); if (on && !isSketchMode) { setSketchResult(null); setEditMode('none'); } else if (!on) { setEditMode('none'); } }}
            onFinishSketch={handleSketchGenerate}
            onCancelSketch={() => setIsSketchMode(false)}
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
            onSketchInsertReference={() => sketchRefInputRef.current?.click()}
            onAddFeatureWithParams={addFeatureWithParamsAndContext}
            fileImportMenuHint={lt.importFileMenuHint}
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
            lockedFormats={(['step','gltf','obj','dxf','ply','rhino','grasshopper'] as const).filter(f => !planLimits.exportFormats.includes(f))}
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
            dfmIssueCount={dfmBadgeCount}
            onViewAR={() => setShowARViewer(true)}
            onViewFeatureGraph={() => setShowFeatureGraph(true)}
            onViewNesting={() => setShowNestingTool(true)}
            onViewVariants={() => setShowVariantsPanel(true)}
            onViewUserParts={() => setShowUserPartsPanel(true)}
            onViewTimelapse={() => setShowSessionTimelapse(true)}
            onViewStockOptimizer={() => setShowStockOptimizer(true)}
            onViewThreadHole={() => setShowThreadHolePanel(true)}
            onHoleWizard={() => setShowHoleWizard(true)}
            t={shapeLabels}
            lang={lang}
            onCycleSketchPickFilter={isSketchMode ? cycleSketchPickFilter : undefined}
            sketchPickFilterHint={isSketchMode ? sketchPickFilterHint : undefined}
          />
          </div>}

          {/* ── Workspace switcher + Breadcrumb ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', minWidth: 0 }}>
            <CadWorkspaceSwitcher
              lang={lang}
              isSketchMode={isSketchMode}
              readOnly={isReadOnly}
              selectAriaLabel={lt.cadWorkspaceSelectAria}
              onOptimizeBlockedBySketch={() => addToast('warning', lt.exitSketchBeforeOptimize)}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <BreadcrumbNav items={(() => {
                const _bc: Record<string, Record<string, string>> = {
                  ko: { design: '설계', optimize: '최적화', sketch: '스케치', profile: '프로파일', edit: '편집' },
                  en: { design: 'Design', optimize: 'Optimize', sketch: 'Sketch', profile: 'Profile', edit: 'Edit' },
                  ja: { design: '設計', optimize: '最適化', sketch: 'スケッチ', profile: 'プロファイル', edit: '編集' },
                  cn: { design: '设计', optimize: '优化', sketch: '草图', profile: '轮廓', edit: '编辑' },
                  es: { design: 'Diseño', optimize: 'Optimización', sketch: 'Boceto', profile: 'Perfil', edit: 'Editar' },
                  ar: { design: 'تصميم', optimize: 'تحسين', sketch: 'رسم', profile: 'ملف تعريف', edit: 'تحرير' } };
                const bc = (k: string) => (_bc[lang] ?? _bc.en)[k] ?? (_bc.en[k] ?? k);
                const crumbs: BreadcrumbItem[] = [
                  { label: activeTab === 'design' ? bc('design') : bc('optimize'), icon: activeTab === 'design' ? '🧊' : '🔬', onClick: () => handleSetActiveTab(activeTab) },
                ];
                if (isSketchMode) {
                  crumbs.push({ label: bc('sketch'), icon: '✏️', onClick: () => {} });
                  crumbs.push({ label: `${bc('profile')} ${activeProfileIdx + 1}`, active: true });
                } else if (editMode !== 'none') {
                  crumbs.push({ label: bc('edit'), icon: '✎' });
                  crumbs.push({ label: editMode, active: true });
                } else if (effectiveResult) {
                  const shapeName = shapeLabels[`shapeName_${selectedId}`] || selectedId;
                  crumbs.push({ label: shapeName, icon: SHAPE_ICONS[selectedId] || '⬡', active: !selectedFeatureId });
                  if (selectedFeatureId) {
                    const feat = features.find(f => f.id === selectedFeatureId);
                    if (feat) crumbs.push({ label: feat.type, active: true, onClick: () => setShowPropertyManager(true) });
                  }
                }
                return crumbs;
              })()} />
            </div>
          </div>

          {/* ── Selection Filter Bar ── */}
          {!isSketchMode && (
            <SelectionFilterBar activeFilters={selectionFilters} onToggle={toggleSelectionFilter} lang={lang} />
          )}

          {/* Plugin toolbar buttons */}
          {pluginToolbarButtons.length > 0 && activeTab === 'design' && (
            <div className="sg-autohide" style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '1px 8px', background: '#161b22', borderBottom: '1px solid #30363d', height: 22 }}>
              <span style={{ color: '#8b949e', fontSize: 9, fontWeight: 700, marginRight: 3 }}>🧩</span>
              {pluginToolbarButtons.map(btn => (
                <button
                  key={btn.id}
                  onClick={btn.onClick}
                  title={btn.tooltip || btn.label}
                  style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: '#21262d', color: '#c9d1d9',
                    display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; }}
                >
                  <span style={{ fontSize: 11 }}>{btn.icon}</span>
                  {btn.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setShowPluginManager(true)}
                style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                  border: '1px solid #30363d', cursor: 'pointer',
                  background: 'transparent', color: '#8b949e',
                  transition: 'all 0.12s', height: 18 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#c9d1d9'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
              >
                {lt.manageLabel}
              </button>
            </div>
          )}

          {/* ── Merged Context Bar (Split / DirectEdit / Transform / Collab) ── */}
          {activeTab === 'design' && !isSketchMode && (
            <div data-tour="transform-tools" className="sg-topbar sg-autohide" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 8px', background: '#0d1117', borderBottom: '1px solid #30363d', height: 24 }}>
              {/* Collab Indicator */}
              <div
                title={`${onlineCount} online`}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: '#21262d', color: '#c9d1d9', height: 18, border: onlineCount > 1 ? '1px solid rgba(63, 185, 80, 0.4)' : '1px solid transparent' }}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: onlineCount > 1 ? '#3fb950' : '#8b949e', boxShadow: onlineCount > 1 ? '0 0 4px #3fb950' : 'none' }} />
                {onlineCount} {onlineCount === 1 ? 'user' : 'users'}
              </div>
              <div style={{ width: 1, height: 14, background: '#30363d', margin: '0 2px' }} />

              {/* Split View */}
              <button
                onClick={() => setMultiView(!multiView)}
                title={multiView ? 'Single View' : 'Split View'}
                style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: multiView ? '#388bfd' : '#21262d',
                  color: multiView ? '#fff' : '#c9d1d9',
                  display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
              >
                <span style={{ fontSize: 10, fontFamily: 'monospace' }}>&#x229e;</span>
                {multiView ? 'Single' : 'Split'}
              </button>

              {/* Direct Edit */}
              {effectiveResult && !simpleMode && (
                <>
                  <div style={{ width: 1, height: 14, background: '#30363d', margin: '0 2px' }} />
                  <span style={{ color: '#8b949e', fontSize: 9, fontWeight: 700 }}>{lt.directEdit}</span>
                  {([
                    ['face', '▣', lt.faceEditMode, '#388bfd'],
                    ['vertex', '⬡', lt.vertexEditMode, '#22c55e'],
                    ['edge', '╱', lt.edgeEditMode, '#f59e0b'],
                  ] as const).map(([mode, icon, label, activeColor]) => (
                    <button
                      key={mode}
                      onClick={() => setEditMode(editMode === mode ? 'none' : mode)}
                      title={mode === 'face' ? `${label} — ${lt.doubleClickSketchFace}` : label}
                      style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        background: editMode === mode ? activeColor : '#21262d',
                        color: editMode === mode ? '#fff' : '#c9d1d9',
                        display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                    >
                      <span>{icon}</span>{label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setShowCSGPanel(true);
                      addToast('info', lt.booleanPanelOpened);
                    }}
                    title={`${lt.booleanOps} — ${lt.booleanPanelOpened}`}
                    style={{
                      padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                      border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      background: showCSGPanel ? '#8b5cf6' : '#21262d',
                      color: showCSGPanel ? '#fff' : '#c9d1d9',
                      display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                  >
                    ⊕ {lt.booleanShort}
                  </button>
                  {editMode !== 'none' && (
                    <button
                      onClick={() => setEditMode('none')}
                      title={lt.exitEdit}
                      style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, border: 'none', cursor: 'pointer', background: '#21262d', color: '#f85149', height: 18 }}
                    >
                      ✕
                    </button>
                  )}
                </>
              )}

              {/* Transform (only when not in edit mode) */}
              {editMode === 'none' && effectiveResult && (
                <>
                  <div style={{ width: 1, height: 14, background: '#30363d', margin: '0 2px' }} />
                  <span style={{ color: theme.textMuted, fontSize: 9, fontWeight: 700 }}>Transform:</span>
                  {([['translate', 'T', 'Translate (T)'], ['rotate', 'R', 'Rotate (R)'], ['scale', 'G', 'Scale (G)']] as const).map(([mode, key, title]) => (
                    <button
                      key={mode}
                      onClick={() => setTransformMode(transformMode === mode ? 'off' : mode)}
                      title={title}
                      style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        background: transformMode === mode ? '#388bfd' : '#21262d',
                        color: transformMode === mode ? '#fff' : '#c9d1d9',
                        display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                    >
                      <span style={{ fontSize: 9, fontFamily: 'monospace' }}>{key}</span>{mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                  {transformMode !== 'off' && (
                    <button
                      onClick={() => setTransformMode('off')}
                      title="Disable transform (Esc)"
                      style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                        border: 'none', cursor: 'pointer', background: '#21262d', color: '#f85149', height: 18 }}
                    >
                      ✕ Off
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {activeTab === 'design' && !isSketchMode && transformMode !== 'off' && (
            <div style={{ padding: '4px 10px', background: '#0d1117', borderBottom: '1px solid #30363d' }}>
              <TransformInputPanel
                transformMatrix={transformMatrix}
                onMatrixChange={setTransformMatrix}
                lang={lang}
              />
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
          <ErrorBoundary><div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

            {/* ── Sketch Canvas side (main workspace) ── */}
            {activeTab === 'design' && (
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
                  cursor: getToolCursor(isSketchMode, sketchTool, editMode, isDragging, measureActive) }}
                onMouseDown={(e) => { if (e.button === 2) rightMouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
                onContextMenu={handleContextMenu}
                {...touchGestureHandlers}
              >
                {/* CSG loading overlay */}
                {csgLoading && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
                    <div style={{
                      width: 32, height: 32, border: '3px solid rgba(255,255,255,0.2)',
                      borderTopColor: '#58a6ff', borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite' }} />
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

                {!isReadOnly &&
                  !effectiveResult &&
                  !isSketchMode &&
                  activeTab === 'design' &&
                  cadWorkspace !== 'design' &&
                  cadWorkspace !== 'optimize' && (
                    <WorkspaceEmptyHint
                      lang={lang}
                      workspace={cadWorkspace}
                      workspaceEmptyNeedShape={lt.workspaceEmptyNeedShape}
                      workspaceEmptyGoDesign={lt.workspaceEmptyGoDesign}
                      isSketchMode={isSketchMode}
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
                    label: shapeLabels[`param_${name}`] || name,
                    min: 0,
                    max: typeof val === 'number' ? Math.max(val * 3, 100) : 100,
                    step: 1 })) : []}
                  onParamChange={(param, value) => { if (selectedFeatureId) updateFeatureParam(selectedFeatureId, param, value); }}
                  onClose={() => setShowPropertyManager(false)}
                  onApply={() => setShowPropertyManager(false)}
                />

                {/* Sketch canvas area (flex: 1, fills remaining space) */}
                <div data-tour="sketch-canvas" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                  {sketchRefImporting && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 40,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(15,23,42,0.48)',
                        pointerEvents: 'auto',
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#e6edf3',
                        fontFamily: 'system-ui, sans-serif',
                      }}
                    >
                      {lt.sketchRefLoading}
                    </div>
                  )}
                  <div key={sketchViewMode === 'drawing' ? 'draw' : isSketchMode ? 'sketch2d' : '3d'} style={{ animation: 'fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards', width: '100%', height: '100%' }}>
                    {sketchViewMode === 'drawing' ? (
                    <DrawingView result={sketchResult || effectiveResult} unitSystem={unitSystem} partName={drawingTitlePartName || selectedId} material={materialKey} />
                  ) : isSketchMode ? (
                    sketchViewMode === '3d' ? (
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
                      onRemoveConstraint={handleRemoveConstraint}
                      onAddDimension={handleAddDimension}
                      selectedConstraintType={selectedConstraintType}
                      otherProfiles={sketchProfiles.filter((_, i) => i !== activeProfileIdx)}
                      otherProfileSketchIndices={sketchProfiles.map((_, i) => i).filter(i => i !== activeProfileIdx)}
                      onSelectSketchProfileIndex={handleSetActiveProfile}
                      onAddClosedLoopAsNewProfile={handleAddClosedLoopAsNewProfile}
                      onToolChange={setSketchTool}
                      lang={lang}
                      ellipseRx={sketchConfig.ellipseRx ?? 25}
                      ellipseRy={sketchConfig.ellipseRy ?? 15}
                      slotRadius={sketchConfig.slotRadius ?? 10}
                      filletRadius={sketchConfig.filletRadius ?? 5}
                      paletteGridVisible={sketchPalGrid}
                      onPaletteGridChange={setSketchPalGrid}
                      paletteSnapEnabled={sketchPalSnap}
                      onPaletteSnapChange={setSketchPalSnap}
                      hideFloatingControlBar
                      showConstraintOverlay={sketchPalConst}
                      showDimensionOverlay={sketchPalDims}
                      referenceImage={sketchRefImage}
                      sliceGuideActive={sketchPalSlice}
                      sliceGuidePlaneMm={sketchSlicePlaneMm}
                      sketchLineStyle={sketchLineStyle}
                      lookAtNonce={sketchLookAtNonce}
                      pickFilter={sketchPickFilter}
                    />
                  )) : null}
                  </div>

                  {isSketchMode && sketchViewMode === '2d' && (
                    <SketchPalette
                      lang={lang}
                      gridVisible={sketchPalGrid}
                      snapEnabled={sketchPalSnap}
                      showDimensions={sketchPalDims}
                      showConstraints={sketchPalConst}
                      sliceEnabled={sketchPalSlice}
                      profileHighlight={sketchPalProfile}
                      hasReferenceImage={!!sketchRefImage}
                      referenceOpacity={sketchRefImage?.opacity ?? 0.35}
                      referenceScale={sketchRefImage?.scale ?? 1}
                      referenceOffsetX={sketchRefImage?.offsetX ?? 0}
                      referenceOffsetY={sketchRefImage?.offsetY ?? 0}
                      referenceLocked={sketchRefImage?.locked ?? false}
                      slicePlaneMm={sketchSlicePlaneMm}
                      onGridChange={setSketchPalGrid}
                      onSnapChange={setSketchPalSnap}
                      onDimensionsChange={setSketchPalDims}
                      onConstraintsChange={setSketchPalConst}
                      onSliceChange={setSketchPalSlice}
                      onSlicePlaneMmChange={setSketchSlicePlaneMm}
                      onProfileHighlightChange={setSketchPalProfile}
                      onInsertReference={() => sketchRefInputRef.current?.click()}
                      onClearReference={clearSketchRef}
                      onReferenceOpacityChange={(op) => {
                        setSketchRefImage(prev => (prev ? { ...prev, opacity: op } : null));
                      }}
                      onReferenceScaleChange={(sc) => {
                        setSketchRefImage(prev => (prev ? { ...prev, scale: sc } : null));
                      }}
                      onReferenceOffsetChange={(ox, oy) => {
                        setSketchRefImage(prev => (prev ? { ...prev, offsetX: ox, offsetY: oy } : null));
                      }}
                      onReferenceLockedChange={(lk) => {
                        setSketchRefImage(prev => (prev ? { ...prev, locked: lk } : null));
                      }}
                      onFinishSketch={handleSketchGenerate}
                      onExitSketch={() => setIsSketchMode(false)}
                      onOpen3dSketch={() => setSketchViewMode('3d')}
                      lightRibbonChrome={ribbonTheme === 'lightRibbon'}
                      onLightRibbonChromeChange={(v) => setRibbonTheme(v ? 'lightRibbon' : 'dark')}
                      sketchLineStyle={sketchLineStyle}
                      onSketchLineStyleChange={setSketchLineStyle}
                      onLookAtSketch={() => setSketchLookAtNonce(n => n + 1)}
                    />
                  )}

                  {/* First-use sketch hint — shows once, then dismissed */}
                  {isSketchMode && sketchViewMode === '2d' && (
                    <SketchContextTip visible={isSketchMode} lang={lang} recoveryVisible={showRecovery && !!recoveryData} />
                  )}

                  {showMainWorkspacePreview && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 5,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                    }}>
                      {renderWorkspaceShapePreview('main')}
                    </div>
                  )}
                </div>

                {/* ── Enhanced Extrude Action Menu (shown when sketch profile is closed) ── */}
                {isSketchMode && (sketchProfiles[activeProfileIdx] ?? sketchProfile).segments.length > 0 && (sketchProfiles[activeProfileIdx] ?? sketchProfile).closed && showSketchActionMenu && (
                  <>
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
                      transition: 'opacity 0.2s, transform 0.2s' }}>
                      {/* Depth slider */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: '#8b949e', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {lt.depthMm}
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
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="3" y1="17" x2="15" y2="17"/>
                          </svg>
                          {lt.extrude}
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
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a10 10 0 1 0 10 10"/><polyline points="22 2 22 12 12 12"/>
                          </svg>
                          {lt.revolve}
                        </button>
                        <button
                          onClick={() => setShowSketchActionMenu(false)}
                          style={{
                            flex: 1,
                            padding: '10px 10px', borderRadius: 8,
                            background: '#21262d',
                            border: '1px solid #30363d', color: '#8b949e', fontSize: 12, fontWeight: 600,
                            cursor: 'pointer' }}
                        >
                          {lt.continueEditing}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Extrude hint when sketch has open (non-closed) segments */}
                {isSketchMode && (sketchProfiles[activeProfileIdx] ?? sketchProfile).segments.length > 0 && !(sketchProfiles[activeProfileIdx] ?? sketchProfile).closed && (
                  <div style={{
                    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 40 }}>
                    <span style={{
                      background: '#21262d', border: '1px solid #30363d',
                      borderRadius: 6, padding: '5px 14px', color: '#8b949e', fontSize: 11,
                      fontFamily: 'system-ui, sans-serif' }}>
                      {lt.sketchClickHint}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── 3D Preview toggle button (shown when hidden) ── */}
            {activeTab === 'design' && !isMobile && !show3DPreview && (
              <button
                onClick={() => setShow3DPreview(true)}
                title={lt.show3dPreview}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  zIndex: 30, padding: '8px 6px', borderRadius: 8,
                  background: '#21262d', border: '1px solid #30363d',
                  color: '#8b949e', fontSize: 11, cursor: 'pointer',
                  writingMode: 'vertical-rl', fontWeight: 700,
                  transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = '#c9d1d9'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#8b949e'; }}
              >
                3D ▶
              </button>
            )}

            {/* ── 3D Preview side (right panel) ── */}
            {activeTab === 'design' && show3DPreview && (
              <div style={{
                width: isMobile ? '100%' : designPreviewWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: '#0d1117',
                position: 'relative' }}>
              {!isMobile && (
                <SidebarResizer
                  edge="left"
                  width={designPreviewWidth}
                  onResize={handleDesignPreviewResize}
                />
              )}
              {/* Reserve space so floating buttons do not cover ShapePreview’s own title bar */}
              <div style={{ height: 40, flexShrink: 0 }} aria-hidden />
              {/* Top chrome: hide + assembly + part placement (single row, no overlap with ShapePreview title) */}
              <div style={{
                position: 'absolute',
                top: 8,
                left: 8,
                right: isSketchMode && liveSketchResult ? 56 : 8,
                zIndex: 30,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                pointerEvents: 'none',
              }}>
                <button
                  type="button"
                  onClick={() => setShow3DPreview(false)}
                  title={lt.hide3dPreview}
                  style={{
                    pointerEvents: 'auto',
                    padding: '3px 8px', borderRadius: 5,
                    background: 'rgba(33,38,45,0.85)', border: '1px solid #30363d',
                    color: '#6e7681', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#6e7681'; }}
                >
                  ◀ {lt.hideLabel}
                </button>
                {bomParts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowAssemblyPanel(!showAssemblyPanel)}
                    title={lt.assemblyTools}
                    style={{
                      pointerEvents: 'auto',
                      padding: '4px 10px', borderRadius: 6,
                      border: '1px solid #30363d',
                      background: showAssemblyPanel ? '#388bfd' : '#21262d',
                      color: showAssemblyPanel ? '#fff' : '#8b949e',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'system-ui, sans-serif',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lt.assemblyShort}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPartPlacement(s => !s)}
                  title={lt.partPlacement}
                  style={{
                    pointerEvents: 'auto',
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid #30363d',
                    background: showPartPlacement ? '#388bfd' : '#21262d',
                    color: showPartPlacement ? '#fff' : '#8b949e',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'system-ui, sans-serif',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {`⊞ ${lt.partsLabel}${placedParts.length > 0 ? ` (${placedParts.length})` : ''}`}
                </button>
              </div>
              {/* Live preview badge (Feature 5) */}
              {isSketchMode && liveSketchResult && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 30,
                  padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
                  color: '#22c55e', fontSize: 10, fontWeight: 700,
                  fontFamily: 'monospace', letterSpacing: '0.08em',
                  pointerEvents: 'none' }}>
                  LIVE
                </div>
              )}
                {/* Bounding box center coordinate display */}
              {(liveSketchResult ?? effectiveResult) && (() => {
                const res = liveSketchResult ?? effectiveResult!;
                return (
                  <div style={{
                    position: 'absolute', bottom: 8, left: 0, right: 0, zIndex: 20,
                    display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{
                      background: 'rgba(13,17,23,0.85)', border: '1px solid #21262d',
                      padding: '3px 12px', borderRadius: 6,
                      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                      display: 'flex', gap: 8, alignItems: 'center', color: '#484f58' }}>
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
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                {/* ═══ AI Assistant — replaces 3D viewport when active ═══ */}
                {showAIAssistant && !isMobile ? (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'rgba(13, 17, 23, 0.95)',
                    backdropFilter: 'blur(16px)',
                    animation: 'aiViewportFadeIn 0.25s ease-out',
                    overflow: 'hidden',
                  }}>
                    <AIAssistantSidebar
                      lang={lang}
                      t={shapeLabels}
                      theme={{ border: theme.border, panelBg: theme.panelBg, text: theme.text }}
                      isTablet={isTablet}
                      designContext={designContext}
                      activeTab={activeTab}
                      pendingChatMsg={pendingChatMsg}
                      isPreviewMode={isPreviewMode}
                      isSketchMode={isSketchMode}
                      effectiveResult={effectiveResult}
                      selectedId={selectedId}
                      onChatApplySingle={handleChatApplySingle}
                      onChatApplyBom={handleChatApplyBom}
                      onBomPreview={handleBomPreview}
                      onChatApplySketch={handleChatApplySketch}
                      onChatApplyOptimize={handleChatApplyOptimize}
                      onChatApplyModify={handleChatApplyModify}
                      onModifyAutoApplied={handleModifyAutoApplied}
                      chatHistory={chatHistory}
                      onChatHistoryChange={setChatHistory}
                      onAiPreview={handleAiPreview}
                      onCancelPreview={handleCancelPreview}
                      advisorShape={selectedId ?? ''}
                      advisorParams={params}
                      advisorMaterial={materialId}
                      onApplyDimension={(param, value) => setParam(param, value)}
                      dfmResults={dfmResults}
                      materialId={materialId}
                      onTextToCAD={handleTextToCAD}
                      layoutWidth={undefined}
                      overlay={false}
                      side={'right'}
                    />
                    <style>{`
                      @keyframes aiViewportFadeIn {
                        from { opacity: 0; transform: scale(0.98); }
                        to { opacity: 1; transform: scale(1); }
                      }
                    `}</style>
                  </div>
                ) : !webglSupported ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flex: 1, minHeight: 0, background: '#0d1117', color: '#e6edf3',
                    flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center' }}>
                    <div style={{ fontSize: 48 }}>⚠️</div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>WebGL Not Supported</h3>
                    <p style={{ margin: 0, fontSize: 14, color: '#8b949e', maxWidth: 400 }}>
                      Your browser does not support WebGL, which is required for the 3D modeler.
                      Please try Chrome, Firefox, or Edge with hardware acceleration enabled.
                    </p>
                  </div>
                ) : multiView ? (
                  <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                    <MultiViewport
                      result={effectiveResult}
                      bomParts={bomParts.length > 0 ? bomParts : undefined}
                      sectionActive={sectionActive}
                      sectionAxis={sectionAxis}
                      sectionOffset={sectionOffset}
                      snapGrid={snapEnabled ? snapSize : undefined}
                      explodeFactor={explodeFactor}
                    />
                  </div>
                ) : showMainWorkspacePreview ? (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 24,
                    color: '#8b949e',
                    fontSize: 13,
                    textAlign: 'center',
                    lineHeight: 1.5,
                  }}>
                    {lt.viewportPreviewInMain}
                  </div>
                ) : renderWorkspaceShapePreview('right')}
                </div>
                {/* Face/Edge Selection Info Badge */}
                <SelectionInfoBadge
                  info={selectedElement}
                  onClose={() => { setSelectedElement(null); setSelectionActive(false); }}
                  onSendToChat={(info, actionHint) => {
                    if (actionHint === 'mate_start' && info.type === 'face') {
                      setMateFaceA(info as import('./editing/selectionInfo').FaceSelectionInfo);
                      addToast('info', 'Select a second face on a different part to create a mate.');
                      setSelectedElement(null);
                      return;
                    }
                    const baseMsg =
                      info.type === 'face'
                        ? lt.selectedFaceMsg(
                            info.normalLabel,
                            info.area.toFixed(1),
                            info.normal.map((n: number) => n.toFixed(2)).join(', '),
                          )
                        : lt.selectedEdgeMsg(
                            info.length?.toFixed(1) ?? '?',
                            info.position.map(p => p.toFixed(1)).join(', '),
                          );
                    const msg = actionHint ? `${baseMsg} ${actionHint}` : `${baseMsg} ${lt.useThisFaceAsBase}`;
                    setPendingChatMsg(msg);
                    openAIAssistant('chat');
                    setSelectedElement(null);
                    setSelectionActive(false);
                  }}
                />
                {/* In-Viewport Dimension Gizmo */}
                <InViewportGizmo
                  shapeId={selectedId}
                  params={params}
                  paramDefs={selectedId ? (SHAPE_MAP[selectedId]?.params ?? []) : []}
                  labelDict={t as unknown as Record<string, string>}
                  onParamChange={_handleParamChangeCmd}
                  visible={!!effectiveResult && !isSketchMode}
                />
                {/* Dimension Lines Overlay */}
                <DimensionLinesOverlay
                  bbox={effectiveResult?.bbox ?? null}
                  visible={!!effectiveResult && !isSketchMode}
                  lang={lang}
                />
                {/* DFM Warning Badges */}
                <DFMWarningBadges
                  dfmResults={dfmResults as any}
                  visible={!!effectiveResult && !isSketchMode}
                  lang={lang}
                />
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
                    onOptimize={() => handleSetActiveTab('optimize')}
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
                {!isReadOnly && !resultMesh && (
                  <div
                    role="status"
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      right: 8,
                      zIndex: 30,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(22,27,34,0.94)',
                      border: '1px solid #30363d',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#c9d1d9',
                      lineHeight: 1.45,
                      pointerEvents: 'none',
                    }}
                  >
                    💡 {lt.optimizeEmptyNeedMesh}
                  </div>
                )}
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
          </div></ErrorBoundary>

          {/* Floating Property Dialog for Parameters */}
          {(() => {
            if (!featureHistory.editingNodeId) return null;
            const editingNode = featureHistory.nodes.find(n => n.id === featureHistory.editingNodeId);
            if (!editingNode || !editingNode.featureType) return null;
            const editingDef = getFeatureDefinition(editingNode.featureType);
            if (!editingDef) return null;
            return (
              <div style={{
                position: 'absolute', top: 120, right: 24, width: 320, zIndex: 100,
                background: 'rgba(255,255,255,0.95)', border: '1px solid #d0d7de',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(10px)',
              }}>
                <div style={{ padding: '8px 12px', background: '#f6f8fa', borderBottom: '1px solid #d0d7de', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#24292f' }}>Edit {editingNode.label || editingDef.type}</span>
                  <button onClick={() => finishEditing?.()} style={{ background: 'transparent', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                <div style={{ padding: '12px', maxHeight: '60vh', overflowY: 'auto' }} className="nf-scroll">
                  <FeatureParams
                    instance={{ id: editingNode.id, type: editingNode.featureType, params: editingNode.params, enabled: editingNode.enabled, error: editingNode.error }}
                    definition={editingDef}
                    t={shapeLabels}
                    onParamChange={(id, key, value) => updateFeatureParam(id, key, value)}
                  />
                </div>
                <div style={{ padding: '8px 12px', background: '#f6f8fa', borderTop: '1px solid #d0d7de', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => finishEditing?.()} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d0d7de', background: '#ffffff', color: '#24292f', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>OK</button>
                </div>
              </div>
            );
          })()}

          {/* Timeline bar */}
          {activeTab === 'design' && features.length > 0 && (
            <TimelineBar
              features={features}
              selectedId={selectedFeatureId}
              onSelect={setSelectedFeatureId}
              onToggle={toggleFeature}
              onMoveFeature={handleMoveFeatureByIds}
              onEditFeature={(id) => {
                const f = features.find(x => x.id === id);
                if (f?.type === 'sketch') {
                  handleEditSketchFeature(id);
                } else {
                  startEditing(id);
                }
              }}
              onDeleteFeature={removeNode}
              onSuppressFeature={toggleFeature}
              baseShapeName={shapeLabels[`shapeName_${selectedId}`] || selectedId}
              baseShapeIcon={SHAPE_ICONS[selectedId] || '🧊'}
              analysisProgress={
                feaWorkerLoading ? { type: 'fea', label: 'FEA', pct: 50, running: true, onCancel: cancelFea }
                : dfmWorkerLoading ? { type: 'dfm', label: 'DFM', pct: 70, running: true, onCancel: cancelDfm }
                : csgLoading ? { type: 'cam', label: 'CSG', pct: 60, running: true, onCancel: cancelCsg }
                : pipelineWorkerLoading ? { type: 'topology', label: 'Pipeline', pct: 40, running: true, onCancel: cancelPipeline }
                : interferenceLoading || interferenceWorkerHookLoading
                  ? {
                      type: 'interference',
                      label: lt.interferenceTimelineLabel,
                      pct: 55,
                      running: true,
                      onCancel: cancelInterferenceWorker,
                    }
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
            snapSize={snapSize}
            onSnapSizeChange={setSnapSize}
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
        <ErrorBoundary><RightPanel
          lang={lang}
          t={shapeLabels}
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
          interferenceCheckPartCount={interferenceCheckPartCount}
          assemblyPlacedParts={placedParts}
          assemblySolverBomParts={placedParts.length >= 2 ? undefined : bodyBomParts}
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
          onApplyDFMFix={handleApplyDFMFix}
          onJumpToDFMFeature={handleJumpToDFMFeature}
          onExplainDFMIssue={handleExplainDFMIssue}
          onPreviewDFMCostDelta={handlePreviewDFMCostDelta}
          processRecommendations={processRecommendations}
          onDraftAnalyze={handleDraftAnalyze}
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
          onCancelInterference={cancelInterferenceWorker}
          onApplyMatesToPlacement={handleApplyMatesToPlacement}
          assemblySolverResyncNonce={assemblySolverResyncNonce}
          onGetQuote={handleGetQuote}
          onApplyArray={(pattern) => { setArrayPattern(pattern); }}
          onChatApplySingle={handleChatApplySingle}
          onChatApplyBom={handleChatApplyBom}
          onBomPreview={handleBomPreview}
          onChatApplySketch={handleChatApplySketch}
          onChatApplyOptimize={handleChatApplyOptimize}
          onChatApplyModify={handleChatApplyModify}
          onModifyAutoApplied={handleModifyAutoApplied}
          onAiPreview={handleAiPreview}
          onCancelPreview={handleCancelPreview}
          onTextToCAD={handleTextToCAD}
          chatHistory={chatHistory}
          onChatHistoryChange={setChatHistory}
          layoutWidth={sidebarLayout.rightWidth}
          collapsed={sidebarLayout.rightCollapsed}
          overlay={sidebarLayout.overlay}
          side={sidebarLayout.swapSides ? 'left' : 'right'}
          onToggleCollapse={sidebarLayout.toggleRightCollapsed}
          onResize={sidebarLayout.setRightWidth}
        /></ErrorBoundary>

      </div>

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
          addToast('success', lt.cotsAddedToBom(lang === 'ko' ? part.nameKo : part.name));
        }}
      />

      {/* Cart panel (shared) */}
      <ShapeCart items={cartItems} onRemove={removeCartItem} onClear={clearCart} onBatchQuote={handleBatchQuote} t={shapeLabels} />
      {cartItems.length > 0 && <div style={{ height: 180 }} />}

      {/* ═══ Validation Results Modal ═══ */}
      {!simpleMode && showValidation && validationResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowValidation(false)}>
          <div style={{ background: '#21262d', borderRadius: 14, padding: 24, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #30363d' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#c9d1d9' }}>
                {lt.geometryValidation}
              </h3>
              <button onClick={() => setShowValidation(false)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#8b949e' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              {[
                [lt.manifold, validationResult.isManifold ? '✅' : '❌'],
                [lt.closedMesh, validationResult.isClosed ? '✅' : '❌'],
                [lt.consistentNormals, validationResult.hasConsistentNormals ? '✅' : '❌'],
                [lt.openEdges, String(validationResult.openEdges)],
                [lt.nonManifoldEdges, String(validationResult.nonManifoldEdges)],
                [lt.degenerateTri, String(validationResult.degenerateTriangles)],
                [lt.duplicateVertices, String(validationResult.duplicateVertices)],
                [lt.totalTriangles, String(validationResult.totalTriangles)],
                [lt.totalVertices, String(validationResult.totalVertices)],
                [lt.volumeLabel, `${(validationResult.volume / 1000).toFixed(2)} cm³`],
                [lt.surfaceAreaLabel, `${(validationResult.surfaceArea / 100).toFixed(2)} cm²`],
              ].map(([label, val], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: i % 2 === 0 ? '#161b22' : '#1b1f27', borderRadius: 6 }}>
                  <span style={{ color: '#8b949e', fontWeight: 600 }}>{label}</span>
                  <span style={{ fontWeight: 700, color: '#c9d1d9' }}>{val}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: 10, background: '#0d1117', borderRadius: 8, fontSize: 11, border: '1px solid #30363d' }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#3fb950' }}>{lt.issuesLabel}</div>
              {validationResult.issues.map((issue, i) => (
                <div key={i} style={{ color: '#c9d1d9', marginBottom: 2 }}>• {issue}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Hole Wizard Modal ═══ */}
      <HoleWizardModal
        open={showHoleWizard}
        lang={lang as 'ko' | 'en'}
        onClose={() => setShowHoleWizard(false)}
        onApply={(p) => {
          addFeatureWithParams('hole', p);
          addToast('success', lt.standardHoleAdded(p.diameter.toFixed(2)));
        }}
      />

      {/* ═══ Standard Parts Library Panel ═══ */}
      {showLibrary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowLibrary(false)}>
          <div style={{ background: '#21262d', borderRadius: 14, padding: 24, maxWidth: 600, width: '90%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #30363d' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#c9d1d9' }}>
                {lt.standardPartsLibrary}
              </h3>
              <button onClick={() => setShowLibrary(false)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#8b949e' }}>✕</button>
            </div>
            {[
              { key: 'fastener', label: lt.fastenersLabel, icon: '🔩' },
              { key: 'structural', label: lt.structuralLabel, icon: '🏗️' },
              { key: 'bearing', label: lt.bearingsLabel, icon: '⊚' },
            ].map(cat => (
              <div key={cat.key} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8b949e', textTransform: 'uppercase', marginBottom: 8 }}>
                  {cat.icon} {cat.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {[
                    ...(cat.key === 'fastener' ? [
                      { id: 'hexBolt', name: lt.hexBolt, icon: '🔩', std: 'ISO 4014' },
                      { id: 'hexNut', name: lt.hexNut, icon: '⬡', std: 'ISO 4032' },
                      { id: 'socketHeadCapScrew', name: lt.socketHeadCapScrew, icon: '🔧', std: 'ISO 4762' },
                      { id: 'flatWasher', name: lt.flatWasher, icon: '⊙', std: 'ISO 7089' },
                      { id: 'springWasher', name: lt.springWasher, icon: '◎', std: 'DIN 127' },
                      { id: 'spurGear', name: 'Spur Gear', icon: '⚙', std: 'ISO 53' },
                    ] : cat.key === 'structural' ? [
                      { id: 'iBeam', name: lt.iBeam, icon: '🏗️', std: 'ISO 657' },
                      { id: 'angleBracket', name: lt.angleBracket, icon: '📐', std: 'ISO 657' },
                      { id: 'channelBeam', name: lt.channelBeam, icon: '⊏', std: 'ISO 657' },
                    ] : [
                      { id: 'ballBearing', name: lt.ballBearing, icon: '⊚', std: 'ISO 15' },
                      { id: 'bushing', name: lt.bushing, icon: '◯', std: 'ISO 3547' },
                    ]),
                  ].map(part => (
                    <button key={part.id} 
                      draggable 
                      onDragStart={e => e.dataTransfer.setData('application/vnd.nexyfab.standardpart', part.id)}
                      onClick={() => { handleSelectStandardPart(part.id); setShowLibrary(false); }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        padding: '12px 8px', borderRadius: 10,
                        border: selectedStandardPart === part.id ? '2px solid #388bfd' : '1px solid #30363d',
                        background: selectedStandardPart === part.id ? '#388bfd22' : '#161b22',
                        cursor: 'pointer', transition: 'all 0.12s' }}
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

      {/* ═══ Sketch radial marking menu ═══ */}
      <input
        ref={sketchRefInputRef}
        type="file"
        accept="image/*,.stl,.stp,.step,.dxf,model/stl,application/sla"
        style={{ display: 'none' }}
        aria-hidden
        onChange={handleSketchRefFileChange}
      />
      <SketchRadialMenu
        x={sketchRadial.x}
        y={sketchRadial.y}
        visible={sketchRadial.visible}
        items={getSketchRadialMainItems(lang)}
        innerItems={getSketchRadialInnerItems(lang)}
        linearItems={getSketchRadialLinearItems(lang)}
        onSelect={handleContextSelect}
        onClose={handleContextClose}
      />

      {/* ═══ Context Menu ═══ */}
      <ContextMenu x={ctxMenu.x} y={ctxMenu.y} visible={ctxMenu.visible}
        items={ctxMenu.items} onSelect={handleContextSelect} onClose={handleContextClose} />



      {/* ═══ WebXR AR Viewer ═══ */}
      {showARViewer && effectiveResult && (
        <ARViewer
          geometry={effectiveResult.geometry}
          color="#8b9cf4"
          lang={lang}
          onClose={() => setShowARViewer(false)}
        />
      )}

      {/* ═══ Screenshot Share Modal ═══ */}
      {screenshotModal && (
        <ScreenshotShareModal
          canvas={screenshotModal.canvas}
          shapeName={String(useSceneStore.getState().params.name ?? '')}
          isKo={lang === 'ko'}
          onClose={() => setScreenshotModal(null)}
          onDownload={() => {
            downloadScreenshot(screenshotModal.canvas, `nexyfab-render-${Date.now()}.png`, 2);
            addToast('success', lt.screenshotSaved);
          }}
        />
      )}

      {/* ═══ Feature Dependency Graph ═══ */}
      {showFeatureGraph && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowFeatureGraph(false)}>
          <div style={{ width: 640, height: 480, borderRadius: 12, overflow: 'hidden', border: '1px solid #21262d', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            <FeatureDependencyGraph
              nodes={getOrderedNodes()}
              activeNodeId={featureHistory.activeNodeId}
              onSelectNode={(id) => { rollbackTo(id); setShowFeatureGraph(false); }}
              lang={lang}
            />
          </div>
        </div>
      )}

      {/* ═══ Nesting Tool ═══ */}
      {showNestingTool && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowNestingTool(false)}>
          <div style={{ width: 800, height: 560, borderRadius: 12, overflow: 'hidden', border: '1px solid #21262d', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', position: 'relative' }}
            onClick={e => e.stopPropagation()}>
            <NestingTool lang={lang} />
          </div>
        </div>
      )}

      {/* ═══ Design Variants Panel ═══ */}
      {showVariantsPanel && (
        <DesignVariantsPanel
          lang={lang as 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar'}
          variants={designVariants}
          currentShapeId={selectedId}
          currentParams={params}
          activeVariantId={activeVariantId}
          onClose={() => setShowVariantsPanel(false)}
          captureThumbnail={() => captureRef.current?.() ?? null}
          onSaveVariant={(v) => {
            setDesignVariants(prev => [...prev, v]);
            setActiveVariantId(v.id);
            addToast('success', lt.versionSaved(v.name));
          }}
          onDeleteVariant={(id) => {
            setDesignVariants(prev => prev.filter(v => v.id !== id));
            if (activeVariantId === id) setActiveVariantId(null);
          }}
          onApplyVariant={(v) => {
            if (v.shapeId !== selectedId) setSelectedId(v.shapeId);
            setParams({ ...v.params });
            setActiveVariantId(v.id);
            addToast('info', lt.versionApplied(v.name));
          }}
          onRenameVariant={(id, name) => {
            setDesignVariants(prev => prev.map(v => v.id === id ? { ...v, name } : v));
          }}
          onGenerateSweep={(paramKey, min, max, count) => {
            return generateLinearSweep(selectedId, params, paramKey, min, max, count);
          }}
        />
      )}

      {/* ═══ Thread/Hole Callout Panel ═══ */}
      {showThreadHolePanel && (
        <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 340, zIndex: 8000, boxShadow: '-4px 0 24px rgba(0,0,0,0.5)', border: '1px solid #21262d' }}>
          <ThreadHoleCalloutPanel
            threadCallouts={threadCallouts}
            holeCallouts={holeCallouts}
            onAddThread={(t) => setThreadCallouts(prev => [...prev, { ...t, id: `${Date.now()}`, position: [0,0,0] }])}
            onAddHole={(h) => setHoleCallouts(prev => [...prev, { ...h, id: `${Date.now()}`, position: [0,0,0] }])}
            onDeleteThread={(id) => setThreadCallouts(prev => prev.filter(t => t.id !== id))}
            onDeleteHole={(id) => setHoleCallouts(prev => prev.filter(h => h.id !== id))}
            lang={lang}
          />
          <button onClick={() => setShowThreadHolePanel(false)}
            style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: '#6e7681', fontSize: 16, cursor: 'pointer', zIndex: 1 }}>✕</button>
        </div>
      )}

      {/* ═══ User Parts Library (Phase 4) ═══ */}
      {showUserPartsPanel && (
        <UserPartsPanel
          lang={lang}
          onClose={() => setShowUserPartsPanel(false)}
          currentShapeId={selectedId}
          currentParams={params}
          captureThumbnail={() => captureRef.current?.() ?? null}
          onLoadPart={(part) => {
            if (part.shapeId !== selectedId) setSelectedId(part.shapeId);
            setParams({ ...part.params });
            setShowUserPartsPanel(false);
            addToast('success', lt.partLoaded(part.name));
          }}
        />
      )}

      {/* ═══ Session Timelapse (Phase 4) ═══ */}
      {showSessionTimelapse && (
        <SessionTimelapse
          lang={lang}
          captureFrame={() => captureRef.current?.() ?? null}
          onClose={() => setShowSessionTimelapse(false)}
        />
      )}

      {/* ═══ Stock Optimizer (Phase 4) ═══ */}
      {showStockOptimizer && (
        <StockOptimizerPanel
          lang={lang}
          onClose={() => setShowStockOptimizer(false)}
        />
      )}

      {/* ═══ Collab Reconnect Banner (Phase 3 — offline/reconnect UX) ═══ */}
      <CollabReconnectBanner
        state={collabReconnectState}
        countdown={collabReconnectCountdown}
        onRetry={() => collabManualReconnect(collabRoomId)}
        lang={lang}
      />

      {/* ═══ Toast Notifications ═══ */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* ═══ Global async work indicator — shows when any worker is busy ═══ */}
      {(pipelineWorkerLoading || dfmWorkerLoading || feaWorkerLoading || csgLoading) && (
        <div style={{
          position: 'fixed', bottom: 70, right: 20, zIndex: 9998,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', borderRadius: 999,
          background: 'rgba(22, 27, 34, 0.95)', backdropFilter: 'blur(8px)',
          border: '1px solid #30363d', color: '#c9d1d9',
          fontSize: 12, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          pointerEvents: 'none' }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid #30363d', borderTopColor: '#8b9cf4',
            animation: 'nf-spin 0.7s linear infinite' }} />
          <span>
            {feaWorkerLoading ? lt.feaRunning
              : dfmWorkerLoading ? lt.dfmRunning
              : csgLoading ? lt.csgRunning
              : lt.rebuildingGeometry}
          </span>
        </div>
      )}

      {/* ═══ Keyboard Shortcuts Help ═══ */}
      <ShortcutHelp visible={showShortcuts} onClose={() => setShowShortcuts(false)} lang={lang} />

      {/* ═══ Shortcut Hint Overlay (Alt long-hold) ═══ */}
      <ShortcutHintOverlay hints={[
        { targetId: 'btn-zoom-fit', keys: 'F' },
        { targetId: 'btn-grid-toggle', keys: 'G' },
        { targetId: 'btn-sketch-mode', keys: 'S' },
        { targetId: 'btn-undo', keys: 'Ctrl+Z' },
        { targetId: 'btn-redo', keys: 'Ctrl+Y' },
      ]} />

      {/* ═══ Command Palette (Ctrl+K) ═══ */}
      <CommandPalette
        visible={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={paletteCommands}
        lang={lang}
        onAskAI={(prompt) => {
          setPendingChatMsg(prompt);
          openAIAssistant('chat');
        }}
      />

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
        <AutoSaveIndicator
          isSaving={isSaving}
          lastSavedAt={lastSavedAt}
          saveError={saveError}
          lang={lang}
          cloudStatus={cloudStatus}
          cloudSavedAt={cloudSavedAt}
          versionConflictNeedsReload={versionConflictNeedsReload}
          onReloadForCloudConflict={reloadToFetchServerProject}
        />
      )}

      {/* ═══ OCCT Engine Toggle (experimental — #98 phase 2d) ═══ */}
      {viewMode === 'workspace' && (
        <button
          type="button"
          onClick={() => { void setOcctMode(!occtMode); }}
          disabled={occtInitPending}
          title={occtInitError ?? lt.occtEngine}
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
            opacity: occtInitPending ? 0.6 : 1 }}
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
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
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

      {/* ═══ DFM Auto-Fix Upgrade Modal ═══ */}
      <UpgradeModal
        open={showDFMFixUpgrade}
        feature="dfm_autofix"
        lang={lang}
        onClose={() => setShowDFMFixUpgrade(false)}
      />

      {/* ═══ AI DFM Insights Upgrade Modal ═══ */}
      <UpgradeModal
        open={showDFMInsightsUpgrade}
        feature="dfm_insights"
        lang={lang}
        onClose={() => setShowDFMInsightsUpgrade(false)}
      />

      {/* ═══ AI Process Router Upgrade Modal ═══ */}
      <UpgradeModal
        open={showProcessRouterUpgrade}
        feature="process_router"
        lang={lang}
        onClose={() => setShowProcessRouterUpgrade(false)}
      />

      {/* ═══ AI Process Router Panel ═══ */}
      {showProcessRouter && (
        <ProcessRouterPanel
          metrics={geometryMetrics}
          materialId={materialId}
          lang={lang}
          projectId={currentProjectId ?? undefined}
          onClose={() => setShowProcessRouter(false)}
          onSelectProcess={(p) => {
            // Map cost-estimator ProcessType → supplier-matcher process id
            const supplierProc =
              p === 'cnc' ? 'cnc_milling' :
              p === 'fdm' || p === 'sla' || p === 'sls' ? '3d_printing' :
              p === 'injection' ? 'injection_molding' :
              p === 'sheetmetal_laser' ? 'sheet_metal' :
              'cnc_milling';
            addToast('success', lt.processMatchingSuppliers(p));
            setShowProcessRouter(false);
            setChainedSupplierProcess(supplierProc);
            // Freemium gate before opening supplier matcher
            const gate = checkFreemium('ai_supplier_match');
            if (!gate.allowed) { setShowAISupplierMatchUpgrade(true); return; }
            setShowAISupplierMatch(true);
          }}
          onRequirePro={() => setShowProcessRouterUpgrade(true)}
        />
      )}

      {/* ═══ AI Supplier Match Upgrade Modal ═══ */}
      <UpgradeModal
        open={showAISupplierMatchUpgrade}
        feature="ai_supplier_match"
        lang={lang}
        onClose={() => setShowAISupplierMatchUpgrade(false)}
      />

      {/* ═══ AI Supplier Match Panel ═══ */}
      {showAISupplierMatch && (
        <AISupplierPanel
          material={materialId}
          process={chainedSupplierProcess}
          lang={lang}
          volume_cm3={geometryMetrics?.volume_cm3}
          bbox={geometryMetrics?.boundingBox}
          partName={selectedId}
          projectId={currentProjectId ?? undefined}
          onClose={() => { setShowAISupplierMatch(false); setChainedSupplierProcess(undefined); }}
          onRequirePro={() => setShowAISupplierMatchUpgrade(true)}
          onRfqSubmitted={(mfrName, qty) => {
            addToast('success', lt.rfqSent(mfrName, qty));
            setRfqDone(true);
          }}
        />
      )}

      {/* ═══ Design-for-Cost Copilot Upgrade Modal ═══ */}
      <UpgradeModal
        open={showCostCopilotUpgrade}
        feature="cost_copilot"
        lang={lang}
        onClose={() => setShowCostCopilotUpgrade(false)}
      />

      {/* ═══ Design-for-Cost Copilot Panel ═══ */}
      {showCostCopilot && (
        <CostCopilotPanel
          params={params}
          materialId={materialId}
          process="cnc_milling"
          quantity={100}
          metrics={geometryMetrics}
          lang={lang}
          projectId={currentProjectId ?? undefined}
          onClose={() => setShowCostCopilot(false)}
          setParam={(k, v) => {
            setParam(k, v);
            setParamExpression(k, String(v));
          }}
          setMaterialId={(id) => {
            setMaterialId(id);
            addToast('success', lt.materialSwitched(id));
          }}
          onRequirePro={() => setShowCostCopilotUpgrade(true)}
          onContinueToProcessRouter={() => {
            setShowCostCopilot(false);
            const gate = checkFreemium('process_router');
            if (!gate.allowed) { setShowProcessRouterUpgrade(true); return; }
            setShowProcessRouter(true);
          }}
        />
      )}

      {/* ═══ AI History Panel ═══ */}
      {showAIHistory && (
        <AIHistoryPanel
          lang={lang}
          projectId={currentProjectId ?? undefined}
          onClose={() => setShowAIHistory(false)}
          onApplySuggestion={({ paramDeltas, materialSwap }) => {
            let appliedCount = 0;
            if (paramDeltas) {
              for (const [k, delta] of Object.entries(paramDeltas)) {
                const cur = params[k];
                if (typeof cur !== 'number' || typeof delta !== 'number') continue;
                const next = cur + delta;
                setParam(k, next);
                setParamExpression(k, String(next));
                appliedCount += 1;
              }
            }
            if (materialSwap) {
              setMaterialId(materialSwap);
              appliedCount += 1;
            }
            if (appliedCount > 0) {
              addToast('success', lt.suggestionReapplied);
            } else {
              addToast('info', lt.noApplicableChanges);
            }
          }}
        />
      )}

      {/* ═══ AI 형상 생성 (JSCAD) Panel ═══ */}
      {showOpenScad && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 120,
          background: '#161b22', borderLeft: '1px solid #30363d',
          display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
            <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 13 }}>{lt.aiShapeGenPanel}</span>
            <button
              onClick={() => setShowOpenScad(false)}
              style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
            >×</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <OpenScadPanel
              onGeometryReady={(geo, description) => {
                handleGeometryApply(geo);
                addToast('success', lt.aiShapeGenerated(description.slice(0, 40)));
              }}
              selectedElement={selectedElement}
              currentShape={effectiveResult ? {
                shapeId: isSketchMode ? null : selectedId,
                params: isSketchMode ? {} : { ...params },
                features: enabledFeaturesForContext,
                bbox: effectiveResult.bbox } : null}
            />
          </div>
        </div>
      )}

      {/* ═══ Collaboration Read-Only Upgrade Modal ═══ */}
      <UpgradeModal
        open={showCollabEditUpgrade}
        feature="collaboration_edit"
        lang={lang}
        onClose={() => setShowCollabEditUpgrade(false)}
      />

      {/* ═══ Pre-Export Optimization Upgrade Modal ═══ */}
      <UpgradeModal
        open={showExportOptimizeUpgrade}
        feature="export_optimize"
        lang={lang}
        onClose={() => setShowExportOptimizeUpgrade(false)}
      />

      {/* ═══ Manufacturer Match Modal ═══ */}
      {showManufacturerMatch && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 8000,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)' }} onClick={() => setShowManufacturerMatch(false)}>
          <div style={{ width: 560, maxHeight: '85vh', overflow: 'auto', borderRadius: 14 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #30363d' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#e6edf3' }}>
                  🏭 {lt.selectManufacturer}
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
                    body: JSON.stringify({ message: lt.quoteRequestMessage }) })
                    .then((res) => {
                      if (!res.ok) {
                        console.warn('[Manufacturer contact] request failed:', res.status);
                        addToast('error', lt.networkError(`HTTP ${res.status}`));
                        return;
                      }
                      addToast('success', lt.quoteRequestSent(lang === 'ko' ? m.nameKo : m.name));
                      const _shapeName = sketchResult ? 'Custom Sketch' : (selectedId ?? '');
                      const _qs = new URLSearchParams({
                        open: '1',
                        ...((_shapeName) && { shapeName: _shapeName }),
                        ...(materialId && { material: materialId }),
                        ...(m.id && { factoryId: m.id }) });
                      router.push(`/${langSeg}/nexyfab/rfq?${_qs.toString()}`);
                    })
                    .catch((err: unknown) => {
                      console.error('[Manufacturer contact] network error:', err);
                      const msg = err instanceof Error ? err.message : String(err);
                      addToast('error', lt.networkError(msg));
                    });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ Comments Panel (slide-in from right) ═══ */}
      {showCommentsPanel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 7500,
          display: 'flex', justifyContent: 'flex-end' }} onClick={() => setShowCommentsPanel(false)}>
          <div
            style={{
              width: 320, height: '100%', background: '#0d1117',
              border: '1px solid #21262d', borderRight: 'none',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Panel header */}
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid #21262d',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#e6edf3' }}>
                {lt.collabPanel}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => { setShowChatPanel(false); }}
                  title={lt.pinComments}
                  style={{ background: !showChatPanel ? '#388bfd22' : 'none', border: !showChatPanel ? '1px solid #388bfd44' : '1px solid transparent', borderRadius: 5, color: !showChatPanel ? '#388bfd' : '#6e7681', fontSize: 13, cursor: 'pointer', padding: '3px 8px' }}
                >
                  📌
                </button>
                <button
                  onClick={() => { setShowChatPanel(true); }}
                  title={lt.chatLabel}
                  style={{ background: showChatPanel ? '#388bfd22' : 'none', border: showChatPanel ? '1px solid #388bfd44' : '1px solid transparent', borderRadius: 5, color: showChatPanel ? '#388bfd' : '#6e7681', fontSize: 13, cursor: 'pointer', padding: '3px 8px' }}
                >
                  💬
                </button>
                <button
                  onClick={() => setShowCommentsPanel(false)}
                  style={{ background: 'none', border: 'none', color: '#6e7681', fontSize: 16, cursor: 'pointer' }}
                >✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {showChatPanel ? (
                <CollabChat
                  messages={chatMessages}
                  currentUserId={collabUserIdRef.current}
                  users={collabUsers}
                  typingUsers={collabTypingUsers}
                  onSend={(text) => collabSendChatMessage(text, authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`)}
                  onTyping={() => collabSendTyping(authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`)}
                  lang={lang}
                />
              ) : (
                <CommentsPanel
                  comments={comments}
                  isPlacingComment={isPlacingComment}
                  setIsPlacingComment={setIsPlacingComment}
                  onResolve={(id) => { resolveComment(id); addActivity({ type: 'comment_resolve', actor: authUser?.name ?? 'You' }); }}
                  onDelete={(id) => { deleteComment(id); addActivity({ type: 'comment_delete', actor: authUser?.name ?? 'You' }); }}
                  onReact={(id, emoji) => reactToComment(id, emoji, collabUserIdRef.current)}
                  onReply={(id, text) => addReply(id, text, authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`, collabUserColorRef.current)}
                  focusedCommentId={focusedCommentId}
                  setFocusedCommentId={setFocusedCommentId}
                  activityFeed={activityFeed}
                  lang={lang}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ IP Share Confirm ═══ */}
      {showShareConfirm && shareUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)' }} onClick={() => setShowShareConfirm(false)}>
          <div style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 14,
            padding: '28px 24px', width: 360, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>
              🔒 {lt.ipProtectedShare}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 11, color: '#6e7681' }}>
              {lt.ipShareInfo}
            </p>
            <div style={{
              background: '#0d1117', border: '1px solid #21262d', borderRadius: 8,
              padding: '10px 12px', fontSize: 11, color: '#58a6ff', wordBreak: 'break-all',
              marginBottom: 12, fontFamily: 'monospace' }}>{shareUrl}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={async () => { await copyShareUrl(); addToast('success', lt.linkCopied); }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: '#388bfd', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📋 {lt.copyLabel}</button>
              <button onClick={() => { setShowShareConfirm(false); resetShare(); }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer' }}>{lt.closeLabel}</button>
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
              addToast('success', lt.optimalStructureDone);
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
              addToast('success', lt.thermalFeaDone);
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
              addToast('success', lt.pcbHeatMappingDone);
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
              cursor: 'pointer' }}
          >
            {showThermalOverlay
              ? lt.showOriginal
              : lt.showPcbHeatMap}
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
              cursor: 'pointer' }}
          >
            {showGenOverlay
              ? lt.showOriginal
              : lt.showOptimized}
          </button>
        </div>
      )}

      {/* ═══ Topological ID Map Panel ═══ */}
      {topoMap.map.generation > 0 && (
        <TopoMapPanel
          topoMap={topoMap}
          lang={lang}
        />
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
              addToast('success', lt.modalAnalysisDone);
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
              max: (params[k] as number) * 1.5 }))}
            onApplyBest={(best) => {
              Object.entries(best).forEach(([k, v]) => setParam(k, v));
              addToast('success', lt.bestParamsApplied);
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
              addToast('success', lt.surfaceAnalysisDone);
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
              addToast('info', lt.quoteRequested(mfgId));
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

      {/* ═══ Copilot Panel ═══ */}
      {showCopilot && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 600 }}>
          <CopilotPanel
            lang={lang}
            dispatcher={{
              addFeature: (type, params) => {
                const num: Record<string, number> = {};
                if (params) {
                  for (const [k, v] of Object.entries(params)) {
                    if (typeof v === 'number' && Number.isFinite(v)) num[k] = v;
                  }
                }
                addFeatureWithParamsAndContext(type as FeatureType, num);
              },
              addSketchFeature,
              setParam,
            }}
            onClose={() => setShowCopilot(false)}
          />
        </div>
      )}

      {/* ═══ CAM Simulation Panel ═══ */}
      {showCAMSimPanel && camSimResult && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 600 }}>
          <CAMSimPanel
            lang={lang}
            result={camSimResult.result}
            operation={camSimResult.operation}
            onClose={() => setShowCAMSimPanel(false)}
          />
        </div>
      )}

      {/* ═══ Mold Design Panel ═══ */}
      {showMoldDesignPanel && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 600 }}>
          <MoldDesignPanel
            lang={lang}
            geometry={effectiveResult?.geometry ?? null}
            onClose={() => setShowMoldDesignPanel(false)}
            onGenerateCavity={(margin) => {
              if (!effectiveResult?.geometry.boundingBox) return;
              const bb = effectiveResult.geometry.boundingBox;
              const w = bb.max.x - bb.min.x + margin * 2;
              const h = bb.max.y - bb.min.y + margin * 2;
              const d = bb.max.z - bb.min.z + margin * 2;
              addFeatureWithParamsAndContext('sketchExtrude', { width: w, height: h, depth: d });
            }}
            onShowDraftAnalysis={(minAngle) => {
              handleDraftAnalyze([0, 0, 1], minAngle);
              setShowDraftAnalysis(true);
            }}
            onSplitBody={() => {
              addFeatureWithParamsAndContext('splitBody', { plane: 0, keepSide: 0, offset: 0 });
            }}
            onOpenStandardParts={() => {
              useUIStore.getState().togglePanel('showLibrary');
            }}
            onExportPackage={handleExportSTEP}
          />
        </div>
      )}

      {/* ═══ RFQ Panel ═══ */}
      {showRfqPanel && (
        <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 600 }}>
          <RfqPanel
            lang={lang}
            geometry={effectiveResult?.geometry ?? null}
            partLabel={selectedId ?? 'NexyFab_Part'}
            materialKey={materialId}
            volume_cm3={effectiveResult ? meshVolume(effectiveResult.geometry) / 1000 : 0}
            onClose={() => setShowRfqPanel(false)}
          />
        </div>
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
      {/* WebWorker Progress Bar Overlay */}
      {pipelineWorkerLoading && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(22, 27, 34, 0.85)',
          backdropFilter: 'blur(10px)',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          zIndex: 9999,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          minWidth: 250,
          animation: 'fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>
              {pipelineProgressLabel || 'Calculating...'}
            </span>
            <span style={{ fontSize: 11, color: '#388bfd', fontWeight: 700 }}>
              {pipelineProgress}%
            </span>
          </div>
          <div style={{ width: '100%', height: 6, background: '#0d1117', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${pipelineProgress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #388bfd, #58a6ff)',
              transition: 'width 0.1s linear',
            }} />
          </div>
        </div>
      )}

      <style precedence="default" href="sg-page-1">{`
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
